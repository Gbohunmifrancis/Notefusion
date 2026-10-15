namespace NoteFusion.Application.Outreach;

/// <summary>
/// The timing rules of the founder's outreach, in one place so the sweep, the abandoned-checkout reminder
/// and the tests read the same numbers.
/// </summary>
/// <remarks>
/// Sending hours are West Africa Time for everyone (UTC+1 all year, no daylight saving). Most accounts are
/// Nigerian, a stored country does not name a time zone for the big multi-zone countries, and a note from a
/// person that lands at 3 a.m. reads like a robot sent it; WAT office hours are the simple, honest choice.
/// </remarks>
public static class OutreachRules
{
    /// <summary>At most one outreach message (any segment) per account in this long.</summary>
    public static readonly TimeSpan Spacing = TimeSpan.FromDays(7);

    /// <summary>"What stopped you?" waits this long after the newest checkout the account opened.</summary>
    public static readonly TimeSpan CheckoutAge = TimeSpan.FromDays(3);

    /// <summary>
    /// And this long after the abandoned-checkout reminder (<c>RemindAbandonedCheckoutsCommand</c>), so the
    /// two never land on the same day. That reminder in turn skips an account written to in the last
    /// <see cref="ReminderHoldAfterOutreach"/>.
    /// </summary>
    public static readonly TimeSpan AfterCheckoutReminder = TimeSpan.FromDays(2);

    /// <summary>How long the abandoned-checkout reminder holds off after an outreach message.</summary>
    public static readonly TimeSpan ReminderHoldAfterOutreach = TimeSpan.FromDays(1);

    public static readonly TimeSpan ActiveUserAccountAge = TimeSpan.FromDays(7);
    public const int ActiveUserMinDays = 3;
    public const int ActiveUserMinTranscriptions = 4;

    /// <summary>A one-time user is asked about their sheet once they have been quiet this long.</summary>
    public static readonly TimeSpan TriedOnceQuietFor = TimeSpan.FromDays(5);

    public static readonly TimeSpan NeverTranscribedAccountAge = TimeSpan.FromDays(2);

    /// <summary>A failed send is retried once, and only while it is this fresh.</summary>
    public static readonly TimeSpan RetryWithin = TimeSpan.FromDays(2);

    /// <summary>West Africa Time; see the remarks on this type.</summary>
    public static readonly TimeSpan LocalOffset = TimeSpan.FromHours(1);

    public const int SendFromHour = 9;
    public const int SendUntilHour = 19;

    /// <summary>Whether <paramref name="utcNow"/> is between 09:00 and 19:00 WAT.</summary>
    public static bool IsSendingHour(DateTime utcNow)
    {
        var hour = (utcNow + LocalOffset).Hour;
        return hour >= SendFromHour && hour < SendUntilHour;
    }

    public static DateOnly LocalDate(DateTime utc) => DateOnly.FromDateTime(utc + LocalOffset);
}
