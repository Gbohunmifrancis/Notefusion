using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common;
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
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.DeviceRegister, h.Activity(user.Id))
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "clip.m4a", TranscriptionMode.Melody, null, null),
                CancellationToken.None);

        Assert.Equal(TranscribePriority.High, api.LastOptions!.Priority);
    }

    // ---------------------------------------------------------------- song uploads

    [Fact]
    public async Task A_pro_song_upload_is_a_song_and_charged_when_it_finishes()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();

        var submitted = await SubmitUpload(h, user, api, separate: true);

        Assert.True(submitted.IsSuccess);
        var job = Assert.Single(h.Db.TranscriptionJobs);
        Assert.Equal(TranscriptionJobKind.Song, job.Kind);
        Assert.True(job.WasPro);
        Assert.Null(job.SongCreditConsumedAtUtc);
        Assert.Equal(20, (await Shown(h, user)).SongCreditsRemaining);

        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, submitted.Value, api);
        await Poll(h, user, submitted.Value, api);

        Assert.Equal(Now, h.Db.TranscriptionJobs.Single().SongCreditConsumedAtUtc);
        Assert.Null(h.Db.TranscriptionJobs.Single().TrialConsumedAtUtc);
        Assert.Equal(19, (await Shown(h, user)).SongCreditsRemaining);
    }

    [Fact]
    public async Task A_pro_account_is_refused_its_twenty_first_song_upload_this_month()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        SpendSongs(h, user, 20, pro: true);

        var result = await SubmitUpload(h, user, new FakeTranscriptionApi(), separate: true);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_SONG_CREDITS_EXHAUSTED", result.Error.Code);
    }

    [Fact]
    public async Task Links_and_song_uploads_share_the_monthly_allowance()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        SpendSongs(h, user, 19, pro: true);
        var api = new FakeTranscriptionApi();

        var song = await SubmitUpload(h, user, api, separate: true);
        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, song.Value, api);

        Assert.Equal(0, (await Shown(h, user)).SongCreditsRemaining);
        var link = await SubmitLink(h, user, api);
        Assert.Equal("BILLING_SONG_CREDITS_EXHAUSTED", link.Error.Code);
    }

    [Fact]
    public async Task A_pro_hum_upload_is_not_a_song_and_costs_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();

        var submitted = await SubmitUpload(h, user, api, separate: false);
        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, submitted.Value, api);

        var job = h.Db.TranscriptionJobs.Single();
        Assert.Equal(TranscriptionJobKind.Upload, job.Kind);
        Assert.Null(job.SongCreditConsumedAtUtc);
        Assert.Equal(20, (await Shown(h, user)).SongCreditsRemaining);
    }

    [Fact]
    public async Task A_free_accounts_song_upload_stays_a_trial_generation()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();

        var submitted = await SubmitUpload(h, user, api, separate: true);
        api.Status = TranscriptionStatus.Done;
        await Poll(h, user, submitted.Value, api);

        var job = h.Db.TranscriptionJobs.Single();
        Assert.Equal(TranscriptionJobKind.Upload, job.Kind);
        Assert.Null(job.SongCreditConsumedAtUtc);
        Assert.Equal(Now, job.TrialConsumedAtUtc);
        Assert.Equal(1, (await Shown(h, user)).SongCreditsRemaining); // the one link preview is untouched
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

    [Fact]
    public async Task Only_the_link_in_pasted_share_text_reaches_the_worker()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();

        var result = await SubmitLink(h, user, api,
            "Listen to Never Gonna Give You Up on Spotify: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc.");

        Assert.True(result.IsSuccess);
        Assert.Equal("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc", api.LastUrl);
    }

    [Theory]
    [InlineData("https://www.youtube.com/@RickAstleyYT")]
    [InlineData("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M")]
    public async Task A_link_that_is_not_a_song_is_refused_in_plain_words(string url)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();

        var result = await SubmitLink(h, user, api, url);

        Assert.Equal("TRANS_INVALID_LINK", result.Error.Code);
        Assert.Equal("Paste a link to a YouTube video, a Spotify track or an Apple Music song.", result.Error.Message);
        Assert.Null(api.LastOptions);
    }

    // ---------------------------------------------------------------- keyboard transpose and chords

    [Theory]
    [InlineData(-11)]
    [InlineData(-4)]
    [InlineData(0)]
    [InlineData(11)]
    public async Task The_keyboards_transpose_setting_goes_to_the_worker_with_an_upload_and_a_link(int transpose)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();

        await SubmitUpload(h, user, api, separate: false, keyboardTranspose: transpose);
        Assert.Equal(transpose, api.LastOptions!.KeyboardTranspose);

        await new SubmitLinkTranscriptionCommandHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.Activity(user.Id))
            .Handle(new SubmitLinkTranscriptionCommand(Link, TranscriptionMode.Chords, null, null, KeyboardTranspose: transpose), CancellationToken.None);
        Assert.Equal(transpose, api.LastOptions!.KeyboardTranspose);
        Assert.Equal(TranscriptionMode.Chords, api.LastOptions.Mode);
    }

    [Theory]
    [InlineData(12)]
    [InlineData(-12)]
    [InlineData(100)]
    public async Task A_transpose_setting_no_keyboard_has_is_refused_before_the_worker_is_asked(int transpose)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi();

        var upload = await SubmitUpload(h, user, api, separate: false, keyboardTranspose: transpose);
        var link = await new SubmitLinkTranscriptionCommandHandler(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.Activity(user.Id))
            .Handle(new SubmitLinkTranscriptionCommand(Link, TranscriptionMode.Melody, null, null, KeyboardTranspose: transpose), CancellationToken.None);

        Assert.Equal("TRANS_INVALID_KEYBOARD_TRANSPOSE", upload.Error.Code);
        Assert.Equal("TRANS_INVALID_KEYBOARD_TRANSPOSE", link.Error.Code);
        Assert.Equal("Keyboard transpose must be a whole number of semitones from -11 to 11.", upload.Error.Message);
        Assert.Null(api.LastOptions);
        Assert.Empty(h.Db.TranscriptionJobs);
    }

    [Theory]
    [InlineData(false, TranscriptionJobKind.Upload)]
    [InlineData(true, TranscriptionJobKind.Song)]
    public async Task A_chords_recording_is_a_song_only_when_its_voice_is_isolated(bool separate, TranscriptionJobKind kind)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new FakeTranscriptionApi();

        await new SubmitTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.DeviceRegister, h.Activity(user.Id))
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "keys.m4a", TranscriptionMode.Chords, null, null, Separate: separate),
                CancellationToken.None);

        Assert.Equal(TranscriptionMode.Chords, api.LastOptions!.Mode);
        Assert.Equal(kind, h.Db.TranscriptionJobs.Single().Kind);
    }

    [Fact]
    public async Task A_finished_jobs_chords_reach_the_client()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeTranscriptionApi { Status = TranscriptionStatus.Done };
        var jobId = (await SubmitLink(h, user, api)).Value;

        var result = await Poll(h, user, jobId, api);

        Assert.Equal("heard", result.Value.Result!.ChordsSource);
        Assert.Equal(["F", "Dm"], result.Value.Result.Chords!.Select(c => c.Symbol)); // chords are not a Pro extra

        // The cached copy keeps them for a poll after the worker has forgotten the job.
        var cached = TranscriptionResultCache.Deserialize(h.Db.TranscriptionJobs.Single().ResultJson!)!;
        Assert.Equal(result.Value.Result.Chords, cached.Chords);
        Assert.Equal("heard", cached.ChordsSource);
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
                api ?? new FakeTranscriptionApi(), h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.Activity(user.Id))
            .Handle(new SubmitLinkTranscriptionCommand(url, TranscriptionMode.Melody, null, null), CancellationToken.None);

    private static Task<Result<string>> SubmitUpload(TestHarness h, User user, FakeTranscriptionApi api, bool separate, int keyboardTranspose = 0)
        => new SubmitTranscriptionCommandHandler(
                api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubDeviceFingerprint(null), h.DeviceRegister, h.Activity(user.Id))
            .Handle(new SubmitTranscriptionCommand(new MemoryStream([1, 2, 3]), "song.m4a", TranscriptionMode.Melody, null, null, Separate: separate, KeyboardTranspose: keyboardTranspose),
                CancellationToken.None);

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
        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(null, null)));

        private int _next;

        public TranscriptionStatus Status { get; set; } = TranscriptionStatus.Pending;
        public string Midi { get; set; } = "";
        public TranscribeOptions? LastOptions { get; private set; }
        public string? LastUrl { get; private set; }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default)
        {
            LastOptions = options;
            return Task.FromResult(Result<string>.Success($"job-{++_next}"));
        }

        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default)
            => SubmitAsync(score, fileName, options, ct);

        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default)
        {
            LastUrl = url;
            return SubmitAsync(Stream.Null, url, options, ct);
        }

        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default)
        {
            var source = new SourceDto("youtube", Link, "Way Maker", "Sinach", null);
            var parts = new Dictionary<string, PartDto> { ["bass"] = new PartDto([], ["Doh is C · Bass"]) };
            var result = Status == TranscriptionStatus.Done
                ? new TranscriptionResultDto("C major", 0.9, 100, "4/4", "<score/>", Midi, [], ["d r m"], 0.8,
                    Source: source, SongDurationSec: 250, Truncated: true, Separated: true, Parts: parts, PartsMusicXml: "<satb/>",
                    Chords: [new ChordSymbolDto(0, 4, 5, "maj", null, "F", "d"), new ChordSymbolDto(4, 4, 2, "min", null, "Dm", "l")],
                    ChordsSource: "heard")
                : null;
            return Task.FromResult(Result<TranscriptionJobDto>.Success(
                new TranscriptionJobDto(jobId, Status, Status == TranscriptionStatus.Done ? 1 : 0.5, result, null, null, source)));
        }


        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default)
            => Task.FromResult(Result<GradeResultDto>.Success(new GradeResultDto(100, target.Notes.Count, 0, 0, 0, 0, 0, 0, "Spot on.", [])));

        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
