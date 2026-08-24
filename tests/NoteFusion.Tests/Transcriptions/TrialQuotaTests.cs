using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The five free transcriptions: what spends one, what does not, and who is metered at all.
/// <para>
/// The count is kept on <c>TranscriptionJobs</c> rather than on saved <c>Transcriptions</c>, and that is
/// the regression these tests exist to pin. Counting saved rows meant deleting a transcription handed the
/// slot straight back — an unlimited free tier for anyone who noticed the Library had a delete button.
/// </para>
/// <para>
/// The charge lands on the poll, not the submit, because the poll is the only point where the API learns
/// a transcription actually succeeded: submit always answers <c>Pending</c>, and the status comes from the
/// ML service rather than the client. So a job that fails costs nothing, and a client cannot dodge the
/// charge without also giving up its result.
/// </para>
/// </summary>
public class TrialQuotaTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- the gate on submit

    [Fact]
    public async Task A_free_account_is_blocked_once_all_five_are_spent()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 5);

        var result = await Submit(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task A_free_account_with_one_left_can_still_submit()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 4);

        var result = await Submit(h, user);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Deleting_a_saved_transcription_does_not_hand_the_slot_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        // Five successful generations, nothing left in the Library: exactly the state a user reaches by
        // transcribing five times and then deleting all five. Under the old saved-row count this was 0 used.
        Spend(h, user, 5);
        Assert.Empty(h.Db.Transcriptions);

        var result = await Submit(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task A_pro_account_is_not_metered_at_all()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        Spend(h, user, 10); // well past the free limit, from a lapsed spell on the free tier

        var result = await Submit(h, user);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Submitting_attributes_the_job_but_spends_nothing_yet()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var result = await Submit(h, user);

        var job = Assert.Single(h.Db.TranscriptionJobs);
        Assert.Equal(result.Value, job.JobId);
        Assert.Equal(user.Id, job.UserId);
        Assert.Null(job.TrialConsumedAtUtc); // the audio has not been transcribed yet
    }

    // ---------------------------------------------------------------- the charge on poll

    [Fact]
    public async Task A_finished_job_spends_exactly_one_trial_however_often_it_is_polled()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);
        var firstStamp = h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc;

        h.Clock.UtcNow = Now.AddMinutes(5);
        await Poll(h, user, jobId, api);
        await Poll(h, user, jobId, api);

        var job = h.Db.TranscriptionJobs.Single();
        Assert.NotNull(job.TrialConsumedAtUtc);
        Assert.Equal(firstStamp, job.TrialConsumedAtUtc); // the later polls did not re-stamp it
    }

    [Fact]
    public async Task A_job_that_fails_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Failed;
        await Poll(h, user, jobId, api);

        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_job_still_running_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Processing;
        await Poll(h, user, jobId, api);

        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_pro_accounts_finished_job_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);

        // Left unspent on purpose: if this subscription lapses next year, these jobs must not already
        // have eaten the five free ones.
        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task Polling_a_job_belonging_to_someone_else_is_a_not_found()
    {
        using var h = new TestHarness(Now);
        var owner = Seed(h);
        var stranger = Seed(h, "nosy@example.com");
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done };
        var jobId = (await Submit(h, owner, api)).Value;

        var result = await Poll(h, stranger, jobId, api);

        // NotFound, not Forbidden: confirming the id exists is itself the leak.
        Assert.True(result.IsFailure);
        Assert.Equal("TRANS_JOB_NOT_FOUND", result.Error.Code);
        Assert.Equal(0, api.PollCount); // and the ML service was never asked
        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_job_with_no_row_is_let_through_unspent()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done };

        // Submitted before this table existed — in flight across the deploy. Breaking it would be the
        // worse trade than letting one transcription through free.
        var result = await Poll(h, user, "job-from-before", api);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Db.TranscriptionJobs);
    }

    // ---------------------------------------------------------------- the ceiling is per handset too

    [Fact]
    public async Task A_second_account_on_a_spent_handset_is_blocked()
    {
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        Spend(h, first, 5, "phone-a");

        var result = await Submit(h, second, device: "phone-a");

        // Adding a second Google account to an Android phone is four taps, and used to be worth five more
        // free generations. The five are now shared by every account on the handset.
        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task The_number_shown_matches_the_number_the_gate_enforces()
    {
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        Spend(h, first, 3, "phone-a");

        // FreeTier's doc forbids these two from disagreeing, and the device half is where they would: a
        // pill reading "5 free left" above a paywall that refuses on the third is the bug this pins.
        Assert.Equal(2, await Remaining(h, second, "phone-a"));
        Assert.True((await Submit(h, second, device: "phone-a")).IsSuccess);
    }

    [Fact]
    public async Task An_install_that_sends_no_device_keeps_its_own_five()
    {
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        Spend(h, first, 5); // unstamped: jobs from before the header existed

        // Fail open. Pooling every header-less install into one bucket would refuse a genuine first-time
        // user their first transcription — a silent failure, and worse than the farming it would stop.
        Assert.Equal(5, await Remaining(h, second));
        Assert.True((await Submit(h, second)).IsSuccess);
    }

    [Fact]
    public async Task The_same_account_on_a_second_handset_is_still_capped()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 5, "phone-a");

        var result = await Submit(h, user, device: "phone-b");

        // The per-account half of the count is untouched: a new phone is not a new allowance.
        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task A_pro_account_on_a_spent_handset_still_submits()
    {
        using var h = new TestHarness(Now);
        var free = Seed(h);
        var paid = Seed(h, "paid@example.com");
        GoPro(h, paid);
        Spend(h, free, 5, "phone-a");

        // Someone who pays does not inherit a flatmate's exhausted trial.
        Assert.True((await Submit(h, paid, device: "phone-a")).IsSuccess);
    }

    // ---------------------------------------------------------------- where the handset is

    [Fact]
    public async Task The_first_submission_from_a_handset_records_where_it_is()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi(); // one instance, so the two submissions get distinct job ids
        h.Country.Country = "NG";
        h.ClientIp.Current = "102.89.1.1";

        await Submit(h, user, api, "phone-a");

        var device = Assert.Single(h.Db.TrialDevices);
        Assert.Equal("NG", device.FirstSeenCountry);
        Assert.Equal("102.89.1.1", device.FirstSeenIp);
        Assert.Equal(Now, device.FirstSeenAtUtc);
        Assert.Equal(1, h.Country.Calls);

        // A second generation by the same account on the same handset teaches us nothing new. geojs's free
        // tier is metered per calling address and a dyno shares egress with strangers, so GeoSettings puts
        // the budget at sign-ups per day — one lookup per submission would blow straight through it.
        h.Clock.UtcNow = Now.AddHours(1);
        await Submit(h, user, api, "phone-a");

        Assert.Equal(1, h.Country.Calls);
        Assert.Equal(Now.AddHours(1), h.Db.TrialDevices.Single().LastSeenAtUtc);
    }

    [Fact]
    public async Task A_new_account_on_a_known_handset_is_located_again()
    {
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        var api = new FakeTranscriptionApi(); // shared, so the two submissions get distinct job ids
        h.Country.Country = "NG";
        await Submit(h, first, api, "phone-a");

        h.Country.Country = "GB";
        await Submit(h, second, api, "phone-a");

        var device = h.Db.TrialDevices.Single();
        Assert.Equal(2, h.Country.Calls); // the one case a second lookup earns its keep
        Assert.Equal("NG", device.FirstSeenCountry); // first observation wins, as with User.RecordCountry
        Assert.Equal("GB", device.LastSeenCountry); // and the move is what a human would want to see
    }

    // ---------------------------------------------------------------- fixtures

    private static User Seed(TestHarness h, string email = "free@example.com")
    {
        var user = User.Create("Free User", email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack,
            Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    /// <summary>Records <paramref name="count"/> already-successful generations against the account.</summary>
    private static void Spend(TestHarness h, User user, int count, string? device = null)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.Record($"spent-{user.Id}-{i}", user.Id, Now.AddDays(-10), device);
            job.ConsumeTrial(Now.AddDays(-10));
            h.Db.TranscriptionJobs.Add(job);
        }

        h.Db.SaveChanges();
    }

    private static Task<Result<string>> Submit(
        TestHarness h, User user, FakeTranscriptionApi? api = null, string? device = null)
        => new SubmitTranscriptionCommandHandler(
                api ?? new FakeTranscriptionApi(), h.Db, new StubCurrentUser(user.Id), h.Clock,
                new StubDeviceFingerprint(device), h.DeviceRegister)
            .Handle(
                new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null),
                CancellationToken.None);

    /// <summary>
    /// What the app would show this caller on this handset. The same query the trial pill reads, so a test
    /// can compare it against what the gate actually did.
    /// </summary>
    private static async Task<int> Remaining(TestHarness h, User user, string? device = null)
        => (await new GetMySubscriptionQueryHandler(
                h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(device))
            .Handle(new GetMySubscriptionQuery(), CancellationToken.None))
            .Value.TrialGenerationsRemaining;

    private static Task<Result<TranscriptionJobDto>> Poll(
        TestHarness h, User user, string jobId, FakeTranscriptionApi api)
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new GetTranscriptionJobQuery(jobId), CancellationToken.None);

    /// <summary>
    /// Stands in for the Python worker. The status is the test's to set, which is the whole point: in
    /// production it is the ML service's answer, so neither the client nor the handler can invent it.
    /// </summary>
    private sealed class FakeTranscriptionApi : ITranscriptionApi
    {
        private int _next;

        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public int PollCount { get; private set; }

        public Task<Result<string>> SubmitAsync(
            Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(Result<string>.Success($"job-{++_next}"));

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            PollCount++;
            var progress = Status == TranscriptionStatus.Done ? 1d : 0.5d;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, progress, null)));
        }

        /// <summary>Not exercised here — quota has nothing to do with the health page.</summary>
        public Task<Result<int>> PingAsync(CancellationToken ct = default)
            => Task.FromResult(Result<int>.Success(1));
    }
}
