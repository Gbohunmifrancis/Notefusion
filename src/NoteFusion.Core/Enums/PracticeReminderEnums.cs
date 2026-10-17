namespace NoteFusion.Core.Enums;

/// <summary>
/// Which of a local day's (at most two) practice reminders a <see cref="Entities.PracticeReminder"/> is. Stored by
/// name; (user, local date, slot) is unique, which is what holds a day to two.
/// </summary>
public enum PracticeReminderSlot
{
    /// <summary>At the singer's hour (19:00 unless they chose another).</summary>
    Daily = 0,

    /// <summary>21:30, for a streak of three or more that today would end, and only after the daily one.</summary>
    LastChance = 1
}

/// <summary>What a practice reminder says: the situation its copy is written for. Stored by name.</summary>
public enum PracticeReminderKind
{
    /// <summary>A streak of one day running: today would make it two.</summary>
    Ordinary = 0,

    /// <summary>A streak of two or more that ends at midnight unless today is practised.</summary>
    StreakAtRisk = 1,

    /// <summary>A streak of two or more that this week's freeze would carry over today, if skipped.</summary>
    FreezeReady = 2,

    /// <summary>The late-evening second reminder for a streak of three or more with no freeze to save it.</summary>
    LastChance = 3,

    /// <summary>The first day after a streak of two or more ended.</summary>
    StreakLost = 4,

    /// <summary>A lapsed (or never started) singer, on the decaying schedule's days.</summary>
    LearningWaiting = 5,

    /// <summary>The last reminder of a lapse: "we'll stop reminding you". Nothing follows until they practise.</summary>
    Final = 6
}

/// <summary>Where a practice reminder's send got to. Stored by name.</summary>
public enum PracticeReminderStatus
{
    /// <summary>Claimed; the push has not been handed to Expo yet (or the run stopped mid-send).</summary>
    Pending = 0,

    /// <summary>Expo accepted it for at least one of the account's phones.</summary>
    Sent = 1,

    /// <summary>Expo refused or did not answer; retried once while the day's reminder still makes sense.</summary>
    Failed = 2
}
