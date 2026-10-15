using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Choirs.Commands;
using NoteFusion.Application.Choirs.Dtos;
using NoteFusion.Application.Choirs.Queries;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Library.Queries;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Choirs;

/// <summary>
/// The choir plan: one director pays, up to 25 singers who join with the invite code are Pro while the choir's
/// period runs, the choir shares 60 songs a month and one library. What it must do — sell by region like Pro,
/// open and stack the choir on payment, make singers Pro and stop on lapse, hold the seat cap and the
/// one-choir rule, pool the songs (running ones held), keep the library to the choir — and what it must not:
/// let a singer run the choir, or leave a departed singer's sheets in it.
/// </summary>
public class ChoirPlanTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 12, 0, 0, DateTimeKind.Utc);
    private const string Link = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    // ---------------------------------------------------------------- plans and eligibility

    [Theory]
    [InlineData("NG", new[] { "choir_monthly_ngn", "choir_yearly_ngn" })]
    [InlineData("GB", new[] { "choir_monthly_usd", "choir_yearly_usd" })]
    [InlineData("KE", new[] { "choir_monthly_usd_regional", "choir_yearly_usd_regional" })]
    [InlineData("IN", new[] { "choir_monthly_usd_regional", "choir_yearly_usd_regional" })]
    [InlineData(null, new[] { "choir_monthly_ngn", "choir_monthly_usd", "choir_yearly_ngn", "choir_yearly_usd" })]
    public async Task Each_region_is_offered_its_own_choir_plans(string? country, string[] expected)
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, "dir@example.com", country);

        var codes = (await Plans(h, user, choir: true)).Select(p => p.Code).Order().ToArray();

        Assert.Equal(expected.Order().ToArray(), codes);
        Assert.All(await Plans(h, user, choir: true), p => Assert.Equal(25, p.ChoirSeats));
    }

    [Fact]
    public async Task Choir_plans_stay_out_of_the_pro_list_and_the_public_page()
    {
        // App builds already installed render every non-single plan in the list as a Pro option.
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, "dir@example.com", "GB");
        h.Country.Country = "GB";

        Assert.DoesNotContain(await Plans(h, user), p => p.ChoirSeats is not null);
        var pub = (await new GetPublicPricingQueryHandler(h.Db, h.Country).Handle(new GetPublicPricingQuery(), default)).Value;
        Assert.DoesNotContain(pub.Plans, p => p.Code.StartsWith("choir_"));
    }

    [Theory]
    [InlineData("GB", "choir_monthly_usd_regional")]
    [InlineData("KE", "choir_monthly_usd")]
    [InlineData("NG", "choir_yearly_usd")]
    [InlineData(null, "choir_yearly_usd_regional")]
    public async Task Checkout_refuses_a_choir_plan_from_another_region(string? country, string code)
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var user = SeedUser(h, "dir@example.com", country);

        var result = await Checkout(h, user, code);

        Assert.Equal("BILLING_PLAN_NOT_AVAILABLE_IN_REGION", result.Error.Code);
    }

    [Fact]
    public async Task A_singer_in_a_running_choir_cannot_buy_a_choir_of_their_own()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        Assert.True((await Join(h, singer, choir.InviteCode)).IsSuccess);

        var result = await Checkout(h, singer, "choir_monthly_ngn");

        Assert.Equal("CHOIR_MEMBER_OF_ANOTHER", result.Error.Code);
    }

    // ---------------------------------------------------------------- fulfilment

    [Fact]
    public async Task A_paid_choir_checkout_opens_the_choir_and_not_a_pro_membership()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var director = SeedUser(h, "dir@example.com");

        await Pay(h, director, "choir_monthly_ngn");

        var choir = Assert.Single(h.Db.Choirs);
        Assert.Equal(director.Id, choir.OwnerId);
        Assert.Equal(Now.AddMonths(1), choir.CurrentPeriodEndUtc);
        Assert.Equal(25, choir.Seats);
        Assert.Equal(8, choir.InviteCode.Length);
        Assert.Equal("Ada's choir", choir.Name);
        Assert.Empty(h.Db.Subscriptions);
        Assert.True(await ProStatus.IsProAsync(h.Db, h.Clock, director.Id));
        Assert.Equal(LedgerEntryReason.SubscriptionCharge, Assert.Single(h.Db.LedgerEntries).Reason);
        Assert.Equal(Now.AddMonths(1), Assert.Single(h.Email.Receipts).RenewsAtUtc);
    }

    [Fact]
    public async Task Buying_again_stacks_after_the_time_left_and_moves_to_the_plan_bought()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var director = SeedUser(h, "dir@example.com");
        await Pay(h, director, "choir_monthly_ngn");
        var firstCode = h.Db.Choirs.Single().InviteCode;

        await Pay(h, director, "choir_yearly_ngn");

        var choir = Assert.Single(h.Db.Choirs);
        Assert.Equal(Now.AddMonths(1).AddYears(1), choir.CurrentPeriodEndUtc);
        Assert.Equal(h.Db.Plans.Single(p => p.Code == "choir_yearly_ngn").Id, choir.PlanId);
        Assert.Equal(firstCode, choir.InviteCode); // the singers' link keeps working
    }

    [Fact]
    public async Task A_lapsed_choir_bought_again_starts_from_now()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var director = SeedUser(h, "dir@example.com");
        await Pay(h, director, "choir_monthly_ngn");
        h.Clock.UtcNow = Now.AddMonths(3);

        await Pay(h, director, "choir_monthly_ngn");

        Assert.Equal(Now.AddMonths(4), h.Db.Choirs.Single().CurrentPeriodEndUtc);
    }

    [Fact]
    public async Task A_director_keeps_their_own_pro_apart_from_the_choir()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var director = SeedUser(h, "dir@example.com");
        await Pay(h, director, "pro_monthly_ngn");

        await Pay(h, director, "choir_monthly_ngn");

        Assert.Equal(Now.AddMonths(1), h.Db.Subscriptions.Single().CurrentPeriodEndUtc);
        Assert.Equal(Now.AddMonths(1), h.Db.Choirs.Single().CurrentPeriodEndUtc);

        // The app sees the choir payment land by the choir's own period end, beside the Pro one.
        var shown = await Shown(h, director);
        Assert.Equal("pro_monthly_ngn", shown.PlanCode);
        Assert.Equal("director", shown.ChoirRole);
        Assert.Equal(Now.AddMonths(1), shown.ChoirPeriodEndUtc);
    }

    // ---------------------------------------------------------------- singers are Pro

    [Fact]
    public async Task A_free_singer_who_joins_is_pro_at_once_and_loses_it_when_the_choir_lapses()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        Assert.False(await ProStatus.IsProAsync(h.Db, h.Clock, singer.Id));

        var joined = await Join(h, singer, choir.InviteCode.ToLowerInvariant());

        Assert.True(joined.IsSuccess);
        Assert.Equal("member", joined.Value.Role);
        Assert.Null(joined.Value.InviteCode); // the code is the director's to hand out
        Assert.True(await ProStatus.IsProAsync(h.Db, h.Clock, singer.Id));
        var shown = await Shown(h, singer);
        Assert.True(shown.IsActive);
        Assert.Equal("choir_monthly_ngn", shown.PlanCode);
        Assert.Equal(choir.Name, shown.ChoirName);
        Assert.Equal("member", shown.ChoirRole);
        Assert.Equal(SongCredits.ChoirMonthlyPool, shown.SongCreditsTotal);

        // The Pro fast lane, through the one check every Pro path reads.
        var api = new FakeApi();
        await SubmitUpload(h, singer, api);
        Assert.Equal(TranscribePriority.High, api.LastOptions!.Priority);

        h.Clock.UtcNow = choir.CurrentPeriodEndUtc;
        Assert.False(await ProStatus.IsProAsync(h.Db, h.Clock, singer.Id));
        Assert.False((await Shown(h, singer)).IsActive);
    }

    [Fact]
    public async Task A_singer_who_leaves_stops_being_pro()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        await Join(h, singer, choir.InviteCode);

        var left = await new LeaveChoirCommandHandler(h.Db, new StubCurrentUser(singer.Id), h.Clock)
            .Handle(new LeaveChoirCommand(), default);

        Assert.True(left.IsSuccess);
        Assert.False(await ProStatus.IsProAsync(h.Db, h.Clock, singer.Id));
    }

    // ---------------------------------------------------------------- joining

    [Fact]
    public async Task The_seat_cap_holds_at_twenty_five_singers()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, choir) = await SeedChoir(h);
        for (var i = 0; i < 25; i++)
            Assert.True((await Join(h, SeedUser(h, $"s{i}@example.com"), choir.InviteCode)).IsSuccess);

        var refused = await Join(h, SeedUser(h, "late@example.com"), choir.InviteCode);

        Assert.Equal("CHOIR_FULL", refused.Error.Code);
        Assert.Contains("25", refused.Error.Message);
        Assert.Equal(25, h.Db.ChoirMembers.Count());
    }

    [Fact]
    public async Task An_account_sings_in_one_choir()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, first) = await SeedChoir(h, "dir1@example.com");
        var (secondDirector, second) = await SeedChoir(h, "dir2@example.com");
        var singer = SeedUser(h, "singer@example.com");
        await Join(h, singer, first.InviteCode);

        Assert.Equal("CHOIR_ALREADY_MEMBER", (await Join(h, singer, second.InviteCode)).Error.Code);
        Assert.True((await Join(h, singer, first.InviteCode)).IsSuccess); // the same link twice is harmless
        Assert.Equal("CHOIR_ALREADY_DIRECTOR", (await Join(h, secondDirector, first.InviteCode)).Error.Code);
        Assert.Equal("CHOIR_OWN_CHOIR", (await Join(h, secondDirector, second.InviteCode)).Error.Code);
        Assert.Single(h.Db.ChoirMembers);
    }

    [Fact]
    public async Task A_lapsed_choir_takes_no_new_singers()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, choir) = await SeedChoir(h);
        h.Clock.UtcNow = choir.CurrentPeriodEndUtc.AddDays(1);

        var refused = await Join(h, SeedUser(h, "singer@example.com"), choir.InviteCode);

        Assert.Equal("CHOIR_INACTIVE", refused.Error.Code);
    }

    [Fact]
    public async Task A_new_invite_code_stops_the_old_one_and_keeps_the_singers()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var oldCode = choir.InviteCode;
        var singer = SeedUser(h, "singer@example.com");
        await Join(h, singer, oldCode);

        var fresh = await new RegenerateChoirInviteCommandHandler(h.Db, new StubCurrentUser(director.Id), h.Clock)
            .Handle(new RegenerateChoirInviteCommand(), default);

        Assert.True(fresh.IsSuccess);
        Assert.NotEqual(oldCode, fresh.Value.InviteCode);
        Assert.Equal("CHOIR_INVITE_NOT_FOUND", (await Join(h, SeedUser(h, "late@example.com"), oldCode)).Error.Code);
        Assert.True((await Join(h, SeedUser(h, "later@example.com"), fresh.Value.InviteCode!)).IsSuccess);
        Assert.True(await ProStatus.IsProAsync(h.Db, h.Clock, singer.Id));
    }

    // ---------------------------------------------------------------- director only

    [Fact]
    public async Task Director_only_actions_refuse_a_singer()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        var other = SeedUser(h, "other@example.com");
        await Join(h, singer, choir.InviteCode);
        await Join(h, other, choir.InviteCode);
        var asSinger = new StubCurrentUser(singer.Id);

        Assert.Equal("CHOIR_DIRECTOR_ONLY",
            (await new RenameChoirCommandHandler(h.Db, asSinger, h.Clock).Handle(new RenameChoirCommand("Mine now"), default)).Error.Code);
        Assert.Equal("CHOIR_DIRECTOR_ONLY",
            (await new GetChoirMembersQueryHandler(h.Db, asSinger, h.Clock).Handle(new GetChoirMembersQuery(), default)).Error.Code);
        Assert.Equal("CHOIR_DIRECTOR_ONLY",
            (await new RemoveChoirMemberCommandHandler(h.Db, asSinger, h.Clock).Handle(new RemoveChoirMemberCommand(other.Id), default)).Error.Code);
        Assert.Equal("CHOIR_DIRECTOR_ONLY",
            (await new RegenerateChoirInviteCommandHandler(h.Db, asSinger, h.Clock).Handle(new RegenerateChoirInviteCommand(), default)).Error.Code);
        Assert.Equal(2, h.Db.ChoirMembers.Count());

        // And the director can.
        var asDirector = new StubCurrentUser(director.Id);
        var renamed = await new RenameChoirCommandHandler(h.Db, asDirector, h.Clock).Handle(new RenameChoirCommand("  St Mary's Choir "), default);
        Assert.Equal("St Mary's Choir", renamed.Value.Name);
        var members = await new GetChoirMembersQueryHandler(h.Db, asDirector, h.Clock).Handle(new GetChoirMembersQuery(), default);
        Assert.Equal(2, members.Value.Count);
        Assert.Equal("CHOIR_DIRECTOR_CANNOT_LEAVE",
            (await new LeaveChoirCommandHandler(h.Db, asDirector, h.Clock).Handle(new LeaveChoirCommand(), default)).Error.Code);
    }

    // ---------------------------------------------------------------- the shared song pool

    [Fact]
    public async Task The_choir_shares_sixty_songs_a_month_running_ones_held()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        await Join(h, singer, choir.InviteCode);
        SpendChoirSongs(h, director, choir, 58);

        var api = new FakeApi();
        var first = await SubmitLink(h, singer, api);
        Assert.True(first.IsSuccess);
        Assert.Equal(choir.Id, h.Db.TranscriptionJobs.Single(j => j.JobId == first.Value).ChoirId);
        Assert.Equal(SongCredits.ProMaxSeconds, api.LastOptions!.MaxSeconds);

        // One left, shown to everyone in the choir, with the running song held.
        Assert.Equal(1, (await Shown(h, director)).SongCreditsRemaining);
        Assert.Equal(1, (await MyChoir(h, singer)).SongCreditsRemaining);

        Assert.True((await SubmitLink(h, director, api)).IsSuccess);
        var refused = await SubmitLink(h, singer, api);
        Assert.Equal("BILLING_SONG_CREDITS_EXHAUSTED", refused.Error.Code);
        Assert.Contains("60", refused.Error.Message);

        // A running song that fails frees its place for the whole choir.
        api.Status = TranscriptionStatus.Failed;
        await new NoteFusion.Application.Transcriptions.Queries.GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(singer.Id), h.Clock)
            .Handle(new NoteFusion.Application.Transcriptions.Queries.GetTranscriptionJobQuery(first.Value), default);
        api.Status = TranscriptionStatus.Pending;
        Assert.True((await SubmitLink(h, singer, api)).IsSuccess);
    }

    [Fact]
    public async Task Own_pro_songs_go_first_and_the_choir_pool_after_them()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        await Join(h, singer, choir.InviteCode);
        await Pay(h, singer, "pro_monthly_ngn");
        SpendOwnSongs(h, singer, SongCredits.ProMonthlyAllowance - 1);
        var api = new FakeApi();

        var own = await SubmitLink(h, singer, api);
        var pooled = await SubmitLink(h, singer, api);

        Assert.Null(h.Db.TranscriptionJobs.Single(j => j.JobId == own.Value).ChoirId);
        Assert.Equal(choir.Id, h.Db.TranscriptionJobs.Single(j => j.JobId == pooled.Value).ChoirId);
        var shown = await Shown(h, singer);
        Assert.Equal(SongCredits.ProMonthlyAllowance + SongCredits.ChoirMonthlyPool, shown.SongCreditsTotal);
        Assert.Equal(SongCredits.ChoirMonthlyPool - 1, shown.SongCreditsRemaining);
    }

    [Fact]
    public async Task Each_singer_may_have_three_songs_running()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        await Join(h, singer, choir.InviteCode);
        var api = new FakeApi();

        for (var i = 0; i < SongCredits.ProMaxSongsInProgress; i++)
            Assert.True((await SubmitLink(h, singer, api)).IsSuccess);

        Assert.Equal("BILLING_SONGS_IN_PROGRESS", (await SubmitLink(h, singer, api)).Error.Code);
        Assert.True((await SubmitLink(h, director, api)).IsSuccess); // per person, not per choir
    }

    // ---------------------------------------------------------------- the shared library

    [Fact]
    public async Task The_choir_library_is_open_to_the_choir_and_no_one_else()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        var outsider = SeedUser(h, "outsider@example.com");
        await Join(h, singer, choir.InviteCode);
        var sheet = SeedSheet(h, singer, "Amazing Grace");
        var outsiderSheet = SeedSheet(h, outsider, "Not yours");

        Assert.True((await Share(h, singer, sheet.Id)).IsSuccess);
        Assert.Equal("LIBRARY_NOT_OWNED", (await Share(h, singer, outsiderSheet.Id)).Error.Code);
        Assert.Equal("CHOIR_NOT_FOUND", (await Share(h, outsider, outsiderSheet.Id)).Error.Code);

        var seen = await ChoirSheets(h, director);
        var row = Assert.Single(seen.Value);
        Assert.Equal("Amazing Grace", row.Title);
        Assert.Equal("Bea", row.SharedBy);
        Assert.False(row.Mine);
        Assert.True(row.CanUnshare); // the director may take any sheet out
        Assert.NotEmpty(row.Preview);
        Assert.True((await ChoirSheet(h, director, sheet.Id)).IsSuccess);
        Assert.True((await new GetLibraryQueryHandler(h.Db, new StubCurrentUser(singer.Id)).Handle(new GetLibraryQuery(), default))
            .Value.Single().SharedWithChoir);

        Assert.Equal("CHOIR_NOT_FOUND", (await ChoirSheets(h, outsider)).Error.Code);
        Assert.Equal("CHOIR_NOT_FOUND", (await ChoirSheet(h, outsider, sheet.Id)).Error.Code);
    }

    [Fact]
    public async Task A_removed_singer_loses_the_library_and_takes_their_sheets_out_of_it()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        await Join(h, singer, choir.InviteCode);
        var theirs = SeedSheet(h, singer, "Their hymn");
        var directors = SeedSheet(h, director, "Director's hymn");
        await Share(h, singer, theirs.Id);
        await Share(h, director, directors.Id);
        Assert.True((await ChoirSheet(h, singer, directors.Id)).IsSuccess);

        var removed = await new RemoveChoirMemberCommandHandler(h.Db, new StubCurrentUser(director.Id), h.Clock)
            .Handle(new RemoveChoirMemberCommand(singer.Id), default);

        Assert.True(removed.IsSuccess);
        Assert.Equal("CHOIR_NOT_FOUND", (await ChoirSheets(h, singer)).Error.Code);
        Assert.Equal("CHOIR_NOT_FOUND", (await ChoirSheet(h, singer, directors.Id)).Error.Code);
        Assert.Equal(["Director's hymn"], (await ChoirSheets(h, director)).Value.Select(s => s.Title));
        Assert.Null(h.Db.Transcriptions.Single(t => t.Id == theirs.Id).ChoirId);
        Assert.False(await ProStatus.IsProAsync(h.Db, h.Clock, singer.Id));
    }

    [Fact]
    public async Task A_singer_unshares_only_their_own_and_the_director_any()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var singer = SeedUser(h, "singer@example.com");
        var other = SeedUser(h, "other@example.com");
        await Join(h, singer, choir.InviteCode);
        await Join(h, other, choir.InviteCode);
        var singersSheet = SeedSheet(h, singer, "Singer's");
        var othersSheet = SeedSheet(h, other, "Other's");
        await Share(h, singer, singersSheet.Id);
        await Share(h, other, othersSheet.Id);

        Assert.Equal("CHOIR_DIRECTOR_ONLY", (await Unshare(h, singer, othersSheet.Id)).Error.Code);
        Assert.True((await Unshare(h, singer, singersSheet.Id)).IsSuccess);
        Assert.True((await Unshare(h, director, othersSheet.Id)).IsSuccess);
        Assert.Empty((await ChoirSheets(h, director)).Value);
    }

    [Fact]
    public async Task A_lapsed_choir_closes_its_library()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (director, choir) = await SeedChoir(h);
        var sheet = SeedSheet(h, director, "Hymn");
        await Share(h, director, sheet.Id);
        h.Clock.UtcNow = choir.CurrentPeriodEndUtc;

        Assert.Equal("CHOIR_INACTIVE", (await ChoirSheets(h, director)).Error.Code);
        Assert.False((await MyChoir(h, director)).IsActive); // the director still sees the choir, to renew it
    }

    // ---------------------------------------------------------------- the dashboard

    [Fact]
    public async Task A_choir_is_one_paid_member_at_its_plan_price_and_its_singers_are_counted_apart()
    {
        using var h = new TestHarness(Now);
        SeedPlans(h);
        var (_, choir) = await SeedChoir(h);
        await Join(h, SeedUser(h, "s1@example.com"), choir.InviteCode);
        await Join(h, SeedUser(h, "s2@example.com"), choir.InviteCode);

        var m = (await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default)).Value.Membership;

        Assert.Equal(1, m.ActiveMembers);
        Assert.Equal(1, m.PaidMembers);
        Assert.Equal(1, m.ActiveChoirs);
        Assert.Equal(2, m.ChoirSingers);
        Assert.Equal([("NoteFusion Choir (Monthly)", 1)], m.MembersByPlan.Select(p => (p.Label, p.Count)));
        Assert.Equal([("NGN", 2_500_000L)], m.MonthlyRunRate.Select(r => (r.Currency, r.AmountMinor)));
    }

    // ---------------------------------------------------------------- fixtures

    private static void SeedPlans(TestHarness h)
    {
        (string Code, string Name, long Amount, string Currency, BillingInterval Interval, int? Seats)[] plans =
        [
            ("pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly, null),
            ("pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly, null),
            ("pro_monthly_usd_regional", "NoteFusion Pro (Monthly)", 499, "USD", BillingInterval.Monthly, null),
            ("choir_monthly_ngn", "NoteFusion Choir (Monthly)", 2_500_000, "NGN", BillingInterval.Monthly, 25),
            ("choir_yearly_ngn", "NoteFusion Choir (Yearly)", 25_000_000, "NGN", BillingInterval.Yearly, 25),
            ("choir_monthly_usd", "NoteFusion Choir (Monthly)", 1_999, "USD", BillingInterval.Monthly, 25),
            ("choir_yearly_usd", "NoteFusion Choir (Yearly)", 19_900, "USD", BillingInterval.Yearly, 25),
            ("choir_monthly_usd_regional", "NoteFusion Choir (Monthly)", 999, "USD", BillingInterval.Monthly, 25),
            ("choir_yearly_usd_regional", "NoteFusion Choir (Yearly)", 9_900, "USD", BillingInterval.Yearly, 25),
        ];
        foreach (var p in plans)
            h.Db.Plans.Add(Plan.Create(Guid.NewGuid(), p.Code, p.Name, p.Amount, p.Currency, p.Interval, p.Seats));
        h.Db.SaveChanges();
    }

    private static User SeedUser(TestHarness h, string email, string? country = "NG")
    {
        var name = email.StartsWith("dir") ? "Ada Director" : email.StartsWith("singer") ? "Bea Singer" : "Cal Chorister";
        var user = User.Create(name, email, "hash", Now.AddDays(-30));
        if (country is not null)
            user.RecordCountry(country);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static async Task<(User Director, Choir Choir)> SeedChoir(TestHarness h, string email = "dir@example.com")
    {
        var director = SeedUser(h, email);
        await Pay(h, director, "choir_monthly_ngn");
        return (director, h.Db.Choirs.Single(c => c.OwnerId == director.Id));
    }

    private static Transcription SeedSheet(TestHarness h, User owner, string title)
    {
        var sheet = new Transcription(
            owner.Id, title, new MusicalKey(0, KeyMode.Major), 90, "4/4", "<score/>",
            [new NoteEvent { PitchMidi = 60, StartBeat = 0, DurationBeats = 1 }, new NoteEvent { PitchMidi = 64, StartBeat = 1, DurationBeats = 1 }],
            0.9);
        h.Db.Transcriptions.Add(sheet);
        h.Db.SaveChanges();
        return sheet;
    }

    private static void SpendChoirSongs(TestHarness h, User user, Choir choir, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.RecordLink($"pool-{i}", user.Id, Now.AddDays(-1), null, wasPro: true, choirId: choir.Id);
            job.ConsumeSongCredit(Now.AddDays(-1));
            h.Db.TranscriptionJobs.Add(job);
        }
        h.Db.SaveChanges();
    }

    private static void SpendOwnSongs(TestHarness h, User user, int count)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.RecordLink($"own-{i}", user.Id, Now.AddDays(-1), null, wasPro: true);
            job.ConsumeSongCredit(Now.AddDays(-1));
            h.Db.TranscriptionJobs.Add(job);
        }
        h.Db.SaveChanges();
    }

    /// <summary>A checkout for <paramref name="code"/>, paid, and fulfilled through the webhook handler as production does.</summary>
    private static async Task Pay(TestHarness h, User user, string code)
    {
        var plan = h.Db.Plans.Single(p => p.Code == code);
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(
            user.Id, plan.Id, PaymentProvider.Paystack, $"checkout:{reference}", reference, plan.AmountMinor, plan.Currency, h.Clock.UtcNow);
        tx.AttachCheckout("ps_" + reference, "https://checkout.paystack.com/x", "{}", h.Clock.UtcNow);
        h.Db.PaymentTransactions.Add(tx);
        var e = WebhookEvent.Receive(PaymentProvider.Paystack, "evt_" + reference, "charge.success", reference, "{}", h.Clock.UtcNow);
        h.Db.WebhookEvents.Add(e);
        await h.Db.SaveChangesAsync();

        var verification = new GatewayVerification(
            Succeeded: true, AmountMinor: tx.AmountMinor, Currency: tx.Currency, ProviderReference: "ps_" + reference,
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true);
        var result = await new ProcessWebhookEventCommandHandler(h.Db, new FakeGateway(verification), h.Clock, h.Email)
            .Handle(new ProcessWebhookEventCommand(e.Id), default);
        Assert.True(result.IsSuccess);
    }

    private static Task<Result<CheckoutSessionDto>> Checkout(TestHarness h, User user, string code)
        => new InitiateCheckoutCommandHandler(h.Db, new StubCurrentUser(user.Id), new FakeGateway(), h.Clock, new BillingSettings(), h.Email)
            .Handle(new InitiateCheckoutCommand(h.Db.Plans.Single(p => p.Code == code).Id), default);

    private static async Task<IReadOnlyList<PlanDto>> Plans(TestHarness h, User user, bool choir = false)
        => (await new GetPlansQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock).Handle(new GetPlansQuery(choir), default)).Value;

    private static Task<Result<ChoirDto>> Join(TestHarness h, User user, string code)
        => new JoinChoirCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, h.QuotaGate)
            .Handle(new JoinChoirCommand(code), default);

    private static async Task<ChoirDto> MyChoir(TestHarness h, User user)
        => (await new GetMyChoirQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock).Handle(new GetMyChoirQuery(), default)).Value;

    private static Task<Result> Share(TestHarness h, User user, Guid sheetId)
        => new ShareSheetWithChoirCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new ShareSheetWithChoirCommand(sheetId), default);

    private static Task<Result> Unshare(TestHarness h, User user, Guid sheetId)
        => new UnshareSheetFromChoirCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new UnshareSheetFromChoirCommand(sheetId), default);

    private static Task<Result<IReadOnlyList<ChoirSheetDto>>> ChoirSheets(TestHarness h, User user)
        => new GetChoirSheetsQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock).Handle(new GetChoirSheetsQuery(), default);

    private static Task<Result<NoteFusion.Application.Library.Dtos.SharedSheetDto>> ChoirSheet(TestHarness h, User user, Guid sheetId)
        => new GetChoirSheetQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock).Handle(new GetChoirSheetQuery(sheetId), default);

    private static async Task<SubscriptionDto> Shown(TestHarness h, User user)
        => (await new GetMySubscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null))
            .Handle(new GetMySubscriptionQuery(), default)).Value;

    private static Task<Result<string>> SubmitLink(TestHarness h, User user, FakeApi api)
        => new SubmitLinkTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.Activity(user.Id), h.QuotaGate)
            .Handle(new SubmitLinkTranscriptionCommand(Link, TranscriptionMode.Melody, null, null), default);

    private static Task<Result<string>> SubmitUpload(TestHarness h, User user, FakeApi api)
        => new SubmitTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.DeviceRegister,
                h.Activity(user.Id), h.QuotaGate)
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "song.m4a", TranscriptionMode.Melody, null, null), default);

    /// <summary>A gateway that opens every checkout and confirms every payment with the given answer.</summary>
    private sealed class FakeGateway : IPaymentGatewayFactory, IPaymentGateway
    {
        private readonly GatewayVerification? _answer;

        public FakeGateway(GatewayVerification? answer = null) => _answer = answer;

        public PaymentProvider Provider => PaymentProvider.Paystack;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["NGN", "USD"];
        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(new GatewayInitiation("https://checkout.paystack.com/s", "ps_1", "{}")));

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(_answer!));
    }

    /// <summary>Stands in for the worker; the status is the test's to set.</summary>
    private sealed class FakeApi : ITranscriptionApi
    {
        private int _next;

        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public TranscribeOptions? LastOptions { get; private set; }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
        {
            LastOptions = options;
            return Task.FromResult(Result<string>.Success($"job-{++_next}"));
        }

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, url, options, ct);

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
            => Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, 0.5, null, Status == TranscriptionStatus.Failed ? "Could not transcribe." : null)));

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => throw new NotSupportedException();

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
