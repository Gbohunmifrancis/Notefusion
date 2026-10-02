using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions;
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
/// Finishing a transcription with nobody watching. The client's poll dies with the record screen, so
/// before the completion sweep existed, navigating away abandoned a job silently — no result, no
/// notification, and on a free account the allowance spent on nothing.
/// <para>
/// The sweep's per-job step is <c>NotifyTranscriptionReadyCommand</c>, and these tests drive it
/// directly; the worker around it is a timer and a batch query, with no rule of its own to pin.
/// </para>
/// <para>
/// The pairing that matters most here is the one with the client poll. Both paths can be the first to
/// observe a job succeed, and both go through the same two idempotent entity methods — so the
/// allowance is spent exactly once, and a transcription the user is already looking at does not also
/// arrive as a notification.
/// </para>
/// </summary>
public class TranscriptionCompletionTests
{
    private static readonly DateTime Now = new(2026, 8, 21, 9, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- a job that finishes

    [Fact]
    public async Task A_finished_job_is_closed_cached_and_pushed()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService { Status = TranscriptionStatus.Done };

        var result = await Notify(h, job, api);

        Assert.True(result.IsSuccess);

        var stored = h.Db.TranscriptionJobs.Single();
        Assert.Equal(Now, stored.SettledAtUtc);
        Assert.NotNull(stored.ResultJson);

        var push = Assert.Single(h.Push.Sent);
        Assert.Equal(user.Id, Assert.Single(push.Recipients));
        Assert.Equal("Hey Free, your transcription is ready!", push.Message.Title); // greets the account's first name
        Assert.Contains("G major", push.Message.Body);

        // The tap needs the ML job id, not our row id: it re-fetches through the same
        // GET /api/transcriptions/jobs/{jobId} the record screen polls.
        Assert.Equal(job.JobId, push.Message.Data?["jobId"]);
    }

    [Fact]
    public async Task The_cached_result_carries_everything_except_the_audio()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService { Status = TranscriptionStatus.Done };

        await Notify(h, job, api);

        var cached = TranscriptionResultCache.Deserialize(h.Db.TranscriptionJobs.Single().ResultJson!)!;
        Assert.Equal("G major", cached.Key);
        Assert.Equal(96, cached.Tempo);
        Assert.Equal(Finished.MusicXml, cached.MusicXml);
        Assert.Equal(Finished.Notes.Count, cached.Notes.Count);
        Assert.Equal(Finished.SolfaLines, cached.SolfaLines);

        // Dropped on purpose: a base64 WAV of the whole recording, stored per job forever, when the
        // client re-synthesises the same melody from the notes in milliseconds. The source result
        // does carry one, so this is the strip working rather than an empty fixture.
        Assert.NotEmpty(Finished.AudioPreviewBase64);
        Assert.Equal(string.Empty, cached.AudioPreviewBase64);
    }

    [Fact]
    public async Task A_free_accounts_finished_job_spends_one_generation()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);

        await Notify(h, job, new FakeMlService { Status = TranscriptionStatus.Done });

        Assert.Equal(Now, h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_pro_accounts_finished_job_spends_nothing_but_is_still_pushed()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var job = Open(h, user);

        await Notify(h, job, new FakeMlService { Status = TranscriptionStatus.Done });

        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
        Assert.Single(h.Push.Sent);
    }

    // ---------------------------------------------------------------- a job that does not

    [Fact]
    public async Task A_failed_job_is_closed_with_no_result_and_the_reason_is_passed_on()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService
        {
            Status = TranscriptionStatus.Failed,
            FailureReason = "Too quiet to detect any pitches."
        };

        await Notify(h, job, api);

        var stored = h.Db.TranscriptionJobs.Single();
        Assert.Equal(Now, stored.SettledAtUtc);
        Assert.Null(stored.ResultJson);
        Assert.Null(stored.TrialConsumedAtUtc); // a failure costs the user nothing

        var push = Assert.Single(h.Push.Sent);
        Assert.Equal("Sorry Free, the transcription failed", push.Message.Title);
        Assert.Equal("Too quiet to detect any pitches.", push.Message.Body);
    }

    [Fact]
    public async Task A_job_the_ml_service_never_finishes_is_given_up_on_and_the_user_told()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);

        // Unreachable rather than merely slow, and long enough after submission that no amount of
        // waiting will help: a dyno cycled mid-transcription and took the in-memory job with it.
        var api = new FakeMlService { Unreachable = Error.Failure("Api.Job", "Transcription service returned 404.") };
        h.Clock.UtcNow = Now + NotifyTranscriptionReadyCommand.GiveUpAfter.Add(TimeSpan.FromMinutes(1));

        await Notify(h, job, api);

        var stored = h.Db.TranscriptionJobs.Single();
        Assert.NotNull(stored.SettledAtUtc);
        Assert.Null(stored.ResultJson);

        // Pushed, not closed quietly. This job is only ever reached because the user stopped
        // watching, so silence would leave them waiting for a notification that never comes.
        var push = Assert.Single(h.Push.Sent);
        Assert.Equal("Sorry Free, the transcription failed", push.Message.Title);
    }

    [Fact]
    public async Task A_job_still_running_is_left_alone()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);

        h.Clock.UtcNow = Now.AddMinutes(2);
        var result = await Notify(h, job, new FakeMlService { Status = TranscriptionStatus.Processing });

        Assert.True(result.IsSuccess);
        Assert.Null(h.Db.TranscriptionJobs.Single().SettledAtUtc); // still in the sweep for next tick
        Assert.Empty(h.Push.Sent);
    }

    [Fact]
    public async Task A_young_job_survives_the_ml_service_being_unreachable()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);

        // The API client cannot tell a 404 from a 502, so a transient outage looks exactly like a lost
        // job. Age is what separates them, and two minutes in there is nothing to conclude.
        var api = new FakeMlService { Unreachable = Error.Failure("Api.Job", "Transcription service returned 502.") };
        h.Clock.UtcNow = Now.AddMinutes(2);

        var result = await Notify(h, job, api);

        Assert.True(result.IsSuccess);
        Assert.Null(h.Db.TranscriptionJobs.Single().SettledAtUtc);
        Assert.Empty(h.Push.Sent);
    }

    [Fact]
    public async Task A_row_that_no_longer_exists_is_a_not_found()
    {
        using var h = new TestHarness(Now);

        var result = await new NotifyTranscriptionReadyCommandHandler(
                h.Db, new FakeMlService(), h.Clock, h.Push, new FakeTranscriptionNotifier())
            .Handle(new NotifyTranscriptionReadyCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("TRANS_JOB_NOT_FOUND", result.Error.Code);
    }

    // ---------------------------------------------------------------- alongside the client's poll

    [Fact]
    public async Task A_transcription_the_client_already_collected_is_not_pushed_about()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService { Status = TranscriptionStatus.Done };

        // The record screen was open, so the poll got there first.
        await Poll(h, user, job.JobId, api);
        var settledByPoll = h.Db.TranscriptionJobs.Single().SettledAtUtc;
        Assert.NotNull(settledByPoll);

        h.Clock.UtcNow = Now.AddSeconds(10);
        var result = await Notify(h, job, api);

        // The common case, not an edge one: the sweep runs every ten seconds, so without this every
        // successful foreground transcription would arrive a second time as a notification.
        Assert.True(result.IsSuccess);
        Assert.Empty(h.Push.Sent);
        Assert.Equal(settledByPoll, h.Db.TranscriptionJobs.Single().SettledAtUtc);
        Assert.Equal(1, api.PollCount); // settled rows are not even asked about
    }

    [Fact]
    public async Task Either_path_may_finish_a_job_first_and_the_allowance_is_spent_once()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService { Status = TranscriptionStatus.Done };

        // The sweep wins this time — the app was closed — and the client polls later, on the tap.
        await Notify(h, job, api);
        var charged = h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc;

        h.Clock.UtcNow = Now.AddMinutes(20);
        await Poll(h, user, job.JobId, api);
        await Poll(h, user, job.JobId, api);

        Assert.Equal(charged, h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_tap_still_opens_the_result_after_the_ml_service_has_forgotten_the_job()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService { Status = TranscriptionStatus.Done };

        await Notify(h, job, api);

        // Fifteen minutes later the user taps the notification. The Python job store is in-process
        // memory with a TTL, on a dyno that cycles daily, so by now it has nothing — which is the
        // entire reason the result is copied onto our own row.
        api.Unreachable = Error.Failure("Api.Job", "Transcription service returned 404.");
        h.Clock.UtcNow = Now.AddMinutes(15);

        var result = await Poll(h, user, job.JobId, api);

        Assert.True(result.IsSuccess);
        Assert.Equal(TranscriptionStatus.Done, result.Value.Status);

        var served = result.Value.Result!;
        Assert.Equal("G major", served.Key);
        Assert.Equal(Finished.SolfaLines, served.SolfaLines);
    }

    [Fact]
    public async Task A_tap_on_a_job_that_failed_reports_the_failure_rather_than_the_outage()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService { Status = TranscriptionStatus.Failed };

        await Notify(h, job, api);

        api.Unreachable = Error.Failure("Api.Job", "Transcription service returned 404.");
        var result = await Poll(h, user, job.JobId, api);

        // Failed, not an API error: the job is closed and resultless, and telling the user their
        // recording did not work is more useful than telling them a service they never heard of is down.
        Assert.True(result.IsSuccess);
        Assert.Equal(TranscriptionStatus.Failed, result.Value.Status);
        Assert.Null(result.Value.Result);
        Assert.False(string.IsNullOrWhiteSpace(result.Value.Error));
    }

    [Fact]
    public async Task An_unsettled_job_the_ml_service_cannot_answer_for_still_fails_the_poll()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var api = new FakeMlService { Unreachable = Error.Network("Api.Network", "Could not reach the service.") };

        var result = await Poll(h, user, job.JobId, api);

        // Nothing cached and nothing settled, so there is no answer to substitute: the client has to
        // hear that the lookup failed and keep polling.
        Assert.True(result.IsFailure);
        Assert.Equal("Api.Network", result.Error.Code);
    }

    // ---------------------------------------------------------------- the sweep's predicate

    [Fact]
    public void The_sweep_sees_only_open_jobs_oldest_first()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var newest = Open(h, user, "job-new", Now.AddMinutes(-1));
        var oldest = Open(h, user, "job-old", Now.AddMinutes(-20));
        var closed = Open(h, user, "job-done", Now.AddMinutes(-10));
        closed.Settle(null, Now.AddMinutes(-9));
        h.Db.SaveChanges();

        // The worker's query, verbatim apart from the batch size.
        var open = h.Db.TranscriptionJobs
            .Where(j => j.SettledAtUtc == null)
            .OrderBy(j => j.CreatedAtUtc)
            .Select(j => j.JobId)
            .ToList();

        // Oldest first so a steady stream of new recordings cannot starve one that has been waiting,
        // and no age filter, because a job too old to finish still has to be closed by the command —
        // filtering it out here would leave it in this result set forever.
        Assert.Equal(new[] { oldest.JobId, newest.JobId }, open);
        Assert.DoesNotContain(closed.JobId, open);
    }

    [Fact]
    public void Settling_twice_neither_overwrites_the_result_nor_claims_the_push()
    {
        var job = TranscriptionJob.Record("job-1", Guid.NewGuid(), Now);

        Assert.True(job.Settle("{\"key\":\"G major\"}", Now));
        Assert.False(job.Settle(null, Now.AddMinutes(1)));

        // False is what tells the second caller someone else already notified. The result and the
        // stamp are the first caller's, so a later sweep cannot blank a cached transcription.
        Assert.Equal("{\"key\":\"G major\"}", job.ResultJson);
        Assert.Equal(Now, job.SettledAtUtc);
    }

    [Fact]
    public void Settling_a_job_does_not_charge_it_and_charging_it_does_not_settle_it()
    {
        var job = TranscriptionJob.Record("job-1", Guid.NewGuid(), Now);

        job.Settle("{}", Now);
        Assert.Null(job.TrialConsumedAtUtc);

        // Still independently idempotent with the new columns in place: the two markers answer
        // different questions, and only the caller decides whether a settled job owed anything.
        Assert.True(job.ConsumeTrial(Now));
        Assert.False(job.ConsumeTrial(Now.AddMinutes(1)));
        Assert.Equal(Now, job.TrialConsumedAtUtc);
        Assert.Equal(Now, job.SettledAtUtc);
    }

    // ---------------------------------------------------------------- fixtures

    /// <summary>What the ML service hands back for a finished job, audio preview and all.</summary>
    private static TranscriptionResultDto Finished => new(
        "G major", 0.91, 96, "4/4",
        "<score-partwise version=\"4.0\" />", "TVRoZAAAAAY=",
        [
            new NoteEventDto(67, 0, 1, 5, "s", "", 0.95),
            new NoteEventDto(69, 1, 1, 6, "l", "", 0.88)
        ],
        ["s l s"], 0.9, "UklGRiQAAABXQVZF");

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

    /// <summary>An in-flight job: attributed to the account, not yet settled. What submit leaves behind.</summary>
    private static TranscriptionJob Open(
        TestHarness h, User user, string jobId = "job-1", DateTime? createdAtUtc = null)
    {
        var job = TranscriptionJob.Record(jobId, user.Id, createdAtUtc ?? Now);
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        return job;
    }

    private static Task<Result> Notify(TestHarness h, TranscriptionJob job, FakeMlService api)
        => new NotifyTranscriptionReadyCommandHandler(h.Db, api, h.Clock, h.Push, new FakeTranscriptionNotifier())
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), CancellationToken.None);

    private static Task<Result<TranscriptionJobDto>> Poll(
        TestHarness h, User user, string jobId, FakeMlService api)
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new GetTranscriptionJobQuery(jobId), CancellationToken.None);

    private sealed class FakeTranscriptionNotifier : NoteFusion.Application.Common.Interfaces.ITranscriptionNotifier
    {
        public Task NotifyJobCompletedAsync(Guid userId, TranscriptionJobDto job, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    /// <summary>
    /// Stands in for the Python worker, with the one distinction the real client cannot draw: whether a
    /// lookup failed at all. It cannot tell a 404 from a 502 either — both arrive as a plain failure
    /// with a status code in the message — so <see cref="Unreachable"/> is deliberately one switch.
    /// </summary>
    private sealed class FakeMlService : ITranscriptionApi
    {
        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Processing;

        /// <summary>The reason a failed job gives, when it gives one.</summary>
        public string? FailureReason { get; set; }

        /// <summary>Set to make every lookup fail — a dyno cycle, an outage, or a forgotten job.</summary>
        public Error? Unreachable { get; set; }

        public int PollCount { get; private set; }

        public Task<Result<string>> SubmitAsync(
            Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(Result<string>.Success("job-1"));

        public Task<Result<string>> SubmitScoreAsync(
            Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => Task.FromResult(Result<string>.Success("job-1"));

        public Task<Result<string>> SubmitLinkAsync(
            string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, "link", options, ct);

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => Task.FromResult(Result<GradeResultDto>.Success(new GradeResultDto(100, target.Notes.Count, 0, 0, 0, 0, 0, 0, "Spot on.", [])));

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            PollCount++;

            if (Unreachable is { } error)
            {
                return Task.FromResult(Result.Failure<TranscriptionJobDto>(error));
            }

            var done = Status == TranscriptionStatus.Done;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, done ? 1d : 0.4d, done ? Finished : null, FailureReason)));
        }

        public Task<Result<int>> PingAsync(CancellationToken ct = default)
            => Task.FromResult(Result<int>.Success(1));
    }
}
