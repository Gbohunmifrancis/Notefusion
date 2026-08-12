using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>
/// A validated, half-open UTC window <c>[FromUtc, ToUtc)</c> for an analytics query, plus the
/// local-day bucketing rule the series queries use.
/// </summary>
/// <remarks>
/// <para>
/// Lives beside <see cref="AnalyticsErrors"/> because the error messages quote
/// <see cref="MaxDays"/>; keeping the constant and the message it appears in together stops the
/// two drifting apart.
/// </para>
/// <para>
/// <b>Why a fixed offset rather than UTC.</b> The audience is Nigerian and the dashboard is read
/// in Lagos. Bucketing signups by UTC day would put everything between 23:00 and midnight WAT
/// into "tomorrow", which reads as wrong to anyone looking at the chart. West Africa Time is
/// UTC+1 year-round and observes no daylight saving, so a fixed offset is exact here — this is
/// deliberately not a general-purpose timezone implementation, and it would be wrong for a
/// timezone that shifts.
/// </para>
/// </remarks>
public sealed record AnalyticsRange
{
    /// <summary>West Africa Time. Fixed, no daylight saving — see the remarks on this type.</summary>
    public static readonly TimeSpan ReportingOffset = TimeSpan.FromHours(1);

    /// <summary>
    /// The widest window a single request may span. Bounds the row count a series query can pull
    /// back, so an admin cannot accidentally ask for every row in the table.
    /// </summary>
    public const int MaxDays = 366;

    private AnalyticsRange(DateTime fromUtc, DateTime toUtc)
    {
        FromUtc = fromUtc;
        ToUtc = toUtc;
    }

    /// <summary>Inclusive lower bound, UTC.</summary>
    public DateTime FromUtc { get; }

    /// <summary>Exclusive upper bound, UTC.</summary>
    public DateTime ToUtc { get; }

    public int DayCount => (int)Math.Ceiling((ToUtc - FromUtc).TotalDays);

    /// <summary>
    /// The equally-sized window immediately before this one, used to render a
    /// "vs. previous period" delta. Same length, so the comparison is like for like.
    /// </summary>
    public AnalyticsRange PreviousPeriod()
    {
        var span = ToUtc - FromUtc;
        return new AnalyticsRange(FromUtc - span, FromUtc);
    }

    /// <summary>
    /// Builds a range from optional client-supplied bounds, defaulting to the last
    /// <paramref name="defaultDays"/> days ending now.
    /// </summary>
    /// <remarks>
    /// <paramref name="to"/> is treated as an inclusive local day and pushed to the end of that
    /// day, because a caller asking for "1st to 7th" means through the end of the 7th. Any
    /// <see cref="DateTimeKind"/> is normalised to UTC first, so an offset-carrying ISO string and
    /// a bare date cannot mean different things.
    /// </remarks>
    public static Result<AnalyticsRange> Create(DateTime? from, DateTime? to, int defaultDays, DateTime utcNow)
    {
        var toUtc = to is { } t ? EndOfLocalDayUtc(t) : utcNow;
        var fromUtc = from is { } f ? StartOfLocalDayUtc(f) : toUtc.AddDays(-defaultDays);

        if (fromUtc > toUtc)
            return AnalyticsErrors.RangeInverted;

        if ((toUtc - fromUtc).TotalDays > MaxDays)
            return AnalyticsErrors.RangeTooWide;

        return new AnalyticsRange(fromUtc, toUtc);
    }

    /// <summary>The reporting-local date a UTC instant falls on.</summary>
    public static DateOnly LocalDateOf(DateTime utc) => DateOnly.FromDateTime(utc + ReportingOffset);

    /// <summary>
    /// Every local date in the window, in order. Series queries walk this rather than the grouped
    /// rows so that days with no activity appear as an explicit zero — a chart that silently skips
    /// empty days misrepresents a flat stretch as a continuous line.
    /// </summary>
    public IEnumerable<DateOnly> LocalDates()
    {
        var day = LocalDateOf(FromUtc);
        var last = LocalDateOf(ToUtc.AddTicks(-1));
        while (day <= last)
        {
            yield return day;
            day = day.AddDays(1);
        }
    }

    private static DateTime StartOfLocalDayUtc(DateTime value)
    {
        var utc = ToUtcInstant(value);
        var local = utc + ReportingOffset;
        return local.Date - ReportingOffset;
    }

    private static DateTime EndOfLocalDayUtc(DateTime value)
    {
        var utc = ToUtcInstant(value);
        var local = utc + ReportingOffset;
        return local.Date.AddDays(1) - ReportingOffset;
    }

    /// <summary>
    /// Normalises to a UTC instant. A model-bound date with no offset arrives as
    /// <see cref="DateTimeKind.Unspecified"/>; treating it as UTC keeps a bare <c>2026-08-01</c>
    /// meaning the same thing as the same date sent with an explicit <c>Z</c>.
    /// </summary>
    private static DateTime ToUtcInstant(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
    };
}
