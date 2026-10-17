using System.Globalization;
using System.Text.RegularExpressions;

namespace NoteFusion.Application.Practice;

/// <summary>
/// The singer's calendar: which local day a moment falls on, from the time zone their client sent. A streak is
/// "practised on Tuesday evening", and a Lagos evening is already Wednesday in UTC an hour before midnight.
/// </summary>
/// <remarks>
/// Accepts an IANA name ("Africa/Lagos", "Europe/London") or a fixed offset ("+01:00", "-0530", "UTC+1"). Anything
/// else, or nothing, is Africa/Lagos, where most singers are; Lagos keeps no daylight saving, so when a host has no
/// time zone database its fixed +01:00 is the same zone.
/// </remarks>
public static partial class PracticeTime
{
    public const string DefaultZoneId = "Africa/Lagos";

    private const int MaxZoneLength = 64;

    /// <summary>Africa/Lagos, or a fixed +01:00 under the same name where the host has no tz database.</summary>
    public static readonly TimeZoneInfo DefaultZone =
        TimeZoneInfo.TryFindSystemTimeZoneById(DefaultZoneId, out var lagos)
            ? lagos
            : TimeZoneInfo.CreateCustomTimeZone(DefaultZoneId, TimeSpan.FromHours(1), "West Africa Time", "WAT");

    [GeneratedRegex(@"^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$", RegexOptions.IgnoreCase)]
    private static partial Regex OffsetPattern();

    /// <summary>The zone a client's <c>X-Time-Zone</c> names, or <see cref="DefaultZone"/>.</summary>
    public static TimeZoneInfo Resolve(string? value)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v) || v.Length > MaxZoneLength)
            return DefaultZone;

        var offset = OffsetPattern().Match(v);
        if (offset.Success)
        {
            var hours = int.Parse(offset.Groups[2].Value, CultureInfo.InvariantCulture);
            var minutes = offset.Groups[3].Success ? int.Parse(offset.Groups[3].Value, CultureInfo.InvariantCulture) : 0;
            if (hours > 14 || minutes >= 60)
                return DefaultZone;
            var span = new TimeSpan(hours, minutes, 0) * (offset.Groups[1].Value == "-" ? -1 : 1);
            return TimeZoneInfo.CreateCustomTimeZone($"UTC{(span < TimeSpan.Zero ? "-" : "+")}{span:hh\\:mm}", span, v, v);
        }

        return TimeZoneInfo.TryFindSystemTimeZoneById(v, out var zone) ? zone : DefaultZone;
    }

    /// <summary>
    /// <paramref name="value"/> trimmed, when it names a zone <see cref="Resolve"/> knows (an IANA name this host
    /// has, or a valid offset); null otherwise. What is stored as the account's time zone, so a garbled header
    /// never replaces a good one.
    /// </summary>
    public static string? Known(string? value)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v) || v.Length > MaxZoneLength)
            return null;

        var offset = OffsetPattern().Match(v);
        if (offset.Success)
        {
            var hours = int.Parse(offset.Groups[2].Value, CultureInfo.InvariantCulture);
            var minutes = offset.Groups[3].Success ? int.Parse(offset.Groups[3].Value, CultureInfo.InvariantCulture) : 0;
            return hours > 14 || minutes >= 60 ? null : v;
        }

        return TimeZoneInfo.TryFindSystemTimeZoneById(v, out _) || v == DefaultZoneId ? v : null;
    }

    /// <summary>The calendar day <paramref name="utc"/> falls on in <paramref name="zone"/>.</summary>
    public static DateOnly LocalDate(DateTime utc, TimeZoneInfo zone)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone));

    /// <summary>
    /// The moment, in UTC, the singer's day after <paramref name="day"/> begins in <paramref name="zone"/>: when the
    /// daily drill allowance starts again. A midnight a clock change skips is read as the first half hour that exists.
    /// </summary>
    public static DateTime NextMidnightUtc(DateOnly day, TimeZoneInfo zone)
    {
        var midnight = day.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        while (zone.IsInvalidTime(midnight))
            midnight = midnight.AddMinutes(30);
        return TimeZoneInfo.ConvertTimeToUtc(midnight, zone);
    }

    /// <summary>The Monday that starts the ISO week <paramref name="day"/> is in: a week's identity for the freeze and the goal.</summary>
    public static DateOnly WeekStart(DateOnly day)
        => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));
}
