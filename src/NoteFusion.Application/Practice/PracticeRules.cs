using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice;

/// <summary>A rung of the ladder: its name and the XP it starts at.</summary>
public sealed record PracticeLevel(int Index, string Name, int MinXp);

/// <summary>
/// Every number practice is scored by, in one place: XP per take, the daily cap, the level ladder, the weekly goal,
/// the streak freeze and the drill allowances. <see cref="PracticeMath"/> applies them; the tests pin them.
/// </summary>
/// <remarks>
/// Gamified practice, not transcription: nothing here is earned by transcribing, bought, or boosted. XP rewards a
/// take being marked at all (turning up is the habit), then singing it well.
/// </remarks>
public static class PracticeRules
{
    /// <summary>A drill marked, whatever the score.</summary>
    public const int DrillXp = 10;

    /// <summary>On top of <see cref="DrillXp"/> for a drill marked <see cref="GoodScore"/> or better.</summary>
    public const int DrillGoodBonus = 5;

    /// <summary>On top of both for a drill marked 100.</summary>
    public const int DrillPerfectBonus = 5;

    /// <summary>A part of a sheet sung back and marked, whatever the score.</summary>
    public const int PartXp = 15;

    /// <summary>On top of <see cref="PartXp"/> for a part marked <see cref="GoodScore"/> or better.</summary>
    public const int PartGoodBonus = 10;

    public const int GoodScore = 80;
    public const int PerfectScore = 100;

    /// <summary>The most XP one local day can earn, so singing the same three notes all night levels nobody up.</summary>
    public const int DailyXpCap = 150;

    /// <summary>Practice days a week the goal ring asks for (Monday to Sunday).</summary>
    public const int WeeklyGoalDays = 5;

    /// <summary>Drills a free account may have marked in one local day.</summary>
    public const int FreeDrillGradesPerDay = 5;

    /// <summary>Drills a Pro account may have marked in one local day.</summary>
    public const int ProDrillGradesPerDay = 20;

    /// <summary>Seconds of a drill take kept after its last note; the worker cuts the rest.</summary>
    public const double DrillTakeTailSeconds = 4;

    /// <summary>The ladder, Doh to Choir-ready. Names are the sol-fa degrees a singer climbs.</summary>
    public static readonly IReadOnlyList<PracticeLevel> Levels =
    [
        new(0, "Doh", 0),
        new(1, "Ray", 100),
        new(2, "Me", 250),
        new(3, "Fah", 500),
        new(4, "Soh", 900),
        new(5, "Lah", 1400),
        new(6, "Te", 2000),
        new(7, "Choir-ready", 3000),
    ];

    /// <summary>XP for one marked take before the daily cap.</summary>
    public static int BaseXp(PracticeKind kind, int score) => kind switch
    {
        PracticeKind.Drill => DrillXp
            + (score >= GoodScore ? DrillGoodBonus : 0)
            + (score >= PerfectScore ? DrillPerfectBonus : 0),
        PracticeKind.Part => PartXp + (score >= GoodScore ? PartGoodBonus : 0),
        _ => 0
    };

    /// <summary>Drills marked a day for this account.</summary>
    public static int DrillGradesPerDay(bool isPro) => isPro ? ProDrillGradesPerDay : FreeDrillGradesPerDay;
}
