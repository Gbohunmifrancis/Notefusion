using NoteFusion.Application.Practice;

namespace NoteFusion.Application.Outreach;

/// <summary>
/// The timing rules of the founder's outreach, in one place so the sweep, the abandoned-checkout reminder
/// and the tests read the same numbers.
/// </summary>
/// <remarks>
/// Sending hours are 09:00–19:00 in the account's own time zone (the one its clients send as <c>X-Time-Zone</c>,
/// kept as <c>users.TimeZone</c>), West Africa Time when none is known: a note from a person that lands at 3 a.m.
/// reads like a robot sent it. The day an account was active on (<see cref="LocalDate"/>) stays a WAT day.
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

    /// <summary>West Africa Time, the day <see cref="LocalDate"/> counts in.</summary>
    public static readonly TimeSpan LocalOffset = TimeSpan.FromHours(1);

    public const int SendFromHour = 9;
    public const int SendUntilHour = 19;

    /// <summary>
    /// Whether <paramref name="utcNow"/> is between 09:00 and 19:00 where the account is: its own time zone
    /// (<c>users.TimeZone</c>), or West Africa Time when none is known — never a 3am note in New York.
    /// </summary>
    public static bool IsSendingHour(DateTime utcNow, string? timeZone)
    {
        var hour = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc), PracticeTime.Resolve(timeZone)).Hour;
        return hour >= SendFromHour && hour < SendUntilHour;
    }

    public static DateOnly LocalDate(DateTime utc) => DateOnly.FromDateTime(utc + LocalOffset);
}
