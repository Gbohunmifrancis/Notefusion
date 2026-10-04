using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview;
using NoteFusion.Application.Preview.Commands;
using NoteFusion.Application.Preview.Queries;
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
/// Choosing a section of a linked song. Before submitting, a client asks what the link points at and
/// how much of it this caller may have — thirty seconds anonymously, a minute on a free account, six
/// on Pro, the same figures the submit handlers cap with — then sends the start and end it picked. A
/// section is checked in plain words, pulled back to the song's end when the length is known, and
/// forwarded to the worker as it was chosen; a submit with no section is untouched.
/// </summary>
public class LinkSectionTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private const string Link = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    // ---------------------------------------------------------------- what the link points at

    [Fact]
    public async Task A_visitor_is_told_the_song_and_the_previews_thirty_seconds()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi { Duration = 213 };

        var info = await PreviewInfo(h, api).Handle(new GetPreviewLinkInfoQuery($"Listen: {Link}."), default);

        Assert.True(info.IsSuccess);
        Assert.Equal(PreviewLimits.Seconds, info.Value.MaxSeconds);
        Assert.Equal(213, info.Value.DurationSeconds);
        Assert.Equal("Way Maker", info.Value.Title);
        Assert.Equal("Sinach", info.Value.Artist);
        Assert.Equal(Link, api.LastResolved); // the link alone, without the words around it
        Assert.Empty(h.Db.PreviewJobs); // asking is not a preview
    }

    [Fact]
    public async Task A_free_account_is_told_its_minute_and_a_pro_account_its_six()
    {
        using var h = new TestHarness(Now);
        var free = Seed(h, "free@example.com");
        var pro = Seed(h, "pro@example.com");
        GoPro(h, pro);
        var api = new FakeApi { Duration = null };

        var forFree = await Info(h, free, api).Handle(new GetLinkInfoQuery(Link), default);
        var forPro = await Info(h, pro, api).Handle(new GetLinkInfoQuery(Link), default);

        Assert.Equal(SongCredits.FreePreviewSeconds, forFree.Value.MaxSeconds);
        Assert.Equal(SongCredits.ProMaxSeconds, forPro.Value.MaxSeconds);
        Assert.Null(forPro.Value.DurationSeconds); // a length the service does not know stays unknown
        Assert.Equal("youtube", forPro.Value.Provider);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not a link")]
    [InlineData("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")]
    public async Task A_link_that_is_not_a_song_is_refused_before_the_worker_is_asked(string url)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeApi();

        var signedIn = await Info(h, user, api).Handle(new GetLinkInfoQuery(url), default);
        var anonymous = await PreviewInfo(h, api).Handle(new GetPreviewLinkInfoQuery(url), default);

        Assert.Equal(TranscriptionErrors.InvalidLink, signedIn.Error);
        Assert.Equal(TranscriptionErrors.InvalidLink, anonymous.Error);
        Assert.Null(api.LastResolved);
    }

    [Fact]
    public async Task A_link_the_worker_cannot_read_is_an_invalid_link_and_a_worker_that_is_away_is_said_so()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var refused = await Info(h, user, new FakeApi { Resolve = TranscriptionErrors.InvalidLink }).Handle(new GetLinkInfoQuery(Link), default);
        var away = await Info(h, user, new FakeApi { Resolve = TranscriptionErrors.ServiceUnavailable }).Handle(new GetLinkInfoQuery(Link), default);

        Assert.Equal(TranscriptionErrors.InvalidLink, refused.Error);
        Assert.Equal(TranscriptionErrors.ServiceUnavailable, away.Error);
    }

    [Fact]
    public async Task Asking_anonymously_is_throttled_with_the_previews_but_does_not_spend_one()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi();
        for (var i = 0; i < PreviewLimits.PerDevicePerDay; i++)
            Assert.True((await PreviewInfo(h, api).Handle(new GetPreviewLinkInfoQuery(Link), default)).IsSuccess);
        Assert.Empty(h.Db.PreviewJobs);

        for (var i = 0; i < PreviewLimits.PerDevicePerDay; i++)
            h.Db.PreviewJobs.Add(PreviewJob.Record($"p{i}", "link", "browser-a", null, Now));
        h.Db.SaveChanges();

        var refused = await PreviewInfo(h, api).Handle(new GetPreviewLinkInfoQuery(Link), default);
        var other = await PreviewInfo(h, api, "browser-b").Handle(new GetPreviewLinkInfoQuery(Link), default);

        Assert.Equal("PREVIEW_LIMIT_REACHED", refused.Error.Code);
        Assert.True(other.IsSuccess);
    }

    // ---------------------------------------------------------------- the section a user picks

    [Fact]
    public async Task A_submit_without_a_section_is_as_before()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeApi();

        var result = await Submit(h, user, api);

        Assert.True(result.IsSuccess);
        Assert.Null(api.LastOptions!.StartSeconds);
        Assert.Null(api.LastOptions.EndSeconds);
        Assert.Equal(SongCredits.FreePreviewSeconds, api.LastOptions.MaxSeconds);
        Assert.Null(api.LastResolved); // nothing to check, so the worker is not asked
    }

    [Fact]
    public async Task The_section_reaches_the_worker_with_the_cap_unchanged()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeApi { Duration = 213 };

        var result = await Submit(h, user, api, start: 65, end: 95);

        Assert.True(result.IsSuccess);
        Assert.Equal(65, api.LastOptions!.StartSeconds);
        Assert.Equal(95, api.LastOptions.EndSeconds);
        Assert.Equal(SongCredits.ProMaxSeconds, api.LastOptions.MaxSeconds);
        Assert.Equal(TranscribePriority.High, api.LastOptions.Priority);
    }

    [Fact]
    public async Task A_start_alone_runs_from_there_to_the_cap()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeApi();

        var result = await Submit(h, user, api, start: 40);

        Assert.True(result.IsSuccess);
        Assert.Equal(40, api.LastOptions!.StartSeconds);
        Assert.Null(api.LastOptions.EndSeconds);
    }

    [Fact]
    public async Task An_end_past_the_song_is_pulled_back_to_its_length()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeApi { Duration = 213 };

        var result = await Submit(h, user, api, start: 180, end: 400);

        Assert.True(result.IsSuccess);
        Assert.Equal(180, api.LastOptions!.StartSeconds);
        Assert.Equal(213, api.LastOptions.EndSeconds);
    }

    [Fact]
    public async Task An_end_is_left_alone_when_the_length_is_not_known_or_the_worker_is_away()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);

        var unknown = new FakeApi { Duration = null };
        Assert.True((await Submit(h, user, unknown, start: 180, end: 400)).IsSuccess);
        Assert.Equal(400, unknown.LastOptions!.EndSeconds);

        var away = new FakeApi { Resolve = TranscriptionErrors.ServiceUnavailable };
        Assert.True((await Submit(h, user, away, start: 180, end: 400)).IsSuccess);
        Assert.Equal(400, away.LastOptions!.EndSeconds);
    }

    [Fact]
    public async Task A_section_is_checked_in_plain_words()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeApi { Duration = 213 };

        var early = await Submit(h, user, api, start: -1, end: 20);
        var backwards = await Submit(h, user, api, start: 60, end: 60);
        Assert.Null(api.LastResolved); // neither needs the song's length to be refused
        var tooLong = await Submit(h, user, api, start: 0, end: 61);
        var pastTheEnd = await Submit(h, user, api, start: 220, end: 230); // the song is 3:33 long
        var nowhere = await Submit(h, user, api, start: double.PositiveInfinity); // JSON's 1e999

        Assert.Equal("The section must start at 0:00 or later.", early.Error.Message);
        Assert.Equal("The section must end after it starts.", backwards.Error.Message);
        Assert.Equal("Pick up to 1:00 of the song.", tooLong.Error.Message);
        Assert.Equal("TRANS_SECTION_TOO_LONG", tooLong.Error.Code);
        Assert.Equal("Pick a section within the song.", pastTheEnd.Error.Message);
        Assert.Equal("Pick a section within the song.", nowhere.Error.Message);
        Assert.Null(api.LastOptions);
        Assert.Empty(h.Db.TranscriptionJobs);
    }

    [Fact]
    public async Task The_allowance_in_the_message_is_the_callers_own()
    {
        using var h = new TestHarness(Now);
        var pro = Seed(h);
        GoPro(h, pro);
        var api = new FakeApi { Duration = 600 };

        var forPro = await Submit(h, pro, api, start: 0, end: 361);
        var anonymous = await PreviewLink(h, api).Handle(new SubmitPreviewLinkCommand(Link, StartSeconds: 10, EndSeconds: 41), default);

        Assert.Equal("Pick up to 6:00 of the song.", forPro.Error.Message);
        Assert.Equal("Pick up to 0:30 of the song.", anonymous.Error.Message);
        Assert.Empty(h.Db.PreviewJobs);
    }

    [Fact]
    public async Task A_preview_takes_its_section_too()
    {
        using var h = new TestHarness(Now);
        var api = new FakeApi { Duration = 213 };

        var result = await PreviewLink(h, api).Handle(new SubmitPreviewLinkCommand(Link, StartSeconds: 65, EndSeconds: 95), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(65, api.LastOptions!.StartSeconds);
        Assert.Equal(95, api.LastOptions.EndSeconds);
        Assert.Equal(PreviewLimits.Seconds, api.LastOptions.MaxSeconds);
        Assert.Equal("link", h.Db.PreviewJobs.Single().Kind);
    }

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(30, "0:30")]
    [InlineData(65, "1:05")]
    [InlineData(213.4, "3:33")]
    [InlineData(360, "6:00")]
    [InlineData(3600, "1:00:00")]
    [InlineData(3725, "1:02:05")]
    public void Seconds_read_as_a_clock(double seconds, string clock)
        => Assert.Equal(clock, SongSections.Clock(seconds));

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
        var plan = Plan.Create(Guid.NewGuid(), $"pro_monthly_{user.Id:N}", "NoteFusion Pro", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), $"sub-{user.Id:N}", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    private static GetLinkInfoQueryHandler Info(TestHarness h, User user, FakeApi api)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock);

    private static GetPreviewLinkInfoQueryHandler PreviewInfo(TestHarness h, FakeApi api, string device = "browser-a")
        => new(api, h.Db, h.Clock, new StubDeviceFingerprint(device), h.ClientIp);

    private static SubmitPreviewLinkCommandHandler PreviewLink(TestHarness h, FakeApi api)
        => new(api, h.Db, h.Clock, new StubDeviceFingerprint("browser-a"), h.ClientIp);

    private static Task<Result<string>> Submit(TestHarness h, User user, FakeApi api, double? start = null, double? end = null)
        => new SubmitLinkTranscriptionCommandHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null))
            .Handle(new SubmitLinkTranscriptionCommand(Link, TranscriptionMode.Melody, null, null, StartSeconds: start, EndSeconds: end), default);

    private sealed class FakeApi : ITranscriptionApi
    {
        // Job ids are unique in the ledger, and a test may stand up more than one fake.
        private readonly string _stamp = Guid.NewGuid().ToString("N")[..8];
        private int _next;

        /// <summary>The song's length as the worker reports it; null when it does not know.</summary>
        public double? Duration { get; set; }

        /// <summary>Set to have the resolve fail this way instead of answering.</summary>
        public Error? Resolve { get; set; }

        public TranscribeOptions? LastOptions { get; private set; }
        public string? LastResolved { get; private set; }

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
        {
            LastResolved = url;
            return Task.FromResult(Resolve is { } error
                ? Result.Failure<SourceDto>(error)
                : Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", "https://i.ytimg.com/vi/x/hq.jpg", DurationSeconds: Duration)));
        }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
        {
            LastOptions = options;
            return Task.FromResult(Result<string>.Success($"job-{_stamp}-{++_next}"));
        }

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => SubmitAsync(score, fileName, options, ct);
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default) => SubmitAsync(Stream.Null, url, options, ct);
        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
