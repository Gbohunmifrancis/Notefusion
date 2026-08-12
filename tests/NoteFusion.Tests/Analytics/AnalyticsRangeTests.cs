using NoteFusion.Application.Common.Errors;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// Range parsing and local-day bucketing. These lock in the WAT (UTC+1) boundary rule: a signup at
/// 23:30 Lagos time belongs to that Lagos day, not to the next UTC one.
/// </summary>
public class AnalyticsRangeTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Defaults_to_the_last_thirty_days()
    {
        var range = AnalyticsRange.Create(null, null, 30, Now).Value;

        Assert.Equal(Now, range.ToUtc);
        Assert.Equal(Now.AddDays(-30), range.FromUtc);
    }

    [Fact]
    public void An_inclusive_end_date_covers_the_whole_of_that_local_day()
    {
        // Asking for "up to the 7th" has to include everything that happened on the 7th in Lagos.
        // The 7th ends at 23:59:59 WAT, which is 22:59:59 UTC — so the exclusive bound is 23:00 UTC.
        var range = AnalyticsRange.Create(
            new DateTime(2026, 8, 1), new DateTime(2026, 8, 7), 30, Now).Value;

        Assert.Equal(new DateTime(2026, 7, 31, 23, 0, 0, DateTimeKind.Utc), range.FromUtc);
        Assert.Equal(new DateTime(2026, 8, 7, 23, 0, 0, DateTimeKind.Utc), range.ToUtc);
    }

    [Fact]
    public void A_late_evening_local_instant_buckets_into_the_local_day_not_the_utc_one()
    {
        // 23:30 WAT on the 10th is 22:30 UTC on the 10th. Both agree here.
        Assert.Equal(new DateOnly(2026, 8, 10),
            AnalyticsRange.LocalDateOf(new DateTime(2026, 8, 10, 22, 30, 0, DateTimeKind.Utc)));

        // 00:30 WAT on the 11th is 23:30 UTC on the 10th. Bucketing by UTC would file this under
        // the 10th and show the day's first signups as belonging to yesterday.
        Assert.Equal(new DateOnly(2026, 8, 11),
            AnalyticsRange.LocalDateOf(new DateTime(2026, 8, 10, 23, 30, 0, DateTimeKind.Utc)));
    }

    [Fact]
    public void An_inverted_range_is_rejected()
    {
        var result = AnalyticsRange.Create(new DateTime(2026, 8, 7), new DateTime(2026, 8, 1), 30, Now);

        Assert.True(result.IsFailure);
        Assert.Equal("ANALYTICS_RANGE_INVERTED", result.Error.Code);
    }

    [Fact]
    public void A_range_wider_than_the_cap_is_rejected()
    {
        var result = AnalyticsRange.Create(
            new DateTime(2024, 1, 1), new DateTime(2026, 1, 1), 30, Now);

        Assert.True(result.IsFailure);
        Assert.Equal("ANALYTICS_RANGE_TOO_WIDE", result.Error.Code);
    }

    [Fact]
    public void The_previous_period_is_the_same_length_immediately_before()
    {
        var range = AnalyticsRange.Create(null, null, 30, Now).Value;
        var previous = range.PreviousPeriod();

        Assert.Equal(range.FromUtc, previous.ToUtc);
        Assert.Equal(range.ToUtc - range.FromUtc, previous.ToUtc - previous.FromUtc);
    }

    [Fact]
    public void Local_dates_enumerate_every_day_in_the_window_inclusively()
    {
        var range = AnalyticsRange.Create(
            new DateTime(2026, 8, 1), new DateTime(2026, 8, 7), 30, Now).Value;

        var dates = range.LocalDates().ToList();

        Assert.Equal(7, dates.Count);
        Assert.Equal(new DateOnly(2026, 8, 1), dates[0]);
        Assert.Equal(new DateOnly(2026, 8, 7), dates[^1]);
    }

    [Fact]
    public void A_bare_date_and_the_same_date_sent_as_utc_mean_the_same_window()
    {
        // Model binding yields Unspecified for "2026-08-01"; an ISO string with Z yields Utc. If
        // these disagreed, the same dashboard request would return different numbers depending on
        // how the client happened to serialise the date.
        var bare = AnalyticsRange.Create(new DateTime(2026, 8, 1), new DateTime(2026, 8, 7), 30, Now).Value;
        var utc = AnalyticsRange.Create(
            new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
            new DateTime(2026, 8, 7, 0, 0, 0, DateTimeKind.Utc), 30, Now).Value;

        Assert.Equal(bare.FromUtc, utc.FromUtc);
        Assert.Equal(bare.ToUtc, utc.ToUtc);
    }
}
