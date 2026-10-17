using NoteFusion.Application.Practice;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Practice;

/// <summary>The scoring rules: XP per take and the daily cap, the level ladder, streaks with their weekly freeze, time zones.</summary>
public class PracticeRulesTests
{
    private static readonly DateOnly Monday = new(2026, 10, 12); // an ISO week starts here

    // ── XP ──────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(PracticeKind.Drill, 0, 10)]
    [InlineData(PracticeKind.Drill, 79, 10)]
    [InlineData(PracticeKind.Drill, 80, 15)]
    [InlineData(PracticeKind.Drill, 99, 15)]
    [InlineData(PracticeKind.Drill, 100, 20)]
    [InlineData(PracticeKind.Part, 0, 15)]
    [InlineData(PracticeKind.Part, 80, 25)]
    [InlineData(PracticeKind.Part, 100, 25)]
    public void A_take_earns_its_kinds_xp_and_bonuses(PracticeKind kind, int score, int xp)
        => Assert.Equal(xp, PracticeRules.BaseXp(kind, score));

    [Fact]
    public void A_day_earns_at_most_the_cap_and_the_next_day_starts_again()
    {
        var facts = Enumerable.Range(0, 10).Select(i => Fact(PracticeKind.Drill, 100, Monday, i)) // 10 × 20 = 200
            .Append(Fact(PracticeKind.Part, 90, Monday.AddDays(1), 0))
            .ToList();

        var byDay = PracticeMath.XpByDay(facts);

        Assert.Equal(PracticeRules.DailyXpCap, byDay[Monday]);
        Assert.Equal(150, PracticeRules.DailyXpCap);
        Assert.Equal(25, byDay[Monday.AddDays(1)]);
        Assert.Equal(175, PracticeMath.TotalXp(facts));
    }

    // ── Levels ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, 0, "Doh", 100)]
    [InlineData(99, 0, "Doh", 1)]
    [InlineData(100, 1, "Ray", 150)]
    [InlineData(250, 2, "Me", 250)]
    [InlineData(500, 3, "Fah", 400)]
    [InlineData(900, 4, "Soh", 500)]
    [InlineData(1400, 5, "Lah", 600)]
    [InlineData(1999, 6 - 1, "Lah", 1)]
    [InlineData(2000, 6, "Te", 1000)]
    [InlineData(3000, 7, "Choir-ready", 0)]
    [InlineData(50_000, 7, "Choir-ready", 0)]
    public void Levels_follow_the_ladder(int xp, int index, string name, int xpForNext)
    {
        var level = PracticeMath.LevelFor(xp);

        Assert.Equal(index, level.Index);
        Assert.Equal(name, level.Name);
        Assert.Equal(xpForNext, level.XpForNext);
    }

    [Fact]
    public void The_top_level_has_nothing_after_it()
    {
        var top = PracticeMath.LevelFor(3000);
        Assert.Null(top.NextLevelXp);
        Assert.Null(top.NextName);
        Assert.Equal("Ray", PracticeMath.LevelFor(0).NextName);
    }

    // ── Streaks ─────────────────────────────────────────────────────────────

    [Fact]
    public void Days_in_a_row_make_a_streak_and_today_not_yet_done_does_not_break_it()
    {
        var streak = PracticeMath.Streak([Monday, Monday.AddDays(1), Monday.AddDays(2)], today: Monday.AddDays(3));

        Assert.Equal(3, streak.Current);
        Assert.Equal(3, streak.Best);
        Assert.False(streak.TodayDone);
    }

    [Fact]
    public void Today_done_counts()
    {
        var streak = PracticeMath.Streak([Monday, Monday.AddDays(1)], today: Monday.AddDays(1));

        Assert.Equal(2, streak.Current);
        Assert.True(streak.TodayDone);
    }

    [Fact]
    public void One_missed_day_a_week_is_bridged_by_the_freeze_and_does_not_add_to_the_count()
    {
        // Mon, Tue, (Wed missed), Thu — today Thu.
        var streak = PracticeMath.Streak([Monday, Monday.AddDays(1), Monday.AddDays(3)], today: Monday.AddDays(3));

        Assert.Equal(3, streak.Current);
        Assert.Contains(Monday.AddDays(2), streak.Frozen);
        Assert.False(streak.FreezeAvailable); // this week's is spent
    }

    [Fact]
    public void A_second_missed_day_in_the_same_week_breaks_the_streak()
    {
        // Mon, (Tue missed: frozen), Wed, (Thu missed: no freeze left), Fri.
        var streak = PracticeMath.Streak([Monday, Monday.AddDays(2), Monday.AddDays(4)], today: Monday.AddDays(4));

        Assert.Equal(1, streak.Current);
        Assert.Equal(2, streak.Best);
    }

    [Fact]
    public void Two_missed_days_running_break_the_streak()
    {
        var streak = PracticeMath.Streak([Monday, Monday.AddDays(1)], today: Monday.AddDays(4));

        Assert.Equal(0, streak.Current);
        Assert.Equal(2, streak.Best);
    }

    [Fact]
    public void A_break_is_dated_the_first_missed_day_no_freeze_bridged_and_today_never_breaks_one()
    {
        // Mon, Tue, (Wed frozen), (Thu ends a 2-day run); next Mon, (next Tue frozen), next Wed is today, still open.
        var breaks = PracticeMath.StreakBreaks([Monday, Monday.AddDays(1), Monday.AddDays(7)], today: Monday.AddDays(9));

        Assert.Equal([new StreakBreak(Monday.AddDays(3), 2)], breaks);
        // The same walk as the streak itself: a missed day it bridges is not a break.
        Assert.Empty(PracticeMath.StreakBreaks([Monday, Monday.AddDays(2)], today: Monday.AddDays(3)));
    }

    [Fact]
    public void A_new_iso_week_brings_a_new_freeze()
    {
        // Mon, (Tue frozen), Wed..Sun, next Mon, (next Tue frozen with next week's freeze), next Wed.
        var days = new List<DateOnly> { Monday };
        days.AddRange(Enumerable.Range(2, 6).Select(i => Monday.AddDays(i)));
        days.Add(Monday.AddDays(9));

        var streak = PracticeMath.Streak(days, today: Monday.AddDays(9));

        Assert.Equal(8, streak.Current);
        Assert.Equal(new[] { Monday.AddDays(1), Monday.AddDays(8) }, streak.Frozen.Order());
    }

    [Fact]
    public void Nothing_practised_is_no_streak_with_the_freeze_unused()
    {
        var streak = PracticeMath.Streak([], today: Monday);

        Assert.Equal(0, streak.Current);
        Assert.Equal(0, streak.Best);
        Assert.True(streak.FreezeAvailable);
    }

    [Fact]
    public void A_freeze_is_not_spent_when_there_is_no_streak_to_keep()
    {
        // Practised Monday; missed Tue (frozen) and Wed (broken). Thursday onward nothing is spent.
        var streak = PracticeMath.Streak([Monday], today: Monday.AddDays(5));

        Assert.Equal(0, streak.Current);
        Assert.Equal(new[] { Monday.AddDays(1) }, streak.Frozen);
    }

    // ── Progress ────────────────────────────────────────────────────────────

    [Fact]
    public void Progress_reads_the_week_and_the_last_seven_days()
    {
        var thursday = Monday.AddDays(3);
        var facts = new List<PracticeFact>
        {
            Fact(PracticeKind.Drill, 50, Monday.AddDays(-5), 0), // the Wednesday before
            Fact(PracticeKind.Drill, 100, Monday, 0),
            Fact(PracticeKind.Part, 85, Monday.AddDays(1), 0),
            Fact(PracticeKind.Drill, 70, thursday, 0),
        };

        var progress = PracticeMath.Progress(facts, new Dictionary<string, DateTime>(), thursday, new(1, 5));

        Assert.Equal(10 + 20 + 25 + 10, progress.Xp);
        Assert.Equal(10, progress.XpToday);
        Assert.Equal(3, progress.WeeklyGoal.DaysDone);
        Assert.Equal(5, progress.WeeklyGoal.Target);
        Assert.Equal(Monday, progress.WeeklyGoal.WeekStart);
        Assert.Equal(3, progress.Streak.Current); // Mon, Tue, (Wed frozen), Thu
        Assert.True(progress.Streak.TodayDone);
        Assert.False(progress.Streak.AtRisk);
        Assert.True(progress.Streak.FrozenYesterday);
        Assert.Equal(
            new[] { "missed", "missed", "missed", "done", "done", "frozen", "done" },
            progress.LastSevenDays.Select(d => d.Status));
        Assert.Equal(thursday, progress.LastSevenDays[^1].Date);
        Assert.Equal(PracticeBadges.All.Count, progress.Badges.Count);
    }

    [Fact]
    public void A_running_streak_is_at_risk_until_today_is_done_and_days_before_the_first_are_none()
    {
        var progress = PracticeMath.Progress(
            [Fact(PracticeKind.Drill, 90, Monday, 0)], new Dictionary<string, DateTime>(), Monday.AddDays(1), new(0, 5));

        Assert.True(progress.Streak.AtRisk);
        Assert.Equal(new[] { "none", "none", "none", "none", "none", "done", "today" }, progress.LastSevenDays.Select(d => d.Status));
    }

    [Fact]
    public void Locked_badges_show_their_progress_and_earned_ones_their_date()
    {
        var facts = Enumerable.Range(0, 4).Select(i => Fact(PracticeKind.Drill, 60, Monday, i)).ToList();
        var earnedAt = new DateTime(2026, 10, 12, 18, 0, 0, DateTimeKind.Utc);

        var badges = PracticeMath.Progress(facts, new Dictionary<string, DateTime> { ["first_drill"] = earnedAt }, Monday, new(4, 5)).Badges;

        var first = badges.Single(b => b.Code == "first_drill");
        Assert.True(first.Earned);
        Assert.Equal(earnedAt, first.EarnedAtUtc);
        var ten = badges.Single(b => b.Code == "drills_10");
        Assert.False(ten.Earned);
        Assert.Equal(4, ten.Progress);
        Assert.Equal(10, ten.Target);
    }

    // ── Time zones ──────────────────────────────────────────────────────────

    [Fact]
    public void Late_evening_in_lagos_is_already_tomorrow_in_utc_but_today_for_the_singer()
    {
        var lateUtc = new DateTime(2026, 10, 12, 22, 30, 0, DateTimeKind.Utc); // 23:30 in Lagos
        var pastMidnightUtc = new DateTime(2026, 10, 12, 23, 30, 0, DateTimeKind.Utc); // 00:30 Tuesday in Lagos

        Assert.Equal(Monday, PracticeTime.LocalDate(lateUtc, PracticeTime.Resolve(null)));
        Assert.Equal(Monday.AddDays(1), PracticeTime.LocalDate(pastMidnightUtc, PracticeTime.Resolve(null)));
    }

    [Theory]
    [InlineData("America/New_York", 2026, 10, 12)] // 01:00 UTC Tuesday is Monday evening in New York
    [InlineData("Asia/Tokyo", 2026, 10, 13)]
    [InlineData("-05:00", 2026, 10, 12)]
    [InlineData("UTC+9", 2026, 10, 13)]
    [InlineData("+0100", 2026, 10, 13)]
    [InlineData("Mars/Olympus_Mons", 2026, 10, 13)] // unknown: Lagos
    [InlineData("+25:00", 2026, 10, 13)] // not an offset: Lagos
    [InlineData("", 2026, 10, 13)]
    public void The_client_time_zone_decides_the_day(string zone, int y, int m, int d)
    {
        var utc = new DateTime(2026, 10, 13, 1, 0, 0, DateTimeKind.Utc);
        Assert.Equal(new DateOnly(y, m, d), PracticeTime.LocalDate(utc, PracticeTime.Resolve(zone)));
    }

    [Fact]
    public void A_streak_counts_the_days_the_singer_lived_not_utc_days()
    {
        // Practised 23:30 Lagos Monday (22:30 UTC) and 00:30 Lagos Wednesday (23:30 UTC Tuesday): in UTC those are
        // Monday and Tuesday in a row; on the singer's calendar Tuesday was missed (and frozen).
        var lagos = PracticeTime.Resolve("Africa/Lagos");
        var days = new[]
        {
            PracticeTime.LocalDate(new DateTime(2026, 10, 12, 22, 30, 0, DateTimeKind.Utc), lagos),
            PracticeTime.LocalDate(new DateTime(2026, 10, 13, 23, 30, 0, DateTimeKind.Utc), lagos),
        };

        var streak = PracticeMath.Streak(days, today: Monday.AddDays(2));

        Assert.Equal(new[] { Monday, Monday.AddDays(2) }, days);
        Assert.Equal(2, streak.Current);
        Assert.Contains(Monday.AddDays(1), streak.Frozen);
    }

    [Fact]
    public void Weeks_start_on_monday()
    {
        Assert.Equal(Monday, PracticeTime.WeekStart(Monday));
        Assert.Equal(Monday, PracticeTime.WeekStart(Monday.AddDays(6))); // Sunday
        Assert.Equal(Monday.AddDays(7), PracticeTime.WeekStart(Monday.AddDays(7)));
    }

    private static PracticeFact Fact(PracticeKind kind, int score, DateOnly day, int minute)
        => new(kind, score, false, day, day.ToDateTime(new TimeOnly(12, minute), DateTimeKind.Utc));
}
