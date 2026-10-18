using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Dtos;

/// <summary>
/// Where an account stands on the ladder. <c>XpForNext</c> is the XP still to earn before <c>NextName</c>
/// (0 at the top, where <c>NextLevelXp</c> and <c>NextName</c> are null).
/// </summary>
public sealed record LevelDto(int Index, string Name, int MinXp, int? NextLevelXp, string? NextName, int XpForNext);

/// <summary>
/// Days practised in a row on the singer's calendar. <c>AtRisk</c>: a streak is running and today is not done yet.
/// <c>FreezeAvailable</c>: this ISO week's one automatic freeze is unused. <c>FrozenYesterday</c>: yesterday was
/// missed and the freeze bridged it.
/// </summary>
public sealed record StreakDto(int Current, int Best, bool TodayDone, bool AtRisk, bool FreezeAvailable, bool FrozenYesterday);

/// <summary>Practice days so far this week (Monday to Sunday) against the goal.</summary>
public sealed record WeeklyGoalDto(int DaysDone, int Target, DateOnly WeekStart);

/// <summary>A badge, earned or not: locked ones carry how far along the account is (<c>Progress</c> of <c>Target</c>).</summary>
public sealed record BadgeDto(
    string Code,
    string Title,
    string Description,
    bool Earned,
    DateTime? EarnedAtUtc,
    int Progress,
    int Target);

/// <summary>
/// One day of the last seven. <c>Status</c>: "done" (practised), "frozen" (missed, bridged by the freeze),
/// "missed", "today" (not done yet) or "none" (before the first practice).
/// </summary>
public sealed record PracticeDayDto(DateOnly Date, string Status, int Xp);

/// <summary>
/// Drills marked today and the most this account may have marked in a day. <c>ResetsAtUtc</c>: when the allowance
/// starts again — the singer's next local midnight (null from older code paths).
/// </summary>
public sealed record DrillAllowanceDto(int Used, int Limit, DateTime? ResetsAtUtc = null);

/// <summary>
/// Where the singer is on their track's practice path: the grade ("Grade 2", "Advanced 1"), the unit's title, the
/// unit's number among the grade's (1-based <c>UnitIndex</c> of <c>UnitCount</c>) and the drill's within the unit
/// (1-based <c>DrillIndex</c> of <c>DrillCount</c>), and how many units and grades are finished.
/// </summary>
public sealed record PracticePathDto(
    string Grade,
    string Unit,
    int UnitIndex,
    int UnitCount,
    int DrillIndex,
    int DrillCount,
    int UnitsComplete,
    int GradesComplete);

/// <summary>
/// A milestone a marked drill just reached, on the grade response: <c>Kind</c> "unit" ("Unit 3 of Grade 2 complete")
/// or "grade" ("Grade 2 complete"), a one-line <c>Description</c> of what was learned, the grade, and the unit's
/// number (1-based) among the grade's.
/// </summary>
public sealed record PracticeMilestoneDto(
    string Kind,
    string Title,
    string Description,
    string Grade,
    int UnitIndex,
    int UnitCount);

/// <summary>
/// GET /api/practice/progress (and PUT /api/practice/track's answer): everything the Practice screen draws, read off the
/// account's graded practice. <c>Track</c> is how the singer likes to practise ("playful" / "focused"), null until they
/// pick one — the clients ask then. It changes the drills offered and how takes are shown, never the numbers here.
/// </summary>
public sealed record PracticeProgressDto(
    DateOnly Today,
    int Xp,
    int XpToday,
    int DailyXpCap,
    LevelDto Level,
    StreakDto Streak,
    WeeklyGoalDto WeeklyGoal,
    IReadOnlyList<BadgeDto> Badges,
    IReadOnlyList<PracticeDayDto> LastSevenDays,
    DrillAllowanceDto Drills,
    PracticeTrack? Track,
    PracticePathDto? Path = null);

/// <summary>
/// What a marked take earned, returned with its grade so the client can celebrate without a second read:
/// the XP added (after the daily cap), the new total, whether it crossed into a new level, the streak, and any
/// badges it unlocked.
/// </summary>
public sealed record PracticeRewardDto(
    int XpGained,
    int Xp,
    bool LevelUp,
    LevelDto Level,
    int Streak,
    IReadOnlyList<BadgeDto> NewBadges);

/// <summary>
/// GET /api/practice/drills/next (and its old name, /drills/today): the next drill on the singer's practice path — a
/// short solfa pattern to hear and sing, the same until a take of it is marked. The notes are labelled by the solfa
/// engine and timed by the pattern's rhythm; the take is a count-in and then the singer, cut by the worker at
/// <c>MaxTakeSeconds</c>. Current apps count in for at most five seconds (<c>leadInPlan</c>) and send its seconds with
/// the take; <c>LeadInBeats</c> is the older apps' count-in (a bar of the first note, a bar of clicks), kept for them
/// and assumed for a take that sends none, and <c>MaxTakeSeconds</c> leaves room for it. <c>Track</c> is the track it was
/// picked for (null when none is chosen yet): each track has its own path. Where it sits on the path: <c>Grade</c>,
/// <c>Unit</c>, <c>UnitIndex</c>/<c>UnitCount</c> and <c>DrillIndex</c>/<c>DrillCount</c> (1-based), <c>Difficulty</c>
/// (the pattern's unit in its own grade, 1–5) and <c>Adjustment</c> ("harder" after a skip ahead, "easier" for an
/// easier variant or a step back, else "steady").
/// </summary>
public sealed record DrillDto(
    string Id,
    string Title,
    int Level,
    string LevelName,
    string Key,
    string DohHeader,
    int TempoBpm,
    string TimeSignature,
    int LeadInBeats,
    double MaxTakeSeconds,
    IReadOnlyList<NoteEventDto> Notes,
    DateOnly Date,
    DrillAllowanceDto Allowance,
    PracticeTrack? Track,
    string Grade,
    string Unit,
    int UnitIndex,
    int UnitCount,
    int DrillIndex,
    int DrillCount,
    int Difficulty,
    DrillAdjustment Adjustment);

/// <summary>
/// GET/PUT /api/practice/reminders: the account's practice reminders, sent to its phones. <c>Enabled</c> is the
/// switch as it stands (on by default once the singer has practised or chosen a track); <c>Hour</c> the local hour of
/// the day's reminder (8–21, 19 by default); <c>Sound</c> the phone app's notification sound switch, synced (off sends
/// them silently).
/// </summary>
public sealed record PracticeRemindersDto(bool Enabled, int Hour, bool Sound);
