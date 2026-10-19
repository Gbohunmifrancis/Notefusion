using System.Text;
using System.Text.Json;
using MediatR;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using NoteFusion.Api.Controllers;
using NoteFusion.Api.Realtime;
using NoteFusion.Api.Services;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Application.Transcriptions.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Transcriptions;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// A job's live events: the clients watching a job hold its event stream instead of polling it every two seconds,
/// the worker posts its progress there, the API says when it has ended, and whoever saw the end live is not pushed.
/// </summary>
public class JobEventsTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    // ── The hub ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void An_event_reaches_everyone_watching_the_job_and_counts_those_not_away()
    {
        var events = new InMemoryJobEvents();
        using var phone = events.Watch("job-1", "user:a")!;
        using var hiddenTab = events.Watch("job-1", "user:a", away: true)!;
        using var other = events.Watch("job-2", "user:b")!;

        var told = events.Publish("job-1", new JobEvent(JobEvent.Ended));

        Assert.Equal(1, told);
        Assert.True(phone.Events.TryRead(out var seen) && seen.Name == JobEvent.Ended);
        Assert.True(hiddenTab.Events.TryRead(out _));
        Assert.False(other.Events.TryRead(out _));
        Assert.Equal(0, events.Publish("job-3", new JobEvent(JobEvent.Ended)));
    }

    [Fact]
    public void A_job_stops_being_watched_when_its_last_stream_closes()
    {
        var events = new InMemoryJobEvents();
        var first = events.Watch("job-1", "user:a")!;
        var second = events.Watch("job-1", "user:a")!;

        first.Dispose();
        first.Dispose(); // twice is once
        Assert.True(events.IsWatched("job-1"));
        second.Dispose();

        Assert.False(events.IsWatched("job-1"));
        Assert.Equal(0, events.Publish("job-1", new JobEvent(JobEvent.Ended)));
    }

    [Fact]
    public void One_watcher_cannot_hold_more_than_its_share_of_streams()
    {
        var events = new InMemoryJobEvents();
        var held = Enumerable.Range(0, InMemoryJobEvents.PerWatcher).Select(i => events.Watch($"job-{i}", "user:a")).ToList();

        Assert.All(held, Assert.NotNull);
        Assert.Null(events.Watch("job-x", "user:a"));
        Assert.NotNull(events.Watch("job-x", "user:b"));

        held[0]!.Dispose();
        Assert.NotNull(events.Watch("job-x", "user:a"));
    }

    [Fact]
    public void A_slow_reader_keeps_the_newest_events()
    {
        var events = new InMemoryJobEvents();
        using var watch = events.Watch("job-1", "user:a")!;

        for (var i = 1; i <= 40; i++)
            events.Publish("job-1", new JobEvent(JobEvent.Progress, Progress("job-1", i / 40.0)));

        var kept = new List<double>();
        while (watch.Events.TryRead(out var e))
            kept.Add(e.Job!.Progress);
        Assert.True(kept.Count < 40);
        Assert.Equal(1.0, kept[^1]);
    }

    // ── The stream ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_stream_says_ready_then_each_move_then_ended_and_closes()
    {
        var events = new InMemoryJobEvents();
        var http = NewResponse();
        using var watch = events.Watch("job-1", "user:a")!;
        var writing = JobEventStream.WriteAsync(http.Response, "job-1", watch, Json, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(10), default);

        events.Publish("job-1", new JobEvent(JobEvent.Progress, Progress("job-1", 0.5, stage: "transcribing")));
        events.Publish("job-1", new JobEvent(JobEvent.Ended));
        await writing.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal("text/event-stream", http.Response.ContentType);
        Assert.Equal("no-cache, no-transform", http.Response.Headers.CacheControl.ToString());
        var frames = Frames(http);
        Assert.Equal(["ready", "job", "ended"], frames.Select(f => f.Event));
        using (var job = JsonDocument.Parse(frames[1].Data))
        {
            Assert.Equal("processing", job.RootElement.GetProperty("status").GetString());
            Assert.Equal("transcribing", job.RootElement.GetProperty("stage").GetString());
            Assert.Equal(0.5, job.RootElement.GetProperty("progress").GetDouble());
        }
        Assert.Equal("{\"jobId\":\"job-1\"}", frames[2].Data);
    }

    [Fact]
    public async Task A_job_that_has_ended_is_said_to_have_at_once()
    {
        var http = NewResponse();

        await JobEventStream.WriteAsync(http.Response, "job-1", null, Json, default);

        var frame = Assert.Single(Frames(http));
        Assert.Equal(JobEvent.Ended, frame.Event);
    }

    [Fact]
    public async Task A_quiet_stream_is_kept_alive_and_closed_after_its_time()
    {
        var events = new InMemoryJobEvents();
        var http = NewResponse();
        using var watch = events.Watch("job-1", "user:a")!;

        await JobEventStream.WriteAsync(http.Response, "job-1", watch, Json, TimeSpan.FromMilliseconds(40), TimeSpan.FromMilliseconds(300), default)
            .WaitAsync(TimeSpan.FromSeconds(5));

        var text = Body(http);
        Assert.StartsWith("event: ready\n", text);
        Assert.Contains(": ping\n\n", text);
    }

    [Fact]
    public async Task A_client_that_leaves_ends_its_stream()
    {
        var events = new InMemoryJobEvents();
        var http = NewResponse();
        using var left = new CancellationTokenSource();
        var watch = events.Watch("job-1", "user:a")!;
        var writing = JobEventStream.WriteAsync(http.Response, "job-1", watch, Json, left.Token);

        await left.CancelAsync();
        await writing.WaitAsync(TimeSpan.FromSeconds(5));
        watch.Dispose();

        Assert.False(events.IsWatched("job-1"));
    }

    // ── Who may watch ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Only_the_owner_watches_a_job_and_a_preview_by_its_id()
    {
        using var h = new TestHarness();
        var (owner, job) = SeedJob(h);
        var stranger = User.Create("Bo", "bo@example.com", "hash", h.Clock.UtcNow);
        h.Db.Users.Add(stranger);
        var preview = PreviewJob.Record("preview-1", "upload", null, "203.0.113.9", h.Clock.UtcNow);
        h.Db.PreviewJobs.Add(preview);
        await h.Db.SaveChangesAsync();

        var mine = await WatchQuery(h, owner.Id).Handle(new GetJobWatchQuery(job.JobId), default);
        var theirs = await WatchQuery(h, stranger.Id).Handle(new GetJobWatchQuery(job.JobId), default);
        var guest = await WatchQuery(h, null).Handle(new GetJobWatchQuery("preview-1", Preview: true), default);
        var jobAsPreview = await WatchQuery(h, null).Handle(new GetJobWatchQuery(job.JobId, Preview: true), default);

        Assert.Equal(new JobWatchState(false, $"user:{owner.Id}"), mine.Value);
        Assert.Equal(TranscriptionErrors.JobNotFound, theirs.Error);
        Assert.False(guest.Value.Ended);
        Assert.Equal(TranscriptionErrors.JobNotFound, jobAsPreview.Error);

        job.Settle(null, h.Clock.UtcNow);
        await h.Db.SaveChangesAsync();
        Assert.True((await WatchQuery(h, owner.Id).Handle(new GetJobWatchQuery(job.JobId), default)).Value.Ended);
    }

    // ── The worker's progress ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_workers_progress_reaches_the_jobs_watchers_in_the_apis_terms()
    {
        var events = new InMemoryJobEvents();
        using var watch = events.Watch("job-1", "user:a")!;
        var controller = Webhooks(
            """{"status":"pending","progress":0,"stage":"queued","queuePosition":2,"source":{"provider":"youtube","url":"u","title":"Abide","artist":"Choir","thumbnailUrl":null}}""",
            key: "worker-key");

        var answer = await controller.TranscriptionProgress("job-1", events, default);

        Assert.IsType<NoContentResult>(answer);
        Assert.True(watch.Events.TryRead(out var seen));
        Assert.Equal(JobEvent.Progress, seen.Name);
        Assert.Equal((TranscriptionStatus.Pending, "queued", 2, "Abide"),
            (seen.Job!.Status, seen.Job.Stage, seen.Job.QueuePosition, seen.Job.Source!.Title));
        Assert.Null(seen.Job.Result);
    }

    [Fact]
    public async Task Progress_needs_the_workers_key_and_is_not_read_when_nobody_watches()
    {
        var events = new InMemoryJobEvents();

        var wrongKey = await Webhooks("""{"status":"processing"}""", key: "guess").TranscriptionProgress("job-1", events, default);
        var unwatched = await Webhooks("not json at all", key: "worker-key").TranscriptionProgress("job-1", events, default);

        Assert.IsType<UnauthorizedResult>(wrongKey);
        Assert.IsType<NoContentResult>(unwatched);
    }

    [Fact]
    public async Task A_progress_post_that_is_not_one_is_refused()
    {
        var events = new InMemoryJobEvents();
        using var watch = events.Watch("job-1", "user:a")!;

        var garbled = await Webhooks("{\"status\":", key: "worker-key").TranscriptionProgress("job-1", events, default);
        var huge = await Webhooks(new string(' ', 20_000) + "{}", key: "worker-key").TranscriptionProgress("job-1", events, default);

        Assert.IsType<BadRequestResult>(garbled);
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, Assert.IsType<StatusCodeResult>(huge).StatusCode);
        Assert.False(watch.Events.TryRead(out _));
    }

    // ── The end, and the push ───────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Someone_watching_live_is_told_it_ended_and_not_pushed()
    {
        using var h = new TestHarness();
        var (_, job) = SeedJob(h);
        var events = new InMemoryJobEvents();
        using var watch = events.Watch(job.JobId, "user:a")!;

        await Notify(h, job, events, new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, Done()));

        Assert.True(watch.Events.TryRead(out var seen) && seen.Name == JobEvent.Ended);
        Assert.Empty(h.Push.Sent);
        Assert.Empty(h.WebPush.Sent);
        Assert.NotNull(job.SettledAtUtc);
    }

    [Fact]
    public async Task A_hidden_tab_is_told_and_its_owner_is_still_pushed()
    {
        using var h = new TestHarness();
        var (_, job) = SeedJob(h);
        var events = new InMemoryJobEvents();
        using var hidden = events.Watch(job.JobId, "user:a", away: true)!;

        await Notify(h, job, events, new TranscriptionJobDto(job.JobId, TranscriptionStatus.Failed, 1, null, "We couldn't hear any notes."));

        Assert.True(hidden.Events.TryRead(out var seen) && seen.Name == JobEvent.Ended);
        Assert.Single(h.Push.Sent);
        Assert.Single(h.WebPush.Sent);
    }

    [Fact]
    public async Task Nobody_watching_means_the_push_goes_as_before()
    {
        using var h = new TestHarness();
        var (_, job) = SeedJob(h);

        await Notify(h, job, new InMemoryJobEvents(), new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, Done()));

        Assert.Single(h.Push.Sent);
        Assert.Single(h.WebPush.Sent);
    }

    [Fact]
    public async Task A_visitor_watching_a_preview_is_told_it_ended()
    {
        using var h = new TestHarness();
        var preview = PreviewJob.Record("preview-1", "upload", null, "203.0.113.9", h.Clock.UtcNow);
        h.Db.PreviewJobs.Add(preview);
        await h.Db.SaveChangesAsync();
        var events = new InMemoryJobEvents();
        using var watch = events.Watch("preview-1", "ip:203.0.113.9")!;
        var api = Substitute.For<ITranscriptionApi>();
        api.GetJobAsync("preview-1", Arg.Any<CancellationToken>())
            .Returns(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto("preview-1", TranscriptionStatus.Done, 1, Done())));

        await new SettlePreviewJobCommandHandler(h.Db, api, h.Clock, events).Handle(new SettlePreviewJobCommand(preview.Id), default);

        Assert.True(watch.Events.TryRead(out var seen) && seen.Name == JobEvent.Ended);
    }

    // ── Answering a finished job ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_job_finished_long_ago_is_answered_from_our_copy_without_asking_the_worker()
    {
        using var h = new TestHarness();
        var (owner, job) = SeedJob(h);
        job.Settle(TranscriptionResultCache.Serialize(Done()), h.Clock.UtcNow);
        await h.Db.SaveChangesAsync();
        var api = Substitute.For<ITranscriptionApi>();
        api.GetJobAsync(job.JobId, Arg.Any<CancellationToken>())
            .Returns(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, Done())));
        var query = new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(owner.Id), h.Clock, h.QuotaGate);

        var fresh = await query.Handle(new GetTranscriptionJobQuery(job.JobId), default);
        h.Clock.UtcNow += TimeSpan.FromMinutes(20);
        var later = await query.Handle(new GetTranscriptionJobQuery(job.JobId), default);

        Assert.Equal(TranscriptionStatus.Done, fresh.Value.Status);
        Assert.Equal(TranscriptionStatus.Done, later.Value.Status);
        Assert.Equal("G major", later.Value.Result!.Key);
        await api.Received(1).GetJobAsync(job.JobId, Arg.Any<CancellationToken>());
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────

    private static TranscriptionJobDto Progress(string jobId, double progress, string? stage = null)
        => new(jobId, TranscriptionStatus.Processing, progress, null, Stage: stage);

    private static DefaultHttpContext NewResponse()
    {
        var http = new DefaultHttpContext();
        http.Response.Body = new MemoryStream();
        return http;
    }

    private static string Body(DefaultHttpContext http) => Encoding.UTF8.GetString(((MemoryStream)http.Response.Body).ToArray());

    private static List<(string Event, string Data)> Frames(DefaultHttpContext http)
        => Body(http).Split("\n\n", StringSplitOptions.RemoveEmptyEntries)
            .Where(f => !f.StartsWith(':'))
            .Select(f =>
            {
                var lines = f.Split('\n');
                return (lines[0]["event: ".Length..], lines[1]["data: ".Length..]);
            })
            .ToList();

    private static GetJobWatchQueryHandler WatchQuery(TestHarness h, Guid? caller)
        => new(h.Db, caller is null ? new StubCurrentUser() : new StubCurrentUser(caller), h.ClientIp);

    private static WebhookController Webhooks(string body, string key)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["TranscriptionApi:ApiKey"] = "worker-key" })
            .Build();
        var env = Substitute.For<IWebHostEnvironment>();
        env.EnvironmentName.Returns(Environments.Production);
        var controller = new WebhookController(Substitute.For<ISender>(), Substitute.For<IApplicationDbContext>(), config, env);
        var http = new DefaultHttpContext();
        var bytes = Encoding.UTF8.GetBytes(body);
        http.Request.Body = new MemoryStream(bytes);
        http.Request.ContentLength = bytes.Length;
        http.Request.Headers["X-Api-Key"] = key;
        controller.ControllerContext = new ControllerContext { HttpContext = http };
        return controller;
    }

    private static (User Owner, TranscriptionJob Job) SeedJob(TestHarness h)
    {
        var user = User.Create("Ada Obi", "ada@example.com", "hash", h.Clock.UtcNow.AddDays(-30));
        h.Db.Users.Add(user);
        var job = TranscriptionJob.Record("job-1", user.Id, h.Clock.UtcNow.AddMinutes(-2));
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();
        return (user, job);
    }

    private static TranscriptionResultDto Done() => new(
        "G major", 0.9, 96, "4/4", "<score-partwise version=\"4.0\" />", "",
        [new NoteEventDto(67, 0, 1, 5, "s", "", 0.95)], ["s"], 0.9, "");

    private static async Task Notify(TestHarness h, TranscriptionJob job, IJobEvents events, TranscriptionJobDto answer)
    {
        var api = Substitute.For<ITranscriptionApi>();
        api.GetJobAsync(job.JobId, Arg.Any<CancellationToken>()).Returns(Result<TranscriptionJobDto>.Success(answer));
        var notifier = new SignalRTranscriptionNotifier(
            Substitute.For<Microsoft.AspNetCore.SignalR.IHubContext<NoteFusion.Api.Hubs.TranscriptionHub, NoteFusion.Api.Hubs.ITranscriptionClient>>(),
            events);
        var done = await new NotifyTranscriptionReadyCommandHandler(h.Db, api, h.Clock, h.Push, notifier, h.WebPush, h.QuotaGate)
            .Handle(new NotifyTranscriptionReadyCommand(job.Id), default);
        Assert.True(done.IsSuccess);
    }
}
