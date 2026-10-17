using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// Practice tracks: Playful and Focused choose the path's drills and how a take is shown, never the numbers. The slices
/// of the catalogue each offers, the Focused-only grades, the gentle pace, PUT /api/practice/track, the mid-day switch,
/// and XP, levels, streaks and badges being the same whichever track a singer is on.
/// </summary>
public class PracticeTrackTests
{
    // 19:00 in Lagos, Saturday 17 October.
    private static readonly DateTime Now = new(2026, 10, 17, 18, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 10, 17);

    // ── The slices ──────────────────────────────────────────────────────────

    [Fact]
    public void Playful_offers_short_plain_major_drills_and_no_chromatics_until_grade_seven()
    {
        var playful = DrillCatalogue.Patterns.Where(DrillCatalogue.IsPlayful).ToList();

        Assert.All(playful, p =>
        {
            Assert.InRange(p.Tier, 0, PracticeRules.PlayfulTopTier);
            Assert.InRange(p.Step, 1, PracticeRules.PlayfulTopStep);
            Assert.InRange(p.Tokens.Count, 3, PracticeRules.PlayfulMaxNotes);
            Assert.Equal(KeyMode.Major, p.Mode);
            Assert.True((DrillCatalogue.RhythmOf(p) & ~DrillRhythm.Minims) == 0, p.Code);
            if (p.Tier < PracticeRules.PlayfulChromaticTier)
                Assert.DoesNotContain(p.Tokens, t => t.TrimEnd('\'', ',') is "de" or "fe" or "ta" or "se");
        });
        Assert.Contains(playful, p => p.Tier == PracticeRules.PlayfulChromaticTier && DrillCatalogue.IsChromatic(p));
        for (var tier = 0; tier <= PracticeRules.PlayfulTopTier; tier++)
            Assert.True(playful.Count(p => p.Tier == tier) >= 3, $"Playful has few drills in grade {tier + 1}");

        // Playful starts at the level's grade and never climbs past Grade 7.
        for (var level = 0; level < 12; level++)
            Assert.Equal(Math.Min(level, PracticeRules.PlayfulTopTier), DrillCatalogue.TierFor(PracticeTrack.Playful, level));
        Assert.Equal(5, PracticeRules.PlayfulMaxNotes);
        Assert.Equal(6, PracticeRules.PlayfulTopTier);
    }

    [Fact]
    public void Focused_starts_two_grades_ahead_and_reaches_grades_no_other_track_offers()
    {
        for (var level = 0; level < 12; level++)
        {
            Assert.Equal(Math.Min(level + PracticeRules.FocusedTierLead, DrillCatalogue.TopTier), DrillCatalogue.TierFor(PracticeTrack.Focused, level));
            // Without a track the ladder is as it was: the level's own grade, never above Grade 8.
            Assert.Equal(Math.Min(level, DrillCatalogue.LadderTopTier), DrillCatalogue.TierFor(null, level));
        }

        Assert.Equal(PracticeRules.Levels.Count - 1 + 2, DrillCatalogue.TopTier);
        Assert.Equal(DrillCatalogue.LadderTopTier + 1, DrillCatalogue.TierFor(PracticeTrack.Focused, 6));
        Assert.Equal(DrillCatalogue.TopTier, DrillCatalogue.TierFor(PracticeTrack.Focused, 7));
        Assert.Equal(2, DrillCatalogue.TierFor(PracticeTrack.Focused, 0)); // a beginner who wants the work starts on scales
        Assert.Equal(0, DrillCatalogue.TierFor(PracticeTrack.Playful, -3));
        Assert.DoesNotContain(PracticePath.UnitsFor(null), u => u.Tier > DrillCatalogue.LadderTopTier);
        Assert.Contains(PracticePath.UnitsFor(PracticeTrack.Focused), u => u.Tier == DrillCatalogue.TopTier);
    }

    [Fact]
    public void The_focused_tiers_hold_sixths_sevenths_minor_lines_through_se_and_long_phrases()
    {
        var wide = DrillCatalogue.Patterns.Where(p => p.Tier == DrillCatalogue.LadderTopTier + 1).ToList();
        var sight = DrillCatalogue.Patterns.Where(p => p.Tier == DrillCatalogue.TopTier).ToList();
        var leaps = wide.SelectMany(p => Leaps(DrillCatalogue.Offsets(p))).ToHashSet();

        Assert.Contains(8, leaps);  // a minor sixth
        Assert.Contains(9, leaps);  // a major sixth
        Assert.Contains(10, leaps); // a minor seventh
        Assert.Contains(11, leaps); // a major seventh
        Assert.Contains(wide, p => p.Mode == KeyMode.Minor && p.Tokens.Any(t => t.TrimEnd(',', '\'') == "se"));

        Assert.All(sight, p => Assert.InRange(p.Tokens.Count, 8, DrillCatalogue.MaxNotes));
        Assert.Contains(sight, p => p.Tokens.Count == DrillCatalogue.MaxNotes);
        Assert.Contains(sight, p => p.Tokens.Contains("fe")); // turning to soh
        Assert.Contains(sight, p => p.Tokens.Contains("ta")); // turning to fah

        // Nothing above the ladder is offered without choosing Focused.
        Assert.All(wide.Concat(sight), p => Assert.False(DrillCatalogue.IsPlayful(p)));
    }

    public static TheoryData<string, int> EveryPlayfulPlacement()
    {
        var data = new TheoryData<string, int>();
        foreach (var pattern in DrillCatalogue.Patterns.Where(DrillCatalogue.IsPlayful))
            foreach (var doh in DrillCatalogue.Placements(pattern))
                data.Add(pattern.Code, doh);
        return data;
    }

    [Theory]
    [MemberData(nameof(EveryPlayfulPlacement))]
    public void A_gentle_drill_is_the_same_notes_slower_and_is_found_again_by_its_id(string code, int doh)
    {
        var pattern = DrillCatalogue.Patterns.Single(p => p.Code == code);
        var plain = DrillCatalogue.Build(pattern, doh);

        var gentle = DrillCatalogue.Build(pattern, doh, gentle: true);

        Assert.Equal(plain.Notes, gentle.Notes);
        Assert.Equal(pattern.Tokens, gentle.Notes.Select(n => n.Solfa + n.OctaveMark));
        Assert.Equal(plain.TempoBpm - PracticeRules.PlayfulTempoDrop, gentle.TempoBpm);
        Assert.Equal($"{code}@{doh}~gentle", gentle.Id);
        Assert.True(gentle.MaxTakeSeconds > plain.MaxTakeSeconds);

        var again = DrillCatalogue.Find(gentle.Id)!;
        Assert.Equal(gentle.TempoBpm, again.TempoBpm);
        Assert.Equal(gentle.Target().LeadInSec, again.Target().LeadInSec, 6);
    }

    [Fact]
    public void The_gentle_pace_is_only_for_drills_playful_offers()
    {
        Assert.NotNull(DrillCatalogue.Find("steps-up@60~gentle"));
        Assert.Null(DrillCatalogue.Find("scale-up@60~gentle"));       // eight notes
        Assert.Null(DrillCatalogue.Find("minor-chord@60~gentle"));    // tier 5
        Assert.Null(DrillCatalogue.Find("sight-hymn-line@62~gentle")); // Focused only
        Assert.Null(DrillCatalogue.Find("steps-up@60~slow"));
        Assert.NotNull(DrillCatalogue.Find("sight-hymn-line@62"));    // a Focused drill is found whatever the track now
    }

    [Fact]
    public void A_new_pattern_reads_back_exactly_with_its_octave_marks()
    {
        var harmonic = DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "minor-harmonic"), 60);
        Assert.Equal("A minor", harmonic.KeyName);
        Assert.Equal(new[] { 57, 59, 60, 62, 64, 65, 68, 69 }, harmonic.Notes.Select(n => n.PitchMidi)); // A B C D E F G# A

        var seventh = DrillCatalogue.Build(DrillCatalogue.Patterns.Single(p => p.Code == "seventh-fah"), 62);
        Assert.Equal("s, f m r d", string.Join(' ', seventh.Notes.Select(n => n.Solfa + n.OctaveMark)));
        Assert.Equal(10, seventh.Notes[1].PitchMidi - seventh.Notes[0].PitchMidi);
    }

    [Theory]
    [InlineData(PracticeTrack.Playful)]
    [InlineData(PracticeTrack.Focused)]
    [InlineData(null)]
    public void Each_tracks_next_drill_is_the_same_on_every_read_and_comes_from_its_slice(PracticeTrack? track)
    {
        var user = Guid.Parse("8f1c2a8e-5b8a-4a51-9f60-1d2b3c4d5e6f");
        for (var level = 0; level <= 9; level++)
        {
            var drill = First(user, track, level);

            Assert.Equal(drill.Id, First(user, track, level).Id);
            Assert.True(DrillCatalogue.OnTrack(drill.Pattern, track));
            Assert.Equal(DrillCatalogue.TierFor(track, level), drill.Pattern.Tier);
            Assert.Equal(track == PracticeTrack.Playful, drill.Id.EndsWith("~gentle"));
            Assert.NotNull(DrillCatalogue.Find(drill.Id));
        }

        // Singers start on different drills.
        var starts = Enumerable.Range(0, 14).Select(i => First(Guid.NewGuid(), track, 0).Id).Distinct().Count();
        Assert.True(starts > 3, $"only {starts} different first drills for fourteen singers");
    }

    [Fact]
    public void No_track_is_the_ladder_at_the_levels_own_grade_and_tempo()
    {
        var user = Guid.NewGuid();
        for (var level = 0; level <= 7; level++)
        {
            var drill = First(user, null, level);
            Assert.Equal(level, drill.Pattern.Tier);
            Assert.Equal(DrillCatalogue.TempoFor(level), drill.TempoBpm);
        }
    }

    // ── PUT /api/practice/track ─────────────────────────────────────────────

    [Fact]
    public async Task The_track_is_null_until_chosen_then_stored_on_the_account_and_read_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        Assert.Null((await Progress(h, user)).Track);
        Assert.Null((await TodayDrill(h, user)).Track);

        var set = await SetTrack(h, user, "playful");

        Assert.True(set.IsSuccess, set.IsFailure ? set.Error.Message : null);
        Assert.Equal(PracticeTrack.Playful, set.Value.Track);
        Assert.Equal(PracticeTrack.Playful, h.Db.Users.Single(u => u.Id == user.Id).PracticeTrack);
        Assert.Equal(PracticeTrack.Playful, (await Progress(h, user)).Track);

        var drill = await TodayDrill(h, user);
        Assert.Equal(PracticeTrack.Playful, drill.Track);
        Assert.Equal(First(user.Id, PracticeTrack.Playful, 0).Id, drill.Id);

        Assert.Equal(PracticeTrack.Focused, (await SetTrack(h, user, "  FOCUSED ")).Value.Track);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("kids")]
    [InlineData("adult")]
    [InlineData("standard")]
    [InlineData("0")]
    [InlineData("1")]
    [InlineData("playful,focused")]
    public async Task Anything_but_a_tracks_name_is_refused_and_changes_nothing(string? track)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        await SetTrack(h, user, "focused");

        var result = await SetTrack(h, user, track);

        Assert.True(result.IsFailure);
        Assert.Equal("PRACTICE_TRACK_UNKNOWN", result.Error.Code);
        Assert.Equal(ErrorType.Validation, result.Error.Type);
        Assert.Equal(PracticeTrack.Focused, h.Db.Users.Single(u => u.Id == user.Id).PracticeTrack);
    }

    [Fact]
    public async Task Switching_track_shows_that_tracks_next_drill_and_switching_back_brings_the_first_one_back()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        await SetTrack(h, user, "playful");
        var playful = await TodayDrill(h, user);
        await SetTrack(h, user, "focused");
        var focused = await TodayDrill(h, user);
        await SetTrack(h, user, "playful");
        var back = await TodayDrill(h, user);

        Assert.Equal(First(user.Id, PracticeTrack.Focused, 0).Id, focused.Id);
        Assert.NotEqual(playful.Id, focused.Id);
        Assert.Equal(playful.Id, back.Id);

        // A take of the drill sung before the switch is still marked, and the allowance is one for both tracks.
        await SetTrack(h, user, "focused");
        var graded = await Grade(h, user, 90).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", playful.Id), default);
        Assert.True(graded.IsSuccess);
        Assert.Equal(playful.Id, Assert.Single(h.Db.PracticeSessions).DrillId);
        Assert.Equal(1, (await TodayDrill(h, user)).Allowance.Used);
    }

    [Fact]
    public async Task A_playful_take_is_graded_at_the_gentle_tempo()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        await SetTrack(h, user, "playful");
        var drill = await TodayDrill(h, user);
        var api = new RecordingApi(100);

        await Grade(h, user, api).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default);

        Assert.Equal(drill.TempoBpm, api.LastTarget!.TempoBpm);
        Assert.Equal(DrillCatalogue.TempoFor(0) - PracticeRules.PlayfulTempoDrop, api.LastTarget.TempoBpm);
        Assert.Equal(drill.MaxTakeSeconds, api.LastMaxTakeSeconds);
    }

    // ── The same rules on every track ───────────────────────────────────────

    [Fact]
    public async Task The_same_marks_earn_the_same_xp_streak_and_badges_on_every_track()
    {
        var rewards = new List<PracticeRewardDto>();
        var progress = new List<PracticeProgressDto>();
        foreach (var track in new[] { null, "playful", "focused" })
        {
            using var h = new TestHarness(Now);
            var user = Seed(h);
            if (track is not null)
                await SetTrack(h, user, track);

            foreach (var score in new[] { 100, 85, 40 })
            {
                var drill = await TodayDrill(h, user);
                rewards.Add((await Grade(h, user, score).Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drill.Id), default)).Value.Reward!);
            }
            progress.Add(await Progress(h, user));
        }

        // 20 + 15 + 10 XP whichever track sang them.
        Assert.Equal(45, progress[0].Xp);
        Assert.All(progress, p => AssertSameNumbers(progress[0], p));
        for (var i = 0; i < 3; i++)
        {
            Assert.Equal(rewards[i].XpGained, rewards[i + 3].XpGained);
            Assert.Equal(rewards[i].XpGained, rewards[i + 6].XpGained);
            Assert.Equal(rewards[i].NewBadges.Select(b => b.Code), rewards[i + 6].NewBadges.Select(b => b.Code));
        }
    }

    [Fact]
    public async Task Switching_track_loses_nothing()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        for (var day = 1; day <= 4; day++)
            h.Db.PracticeSessions.Add(PracticeSession.Record(user.Id, PracticeKind.Drill, 100, 3, 0, 0, 0, 3, Now.AddDays(-day), Today.AddDays(-day)));
        h.Db.SaveChanges();
        await SetTrack(h, user, "playful");
        var before = await Progress(h, user);

        var after = (await SetTrack(h, user, "focused")).Value;

        Assert.Equal(PracticeTrack.Focused, after.Track);
        AssertSameNumbers(before, after);
        Assert.Equal(4, after.Streak.Current);
        Assert.Equal(80, after.Xp);
    }

    // ── The wire and the route ──────────────────────────────────────────────

    [Fact]
    public void The_track_goes_on_the_wire_as_its_camel_case_name_or_null()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)); // as Program.cs

        Assert.Equal("\"playful\"", JsonSerializer.Serialize<PracticeTrack?>(PracticeTrack.Playful, options));
        Assert.Equal("\"focused\"", JsonSerializer.Serialize<PracticeTrack?>(PracticeTrack.Focused, options));
        Assert.Equal("null", JsonSerializer.Serialize<PracticeTrack?>(null, options));
    }

    [Fact]
    public void The_track_is_set_with_a_put()
    {
        var method = typeof(PracticeController).GetMethod(nameof(PracticeController.SetTrack))!;
        Assert.Equal("track", method.GetCustomAttribute<HttpPutAttribute>()!.Template);
    }

    // ── Harness ─────────────────────────────────────────────────────────────

    /// <summary>A singer's first drill on a track's path, before any take.</summary>
    private static Drill First(Guid userId, PracticeTrack? track, int level)
        => PracticePath.Next(userId, track, PracticePath.Read(userId, [], _ => level), level).Drill;

    private static Task<Result<PracticeProgressDto>> SetTrack(TestHarness h, User user, string? track)
        => new SetPracticeTrackCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new SetPracticeTrackCommand(track), default);

    private static async Task<DrillDto> TodayDrill(TestHarness h, User user)
        => (await new GetTodayDrillQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetTodayDrillQuery(), default)).Value;

    private static async Task<PracticeProgressDto> Progress(TestHarness h, User user)
        => (await new GetPracticeProgressQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetPracticeProgressQuery(), default)).Value;

    private static GradeDrillCommandHandler Grade(TestHarness h, User user, int score) => Grade(h, user, new RecordingApi(score));

    private static GradeDrillCommandHandler Grade(TestHarness h, User user, ITranscriptionApi api)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db));

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Chorister", "alto@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    /// <summary>Everything progress counts — all but the track — is the same.</summary>
    private static void AssertSameNumbers(PracticeProgressDto expected, PracticeProgressDto actual)
    {
        Assert.Equal(expected.Today, actual.Today);
        Assert.Equal(expected.Xp, actual.Xp);
        Assert.Equal(expected.XpToday, actual.XpToday);
        Assert.Equal(expected.DailyXpCap, actual.DailyXpCap);
        Assert.Equal(expected.Level, actual.Level);
        Assert.Equal(expected.Streak, actual.Streak);
        Assert.Equal(expected.WeeklyGoal, actual.WeeklyGoal);
        Assert.Equal(expected.Drills, actual.Drills);
        Assert.Equal(expected.LastSevenDays, actual.LastSevenDays);
        Assert.Equal(expected.Badges, actual.Badges);
    }

    private static IEnumerable<int> Leaps(IReadOnlyList<int> offsets)
        => offsets.Zip(offsets.Skip(1), (a, b) => Math.Abs(b - a));

    private sealed class RecordingApi(int score) : ITranscriptionApi
    {
        public GradeTargetDto? LastTarget { get; private set; }
        public double? LastMaxTakeSeconds { get; private set; }

        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default)
        {
            LastTarget = target;
            LastMaxTakeSeconds = maxTakeSeconds;
            return Task.FromResult(Result.Success(new GradeResultDto(score, target.Notes.Count, 0, 0, 0, 3.0, 0.1, 0, "Good.",
                target.Notes.Select((n, i) => new GradeNoteDto(i, n.PitchMidi, n.PitchMidi, 3.0, "hit")).ToList())));
        }

        public Task<Result<HarmonyDto>> HarmoniseAsync(string key, int tempoBpm, string timeSignature, IReadOnlyList<NoteEventDto> notes, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<Application.Hymns.Dtos.HymnIdentificationDto>> IdentifyHymnAsync(Stream audio, string fileName, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitAsync(Stream audio, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitScoreAsync(Stream score, string fileName, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<string>> SubmitLinkAsync(string url, TranscribeOptions options, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<TranscriptionJobDto>> GetJobAsync(string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<SourceDto>> ResolveLinkAsync(string url, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Result<int>> PingAsync(CancellationToken ct = default) => Task.FromResult(Result.Success(1));
    }
}
