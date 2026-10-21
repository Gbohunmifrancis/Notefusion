using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Application.Offers;
using NoteFusion.Application.Offers.Commands;
using NoteFusion.Application.Offers.Dtos;
using NoteFusion.Application.Offers.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Email;
using NoteFusion.Infrastructure.Outreach;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using static NoteFusion.Tests.Offers.OfferFixtures;

namespace NoteFusion.Tests.Offers;

/// <summary>
/// The console's Offers page: creating from a template, what may change and when, one offer at a time, who the email is
/// for and who never gets it, the postal address before Send, the preview and the test, and the progress.
/// </summary>
public class AdminOfferTests
{
    private static readonly DateTime Today = new(2026, 10, 21, 12, 0, 0, DateTimeKind.Utc);

    // ── Create and change ────────────────────────────────────────────────────

    [Fact]
    public async Task A_new_offer_takes_its_templates_defaults_starts_as_a_draft_and_is_audited()
    {
        using var h = new TestHarness(Today);
        AddPlans(h);
        var admin = AdminAccount(h);

        var created = await Create(h, admin, new CreateOfferCommand("halloween"));

        Assert.True(created.IsSuccess);
        var dto = created.Value;
        Assert.Equal(("halloween-2026", "Halloween 2026", "halloween", 30), (dto.Key, dto.Name, dto.Template, dto.PercentOff));
        Assert.Equal((true, true, false, "draft"), (dto.IncludesMonthly, dto.IncludesYearly, dto.Enabled, dto.State));
        Assert.Equal(new DateTime(2026, 10, 26, 9, 0, 0, DateTimeKind.Utc), dto.StartsAtUtc);
        Assert.Equal(new DateOnly(2026, 10, 31), dto.LastDay);
        Assert.Equal("{pct}% off Pro, until Halloween", dto.Words.Subject);
        Assert.False(dto.WordsLocked);
        Assert.Null(dto.Send);
        Assert.Equal("francis@notefusion.studio", dto.CreatedBy);
        Assert.Contains(dto.Plans, p => (p.Code, p.Interval, p.Set, p.AmountMinor, p.OfferAmountMinor) == ("pro_yearly_usd", "Yearly", "standard", 7_900, 5_500));
        Assert.Contains(dto.Plans, p => (p.Code, p.Set, p.OfferAmountMinor) == ("pro_monthly_usd_regional", "regional", 349));
        Assert.DoesNotContain(dto.Plans, p => p.Code is "pro_monthly_ngn" or "one_song_usd" or "choir_monthly_usd");

        var audit = h.Db.AdminAuditLogs.Single();
        Assert.Equal(AdminAuditAction.CreateOffer, audit.Action);
        Assert.Contains("Halloween 2026", audit.Summary);

        var christmas = (await Create(h, admin, new CreateOfferCommand("christmas"))).Value;
        Assert.Equal(("christmas-2026", new DateTime(2026, 12, 14, 9, 0, 0, DateTimeKind.Utc), new DateOnly(2026, 12, 26)),
            (christmas.Key, christmas.StartsAtUtc, christmas.LastDay));
        Assert.Equal("{pct}% off Pro for Christmas", christmas.Words.Subject);

        // A second Halloween the same year gets a key of its own.
        var again = (await Create(h, admin, new CreateOfferCommand("halloween"))).Value;
        Assert.Equal("halloween-2026-2", again.Key);
    }

    [Theory]
    [InlineData("easter", 30, true, true, "2026-10-31", "OFFER_TEMPLATE_UNKNOWN")]
    [InlineData("halloween", 4, true, true, "2026-10-31", "OFFER_PERCENT_OUT_OF_RANGE")]
    [InlineData("halloween", 71, true, true, "2026-10-31", "OFFER_PERCENT_OUT_OF_RANGE")]
    [InlineData("halloween", 30, false, false, "2026-10-31", "OFFER_NO_PLANS")]
    [InlineData("halloween", 30, true, true, "2026-10-25", "OFFER_DATES_INVALID")]
    [InlineData("halloween", 30, true, true, "2026-10-01", "OFFER_DATES_INVALID")]
    public async Task A_bad_offer_is_refused_with_what_to_fix(
        string template, int pct, bool monthly, bool yearly, string lastDay, string code)
    {
        using var h = new TestHarness(Today);
        var admin = AdminAccount(h);

        var refused = await Create(h, admin, new CreateOfferCommand(
            template, PercentOff: pct, IncludesMonthly: monthly, IncludesYearly: yearly, StartsAtUtc: Start, LastDay: DateOnly.Parse(lastDay)));

        Assert.Equal(code, refused.Error.Code);
        Assert.Empty(h.Db.Offers);
        Assert.Empty(h.Db.AdminAuditLogs);
    }

    [Fact]
    public async Task Words_that_are_empty_or_too_long_are_refused()
    {
        using var h = new TestHarness(Today);
        var admin = AdminAccount(h);
        var words = OfferTemplates.HalloweenTemplate.Words;

        Assert.Equal("OFFER_WORDS_INVALID", (await Create(h, admin, new CreateOfferCommand("halloween", Words: words with { Subject = " " }))).Error.Code);
        Assert.Equal("OFFER_WORDS_INVALID", (await Create(h, admin, new CreateOfferCommand("halloween", Words: words with { Body = new string('a', 1201) }))).Error.Code);
        Assert.True((await Create(h, admin, new CreateOfferCommand("halloween", Words: words with { Body = new string('a', 1200) }))).IsSuccess);
    }

    [Fact]
    public async Task One_enabled_offer_at_a_time_anywhere_in_the_world()
    {
        using var h = new TestHarness(Today);
        AddPlans(h);
        var admin = AdminAccount(h);
        var halloween = (await Create(h, admin, new CreateOfferCommand("halloween"))).Value;
        var christmas = (await Create(h, admin, new CreateOfferCommand("christmas"))).Value;
        // A week starting the morning after Halloween: still Halloween in Hawaii.
        var november = (await Create(h, admin, new CreateOfferCommand(
            "halloween", "November", StartsAtUtc: new DateTime(2026, 11, 1, 9, 0, 0, DateTimeKind.Utc), LastDay: new DateOnly(2026, 11, 7)))).Value;

        Assert.True((await Enable(h, admin, halloween.Id, true)).IsSuccess);
        Assert.True((await Enable(h, admin, christmas.Id, true)).IsSuccess);
        Assert.Equal("OFFER_OVERLAPS", (await Enable(h, admin, november.Id, true)).Error.Code);

        // Moving an enabled offer's dates over another's is refused too.
        var moved = await Update(h, admin, new UpdateOfferCommand(christmas.Id, StartsAtUtc: new DateTime(2026, 10, 30, 9, 0, 0, DateTimeKind.Utc)));
        Assert.Equal("OFFER_OVERLAPS", moved.Error.Code);
        Assert.Equal(new DateTime(2026, 12, 14, 9, 0, 0, DateTimeKind.Utc), h.Db.Offers.AsNoTracking().Single(o => o.Id == christmas.Id).StartsAtUtc);

        Assert.True((await Enable(h, admin, halloween.Id, false)).IsSuccess);
        Assert.True((await Enable(h, admin, november.Id, true)).IsSuccess);
        Assert.Contains(h.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.SetOfferEnabled && a.Summary.StartsWith("Switched the Halloween 2026 offer off"));
    }

    [Fact]
    public async Task Once_underway_only_a_later_last_day_may_change_and_the_words_lock_once_sent()
    {
        using var h = new TestHarness(Today);
        AddPlans(h);
        var admin = AdminAccount(h);
        var dto = (await Create(h, admin, new CreateOfferCommand("halloween"))).Value;

        // Before it starts anything may change.
        var changed = (await Update(h, admin, new UpdateOfferCommand(dto.Id, PercentOff: 25, Name: "Spooky week"))).Value;
        Assert.Equal((25, "Spooky week"), (changed.PercentOff, changed.Name));
        Assert.Contains(changed.Plans, p => (p.Code, p.OfferAmountMinor) == ("pro_monthly_usd", 749));
        Assert.Contains(h.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.UpdateOffer);

        await Enable(h, admin, dto.Id, true);
        h.Clock.UtcNow = Midweek;
        Assert.Equal("running", (await List(h)).Single().State);

        Assert.Equal("OFFER_STARTED", (await Update(h, admin, new UpdateOfferCommand(dto.Id, PercentOff: 40))).Error.Code);
        Assert.Equal("OFFER_STARTED", (await Update(h, admin, new UpdateOfferCommand(dto.Id, LastDay: new DateOnly(2026, 10, 30)))).Error.Code);
        Assert.Equal("OFFER_STARTED", (await Update(h, admin, new UpdateOfferCommand(dto.Id, Template: "christmas"))).Error.Code);
        var later = await Update(h, admin, new UpdateOfferCommand(dto.Id, LastDay: new DateOnly(2026, 11, 2)));
        Assert.Equal(new DateOnly(2026, 11, 2), later.Value.LastDay);
        Assert.Equal("halloween-2026", later.Value.Key);

        // Words still change until Send; then they are what was sent.
        var words = new OfferWords("Last call", "Pro for less", "Pro is {pct}% off", "Hurry.");
        Assert.Equal("Last call", (await Update(h, admin, new UpdateOfferCommand(dto.Id, Words: words))).Value.Words.Subject);
        Account(h, "grace@example.com");
        Assert.True((await Send(h, admin, dto.Id)).IsSuccess);
        Assert.Equal("OFFER_WORDS_LOCKED", (await Update(h, admin, new UpdateOfferCommand(dto.Id, Words: words with { Subject = "New" }))).Error.Code);
        Assert.True((await Update(h, admin, new UpdateOfferCommand(dto.Id, Words: words))).IsSuccess); // unchanged words are fine
    }

    [Fact]
    public async Task The_console_is_told_when_an_offer_is_hidden_because_its_season_is_off()
    {
        using var h = new TestHarness(Today);
        AddPlans(h);
        var admin = AdminAccount(h);
        var offer = (await Create(h, admin, new CreateOfferCommand("halloween"))).Value;
        Assert.False(offer.SeasonOn); // no Halloween season switched on yet

        Season(h, "halloween", on: true);
        Assert.True((await List(h)).Single().SeasonOn);
        Assert.True((await Enable(h, admin, offer.Id, true)).Value.SeasonOn);

        Season(h, "halloween", on: false);
        Assert.False((await List(h)).Single().SeasonOn);
    }

    [Fact]
    public async Task The_key_follows_the_template_until_anything_is_sent()
    {
        using var h = new TestHarness(Today);
        var admin = AdminAccount(h);
        var dto = (await Create(h, admin, new CreateOfferCommand("halloween"))).Value;

        var christmas = await Update(h, admin, new UpdateOfferCommand(
            dto.Id, Template: "christmas", StartsAtUtc: new DateTime(2026, 12, 14, 9, 0, 0, DateTimeKind.Utc), LastDay: new DateOnly(2026, 12, 26)));

        Assert.Equal(("christmas-2026", "christmas"), (christmas.Value.Key, christmas.Value.Template));
    }

    [Fact]
    public async Task The_templates_list_offers_each_seasons_defaults_for_the_year_ahead()
    {
        using var h = new TestHarness(new DateTime(2026, 11, 3, 12, 0, 0, DateTimeKind.Utc));
        var templates = (await Queries(h).Handle(new GetOfferTemplatesQuery(), default)).Value;

        var halloween = templates.Single(t => t.Template == "halloween");
        Assert.Equal(("Halloween 2027", "Halloween offer", new DateOnly(2027, 10, 31), 30), (halloween.Name, halloween.Label, halloween.LastDay, halloween.PercentOff));
        var christmas = templates.Single(t => t.Template == "christmas");
        Assert.Equal(("Christmas 2026", new DateOnly(2026, 12, 26)), (christmas.Name, christmas.LastDay));
        Assert.Equal("Pro is {pct}% off for Christmas", christmas.Words.Headline);
    }

    // ── Audience ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_audience_is_free_and_lapsed_dollar_accounts_and_says_who_is_left_out()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);                                         // free, GB: admins are not left out
        Account(h, "free@example.com", "US");                         // free
        Account(h, "kofi@example.com", "GH");                         // free, regional
        var lapsed = Account(h, "lapsed@example.com", "GB");          // lapsed
        Subscribe(h, lapsed, plans.Monthly, PaymentProvider.Bachs, Midweek.AddDays(-3));
        var member = Account(h, "member@example.com", "US");          // Pro now, web
        Subscribe(h, member, plans.Monthly, PaymentProvider.Bachs, Midweek.AddDays(9));
        Account(h, "ada@example.com", "NG");                          // naira
        Account(h, "nowhere@example.com", country: null);             // no country
        var off = Account(h, "off@example.com", "GB");                // email off
        h.Db.EmailOptOuts.Add(EmailOptOut.Create(off.Id, Midweek.AddDays(-20)));
        var play = Account(h, "play@example.com", "US");              // Google Play
        Subscribe(h, play, plans.Monthly, PaymentProvider.GooglePlay, Midweek.AddDays(9));
        var singer = Account(h, "singer@example.com", "GB");          // choir
        var director = Account(h, "director@example.com", "NG");
        var choir = Choir.Start(director.Id, "St Cecilia", "ABCD2345", plans.ChoirMonthly.Id, 25, PaymentProvider.Paystack, Midweek.AddDays(-5), Midweek.AddDays(25), Midweek.AddDays(-5));
        h.Db.Choirs.Add(choir);
        h.Db.ChoirMembers.Add(ChoirMember.Create(choir.Id, singer.Id, Midweek.AddDays(-4)));
        var noted = Account(h, "noted@example.com", "GB");           // a founder's note this week
        var note = OutreachMessage.Claim(noted.Id, OutreachSegment.TriedOnce, OutreachChannel.Email, Midweek.AddDays(-2));
        note.MarkSent(Midweek.AddDays(-2));
        h.Db.OutreachMessages.Add(note);
        Account(h, "unverified@example.com", "GB", verified: false);  // never counted
        var gone = Account(h, "suspended@example.com", "GB");         // never counted
        gone.Suspend();
        h.Db.SaveChanges();

        var audience = (await Queries(h).Handle(new GetOfferAudienceQuery(offer.Id), default)).Value;

        Assert.Equal(new OfferAudienceGroupsDto(Free: 3, Lapsed: 1, ProNow: 1), audience.Groups);
        Assert.Equal(4, audience.Total);
        Assert.Equal(new OfferAudienceSetsDto(Standard: 3, Regional: 1), audience.BySet);
        // The director is on naira prices; the singer is Pro through the choir.
        Assert.Equal(new OfferAudienceExcludedDto(Naira: 2, NoCountry: 1, EmailOff: 1, StoreOrChoir: 2, RecentNote: 1), audience.Excluded);

        var withMembers = (await Queries(h).Handle(new GetOfferAudienceQuery(offer.Id, Free: false, Lapsed: false, ProNow: true), default)).Value;
        Assert.Equal(1, withMembers.Total);
    }

    [Fact]
    public async Task The_quota_says_how_many_a_day_and_how_many_before_the_end()
    {
        using var h = new TestHarness(Start.AddHours(1));
        AddPlans(h);
        var offer = AddOffer(h);
        for (var i = 0; i < 5; i++)
            Account(h, $"free{i}@example.com", "US");
        h.Db.EmailSends.AddRange(Enumerable.Range(0, 3).Select(_ => EmailSend.Record(EmailKind.Verification, Start.AddHours(-2))));
        h.Db.EmailSends.AddRange(Enumerable.Range(0, 211).Select(_ => EmailSend.Record(EmailKind.Receipt, Start.AddDays(-10))));
        h.Db.SaveChanges();

        // A daily cap of 5 stops optional mail at 3, and 3 went in the last day: no room today.
        var quota = new EmailQuotaSettings { DailyLimit = 5, MonthlyLimit = 3_000 };
        var audience = (await Queries(h, quota: quota).Handle(new GetOfferAudienceQuery(offer.Id), default)).Value;

        Assert.Equal(new OfferQuotaDto(DailyUsed: 3, DailyLimit: 5, DailyOptionalLine: 3, MonthlyUsed: 214, MonthlyLimit: 3_000,
            MonthlyOptionalLine: 1_800, RoomToday: 0, PerDay: 0), audience.Quota);
        Assert.Null(audience.Estimate.Days);
        Assert.Equal(0, audience.Estimate.ReachedBeforeEnd);

        var roomy = (await Queries(h, quota: new EmailQuotaSettings { DailyLimit = 10, MonthlyLimit = 3_000 })
            .Handle(new GetOfferAudienceQuery(offer.Id), default)).Value;
        Assert.Equal((3, 3), (roomy.Quota.RoomToday, roomy.Quota.PerDay));
        Assert.Equal(new OfferEstimateDto(Days: 2, ReachedBeforeEnd: 5), roomy.Estimate);

        var monthBound = (await Queries(h, quota: new EmailQuotaSettings { DailyLimit = 100, MonthlyLimit = 360 })
            .Handle(new GetOfferAudienceQuery(offer.Id), default)).Value;
        Assert.Equal(2, monthBound.Estimate.ReachedBeforeEnd); // 216 is the month's line, 214 already sent

        // The offer's own sends use up today's room but not the pace of a full day.
        h.Db.EmailSends.AddRange(Enumerable.Range(0, 2).Select(_ => EmailSend.Record(EmailKind.Offer, Start)));
        h.Db.SaveChanges();
        var sending = (await Queries(h, quota: new EmailQuotaSettings { DailyLimit = 10, MonthlyLimit = 3_000 })
            .Handle(new GetOfferAudienceQuery(offer.Id), default)).Value;
        Assert.Equal((5, 1, 3), (sending.Quota.DailyUsed, sending.Quota.RoomToday, sending.Quota.PerDay));

        var uncapped = (await Queries(h, quota: new EmailQuotaSettings { DailyLimit = null, MonthlyLimit = null })
            .Handle(new GetOfferAudienceQuery(offer.Id), default)).Value;
        Assert.Equal((null, null, null, null), (uncapped.Quota.DailyLimit, uncapped.Quota.DailyOptionalLine, uncapped.Quota.MonthlyLimit, uncapped.Quota.MonthlyOptionalLine));
        Assert.Equal((5, 5), (uncapped.Quota.RoomToday, uncapped.Quota.PerDay));
        Assert.Equal(new OfferEstimateDto(Days: 1, ReachedBeforeEnd: 5), uncapped.Estimate);
    }

    // ── Send ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Send_queues_each_person_once_with_their_own_token_and_locks_the_words()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        var free = Account(h, "free@example.com", "US");
        var lapsed = Account(h, "lapsed@example.com", "GB");
        Subscribe(h, lapsed, plans.Monthly, PaymentProvider.Bachs, Midweek.AddDays(-3));
        var member = Account(h, "member@example.com", "US");
        Subscribe(h, member, plans.Monthly, PaymentProvider.Bachs, Midweek.AddDays(9));

        var sent = await Send(h, admin, offer.Id);

        Assert.True(sent.IsSuccess);
        Assert.True(sent.Value.WordsLocked);
        Assert.Equal(new AdminOfferSendDto(Midweek, false, true, true, false), sent.Value.Send);
        var rows = h.Db.OfferEmails.AsNoTracking().ToList();
        Assert.Equal(
            new[] { (admin.Id, OfferEmailGroup.Free), (free.Id, OfferEmailGroup.Free), (lapsed.Id, OfferEmailGroup.Lapsed) }.OrderBy(r => r.Item1),
            rows.Select(r => (r.UserId, r.Group)).OrderBy(r => r.UserId));
        Assert.All(rows, r =>
        {
            Assert.Equal(OfferEmailStatus.Queued, r.Status);
            Assert.True(r.Token.Length >= 22);
        });
        Assert.Equal(rows.Count, rows.Select(r => r.Token).Distinct().Count());
        var audit = h.Db.AdminAuditLogs.Single(a => a.Action == AdminAuditAction.SendOffer);
        Assert.Equal("Sent the Halloween 2026 offer email to 3 people (free accounts and lapsed Pro).", audit.Summary);

        Assert.Equal("OFFER_ALREADY_SENT", (await Send(h, admin, offer.Id)).Error.Code);
    }

    [Fact]
    public async Task Send_is_refused_without_the_postal_address_while_off_once_ended_or_for_nobody()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);

        var noAddress = await Send(h, admin, offer.Id, settings: Settings(postal: ""));
        Assert.Equal("OFFER_POSTAL_ADDRESS_MISSING", noAddress.Error.Code);
        Assert.Contains("Email__PostalAddress", noAddress.Error.Message);
        Assert.False((await List(h, Settings(postal: " "))).Single().PostalAddressSet);
        Assert.True((await List(h)).Single().PostalAddressSet);

        Assert.Equal("OFFER_NO_AUDIENCE", (await Send(h, admin, offer.Id, free: false, lapsed: false)).Error.Code);
        Assert.Equal("OFFER_NO_AUDIENCE", (await Send(h, admin, offer.Id, free: false, lapsed: true)).Error.Code);

        await Enable(h, admin, offer.Id, false);
        Assert.Equal("OFFER_NOT_ENABLED", (await Send(h, admin, offer.Id)).Error.Code);

        await Enable(h, admin, offer.Id, true);
        h.Clock.UtcNow = offer.LatestEndUtc;
        Assert.Equal("OFFER_ENDED", (await Send(h, admin, offer.Id)).Error.Code);
        Assert.True((await Enable(h, admin, offer.Id, false)).IsSuccess);
        Assert.Equal("OFFER_ENDED", (await Enable(h, admin, offer.Id, true)).Error.Code);
        Assert.Empty(h.Db.OfferEmails);
    }

    [Fact]
    public async Task Sending_can_be_paused_and_resumed_once_sent()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);
        var pause = new SetOfferSendingCommandHandler(h.Db, h.AuditAs(admin), h.Clock, Settings());

        Assert.Equal("OFFER_NOT_SENT", (await pause.Handle(new SetOfferSendingCommand(offer.Id, true), default)).Error.Code);
        await Send(h, admin, offer.Id);
        Assert.True((await pause.Handle(new SetOfferSendingCommand(offer.Id, true), default)).Value.Send!.Paused);
        Assert.False((await pause.Handle(new SetOfferSendingCommand(offer.Id, false), default)).Value.Send!.Paused);
        Assert.Equal(2, h.Db.AdminAuditLogs.Count(a => a.Action == AdminAuditAction.SetOfferSending));
    }

    // ── Preview and test ─────────────────────────────────────────────────────

    [Fact]
    public async Task The_preview_is_the_senders_rendering_with_every_outside_value_encoded()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        offer.SetWords("<b>{pct}% off</b>", "Pre <i>", "Pro is {pct}% off <script>", "Hi <img src=x onerror=alert(1)>\n\nFor the rest of October, Pro is {pct}% off.", Midweek);
        h.Db.SaveChanges();

        var preview = (await Queries(h, postal: "").Handle(new PreviewOfferEmailQuery(offer.Id, "regional", "<Grace>"), default)).Value;

        Assert.Equal("<b>30% off</b>", preview.Subject);
        Assert.DoesNotContain("<script>", preview.Html);
        Assert.DoesNotContain("<img src=x", preview.Html);
        Assert.DoesNotContain("<Grace>", preview.Html);
        Assert.Contains("Hello &lt;Grace&gt;,", preview.Html);
        Assert.Contains("Pro is 30% off &lt;script&gt;", preview.Html);
        Assert.Contains("$4.99", preview.Html);
        Assert.Contains("$3.49", preview.Html);
        Assert.Contains("$27.99", preview.Html);
        Assert.Contains("[the company&#39;s postal address]", preview.Html);
        // The preview's unsubscribe link is the page with no token: clicking it unsubscribes nobody.
        Assert.Contains("href=\"https://api.notefusion.studio/api/email/unsubscribe\"", preview.Html);
        Assert.Contains("https://notefusion.studio/app?offer=halloween-2026\"", preview.Html);

        Assert.Equal("OFFER_SET_UNKNOWN", (await Queries(h).Handle(new PreviewOfferEmailQuery(offer.Id, "naira"), default)).Error.Code);
        Assert.Equal("OFFER_NOT_FOUND", (await Queries(h).Handle(new PreviewOfferEmailQuery(Guid.NewGuid()), default)).Error.Code);
    }

    [Fact]
    public async Task A_test_goes_to_the_signed_in_admin_always_and_is_audited()
    {
        using var h = new TestHarness(Midweek);
        AddPlans(h);
        var offer = AddOffer(h);
        var admin = AdminAccount(h);

        var test = await new SendOfferTestCommandHandler(
                h.Db, new StubCurrentUser(admin.Id, UserRole.Admin, admin.Email), h.Email, new HmacEmailUnsubscribeTokens(h.Keys),
                h.AuditAs(admin), Settings(postal: ""))
            .Handle(new SendOfferTestCommand(offer.Id, "regional"), default);

        Assert.Equal(new OfferTestDto("francis@notefusion.studio", "regional"), test.Value);
        var (to, email, isTest) = Assert.Single(h.Email.Offers);
        Assert.True(isTest);
        Assert.Equal("francis@notefusion.studio", to.Email);
        Assert.Equal(new long[] { 349, 2_799 }, email.Prices.Select(p => p.OfferAmountMinor));
        Assert.Equal("https://notefusion.studio/app?offer=halloween-2026", email.OfferUrl);
        Assert.Contains(h.Db.AdminAuditLogs, a => a.Action == AdminAuditAction.SendOfferTest);
    }

    // ── Progress ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Progress_counts_the_queue_the_opens_the_clicks_and_what_the_offer_sold()
    {
        using var h = new TestHarness(Midweek);
        var plans = AddPlans(h);
        var offer = AddOffer(h);
        var grace = Account(h, "grace@example.com");
        var kofi = Account(h, "kofi@example.com", "GH");
        var walkIn = Account(h, "walkin@example.com", "US");
        var off = Account(h, "off@example.com");

        var sent = OfferEmail.Queue(offer.Id, grace.Id, OfferEmailGroup.Free, "grace-token-abcdefghijkl", Start);
        sent.MarkSent(Start.AddHours(1));
        var clicked = OfferEmail.Queue(offer.Id, kofi.Id, OfferEmailGroup.Lapsed, "kofi-token-abcdefghijklm", Start);
        clicked.MarkSent(Start.AddHours(2));
        var skipped = OfferEmail.Queue(offer.Id, off.Id, OfferEmailGroup.Free, OfferTokens.New(), Start);
        skipped.Skip(OfferSkipReason.OptedOut);
        var queued = OfferEmail.Queue(offer.Id, walkIn.Id, OfferEmailGroup.Free, OfferTokens.New(), Start);
        h.Db.OfferEmails.AddRange(sent, clicked, skipped, queued);
        h.Db.SaveChanges();
        await new RecordOfferClickCommandHandler(h.Db, new FixedClock(Start.AddDays(1).AddHours(3))).Handle(new RecordOfferClickCommand("kofi-token-abcdefghijklm"), default);
        // Grace's image loads twice (Apple Mail on delivery, then her own read): one open, on the first day. Kofi's
        // images were blocked, so his click is his open.
        await new RecordOfferOpenCommandHandler(h.Db, new FixedClock(Start.AddHours(2))).Handle(new RecordOfferOpenCommand("grace-token-abcdefghijkl"), default);
        await new RecordOfferOpenCommandHandler(h.Db, new FixedClock(Start.AddDays(1))).Handle(new RecordOfferOpenCommand("grace-token-abcdefghijkl"), default);
        await new RecordOfferOpenCommandHandler(h.Db, new FixedClock(Start.AddHours(2))).Handle(new RecordOfferOpenCommand("no-such-token-abcdefgh"), default);

        Payment(h, kofi, plans.RegionalYearly, 2_799, offer.Id, Start.AddDays(1).AddHours(4));            // from the email
        Payment(h, walkIn, plans.Yearly, 5_500, offer.Id, Start.AddDays(1).AddHours(5));                  // the banner
        Payment(h, grace, plans.Monthly, 699, offer.Id, Start.AddDays(1).AddHours(6), completed: false);  // still open
        Payment(h, grace, plans.Monthly, 999, null, Start.AddDays(1).AddHours(7));                       // the usual price

        var progress = (await Queries(h).Handle(new GetOfferProgressQuery(offer.Id), default)).Value;

        Assert.Equal((1, 2, 0, 1, 2), (progress.Queued, progress.Sent, progress.Failed, progress.Clicked, progress.Opened));
        Assert.Equal(new OfferSkippedDto(1, 0, 0, 0, 0), progress.Skipped);
        Assert.Equal((2, 1, 3, 8_299L), (progress.Bought, progress.BoughtFromEmail, progress.Checkouts, progress.RevenueMinor));
        Assert.Equal(
            new[] { new OfferDayDto(new DateOnly(2026, 10, 26), 2, 0, 0, 1), new OfferDayDto(new DateOnly(2026, 10, 27), 0, 1, 2, 1), new OfferDayDto(new DateOnly(2026, 10, 28), 0, 0, 0, 0) },
            progress.ByDay);
        Assert.Equal(
            new[] { new OfferPlanSalesDto("pro_yearly_usd", "Pro Yearly", "standard", 1, 5_500), new OfferPlanSalesDto("pro_yearly_usd_regional", "Pro Yearly, regional", "regional", 1, 2_799) },
            progress.ByPlan);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static StubCurrentUser Caller(User admin) => new(admin.Id, UserRole.Admin, admin.Email, admin.FullName);

    private static Task<Result<AdminOfferDto>> Create(TestHarness h, User admin, CreateOfferCommand command)
        => new CreateOfferCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock, Settings()).Handle(command, default);

    private static Task<Result<AdminOfferDto>> Update(TestHarness h, User admin, UpdateOfferCommand command)
        => new UpdateOfferCommandHandler(h.Db, h.AuditAs(admin), h.Clock, Settings()).Handle(command, default);

    private static Task<Result<AdminOfferDto>> Enable(TestHarness h, User admin, Guid id, bool enabled)
        => new SetOfferEnabledCommandHandler(h.Db, h.AuditAs(admin), h.Clock, Settings())
            .Handle(new SetOfferEnabledCommand(id, enabled), default);

    private static Task<Result<AdminOfferDto>> Send(
        TestHarness h, User admin, Guid id, bool free = true, bool lapsed = true, bool proNow = false, OfferSettings? settings = null)
        => new SendOfferCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock, settings ?? Settings())
            .Handle(new SendOfferCommand(id, free, lapsed, proNow), default);

    private static async Task<IReadOnlyList<AdminOfferDto>> List(TestHarness h, OfferSettings? settings = null)
        => (await Queries(h, settings: settings).Handle(new GetAdminOffersQuery(), default)).Value;

    private static AdminOfferQueryHandlers Queries(
        TestHarness h, OfferSettings? settings = null, string postal = PostalAddress, EmailQuotaSettings? quota = null)
        => new(h.Db, h.Clock, settings ?? Settings(postal),
            new OfferEmailRenderer(new BrandedEmailTemplate(new EmailSettings { PostalAddress = postal })),
            quota ?? new EmailQuotaSettings());
}
