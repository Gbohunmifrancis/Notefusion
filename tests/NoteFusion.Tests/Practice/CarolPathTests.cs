using System.Text.Json;
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
using NoteFusion.Tests.Flags;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The Christmas carols path: six drills built from the carols' real notes (checked against the published hymn pack),
/// labelled by the solfa engine like every drill, marked by the same grader; served only while the season is on (an
/// admin's preview included), never moving the main path; and the Carol singer badge for all six, earned only in the
/// season and kept for good.
/// </summary>
public class CarolPathTests
{
    private static readonly DateTime Now = new(2026, 12, 19, 18, 0, 0, DateTimeKind.Utc); // 19:00 in Lagos

    // ── The drills ───────────────────────────────────────────────────────────

    public static TheoryData<string, bool> EveryCarolDrill()
    {
        var data = new TheoryData<string, bool>();
        foreach (var d in CarolPath.Drills)
        {
            data.Add(d.Code, false);
            data.Add(d.Code, true);
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(EveryCarolDrill))]
    public void Every_carol_drill_reads_as_written_in_range_and_markable_and_is_found_by_its_id(string code, bool gentle)
    {
        var definition = CarolPath.Drills.Single(d => d.Code == code);
        var carol = CarolPath.Build(definition, gentle);
        var drill = carol.Drill;

        Assert.All(drill.Notes, n => Assert.InRange(n.PitchMidi, DrillCatalogue.LowestMidi, DrillCatalogue.HighestMidi));
        Assert.All(drill.Notes, n => Assert.True(n.DurBeats * 60.0 / drill.TempoBpm >= PracticeRules.ShortestNoteSeconds - 1e-9,
            $"{drill.Id}: a {n.DurBeats}-beat note at {drill.TempoBpm} BPM is too short to mark"));
        Assert.True(drill.Notes[^1].DurBeats >= CarolPath.HeldLastBeats);
        Assert.Equal(gentle ? definition.TempoBpm - PracticeRules.PlayfulTempoDrop : definition.TempoBpm, drill.TempoBpm);
        Assert.Equal(definition.DohMidi % 12, drill.Key.DohPitchClass);
        Assert.Equal(KeyMode.Major, drill.Key.Mode);

        // Independently of the path's own check: the engine labels each pitch, from the tune's doh, as written.
        var reference = SolfaMapper.ReferenceDoh((carol.Backing ?? drill.Notes).Select(n => n.PitchMidi).ToList(), drill.Key.DohPitchClass, drill.Key.Mode);
        var pitches = drill.Notes.Select(n => n.PitchMidi).ToList();
        var ascending = SolfaMapper.AscendingFlags(pitches, drill.Key.DohPitchClass);
        for (var i = 0; i < pitches.Count; i++)
        {
            var mapped = SolfaMapper.Map(pitches[i], drill.Key, reference, ascending[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
            Assert.Equal(mapped.Text + mapped.OctaveMark, drill.Notes[i].Solfa + drill.Notes[i].OctaveMark);
        }

        Assert.Equal(gentle, drill.Id.EndsWith(DrillCatalogue.GentleSuffix, StringComparison.Ordinal));
        var found = DrillCatalogue.Find(drill.Id);
        Assert.NotNull(found);
        Assert.Equal(drill.Notes, found.Notes);
        Assert.Equal(drill.TempoBpm, found.TempoBpm);
        Assert.True(drill.Id.Length <= PracticeSession.DrillIdMaxLength);
    }

    [Fact]
    public void The_six_drills_are_the_boards_and_Playful_sings_the_shorter_takes()
    {
        Assert.Equal(
            ["Gloria warm-up", "All the way down", "Sing in thirds", "Sing along", "Leap up to doh", "Step up to soh"],
            CarolPath.Drills.Select(d => d.Title));
        Assert.Equal(
            ["Angels We Have Heard on High", "Joy to the World", "Silent Night", "Silent Night", "Hark! The Herald Angels Sing", "The First Noel"],
            CarolPath.Drills.Select(d => d.Carol));
        Assert.Equal([1, 2, 3, 4, 5, 6], CarolPath.Drills.Select(d => d.Index));

        string Sung(int index, PracticeTrack? track)
            => string.Join(' ', CarolPath.For(CarolPath.Drills[index - 1], track).Drill.Notes.Select(n => n.Solfa + n.OctaveMark));

        Assert.Equal("s l s f m f s f m r m f m r d r", Sung(1, PracticeTrack.Focused)); // the whole Gloria, in one breath
        Assert.Equal("s l s f m f", Sung(1, PracticeTrack.Playful));                    // its first six notes
        Assert.Equal("d' t l s f m r d", Sung(2, null));
        Assert.Equal("m f m d m f m d", Sung(3, PracticeTrack.Focused));
        Assert.Equal("m f m d", Sung(3, PracticeTrack.Playful));
        Assert.Equal("s, d d t, d m m r", Sung(5, PracticeTrack.Focused));
        Assert.Equal("s, d d t, d", Sung(5, PracticeTrack.Playful));
        Assert.Equal("m r d r m f s", Sung(6, PracticeTrack.Playful));
        Assert.Equal(46, CarolPath.For(CarolPath.Drills[3], PracticeTrack.Playful).Drill.Notes.Count); // a whole verse either way

        // Sing in thirds: the piano's tune, and the alto a third under it, Doh is Bb.
        var thirds = CarolPath.For(CarolPath.Drills[2], PracticeTrack.Playful);
        Assert.Equal("s l s m", string.Join(' ', thirds.Backing!.Select(n => n.Solfa + n.OctaveMark)));
        Assert.Equal([65, 67, 65, 62], thirds.Backing!.Select(n => n.PitchMidi));
        Assert.Equal([62, 63, 62, 58], thirds.Drill.Notes.Select(n => n.PitchMidi));
        Assert.Equal("Doh is Bb · 4 notes", thirds.Detail);
        Assert.Equal(thirds.Drill.Notes.Select(n => (n.StartBeat, n.DurBeats)), thirds.Backing!.Select(n => (n.StartBeat, n.DurBeats)));

        Assert.Equal("one breath", CarolPath.For(CarolPath.Drills[0], null).Detail);
        Assert.Equal("d' t l s f m r d", CarolPath.For(CarolPath.Drills[1], null).Detail);
        Assert.Equal("s, d d t, d", CarolPath.For(CarolPath.Drills[4], PracticeTrack.Playful).Detail);
        Assert.Equal("the first verse, with the words", CarolPath.For(CarolPath.Drills[3], null).Detail);
    }

    [Fact]
    public void Every_drill_is_its_carols_real_notes_as_the_hymn_page_publishes_them()
    {
        using var pack = JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "web-site", "hymns", "pack.json")));
        var hymns = pack.RootElement.GetProperty("hymns").EnumerateArray().ToDictionary(e => e.GetProperty("slug").GetString()!);

        foreach (var definition in CarolPath.Drills)
        {
            Assert.True(hymns.ContainsKey(definition.HymnSlug), $"{definition.HymnSlug} is not a published hymn");
            var hymn = hymns[definition.HymnSlug];
            Assert.Equal(definition.TimeSignature, hymn.GetProperty("time").GetString());
            var melody = hymn.GetProperty("notes").EnumerateArray()
                .Select(n => (Pitch: n[0].GetInt32(), Start: n[1].GetDouble(), Beats: n[2].GetDouble()))
                .ToList();
            var carol = CarolPath.Build(definition);

            // The tune the singer sings, or (for a part) the tune the piano plays: a run of the melody, in some key.
            var line = (carol.Backing ?? carol.Drill.Notes).Select(n => n.PitchMidi).ToList();
            var at = Enumerable.Range(0, melody.Count - line.Count + 1).FirstOrDefault(
                i => Enumerable.Range(0, line.Count).All(k => melody[i + k].Pitch - line[k] == melody[i].Pitch - line[0]), -1);
            Assert.True(at >= 0, $"{definition.Code}: {string.Join(' ', line)} is not a run of {definition.Carol}'s melody");
            // Moved (if at all) with its doh, so every note is the same degree of the scale as in the carol.
            var shift = melody[at].Pitch - line[0];
            Assert.Equal(0, (((definition.DohMidi + shift - KeyOf(hymn)) % 12) + 12) % 12);

            // Its rhythm, but for the held last note and Joy to the World's even quavers.
            for (var k = 0; k < line.Count - 1; k++)
            {
                if (definition.Code == "carol-joy" && k is 1 or 2)
                    continue;
                Assert.Equal(melody[at + k].Beats, carol.Drill.Notes[k].DurBeats, 6);
            }
            if (definition.Code == "carol-joy")
                Assert.Equal(1.0, carol.Drill.Notes[1].DurBeats + carol.Drill.Notes[2].DurBeats, 6); // the dotted pair's beat, evenly
            Assert.Equal(definition.PickupBeats, Pickup(melody, at, hymn), 6);

            if (definition.Syllables is { } syllables)
                Assert.Equal(Syllables(hymn.GetProperty("words").GetString()!).Skip(at).Take(syllables.Count), syllables);
        }

        // The part under the tune is the hymn-book alto: each note two steps of the scale below the tune's.
        var thirds = CarolPath.Build(CarolPath.Drills.Single(d => d.Code == "carol-thirds"));
        int[] major = [0, 2, 4, 5, 7, 9, 11];
        var scale = Enumerable.Range(36, 60).Where(p => major.Contains((p - thirds.Drill.DohMidi + 120) % 12)).ToList();
        Assert.Equal(
            thirds.Backing!.Select(n => scale[scale.IndexOf(n.PitchMidi) - 2]),
            thirds.Drill.Notes.Select(n => n.PitchMidi));
    }

    // ── Served only in the season ────────────────────────────────────────────

    [Fact]
    public async Task Out_of_season_there_is_no_carols_path_and_no_carol_badge()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");

        var progress = await Progress(h, singer);
        Assert.Null(progress.Season);
        Assert.DoesNotContain(progress.Badges, b => b.Code == CarolPath.BadgeCode);

        var carols = await Carols(h, singer);
        Assert.Equal("PRACTICE_SEASON_OFF", carols.Error.Code);
        Assert.Equal(ErrorType.NotFound, carols.Error.Type);
    }

    [Fact]
    public async Task In_season_the_progress_carries_the_path_and_the_carols_are_ready_to_sing_on_the_singers_track()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");
        await Track(h, singer, "playful");
        SeasonFlagTests.SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));

        var progress = await Progress(h, singer);
        var season = Assert.IsType<PracticeSeasonDto>(progress.Season);
        Assert.Equal(("christmas", "Carols for Christmas", new DateOnly(2027, 1, 6)), (season.Season, season.Title, season.Until!.Value));
        Assert.Equal((0, 6), (season.Sung, season.Total));
        Assert.Equal("Gloria warm-up", season.Next!.Title);
        Assert.Equal(6, season.Steps.Count);
        Assert.All(season.Steps, s => Assert.EndsWith(DrillCatalogue.GentleSuffix, s.Id)); // Playful's pace
        var badge = Assert.Single(progress.Badges, b => b.Code == CarolPath.BadgeCode);
        Assert.Equal((false, 0, 6), (badge.Earned, badge.Progress, badge.Target));

        var carols = (await Carols(h, singer)).Value;
        Assert.Equal(6, carols.Drills.Count);
        var thirds = carols.Drills[2];
        Assert.Equal(("Sing in thirds", "Silent Night, in thirds"), (thirds.Step.Title, thirds.Step.Cue));
        Assert.Equal(4, thirds.Drill.Notes.Count);
        Assert.Equal(4, thirds.Backing!.Count);
        Assert.Equal(("6/8", "Doh is Bb"), (thirds.Drill.TimeSignature, thirds.Drill.DohHeader));
        var along = carols.Drills[3];
        Assert.Equal(46, along.Syllables!.Count);
        Assert.Equal("Silent night, holy night,", along.Words![0]);
        Assert.Null(along.Backing);
        Assert.Equal(1, carols.Drills[5].PickupBeats);
        Assert.Null(carols.Drills[0].Words);
    }

    [Fact]
    public async Task An_admins_preview_shows_the_carols_to_admins_only()
    {
        using var h = new TestHarness(Now);
        var admin = SeasonFlagTests.Seed(h, "admin@example.com", UserRole.Admin);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");
        SeasonFlagTests.SetFlag(h, enabled: false, preview: true, lastDay: new DateOnly(2027, 1, 6));

        Assert.NotNull((await Progress(h, admin)).Season);
        Assert.True((await Carols(h, admin)).IsSuccess);
        Assert.Null((await Progress(h, singer)).Season);
        Assert.True((await Carols(h, singer)).IsFailure);
    }

    // ── Singing them ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Carol_takes_earn_xp_like_any_drill_move_along_the_carols_and_never_move_the_main_path()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");
        SeasonFlagTests.SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));
        var before = await Progress(h, singer);

        var first = await Sing(h, singer, before.Season!.Steps[0].Id, 92);
        Assert.Equal(PracticeRules.DrillXp + PracticeRules.DrillGoodBonus, first.Reward!.XpGained);
        Assert.Null(first.Milestone);
        await Sing(h, singer, before.Season.Steps[1].Id, 60); // not passed: the same drill is next

        var after = await Progress(h, singer);
        Assert.Equal(before.Path, after.Path); // the main path has not moved
        Assert.Equal(2, after.Drills.Used);    // but the day's drills count them
        Assert.Equal(1, after.Season!.Sung);
        Assert.Equal("All the way down", after.Season.Next!.Title);
        Assert.Equal((true, 92), (after.Season.Steps[0].Passed, after.Season.Steps[0].BestScore!.Value));
        Assert.Equal((false, 60), (after.Season.Steps[1].Passed, after.Season.Steps[1].BestScore!.Value));
        Assert.Null(after.Season.Steps[2].BestScore);
    }

    [Fact]
    public async Task All_six_in_season_earn_the_carol_singer_badge_and_it_is_kept_after_christmas()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");
        SeasonFlagTests.SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));
        var steps = (await Progress(h, singer)).Season!.Steps;

        for (var i = 0; i < 5; i++)
            Assert.DoesNotContain((await Sing(h, singer, steps[i].Id, 85)).Reward!.NewBadges, b => b.Code == CarolPath.BadgeCode);
        var sixth = await Sing(h, singer, steps[5].Id, 85);

        var badge = Assert.Single(sixth.Reward!.NewBadges, b => b.Code == CarolPath.BadgeCode);
        Assert.Equal(("Carol singer", true), (badge.Title, badge.Earned));
        var season = (await Progress(h, singer)).Season!;
        Assert.Equal(6, season.Sung);
        Assert.Null(season.Next);

        h.Clock.UtcNow = new DateTime(2027, 2, 1, 12, 0, 0, DateTimeKind.Utc); // the season has switched itself off
        var february = await Progress(h, singer);
        Assert.Null(february.Season);
        Assert.True(Assert.Single(february.Badges, b => b.Code == CarolPath.BadgeCode).Earned);
    }

    [Fact]
    public async Task The_badge_cannot_be_earned_out_of_season_and_comes_with_the_next_take_in_season()
    {
        using var h = new TestHarness(Now);
        var singer = SeasonFlagTests.Seed(h, "singer@example.com");
        // A singer with the carol drills' ids from a screen opened in season, singing them after it ended.
        foreach (var definition in CarolPath.Drills)
            Assert.DoesNotContain((await Sing(h, singer, CarolPath.Build(definition).Drill.Id, 90)).Reward!.NewBadges, b => b.Code == CarolPath.BadgeCode);
        Assert.DoesNotContain((await Progress(h, singer)).Badges, b => b.Code == CarolPath.BadgeCode);
        Assert.Empty(h.Db.Achievements.Where(a => a.Code == CarolPath.BadgeCode));

        SeasonFlagTests.SetFlag(h, enabled: true, preview: false, lastDay: new DateOnly(2027, 1, 6));
        var next = await Sing(h, singer, CarolPath.Build(CarolPath.Drills[0]).Drill.Id, 90);
        Assert.Contains(next.Reward!.NewBadges, b => b.Code == CarolPath.BadgeCode);
    }

    [Fact]
    public void A_pass_counts_on_either_pace_and_the_next_is_the_first_not_passed()
    {
        var gloria = CarolPath.Build(CarolPath.Drills[0], gentle: true).Drill.Id;
        var joy = CarolPath.Build(CarolPath.Drills[1]).Drill.Id;
        var noel = CarolPath.Build(CarolPath.Drills[5]).Drill.Id;

        var standings = CarolPath.Read([(gloria, 80), (joy, 79), ("steps-up@60", 100), (null, 100), (noel, 95), (joy, 70)]);

        Assert.Equal([true, false, false, false, false, true], standings.Select(s => s.Passed));
        Assert.Equal(79, standings[1].BestScore);
        Assert.Equal("carol-joy", CarolPath.Next(standings)!.Code);
        Assert.Equal(2, CarolPath.Sung([(gloria, 80), (noel, 95), ("carol-noel@99", 100)]));
        Assert.Null(CarolPath.Find("carol-noel@99"));   // only its own key
        Assert.Null(CarolPath.Find("carol-nope@62"));
        Assert.Null(DrillCatalogue.Find("carol-gloria"));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static string RepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "NoteFusion.slnx")))
                return dir.FullName;
        throw new InvalidOperationException("The tests run inside the repository; NoteFusion.slnx was not found above them.");
    }

    /// <summary>The hymn's doh as a MIDI pitch class.</summary>
    private static int KeyOf(JsonElement hymn)
        => KeyParser.Parse(hymn.GetProperty("key").GetString()!).Value.DohPitchClass;

    /// <summary>
    /// Beats from the run's first note to the next bar line. The pack puts a pickup at the end of the first bar, so bar
    /// lines fall at whole bars of quarter-note beats.
    /// </summary>
    private static double Pickup(List<(int Pitch, double Start, double Beats)> melody, int at, JsonElement hymn)
    {
        var time = hymn.GetProperty("time").GetString()!.Split('/');
        var bar = int.Parse(time[0]) * 4.0 / int.Parse(time[1]);
        return (bar - melody[at].Start % bar) % bar;
    }

    /// <summary>The pack's words as a syllable a note: hyphens split syllables, each "_" is one more note on the last.</summary>
    private static List<string> Syllables(string words)
    {
        var syllables = new List<string>();
        foreach (var word in words.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            foreach (var part in word.Split('-'))
            {
                var core = part.Replace("_", "", StringComparison.Ordinal);
                if (core.Length > 0)
                    syllables.Add(core);
                syllables.AddRange(Enumerable.Repeat("", part.Count(c => c == '_')));
            }
        return syllables;
    }

    private static async Task<PracticeProgressDto> Progress(TestHarness h, User user)
        => (await new GetPracticeProgressQueryHandler(h.Db, SeasonFlagTests.Caller(user), h.Clock, new StubClientTimeZone())
            .Handle(new GetPracticeProgressQuery(), default)).Value;

    private static Task<Result<CarolsPathDto>> Carols(TestHarness h, User user)
        => new GetSeasonPathQueryHandler(h.Db, SeasonFlagTests.Caller(user), h.Clock, new StubClientTimeZone())
            .Handle(new GetSeasonPathQuery(), default);

    private static async Task Track(TestHarness h, User user, string track)
        => Assert.True((await new SetPracticeTrackCommandHandler(h.Db, SeasonFlagTests.Caller(user), h.Clock, new StubClientTimeZone())
            .Handle(new SetPracticeTrackCommand(track), default)).IsSuccess);

    private static async Task<GradeResultDto> Sing(TestHarness h, User user, string drillId, int score)
    {
        h.Clock.UtcNow = h.Clock.UtcNow.AddSeconds(30);
        var result = await new GradeDrillCommandHandler(
                new FixedScoreApi(score), h.Db, SeasonFlagTests.Caller(user), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db))
            .Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drillId), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    private sealed class FixedScoreApi(int score) : ITranscriptionApi
    {
        public Task<Result<GradeResultDto>> GradeAsync(Stream audio, string fileName, GradeTargetDto target, double? maxTakeSeconds = null, CancellationToken ct = default)
            => Task.FromResult(Result.Success(new GradeResultDto(score, target.Notes.Count, 0, 0, 0, 3.0, 0.1, 0, "Good.",
                target.Notes.Select((n, i) => new GradeNoteDto(i, n.PitchMidi, n.PitchMidi, 3.0, "hit")).ToList())));

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
