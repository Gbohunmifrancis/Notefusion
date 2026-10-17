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

    /// <summary>The calendar day <paramref name="utc"/> falls on in <paramref name="zone"/>.</summary>
    public static DateOnly LocalDate(DateTime utc, TimeZoneInfo zone)
        => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone));

    /// <summary>The Monday that starts the ISO week <paramref name="day"/> is in: a week's identity for the freeze and the goal.</summary>
    public static DateOnly WeekStart(DateOnly day)
        => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));
}
