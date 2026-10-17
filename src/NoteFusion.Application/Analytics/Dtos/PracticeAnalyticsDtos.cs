using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Analytics.Dtos;

/*
 * The console's Practice page (GET /api/admin/analytics/practice). Every figure is read off the rows practice
 * writes: PracticeSession (a marked take, on the singer's own calendar day), Achievement (a badge),
 * PracticeReminder (a reminder push and how its send went), users' practice settings and DeviceToken. Customers
 * only (AnalyticsScope). Mirrored in web-admin/src/api/types.ts.
 *
 * Days: a take and a reminder carry the singer's own calendar day (LocalDate, the day their streak and their daily
 * drill allowance count), and the window selects those days; badges have no such day and use the reporting day.
 */

/// <param name="Practisers">Singers with at least one marked take (drill or part) on a day in the window.</param>
/// <param name="PractisersPrevious">The same over the equally long window before.</param>
/// <param name="NewPractisers">Of <paramref name="Practisers"/>, those whose first marked take ever was in the window.</param>
/// <param name="Dau">Practisers on the window's last day.</param>
/// <param name="Wau">Practisers on any of the window's last seven days (reaching before the window if it is shorter).</param>
/// <param name="Mau">Practisers on any of the window's last thirty days.</param>
/// <param name="AverageDau">Practisers per day, averaged over every day of the window.</param>
/// <param name="TakesPerPractiserDay">Marked takes per day a singer practised; null when nobody did.</param>
/// <param name="AverageScore">The mean mark (0–100) of the window's takes; null when there were none.</param>
/// <param name="XpEarned">XP the window's takes earned, each singer's day held to the daily cap, as the app counts it.</param>
/// <param name="PractisersByTrack">The window's practisers by the track they have chosen now: Playful, Focused or None.</param>
public sealed record PracticeHeadlineDto(
    int Practisers,
    int PractisersPrevious,
    int NewPractisers,
    int Dau,
    int Wau,
    int Mau,
    double AverageDau,
    int Takes,
    int TakesPrevious,
    int Drills,
    int Parts,
    int PractiserDays,
    double? TakesPerPractiserDay,
    double? AverageScore,
    int XpEarned,
    IReadOnlyList<CategoryCountDto> PractisersByTrack);

/// <summary>One day of the window. Practice and milestones on the singer's day; badges on the reporting day.</summary>
/// <param name="StreaksBroken">Streaks of two days or more that ended this day (the first missed day no freeze bridged).</param>
/// <param name="FreezesUsed">Missed days the week's freeze bridged, keeping a streak alive.</param>
public sealed record PracticeDailyDto(
    DateOnly Date,
    int Practisers,
    int Drills,
    int Parts,
    int Xp,
    int UnitsCompleted,
    int GradesCompleted,
    int BadgesEarned,
    int StreaksBroken,
    int FreezesUsed);

/// <summary>
/// One week's new singers (first marked take ever in that Monday–Sunday week, on their own calendar) and the share
/// who practised again exactly 1, 7 and 30 days after their first day. A rate is null until at least one of them has
/// had that day end; <c>Eligible*</c> say how many it is over.
/// </summary>
public sealed record PracticeCohortDto(
    DateOnly WeekStart,
    int Singers,
    double? D1,
    double? D7,
    double? D30,
    int EligibleD1,
    int EligibleD7,
    int EligibleD30);

/// <summary>
/// One Monday–Sunday week (reporting days): accounts active in it, split by whether they had a take marked that week,
/// and how many of each were active again the week after.
/// </summary>
public sealed record WeeklyReturnDto(DateOnly WeekStart, int PractisersActive, int PractisersBack, int OthersActive, int OthersBack);

/// <param name="PractiserRate">Of account-weeks with practice, the share active the following week; null when none.</param>
/// <param name="OtherRate">The same for account-weeks active without practice.</param>
public sealed record PracticeRetentionDto(
    IReadOnlyList<PracticeCohortDto> Cohorts,
    IReadOnlyList<WeeklyReturnDto> Weeks,
    int PractiserWeeks,
    int PractiserWeeksBack,
    double? PractiserRate,
    int OtherWeeks,
    int OtherWeeksBack,
    double? OtherRate);

/// <summary>A singer with a long streak: a link to the account, as the console's other leaderboards show it.</summary>
public sealed record StreakLeaderDto(Guid UserId, string FullName, string Email, int Current, int Best, DateOnly LastPractised);

/// <param name="AsOf">The day the current streaks are read at: the end of the window's last day.</param>
/// <param name="Current">The window's practisers by their current streak: 0, 1, 2–3, 4–7, 8–29, 30+.</param>
public sealed record PracticeStreaksDto(
    DateOnly AsOf,
    IReadOnlyList<CategoryCountDto> Current,
    int FreezesUsed,
    int StreaksBroken,
    IReadOnlyList<StreakLeaderDto> Longest);

/// <summary>
/// One unit on a track's path. <c>Reached</c>/<c>Completed</c> are singers (of the track's singers in the window) whose
/// path got there by the window's end; the rest are the window's takes sung at this unit.
/// </summary>
/// <param name="RetryRate">Takes sung at a drill already missed (the drill again, or an easier variant).</param>
/// <param name="StepBackRate">Takes that stepped back a drill (the second under 50 in a row that day).</param>
public sealed record PathUnitStatDto(
    string Code,
    int UnitNumber,
    string Title,
    int Reached,
    int Completed,
    int Takes,
    double? PassRate,
    double? RetryRate,
    double? StepBackRate,
    double? AverageScore);

public sealed record PathGradeStatDto(
    int Tier,
    string Label,
    int Reached,
    int Completed,
    int Takes,
    double? AverageScore,
    IReadOnlyList<PathUnitStatDto> Units);

/// <param name="Track">"none", "playful" or "focused": the path the takes moved.</param>
/// <param name="Singers">Singers with a take that moved this track's path in the window.</param>
public sealed record PathTrackStatDto(string Track, int Singers, int Takes, IReadOnlyList<PathGradeStatDto> Grades);

/// <param name="FreeLimit">Drills a free account may have marked a day.</param>
/// <param name="ProLimit">The same for Pro.</param>
/// <param name="DrillSingers">The window's singers who sang at least one drill: the share's denominator.</param>
/// <param name="HitLimit">Of them, singers who reached their day's limit at least once.</param>
/// <param name="LimitDays">Singer-days that reached the limit.</param>
/// <param name="FreeHitters">Singers who reached the free limit while not on Pro.</param>
/// <param name="FreeHittersDecided">Of those, the ones whose seven days after their first hit are over, or who bought already.</param>
/// <param name="Bought">Free hitters who bought something within seven days after their first hit.</param>
public sealed record PracticeAllowanceDto(
    int FreeLimit,
    int ProLimit,
    int DrillSingers,
    int HitLimit,
    int HitFreeLimit,
    int HitProLimit,
    int LimitDays,
    int FreeHitters,
    int FreeHittersDecided,
    int Bought,
    int BoughtMembership,
    int BoughtSingle,
    double? ConversionRate);

/// <summary>One reminder kind over the window: sends, failures and what the singer did after a sent one.</summary>
/// <param name="PractisedWithin2h">Sent reminders followed by a marked take within two hours of the send.</param>
/// <param name="PractisedSameDay">Sent reminders followed by a marked take later the same local day.</param>
public sealed record ReminderKindStatDto(
    PracticeReminderKind Kind,
    int Sent,
    int Failed,
    int PractisedWithin2h,
    int PractisedSameDay,
    double? Within2hRate,
    double? SameDayRate);

/// <summary>Reminders sent on one of the singers' days, by kind, and the sends that failed.</summary>
public sealed record ReminderDayDto(
    DateOnly Date,
    int Ordinary,
    int StreakAtRisk,
    int FreezeReady,
    int LastChance,
    int StreakLost,
    int LearningWaiting,
    int Final,
    int Failed);

/// <param name="RemindersOff">Accounts whose reminder switch is off now (a snapshot: the switch keeps no history).</param>
/// <param name="RemindersApplicable">Accounts reminders apply to: practised, chose a track, or set the switch.</param>
/// <param name="FinalSent">"We'll stop reminding you" reminders sent in the window.</param>
/// <param name="FinalCameBack">Of their singers, those who have had a take marked since.</param>
/// <param name="Phones">Registered phones (Android and iOS) of customers, now.</param>
/// <param name="PhonesOnServerReminders">Of them, phones whose app code takes its reminders from the server (the OTA update).</param>
public sealed record PracticeRemindersAnalyticsDto(
    int Sent,
    int Failed,
    int Pending,
    int AccountsReminded,
    int PractisedWithin2h,
    int PractisedSameDay,
    IReadOnlyList<ReminderKindStatDto> Kinds,
    IReadOnlyList<ReminderDayDto> Daily,
    int RemindersOff,
    int RemindersApplicable,
    int FinalSent,
    int FinalCameBack,
    int Phones,
    int PhonesOnServerReminders);

/// <summary>A badge: how many earned it in the window and ever.</summary>
public sealed record PracticeBadgeStatDto(string Code, string Title, int EarnedInWindow, int EarnedAllTime);

public sealed record PracticeAnalyticsDto(
    DateTime FromUtc,
    DateTime ToUtc,
    int ReportingOffsetMinutes,
    DateOnly FirstDay,
    DateOnly LastDay,
    PracticeHeadlineDto Headline,
    IReadOnlyList<PracticeDailyDto> Daily,
    PracticeRetentionDto Retention,
    PracticeStreaksDto Streaks,
    IReadOnlyList<PathTrackStatDto> Path,
    PracticeAllowanceDto Allowance,
    PracticeRemindersAnalyticsDto Reminders,
    IReadOnlyList<PracticeBadgeStatDto> Badges);
