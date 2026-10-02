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
/// Linked songs: who may submit one, how much of it they get, which lane it runs in, and what it costs.
/// A song is metered apart from the free transcription trial — twenty full songs a month on Pro, one
/// short preview ever on free — and charged only when it finishes, so a link the platform refuses costs
/// nothing. Downloads are Pro, so a free account's finished job comes back without its MIDI.
/// </summary>
public class LinkTranscriptionTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private const string Link = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    // ---------------------------------------------------------------- the free preview

    [Fact]
    public async Task A_free_account_gets_one_one_minute_preview_in_the_normal_lane()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();

        var result = await SubmitLink(h, user, api);

        Assert.True(result.IsSuccess);
        Assert.Equal(SongCredits.FreePreviewSeconds, api.LastOptions!.MaxSeconds);
        Assert.Equal(TranscribePriority.Normal, api.LastOptions.Priority);
        var job = Assert.Single(h.Db.TranscriptionJobs);
        Assert.Equal(TranscriptionJobKind.Link, job.Kind);
        Assert.False(job.WasPro);
        Assert.Null(job.SongCreditConsumedAtUtc); // nothing has finished yet
    }

    [Fact]
    public async Task The_preview_is_charged_when_it_finishes_and_only_once()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await SubmitLink(h, user, api)).Value;

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, jobId, api);
        await Poll(h, user, jobId, api);

        var job = h.Db.TranscriptionJobs.Single();
        Assert.Equal(Now, job.SongCreditConsumedAtUtc);
        // A song is its own allowance, never one of the free recordings.
        Assert.Null(job.TrialConsumedAtUtc);
        Assert.Equal(0, (await Shown(h, user)).SongCreditsRemaining);
    }

    [Fact]
    public async Task A_second_preview_is_refused_with_an_upgrade_hint()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        SpendSongs(h, user, 1, pro: false);

        var result = await SubmitLink(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_SONG_PREVIEW_USED", result.Error.Code);
    }

    [Fact]
    public async Task A_preview_that_fails_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();
        var jobId = (await SubmitLink(h, user, api)).Value;

        api.Status = TranscriptionStatus.Failed;
        await Poll(h, user, jobId, api);

        Assert.Null(h.Db.TranscriptionJobs.Single().SongCreditConsumedAtUtc);
        Assert.Equal(1, (await Shown(h, user)).SongCreditsRemaining);
    }

    [Fact]
    public async Task A_free_accounts_finished_song_comes_back_without_its_midi()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done, Midi = "TVRoZA==" };
        var jobId = (await SubmitLink(h, user, api)).Value;

        var result = await Poll(h, user, jobId, api);

        Assert.Equal(string.Empty, result.Value.Result!.MidiBase64);
        Assert.Null(result.Value.Result.Parts); // the harmony is Pro
        Assert.Equal("Way Maker", result.Value.Result.Source!.Title); // the acknowledgement is theirs to see
    }

    // ---------------------------------------------------------------- the Pro allowance

    [Fact]
    public async Task A_pro_account_gets_six_minutes_in_the_fast_lane()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();

        var result = await SubmitLink(h, user, api);

        Assert.True(result.IsSuccess);
        Assert.Equal(SongCredits.ProMaxSeconds, api.LastOptions!.MaxSeconds);
        Assert.Equal(TranscribePriority.High, api.LastOptions.Priority);
        Assert.True(h.Db.TranscriptionJobs.Single().WasPro);
    }

    [Fact]
    public async Task A_pro_account_is_refused_its_twenty_first_song_this_month()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        SpendSongs(h, user, SongCredits.ProMonthlyAllowance, pro: true);

        var result = await SubmitLink(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_SONG_CREDITS_EXHAUSTED", result.Error.Code);
        Assert.Contains("20", result.Error.Message);
    }

    [Fact]
    public async Task Last_months_songs_do_not_count_against_this_month()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        SpendSongs(h, user, SongCredits.ProMonthlyAllowance, pro: true, at: Now.AddMonths(-1));

        Assert.True((await SubmitLink(h, user)).IsSuccess);
        Assert.Equal(SongCredits.ProMonthlyAllowance, (await Shown(h, user)).SongCreditsTotal);
        Assert.Equal(SongCredits.ProMonthlyAllowance, (await Shown(h, user)).SongCreditsRemaining);
    }

    [Fact]
    public async Task A_pro_accounts_finished_song_keeps_its_midi_and_spends_no_trial()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done, Midi = "TVRoZA==" };
        var jobId = (await SubmitLink(h, user, api)).Value;

        var result = await Poll(h, user, jobId, api);

        Assert.Equal("TVRoZA==", result.Value.Result!.MidiBase64);
        Assert.NotNull(result.Value.Result.Parts);
        Assert.Equal("<satb/>", result.Value.Result.PartsMusicXml);
        var job = h.Db.TranscriptionJobs.Single();
        Assert.Equal(Now, job.SongCreditConsumedAtUtc);
        Assert.Null(job.TrialConsumedAtUtc);
    }

    [Fact]
    public async Task A_pro_upload_takes_the_fast_lane_too()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();

        await new SubmitTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.DeviceRegister)
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null),
                CancellationToken.None);

        Assert.Equal(TranscribePriority.High, api.LastOptions!.Priority);
    }

    // ---------------------------------------------------------------- input

    [Theory]
    [InlineData("")]
    [InlineData("not a link")]
    [InlineData("ftp://example.com/song")]
    public async Task A_link_that_is_not_a_url_is_refused_before_the_worker_is_asked(string url)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();

        var result = await SubmitLink(h, user, api, url);

        Assert.True(result.IsFailure);
        Assert.Equal("TRANS_INVALID_LINK", result.Error.Code);
        Assert.Null(api.LastOptions);
    }

    // ---------------------------------------------------------------- fixtures

    private static User Seed(TestHarness h, string email = "free@example.com")
    {
        var user = User.Create("Free User", email, h.Hasher.Hash("password123"), Now.AddDays(-30));
        user.RecordCountry("GB");
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack,
            Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    private static void SpendSongs(TestHarness h, User user, int count, bool pro, DateTime? at = null)
    {
        for (var i = 0; i < count; i++)
        {
            var job = TranscriptionJob.RecordLink($"song-{user.Id}-{i}-{at:yyyyMM}", user.Id, (at ?? Now).AddHours(-1), null, pro);
            job.ConsumeSongCredit(at ?? Now);
            h.Db.TranscriptionJobs.Add(job);
        }

        h.Db.SaveChanges();
    }

    private static Task<Result<string>> SubmitLink(
        TestHarness h, User user, FakeTranscriptionApi? api = null, string url = Link)
        => new SubmitLinkTranscriptionCommandHandler(
                api ?? new FakeTranscriptionApi(), h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null))
            .Handle(new SubmitLinkTranscriptionCommand(url, TranscriptionMode.Melody, null, null), CancellationToken.None);

    private static Task<Result<TranscriptionJobDto>> Poll(
        TestHarness h, User user, string jobId, FakeTranscriptionApi api)
        => new GetTranscriptionJobQueryHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new GetTranscriptionJobQuery(jobId), CancellationToken.None);

    private static async Task<Application.Billing.Dtos.SubscriptionDto> Shown(TestHarness h, User user)
        => (await new GetMySubscriptionQueryHandler(
                h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null))
            .Handle(new GetMySubscriptionQuery(), CancellationToken.None))
            .Value;

    private sealed class FakeTranscriptionApi : ITranscriptionApi
    {
        private int _next;

        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public string Midi { get; set; } = "";
        public TranscribeOptions? LastOptions { get; private set; }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
        {
            LastOptions = options;
            return Task.FromResult(Result<string>.Success($"job-{++_next}"));
        }

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(Stream.Null, url, options, ct);

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            var source = new SourceDto("youtube", Link, "Way Maker", "Sinach", null);
            var parts = new Dictionary<string, PartDto> { ["bass"] = new PartDto([], ["Doh is C · Bass"]) };
            var result = Status == TranscriptionStatus.Done
                ? new TranscriptionResultDto("C major", 0.9, 100, "4/4", "<score/>", Midi, [], ["d r m"], 0.8,
                    Source: source, SongDurationSec: 250, Truncated: true, Separated: true, Parts: parts, PartsMusicXml: "<satb/>")
                : null;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, Status == TranscriptionStatus.Done ? 1 : 0.5, result, null, null, source)));
        }


        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => Task.FromResult(Result<GradeResultDto>.Success(new GradeResultDto(100, target.Notes.Count, 0, 0, 0, 0, 0, 0, "Spot on.", [])));

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
