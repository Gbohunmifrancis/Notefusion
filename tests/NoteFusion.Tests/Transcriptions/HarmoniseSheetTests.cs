using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// Four-part harmony is written on request and is Pro: the API gates and forwards, and nothing is
/// stored here. A transcription itself never asks the worker for parts.
/// </summary>
public class HarmoniseSheetTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private static readonly List<NoteEventDto> Twinkle =
        [new(60, 0, 1, 1, "d", "", 1), new(60, 1, 1, 1, "d", "", 1), new(67, 2, 1, 5, "s", "", 1), new(67, 3, 1, 5, "s", "", 1)];

    [Fact]
    public async Task A_free_account_gets_one_harmony_and_is_then_told_it_is_pro()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi();

        var first = await Handler(h, user, api).Handle(new HarmoniseSheetCommand("C major", 100, "4/4", Twinkle), default);
        Assert.True(first.IsSuccess);
        Assert.NotNull(first.Value.Parts);
        Assert.Equal(Now, h.Db.Users.Single(u => u.Id == user.Id).FreeHarmonyUsedAtUtc);

        api.Reset();
        var second = await Handler(h, user, api).Handle(new HarmoniseSheetCommand("C major", 100, "4/4", Twinkle), default);
        Assert.True(second.IsFailure);
        Assert.Equal("BILLING_PRO_REQUIRED", second.Error.Code);
        Assert.Null(api.LastKey); // refused before the worker is asked
    }

    [Fact]
    public async Task A_harmony_that_writes_no_parts_does_not_spend_the_free_one()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi { NoParts = true };

        await Handler(h, user, api).Handle(new HarmoniseSheetCommand("C major", 100, "4/4", Twinkle), default);

        Assert.Null(h.Db.Users.Single(u => u.Id == user.Id).FreeHarmonyUsedAtUtc);
    }

    [Fact]
    public async Task A_pro_account_never_spends_the_free_harmony()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);

        await Handler(h, user, new RecordingApi()).Handle(new HarmoniseSheetCommand("C major", 100, "4/4", Twinkle), default);

        Assert.Null(h.Db.Users.Single(u => u.Id == user.Id).FreeHarmonyUsedAtUtc);
    }

    [Fact]
    public async Task A_pro_request_is_forwarded_and_the_parts_come_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new RecordingApi();

        var result = await Handler(h, user, api).Handle(new HarmoniseSheetCommand("C major", 100, "4/4", Twinkle), default);

        Assert.True(result.IsSuccess);
        Assert.Equal("C major", api.LastKey);
        Assert.Equal(4, api.LastNotes!.Count);
        Assert.Equal(["alto", "bass", "soprano", "tenor"], result.Value.Parts!.Keys.Order());
        Assert.Equal("<satb/>", result.Value.PartsMusicXml);
        Assert.Empty(h.Db.TranscriptionJobs);
    }

    [Fact]
    public async Task An_unreadable_key_is_refused_before_the_worker_is_asked()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new RecordingApi();

        var result = await Handler(h, user, api).Handle(new HarmoniseSheetCommand("H sharp lydian", 100, "4/4", Twinkle), default);

        Assert.True(result.IsFailure);
        Assert.Null(api.LastKey);
    }

    [Fact]
    public void Shapes_that_would_run_for_ever_are_refused_before_the_worker_is_asked()
    {
        var validator = new HarmoniseSheetCommandValidator();
        var note = new NoteEventDto(60, 0, 1, 1, "d", "", 1);

        Assert.True(validator.Validate(new HarmoniseSheetCommand("C major", 100, "4/4", [note])).IsValid);
        Assert.False(validator.Validate(new HarmoniseSheetCommand("C major", 100, "4/4", [note, note with { StartBeat = 1e9 }])).IsValid);
        Assert.False(validator.Validate(new HarmoniseSheetCommand("C major", 100, "4/4", [note with { StartBeat = -1 }])).IsValid);
        Assert.False(validator.Validate(new HarmoniseSheetCommand("C major", 100, "4/4", [note with { DurBeats = 0 }])).IsValid);
        Assert.False(validator.Validate(new HarmoniseSheetCommand("C major", 100, "4/4", Enumerable.Repeat(note, 5001).ToList())).IsValid);
    }

    /// <summary>
    /// What the web sends now that the worker reads the meter: a 3/4 sheet whose notes a pickup moved into
    /// the first bar (the tune starts on beat 2), dotted lengths, and the hymnbook version's own meters.
    /// The shapes are the real worker's output for a sung hymn take (Belmont, 3/4 with a two-beat pickup).
    /// </summary>
    [Theory]
    [InlineData("3/4")]
    [InlineData("6/8")]
    [InlineData("6/4")]
    [InlineData("3/2")]
    [InlineData("2/2")]
    public void A_sheet_the_worker_wrote_with_a_meter_and_a_pickup_is_accepted(string meter)
    {
        var validator = new HarmoniseSheetCommandValidator();
        List<NoteEventDto> pickup =
        [
            new(54, 2, 1, 5, "s", ",", 0.938), new(59, 3, 2, 1, "d", "", 0.95), new(61, 5, 1, 2, "r", "", 0.9),
            new(63, 6, 1.5, 3, "m", "", 0.9), new(61, 7.5, 0.5, 2, "r", "", 0.9), new(59, 8, 3, 1, "d", "", 0.9),
        ];

        var verdict = validator.Validate(new HarmoniseSheetCommand("B major", 100, meter, pickup));

        Assert.True(verdict.IsValid, string.Join("; ", verdict.Errors.Select(e => e.ErrorMessage)));
    }

    [Fact]
    public void A_transcription_does_not_ask_for_parts_unless_told_to()
    {
        Assert.False(new TranscribeOptions().Harmony);
    }

    private static HarmoniseSheetCommandHandler Handler(TestHarness h, User user, ITranscriptionApi api)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock, h.QuotaGate);

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Chorister", "alto@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void GoPro(TestHarness h, User user)
    {
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro", 999, "USD", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(user.Id, plan.Id, PaymentProvider.Paystack, Now.AddDays(-3), Now.AddDays(27), "prov-sub-1", Now.AddDays(-3)));
        h.Db.SaveChanges();
    }

    private sealed class RecordingApi : ITranscriptionApi
    {
        public string? LastKey { get; private set; }
        public IReadOnlyList<NoteEventDto>? LastNotes { get; private set; }
        public bool NoParts { get; init; }
        public void Reset() { LastKey = null; LastNotes = null; }

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
        {
            LastKey = key;
            LastNotes = notes;
            if (NoParts) return Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(null, null)));
            var parts = new[] { "soprano", "alto", "tenor", "bass" }.ToDictionary(v => v, v => new PartDto(notes, ["Doh is C · " + v]));
            return Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(parts, "<satb/>")));
        }

        public Task<Result<NoteFusion.Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
