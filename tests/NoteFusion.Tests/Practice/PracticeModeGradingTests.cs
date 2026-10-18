using System.Net;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Api.Controllers;
using NoteFusion.Api.RateLimiting;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Modes;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Api;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The practice modes end to end through their handlers, with the worker faked: each take is marked by the grader its
/// exercise names against the server's own notes, recorded as practice of its kind on the singer's day, spends one of
/// the day's marked drills (shared with the path), earns as a drill, and never moves the path. The range finder keeps
/// the singer's range and records no practice.
/// </summary>
public class PracticeModeGradingTests
{
    // 19:00 in Lagos, Saturday 17 October.
    private static readonly DateTime Now = new(2026, 10, 17, 18, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 10, 17);
    private const double LeadIn = 4.0;

    // ── Marking ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_pitch_match_set_is_marked_on_the_servers_notes_with_the_narrow_search_and_recorded_as_one_take()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeGraders(100);
        var set = Exercise(h, user, PracticeModes.PitchMatch);

        var result = await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "set.m4a", set.Id, LeadIn), default);

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        Assert.Equal(new[] { "notes" }, api.Calls);
        Assert.Equal(set.Notes.Select(n => (n.PitchMidi, n.StartBeat, n.DurBeats)), api.LastTarget!.Notes.Select(n => (n.PitchMidi, n.StartBeat, n.DurBeats)));
        Assert.Equal(LeadIn, api.LastTarget.LeadInSec);
        Assert.Equal(ModeCatalogue.PitchMatchOffsetSearchSec, api.LastOffsetSearch);
        Assert.Equal(ModeCatalogue.Find(set.Id)!.MaxTakeSecondsAfter(LeadIn), api.LastMaxTake);

        var dto = result.Value;
        Assert.Equal(("pitch-match", set.Id, "notes", 100), (dto.Mode, dto.ExerciseId, dto.Grader, dto.Score));
        Assert.Equal(8, dto.Marks!.Notes.Count);
        Assert.Null(dto.Run);
        Assert.Equal(20, dto.Reward.XpGained);

        var session = Assert.Single(h.Db.PracticeSessions);
        Assert.Equal(PracticeKind.PitchMatch, session.Kind);
        Assert.Equal(set.Id, session.DrillId);
        Assert.Equal((Today, Now, 100, 8), (session.LocalDate, session.CreatedAtUtc, session.Score, session.Hits));
        Assert.Equal(ModeCatalogue.Find(set.Id)!.PassageSeconds, session.DurationSec, 6);
    }

    [Fact]
    public async Task An_interval_and_a_harmony_line_are_marked_on_what_is_sung_never_on_what_is_played()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, PracticeTrack.Focused);
        var api = new FakeGraders(85);

        var interval = Exercise(h, user, PracticeModes.Intervals);
        await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "i.m4a", interval.Id, LeadIn), default);
        Assert.Equal(2, api.LastTarget!.Notes.Count);
        Assert.Null(api.LastOffsetSearch);

        var harmony = Exercise(h, user, PracticeModes.Harmony);
        await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "h.m4a", harmony.Id, LeadIn), default);
        Assert.Equal(harmony.Notes.Select(n => n.PitchMidi), api.LastTarget!.Notes.Select(n => n.PitchMidi));
        Assert.NotEqual(harmony.Backing.Select(n => n.PitchMidi), api.LastTarget.Notes.Select(n => n.PitchMidi));
        Assert.Null(api.LastOffsetSearch);

        Assert.Equal(new[] { PracticeKind.Interval, PracticeKind.Harmony }, h.Db.PracticeSessions.OrderBy(s => s.Kind).Select(s => s.Kind));
    }

    [Fact]
    public async Task A_run_is_marked_note_by_note_while_slow_and_on_its_shape_at_full_speed()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, PracticeTrack.Focused);
        var listed = Exercise(h, user, PracticeModes.Runs, "pentatonic");
        var speeds = listed.Speeds!.ToDictionary(s => s.Percent);
        var api = new FakeGraders(92)
        {
            Run = new RunGradeDto(88, 4, 5, "hit", 6.0, 58, 0.1, 0, "You followed 4 of the run's 5 notes and landed in tune.",
                [new(0, 70, true, "hit"), new(1, 67, true, "hit"), new(2, 65, false, "wrong"), new(3, 62, true, "hit"), new(4, 60, true, "hit")],
                [new(0.0, 70.1), new(1.3, 58.0)]),
        };

        var slow = await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "r.m4a", speeds[80].ExerciseId, LeadIn), default);
        Assert.Equal(("notes", 80), (slow.Value.Grader, slow.Value.SpeedPercent));
        Assert.Equal(48, api.LastTarget!.TempoBpm);

        var fast = await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "r.m4a", speeds[100].ExerciseId, LeadIn), default);
        Assert.Equal(new[] { "notes", "run" }, api.Calls);
        Assert.Equal(("run", 88, 100), (fast.Value.Grader, fast.Value.Score, fast.Value.SpeedPercent));
        Assert.Equal(60, api.LastTarget!.TempoBpm);
        Assert.Equal(4, fast.Value.Run!.Followed);
        Assert.Null(fast.Value.Marks);

        // Each note followed is a hit and the landing note counts as itself.
        var row = h.Db.PracticeSessions.Single(s => s.DrillId == speeds[100].ExerciseId);
        Assert.Equal((PracticeKind.Run, 5, 0, 1, 0), (row.Kind, row.Hits, row.Near, row.Wrong, row.Missed));
    }

    [Fact]
    public async Task A_rhythm_is_marked_clap_by_clap_against_its_beats()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, PracticeTrack.Playful);
        var rhythm = Exercise(h, user, PracticeModes.Rhythm, "rest");
        var api = new FakeGraders(75)
        {
            Rhythm = new RhythmGradeDto(75, 2, 1, 0, 1, 0.2, 1.0, "2 of 3 claps in time, 1 close, 1 extra.",
                [new(0, 0, 3, "hit"), new(1, 1, -95, "near"), new(2, 3, 12, "hit")]),
        };

        var result = await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "claps.m4a", rhythm.Id, LeadIn), default);

        Assert.Equal(new[] { "rhythm" }, api.Calls);
        Assert.Equal(new[] { 0.0, 1.0, 3.0 }, api.LastBeats);
        Assert.Equal((80.0, LeadIn), (api.LastTempo, api.LastLeadIn));
        Assert.Equal(("rhythm", 75), (result.Value.Grader, result.Value.Score));
        Assert.Equal(3, result.Value.Rhythm!.Claps.Count);
        var row = Assert.Single(h.Db.PracticeSessions);
        Assert.Equal((PracticeKind.Rhythm, 2, 1, 1, 0), (row.Kind, row.Hits, row.Near, row.Wrong, row.Missed));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(-1.0)]
    [InlineData(9.0)] // past eight beats at 60 BPM
    [InlineData(double.NaN)]
    public async Task A_take_without_a_count_in_an_app_plays_is_refused_without_reaching_the_worker(double? leadIn)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeGraders(100);

        var result = await Grade(h, user, api).Handle(
            new GradePracticeModeCommand(Stream.Null, "set.m4a", Exercise(h, user, PracticeModes.PitchMatch).Id, leadIn), default);

        Assert.Equal("PRACTICE_LEAD_IN", result.Error.Code);
        Assert.Empty(api.Calls);
        Assert.Empty(h.Db.PracticeSessions);
    }

    [Fact]
    public async Task An_unknown_exercise_or_a_mode_switched_off_is_refused_without_reaching_the_worker()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeGraders(100);

        var unknown = await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "x.m4a", "steps-up@60", LeadIn), default);
        Assert.Equal("PRACTICE_EXERCISE_UNKNOWN", unknown.Error.Code);

        var rhythm = Exercise(h, user, PracticeModes.Rhythm);
        var off = await Grade(h, user, api, new PracticeModeSettings { Rhythm = false })
            .Handle(new GradePracticeModeCommand(Stream.Null, "x.m4a", rhythm.Id, LeadIn), default);
        Assert.Equal("PRACTICE_MODE_OFF", off.Error.Code);
        Assert.Equal(404, StatusOf(off.Error));

        Assert.Empty(api.Calls);
        Assert.Empty(h.Db.PracticeSessions);
    }

    [Fact]
    public async Task A_take_the_worker_refuses_is_not_recorded_and_does_not_count()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var result = await Grade(h, user, new FakeGraders(0) { Refuse = true })
            .Handle(new GradePracticeModeCommand(Stream.Null, "x.m4a", Exercise(h, user, PracticeModes.Intervals).Id, LeadIn), default);

        Assert.True(result.IsFailure);
        Assert.Empty(h.Db.PracticeSessions);
        Assert.Equal(0, (await Progress(h, user)).Drills.Used);
    }

    // ── The day's allowance, XP, streak, the path ───────────────────────────

    [Fact]
    public async Task Modes_and_drills_share_the_days_marked_drills()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeGraders(60);
        var drillApi = new DrillApi();
        var drill = (await NextDrill(h, user)).Id;

        for (var i = 0; i < 6; i++)
            Assert.True((await GradeDrill(h, user, drillApi).Handle(new GradeDrillCommand(Stream.Null, "d.m4a", drill), default)).IsSuccess);
        var interval = Exercise(h, user, PracticeModes.Intervals).Id;
        for (var i = 0; i < 4; i++)
            Assert.True((await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "i.m4a", interval, LeadIn), default)).IsSuccess);

        var mode = await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "i.m4a", interval, LeadIn), default);
        var path = await GradeDrill(h, user, drillApi).Handle(new GradeDrillCommand(Stream.Null, "d.m4a", drill), default);
        Assert.Equal("PRACTICE_DAILY_LIMIT", mode.Error.Code);
        Assert.Equal("PRACTICE_DAILY_LIMIT", path.Error.Code);
        Assert.Equal(4, api.Calls.Count);

        Assert.Equal((10, PracticeRules.FreeDrillGradesPerDay), ((await Progress(h, user)).Drills.Used, (await Progress(h, user)).Drills.Limit));
        Assert.Equal(10, (await NextDrill(h, user)).Allowance.Used);
        var listed = (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("intervals"), default)).Value;
        Assert.Equal((10, 10), (listed.Allowance.Used, listed.Allowance.Limit));

        // Pro has twenty; tomorrow the allowance is back.
        GoPro(h, user);
        Assert.True((await Grade(h, user, api).Handle(new GradePracticeModeCommand(Stream.Null, "i.m4a", interval, LeadIn), default)).IsSuccess);
        h.Clock.UtcNow = Now.AddDays(1);
        Assert.Equal(0, (await Progress(h, user)).Drills.Used);
    }

    [Fact]
    public async Task A_modes_take_earns_as_a_drill_does_and_keeps_the_streak()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        h.Db.PracticeSessions.Add(PracticeSession.Record(user.Id, PracticeKind.Drill, 70, 3, 0, 0, 0, 3, Now.AddDays(-1), Today.AddDays(-1)));
        h.Db.SaveChanges();
        Assert.True((await Progress(h, user)).Streak.AtRisk);

        var perfect = await Grade(h, user, new FakeGraders(100))
            .Handle(new GradePracticeModeCommand(Stream.Null, "r.m4a", Exercise(h, user, PracticeModes.Rhythm).Id, LeadIn), default);
        var good = await Grade(h, user, new FakeGraders(80))
            .Handle(new GradePracticeModeCommand(Stream.Null, "p.m4a", Exercise(h, user, PracticeModes.PitchMatch).Id, LeadIn), default);

        Assert.Equal((20, 15), (perfect.Value.Reward.XpGained, good.Value.Reward.XpGained));
        Assert.Equal(2, good.Value.Reward.Streak);
        var progress = await Progress(h, user);
        Assert.True(progress.Streak.TodayDone);
        Assert.Equal(35, progress.XpToday);
        Assert.Contains(perfect.Value.Reward.NewBadges, b => b.Code == "first_100");
        foreach (var kind in new[] { PracticeKind.PitchMatch, PracticeKind.Interval, PracticeKind.Harmony, PracticeKind.Run, PracticeKind.Rhythm })
            Assert.Equal(new[] { 10, 15, 20 }, new[] { 50, 80, 100 }.Select(score => PracticeRules.BaseXp(kind, score)));
    }

    [Fact]
    public async Task A_mode_never_moves_the_practice_path()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, PracticeTrack.Focused);
        GoPro(h, user);
        // On the path: one drill passed, so the next is the unit's second.
        var first = await NextDrill(h, user);
        await GradeDrill(h, user, new DrillApi(85)).Handle(new GradeDrillCommand(Stream.Null, "d.m4a", first.Id), default);
        var before = await NextDrill(h, user);
        var pathBefore = (await Progress(h, user)).Path;

        // Ten perfect takes across the modes: 150 XP, a level up, and not a step along the path.
        foreach (var mode in PracticeModes.Marked)
            for (var i = 0; i < 2; i++)
                Assert.True((await Grade(h, user, new FakeGraders(100)).Handle(
                    new GradePracticeModeCommand(Stream.Null, "x.m4a", Exercise(h, user, mode).Id, LeadIn), default)).IsSuccess);

        var after = await NextDrill(h, user);
        Assert.True(after.Level > before.Level);
        Assert.Equal(before.Id, after.Id);
        Assert.Equal((before.Grade, before.UnitIndex, before.DrillIndex), (after.Grade, after.UnitIndex, after.DrillIndex));
        Assert.Equal(pathBefore, (await Progress(h, user)).Path);
        Assert.Single(await PracticePathReader.TakesAsync(h.Db, user.Id, default));
        Assert.Equal(11, h.Db.PracticeSessions.Count());
    }

    // ── What the clients read ───────────────────────────────────────────────

    [Fact]
    public async Task The_progress_lists_the_modes_live_for_the_singers_track()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        Assert.Equal(PracticeModes.All, (await Progress(h, user)).Modes);

        var playful = await new SetPracticeTrackCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(),
            new PracticeModeSettings { Rhythm = false }).Handle(new SetPracticeTrackCommand("playful"), default);
        Assert.Equal(new[] { "warm-up", "pitch-match", "intervals" }, playful.Value.Modes);

        var playfulAgain = await Progress(h, user, new PracticeModeSettings { Harmony = false }); // not Playful's anyway
        Assert.Equal(new[] { "warm-up", "pitch-match", "intervals", "rhythm" }, playfulAgain.Modes);
    }

    [Fact]
    public async Task A_mode_lists_its_exercises_for_the_track_with_the_singers_best_marks()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, PracticeTrack.Focused);
        var runs = (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("Runs"), default)).Value;
        Assert.Equal(("runs", Today, PracticeTrack.Focused), (runs.Mode, runs.Date, runs.Track));
        Assert.Equal(12, runs.Exercises.Count);
        var pentatonic = runs.Exercises.Single(e => e.Code == "pentatonic");
        Assert.Equal(new[] { 60, 70, 80, 90, 100 }, pentatonic.Speeds!.Select(s => s.Percent));
        Assert.Equal(new[] { "notes", "notes", "notes", "run", "run" }, pentatonic.Speeds!.Select(s => s.Grader));
        Assert.Equal((36, "notes", 60), (pentatonic.TempoBpm, pentatonic.Grader, pentatonic.SpeedPercent));
        Assert.Equal("Runs down to doh", pentatonic.Group);
        Assert.StartsWith("Doh is ", pentatonic.DohHeader);
        Assert.All(runs.Exercises, e => Assert.Null(e.BestScore));

        await Grade(h, user, new FakeGraders(84)).Handle(new GradePracticeModeCommand(Stream.Null, "r.m4a", pentatonic.Speeds![2].ExerciseId, LeadIn), default);
        await Grade(h, user, new FakeGraders(70)).Handle(new GradePracticeModeCommand(Stream.Null, "r.m4a", pentatonic.Speeds![2].ExerciseId, LeadIn), default);
        var again = (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("runs"), default)).Value.Exercises.Single(e => e.Code == "pentatonic");
        Assert.Equal(new int?[] { null, null, 84, null, null }, again.Speeds!.Select(s => s.BestScore));
        Assert.Null(again.BestScore); // the listed exercise is the 60 % one
        Assert.Equal(2, (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("runs"), default)).Value.Allowance.Used);

        var rhythm = (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("rhythm"), default)).Value;
        Assert.All(rhythm.Exercises, e => Assert.True(e.Claps.Count > 0 && e.Notes.Count == 0 && e.Key is null));
        var pitch = (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("pitch-match"), default)).Value;
        Assert.All(pitch.Exercises, e => Assert.Equal(8, e.Backing.Count));
    }

    [Fact]
    public async Task Playful_is_offered_its_gentler_exercises()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, PracticeTrack.Playful);
        Assert.Equal(5, (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("intervals"), default)).Value.Exercises.Count);
        Assert.Equal(3, (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("pitch-match"), default)).Value.Exercises.Count);
        Assert.Equal(5, (await ModeQuery(h, user).Handle(new GetPracticeModeQuery("rhythm"), default)).Value.Exercises.Count);
    }

    [Theory]
    [InlineData("warm-up", "PRACTICE_MODE_UNKNOWN")] // the warm-up has its own route
    [InlineData("karaoke", "PRACTICE_MODE_UNKNOWN")]
    [InlineData(null, "PRACTICE_MODE_UNKNOWN")]
    [InlineData("harmony", "PRACTICE_MODE_OFF")]
    public async Task A_mode_the_server_has_not_or_has_switched_off_is_not_found(string? mode, string code)
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var result = await ModeQuery(h, user, new PracticeModeSettings { Harmony = false }).Handle(new GetPracticeModeQuery(mode), default);
        Assert.Equal(code, result.Error.Code);
        Assert.Equal(404, StatusOf(result.Error));
    }

    [Fact]
    public async Task The_warm_up_is_served_until_it_is_switched_off()
    {
        Assert.Equal(4, (await new GetWarmUpQueryHandler(new PracticeModeSettings()).Handle(new GetWarmUpQuery(), default)).Value.Steps.Count);
        Assert.Equal("PRACTICE_MODE_OFF",
            (await new GetWarmUpQueryHandler(new PracticeModeSettings { WarmUp = false }).Handle(new GetWarmUpQuery(), default)).Error.Code);
    }

    // ── The range finder ────────────────────────────────────────────────────

    [Fact]
    public async Task The_range_finder_keeps_each_end_as_measured_and_records_no_practice()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeGraders(0)
        {
            Range = new RangeReadingDto(new HeldNoteReading(55, -8.0, 2.9), new HeldNoteReading(57, 4.0, 1.2), 2, 9.0),
        };

        var low = await Range(h, user, api).Handle(new MeasureVoiceRangeCommand(Stream.Null, "low.m4a", "low"), default);
        Assert.True(low.IsSuccess, low.IsFailure ? low.Error.Message : null);
        Assert.Equal(55, low.Value.LowMidi);
        Assert.Null(low.Value.HighMidi);
        Assert.Equal(new HeldNoteDto(55, "G3", 2.9, -8.0), low.Value.Heard);
        Assert.Null(low.Value.VoicePart);

        api.Range = new RangeReadingDto(new HeldNoteReading(62, 0, 3.0), new HeldNoteReading(74, 12.0, 3.1), 2, 8.0);
        var high = await Range(h, user, api).Handle(new MeasureVoiceRangeCommand(Stream.Null, "high.m4a", "HIGH"), default);
        Assert.Equal(("G3", "D5", "An octave and a fifth", "s,", "r'", "alto"),
            (high.Value.Low, high.Value.High, high.Value.Span, high.Value.LowSolfa, high.Value.HighSolfa, high.Value.VoicePart));
        Assert.Equal(74, high.Value.Heard!.Midi);

        var stored = await new GetVoiceRangeQueryHandler(h.Db, new StubCurrentUser(user.Id)).Handle(new GetVoiceRangeQuery(), default);
        Assert.Equal((55, 74), (stored.Value.LowMidi, stored.Value.HighMidi));
        Assert.Null(stored.Value.Heard);
        Assert.Empty(h.Db.PracticeSessions);
        Assert.Equal(new[] { "range", "range" }, api.Calls);
    }

    [Fact]
    public async Task A_range_take_with_no_steady_note_or_no_end_named_is_refused()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var api = new FakeGraders(0) { Range = new RangeReadingDto(null, null, 0, 6.0) };

        var notHeard = await Range(h, user, api).Handle(new MeasureVoiceRangeCommand(Stream.Null, "low.m4a", "low"), default);
        var noEnd = await Range(h, user, api).Handle(new MeasureVoiceRangeCommand(Stream.Null, "low.m4a", "middle"), default);
        var off = await Range(h, user, api, new PracticeModeSettings { WarmUp = false })
            .Handle(new MeasureVoiceRangeCommand(Stream.Null, "low.m4a", "low"), default);

        Assert.Equal("PRACTICE_RANGE_NOT_HEARD", notHeard.Error.Code);
        Assert.Equal("PRACTICE_RANGE_END", noEnd.Error.Code);
        Assert.Equal("PRACTICE_MODE_OFF", off.Error.Code);
        Assert.Single(api.Calls);
        Assert.Null(h.Db.Users.Single(u => u.Id == user.Id).VoiceRangeLowMidi);
    }

    // ── The routes and the worker client ────────────────────────────────────

    [Fact]
    public void The_new_routes_are_signed_in_and_takes_are_limited_before_they_are_read()
    {
        var controller = typeof(PracticeController);
        Assert.NotNull(controller.GetCustomAttribute<AuthorizeAttribute>());
        foreach (var (name, template) in new[] { (nameof(PracticeController.GradeMode), "modes/grade"), (nameof(PracticeController.MeasureRange), "range") })
        {
            var method = controller.GetMethod(name)!;
            Assert.Equal(template, method.GetCustomAttribute<HttpPostAttribute>()!.Template);
            Assert.NotNull(method.GetCustomAttribute<PracticeDrillRateLimitAttribute>());
            Assert.NotNull(method.GetCustomAttribute<RequestSizeLimitAttribute>());
        }
        Assert.Equal("modes/{mode}", controller.GetMethod(nameof(PracticeController.Mode))!.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.Equal("warm-up", controller.GetMethod(nameof(PracticeController.WarmUp))!.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.Equal("range", controller.GetMethod(nameof(PracticeController.VoiceRange))!.GetCustomAttribute<HttpGetAttribute>()!.Template);
    }

    [Fact]
    public async Task The_route_reads_a_modes_lead_in_as_invariant_seconds()
    {
        var sender = new CommandSender();
        var controller = new PracticeController(sender) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        IFormFile Take() => new FormFile(new MemoryStream([1, 2, 3]), 0, 3, "audio", "set.m4a");
        var culture = System.Globalization.CultureInfo.CurrentCulture;
        System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("fr-FR");
        try
        {
            await controller.GradeMode(new GradePracticeModeRequest { Audio = Take(), ExerciseId = "rhythm:steady", LeadInSec = "4.5" }, default);
            await controller.GradeMode(new GradePracticeModeRequest { Audio = Take(), ExerciseId = "rhythm:steady" }, default);
            var junk = await controller.GradeMode(new GradePracticeModeRequest { Audio = Take(), ExerciseId = "rhythm:steady", LeadInSec = "soon" }, default);
            var empty = await controller.GradeMode(new GradePracticeModeRequest { ExerciseId = "rhythm:steady", LeadInSec = "4" }, default);

            Assert.Equal(new double?[] { 4.5, null }, sender.Sent.OfType<GradePracticeModeCommand>().Select(c => c.LeadInSec));
            Assert.Equal(422, Assert.IsType<ObjectResult>(junk).StatusCode);
            Assert.Equal(422, Assert.IsType<ObjectResult>(empty).StatusCode);
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = culture;
        }
    }

    [Fact]
    public async Task The_worker_client_posts_each_take_to_its_grader_and_reads_the_answer()
    {
        var handler = new StubHttpMessageHandler((request, _) => StubHttpMessageHandler.Respond(HttpStatusCode.OK, request.RequestUri!.AbsolutePath switch
        {
            "/v1/grade" => """{"score":90,"hits":2,"near":0,"wrong":0,"missed":0,"tuningCents":2,"offsetSec":0.1,"octaveShift":0,"summary":"Good.","notes":[]}""",
            "/v1/grade/run" => """{"score":88,"followed":4,"runNotes":5,"landingStatus":"near","landingCents":-50.5,"landingMidi":58,"offsetSec":0.1,"octaveShift":-12,"summary":"Run.","notes":[{"index":0,"targetMidi":70,"followed":true,"status":"hit"}],"trace":[{"t":0.0,"midi":70.1}]}""",
            "/v1/grade/rhythm" => """{"score":75,"hits":2,"near":1,"missed":0,"extra":1,"offsetSec":0.2,"tempoRatio":1.04,"summary":"Claps.","claps":[{"index":0,"beat":0.0,"errorMs":3.0,"status":"hit"},{"index":1,"beat":1.0,"errorMs":null,"status":"missed"}]}""",
            _ => """{"holds":[{"midi":55,"pitch":54.9,"cents":-10,"startSec":1.2,"seconds":2.8}],"lowest":{"midi":55,"pitch":54.9,"cents":-10,"startSec":1.2,"seconds":2.8},"highest":{"midi":55,"pitch":54.9,"cents":-10,"startSec":1.2,"seconds":2.8},"secondsHeard":5.0}""",
        }));
        IPracticeAudioApi client = new TranscriptionApiClient(
            new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);
        var target = new GradeTargetDto([new(60, 0, 1), new(64, 1, 1)], 60, 4);

        var pitch = await client.GradeNotesAsync(new MemoryStream([1]), "set.m4a", target, 60, 0.35);
        var plain = await client.GradeNotesAsync(new MemoryStream([1]), "i.m4a", target, 12);
        var run = await client.GradeRunAsync(new MemoryStream([1]), "r.m4a", target, 10);
        var rhythm = await client.GradeRhythmAsync(new MemoryStream([1]), "c.m4a", [0, 1, 3], 80, 4, 12);
        var range = await client.ReadRangeAsync(new MemoryStream([1]), "low.m4a");

        Assert.Contains("\"offsetSearchSec\":0.35", handler.Requests[0].Body);
        Assert.Contains("\"maxSec\":60", handler.Requests[0].Body);
        Assert.DoesNotContain("offsetSearchSec", handler.Requests[1].Body);
        Assert.Equal("/v1/grade/run", handler.Requests[2].Uri!.AbsolutePath);
        Assert.Contains("\"beats\":[0,1,3]", handler.Requests[3].Body);
        Assert.DoesNotContain("name=target", handler.Requests[4].Body);

        Assert.Equal(90, pitch.Value.Score);
        Assert.Equal(90, plain.Value.Score);
        Assert.Equal(("near", (double?)-50.5, -12, 1), (run.Value.Landing, run.Value.LandingCents, run.Value.OctaveShift, run.Value.Trace.Count));
        Assert.Equal((1, 1.04, (double?)null), (rhythm.Value.Extra, rhythm.Value.TempoRatio, rhythm.Value.Claps[1].ErrorMs));
        Assert.Equal((55, 2.8, -10.0), (range.Value.Lowest!.Midi, range.Value.Lowest.Seconds, range.Value.Lowest.Cents));
    }

    [Fact]
    public async Task A_worker_refusal_reads_as_the_workers_plain_sentence()
    {
        var handler = StubHttpMessageHandler.Returning(HttpStatusCode.UnprocessableEntity, """{"detail":"The take could not be read. Record it again and resend it."}""");
        IPracticeAudioApi client = new TranscriptionApiClient(
            new HttpClient(handler) { BaseAddress = new Uri("http://worker/") }, new ConfigurationBuilder().Build(), NullLogger<TranscriptionApiClient>.Instance);

        var range = await client.ReadRangeAsync(new MemoryStream([1]), "low.m4a");

        Assert.Equal("TRANS_INPUT_REJECTED", range.Error.Code);
        Assert.Equal("The take could not be read. Record it again and resend it.", range.Error.Message);
    }

    // ── Harness ─────────────────────────────────────────────────────────────

    private static int StatusOf(Error error) => error.Type switch
    {
        ErrorType.NotFound => 404,
        ErrorType.Validation => 422,
        ErrorType.Forbidden => 403,
        _ => 500
    };

    private static User Seed(TestHarness h, PracticeTrack? track = null)
    {
        var user = User.Create("Chorister", "modes@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
        if (track is { } t)
            user.ChoosePracticeTrack(t);
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

    /// <summary>The first exercise the caller is offered in a mode today (or the one with this code).</summary>
    private static PracticeExerciseDto Exercise(TestHarness h, User user, string mode, string? code = null)
    {
        var listed = ModeQuery(h, user).Handle(new GetPracticeModeQuery(mode), default).GetAwaiter().GetResult().Value.Exercises;
        return code is null ? listed[0] : listed.Single(e => e.Code == code);
    }

    private static GradePracticeModeCommandHandler Grade(TestHarness h, User user, IPracticeAudioApi api, PracticeModeSettings? modes = null)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db),
            modes ?? new PracticeModeSettings());

    private static MeasureVoiceRangeCommandHandler Range(TestHarness h, User user, IPracticeAudioApi api, PracticeModeSettings? modes = null)
        => new(api, h.Db, new StubCurrentUser(user.Id), modes ?? new PracticeModeSettings());

    private static GetPracticeModeQueryHandler ModeQuery(TestHarness h, User user, PracticeModeSettings? modes = null)
        => new(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), modes ?? new PracticeModeSettings());

    private static GradeDrillCommandHandler GradeDrill(TestHarness h, User user, ITranscriptionApi api)
        => new(api, h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db));

    private static async Task<DrillDto> NextDrill(TestHarness h, User user)
        => (await new GetNextDrillQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetNextDrillQuery(), default)).Value;

    private static async Task<PracticeProgressDto> Progress(TestHarness h, User user, PracticeModeSettings? modes = null)
        => (await new GetPracticeProgressQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), modes)
            .Handle(new GetPracticeProgressQuery(), default)).Value;

    /// <summary>The worker's practice graders, faked: each call noted, every note marked as the score says.</summary>
    private sealed class FakeGraders(int score) : IPracticeAudioApi
    {
        public List<string> Calls { get; } = [];
        public GradeTargetDto? LastTarget { get; private set; }
        public double? LastMaxTake { get; private set; }
        public double? LastOffsetSearch { get; private set; }
        public IReadOnlyList<double>? LastBeats { get; private set; }
        public double LastTempo { get; private set; }
        public double LastLeadIn { get; private set; }
        public bool Refuse { get; init; }
        public RunGradeDto? Run { get; init; }
        public RhythmGradeDto? Rhythm { get; init; }
        public RangeReadingDto Range { get; set; } = new(null, null, 0, 0);

        private static readonly Error Refused = Error.Validation("TRANS_INPUT_REJECTED", "The take could not be read.");

        public Task<Result<GradeResultDto>> GradeNotesAsync(Stream audio, string fileName, GradeTargetDto target, double maxTakeSeconds,
            double? offsetSearchSeconds = null, CancellationToken cancellationToken = default)
        {
            Calls.Add("notes");
            (LastTarget, LastMaxTake, LastOffsetSearch) = (target, maxTakeSeconds, offsetSearchSeconds);
            if (Refuse)
                return Task.FromResult(Result.Failure<GradeResultDto>(Refused));
            return Task.FromResult(Result.Success(new GradeResultDto(score, target.Notes.Count, 0, 0, 0, 2.0, 0.1, 0, "Good.",
                target.Notes.Select((n, i) => new GradeNoteDto(i, n.PitchMidi, n.PitchMidi, 2.0, "hit")).ToList())));
        }

        public Task<Result<RunGradeDto>> GradeRunAsync(Stream audio, string fileName, GradeTargetDto target, double maxTakeSeconds,
            CancellationToken cancellationToken = default)
        {
            Calls.Add("run");
            (LastTarget, LastMaxTake) = (target, maxTakeSeconds);
            if (Refuse)
                return Task.FromResult(Result.Failure<RunGradeDto>(Refused));
            var notes = target.Notes.Take(target.Notes.Count - 1).Select((n, i) => new RunNoteMarkDto(i, n.PitchMidi, true, "hit")).ToList();
            return Task.FromResult(Result.Success(Run ?? new RunGradeDto(score, notes.Count, notes.Count, "hit", 1.0,
                target.Notes[^1].PitchMidi, 0.1, 0, "You followed the run and landed in tune.", notes, [])));
        }

        public Task<Result<RhythmGradeDto>> GradeRhythmAsync(Stream audio, string fileName, IReadOnlyList<double> beats, double tempoBpm,
            double leadInSec, double maxTakeSeconds, CancellationToken cancellationToken = default)
        {
            Calls.Add("rhythm");
            (LastBeats, LastTempo, LastLeadIn, LastMaxTake) = (beats, tempoBpm, leadInSec, maxTakeSeconds);
            if (Refuse)
                return Task.FromResult(Result.Failure<RhythmGradeDto>(Refused));
            return Task.FromResult(Result.Success(Rhythm ?? new RhythmGradeDto(score, beats.Count, 0, 0, 0, 0.1, 1.0, "In time.",
                beats.Select((b, i) => new ClapMarkDto(i, b, 5.0, "hit")).ToList())));
        }

        public Task<Result<RangeReadingDto>> ReadRangeAsync(Stream audio, string fileName, CancellationToken cancellationToken = default)
        {
            Calls.Add("range");
            return Task.FromResult(Refuse ? Result.Failure<RangeReadingDto>(Refused) : Result.Success(Range));
        }
    }

    /// <summary>The drill grader, for the path's own takes beside the modes'.</summary>
    private sealed class DrillApi(int score = 60) : ITranscriptionApi
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

    /// <summary>Keeps each request the route sends on, and answers as if the exercise were gone.</summary>
    private sealed class CommandSender : MediatR.ISender
    {
        public List<object> Sent { get; } = [];

        public Task<TResponse> Send<TResponse>(MediatR.IRequest<TResponse> request, CancellationToken cancellationToken = default)
        {
            Sent.Add(request);
            return Task.FromResult((TResponse)(object)Result.Failure<PracticeModeGradeDto>(Application.Common.Errors.PracticeErrors.ExerciseNotFound));
        }

        public Task Send<TRequest>(TRequest request, CancellationToken cancellationToken = default) where TRequest : MediatR.IRequest => throw new NotSupportedException();
        public Task<object?> Send(object request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<TResponse> CreateStream<TResponse>(MediatR.IStreamRequest<TResponse> request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public IAsyncEnumerable<object?> CreateStream(object request, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
