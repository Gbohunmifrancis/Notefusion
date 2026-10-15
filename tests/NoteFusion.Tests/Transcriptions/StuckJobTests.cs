using MediatR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Preview.Queries;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Transcriptions.Workers;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// Jobs that never settled and so showed as "still running" for good, holding a free place or a song credit:
/// a job the worker lost in a restart, a worker that times out instead of answering at the deadline, a late
/// result after the deadline, and website previews, which nothing but the visitor's own tab ever finished.
/// </summary>
public class StuckJobTests
{
    private static readonly DateTime Now = new(2026, 10, 15, 9, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan PastDeadline = NotifyTranscriptionReadyCommand.GiveUpAfter + TimeSpan.FromMinutes(1);

    // ---------------------------------------------------------------- account jobs

    [Fact]
    public async Task A_job_the_worker_no_longer_knows_is_closed_at_once_uncharged_and_frees_its_place()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        Assert.Equal(1, await TrialUsage.CountUsedAsync(h.Db, user.Id, null, Now));

        // Two minutes in, the worker restarted without a journal: a 404, not a 502.
        h.Clock.UtcNow = Now.AddMinutes(2);
        var result = await Notify(h, job, new Worker { NotFound = true });

        Assert.True(result.IsSuccess);
        var row = h.Db.TranscriptionJobs.Single();
        Assert.NotNull(row.SettledAtUtc);
        Assert.Null(row.ResultJson);
        Assert.Null(row.TrialConsumedAtUtc);
        Assert.Equal(0, await TrialUsage.CountUsedAsync(h.Db, user.Id, null, h.Clock.UtcNow));
        Assert.Contains("Nothing was charged", Assert.Single(h.Push.Sent).Message.Body);
    }

    [Fact]
    public async Task A_job_past_its_deadline_whose_last_ask_times_out_is_closed_rather_than_kept_open()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        h.Clock.UtcNow = Now + PastDeadline;

        // The HTTP client's timeout throws; before, the sweep backed off and asked again forever.
        var result = await Notify(h, job, new Worker { Throws = true });

        Assert.True(result.IsSuccess);
        Assert.NotNull(h.Db.TranscriptionJobs.Single().SettledAtUtc);
        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_young_job_whose_ask_times_out_stays_open_for_the_next_sweep()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        h.Clock.UtcNow = Now.AddMinutes(3);

        await Assert.ThrowsAsync<TaskCanceledException>(() => Notify(h, job, new Worker { Throws = true }));
        h.Db.ChangeTracker.Clear();
        Assert.Null(h.Db.TranscriptionJobs.Single().SettledAtUtc);
    }

    [Fact]
    public async Task A_job_still_running_at_the_deadline_is_closed_uncharged()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        h.Clock.UtcNow = Now + PastDeadline;

        await Notify(h, job, new Worker { Status = TranscriptionStatus.Processing });

        var row = h.Db.TranscriptionJobs.Single();
        Assert.NotNull(row.SettledAtUtc);
        Assert.Null(row.TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_result_that_arrives_after_the_job_was_given_up_on_is_shown_but_not_charged()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        h.Clock.UtcNow = Now + PastDeadline;
        await Notify(h, job, new Worker { Status = TranscriptionStatus.Processing });

        // The worker finishes after all, and the record screen is still polling.
        h.Clock.UtcNow = Now + PastDeadline + TimeSpan.FromMinutes(2);
        var poll = await new GetTranscriptionJobQueryHandler(new Worker { Status = TranscriptionStatus.Done }, h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new GetTranscriptionJobQuery(job.JobId), default);

        Assert.Equal(TranscriptionStatus.Done, poll.Value.Status);
        Assert.NotNull(poll.Value.Result);
        var row = h.Db.TranscriptionJobs.Single();
        Assert.Null(row.TrialConsumedAtUtc); // told it was free, and it stays free
    }

    [Fact]
    public async Task A_song_closed_at_the_deadline_spends_no_song_credit()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = TranscriptionJob.RecordLink("job-song", user.Id, Now, null, wasPro: true);
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        h.Clock.UtcNow = Now + PastDeadline;

        await Notify(h, job, new Worker { Status = TranscriptionStatus.Pending });

        var row = h.Db.TranscriptionJobs.Single();
        Assert.NotNull(row.SettledAtUtc);
        Assert.Null(row.SongCreditConsumedAtUtc);
    }

    // ---------------------------------------------------------------- website previews

    [Fact]
    public async Task A_preview_whose_visitor_left_is_finished_by_the_follow_up()
    {
        using var h = new TestHarness(Now);
        var preview = OpenPreview(h);
        h.Clock.UtcNow = Now.AddMinutes(3);

        await Settle(h, preview, new Worker { Status = TranscriptionStatus.Done });

        var row = h.Db.PreviewJobs.Single();
        Assert.NotNull(row.CompletedAtUtc);
        Assert.True(row.Succeeded);
    }

    [Fact]
    public async Task A_running_preview_is_left_alone_until_the_deadline_then_closed_as_failed()
    {
        using var h = new TestHarness(Now);
        var preview = OpenPreview(h);
        var running = new Worker { Status = TranscriptionStatus.Processing };

        h.Clock.UtcNow = Now.AddMinutes(5);
        await Settle(h, preview, running);
        Assert.Null(h.Db.PreviewJobs.Single().CompletedAtUtc);

        h.Clock.UtcNow = Now + PastDeadline;
        await Settle(h, preview, running);
        var row = h.Db.PreviewJobs.Single();
        Assert.NotNull(row.CompletedAtUtc);
        Assert.False(row.Succeeded);
    }

    [Fact]
    public async Task A_preview_the_worker_lost_is_closed_by_the_follow_up_and_by_the_browser_poll()
    {
        using var h = new TestHarness(Now);
        var swept = OpenPreview(h, "prev-swept");
        await Settle(h, swept, new Worker { NotFound = true });
        Assert.NotNull(h.Db.PreviewJobs.Single(p => p.JobId == "prev-swept").CompletedAtUtc);

        OpenPreview(h, "prev-polled");
        var poll = await new GetPreviewJobQueryHandler(new Worker { NotFound = true }, h.Db, h.Clock)
            .Handle(new GetPreviewJobQuery("prev-polled"), default);

        // A plain failure, not a 404 the page would keep polling.
        Assert.True(poll.IsSuccess);
        Assert.Equal(TranscriptionStatus.Failed, poll.Value.Status);
        Assert.False(string.IsNullOrWhiteSpace(poll.Value.Error));
        Assert.NotNull(h.Db.PreviewJobs.Single(p => p.JobId == "prev-polled").CompletedAtUtc);
    }

    [Fact]
    public async Task Settled_jobs_and_previews_stop_showing_as_still_running()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var preview = OpenPreview(h);

        h.Clock.UtcNow = Now.AddMinutes(1); // the window ends now, exclusive
        var before = (await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default)).Value;
        Assert.Equal(2, before.Transcriptions.InFlightCount);

        h.Clock.UtcNow = Now + PastDeadline;
        await Notify(h, job, new Worker { NotFound = true });
        await Settle(h, preview, new Worker { NotFound = true });

        var after = (await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default)).Value;
        Assert.Equal(0, after.Transcriptions.InFlightCount);
        Assert.Equal(2, after.Transcriptions.FailedCount);
    }

    [Fact]
    public async Task The_sweep_follows_up_open_jobs_and_open_previews_then_sends_the_tips()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var job = Open(h, user);
        var preview = OpenPreview(h);
        var done = OpenPreview(h, "prev-done");
        done.Complete(true, null, Now);
        h.Db.SaveChanges();

        var asked = new List<object>();
        var sender = new RecordingSender(asked);
        var services = new ServiceCollection();
        services.AddSingleton(h.Db);
        services.AddSingleton<ISender>(sender);
        var worker = new TranscriptionCompletionWorker(
            services.BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            NullLogger<TranscriptionCompletionWorker>.Instance);

        await worker.SweepAsync(CancellationToken.None);

        Assert.Collection(asked,
            r => Assert.Equal(job.Id, Assert.IsType<NotifyTranscriptionReadyCommand>(r).JobRowId),
            r => Assert.Equal(preview.Id, Assert.IsType<SettlePreviewJobCommand>(r).PreviewRowId),
            r => Assert.IsType<EmailFailedTranscriptionTipsCommand>(r));
    }

    // ---------------------------------------------------------------- fixtures

    private sealed class RecordingSender(List<object> asked) : ISender
    {
        public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            asked.Add(request);
            object answer = request is EmailFailedTranscriptionTipsCommand ? Result<int>.Success(0) : Result.Success();
            return Task.FromResult((TResponse)answer);
        }

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : IRequest
            => throw new NotSupportedException();
        public Task<object?> Send(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(IStreamRequest<TResponse> request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Ada Lovelace", "ada@example.com", "hash", Now.AddDays(-3));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static TranscriptionJob Open(TestHarness h, User user)
    {
        var job = TranscriptionJob.Record("job-1", user.Id, Now);
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        return job;
    }

    private static PreviewJob OpenPreview(TestHarness h, string jobId = "prev-1")
    {
        var preview = PreviewJob.Record(jobId, "link", "browser-" + jobId, "203.0.113.9", Now);
        h.Db.PreviewJobs.Add(preview);
        h.Db.SaveChanges();
        return preview;
    }

    private static Task<Result> Notify(TestHarness h, TranscriptionJob job, Worker api)
        => new NotifyTranscriptionReadyCommandHandler(h.Db, api, h.Clock, h.Push, new NoNotifier())
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), CancellationToken.None);

    private static Task<Result> Settle(TestHarness h, PreviewJob preview, Worker api)
        => new SettlePreviewJobCommandHandler(h.Db, api, h.Clock)
            .Handle(new SettlePreviewJobCommand(preview.Id), CancellationToken.None);

    private sealed class NoNotifier : ITranscriptionNotifier
    {
        public Task NotifyJobCompletedAsync(Guid userId, TranscriptionJobDto job, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    /// <summary>The worker's answer to "where is this job": a status, a 404, or a timeout.</summary>
    private sealed class Worker : ITranscriptionApi
    {
        public TranscriptionStatus Status { get; init; } = TranscriptionStatus.Processing;
        public bool NotFound { get; init; }
        public bool Throws { get; init; }

        private static TranscriptionResultDto Finished => new(
            "G major", 0.91, 96, "4/4", "<score-partwise version=\"4.0\" />", "",
            [new NoteEventDto(67, 0, 1, 5, "s", "", 0.95)], ["s"], 0.9, "");

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            if (Throws)
                throw new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout.");
            if (NotFound)
                return Task.FromResult(Result.Failure<TranscriptionJobDto>(Error.NotFound("Api.Job", "The transcription service no longer has this job.")));
            var done = Status == TranscriptionStatus.Done;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, done ? 1 : 0.4, done ? Finished : null, null)));
        }

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => throw new NotSupportedException();
        public Task<Result<int>> PingAsync(CancellationToken ct = default)
            => Task.FromResult(Result<int>.Success(1));
    }
}
