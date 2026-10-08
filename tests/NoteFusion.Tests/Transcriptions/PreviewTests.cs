using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Preview.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The website's try-it-free preview: anonymous, thirty seconds, throttled per browser, handed over
/// as a free account would see it, and claimable by the account it turns into.
/// </summary>
public class PreviewTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_preview_is_capped_at_thirty_seconds_and_recorded_against_the_browser()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();

        var result = await Upload(h, api, "browser-a").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(PreviewLimits.Seconds, api.LastOptions!.MaxSeconds);
        Assert.Equal(TranscribePriority.Normal, api.LastOptions.Priority);
        var row = Assert.Single(h.Db.PreviewJobs);
        Assert.Equal(result.Value, row.JobId);
        Assert.Equal("browser-a", row.DeviceFingerprint);
        Assert.Equal("upload", row.Kind);
    }

    [Fact]
    public async Task A_browser_gets_five_previews_a_day_then_is_asked_to_sign_up()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();
        for (var i = 0; i < PreviewLimits.PerDevicePerDay; i++)
            Assert.True((await Upload(h, api, "browser-a").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default)).IsSuccess);

        var refused = await Upload(h, api, "browser-a").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default);
        var other = await Upload(h, api, "browser-b").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default);

        Assert.Equal("PREVIEW_LIMIT_REACHED", refused.Error.Code);
        Assert.True(other.IsSuccess);

        // Tomorrow the allowance is back.
        h.Clock.UtcNow = Now.AddDays(1).AddMinutes(1);
        Assert.True((await Upload(h, api, "browser-a").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default)).IsSuccess);
    }

    [Fact]
    public async Task A_link_preview_goes_through_the_link_route_with_the_same_cap()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();

        var bad = await Link(h, api).Handle(new SubmitPreviewLinkCommand("not a link"), default);
        var channel = await Link(h, api).Handle(new SubmitPreviewLinkCommand("https://www.youtube.com/@RickAstleyYT"), default);
        var ok = await Link(h, api).Handle(new SubmitPreviewLinkCommand("Check this out https://youtu.be/dQw4w9WgXcQ."), default);

        Assert.Equal("TRANS_INVALID_LINK", bad.Error.Code);
        Assert.Equal("TRANS_INVALID_LINK", channel.Error.Code);
        Assert.True(ok.IsSuccess);
        // Only the link goes to the worker, without the words around it or the sentence's full stop.
        Assert.Equal("https://youtu.be/dQw4w9WgXcQ", api.LastLink);
        Assert.Equal(PreviewLimits.Seconds, api.LastOptions!.MaxSeconds);
        Assert.Equal("link", h.Db.PreviewJobs.Single().Kind);
    }

    [Fact]
    public async Task Polling_strips_the_pro_half_marks_completion_and_refuses_a_job_that_is_not_a_preview()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi { Status = TranscriptionStatus.Done };
        var submitted = await Upload(h, api, "browser-a").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default);

        var poll = await new GetPreviewJobQueryHandler(api, h.Db, h.Clock).Handle(new GetPreviewJobQuery(submitted.Value), default);
        var stranger = await new GetPreviewJobQueryHandler(api, h.Db, h.Clock).Handle(new GetPreviewJobQuery("job-of-someone-else"), default);

        Assert.True(poll.IsSuccess);
        Assert.Equal(string.Empty, poll.Value.Result!.MidiBase64);
        Assert.Null(poll.Value.Result.Parts);
        Assert.Equal(3, poll.Value.Result.Notes.Count); // the notes, solfa and staff are theirs to read
        Assert.Equal("TRANS_JOB_NOT_FOUND", stranger.Error.Code);
        var row = h.Db.PreviewJobs.Single();
        Assert.True(row.Succeeded);
        Assert.Equal(Now, row.CompletedAtUtc);
        Assert.Equal("Way Maker", row.SourceTitle);
    }

    [Fact]
    public async Task A_new_account_claims_its_preview_once()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();
        var submitted = await Upload(h, api, "browser-a").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default);
        var user = User.Create("Ada", "ada@example.com", h.Hasher.Hash("password123"), Now);
        var other = User.Create("Bob", "bob@example.com", h.Hasher.Hash("password123"), Now);
        h.Db.Users.AddRange(user, other);
        h.Db.SaveChanges();

        var first = await new ClaimPreviewCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock).Handle(new ClaimPreviewCommand(submitted.Value), default);
        var second = await new ClaimPreviewCommandHandler(h.Db, new StubCurrentUser(other.Id), h.Clock).Handle(new ClaimPreviewCommand(submitted.Value), default);
        var unknown = await new ClaimPreviewCommandHandler(h.Db, new StubCurrentUser(other.Id), h.Clock).Handle(new ClaimPreviewCommand("old-tab"), default);

        Assert.True(first.IsSuccess && second.IsSuccess && unknown.IsSuccess);
        Assert.Equal(user.Id, h.Db.PreviewJobs.Single().ClaimedByUserId);
    }

    [Fact]
    public async Task A_previews_mode_and_keyboard_transpose_reach_the_worker()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();

        var upload = await Upload(h, api, "browser-a")
            .Handle(new SubmitPreviewCommand(Stream.Null, "keys.webm", Mode: TranscriptionMode.Chords, KeyboardTranspose: -4), default);
        Assert.True(upload.IsSuccess);
        Assert.Equal(TranscriptionMode.Chords, api.LastOptions!.Mode);
        Assert.Equal(-4, api.LastOptions.KeyboardTranspose);
        Assert.Equal(PreviewLimits.Seconds, api.LastOptions.MaxSeconds);

        var link = await Link(h, api).Handle(new SubmitPreviewLinkCommand("https://youtu.be/dQw4w9WgXcQ", KeyboardTranspose: 3), default);
        Assert.True(link.IsSuccess);
        Assert.Equal(3, api.LastOptions!.KeyboardTranspose);

        // A plain hum sends the defaults the worker already assumes.
        await Upload(h, api, "browser-b").Handle(new SubmitPreviewCommand(Stream.Null, "hum.webm"), default);
        Assert.Equal(TranscriptionMode.Melody, api.LastOptions!.Mode);
        Assert.Equal(0, api.LastOptions.KeyboardTranspose);
    }

    [Fact]
    public async Task A_transpose_setting_no_keyboard_has_is_refused_before_a_preview_is_spent()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();

        var upload = await Upload(h, api, "browser-a").Handle(new SubmitPreviewCommand(Stream.Null, "keys.webm", KeyboardTranspose: 12), default);
        var link = await Link(h, api).Handle(new SubmitPreviewLinkCommand("https://youtu.be/dQw4w9WgXcQ", KeyboardTranspose: -12), default);

        Assert.Equal("TRANS_INVALID_KEYBOARD_TRANSPOSE", upload.Error.Code);
        Assert.Equal("TRANS_INVALID_KEYBOARD_TRANSPOSE", link.Error.Code);
        Assert.Null(api.LastOptions);
        Assert.Empty(h.Db.PreviewJobs);
    }

    private static SubmitPreviewCommandHandler Upload(TestHarness h, FakeApi api, string device)
        => new(api, h.Db, h.Clock, new StubDeviceFingerprint(device), h.ClientIp, h.Activity());

    private static SubmitPreviewLinkCommandHandler Link(TestHarness h, FakeApi api)
        => new(api, h.Db, h.Clock, new StubDeviceFingerprint("browser-a"), h.ClientIp, h.Activity());

    private sealed class FakeApi : ITranscriptionApi
    {
        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(null, null)));

        private int _next;
        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public TranscribeOptions? LastOptions { get; private set; }
        public string? LastLink { get; private set; }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
        {
            LastOptions = options;
            return Task.FromResult(Result<string>.Success($"preview-{++_next}"));
        }

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
        {
            LastLink = url;
            return SubmitAsync(Stream.Null, url, options, ct);
        }

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            var source = new SourceDto("youtube", "https://youtu.be/abc", "Way Maker", "Sinach", null);
            var parts = new Dictionary<string, PartDto> { ["bass"] = new PartDto([], []) };
            var result = Status == TranscriptionStatus.Done
                ? new TranscriptionResultDto("C major", 0.9, 100, "4/4", "<score/>", "TVRoZA==",
                    [new(60, 0, 1, 1, "d", "", 0.9), new(64, 1, 1, 3, "m", "", 0.9), new(67, 2, 1, 5, "s", "", 0.9)],
                    ["Doh is C", "| d m s |"], 0.9, Source: source, Truncated: true, SongDurationSec: 200, Parts: parts, PartsMusicXml: "<satb/>")
                : null;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(new TranscriptionJobDto(jobId, Status, Status == TranscriptionStatus.Done ? 1 : 0.3, result, null, null, source)));
        }

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
