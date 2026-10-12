using NoteFusion.Application.Admin.Commands;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Infrastructure.Common;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

public class AdminDashboardEnhancementTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Reset_trial_quota_clears_consumed_jobs_and_records_audit_log()
    {
        using var h = new TestHarness(Now);
        var admin = User.CreateAdmin("Admin", "admin@notefusion.studio", h.Hasher.Hash("pass"), Now);
        var user = User.Create("Free User", "free@example.com", h.Hasher.Hash("pass"), Now);
        h.Db.Users.AddRange(admin, user);

        var job1 = TranscriptionJob.Record("job-1", user.Id, Now.AddHours(-3));
        job1.ConsumeTrial(Now.AddHours(-2));

        var job2 = TranscriptionJob.Record("job-2", user.Id, Now.AddHours(-2));
        job2.ConsumeTrial(Now.AddHours(-1));

        h.Db.TranscriptionJobs.AddRange(job1, job2);
        await h.Db.SaveChangesAsync();

        var usedBefore = await TrialUsage.CountUsedAsync(h.Db, user.Id, null, Now);
        Assert.Equal(2, usedBefore);

        var caller = new StubCurrentUser(admin.Id, admin.Role, admin.Email, admin.FullName);
        var handler = new ResetUserTrialQuotaCommandHandler(h.Db, caller, h.AuditAs(admin), h.Clock);

        var result = await handler.Handle(new ResetUserTrialQuotaCommand(user.Id, "Unblocked customer"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value);

        var usedAfter = await TrialUsage.CountUsedAsync(h.Db, user.Id, null, Now);
        Assert.Equal(0, usedAfter);

        var audit = h.Db.AdminAuditLogs.Single(a => a.TargetUserId == user.Id);
        Assert.Equal(AdminAuditAction.ResetTrialQuota, audit.Action);
        Assert.Equal("Unblocked customer", audit.Note);
    }

    [Fact]
    public async Task Payment_ops_summary_calculates_mrr_and_active_subscriber_counts()
    {
        using var h = new TestHarness(Now);
        var user1 = User.Create("Sub 1", "sub1@example.com", h.Hasher.Hash("pass"), Now);
        var user2 = User.Create("Sub 2", "sub2@example.com", h.Hasher.Hash("pass"), Now);
        var user3 = User.Create("Gift 3", "gift3@example.com", h.Hasher.Hash("pass"), Now);
        h.Db.Users.AddRange(user1, user2, user3);

        // $10/mo monthly plan (1000 cents)
        var monthlyPlan = Plan.Create(Guid.NewGuid(), "pro_monthly", "Pro Monthly", 1000, "USD", BillingInterval.Monthly);
        // $120/yr yearly plan (12000 cents -> 1000 cents/mo MRR)
        var yearlyPlan = Plan.Create(Guid.NewGuid(), "pro_yearly", "Pro Yearly", 12000, "USD", BillingInterval.Yearly);
        h.Db.Plans.AddRange(monthlyPlan, yearlyPlan);

        // Active monthly paid subscription (renews in 15 days)
        var sub1 = Subscription.Start(user1.Id, monthlyPlan.Id, PaymentProvider.Bachs, Now.AddDays(-15), Now.AddDays(15), "sub_1", Now);
        // Active yearly paid subscription (expires in 3 days -> within 7 days)
        var sub2 = Subscription.Start(user2.Id, yearlyPlan.Id, PaymentProvider.Bachs, Now.AddDays(-362), Now.AddDays(3), "sub_2", Now);
        // Active gifted subscription (Provider is null, should not count towards MRR)
        var sub3 = Subscription.Grant(user3.Id, monthlyPlan.Id, Now, Now.AddDays(30), Now);

        h.Db.Subscriptions.AddRange(sub1, sub2, sub3);
        await h.Db.SaveChangesAsync();

        var handler = new GetPaymentOpsSummaryQueryHandler(h.Db, h.Clock, new BillingSettings());
        var summary = await handler.Handle(new GetPaymentOpsSummaryQuery(), CancellationToken.None);

        Assert.True(summary.IsSuccess);
        // MRR should be 1000 (monthly) + 1000 (yearly normalized) = 2000 cents ($20)
        Assert.Equal(2000, summary.Value.MrrMinor);
        // Active paid subscribers should be 2 (excluding gifted)
        Assert.Equal(2, summary.Value.ActiveSubscribersCount);
        // Expiring in 7 days should be 1 (sub2)
        Assert.Equal(1, summary.Value.ExpiringInSevenDaysCount);
    }

    [Fact]
    public async Task Admin_transcriptions_query_returns_paged_results_with_user_email()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Musician", "musician@example.com", h.Hasher.Hash("pass"), Now);
        h.Db.Users.Add(user);

        var notes = new[] { new NoteEvent { PitchMidi = 60, StartBeat = 0.0, DurationBeats = 1.0, Confidence = 0.95 } };
        var transcription = new Transcription(
            user.Id,
            "Amazing Grace",
            new MusicalKey(0, KeyMode.Major),
            120,
            "4/4",
            "<musicxml/>",
            notes,
            0.95);

        h.Db.Transcriptions.Add(transcription);
        await h.Db.SaveChangesAsync();

        var handler = new GetAdminTranscriptionsQueryHandler(h.Db);
        var result = await handler.Handle(new GetAdminTranscriptionsQuery(Search: "Grace"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, result.Value.TotalCount);
        var row = result.Value.Items.Single();
        Assert.Equal("Amazing Grace", row.Title);
        Assert.Equal("musician@example.com", row.UserEmail);
        Assert.Equal(0.95, row.OverallConfidence);
    }

    [Fact]
    public async Task System_announcement_lifecycle_sets_and_clears_active_broadcast()
    {
        using var h = new TestHarness(Now);
        var admin = User.CreateAdmin("Admin", "admin@notefusion.studio", h.Hasher.Hash("pass"), Now);
        h.Db.Users.Add(admin);
        await h.Db.SaveChangesAsync();

        var caller = new StubCurrentUser(admin.Id, admin.Role, admin.Email, admin.FullName);
        var setHandler = new SetSystemAnnouncementCommandHandler(h.Db, caller, h.AuditAs(admin), h.Clock);
        var getHandler = new GetSystemAnnouncementQueryHandler(h.Db, h.Clock);
        var clearHandler = new ClearSystemAnnouncementCommandHandler(h.Db, caller, h.AuditAs(admin), h.Clock);

        // 1. Publish announcement
        var setResult = await setHandler.Handle(
            new SetSystemAnnouncementCommand("Scheduled maintenance tonight", "warning", Now.AddHours(5)),
            CancellationToken.None);

        Assert.True(setResult.IsSuccess);
        Assert.Equal("Scheduled maintenance tonight", setResult.Value.Message);
        Assert.Equal("warning", setResult.Value.Severity);
        Assert.True(setResult.Value.IsActive);

        // 2. Fetch active announcement
        var getResult = await getHandler.Handle(new GetSystemAnnouncementQuery(), CancellationToken.None);
        Assert.True(getResult.IsSuccess);
        Assert.NotNull(getResult.Value);
        Assert.Equal("Scheduled maintenance tonight", getResult.Value!.Message);

        // 3. Clear announcement
        var clearResult = await clearHandler.Handle(new ClearSystemAnnouncementCommand("Maintenance complete"), CancellationToken.None);
        Assert.True(clearResult.IsSuccess);

        var getAfterClear = await getHandler.Handle(new GetSystemAnnouncementQuery(), CancellationToken.None);
        Assert.True(getAfterClear.IsSuccess);
        Assert.Null(getAfterClear.Value);
    }

    [Fact]
    public void Worker_heartbeat_tracker_records_heartbeats_accurately()
    {
        var clock = new FixedClock(Now);
        var tracker = new WorkerHeartbeatTracker(clock);

        tracker.RecordHeartbeat("StalePaymentCleanup", 45, "Healthy", "Pending cleared: 5");

        var heartbeats = tracker.GetAll();
        Assert.Single(heartbeats);
        var hb = heartbeats[0];
        Assert.Equal("StalePaymentCleanup", hb.WorkerName);
        Assert.Equal(45, hb.DurationMs);
        Assert.Equal("Healthy", hb.Status);
        Assert.Equal("Pending cleared: 5", hb.Detail);
    }
}
