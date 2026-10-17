using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// The console's Growth page, against seeded rows: renewals rebuilt from the membership charges (early, late, lapsed,
/// still deciding) and memberships ending soon; free-to-paid by price set with the median time to pay; transcription
/// failures by kind and link problems by reason; phones by native build and reminder code; an empty window.
/// </summary>
public class GrowthAnalyticsTests
{
    // Wednesday 25 November 2026, midday UTC. The window is 1 to 24 November.
    private static readonly DateTime Now = new(2026, 11, 25, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime From = new(2026, 11, 1);
    private static readonly DateTime To = new(2026, 11, 24);

    private static DateTime Utc(int month, int day, int hour = 10) => new(2026, month, day, hour, 0, 0, DateTimeKind.Utc);

    private static async Task<GrowthDto> Read(TestHarness h, int latestBuild = 0)
    {
        var result = await new GetGrowthQueryHandler(h.Db, h.Clock, new AppReleaseSettings { LatestBuild = latestBuild })
            .Handle(new GetGrowthQuery(From, To), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    [Fact]
    public async Task An_empty_window_has_no_rates()
    {
        using var h = new TestHarness(Now);

        var g = await Read(h);

        Assert.Equal((0, 0, 0, null), (g.Renewals.DueInWindow, g.Renewals.EndingIn30Days, g.Renewals.Lapsed, g.Renewals.RenewalRate));
        Assert.Equal(["naira", "regional", "standard", "unknown"], g.FreeToPaid.Select(s => s.Set));
        Assert.All(g.FreeToPaid, s => Assert.Equal((0, null, null), (s.SignedUp, s.PaidRate, s.MedianDaysToPay)));
        Assert.All(g.Transcriptions.ByKind, k => Assert.Null(k.FailureRate));
        Assert.Empty(g.AppVersions.Builds);
    }

    [Fact]
    public async Task Renewals_are_rebuilt_from_the_charges_and_each_due_end_is_renewed_lapsed_or_still_deciding()
    {
        using var h = new TestHarness(Now);
        var monthly = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        var choirPlan = Plan.Create(Guid.NewGuid(), "choir_monthly_usd", "Choir (Monthly)", 2999, "USD", BillingInterval.Monthly, choirSeats: 25);
        var single = Plan.Create(Guid.NewGuid(), "single_usd", "One song", 199, "USD", BillingInterval.Single);
        h.Db.Plans.AddRange(monthly, choirPlan, single);

        var early = Seed(h, "early@example.com");       // due 5 Nov, paid again 3 Nov
        var late = Seed(h, "late@example.com");         // due 8 Nov, paid again 12 Nov (four days late)
        var lapsed = Seed(h, "lapsed@example.com");     // due 10 Nov, never again (17 Nov passed)
        var deciding = Seed(h, "deciding@example.com"); // due 20 Nov, 27 Nov not reached
        var tooLate = Seed(h, "toolate@example.com");   // due 1 Nov, paid again 15 Nov: lapsed, then a new period
        var director = Seed(h, "director@example.com"); // a choir due 15 Nov, paid again 16 Nov
        var staff = Seed(h, "staff@example.com");
        staff.SetInternal(true);

        Charge(h, early, monthly, Utc(10, 5));
        Charge(h, early, monthly, Utc(11, 3));
        Charge(h, late, monthly, Utc(10, 8));
        Charge(h, late, monthly, Utc(11, 12));
        Charge(h, lapsed, monthly, Utc(10, 10));
        Charge(h, lapsed, single, Utc(11, 2)); // a one-song purchase is not a renewal
        Charge(h, deciding, monthly, Utc(10, 20));
        Charge(h, tooLate, monthly, Utc(10, 1));
        Charge(h, tooLate, monthly, Utc(11, 15));
        Charge(h, director, choirPlan, Utc(10, 15));
        Charge(h, director, choirPlan, Utc(11, 16));
        Charge(h, staff, monthly, Utc(10, 9));

        // Ending soon, from the current rows: a paid member in three days, a gift in twenty, a choir in ten; one in
        // forty days and one already over are not.
        var soon = Seed(h, "soon@example.com", "Sade Soon");
        var gift = Seed(h, "gift@example.com");
        var far = Seed(h, "far@example.com");
        var over = Seed(h, "over@example.com");
        h.Db.Subscriptions.Add(Subscription.Start(soon.Id, monthly.Id, PaymentProvider.Bachs, Now.AddDays(-27), Now.AddDays(3), null, Now.AddDays(-27)));
        h.Db.Subscriptions.Add(Subscription.Grant(gift.Id, monthly.Id, Now.AddDays(-10), Now.AddDays(20), Now.AddDays(-10)));
        h.Db.Subscriptions.Add(Subscription.Start(far.Id, monthly.Id, PaymentProvider.Bachs, Now, Now.AddDays(40), null, Now));
        h.Db.Subscriptions.Add(Subscription.Start(over.Id, monthly.Id, PaymentProvider.Bachs, Now.AddDays(-40), Now.AddDays(-2), null, Now.AddDays(-40)));
        h.Db.Choirs.Add(Choir.Start(director.Id, "Director's choir", "ABCD2345", choirPlan.Id, 25, PaymentProvider.Bachs, Now.AddDays(-20), Now.AddDays(10), Now.AddDays(-20)));
        h.Db.SaveChanges();

        var r = (await Read(h)).Renewals;

        Assert.Equal(6, r.DueInWindow);
        Assert.Equal((1, 2, 2, 1), (r.RenewedEarly, r.RenewedLate, r.Lapsed, r.Deciding));
        Assert.Equal(0.6, r.RenewalRate);
        Assert.Equal((1, 3), (r.EndingIn7Days, r.EndingIn30Days));
        Assert.Equal([("Pro, paid", 1), ("Pro, gift", 1), ("Choir", 1)], r.EndingIn30DaysByKind.Select(k => (k.Label, k.Count)));
        var first = r.EndingSoon[0];
        Assert.Equal(("Sade Soon", "pro", true), (first.FullName, first.Kind, first.Paid));
        Assert.Equal(["pro", "choir", "pro"], r.EndingSoon.Select(e => e.Kind));
    }

    [Fact]
    public async Task Free_to_paid_follows_the_windows_sign_ups_by_price_set_with_the_median_time_to_pay()
    {
        using var h = new TestHarness(Now);
        var monthly = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 250_000, "NGN", BillingInterval.Monthly);
        var single = Plan.Create(Guid.NewGuid(), "single_usd", "One song", 199, "USD", BillingInterval.Single);
        h.Db.Plans.AddRange(monthly, single);

        var payer = Seed(h, "payer@example.com", country: "NG", at: Utc(11, 2));
        var idle = Seed(h, "idle@example.com", country: "NG", at: Utc(11, 3));
        var sharer = Seed(h, "sharer@example.com", country: "NG", at: Utc(11, 7));
        var ghana = Seed(h, "ghana@example.com", country: "GH", at: Utc(11, 4));
        var us = Seed(h, "us@example.com", country: "US", at: Utc(11, 5));
        var unknown = Seed(h, "unknown@example.com", at: Utc(11, 6));
        var old = Seed(h, "old@example.com", country: "NG", at: Utc(10, 1));

        // The payer spent the week's three free ones (2–5 Nov, one free week), started a checkout and paid on the 5th.
        Job(h, payer, Utc(11, 2), done: true, charged: true, device: "phone-a");
        Job(h, payer, Utc(11, 3), done: true, charged: true, device: "phone-a");
        Job(h, payer, Utc(11, 4), done: true, charged: true, device: "phone-a");
        Pay(h, payer, monthly, Utc(11, 5));
        // The sharer's phone was spent by an older account that week: the free limit is per handset too.
        Job(h, old, Utc(11, 7, 9), done: true, charged: true, device: "phone-b");
        Job(h, old, Utc(11, 8, 9), done: true, charged: true, device: "phone-b");
        Job(h, old, Utc(11, 9, 9), done: true, charged: true, device: "phone-b");
        Job(h, sharer, Utc(11, 9, 12), done: false, charged: false, device: "phone-b");
        Job(h, ghana, Utc(11, 4, 12), done: true, charged: true, device: "phone-c");
        Checkout(h, ghana, monthly, Utc(11, 6));
        Pay(h, us, single, Utc(11, 6));
        h.Db.SaveChanges();

        var sets = (await Read(h)).FreeToPaid.ToDictionary(s => s.Set);

        var naira = sets["naira"];
        Assert.Equal((3, 1, 2, 1, 1), (naira.SignedUp, naira.Transcribed, naira.ReachedFreeLimit, naira.StartedCheckout, naira.Paid));
        Assert.Equal((0.3333, 3.0), (naira.PaidRate, naira.MedianDaysToPay));
        var regional = sets["regional"];
        Assert.Equal((1, 1, 0, 1, 0, null), (regional.SignedUp, regional.Transcribed, regional.ReachedFreeLimit, regional.StartedCheckout, regional.Paid, regional.MedianDaysToPay));
        var standard = sets["standard"];
        Assert.Equal((1, 0, 1, 1, 1.0), (standard.SignedUp, standard.Transcribed, standard.StartedCheckout, standard.Paid, standard.MedianDaysToPay));
        Assert.Equal((1, 0), (sets["unknown"].SignedUp, sets["unknown"].Paid));
    }

    [Fact]
    public async Task Transcription_failures_are_rated_by_kind_and_link_problems_ranked_by_what_the_user_was_told()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, "user@example.com");
        var staff = Seed(h, "staff@example.com");
        staff.SetInternal(true);

        Job(h, user, Utc(11, 3), done: true);
        Job(h, user, Utc(11, 4), done: true);
        Job(h, user, Utc(11, 5), done: false);
        Job(h, user, Utc(10, 5), done: false);                       // before the window
        Job(h, staff, Utc(11, 5), done: false);                      // the team's
        h.Db.TranscriptionJobs.Add(TranscriptionJob.RecordSong("song-1", user.Id, Utc(11, 6), null));  // still running
        var link = TranscriptionJob.RecordLink("link-1", user.Id, Utc(11, 7), null, wasPro: true);
        link.Settle("{}", Utc(11, 7, 11));
        h.Db.TranscriptionJobs.Add(link);
        var broken = TranscriptionJob.RecordLink("link-2", user.Id, Utc(11, 8), null, wasPro: true);
        broken.Settle(null, Utc(11, 8, 11));
        h.Db.TranscriptionJobs.Add(broken);
        var preview = PreviewJob.Record("p-1", "upload", "browser", null, Utc(11, 9));
        preview.Complete(true, null, Utc(11, 9, 11));
        h.Db.PreviewJobs.Add(preview);
        var failedPreview = PreviewJob.Record("p-2", "link", "browser", null, Utc(11, 9));
        failedPreview.Complete(false, null, Utc(11, 9, 11));
        h.Db.PreviewJobs.Add(failedPreview);

        Log(h, user, "link", Utc(11, 10), refused: "This video is private.");
        Log(h, user, "link", Utc(11, 11), refused: "This video is private.");
        Log(h, user, "link", Utc(11, 12), failed: "We couldn't fetch that song.");
        Log(h, user, "link", Utc(11, 13));
        Log(h, user, "upload", Utc(11, 13), failed: "Too quiet.");
        h.Db.SaveChanges();

        var t = (await Read(h)).Transcriptions;

        KindHealthDto Kind(string k) => t.ByKind.Single(x => x.Kind == k);
        Assert.Equal((3, 2, 1, 0), (Kind("recording").Started, Kind("recording").Succeeded, Kind("recording").Failed, Kind("recording").Running));
        Assert.Equal(0.3333, Kind("recording").FailureRate);
        Assert.Equal((1, 1, null), (Kind("song").Started, Kind("song").Running, Kind("song").FailureRate));
        Assert.Equal((2, 0.5), (Kind("link").Started, Kind("link").FailureRate));
        Assert.Equal((2, 0.5), (Kind("preview").Started, Kind("preview").FailureRate));
        Assert.Equal((4, 2, 1), (t.LinkAttempts, t.LinkRefused, t.LinkFailed));
        Assert.Equal([("This video is private.", 2), ("We couldn't fetch that song.", 1)], t.LinkProblems.Select(p => (p.Label, p.Count)));
    }

    [Fact]
    public async Task Phones_are_counted_by_native_build_with_the_reminder_code_beside_it()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "a@example.com");
        var b = Seed(h, "b@example.com");
        var staff = Seed(h, "staff@example.com");
        staff.SetInternal(true);

        a.RegisterDeviceToken("ExponentPushToken[a1]", "android", 12, Now.AddDays(-1), serverReminders: true);
        a.RegisterDeviceToken("ExponentPushToken[a2]", "ios", 12, Now.AddDays(-2));
        b.RegisterDeviceToken("ExponentPushToken[b1]", "android", 10, Now.AddDays(-60), serverReminders: true);
        b.RegisterDeviceToken("ExponentPushToken[b2]", "android", 0, Now.AddDays(-90));
        b.RegisterDeviceToken("web-push", "web", 0, Now);
        staff.RegisterDeviceToken("ExponentPushToken[s]", "android", 12, Now, serverReminders: true);
        h.Db.SaveChanges();

        var v = (await Read(h, latestBuild: 12)).AppVersions;

        Assert.Equal((12, 4, 2, 2, 2), (v.LatestBuild, v.Phones, v.Recent, v.OnLatestBuild, v.ServerReminders));
        Assert.Equal(
            [new AppBuildRowDto(12, 2, 2, 1, 1, 1), new AppBuildRowDto(10, 1, 0, 1, 0, 1), new AppBuildRowDto(0, 1, 0, 1, 0, 0)],
            v.Builds);
    }

    // ── Seeding ─────────────────────────────────────────────────────────────

    private static User Seed(TestHarness h, string email, string name = "Member", string? country = null, DateTime? at = null)
    {
        var user = User.Create(name, email, "hash", at ?? Utc(1, 10));
        if (country is not null)
            user.RecordCountry(country);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static PaymentTransaction Checkout(TestHarness h, User user, Plan plan, DateTime at)
    {
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Bachs, $"checkout:{reference}", reference, plan.AmountMinor, plan.Currency, at);
        h.Db.PaymentTransactions.Add(tx);
        return tx;
    }

    /// <summary>A payment collected: the transaction completed and its ledger credit, as fulfilment writes them.</summary>
    private static void Pay(TestHarness h, User user, Plan plan, DateTime at)
    {
        var tx = Checkout(h, user, plan, at.AddMinutes(-5));
        tx.AttachCheckout("ps_" + tx.Reference, "https://checkout.example/" + tx.Reference, null, at.AddMinutes(-4));
        tx.MarkVerified("ps_" + tx.Reference, null, at);
        tx.MarkCompleted(at);
        var reason = plan.Interval == BillingInterval.Single ? LedgerEntryReason.TranscriptionPurchase : LedgerEntryReason.SubscriptionCharge;
        h.Db.LedgerEntries.Add(LedgerEntry.Create(user.Id, tx.Id, LedgerDirection.Credit, reason, plan.AmountMinor, plan.Currency, plan.Name, at));
    }

    private static void Charge(TestHarness h, User user, Plan plan, DateTime at) => Pay(h, user, plan, at);

    private static void Job(TestHarness h, User user, DateTime at, bool done, bool charged = false, string? device = null)
    {
        var job = TranscriptionJob.Record($"job-{Guid.NewGuid():N}", user.Id, at, device);
        job.Settle(done ? "{}" : null, at.AddMinutes(1));
        if (charged)
            job.ConsumeTrial(at.AddMinutes(1));
        h.Db.TranscriptionJobs.Add(job);
    }

    private static void Log(TestHarness h, User user, string kind, DateTime at, string? refused = null, string? failed = null)
    {
        var request = new TranscriptionLog.Request(TranscriptionLog.AccountOrigin, user.Id, null, "app", kind, "melody",
            LinkUrl: kind == "link" ? "https://youtu.be/x" : null);
        if (refused is not null)
        {
            h.Db.TranscriptionLogs.Add(TranscriptionLog.Refuse(request, refused, at));
            return;
        }
        var log = TranscriptionLog.Accept($"job-{Guid.NewGuid():N}", request, at);
        if (failed is not null)
            log.Fail(at.AddMinutes(1), failed);
        else
            log.Finish(at.AddMinutes(1), 30, "C major", 90, 20, 0.9, null, null, false);
        h.Db.TranscriptionLogs.Add(log);
    }
}
