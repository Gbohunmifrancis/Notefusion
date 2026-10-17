using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The practice path: grades → units → drills in order; a pass moves on, a miss brings the drill back once and then an
/// easier variant, two very good takes skip ahead and two very poor ones step back; unit and grade milestones fire
/// once; the next drill is the same on every read until a take of it is marked; and none of it changes the XP.
/// </summary>
public class PracticePathTests
{
    private static readonly Guid UserId = Guid.Parse("8f1c2a8e-5b8a-4a51-9f60-1d2b3c4d5e6f");
    private static readonly DateOnly Day = new(2026, 10, 17);

    // 19:00 in Lagos, Saturday 17 October.
    private static readonly DateTime Now = new(2026, 10, 17, 18, 0, 0, DateTimeKind.Utc);

    // ── The path's shape ────────────────────────────────────────────────────

    [Fact]
    public void The_ladder_runs_grade_by_grade_unit_by_unit_easiest_first()
    {
        var units = PracticePath.UnitsFor(null);

        Assert.Equal((DrillCatalogue.LadderTopTier + 1) * DrillSyllabus.UnitsPerGrade, units.Count);
        for (var i = 0; i < units.Count; i++)
        {
            var u = units[i];
            Assert.Equal(i, u.Position);
            Assert.Equal(i / DrillSyllabus.UnitsPerGrade, u.Tier);
            Assert.Equal(i % DrillSyllabus.UnitsPerGrade + 1, u.Step);
            Assert.Equal(u.Step, u.UnitNumber);
            Assert.Equal(DrillSyllabus.UnitsPerGrade, u.UnitsInGrade);
            Assert.Equal(PracticeRules.DrillsPerUnit, u.DrillCount);
            Assert.Equal(u.Step == DrillSyllabus.UnitsPerGrade, u.LastInGrade);
        }
        Assert.Equal("Grade 1", units[0].Grade.Label);
        Assert.Equal("Doh, ray, me", units[0].Unit.Title);
        Assert.Equal("Grade 8", units[^1].Grade.Label);
    }

    [Fact]
    public void Playful_sings_the_first_units_of_grades_one_to_seven_and_Focused_reaches_the_advanced_grades()
    {
        var playful = PracticePath.UnitsFor(PracticeTrack.Playful);
        Assert.All(playful, u =>
        {
            Assert.InRange(u.Tier, 0, PracticeRules.PlayfulTopTier);
            Assert.InRange(u.Step, 1, PracticeRules.PlayfulTopStep);
            Assert.Equal(PracticeRules.PlayfulDrillsPerUnit, u.DrillCount);
            Assert.All(DrillCatalogue.UnitPatterns(PracticeTrack.Playful, u.Tier, u.Step), p => Assert.True(DrillCatalogue.IsPlayful(p)));
        });
        Assert.Equal(Enumerable.Range(0, PracticeRules.PlayfulTopTier + 1), playful.Select(u => u.Tier).Distinct());
        Assert.True(playful.Zip(playful.Skip(1)).All(p => (p.First.Tier, p.First.Step).CompareTo((p.Second.Tier, p.Second.Step)) < 0));

        var focused = PracticePath.UnitsFor(PracticeTrack.Focused);
        Assert.Equal((DrillCatalogue.TopTier + 1) * DrillSyllabus.UnitsPerGrade, focused.Count);
        Assert.Equal("Advanced 2", focused[^1].Grade.Label);
    }

    [Theory]
    [InlineData(null, 0, 0)]
    [InlineData(null, 3, 3)]
    [InlineData(null, 99, 7)]
    [InlineData(PracticeTrack.Focused, 0, 2)] // a beginner who wants the work starts on scales
    [InlineData(PracticeTrack.Focused, 7, 9)]
    [InlineData(PracticeTrack.Playful, 0, 0)]
    [InlineData(PracticeTrack.Playful, 9, 6)]
    public void A_singer_starts_on_the_first_drill_of_their_levels_grade(PracticeTrack? track, int level, int tier)
    {
        var entry = PracticePath.Entry(track, level);
        var unit = PracticePath.UnitsFor(track)[entry.Position];

        Assert.Equal(tier, unit.Tier);
        Assert.Equal(1, unit.UnitNumber);
        Assert.Equal(0, entry.Slot);
    }

    // ── Moving on ───────────────────────────────────────────────────────────

    [Fact]
    public void The_next_drill_is_the_same_on_every_read_until_a_take_of_it_is_marked()
    {
        var s = new Singer();
        var first = s.Next;

        Assert.Equal(first.Drill.Id, s.Next.Drill.Id);
        Assert.Equal(first.Drill.Id, PracticePath.Next(UserId, null, PracticePath.Read(UserId, [], _ => 0), 0).Drill.Id);

        // Takes of other drills (sung again for practice, or from an old screen) leave the path where it is.
        s.SingId("steps-down@60", 100);
        s.SingId(null, 100);
        Assert.Equal(first.Drill.Id, s.Next.Drill.Id);

        s.Sing(85);
        Assert.NotEqual(first.Drill.Id, s.Next.Drill.Id);
        Assert.Equal(1, s.Next.Place.Slot);
    }

    [Fact]
    public void A_unit_is_its_drills_passed_in_turn_then_the_next_unit_begins()
    {
        var s = new Singer();
        var ids = new List<string>();
        for (var i = 0; i < PracticeRules.DrillsPerUnit; i++)
        {
            Assert.Equal((0, i), (s.Next.Place.Position, s.Next.Place.Slot));
            ids.Add(s.Sing(PracticeRules.PassScore).Drill.Id);
        }

        Assert.Equal((1, 0), (s.Next.Place.Position, s.Next.Place.Slot));
        Assert.Equal("Up and home", s.Next.Unit.Unit.Title);
        Assert.Equal(2, s.Next.Unit.UnitNumber);
        // Different drills in turn: never the same twice in a row.
        Assert.All(ids.Zip(ids.Skip(1)), p => Assert.NotEqual(p.First, p.Second));
    }

    [Fact]
    public void A_miss_brings_the_drill_back_once_then_an_easier_variant_until_one_is_passed()
    {
        var s = new Singer();
        s.PassUnit(); // into Grade 1, unit 2
        var drill = s.Next;

        s.Sing(79);
        Assert.Equal(drill.Drill.Id, s.Next.Drill.Id);
        Assert.Equal(DrillAdjustment.Steady, s.Next.Adjustment);

        s.Sing(70);
        var easier = s.Next;
        Assert.NotEqual(drill.Drill.Id, easier.Drill.Id);
        Assert.Equal(DrillAdjustment.Easier, easier.Adjustment);
        Assert.Equal((0, 1), (easier.Drill.Pattern.Tier, easier.Drill.Pattern.Step)); // the unit before's
        Assert.Equal((1, 0), (easier.Place.Position, easier.Place.Slot));             // still unit 2's first drill

        s.Sing(60);
        Assert.Equal((0, 1), (s.Next.Drill.Pattern.Tier, s.Next.Drill.Pattern.Step));
        Assert.Equal(3, s.Next.Place.Misses);

        s.Sing(85);
        Assert.Equal((1, 1, 0), (s.Next.Place.Position, s.Next.Place.Slot, s.Next.Place.Misses));
        Assert.Equal(DrillAdjustment.Steady, s.Next.Adjustment);
        Assert.Equal(2, s.Next.Drill.Pattern.Step);
    }

    [Fact]
    public void Two_takes_of_ninety_or_more_in_a_row_skip_ahead_a_drill_the_same_day()
    {
        var s = new Singer();
        s.Sing(95);
        Assert.Equal(1, s.Next.Place.Slot);
        s.Sing(92);
        Assert.Equal(3, s.Next.Place.Slot);
        Assert.Equal(DrillAdjustment.Harder, s.Next.Adjustment);

        // The run starts again after a skip, and a day's session is its own.
        var t = new Singer();
        t.Sing(95, Day);
        t.Sing(95, Day.AddDays(1));
        Assert.Equal(2, t.Next.Place.Slot);
        Assert.Equal(DrillAdjustment.Steady, t.Next.Adjustment);
    }

    [Fact]
    public void An_observer_sees_each_take_that_moved_the_path_with_its_outcome_and_the_reading_is_unchanged()
    {
        var s = new Singer();
        for (var i = 0; i < PracticeRules.DrillsPerUnit; i++)
            s.Sing(85);
        s.Sing(60);   // a miss
        s.Sing(85);   // the retry, passed
        s.Sing(30);
        s.Sing(25);   // the second under 50 in a row: a step back
        s.SingId("steps-down@60", 100); // not the offered drill: moves nothing, so not observed
        var t = new Singer();
        t.Sing(95);
        t.Sing(92);   // the second 90+ in a row: a skip ahead

        var steps = s.Steps;
        Assert.Equal(8, steps.Count);
        Assert.All(steps, step => Assert.Null(step.Track));
        Assert.Equal([false, false, false, true, false, false, false, false], steps.Select(x => x.FinishedUnit));
        Assert.Equal([true, true, true, true, false, true, false, false], steps.Select(x => x.Passed));
        Assert.Equal([false, false, false, false, false, true, false, true], steps.Select(x => x.Retry));
        Assert.Equal([false, false, false, false, false, false, false, true], steps.Select(x => x.SteppedBack));
        Assert.Equal([0, 0, 0, 0, 1, 1, 1, 1], steps.Select(x => x.Unit.Position));
        Assert.Equal([false, true], t.Steps.Select(x => x.SkippedAhead));
        // Observing reads the same path: the place after the last step is where the next drill is offered.
        Assert.Equal(s.Next.Place, steps[^1].After);
    }

    [Fact]
    public void A_skip_never_skips_a_new_units_first_drill()
    {
        var s = new Singer();
        s.Sing(85);
        s.Sing(85);
        s.Sing(95); // slot 3
        s.Sing(95); // the unit's last drill: finished, and the next unit starts at its first

        Assert.Equal((1, 0), (s.Next.Place.Position, s.Next.Place.Slot));
        Assert.Equal(DrillAdjustment.Steady, s.Next.Adjustment);
    }

    [Fact]
    public void Two_takes_under_fifty_in_a_row_step_back_to_the_previous_drill()
    {
        var s = new Singer();
        var passed = s.Sing(85).Drill.Id;
        var second = s.Sing(85);
        Assert.Equal(2, s.Next.Place.Slot);

        s.Sing(30);
        s.Sing(40);

        Assert.Equal(1, s.Next.Place.Slot);
        Assert.Equal(second.Drill.Id, s.Next.Drill.Id);
        Assert.Equal(DrillAdjustment.Easier, s.Next.Adjustment);
        Assert.NotEqual(passed, s.Next.Drill.Id);

        // At a unit's first drill there is nothing to step back to: an easier variant instead.
        var t = new Singer();
        t.PassUnit();
        var start = t.Next;
        t.Sing(20);
        t.Sing(20);
        Assert.Equal((1, 0), (t.Next.Place.Position, t.Next.Place.Slot));
        Assert.NotEqual(start.Drill.Id, t.Next.Drill.Id);
        Assert.Equal(DrillAdjustment.Easier, t.Next.Adjustment);
    }

    // ── Milestones ──────────────────────────────────────────────────────────

    [Fact]
    public void Each_unit_finished_is_a_milestone_and_the_grades_last_is_a_grade_milestone()
    {
        var s = new Singer();
        var reached = new List<(int Take, MilestoneKind Kind, string Code)>();
        for (var i = 0; i < DrillSyllabus.UnitsPerGrade * PracticeRules.DrillsPerUnit; i++)
        {
            s.Sing(85);
            if (s.Reading.ReachedBy(s.LastSessionId) is { } m)
                reached.Add((i + 1, m.Kind, m.Unit.Code));
        }

        Assert.Equal(
            new[] { (4, MilestoneKind.Unit, "g0u1"), (8, MilestoneKind.Unit, "g0u2"), (12, MilestoneKind.Unit, "g0u3"), (16, MilestoneKind.Unit, "g0u4"), (20, MilestoneKind.Grade, "g0u5") },
            reached);
        Assert.Equal(2, s.Reading.Milestones.Count(m => m.SessionId == s.LastSessionId)); // the unit and the grade
        Assert.Equal((5, 1), (s.Reading.UnitsComplete, s.Reading.GradesComplete));
        Assert.Equal("Grade 2", s.Next.Unit.Grade.Label);
        Assert.Equal(1, s.Next.Unit.UnitNumber);
    }

    [Fact]
    public void A_unit_or_grade_is_a_milestone_once_whichever_track_finishes_it()
    {
        var s = new Singer { Track = PracticeTrack.Playful };
        for (var i = 0; i < PracticeRules.PlayfulDrillsPerUnit; i++)
            s.Sing(85);
        Assert.Equal(MilestoneKind.Unit, s.Reading.ReachedBy(s.LastSessionId)!.Kind);

        s.Track = null;
        for (var i = 0; i < PracticeRules.DrillsPerUnit; i++)
            s.Sing(85);

        Assert.Equal((1, 0), (s.Next.Place.Position, s.Next.Place.Slot)); // the ladder finished g0u1 too
        Assert.Null(s.Reading.ReachedBy(s.LastSessionId));
        Assert.Single(s.Reading.Milestones);
    }

    [Fact]
    public void Past_the_end_of_the_path_the_last_unit_is_sung_again_without_milestones()
    {
        var s = new Singer { Track = PracticeTrack.Playful, Level = 9 }; // Playful's last grade from the start
        var units = PracticePath.UnitsFor(PracticeTrack.Playful).Count(u => u.Tier == PracticeRules.PlayfulTopTier);
        for (var i = 0; i < units * PracticeRules.PlayfulDrillsPerUnit; i++)
            s.Sing(85);
        var milestones = s.Reading.Milestones.Count;
        Assert.Contains(s.Reading.Milestones, m => m.Kind == MilestoneKind.Grade);

        var review = new List<string>();
        for (var i = 0; i < 2 * PracticeRules.PlayfulDrillsPerUnit; i++)
        {
            Assert.True(s.Next.Review);
            review.Add(s.Sing(85).Drill.Id);
        }

        Assert.Equal(milestones, s.Reading.Milestones.Count);
        Assert.True(review.Distinct().Count() > 1);
    }

    [Fact]
    public void A_path_starts_at_the_level_held_before_its_first_take()
    {
        var s = new Singer { Level = 3 };
        Assert.Equal(3, s.Next.Unit.Tier);

        s.Sing(85);
        s.Level = 5; // levelling up later does not move a path already begun

        Assert.Equal((3, 1), (s.Next.Unit.Tier, s.Next.Place.Slot));
    }

    // ── Through the handlers ────────────────────────────────────────────────

    [Fact]
    public async Task Next_and_today_answer_the_same_drill_with_its_place_on_the_path()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var next = await NextDrill(h, user);
        var today = await TodayDrill(h, user);

        Assert.Equal(next.Id, today.Id);
        Assert.Equal(next.Id, (await NextDrill(h, user)).Id);
        Assert.Equal(("Grade 1", "Doh, ray, me", 1, 5, 1, 4), (next.Grade, next.Unit, next.UnitIndex, next.UnitCount, next.DrillIndex, next.DrillCount));
        Assert.Equal(1, next.Difficulty);
        Assert.Equal(DrillAdjustment.Steady, next.Adjustment);
        Assert.Equal(new DateTime(2026, 10, 17, 23, 0, 0, DateTimeKind.Utc), next.Allowance.ResetsAtUtc); // Lagos midnight
    }

    [Fact]
    public async Task A_marked_take_moves_the_next_drill_on_and_a_take_sung_again_does_not()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        var first = await NextDrill(h, user);

        await Sing(h, user, first.Id, 85);
        var second = await NextDrill(h, user);
        Assert.NotEqual(first.Id, second.Id);
        Assert.Equal(2, second.DrillIndex);
        Assert.Equal(second.Id, (await TodayDrill(h, user)).Id); // shipped apps move on too

        var again = await Sing(h, user, first.Id, 100); // "Sing it again": marked and rewarded, the path unmoved
        Assert.Equal(20, again.Reward!.XpGained);
        Assert.Equal(second.Id, (await NextDrill(h, user)).Id);

        await Sing(h, user, second.Id, 60);
        Assert.Equal(second.Id, (await NextDrill(h, user)).Id); // once more
        await Sing(h, user, second.Id, 60);
        var easier = await NextDrill(h, user);
        Assert.NotEqual(second.Id, easier.Id);
        Assert.Equal(DrillAdjustment.Easier, easier.Adjustment);
        Assert.Equal(2, easier.DrillIndex);
    }

    [Fact]
    public async Task The_grade_response_reports_a_unit_milestone_on_the_take_that_finishes_it_and_never_again()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        var milestones = new List<PracticeMilestoneDto?>();
        for (var i = 0; i < PracticeRules.DrillsPerUnit + 1; i++)
            milestones.Add((await Sing(h, user, (await NextDrill(h, user)).Id, 85)).Milestone);

        Assert.Equal(new PracticeMilestoneDto?[] { null, null, null }, milestones.Take(3));
        var unit = milestones[3]!;
        Assert.Equal("unit", unit.Kind);
        Assert.Equal("Unit 1 of Grade 1 complete", unit.Title);
        Assert.Equal("You can sing doh, ray and me, up and down.", unit.Description);
        Assert.Equal(("Grade 1", 1, 5), (unit.Grade, unit.UnitIndex, unit.UnitCount));
        Assert.Null(milestones[4]);

        var progress = await Progress(h, user);
        Assert.Equal(new PracticePathDto("Grade 1", "Up and home", 2, 5, 2, 4, 1, 0), progress.Path);
    }

    [Fact]
    public async Task Finishing_a_grade_says_what_the_singer_can_now_do_and_the_next_grade_begins()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);
        GoPro(h, user); // twenty a day: a whole grade in one sitting

        PracticeMilestoneDto? last = null;
        for (var i = 0; i < DrillSyllabus.UnitsPerGrade * PracticeRules.DrillsPerUnit; i++)
            last = (await Sing(h, user, (await NextDrill(h, user)).Id, 85)).Milestone;

        Assert.Equal("grade", last!.Kind);
        Assert.Equal("Grade 1 complete", last.Title);
        Assert.StartsWith("You can now sing doh, ray, me and fah", last.Description);
        var next = await NextDrill(h, user);
        Assert.Equal(("Grade 2", 1), (next.Grade, next.UnitIndex));
        Assert.Equal((5, 1), ((await Progress(h, user)).Path!.UnitsComplete, (await Progress(h, user)).Path!.GradesComplete));
    }

    [Fact]
    public async Task The_path_moves_nothing_but_the_drill_xp_is_the_takes_own()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h);

        // Pass, miss, miss (an easier variant follows), pass the variant: XP is 15 + 10 + 10 + 20, as it always was.
        int[] scores = [85, 60, 60, 100];
        var gained = new List<int>();
        foreach (var score in scores)
            gained.Add((await Sing(h, user, (await NextDrill(h, user)).Id, score)).Reward!.XpGained);

        Assert.Equal(scores.Select(s => PracticeRules.BaseXp(PracticeKind.Drill, s)), gained);
        Assert.Equal(55, (await Progress(h, user)).Xp);
    }

    // ── Harness ─────────────────────────────────────────────────────────────

    /// <summary>A singer on the path, without a database: takes of whatever drill the path offers.</summary>
    private sealed class Singer
    {
        private readonly List<PathTake> _takes = [];
        private readonly Dictionary<DateTime, int> _levelAt = [];
        private int _minute;

        public PracticeTrack? Track { get; set; }
        public int Level { get; set; }

        /// <summary>The path read off the takes; each take's level is the one the singer had when it was sung.</summary>
        public PathReading Reading => PracticePath.Read(UserId, _takes, at => _levelAt[at]);

        /// <summary>The takes that moved a path, as an observer of the same reading sees them.</summary>
        public List<PathStep> Steps
        {
            get
            {
                var steps = new List<PathStep>();
                PracticePath.Read(UserId, _takes, at => _levelAt[at], steps.Add);
                return steps;
            }
        }
        public PathStop Next => PracticePath.Next(UserId, Track, Reading, Level);
        public Guid LastSessionId => _takes[^1].SessionId;

        public PathStop Sing(int score, DateOnly? day = null)
        {
            var stop = Next;
            SingId(stop.Drill.Id, score, day);
            return stop;
        }

        public void SingId(string? drillId, int score, DateOnly? day = null)
        {
            var on = day ?? Day;
            var at = on.ToDateTime(new TimeOnly(8, 0), DateTimeKind.Utc).AddMinutes(++_minute);
            _levelAt[at] = Level;
            _takes.Add(new PathTake(Guid.NewGuid(), drillId, score, at, on));
        }

        public void PassUnit()
        {
            var position = Next.Place.Position;
            while (Next.Place.Position == position)
                Sing(PracticeRules.PassScore);
        }
    }

    private static async Task<GradeResultDto> Sing(TestHarness h, User user, string drillId, int score)
    {
        h.Clock.UtcNow = h.Clock.UtcNow.AddSeconds(30); // takes are read in the order they were sung
        var result = await new GradeDrillCommandHandler(
                new FixedScoreApi(score), h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone(), h.QuotaGate, new PracticeRecorder(h.Db))
            .Handle(new GradeDrillCommand(Stream.Null, "take.m4a", drillId), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    private static async Task<DrillDto> NextDrill(TestHarness h, User user)
        => (await new GetNextDrillQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetNextDrillQuery(), default)).Value;

    private static async Task<DrillDto> TodayDrill(TestHarness h, User user)
        => (await new GetTodayDrillQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetTodayDrillQuery(), default)).Value;

    private static async Task<PracticeProgressDto> Progress(TestHarness h, User user)
        => (await new GetPracticeProgressQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetPracticeProgressQuery(), default)).Value;

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Chorister", "tenor@example.com", h.Hasher.Hash("password123"), Now.AddDays(-30));
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
