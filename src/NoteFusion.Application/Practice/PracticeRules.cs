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

    /// <summary>
    /// Drills a free account may have marked in one local day: a practice session on the path — a unit of
    /// <see cref="DrillsPerUnit"/> drills, a retry or two, and the start of the next unit. (It was 5 when practice was one
    /// drill of the day; 5 stopped a session halfway through its first unit.) The daily XP cap still bounds levelling.
    /// </summary>
    public const int FreeDrillGradesPerDay = 10;

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

    // ── Tracks ──────────────────────────────────────────────────────────────
    // A track (Core.Enums.PracticeTrack) chooses the path's drills and how a marked take is shown. Nothing above reads
    // it: XP, the cap, the ladder, streaks and badges are the same on both, so switching never loses progress.

    /// <summary>The most notes a Playful drill has (every drill has at least three).</summary>
    public const int PlayfulMaxNotes = 5;

    /// <summary>
    /// The highest grade (tier) Playful's path reaches: Grade 7's first chromatic steps, after low lah in the doh key.
    /// Playful never sings minor.
    /// </summary>
    public const int PlayfulTopTier = 6;

    /// <summary>The first grade (tier) whose chromatic notes Playful sings: none before it.</summary>
    public const int PlayfulChromaticTier = 6;

    /// <summary>Playful's units per grade: the first three, the gentlest (shorter, plainer rhythms).</summary>
    public const int PlayfulTopStep = 3;

    /// <summary>Beats a minute slower than the tier's own tempo for a Playful drill.</summary>
    public const int PlayfulTempoDrop = 12;

    /// <summary>Grades above the singer's level that Focused's path starts on, so a beginner who wants the work starts on scales.</summary>
    public const int FocusedTierLead = 2;

    // ── The path ────────────────────────────────────────────────────────────
    // Practice is an ordered path (PracticePath): grades → units → drills. Where a singer is on it is read off their
    // marked drills, in order, every time; nothing about it is stored or reported by a client.

    /// <summary>Drills to pass in each unit (no track and Focused).</summary>
    public const int DrillsPerUnit = 4;

    /// <summary>Drills to pass in each of Playful's units: shorter sessions.</summary>
    public const int PlayfulDrillsPerUnit = 3;

    /// <summary>A take marked this or more passes the drill and moves the singer on (the same as <see cref="GoodScore"/>).</summary>
    public const int PassScore = GoodScore;

    /// <summary>A pass this good counts towards skipping ahead.</summary>
    public const int SkipAheadScore = 90;

    /// <summary>Passes of <see cref="SkipAheadScore"/> or more in a row (the same day) that skip the next drill of the unit.</summary>
    public const int SkipAheadRun = 2;

    /// <summary>A take marked under this counts towards stepping back.</summary>
    public const int StepBackScore = 50;

    /// <summary>Takes under <see cref="StepBackScore"/> in a row (the same day) that step back to the unit's previous drill.</summary>
    public const int StepBackRun = 2;

    /// <summary>
    /// Takes under <see cref="PassScore"/> at one drill before an easier variant is offered: the first miss brings the
    /// same drill back once.
    /// </summary>
    public const int RetriesBeforeEasier = 1;

    /// <summary>Beats a minute each unit of a grade is quicker than the one before.</summary>
    public const int TempoPerStep = 2;

    /// <summary>
    /// The shortest note any drill has, at its tempo: the worker judges a note on the pitch sung while it was due, less
    /// its attack and release, and below this that is too few pitch frames to judge fairly (no semiquavers).
    /// </summary>
    public const double ShortestNoteSeconds = 0.3;

    /// <summary>XP for one marked take before the daily cap. A practice mode's take earns as a drill does.</summary>
    public static int BaseXp(PracticeKind kind, int score) => kind switch
    {
        PracticeKind.Part => PartXp + (score >= GoodScore ? PartGoodBonus : 0),
        _ when UsesDrillAllowance(kind) => DrillXp
            + (score >= GoodScore ? DrillGoodBonus : 0)
            + (score >= PerfectScore ? DrillPerfectBonus : 0),
        _ => 0
    };

    /// <summary>Drills marked a day for this account.</summary>
    public static int DrillGradesPerDay(bool isPro) => isPro ? ProDrillGradesPerDay : FreeDrillGradesPerDay;

    /// <summary>
    /// Whether a take of this kind spends one of the day's marked drills: a drill and every practice mode's take (a
    /// pitch-match set or a run is one take, so one); a part sung back (Pro) does not.
    /// </summary>
    public static bool UsesDrillAllowance(PracticeKind kind) => kind is PracticeKind.Drill
        or PracticeKind.PitchMatch or PracticeKind.Interval or PracticeKind.Harmony or PracticeKind.Run or PracticeKind.Rhythm;

    /// <summary>The kinds that spend the day's marked drills, for a database count (<see cref="UsesDrillAllowance"/>).</summary>
    public static readonly PracticeKind[] DrillAllowanceKinds =
        Enum.GetValues<PracticeKind>().Where(UsesDrillAllowance).ToArray();
}
