using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common;
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
/// The free transcriptions: what spends one, what does not, who is metered at all, and how many they get —
/// three, everywhere.
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
    public async Task A_free_account_is_blocked_once_all_three_are_spent()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 3);

        var result = await Submit(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task A_free_account_with_one_left_can_still_submit()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 2);

        var result = await Submit(h, user);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task Deleting_a_saved_transcription_does_not_hand_the_slot_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        // Three successful generations, nothing left in the Library: exactly the state a user reaches by
        // transcribing three times and then deleting all three. Under the old saved-row count this was 0 used.
        Spend(h, user, 3);
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

    // ---------------------------------------------------------------- one number everywhere

    [Theory]
    [InlineData("NG")]
    [InlineData("GB")]
    [InlineData(null)]
    public async Task Every_country_gets_the_same_three(string? country)
    {
        using var h = new TestHarness(Now);
        var user = SeedAbroad(h, country: country);
        Assert.Equal(3, await Total(h, user));
        Spend(h, user, 3);

        var result = await Submit(h, user);

        // The refusal names the number the pill had been showing: a different one would read as a billing bug.
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
        Assert.Contains("3", result.Error.Message);
        Assert.Equal(0, await Remaining(h, user));
    }

    // ---------------------------------------------------------------- a running job holds its place

    [Fact]
    public async Task Starting_several_at_once_cannot_get_past_the_three()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi(); // shared, so each submission gets its own job id

        // None has finished, so none is charged yet. Counting finished jobs alone let all of these through.
        for (var i = 0; i < 3; i++)
            Assert.True((await Submit(h, user, api)).IsSuccess);
        var fourth = await Submit(h, user, api);

        Assert.Equal("BILLING_FREE_TIER_LIMIT", fourth.Error.Code);
        Assert.Equal(0, await Remaining(h, user)); // and the pill says so while they run
    }

    [Fact]
    public async Task A_job_still_queued_past_half_an_hour_keeps_holding_its_place()
    {
        // The worker runs one job at a time and queues up to fifty, so on a busy evening a free account's
        // last transcription can wait well past thirty minutes. It used to stop holding its place then:
        // the account started another, both finished, both were charged: four of three.
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 2);
        var api = new FakeTranscriptionApi();
        Assert.True((await Submit(h, user, api)).IsSuccess);

        h.Clock.UtcNow = Now + TrialUsage.RunningFor + TimeSpan.FromMinutes(10);

        Assert.Equal(0, await Remaining(h, user));
        Assert.Equal("BILLING_FREE_TIER_LIMIT", (await Submit(h, user, api)).Error.Code);
    }

    [Fact]
    public async Task A_job_that_settles_without_a_result_frees_its_place()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        for (var i = 0; i < 3; i++)
            await Submit(h, user, api);

        // The sweep closes a failed job with no result; that costs nothing and gives the place back.
        h.Db.TranscriptionJobs.First().Settle(null, Now.AddMinutes(1));
        h.Db.SaveChanges();

        Assert.Equal(1, await Remaining(h, user));
        Assert.True((await Submit(h, user, api)).IsSuccess);
    }

    [Fact]
    public async Task A_job_the_worker_lost_stops_holding_a_place_when_the_sweep_gives_up_on_it()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        h.Db.TranscriptionJobs.Add(TranscriptionJob.Record("lost", user.Id, Now - TrialUsage.HeldFor - TimeSpan.FromMinutes(1)));
        h.Db.SaveChanges();

        Assert.Equal(3, await Remaining(h, user));
    }

    [Fact]
    public async Task A_finished_job_is_counted_once_not_as_running_and_charged()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await Submit(h, user, api)).Value;
        Assert.Equal(2, await Remaining(h, user));

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);

        Assert.Equal(2, await Remaining(h, user));
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
        // have eaten the three free ones.
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
    public async Task A_job_with_no_row_is_not_found_and_the_worker_is_not_asked()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done };

        // An anonymous preview's id, or one made up. Passing the worker's answer through handed any
        // signed-in caller a result that was never theirs, uncharged and unredacted.
        var result = await Poll(h, user, "preview-job-id", api);

        Assert.True(result.IsFailure);
        Assert.Equal("TRANS_JOB_NOT_FOUND", result.Error.Code);
        Assert.Equal(0, api.PollCount);
    }

    // ---------------------------------------------------------------- the ceiling is per handset too

    [Fact]
    public async Task A_second_account_on_a_spent_handset_is_blocked()
    {
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        Spend(h, first, 3, "phone-a");

        var result = await Submit(h, second, device: "phone-a");

        // Adding a second Google account to an Android phone is four taps, and used to be worth a fresh
        // trial. The three are shared by every account on the handset.
        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_FREE_TIER_LIMIT", result.Error.Code);
    }

    [Fact]
    public async Task A_second_account_on_the_handset_waits_for_the_first_accounts_running_job()
    {
        // The handset's third free one is still running under the first account. The count shared charged
        // jobs across the handset but held running ones per account only, so switching account while it ran
        // was a fourth free transcription on the same phone.
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        Spend(h, first, 2, "phone-a");
        var api = new FakeTranscriptionApi();
        Assert.True((await Submit(h, first, api, device: "phone-a")).IsSuccess);

        Assert.Equal(0, await Remaining(h, second, "phone-a"));
        Assert.Equal("BILLING_FREE_TIER_LIMIT", (await Submit(h, second, api, device: "phone-a")).Error.Code);
    }

    [Fact]
    public async Task The_number_shown_matches_the_number_the_gate_enforces()
    {
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        Spend(h, first, 1, "phone-a");

        // FreeTier's doc forbids these two from disagreeing, and the device half is where they would: a
        // pill reading "3 free left" above a paywall that refuses on the second is the bug this pins.
        Assert.Equal(2, await Remaining(h, second, "phone-a"));
        Assert.True((await Submit(h, second, device: "phone-a")).IsSuccess);
    }

    [Fact]
    public async Task An_install_that_sends_no_device_keeps_its_own_three()
    {
        using var h = new TestHarness(Now);
        var first = Seed(h);
        var second = Seed(h, "second@example.com");
        Spend(h, first, 3); // unstamped: jobs from before the header existed

        // Fail open. Pooling every header-less install into one bucket would refuse a genuine first-time
        // user their first transcription — a silent failure, and worse than the farming it would stop.
        Assert.Equal(3, await Remaining(h, second));
        Assert.True((await Submit(h, second)).IsSuccess);
    }

    [Fact]
    public async Task The_same_account_on_a_second_handset_is_still_capped()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Spend(h, user, 3, "phone-a");

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
        Spend(h, free, 3, "phone-a");

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

        user.RecordCountry("NG");
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    /// <summary>An account in <paramref name="country"/>, or with none recorded.</summary>
    private static User SeedAbroad(TestHarness h, string email = "abroad@example.com", string? country = "GB")
    {
        var user = User.Create("Abroad User", email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        if (country is not null)
            user.RecordCountry(country);
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
                new StubDeviceFingerprint(device), h.DeviceRegister, h.Activity(user.Id), h.QuotaGate)
            .Handle(
                new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null),
                CancellationToken.None);

    /// <summary>
    /// What the app would show this caller on this handset. The same query the trial pill reads, so a test
    /// can compare it against what the gate actually did.
    /// </summary>
    private static async Task<int> Remaining(TestHarness h, User user, string? device = null)
        => (await Shown(h, user, device)).TrialGenerationsRemaining;

    /// <summary>The ceiling the app prints beside it, which must be the one the gate enforced.</summary>
    private static async Task<int> Total(TestHarness h, User user, string? device = null)
        => (await Shown(h, user, device)).TrialGenerationsTotal;

    private static async Task<Application.Billing.Dtos.SubscriptionDto> Shown(
        TestHarness h, User user, string? device = null)
        => (await new GetMySubscriptionQueryHandler(
                h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(device))
            .Handle(new GetMySubscriptionQuery(), CancellationToken.None))
            .Value;

    private static Task<Result<TranscriptionJobDto>> Poll(
        TestHarness h, User user, string jobId, FakeTranscriptionApi api)
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new GetTranscriptionJobQuery(jobId), CancellationToken.None);

    [Fact]
    public async Task A_job_the_worker_has_forgotten_is_reported_as_lost_not_as_a_bare_404()
    {
        // The worker's queue is in memory. When it restarts under a running job (an out-of-memory kill,
        // a deploy), every poll after that is a 404, and the client used to show "Transcription service
        // returned 404" forever. The job row says we handed this job out and never settled it, so the
        // poll now answers with a failed job that says what happened — and nothing is charged.
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var submitted = await Submit(h, user, api);
        Assert.True(submitted.IsSuccess);

        api.Lost = true;
        var poll = await Poll(h, user, submitted.Value, api);

        Assert.True(poll.IsSuccess, poll.IsFailure ? poll.Error.Message : "");
        Assert.Equal(TranscriptionStatus.Failed, poll.Value.Status);
        Assert.Contains("restarted", poll.Value.Error);
        Assert.Equal(0, await TrialUsage.CountUsedAsync(h.Db, user.Id, null, Now, CancellationToken.None));
    }

    /// <summary>
    /// Stands in for the Python worker. The status is the test's to set, which is the whole point: in
    /// production it is the ML service's answer, so neither the client nor the handler can invent it.
    /// </summary>
    private sealed class FakeTranscriptionApi : ITranscriptionApi
    {
        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(null, null)));

        private int _next;

        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public int PollCount { get; private set; }

        /// <summary>When set, the worker answers every poll with "no such job" — what a restart looks like.</summary>
        public bool Lost { get; set; }

        public Task<Result<string>> SubmitAsync(
            Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(Result<string>.Success($"job-{++_next}"));

        public Task<Result<string>> SubmitScoreAsync(
            Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(Result<string>.Success($"job-{++_next}"));

        public Task<Result<string>> SubmitLinkAsync(
            string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, "link", options, ct);

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            PollCount++;
            if (Lost)
                return Task.FromResult<Result<TranscriptionJobDto>>(Error.NotFound("Api.Job", "The transcription service no longer has this job."));
            var progress = Status == TranscriptionStatus.Done ? 1d : 0.5d;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, progress, null)));
        }


        public Task<Result<NoteFusion.Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => Task.FromResult(Result<GradeResultDto>.Success(new GradeResultDto(100, target.Notes.Count, 0, 0, 0, 0, 0, 0, "Spot on.", [])));

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        /// <summary>Not exercised here — quota has nothing to do with the health page.</summary>
        public Task<Result<int>> PingAsync(CancellationToken ct = default)
            => Task.FromResult(Result<int>.Success(1));
    }
}
