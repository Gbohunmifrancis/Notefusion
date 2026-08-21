using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// Granting, revoking, extending and ending subscriptions from the admin console.
///
/// The rule the whole file exists to protect is that <em>a gift is not revenue</em>. It attaches a real
/// plan with a real price, and none of that price may reach the ledger — otherwise the first comped
/// launch partner quietly becomes ₦7,500 of reported income. The other half is that the gift controls
/// must not be able to reach a paying customer: "take the gift back" and "cut this account off" sit one
/// click apart in the console, and only the second is allowed to touch money someone actually paid.
/// </summary>
public class SubscriptionOperationsTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 10, 0, 0, DateTimeKind.Utc);

    // ------------------------------------------------------------------ granting

    [Fact]
    public async Task Gifting_a_month_unlocks_pro_without_recording_any_money()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        var result = await Gift(h, admin, target.Id, BillingInterval.Monthly);

        Assert.True(result.IsSuccess);

        var sub = Assert.Single(h.Db.Subscriptions.ToList());
        Assert.True(sub.IsActiveAt(Now));
        Assert.True(sub.IsGift);
        Assert.Null(sub.Provider);
        Assert.Equal(Now.AddMonths(1), sub.CurrentPeriodEndUtc);

        // The point of the whole design. A gift that wrote either of these would be counted as income by
        // every report that sums the ledger, and the first comped partner would show up as revenue.
        Assert.Empty(h.Db.PaymentTransactions.ToList());
        Assert.Empty(h.Db.LedgerEntries.ToList());
    }

    [Fact]
    public async Task Gifting_lifetime_never_expires_and_carries_no_renewal_date()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        await Gift(h, admin, target.Id, BillingInterval.Lifetime);

        var sub = Assert.Single(h.Db.Subscriptions.ToList());
        Assert.True(sub.IsLifetime);
        Assert.True(sub.IsActiveAt(Now.AddYears(40)));

        // The console must not print "renews 31 December 9999" at the account it was most generous to.
        var detail = await Detail(h, target.Id);
        Assert.Null(detail.Subscription!.CurrentPeriodEndUtc);
        Assert.True(detail.Subscription.IsLifetime);
    }

    [Fact]
    public async Task A_gift_names_the_plan_and_the_window_it_bought_in_the_trail()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        h.ClientIp.Current = "102.89.23.7";

        await Gift(h, admin, target.Id, BillingInterval.Yearly, note: "Launch partner, ticket 4210.");

        var entry = Assert.Single(h.Db.AdminAuditLogs.ToList());
        Assert.Equal(AdminAuditAction.GiftPro, entry.Action);
        Assert.Equal(admin.Id, entry.ActorUserId);
        Assert.Equal(target.Id, entry.TargetUserId);
        Assert.Equal("102.89.23.7", entry.IpAddress);
        Assert.Contains("2027-08-20", entry.Summary);
        Assert.Contains("No payment was taken", entry.Summary);
        Assert.Equal("Launch partner, ticket 4210.", entry.Note);
    }

    [Fact]
    public async Task Gifting_an_account_that_already_has_pro_is_refused_rather_than_layered()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        var sub = Paid(h, target, endsIn: TimeSpan.FromDays(20));

        var result = await Gift(h, admin, target.Id, BillingInterval.Monthly);

        // One row per user, so a second grant would overwrite the period they bought — replacing 20 paid
        // days with 30 gifted ones is a change nobody asked for. Extending is the action that adds time.
        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_ALREADY_SUBSCRIBED", result.Error.Code);
        Assert.Equal(PaymentProvider.Paystack, sub.Provider);
        Assert.Equal(Now.AddDays(20), sub.CurrentPeriodEndUtc);
    }

    [Fact]
    public async Task Gifting_an_account_whose_subscription_lapsed_reuses_the_row_it_already_has()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        Paid(h, target, endsIn: TimeSpan.FromDays(-5), status: s => s.Expire(Now.AddDays(-5)));

        var result = await Gift(h, admin, target.Id, BillingInterval.Monthly);

        // A unique index on UserId means inserting a second row would throw. The lapsed one is re-pointed.
        Assert.True(result.IsSuccess);
        var only = Assert.Single(h.Db.Subscriptions.ToList());
        Assert.True(only.IsGift);
        Assert.True(only.IsActiveAt(Now));

        // And the gateway token from the old paid period goes with it — a recurring reference on a row no
        // gateway is involved in any more is a token pointing at nothing.
        Assert.Null(only.ProviderSubscriptionRef);
    }

    [Fact]
    public async Task A_gift_survives_the_database_round_trip_as_a_gift()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        await Gift(h, admin, target.Id, BillingInterval.Monthly);

        // The provider column was NOT NULL until this feature. Read back through a fresh query rather than
        // off the tracked instance, so this actually exercises the nullable mapping.
        var stored = await h.Db.Subscriptions.AsNoTracking().SingleAsync(s => s.UserId == target.Id);
        Assert.Null(stored.Provider);
        Assert.True(stored.IsGift);
    }

    // ------------------------------------------------------------------ revoking

    [Fact]
    public async Task Revoking_a_gift_cuts_access_off_immediately()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Gift(h, admin, target.Id, BillingInterval.Yearly);
        h.Clock.UtcNow = Now.AddDays(3);

        var result = await Revoke(h, admin, target.Id);

        Assert.True(result.IsSuccess);
        var sub = Assert.Single(h.Db.Subscriptions.ToList());
        Assert.False(sub.IsActiveAt(h.Clock.UtcNow));
        Assert.Equal(SubscriptionStatus.Expired, sub.Status);

        // Both fields move together: Expired with a period end eleven months out is a row that says two
        // different things, and IsActiveAt reads them both.
        Assert.Equal(h.Clock.UtcNow, sub.CurrentPeriodEndUtc);
    }

    [Fact]
    public async Task Revoking_refuses_a_subscription_somebody_paid_for()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        var sub = Paid(h, target, endsIn: TimeSpan.FromDays(20));

        var result = await Revoke(h, admin, target.Id);

        // The guard that matters most in this file: the button labelled "take the gift back" must not be
        // able to cut off a customer who paid, however hard it is clicked.
        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_PAID_SUBSCRIPTION_NOT_REVOCABLE", result.Error.Code);
        Assert.True(sub.IsActiveAt(Now));
        Assert.Empty(h.Db.AdminAuditLogs.ToList());
    }

    [Fact]
    public async Task Revoking_a_gift_that_already_ended_succeeds_without_a_second_trail_entry()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Gift(h, admin, target.Id, BillingInterval.Monthly);

        await Revoke(h, admin, target.Id);
        var second = await Revoke(h, admin, target.Id);

        Assert.True(second.IsSuccess);
        Assert.Single(h.Db.AdminAuditLogs.Where(a => a.Action == AdminAuditAction.RevokePro).ToList());
    }

    [Fact]
    public async Task Revoking_when_there_was_never_a_subscription_is_a_not_found()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);

        var result = await Revoke(h, admin, target.Id);

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_NO_SUBSCRIPTION", result.Error.Code);
    }

    [Fact]
    public async Task A_comped_account_that_later_pays_stops_being_a_gift()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Gift(h, admin, target.Id, BillingInterval.Monthly);

        // What fulfilment does when the money actually arrives.
        var sub = h.Db.Subscriptions.Single(s => s.UserId == target.Id);
        sub.Renew(Now, Now.AddMonths(1), Now);
        sub.AttachPayment(PaymentProvider.Paystack, "prov-sub-9", Now);
        await h.Db.SaveChangesAsync();

        Assert.False(sub.IsGift);

        // Otherwise the gift button would still be live against a paying customer, and the dashboard would
        // keep calling their subscription a comp.
        var result = await Revoke(h, admin, target.Id);
        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_PAID_SUBSCRIPTION_NOT_REVOCABLE", result.Error.Code);
    }

    // ------------------------------------------------------------------ extending

    [Fact]
    public async Task Extending_moves_the_end_date_out_and_charges_nothing()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        Paid(h, target, endsIn: TimeSpan.FromDays(5));
        var newEnd = Now.AddDays(45);

        var result = await Extend(h, admin, target.Id, newEnd, note: "Outage on the 18th, ticket 4211.");

        Assert.True(result.IsSuccess);
        var sub = Assert.Single(h.Db.Subscriptions.ToList());
        Assert.Equal(newEnd, sub.CurrentPeriodEndUtc);
        Assert.True(sub.IsActiveAt(Now.AddDays(44)));
        Assert.Empty(h.Db.LedgerEntries.ToList());

        var entry = Assert.Single(h.Db.AdminAuditLogs.ToList());
        Assert.Contains("2026-08-25", entry.Summary);
        Assert.Contains("2026-10-04", entry.Summary);
        Assert.Contains("Nothing was charged", entry.Summary);
    }

    [Fact]
    public async Task Extending_a_lapsed_subscription_brings_it_back()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        Paid(h, target, endsIn: TimeSpan.FromDays(-3), status: s => s.Expire(Now.AddDays(-3)));

        var result = await Extend(h, admin, target.Id, Now.AddDays(30));

        // Moving the date alone would leave the status Expired, so IsActiveAt stays false and the operator
        // has reported an extension the user cannot use.
        Assert.True(result.IsSuccess);
        var sub = Assert.Single(h.Db.Subscriptions.ToList());
        Assert.Equal(SubscriptionStatus.Active, sub.Status);
        Assert.True(sub.IsActiveAt(Now));
    }

    [Fact]
    public async Task Extending_a_cancelled_subscription_leaves_it_cancelled()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        var sub = Paid(h, target, endsIn: TimeSpan.FromDays(5), status: s => s.Cancel(Now.AddDays(-1)));

        await Extend(h, admin, target.Id, Now.AddDays(40));

        // The customer said they do not want it to continue. They keep the longer period — cancelled still
        // means usable to the end — but re-arming the subscription on their behalf is not ours to do.
        Assert.Equal(SubscriptionStatus.Canceled, sub.Status);
        Assert.True(sub.IsActiveAt(Now.AddDays(39)));
    }

    [Fact]
    public async Task Extending_backwards_is_refused()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        var sub = Paid(h, target, endsIn: TimeSpan.FromDays(20));

        var result = await Extend(h, admin, target.Id, Now.AddDays(10));

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_EXTENSION_NOT_FORWARD", result.Error.Code);
        Assert.Equal(Now.AddDays(20), sub.CurrentPeriodEndUtc);
    }

    [Fact]
    public async Task Extending_a_lapsed_subscription_to_a_date_still_in_the_past_is_refused()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        Paid(h, target, endsIn: TimeSpan.FromDays(-30), status: s => s.Expire(Now.AddDays(-30)));

        // Forward of the old end, but still behind today. Allowed, it would flip the status to Active and
        // grant nothing — the console would report an extension that unlocks nothing at all.
        var result = await Extend(h, admin, target.Id, Now.AddDays(-2));

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_EXTENSION_NOT_FORWARD", result.Error.Code);
    }

    [Fact]
    public async Task Extending_lifetime_access_is_refused_as_meaningless()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Gift(h, admin, target.Id, BillingInterval.Lifetime);

        var result = await Extend(h, admin, target.Id, Now.AddYears(5));

        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_LIFETIME_NOT_EXTENDABLE", result.Error.Code);
    }

    [Fact]
    public async Task Extending_as_far_as_the_lifetime_sentinel_is_refused()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        Paid(h, target, endsIn: TimeSpan.FromDays(5));

        var result = await Extend(h, admin, target.Id, Subscription.LifetimeEndUtc);

        // Lifetime access should only ever be granted by granting the lifetime plan, where the console
        // shows it as such and the trail says so.
        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_EXTENSION_TOO_FAR", result.Error.Code);
    }

    [Fact]
    public async Task A_date_only_extension_lands_at_midnight_utc()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        Paid(h, target, endsIn: TimeSpan.FromDays(5));

        // What a bare "2026-09-30" from the wire deserialises to: Unspecified kind, which Npgsql rejects
        // outright for a timestamptz column.
        var unspecified = new DateTime(2026, 9, 30, 0, 0, 0, DateTimeKind.Unspecified);
        var result = await Extend(h, admin, target.Id, unspecified);

        Assert.True(result.IsSuccess);
        var sub = Assert.Single(h.Db.Subscriptions.ToList());
        Assert.Equal(new DateTime(2026, 9, 30, 0, 0, 0, DateTimeKind.Utc), sub.CurrentPeriodEndUtc);
    }

    // ------------------------------------------------------------------ ending

    [Fact]
    public async Task Ending_a_paid_subscription_stops_access_and_records_what_was_forfeited()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        var sub = Paid(h, target, endsIn: TimeSpan.FromDays(12));

        var result = await End(h, admin, target.Id, note: "Chargeback, ticket 4212.");

        Assert.True(result.IsSuccess);
        Assert.False(sub.IsActiveAt(Now));

        // The forfeited remainder is the number a refund conversation starts from, and this command
        // deliberately does not act on it — so it has to be in the record.
        var entry = Assert.Single(h.Db.AdminAuditLogs.ToList());
        Assert.Equal(AdminAuditAction.EndSubscription, entry.Action);
        Assert.Contains("paid", entry.Summary);
        Assert.Contains("12 day(s)", entry.Summary);
        Assert.Contains("No refund was issued", entry.Summary);
        Assert.Equal("Chargeback, ticket 4212.", entry.Note);
    }

    [Fact]
    public async Task Ending_a_gift_works_too_and_says_it_was_a_gift()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Gift(h, admin, target.Id, BillingInterval.Monthly);

        var result = await End(h, admin, target.Id);

        Assert.True(result.IsSuccess);
        var entry = Assert.Single(h.Db.AdminAuditLogs.Where(a => a.Action == AdminAuditAction.EndSubscription).ToList());
        Assert.Contains("gifted", entry.Summary);
    }

    [Fact]
    public async Task Ending_lifetime_access_names_what_it_takes_away()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Gift(h, admin, target.Id, BillingInterval.Lifetime);

        await End(h, admin, target.Id);

        // A day count off the sentinel would read "2,857,153 day(s)", which is not a sentence anyone can act on.
        var entry = Assert.Single(h.Db.AdminAuditLogs.Where(a => a.Action == AdminAuditAction.EndSubscription).ToList());
        Assert.Contains("lifetime access", entry.Summary);
    }

    [Fact]
    public async Task Ending_an_already_ended_subscription_writes_nothing_new()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        Paid(h, target, endsIn: TimeSpan.FromDays(-1));

        var result = await End(h, admin, target.Id);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Db.AdminAuditLogs.ToList());
    }

    // ------------------------------------------------------- separation of duties

    [Fact]
    public async Task An_administrator_cannot_gift_pro_to_their_own_account()
    {
        using var h = new TestHarness(Now);
        var (admin, _) = Seed(h);

        var result = await Gift(h, admin, admin.Id, BillingInterval.Lifetime);

        // The account holding the button that hands out the paid product cannot point it at itself. Refused
        // before the plan is even looked up, so there is no half-made grant to find later.
        Assert.True(result.IsFailure);
        Assert.Equal("ADMIN_CANNOT_BILL_SELF", result.Error.Code);
        Assert.Empty(h.Db.Subscriptions.ToList());
        Assert.Empty(h.Db.AdminAuditLogs.ToList());
    }

    [Fact]
    public async Task The_refusal_covers_every_route_to_your_own_subscription()
    {
        using var h = new TestHarness(Now);
        var (admin, _) = Seed(h);
        Paid(h, admin, endsIn: TimeSpan.FromDays(20));

        // One of the four left open is the whole guard: revoke and end are how a grant gets tidied away
        // afterwards, and extend is granting by another name. An operator would simply use whichever one
        // still worked.
        foreach (var result in new[]
        {
            await Revoke(h, admin, admin.Id),
            await Extend(h, admin, admin.Id, Now.AddDays(60)),
            await End(h, admin, admin.Id),
        })
        {
            Assert.True(result.IsFailure);
            Assert.Equal("ADMIN_CANNOT_BILL_SELF", result.Error.Code);
        }

        Assert.True(h.Db.Subscriptions.Single(s => s.UserId == admin.Id).IsActiveAt(Now));
        Assert.Empty(h.Db.AdminAuditLogs.ToList());
    }

    [Fact]
    public async Task Comping_another_administrator_is_still_allowed()
    {
        using var h = new TestHarness(Now);
        var (admin, _) = Seed(h);
        var colleague = User.CreateAdmin(
            "Bo Boss", "bo@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-100));
        h.Db.Users.Add(colleague);
        await h.Db.SaveChangesAsync();

        var result = await Gift(h, admin, colleague.Id, BillingInterval.Monthly);

        // The guard is about acting alone, not about rank. Two administrators is two names in the trail,
        // which is the condition the refusal exists to force.
        Assert.True(result.IsSuccess);
        Assert.Equal(admin.Id, Assert.Single(h.Db.AdminAuditLogs.ToList()).ActorUserId);
    }

    // ------------------------------------------------------------------ the detail page

    [Fact]
    public async Task The_detail_page_reports_the_trial_the_paywall_actually_counts()
    {
        using var h = new TestHarness(Now);
        var (_, target) = Seed(h);

        // Three jobs, two of which spent a generation, and one saved transcription deleted since. The
        // paywall counts consumed jobs, so the console must count the same thing — a number taken from
        // saved transcriptions would hand the allowance back every time a user tidied up.
        foreach (var i in Enumerable.Range(0, 3))
        {
            var job = TranscriptionJob.Record($"job-{i}", target.Id, Now.AddDays(-i));
            if (i < 2) job.ConsumeTrial(Now.AddDays(-i));
            h.Db.TranscriptionJobs.Add(job);
        }
        await h.Db.SaveChangesAsync();

        var detail = await Detail(h, target.Id);

        Assert.Equal(2, detail.TrialGenerationsUsed);
        Assert.Equal(5, detail.TrialGenerationsTotal);
        Assert.Equal(0, detail.TranscriptionCount);
    }

    [Fact]
    public async Task The_detail_page_names_the_gift_and_the_plan_behind_it()
    {
        using var h = new TestHarness(Now);
        var (admin, target) = Seed(h);
        await Gift(h, admin, target.Id, BillingInterval.Yearly);

        var detail = await Detail(h, target.Id);

        Assert.Equal("pro_yearly_ngn", detail.Subscription!.PlanCode);
        Assert.Equal("NoteFusion Pro (Yearly)", detail.Subscription.PlanName);
        Assert.True(detail.Subscription.IsGift);
        Assert.Null(detail.Subscription.Provider);
        Assert.True(detail.Subscription.IsActive);
        Assert.Equal(Now.AddYears(1), detail.Subscription.CurrentPeriodEndUtc);

        // The actions taken on this account are on the page, so support does not have to cross-reference
        // the global trail to see why someone has Pro.
        Assert.Equal(AdminAuditAction.GiftPro.ToString(), Assert.Single(detail.RecentActions).Action);
    }

    [Fact]
    public async Task The_detail_page_carries_no_secret_material()
    {
        using var h = new TestHarness(Now);
        var (_, target) = Seed(h);

        var detail = await Detail(h, target.Id);

        // Pinned by shape rather than by value: the DTO has nowhere to put a hash, and a later "just add
        // the reset token so support can read it out" would have to change this signature to get there.
        var names = typeof(Application.Admin.Dtos.AdminUserDetailDto)
            .GetProperties().Select(p => p.Name).ToList();
        Assert.DoesNotContain("PasswordHash", names);
        Assert.DoesNotContain("PasswordResetTokenHash", names);
        Assert.DoesNotContain("GoogleId", names);

        // What it says instead: which sign-in routes exist, without the material behind them.
        Assert.True(detail.HasPassword);
        Assert.False(detail.HasGoogle);
    }

    [Fact]
    public async Task A_stale_lockout_is_not_reported_as_a_reason_they_cannot_sign_in()
    {
        using var h = new TestHarness(Now);
        var (_, target) = Seed(h);

        foreach (var _ in Enumerable.Range(0, User.MaxFailedLoginAttempts))
            target.RecordFailedLogin(Now.AddHours(-2));
        await h.Db.SaveChangesAsync();

        // Locked two hours ago, for thirty minutes. The column still holds the date; the account is fine.
        Assert.Null((await Detail(h, target.Id)).LockoutEndAt);

        h.Clock.UtcNow = Now.AddHours(-2).AddMinutes(10);
        Assert.NotNull((await Detail(h, target.Id)).LockoutEndAt);
    }

    [Fact]
    public async Task An_unknown_account_is_a_not_found()
    {
        using var h = new TestHarness(Now);

        var result = await new GetUserAccountQueryHandler(h.Db, h.Clock)
            .Handle(new GetUserAccountQuery(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("USER_NOT_FOUND", result.Error.Code);
    }

    // ---------------------------------------------------------------- fixtures

    private static (User Admin, User Target) Seed(TestHarness h)
    {
        var admin = User.CreateAdmin("Ada Admin", "ada@notefusion.studio", h.Hasher.Hash("password123"), Now.AddDays(-200));
        var target = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));

        h.Db.Users.Add(admin);
        h.Db.Users.Add(target);

        // The real seeded plans, with their real deterministic ids, because the gift handler looks them up
        // by code and a plan invented here would not be the one production attaches.
        h.Db.Plans.Add(Plan.Create(PlanId("pro_monthly_ngn"), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly));
        h.Db.Plans.Add(Plan.Create(PlanId("pro_yearly_ngn"), "pro_yearly_ngn", "NoteFusion Pro (Yearly)", 7_500_000, "NGN", BillingInterval.Yearly));
        h.Db.Plans.Add(Plan.Create(PlanId("pro_lifetime"), "pro_lifetime", "NoteFusion Pro (Lifetime)", 7_900, "USD", BillingInterval.Lifetime));
        h.Db.SaveChanges();

        return (admin, target);
    }

    private static Guid PlanId(string code)
    {
        using var md5 = System.Security.Cryptography.MD5.Create();
        return new Guid(md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"plan:{code}")));
    }

    /// <summary>A subscription a gateway paid for, which the gift controls must refuse to touch.</summary>
    private static Subscription Paid(
        TestHarness h, User user, TimeSpan endsIn, Action<Subscription>? status = null)
    {
        var sub = Subscription.Start(
            user.Id, PlanId("pro_monthly_ngn"), PaymentProvider.Paystack,
            Now - TimeSpan.FromDays(30) + endsIn, Now + endsIn, "prov-sub-1", Now.AddDays(-30));

        status?.Invoke(sub);
        h.Db.Subscriptions.Add(sub);
        h.Db.SaveChanges();
        return sub;
    }

    private static StubCurrentUser Caller(User admin)
        => new(admin.Id, admin.Role, admin.Email, admin.FullName);

    private static Task<Result> Gift(
        TestHarness h, User admin, Guid targetId, BillingInterval duration, string? note = null)
        => new GiftProCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock)
            .Handle(new GiftProCommand(targetId, duration, note), CancellationToken.None);

    private static Task<Result> Revoke(TestHarness h, User admin, Guid targetId, string? note = null)
        => new RevokeProCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock)
            .Handle(new RevokeProCommand(targetId, note), CancellationToken.None);

    private static Task<Result> Extend(
        TestHarness h, User admin, Guid targetId, DateTime newEnd, string? note = null)
        => new ExtendSubscriptionCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock)
            .Handle(new ExtendSubscriptionCommand(targetId, newEnd, note), CancellationToken.None);

    private static Task<Result> End(TestHarness h, User admin, Guid targetId, string? note = null)
        => new EndSubscriptionCommandHandler(h.Db, Caller(admin), h.AuditAs(admin), h.Clock)
            .Handle(new EndSubscriptionCommand(targetId, note), CancellationToken.None);

    private static async Task<Application.Admin.Dtos.AdminUserDetailDto> Detail(TestHarness h, Guid userId)
    {
        var result = await new GetUserAccountQueryHandler(h.Db, h.Clock)
            .Handle(new GetUserAccountQuery(userId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        return result.Value;
    }
}
