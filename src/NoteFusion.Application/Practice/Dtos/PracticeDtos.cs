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
/// <c>Modes</c> are the practice modes live for that track, in the order the hub lists them ("warm-up", "pitch-match",
/// "scales", "runs", "intervals", "harmony", "rhythm"; Playful's five), each switchable on the server (<c>PracticeModes__*</c>):
/// a client shows only these. <c>Drills</c> counts every marked take but parts: a mode's take spends one too.
/// <c>Season</c> is the seasonal side-path (the Christmas carols) while its season is on for the singer, else null.
/// <c>Quests</c> are the day's three quests and its chest (<see cref="DailyQuests"/>).
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
    PracticePathDto? Path = null,
    IReadOnlyList<string>? Modes = null,
    PracticeSeasonDto? Season = null,
    DailyQuestsDto? Quests = null);

/// <summary>
/// The day's three quests (the same for everyone that day), how far today's marked takes have got with each, and the
/// chest: <c>ChestOpened</c> once all three are done, worth <c>ChestXp</c> on top of the day's cap. Mirrored by
/// <c>DailyQuests</c> in <c>mobile/src/api/types.ts</c>.
/// </summary>
public sealed record DailyQuestsDto(IReadOnlyList<DailyQuestDto> Quests, bool ChestOpened, int ChestXp);

/// <summary>One quest: its code ("drills-2"), what it asks, how far today's takes got, its target and whether it is done.</summary>
public sealed record DailyQuestDto(string Code, string Title, int Progress, int Target, bool Done);

/// <summary>
/// The seasonal practice side-path, on the progress while its season is on (the Practice screen's pine card): which
/// season ("christmas"), its title, the last day it runs (<c>Until</c>, null when it runs until switched off), the
/// drills passed of the total, the next to sing (null once all are), every step in order, and the badge all of them
/// earn (<c>BadgeCode</c>, listed among the badges while the season is on). Mirrored by <c>PracticeSeason</c> in
/// <c>mobile/src/api/types.ts</c>.
/// </summary>
public sealed record PracticeSeasonDto(
    string Season,
    string Title,
    DateOnly? Until,
    int Sung,
    int Total,
    CarolStepDto? Next,
    IReadOnlyList<CarolStepDto> Steps,
    string BadgeCode);

/// <summary>
/// One drill of the carols path as a row: its place (1-based), the id to grade a take of it with (the singer's track's
/// pace), its title ("Sing in thirds"), the carol and its hymn page's slug, <c>Cue</c> for "Next: Silent Night, in
/// thirds", <c>Detail</c> for the line under it ("Doh is Bb · 4 notes", the solfa sung, "one breath"), whether it is
/// passed and its best mark so far.
/// </summary>
public sealed record CarolStepDto(
    int Index,
    string Id,
    string Title,
    string Carol,
    string HymnSlug,
    string Cue,
    string Detail,
    bool Passed,
    int? BestScore);

/// <summary>
/// GET /api/practice/carols, while the season is on (404 <c>PRACTICE_SEASON_OFF</c> otherwise): the carols path with each
/// drill ready to hear and sing, on the singer's track (Playful's shorter and slower). Takes go to
/// <c>POST /api/practice/drills/grade</c> with the drill's id, like any drill.
/// </summary>
public sealed record CarolsPathDto(PracticeSeasonDto Season, IReadOnlyList<CarolDrillDto> Drills);

/// <summary>
/// One carol drill in full: its row (<c>Step</c>), the drill itself (<c>Drill</c>: notes labelled by the solfa engine,
/// key, tempo, the carol's own <c>TimeSignature</c>) with <c>PickupBeats</c> before its first bar line, and for some:
/// <c>Backing</c>, the tune the app's piano plays while the singer sings the part under it (quietly, at "others" volume;
/// only the sung part is marked), and <c>Syllables</c> (a syllable a note, "" where a note carries on the one before) with
/// <c>Words</c>, the verse's lines, for the sing-along.
/// </summary>
public sealed record CarolDrillDto(
    CarolStepDto Step,
    DrillDto Drill,
    double PickupBeats,
    IReadOnlyList<NoteEventDto>? Backing,
    IReadOnlyList<string>? Syllables,
    IReadOnlyList<string>? Words);

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
