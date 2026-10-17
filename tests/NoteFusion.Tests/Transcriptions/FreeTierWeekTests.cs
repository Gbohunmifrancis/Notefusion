using NoteFusion.Application.Common;

namespace NoteFusion.Tests.Transcriptions;

/// <summary>
/// The free week's boundaries: it turns every Friday at 18:00 West Africa Time (17:00 UTC; Lagos keeps no
/// daylight saving), for everyone. Every count and every "back Friday 6pm" reads them from <see cref="FreeTier"/>.
/// </summary>
public class FreeTierWeekTests
{
    private static DateTime Utc(int y, int mo, int d, int h, int mi = 0, int s = 0)
        => new(y, mo, d, h, mi, s, DateTimeKind.Utc);

    [Fact]
    public void One_minute_before_six_on_friday_evening_is_still_last_week()
    {
        // Fri 16 Oct 2026, 17:59 WAT = 16:59 UTC.
        var now = Utc(2026, 10, 16, 16, 59);

        Assert.Equal(Utc(2026, 10, 9, 17), FreeTier.WeekStart(now));
        Assert.Equal(Utc(2026, 10, 16, 17), FreeTier.NextReset(now));
    }

    [Fact]
    public void Six_on_friday_evening_starts_the_new_week()
    {
        // Fri 16 Oct 2026, 18:00 WAT = 17:00 UTC: the reset moment belongs to the week it opens.
        var now = Utc(2026, 10, 16, 17);

        Assert.Equal(now, FreeTier.WeekStart(now));
        Assert.Equal(Utc(2026, 10, 23, 17), FreeTier.NextReset(now));
    }

    [Fact]
    public void Saturday_rehearsal_is_in_the_week_that_began_the_evening_before()
    {
        var now = Utc(2026, 10, 17, 9, 30); // Sat 10:30 WAT

        Assert.Equal(Utc(2026, 10, 16, 17), FreeTier.WeekStart(now));
        Assert.Equal(Utc(2026, 10, 23, 17), FreeTier.NextReset(now));
    }

    [Fact]
    public void Thursday_night_is_the_end_of_the_week()
    {
        // Thu 22 Oct 2026, 23:30 WAT = 22:30 UTC; and just past midnight WAT on Friday, still before the reset.
        Assert.Equal(Utc(2026, 10, 16, 17), FreeTier.WeekStart(Utc(2026, 10, 22, 22, 30)));
        Assert.Equal(Utc(2026, 10, 16, 17), FreeTier.WeekStart(Utc(2026, 10, 22, 23, 30)));
        Assert.Equal(Utc(2026, 10, 23, 17), FreeTier.NextReset(Utc(2026, 10, 23, 16, 59, 59)));
    }

    [Fact]
    public void The_week_runs_across_the_new_year()
    {
        // 1 Jan 2027 is a Friday: before 18:00 WAT it is the week that began on Christmas evening.
        Assert.Equal(Utc(2026, 12, 25, 17), FreeTier.WeekStart(Utc(2026, 12, 31, 23)));
        Assert.Equal(Utc(2026, 12, 25, 17), FreeTier.WeekStart(Utc(2027, 1, 1, 16, 59)));
        Assert.Equal(Utc(2027, 1, 1, 17), FreeTier.NextReset(Utc(2026, 12, 31, 23)));
        Assert.Equal(Utc(2027, 1, 1, 17), FreeTier.WeekStart(Utc(2027, 1, 1, 17)));
    }

    [Fact]
    public void Every_moment_of_a_week_has_the_same_start_and_the_start_is_a_friday_at_six_wat()
    {
        var start = Utc(2026, 10, 16, 17);
        for (var t = start; t < start.AddDays(7); t = t.AddMinutes(37))
        {
            var week = FreeTier.WeekStart(t);
            Assert.Equal(start, week);
            Assert.Equal(DateTimeKind.Utc, week.Kind);
            var wat = week + FreeTier.WestAfricaOffset;
            Assert.Equal(DayOfWeek.Friday, wat.DayOfWeek);
            Assert.Equal(TimeSpan.FromHours(18), wat.TimeOfDay);
        }
    }
}
