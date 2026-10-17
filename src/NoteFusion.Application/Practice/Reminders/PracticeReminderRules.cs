using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Reminders;

/// <summary>What the reminder schedule needs of one account, on its own calendar.</summary>
/// <param name="PractisedDays">The local days with a marked practice take (<see cref="Core.Entities.PracticeSession.LocalDate"/>).</param>
/// <param name="Since">The local day reminders were last switched on or a track first chosen, if ever.</param>
/// <param name="Joined">The local day the account was made: the schedule's start for someone who never practised and never set reminders.</param>
/// <param name="Hour">The hour the singer chose, or null for the default.</param>
public sealed record ReminderAccount(IReadOnlyCollection<DateOnly> PractisedDays, DateOnly? Since, DateOnly Joined, int? Hour);

/// <summary>A reminder that is due now: which of the day's two, what it is about, and the streak its words name.</summary>
public sealed record DueReminder(PracticeReminderSlot Slot, PracticeReminderKind Kind, int Streak);

/// <summary>
/// The practice reminder schedule, Duolingo-style, as pure rules on the singer's own calendar (the time zone on their
/// account): the worker supplies the facts and the local time, these say whether a reminder is due and which.
/// </summary>
/// <remarks>
/// <para>
/// <b>While a streak is alive</b> (<see cref="PracticeMath.Streak"/>: practised yesterday, or a missed day bridged by
/// the week's freeze): one reminder at the singer's hour on a day not yet practised — about the streak ending at
/// midnight, or, when this week's freeze would carry today over, saying so ("your freeze is ready, but…"). For a
/// streak of three or more that today would end, a second, "last chance", at 21:30, at least
/// <see cref="LastChanceGap"/> after the first. With the freeze ready there is no last chance: nothing ends tonight.
/// </para>
/// <para>
/// <b>Once a streak is lost</b> (or before one ever started): one reminder at the hour on the first day after a streak
/// of two or more ended ("your streak slipped"), then on the days <see cref="DecayDays"/> after the last practice
/// (or after reminders were switched on, if later), then <see cref="FinalAfterDays"/> after it one last "we'll stop
/// reminding you", and nothing more until they practise. A marked take resets all of it: the days are counted
/// from it, and a new streak starts.
/// </para>
/// <para>
/// Never more than <see cref="MaxPerDay"/> a local day, never in the quiet hours (22:00–08:00), never on a day
/// already practised. Days and hours are the zone's, so a half-hour zone (Asia/Kolkata) and daylight saving are
/// handled by <see cref="TimeZoneInfo"/>, not by sums here.
/// </para>
/// </remarks>
public static class PracticeReminderRules
{
    public const int DefaultHour = 19;

    /// <summary>The earliest and latest hours a singer may choose: the reminder must fall outside the quiet hours.</summary>
    public const int EarliestHour = 8;
    public const int LatestHour = 21;

    /// <summary>Quiet from 22:00 to 08:00 local: nothing is sent, and a push not delivered by 22:00 expires.</summary>
    public static readonly TimeOnly QuietFrom = new(22, 0);
    public static readonly TimeOnly QuietUntil = new(8, 0);

    /// <summary>The second reminder of a day a streak of three or more would end, if still unpractised.</summary>
    public static readonly TimeOnly LastChanceAt = new(21, 30);

    public const int LastChanceMinStreak = 3;

    /// <summary>The least time between the day's two reminders; a late first one means no second.</summary>
    public static readonly TimeSpan LastChanceGap = TimeSpan.FromMinutes(90);

    public const int MaxPerDay = 2;

    /// <summary>The days after the last practice a lapsed singer is reminded on.</summary>
    public static readonly IReadOnlyList<int> DecayDays = [1, 2, 3, 5, 7, 14, 30];

    /// <summary>The day after the last practice the final "we'll stop reminding you" goes, and the last.</summary>
    public const int FinalAfterDays = 45;

    /// <summary>A streak this long or longer that has just ended gets "your streak slipped"; a one-day run does not.</summary>
    public const int StreakLostMinStreak = 2;

    /// <summary>A failed send is retried once, and only while it is this fresh (and still the same, unpractised day).</summary>
    public static readonly TimeSpan RetryWithin = TimeSpan.FromHours(2);

    /// <summary>The hour the singer chose, held to <see cref="EarliestHour"/>–<see cref="LatestHour"/>; 19 when none.</summary>
    public static int HourOf(int? hour) => Math.Clamp(hour ?? DefaultHour, EarliestHour, LatestHour);

    public static bool IsValidHour(int hour) => hour is >= EarliestHour and <= LatestHour;

    public static bool IsQuiet(TimeOnly time) => time >= QuietFrom || time < QuietUntil;

    /// <summary>
    /// Whether reminders are on: as the singer set them, or — never touched — once they have practised or chosen
    /// a track. Someone who has done neither has not asked for practice, so is not nagged about it.
    /// </summary>
    public static bool IsOn(bool? setting, bool hasPractised, bool hasTrack) => setting ?? (hasPractised || hasTrack);

    /// <summary>
    /// The reminder due at <paramref name="localNow"/> (the singer's wall clock), or null.
    /// <paramref name="claimedToday"/> is what has already gone out on that local day, slot to the local time it was
    /// claimed; a slot claimed is never due again, sent or not.
    /// </summary>
    public static DueReminder? Due(
        ReminderAccount account, DateTime localNow, IReadOnlyDictionary<PracticeReminderSlot, DateTime> claimedToday)
    {
        var today = DateOnly.FromDateTime(localNow);
        var time = TimeOnly.FromDateTime(localNow);
        if (IsQuiet(time) || claimedToday.Count >= MaxPerDay)
            return null;

        var days = account.PractisedDays as IReadOnlySet<DateOnly> ?? account.PractisedDays.ToHashSet();
        if (days.Contains(today))
            return null;

        var hourAt = new TimeOnly(HourOf(account.Hour), 0);
        var dailyClaimed = claimedToday.TryGetValue(PracticeReminderSlot.Daily, out var dailyAt);
        var lastChanceClaimed = claimedToday.ContainsKey(PracticeReminderSlot.LastChance);

        var streak = PracticeMath.Streak(days, today);
        if (streak.Current > 0)
        {
            // FreezeAvailable: this ISO week's freeze is unused, so a miss today would be bridged, not end the run.
            var freezeCoversToday = streak.FreezeAvailable;

            if (streak.Current >= LastChanceMinStreak && !freezeCoversToday && !lastChanceClaimed && time >= LastChanceAt
                && (!dailyClaimed || localNow - dailyAt >= LastChanceGap))
                return new DueReminder(PracticeReminderSlot.LastChance, PracticeReminderKind.LastChance, streak.Current);

            if (dailyClaimed || lastChanceClaimed || time < hourAt)
                return null;

            var kind = streak.Current < 2 ? PracticeReminderKind.Ordinary
                : freezeCoversToday ? PracticeReminderKind.FreezeReady
                : PracticeReminderKind.StreakAtRisk;
            return new DueReminder(PracticeReminderSlot.Daily, kind, streak.Current);
        }

        if (dailyClaimed || time < hourAt)
            return null;

        DateOnly? last = days.Count == 0 ? null : days.Max();
        if (last is not null)
        {
            // Alive as of yesterday (yesterday still open then), over as of today: it ended at midnight.
            var lost = PracticeMath.Streak(days, today.AddDays(-1)).Current;
            if (lost >= StreakLostMinStreak)
                return new DueReminder(PracticeReminderSlot.Daily, PracticeReminderKind.StreakLost, lost);
        }

        var from = Later(last, account.Since) ?? account.Joined;
        var gap = today.DayNumber - from.DayNumber;
        if (gap == FinalAfterDays)
            return new DueReminder(PracticeReminderSlot.Daily, PracticeReminderKind.Final, 0);
        return DecayDays.Contains(gap)
            ? new DueReminder(PracticeReminderSlot.Daily, PracticeReminderKind.LearningWaiting, 0)
            : null;
    }

    /// <summary>
    /// How long Expo may hold the push for a phone that is offline: until the quiet hours start, so a reminder never
    /// arrives in them (at least a minute).
    /// </summary>
    public static int TimeToLiveSeconds(DateTime localNow)
    {
        var quiet = DateOnly.FromDateTime(localNow).ToDateTime(QuietFrom);
        return Math.Max(60, (int)(quiet - localNow).TotalSeconds);
    }

    private static DateOnly? Later(DateOnly? a, DateOnly? b)
        => a is null ? b : b is null ? a : a > b ? a : b;
}
