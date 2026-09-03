using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Admin.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The health page, which is read during an incident and therefore has exactly one hard requirement: it
/// must still load when something is broken. Every probe degrades its own panel and nothing degrades the
/// response, because a dashboard that returns 500 when the worker is down hides the three tiers that are
/// still fine at the moment somebody most needs to know.
///
/// The second half is honesty. Every number here has to come from something this schema actually records —
/// a panel that reads green because the table it counts is only ever written on success is worse than no
/// panel, and the transcription failure rate is exactly that trap, so it is absent by design.
/// </summary>
public class SystemHealthTests
{
    private static readonly DateTime Now = new(2026, 8, 20, 10, 0, 0, DateTimeKind.Utc);

    // ------------------------------------------------------------------- rollup

    [Fact]
    public async Task A_stack_with_nothing_wrong_reports_healthy()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h);

        Assert.Equal("healthy", health.Status);
        Assert.Equal("healthy", health.Database.Status);
        Assert.Equal("healthy", health.TranscriptionWorker.Status);
        Assert.Equal("healthy", health.WebhookBacklog.Status);
        Assert.Equal(Now, health.CheckedAtUtc);
    }

    [Fact]
    public async Task The_page_names_the_tiers_it_cannot_watch_rather_than_leaving_gaps()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h);

        // Four absences an operator would otherwise read as a broken dashboard: three tiers this
        // architecture does not have, and one metric it does not retain.
        Assert.Equal(4, health.NotMonitored.Count);
        Assert.Contains(health.NotMonitored, s => s.Contains("Redis"));
        Assert.Contains(health.NotMonitored, s => s.Contains("broker"));
        Assert.Contains(health.NotMonitored, s => s.Contains("gateway"));
        Assert.Contains(health.NotMonitored, s => s.Contains("failure rate"));
    }

    [Fact]
    public async Task The_page_reports_no_transcription_failure_rate_because_nothing_records_one()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h);

        // Pinned deliberately. A saved Transcription is written only when a job succeeded — its Status
        // column is never set to Failed by anything in this codebase — so a rate computed from it would
        // read "0% failed" through a total ML outage. If someone adds a failure panel later, it has to come
        // with a column that a failure actually writes to, and this assertion is where they will notice.
        var names = typeof(SystemHealthDto).GetProperties().Select(p => p.Name).ToList();
        Assert.DoesNotContain("Transcriptions", names);
        Assert.DoesNotContain("FailureRate", names);
    }

    // ----------------------------------------------------------------- database

    [Fact]
    public async Task An_unreachable_database_is_reported_without_taking_the_page_down()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h, db: new StubDatabaseHealth
        {
            Result = new DatabaseHealth(null, 0, "connection refused")
        });

        Assert.Equal("down", health.Status);
        Assert.Equal("down", health.Database.Status);
        Assert.Equal("connection refused", health.Database.Detail);

        // No latency on a failed probe: how long it took to fail is not a response time, and printing it
        // as one makes an outage look like a slow query.
        Assert.Null(health.Database.LatencyMs);
    }

    [Fact]
    public async Task Panels_that_need_the_database_say_they_were_skipped_rather_than_each_failing()
    {
        using var h = new TestHarness(Now);
        Waiting(h, minutesAgo: 60);

        var health = await Check(h, db: new StubDatabaseHealth
        {
            Result = new DatabaseHealth(null, 0, "connection refused")
        });

        // One panel names the cause; the rest say they did not look. Three panels each reporting the same
        // dead connection says less than one, and the counts must not read as real zeroes.
        Assert.Equal("down", health.WebhookBacklog.Status);
        Assert.Contains("database is unreachable", health.WebhookBacklog.Detail!);
        Assert.Equal(0, health.Activity.JobsLast24Hours);
        Assert.Equal(0, health.Subscriptions.ActiveCount);
    }

    [Fact]
    public async Task A_worker_outage_leaves_the_database_panel_alone()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h, api: StubTranscriptionApi.Down("no route to host"));

        Assert.Equal("down", health.Status);
        Assert.Equal("down", health.TranscriptionWorker.Status);
        Assert.Contains("no route to host", health.TranscriptionWorker.Detail!);

        // The whole reason each probe is separate: the database is fine and the page still says so.
        Assert.Equal("healthy", health.Database.Status);
        Assert.Equal("healthy", health.WebhookBacklog.Status);
    }

    [Fact]
    public async Task A_dead_worker_carries_no_latency_figure()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h, api: StubTranscriptionApi.Down("timed out"));

        Assert.Null(health.TranscriptionWorker.LatencyMs);
    }

    [Fact]
    public async Task A_pending_migration_degrades_the_database_without_calling_it_down()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h, db: new StubDatabaseHealth
        {
            Result = new DatabaseHealth(7, 2, null)
        });

        // Answering, so not an outage — but one request away from throwing on a column that is not there.
        Assert.Equal("degraded", health.Status);
        Assert.Equal("degraded", health.Database.Status);
        Assert.Equal(7, health.Database.LatencyMs);
        Assert.Contains("2 migration", health.Database.Detail!);

        // And a degraded database is still a database: the panels behind it are checked, not skipped.
        Assert.Equal("healthy", health.WebhookBacklog.Status);
    }

    [Fact]
    public async Task A_reachable_migrated_database_reports_its_latency()
    {
        using var h = new TestHarness(Now);

        var health = await Check(h, db: new StubDatabaseHealth { Result = new DatabaseHealth(4, 0, null) });

        Assert.Equal("healthy", health.Database.Status);
        Assert.Equal(4, health.Database.LatencyMs);
        Assert.Null(health.Database.Detail);
    }

    // ---------------------------------------------------------- webhook backlog

    [Fact]
    public async Task A_webhook_waiting_longer_than_the_tolerance_degrades_the_backlog()
    {
        using var h = new TestHarness(Now);
        Waiting(h, minutesAgo: 90);
        Waiting(h, minutesAgo: 1);

        var health = await Check(h);

        // The age of the oldest, not the count, is the signal: two waiting is normal, one waiting for an
        // hour and a half means the drain has stopped and somebody has paid for Pro they did not get.
        Assert.Equal("degraded", health.Status);
        Assert.Equal("degraded", health.WebhookBacklog.Status);
        Assert.Contains("1h 30m", health.WebhookBacklog.Detail!);
        Assert.Contains("2 waiting", health.WebhookBacklog.Detail!);
    }

    [Fact]
    public async Task A_backlog_that_is_merely_recent_is_healthy_and_says_how_many_are_waiting()
    {
        using var h = new TestHarness(Now);
        Waiting(h, minutesAgo: 1);
        Waiting(h, minutesAgo: 2);

        var health = await Check(h);

        Assert.Equal("healthy", health.WebhookBacklog.Status);
        Assert.Contains("2 waiting", health.WebhookBacklog.Detail!);
    }

    [Fact]
    public async Task Webhooks_already_applied_are_not_a_backlog()
    {
        using var h = new TestHarness(Now);
        var applied = Waiting(h, minutesAgo: 300);
        applied.MarkProcessed(Now);
        h.Db.SaveChanges();

        var health = await Check(h);

        Assert.Equal("healthy", health.WebhookBacklog.Status);
        Assert.Null(health.WebhookBacklog.Detail);
    }

    [Fact]
    public async Task Webhooks_parked_as_failed_are_reported_even_when_nothing_is_waiting()
    {
        using var h = new TestHarness(Now);
        var parked = Waiting(h, minutesAgo: 300);
        parked.RecordFailure("signature mismatch", maxAttempts: 1, Now);
        h.Db.SaveChanges();

        var health = await Check(h);

        // Nothing is queued, so the drain is fine — but a parked row waits for a human, and nobody is
        // coming back for it unless this page says so.
        Assert.Equal("degraded", health.WebhookBacklog.Status);
        Assert.Contains("Nothing waiting", health.WebhookBacklog.Detail!);
        Assert.Contains("1 event", health.WebhookBacklog.Detail!);
    }

    // ------------------------------------------------------------ subscriptions

    [Fact]
    public async Task Subscription_counts_follow_the_rule_the_app_uses_not_the_status_column()
    {
        using var h = new TestHarness(Now);

        // Cancelled but still inside the period they paid for: the app treats this as Pro, so the count
        // has to as well. Status == Active alone would report them as already gone.
        Paid(h, Account(h, "cancelled@example.com"), endsIn: TimeSpan.FromDays(20), s => s.Cancel(Now));

        // Expired and never swept: the status says Expired but the window is what the paywall reads, and
        // it is closed. Counting the status alone would have reported this one as present.
        Paid(h, Account(h, "lapsed@example.com"), endsIn: TimeSpan.FromDays(-3), s => s.Expire(Now));

        Paid(h, Account(h, "paying@example.com"), endsIn: TimeSpan.FromDays(20));

        var health = await Check(h);

        Assert.Equal(2, health.Subscriptions.ActiveCount);
    }

    [Fact]
    public async Task Gifted_subscriptions_are_counted_apart_from_paid_ones()
    {
        using var h = new TestHarness(Now);
        Paid(h, Account(h, "paying@example.com"), endsIn: TimeSpan.FromDays(20));
        Gifted(h, Account(h, "comped@example.com"), endsIn: TimeSpan.FromDays(20));

        var health = await Check(h);

        Assert.Equal(2, health.Subscriptions.ActiveCount);
        Assert.Equal(1, health.Subscriptions.GiftedCount);
    }

    [Fact]
    public async Task Only_subscriptions_ending_inside_the_week_count_as_expiring()
    {
        using var h = new TestHarness(Now);
        Paid(h, Account(h, "soon@example.com"), endsIn: TimeSpan.FromDays(3));
        Paid(h, Account(h, "later@example.com"), endsIn: TimeSpan.FromDays(20));

        var health = await Check(h);

        Assert.Equal(1, health.Subscriptions.ExpiringWithinSevenDays);
    }

    [Fact]
    public async Task Lifetime_access_is_never_counted_as_expiring()
    {
        using var h = new TestHarness(Now);
        var user = Account(h, "forever@example.com");
        h.Db.Subscriptions.Add(
            Subscription.Grant(user.Id, PlanId("pro_lifetime"), Now, Subscription.LifetimeEndUtc, Now));
        h.Db.SaveChanges();

        var health = await Check(h);

        Assert.Equal(1, health.Subscriptions.ActiveCount);
        Assert.Equal(0, health.Subscriptions.ExpiringWithinSevenDays);
    }

    [Fact]
    public async Task Past_due_subscriptions_are_counted_wherever_their_period_stands()
    {
        using var h = new TestHarness(Now);

        // Inside its window and outside it: a failed renewal is a failed renewal either way, and both are
        // accounts whose card needs chasing.
        Paid(h, Account(h, "grace@example.com"), endsIn: TimeSpan.FromDays(2), s => s.MarkPastDue(Now));
        Paid(h, Account(h, "overdue@example.com"), endsIn: TimeSpan.FromDays(-2), s => s.MarkPastDue(Now));

        var health = await Check(h);

        Assert.Equal(2, health.Subscriptions.PastDueCount);
    }

    // --------------------------------------------------------------- throughput

    [Fact]
    public async Task Job_volume_is_counted_over_both_windows()
    {
        using var h = new TestHarness(Now);
        var user = Account(h, "busy@example.com");

        Job(h, user, hoursAgo: 1);
        Job(h, user, hoursAgo: 5);
        Job(h, user, hoursAgo: 48);
        Job(h, user, hoursAgo: 24 * 30);

        var health = await Check(h);

        Assert.Equal(2, health.Activity.JobsLast24Hours);
        Assert.Equal(3, health.Activity.JobsLast7Days);
    }

    // ----------------------------------------------------------------- fixtures

    private static async Task<SystemHealthDto> Check(
        TestHarness h, StubDatabaseHealth? db = null, StubTranscriptionApi? api = null)
    {
        var result = await new GetSystemHealthQueryHandler(
                h.Db, db ?? new StubDatabaseHealth(), api ?? new StubTranscriptionApi(), h.Clock)
            .Handle(new GetSystemHealthQuery(), CancellationToken.None);

        // Pinned in the one place every test goes through: whatever is broken, the page still loads.
        Assert.True(result.IsSuccess);
        return result.Value;
    }

    private static User Account(TestHarness h, string email)
    {
        var user = User.Create("Test User", email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static Subscription Paid(
        TestHarness h, User user, TimeSpan endsIn, Action<Subscription>? status = null)
    {
        var sub = Subscription.Start(
            user.Id, PlanId("pro_monthly_ngn"), PaymentProvider.Paystack,
            Now - TimeSpan.FromDays(30) + endsIn, Now + endsIn, "prov-sub", Now.AddDays(-30));

        status?.Invoke(sub);
        h.Db.Subscriptions.Add(sub);
        h.Db.SaveChanges();
        return sub;
    }

    private static void Gifted(TestHarness h, User user, TimeSpan endsIn)
    {
        h.Db.Subscriptions.Add(
            Subscription.Grant(user.Id, PlanId("pro_monthly_ngn"), Now, Now + endsIn, Now));
        h.Db.SaveChanges();
    }

    private static WebhookEvent Waiting(TestHarness h, int minutesAgo)
    {
        var received = Now.AddMinutes(-minutesAgo);
        var evt = WebhookEvent.Receive(
            PaymentProvider.Paystack, $"evt-{Guid.NewGuid()}", "charge.success", "ref-1", "{}", received);

        h.Db.WebhookEvents.Add(evt);
        h.Db.SaveChanges();
        return evt;
    }

    private static void Job(TestHarness h, User user, int hoursAgo)
    {
        h.Db.TranscriptionJobs.Add(
            TranscriptionJob.Record($"job-{Guid.NewGuid()}", user.Id, Now.AddHours(-hoursAgo)));
        h.Db.SaveChanges();
    }

    private static Guid PlanId(string code)
    {
        using var md5 = System.Security.Cryptography.MD5.Create();
        return new Guid(md5.ComputeHash(System.Text.Encoding.UTF8.GetBytes($"plan:{code}")));
    }

    /// <summary>
    /// The database probe, which the tests drive directly. The real one needs a real connection to be
    /// wrong about, and the states worth testing — refused, un-migrated — cannot be produced against the
    /// in-memory SQLite the harness runs on.
    /// </summary>
    private sealed class StubDatabaseHealth : IDatabaseHealth
    {
        public DatabaseHealth Result { get; set; } = new(3, 0, null);

        public Task<DatabaseHealth> CheckAsync(CancellationToken ct = default) => Task.FromResult(Result);
    }

    /// <summary>Stands in for the Python worker; only the ping matters on this page.</summary>
    private sealed class StubTranscriptionApi : ITranscriptionApi
    {
        private readonly Result<int> _ping;

        public StubTranscriptionApi() => _ping = 12;

        private StubTranscriptionApi(Result<int> ping) => _ping = ping;

        public static StubTranscriptionApi Down(string because)
            => new(Error.Network("Api.Ping", $"Could not reach the transcription service: {because}"));

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(_ping);

        public Task<Result<string>> SubmitAsync(
            Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => throw new NotSupportedException("The health page never submits work.");

        public Task<Result<string>> SubmitScoreAsync(
            Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => throw new NotSupportedException("The health page never submits work.");

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
            => throw new NotSupportedException("The health page never polls a job.");
    }
}
