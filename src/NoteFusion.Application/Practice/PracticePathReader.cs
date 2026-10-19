using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice;

/// <summary>
/// The practice path read for one account from its rows (<see cref="PracticePath"/> does the reading), and its
/// places and milestones put into the words the clients show.
/// </summary>
public static class PracticePathReader
{
    /// <summary>An account's marked drills, as the path reads them.</summary>
    public static async Task<List<PathTake>> TakesAsync(IApplicationDbContext db, Guid userId, CancellationToken ct)
        => await db.PracticeSessions
            .AsNoTracking()
            .Where(s => s.UserId == userId && s.Kind == PracticeKind.Drill && s.DrillId != null)
            .Select(s => new PathTake(s.Id, s.DrillId, s.Score, s.CreatedAtUtc, s.LocalDate))
            .ToListAsync(ct);

    /// <summary>Every track's path, read off the account's drills; a path starts at the level held before its first take.</summary>
    public static async Task<PathReading> ReadAsync(
        IApplicationDbContext db, Guid userId, IReadOnlyCollection<PracticeFact> facts, CancellationToken ct)
        => PracticePath.Read(
            userId,
            await TakesAsync(db, userId, ct),
            at => PracticeMath.LevelFor(PracticeMath.TotalXp(facts.Where(f => f.CreatedAtUtc < at))).Index);

    /// <summary>The path's place for the progress screen.</summary>
    public static PracticePathDto Describe(PathStop stop, PathReading reading)
        => new(
            stop.Unit.Grade.Label,
            UnitTitle(stop),
            stop.Unit.UnitNumber,
            stop.Unit.UnitsInGrade,
            stop.Place.Slot + 1,
            stop.Unit.DrillCount,
            reading.UnitsComplete,
            reading.GradesComplete);

    /// <summary>Where the singer stands on each of a season path's drills, read off their facts (any pace's pass counts).</summary>
    public static IReadOnlyList<SeasonStanding> SeasonStandings(SeasonPath path, IEnumerable<PracticeFact> facts)
        => path.Read(facts.Where(f => f.Kind == PracticeKind.Drill).Select(f => (f.DrillId, f.Score)));

    /// <summary>A season's path as the Practice screen's card draws it, on the singer's track.</summary>
    public static PracticeSeasonDto DescribeSeason(SeasonPath path, IReadOnlyList<SeasonStanding> standings, PracticeTrack? track, DateOnly? until)
    {
        var steps = standings.Select(s => DescribeStep(s, path.For(s.Definition, track))).ToList();
        var next = SeasonPath.Next(standings);
        return new PracticeSeasonDto(
            path.Season,
            path.Title,
            until,
            standings.Count(s => s.Passed),
            path.Count,
            next is null ? null : steps[next.Index - 1],
            steps,
            path.BadgeCode);
    }

    /// <summary>One season drill as a row of its path.</summary>
    public static CarolStepDto DescribeStep(SeasonStanding standing, SeasonDrill carol)
    {
        var d = standing.Definition;
        return new CarolStepDto(d.Index, carol.Drill.Id, d.Title, d.Carol, d.HymnSlug, d.Cue, carol.Detail, standing.Passed, standing.BestScore);
    }

    /// <summary>The unit's title, marked as review past the path's end.</summary>
    public static string UnitTitle(PathStop stop) => stop.Review ? $"Review: {stop.Unit.Unit.Title}" : stop.Unit.Unit.Title;

    /// <summary>"Unit 3 of Grade 2 complete" with what it taught, or "Grade 2 complete" with what the singer can now do.</summary>
    public static PracticeMilestoneDto Describe(PathMilestone milestone)
    {
        var unit = milestone.Unit;
        var grade = unit.Grade;
        return milestone.Kind == MilestoneKind.Grade
            ? new PracticeMilestoneDto(
                "grade",
                $"{grade.Label} complete",
                $"You can now {(milestone.Track == PracticeTrack.Playful ? grade.PlayfulCanDo ?? grade.CanDo : grade.CanDo)}",
                grade.Label,
                unit.UnitNumber,
                unit.UnitsInGrade)
            : new PracticeMilestoneDto(
                "unit",
                $"Unit {unit.UnitNumber} of {grade.Label} complete",
                unit.Unit.Learned,
                grade.Label,
                unit.UnitNumber,
                unit.UnitsInGrade);
    }
}
