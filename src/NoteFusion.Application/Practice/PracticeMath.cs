using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice;

/// <summary>What the scoring needs of one <see cref="Core.Entities.PracticeSession"/> (the drill's id: the carols path's badge reads it).</summary>
public sealed record PracticeFact(PracticeKind Kind, int Score, bool WholePart, DateOnly LocalDate, DateTime CreatedAtUtc, string? DrillId = null);

/// <summary>The streak as of one day, with the days its freezes bridged.</summary>
public sealed record StreakState(int Current, int Best, bool TodayDone, bool FreezeAvailable, IReadOnlySet<DateOnly> Frozen);

/// <summary>A streak that ended: the first missed day no freeze bridged, and how many days it had run.</summary>
public sealed record StreakBreak(DateOnly Day, int Length);

/// <summary>
/// The counts badges are judged on. <c>WeekDays</c> is the days practised in today's Monday–Sunday week (to today);
/// <c>BestWeekDays</c> the most practised in any one such week; <c>CarolsSung</c> the carols path's drills passed and
/// <c>MidnightSung</c> the Midnight path's (Halloween).
/// </summary>
public sealed record PracticeStats(
    int Drills, int Parts, int Perfect, int WholePartsGood, int BestStreak, int WeekDays = 0, int BestWeekDays = 0, int CarolsSung = 0,
    int MidnightSung = 0);

/// <summary>
/// The rules of <see cref="PracticeRules"/> applied to an account's practice history. Pure: the rows go in, the
/// numbers come out, so every rule is unit-tested without a database.
/// </summary>
public static class PracticeMath
{
    /// <summary>XP earned on each local day: the day's takes summed and held to <see cref="PracticeRules.DailyXpCap"/>.</summary>
    public static Dictionary<DateOnly, int> XpByDay(IEnumerable<PracticeFact> facts)
        => facts
            .GroupBy(f => f.LocalDate)
            .ToDictionary(g => g.Key, g => Math.Min(PracticeRules.DailyXpCap, g.Sum(f => PracticeRules.BaseXp(f.Kind, f.Score))));

    public static int TotalXp(IEnumerable<PracticeFact> facts) => XpByDay(facts).Values.Sum();

    /// <summary>The rung <paramref name="xp"/> reaches, and what the next one asks.</summary>
    public static LevelDto LevelFor(int xp)
    {
        var levels = PracticeRules.Levels;
        var at = levels.Last(l => l.MinXp <= Math.Max(0, xp));
        var next = at.Index + 1 < levels.Count ? levels[at.Index + 1] : null;
        return new LevelDto(at.Index, at.Name, at.MinXp, next?.MinXp, next?.Name, next is null ? 0 : next.MinXp - xp);
    }

    /// <summary>
    /// Days practised in a row up to <paramref name="today"/>. Today not yet done does not break it (the day is not
    /// over). A missed day is bridged by the week's freeze — one per ISO week, used automatically on the first day
    /// missed that week while a streak is running — and a bridged day keeps the streak without adding to it.
    /// </summary>
    public static StreakState Streak(IEnumerable<DateOnly> practisedDays, DateOnly today)
        => Walk(practisedDays, today, breaks: null);

    /// <summary>
    /// Every streak that ended before <paramref name="today"/>, by the same rules as <see cref="Streak"/>: the day it
    /// ended is the first missed day the week's freeze did not bridge. For the admin console's streak analytics.
    /// </summary>
    public static IReadOnlyList<StreakBreak> StreakBreaks(IEnumerable<DateOnly> practisedDays, DateOnly today)
    {
        var breaks = new List<StreakBreak>();
        Walk(practisedDays, today, breaks);
        return breaks;
    }

    private static StreakState Walk(IEnumerable<DateOnly> practisedDays, DateOnly today, List<StreakBreak>? breaks)
    {
        var days = practisedDays.ToHashSet();
        var frozen = new HashSet<DateOnly>();
        var weeksFrozen = new HashSet<DateOnly>();
        int run = 0, best = 0;

        if (days.Count > 0)
        {
            var end = days.Max() > today ? days.Max() : today;
            for (var d = days.Min(); d <= end; d = d.AddDays(1))
            {
                if (days.Contains(d))
                {
                    run++;
                    best = Math.Max(best, run);
                }
                else if (d >= today)
                {
                    // Today, still open: neither kept nor lost yet.
                }
                else if (run > 0 && weeksFrozen.Add(PracticeTime.WeekStart(d)))
                {
                    frozen.Add(d);
                }
                else
                {
                    if (run > 0)
                        breaks?.Add(new StreakBreak(d, run));
                    run = 0;
                }
            }
        }

        return new StreakState(run, best, days.Contains(today), !weeksFrozen.Contains(PracticeTime.WeekStart(today)), frozen);
    }

    /// <summary>The counts badges read, with the best streak and today's week as of <paramref name="today"/>.</summary>
    public static PracticeStats Stats(IReadOnlyCollection<PracticeFact> facts, DateOnly today)
    {
        var days = facts.Select(f => f.LocalDate).Where(d => d <= today).Distinct().ToList();
        var weekStart = PracticeTime.WeekStart(today);
        return new(
            facts.Count(f => f.Kind == PracticeKind.Drill),
            facts.Count(f => f.Kind == PracticeKind.Part),
            facts.Count(f => f.Kind != PracticeKind.Game && f.Score >= PracticeRules.PerfectScore), // a sung take, not a game
            facts.Count(f => f.Kind == PracticeKind.Part && f.WholePart && f.Score >= PracticeRules.GoodScore),
            Streak(facts.Select(f => f.LocalDate), today).Best,
            days.Count(d => d >= weekStart),
            days.Count == 0 ? 0 : days.GroupBy(PracticeTime.WeekStart).Max(w => w.Count()),
            CarolPath.Path.Sung(Takes(facts)),
            HalloweenPath.Path.Sung(Takes(facts)));
    }

    private static IEnumerable<(string? DrillId, int Score)> Takes(IEnumerable<PracticeFact> facts)
        => facts.Where(f => f.Kind == PracticeKind.Drill).Select(f => (f.DrillId, f.Score));

    /// <summary>
    /// Everything the Practice screen shows, as of <paramref name="today"/>. The <paramref name="track"/> is passed
    /// through for the client to draw by; no number here reads it. <paramref name="season"/>: the season on for the
    /// singer ("christmas", "halloween"), whose badge is listed before it is earned.
    /// </summary>
    public static PracticeProgressDto Progress(
        IReadOnlyCollection<PracticeFact> facts,
        IReadOnlyDictionary<string, DateTime> earned,
        DateOnly today,
        DrillAllowanceDto drills,
        PracticeTrack? track = null,
        string? season = null)
    {
        var xpByDay = XpByDay(facts);
        var xp = xpByDay.Values.Sum();
        var streak = Streak(facts.Select(f => f.LocalDate), today);
        var stats = Stats(facts, today);
        var first = facts.Count == 0 ? (DateOnly?)null : facts.Min(f => f.LocalDate);

        var weekStart = PracticeTime.WeekStart(today);
        var weekDays = xpByDay.Keys.Count(d => d >= weekStart && d <= today);

        var lastSeven = Enumerable.Range(0, 7)
            .Select(i => today.AddDays(i - 6))
            .Select(d => new PracticeDayDto(
                d,
                xpByDay.ContainsKey(d) ? "done"
                    : d == today ? "today"
                    : streak.Frozen.Contains(d) ? "frozen"
                    : first is null || d < first ? "none"
                    : "missed",
                xpByDay.GetValueOrDefault(d)))
            .ToList();

        return new PracticeProgressDto(
            today,
            xp,
            xpByDay.GetValueOrDefault(today),
            PracticeRules.DailyXpCap,
            LevelFor(xp),
            new StreakDto(
                streak.Current,
                streak.Best,
                streak.TodayDone,
                AtRisk: streak.Current > 0 && !streak.TodayDone,
                streak.FreezeAvailable,
                FrozenYesterday: streak.Frozen.Contains(today.AddDays(-1))),
            new WeeklyGoalDto(weekDays, PracticeRules.WeeklyGoalDays, weekStart),
            PracticeBadges.Describe(stats, earned, season),
            lastSeven,
            drills,
            track);
    }
}
