using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// Sing-along grading is Pro, and the API forwards the take: the audio is never stored, only the mark, as a part
/// practice that earns XP and counts toward the streak.
/// </summary>
public class GradeTakeTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);
    private static readonly GradeTargetDto Target = new([new(60, 0, 1), new(64, 1, 1)], 100, 2.4);

    [Fact]
    public async Task A_free_account_is_told_grading_is_pro()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new RecordingApi();

        var result = await Handler(h, user, api).Handle(new GradeTakeCommand(Stream.Null, "take.m4a", Target), default);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_PRO_REQUIRED", result.Error.Code);
        Assert.Null(api.LastTarget);
    }

    [Fact]
    public async Task A_pro_take_is_forwarded_with_its_part_and_the_marks_come_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new RecordingApi();

        var result = await Handler(h, user, api).Handle(new GradeTakeCommand(Stream.Null, "take.m4a", Target), default);

        Assert.True(result.IsSuccess);
        Assert.Equal(Target, api.LastTarget);
        Assert.Equal("take.m4a", api.LastFileName);
        Assert.Equal(100, result.Value.Score);
        Assert.Equal(2, result.Value.Hits);
        Assert.Empty(h.Db.TranscriptionJobs); // not a transcription
    }

    [Fact]
    public async Task A_marked_take_is_recorded_as_part_practice_and_its_reward_comes_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);

        var result = await Handler(h, user, new RecordingApi()).Handle(
            new GradeTakeCommand(Stream.Null, "take.m4a", Target, Part: "alto"), default);

        var session = Assert.Single(h.Db.PracticeSessions);
        Assert.Equal(PracticeKind.Part, session.Kind);
        Assert.Equal("A", session.Part);
        Assert.Equal(100, session.Score);
        Assert.Equal(2, session.Hits);
        Assert.Equal(2 * 60.0 / 100, session.DurationSec, 3);
        Assert.Null(session.TranscriptionId);
        Assert.False(session.WholePart);
        Assert.Equal(new DateOnly(2026, 8, 19), session.LocalDate);

        var reward = result.Value.Reward!;
        Assert.Equal(PracticeRules.PartXp + PracticeRules.PartGoodBonus, reward.XpGained);
        Assert.Equal(1, reward.Streak);
        Assert.Contains(reward.NewBadges, b => b.Code == "first_part");
        Assert.Contains(reward.NewBadges, b => b.Code == "first_100");
    }

    [Fact]
    public async Task A_refused_take_records_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var api = new RecordingApi { Refuse = true };

        var result = await Handler(h, user, api).Handle(new GradeTakeCommand(Stream.Null, "take.m4a", Target), default);

        Assert.True(result.IsFailure);
        Assert.Empty(h.Db.PracticeSessions);
    }

    [Fact]
    public async Task A_whole_part_of_the_singers_own_sheet_is_recorded_as_such()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var sheet = Sheet(h, user.Id, pitches: [60, 64]);

        var result = await Handler(h, user, new RecordingApi()).Handle(
            new GradeTakeCommand(Stream.Null, "take.m4a", Target, sheet.Id, "soprano"), default);

        var session = Assert.Single(h.Db.PracticeSessions);
        Assert.Equal(sheet.Id, session.TranscriptionId);
        Assert.Equal("S", session.Part);
        Assert.True(session.WholePart);
        Assert.Contains(result.Value.Reward!.NewBadges, b => b.Code == "whole_part_80");
    }

    [Fact]
    public async Task A_few_bars_of_a_part_are_not_the_whole_part()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var sheet = Sheet(h, user.Id, pitches: [60, 64, 67, 72]);

        await Handler(h, user, new RecordingApi()).Handle(new GradeTakeCommand(Stream.Null, "take.m4a", Target, sheet.Id, "S"), default);

        Assert.False(Assert.Single(h.Db.PracticeSessions).WholePart);
        Assert.Empty(h.Db.Achievements.Where(a => a.Code == "whole_part_80"));
    }

    [Fact]
    public async Task A_sheet_the_singer_cannot_open_is_not_recorded_against_them()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user);
        var stranger = User.Create("Stranger", "tenor@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(stranger);
        h.Db.SaveChanges();
        var theirs = Sheet(h, stranger.Id, pitches: [60, 64]);

        await Handler(h, user, new RecordingApi()).Handle(new GradeTakeCommand(Stream.Null, "take.m4a", Target, theirs.Id, "S"), default);

        var session = Assert.Single(h.Db.PracticeSessions);
        Assert.Null(session.TranscriptionId);
        Assert.False(session.WholePart);
    }

    [Theory]
    [InlineData("soprano", "S")]
    [InlineData("Alto", "A")]
    [InlineData("t", "T")]
    [InlineData("BASS", "B")]
    [InlineData("baritone", null)]
    [InlineData(null, null)]
    public void Parts_are_stored_as_their_letter(string? part, string? letter)
        => Assert.Equal(letter, GradeTakeCommandHandler.PartLetter(part));

    private static GradeTakeCommandHandler Handler(TestHarness h, User user, ITranscriptionApi api)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db));

    private static Transcription Sheet(TestHarness h, Guid owner, int[] pitches)
    {
        var sheet = new Transcription(
            owner, "Hymn", KeyParser.Parse("C major").Value, 100, "4/4", "<x/>",
            pitches.Select((p, i) => new NoteEvent { PitchMidi = p, StartBeat = i, DurationBeats = 1 }), 0.9);
        h.Db.Transcriptions.Add(sheet);
        h.Db.SaveChanges();
        return sheet;
    }

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
        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default)
            => Task.FromResult(Result<HarmonyDto>.Success(new HarmonyDto(null, null)));

        public GradeTargetDto? LastTarget { get; private set; }
        public bool Refuse { get; init; }
        public string? LastFileName { get; private set; }

        public Task<Result<NoteFusion.Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default)
        {
            LastTarget = target;
            LastFileName = fileName;
            if (Refuse)
                return Task.FromResult(Result.Failure<GradeResultDto>(Error.Validation("Api.Grade", "The take could not be read.")));
            return Task.FromResult(Result<GradeResultDto>.Success(new GradeResultDto(100, target.Notes.Count, 0, 0, 0, 4.0, 0.12, 0, "Spot on.",
                target.Notes.Select((n, i) => new GradeNoteDto(i, n.PitchMidi, n.PitchMidi, 4.0, "hit")).ToList())));
        }

        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default)
            => Task.FromResult(Result<SourceDto>.Success(new SourceDto("youtube", url, "Way Maker", "Sinach", null)));

        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result<int>.Success(1));
    }
}
