using System.Globalization;
using NoteFusion.Application.Practice;

namespace NoteFusion.Application.Common;

/// <summary>
/// The free tier's allowance: how many hummed or recorded transcriptions an account without Pro may generate
/// each week, and when that week starts and ends.
/// </summary>
/// <remarks>
/// The week turns every Friday at 18:00 West Africa Time (Africa/Lagos, UTC+1, no daylight saving, so 17:00
/// UTC), for everyone wherever they are: the evening before Saturday's choir rehearsal, when people practise.
/// Every count, refusal and "back Friday 6pm" line reads its boundaries from here, so none can disagree; each
/// says the moment in the reader's own time (<see cref="ResetWhen"/>), never in West Africa Time.
/// </remarks>
public static class FreeTier
{
    /// <summary>
    /// Free hummed or recorded transcriptions a free account may generate per week, everywhere (counted per
    /// account, inbox and device by <see cref="TrialUsage"/>). One number worldwide, so the trial pill, the
    /// refusal and the plans page all say the same thing. Song links and songs with the voice isolated are
    /// not covered: those need Pro, a choir seat or a bought song (the one free link preview aside).
    /// </summary>
    public const int TrialGenerations = 3;

    /// <summary>
    /// The allowance for an account in <paramref name="country"/>. The same everywhere now; kept as a
    /// method because the gate, the trial pill and the admin console all ask it, and a regional split
    /// would come back here rather than into each of them. Charged when the job is observed to have
    /// finished, so a failed transcription costs nothing and a deleted one is not refunded.
    /// </summary>
    public static int TrialGenerationsFor(string? country) => TrialGenerations;

    /// <summary>
    /// The most of an uploaded file a free account's transcription reads: its first three minutes. Pro reads up to
    /// <see cref="SongCredits.ProMaxSeconds"/>, as it does of a linked song, and so does a song a free account pays
    /// for with a bought transcription.
    /// </summary>
    public const double UploadSeconds = 180;

    /// <summary>The weekday the free allowance comes back on.</summary>
    public const DayOfWeek ResetDay = DayOfWeek.Friday;

    /// <summary>The time of day, in West Africa Time, the free allowance comes back.</summary>
    public static readonly TimeSpan ResetTimeOfDay = TimeSpan.FromHours(18);

    /// <summary>West Africa Time's offset from UTC (Africa/Lagos keeps no daylight saving).</summary>
    public static readonly TimeSpan WestAfricaOffset = TimeSpan.FromHours(1);

    /// <summary>
    /// The start of the free week <paramref name="utcNow"/> falls in: the latest Friday 18:00 WAT at or before
    /// it, in UTC. A job submitted at or after this counts in this week; one before it, in an earlier one.
    /// </summary>
    public static DateTime WeekStart(DateTime utcNow)
    {
        // Shift so the reset moment is midnight at the start of a Friday, step back to that Friday, shift back.
        var shift = WestAfricaOffset - ResetTimeOfDay;
        var shifted = DateTime.SpecifyKind(utcNow, DateTimeKind.Utc) + shift;
        var daysBack = ((int)shifted.DayOfWeek - (int)ResetDay + 7) % 7;
        return DateTime.SpecifyKind(shifted.Date.AddDays(-daysBack) - shift, DateTimeKind.Utc);
    }

    /// <summary>When the free week <paramref name="utcNow"/> falls in ends and the allowance comes back, in UTC.</summary>
    public static DateTime NextReset(DateTime utcNow) => WeekStart(utcNow).AddDays(7);

    /// <summary>
    /// When the free ones come back (<paramref name="resetUtc"/>, from <see cref="NextReset"/>), as a sentence says
    /// it after "on": "Friday at 5pm" in a London winter, "Friday at 1pm" in a New York summer, "Saturday at 3am" in a
    /// Sydney winter, in the account's own <paramref name="timeZone"/> (<c>users.TimeZone</c>, an IANA name or offset). With no zone
    /// <see cref="PracticeTime.Known"/> accepts, the rule itself: "Friday at 17:00 UTC", never a guessed zone. The
    /// clock is written as the apps write it (web <c>assets/freeweek.js</c>, mobile <c>lib/freeWeek.ts</c>).
    /// </summary>
    public static string ResetWhen(DateTime resetUtc, string? timeZone)
    {
        var utc = DateTime.SpecifyKind(resetUtc, DateTimeKind.Utc);
        if (PracticeTime.Known(timeZone) is not { } known)
            return $"{utc.DayOfWeek} at {utc.ToString("HH:mm", CultureInfo.InvariantCulture)} UTC";

        var local = TimeZoneInfo.ConvertTimeFromUtc(utc, PracticeTime.Resolve(known));
        var hour = local.Hour % 12 == 0 ? 12 : local.Hour % 12;
        var minutes = local.Minute == 0 ? "" : ":" + local.Minute.ToString("00", CultureInfo.InvariantCulture);
        return $"{local.DayOfWeek} at {hour}{minutes}{(local.Hour < 12 ? "am" : "pm")}";
    }
}
