using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// The week badges: "A week of practice" (week_goal) is the weekly goal met in one Monday–Sunday week, and streak_7,
/// once titled that, is "Seven in a row". Codes are stored on achievement rows, so none is renamed and every row
/// already earned still shows.
/// </summary>
public class PracticeBadgeTests
{
    private static readonly DateOnly Monday = new(2026, 10, 12); // an ISO week starts here
    private static readonly DateTime Evening = new(2026, 10, 12, 18, 0, 0, DateTimeKind.Utc); // 19:00 in Lagos

    [Fact]
    public void The_badge_codes_are_the_stored_ones_plus_week_goal_each_once()
    {
        Assert.Equal(
            new[] { "first_drill", "streak_3", "first_100", "drills_10", "first_part", "week_goal", "streak_7", "whole_part_80", "streak_30" },
            PracticeBadges.All.Select(b => b.Code));
        Assert.Equal(PracticeBadges.All.Count, PracticeBadges.All.Select(b => b.Code).Distinct().Count());
        Assert.Equal(PracticeBadges.All.Count, PracticeBadges.All.Select(b => b.Title).Distinct().Count());
    }

    [Fact]
    public void Seven_in_a_row_keeps_its_code_and_a_week_of_practice_is_the_weekly_goal()
    {
        var seven = PracticeBadges.All.Single(b => b.Code == "streak_7");
        Assert.Equal("Seven in a row", seven.Title);
        Assert.Equal("Practise seven days running.", seven.Description);
        Assert.Equal(7, seven.Target);

        var week = PracticeBadges.All.Single(b => b.Code == "week_goal");
        Assert.Equal("A week of practice", week.Title);
        Assert.Equal("Practise five days in one week.", week.Description);
        Assert.Equal(PracticeRules.WeeklyGoalDays, week.Target);
        Assert.Equal(5, week.Target);
    }

    [Fact]
    public void Five_days_in_one_week_earn_the_week_badge_not_seven_in_a_row()
    {
        var facts = Days(Monday, 5); // Monday to Friday

        var unlocked = PracticeBadges.Unlocked(PracticeMath.Stats(facts, Monday.AddDays(4)), new HashSet<string>()).Select(b => b.Code).ToList();

        Assert.Contains("week_goal", unlocked);
        Assert.Contains("streak_3", unlocked);
        Assert.DoesNotContain("streak_7", unlocked);
    }

    [Fact]
    public void Five_days_running_across_two_weeks_are_not_a_week_of_practice()
    {
        var friday = Monday.AddDays(-3);
        var facts = Days(friday, 5); // Fri, Sat, Sun | Mon, Tue

        var stats = PracticeMath.Stats(facts, Monday.AddDays(1));
        var unlocked = PracticeBadges.Unlocked(stats, new HashSet<string>()).Select(b => b.Code).ToList();

        Assert.Equal(5, stats.BestStreak);
        Assert.Equal(3, stats.BestWeekDays);
        Assert.Equal(2, stats.WeekDays);
        Assert.DoesNotContain("week_goal", unlocked);
        Assert.Contains("streak_3", unlocked);
    }

    [Fact]
    public void Several_takes_on_one_day_count_as_one_day_of_the_week()
    {
        var facts = Enumerable.Range(0, 5).Select(i => Fact(Monday, i)).Concat(Days(Monday.AddDays(1), 3)).ToList(); // Mon ×5, Tue–Thu

        var stats = PracticeMath.Stats(facts, Monday.AddDays(3));

        Assert.Equal(4, stats.WeekDays);
        Assert.DoesNotContain(PracticeBadges.Unlocked(stats, new HashSet<string>()), b => b.Code == "week_goal");
    }

    [Fact]
    public void A_locked_week_badge_shows_the_days_practised_this_week()
    {
        // A full week last month does not count yet (the badge was earned then or it is awarded on the next take);
        // here: last week had two days, this week Monday to Wednesday.
        var facts = Days(Monday.AddDays(-7), 2).Concat(Days(Monday, 3)).ToList();

        var progress = PracticeMath.Progress(facts, new Dictionary<string, DateTime>(), Monday.AddDays(2), new(1, 5));
        var week = progress.Badges.Single(b => b.Code == "week_goal");

        Assert.False(week.Earned);
        Assert.Equal(3, week.Progress);
        Assert.Equal(5, week.Target);
        Assert.Equal(progress.WeeklyGoal.DaysDone, week.Progress);
    }

    [Fact]
    public void A_week_already_met_before_the_badge_existed_earns_it_on_the_next_take()
    {
        var facts = Days(Monday.AddDays(-14), 6).Append(Fact(Monday, 0)).ToList(); // a six-day week a fortnight ago, then today

        var stats = PracticeMath.Stats(facts, Monday);

        Assert.Equal(1, stats.WeekDays);
        Assert.Equal(6, stats.BestWeekDays);
        Assert.Contains(PracticeBadges.Unlocked(stats, new HashSet<string>()), b => b.Code == "week_goal");
        var shown = PracticeBadges.Describe(PracticeBadges.All.Single(b => b.Code == "week_goal"), stats, null);
        Assert.Equal(5, shown.Progress); // held to the target, never "6 of 5"
    }

    [Fact]
    public async Task The_fifth_day_of_a_week_awards_the_badge_once_through_the_recorder()
    {
        using var h = new TestHarness(Evening);
        var user = Seed(h);
        var recorder = new PracticeRecorder(h.Db);

        var awarded = new List<string>();
        for (var day = 0; day < 7; day++)
        {
            var reward = await recorder.RecordAsync(Session(user, Monday.AddDays(day)), default);
            awarded.AddRange(reward.NewBadges.Where(b => b.Code is "week_goal" or "streak_7").Select(b => $"{b.Code}@{day}"));
        }

        Assert.Equal(new[] { "week_goal@4", "streak_7@6" }, awarded);
        Assert.Single(h.Db.Achievements.Where(a => a.UserId == user.Id && a.Code == "week_goal"));
        var badge = (await recorder.RecordAsync(Session(user, Monday.AddDays(7)), default)).NewBadges;
        Assert.DoesNotContain(badge, b => b.Code == "week_goal");
    }

    [Fact]
    public async Task A_seven_day_badge_earned_under_its_old_title_still_shows_as_earned()
    {
        using var h = new TestHarness(Evening);
        var user = Seed(h);
        var earnedAt = Evening.AddDays(-40);
        h.Db.Achievements.Add(Achievement.Award(user.Id, "streak_7", earnedAt));
        h.Db.Achievements.Add(Achievement.Award(user.Id, "first_drill", earnedAt.AddDays(-7)));
        h.Db.PracticeSessions.Add(Session(user, Monday));
        h.Db.SaveChanges();

        var progress = (await new GetPracticeProgressQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, new StubClientTimeZone())
            .Handle(new GetPracticeProgressQuery(), default)).Value;

        var seven = progress.Badges.Single(b => b.Code == "streak_7");
        Assert.True(seven.Earned);
        Assert.Equal(earnedAt, seven.EarnedAtUtc);
        Assert.Equal("Seven in a row", seven.Title);
        Assert.Equal(7, seven.Progress);
        Assert.True(progress.Badges.Single(b => b.Code == "first_drill").Earned);
        var week = progress.Badges.Single(b => b.Code == "week_goal");
        Assert.False(week.Earned); // a streak once earned is not a week met: it is earned when a week is
        Assert.Equal(1, week.Progress);
    }

    private static List<PracticeFact> Days(DateOnly from, int count)
        => Enumerable.Range(0, count).Select(i => Fact(from.AddDays(i), 0)).ToList();

    private static PracticeFact Fact(DateOnly day, int minute)
        => new(PracticeKind.Drill, 60, false, day, day.ToDateTime(new TimeOnly(18, minute), DateTimeKind.Utc));

    private static PracticeSession Session(User user, DateOnly day)
        => PracticeSession.Record(user.Id, PracticeKind.Drill, 60, 3, 0, 0, 0, 3, day.ToDateTime(new TimeOnly(18, 0), DateTimeKind.Utc), day);

    private static User Seed(TestHarness h)
    {
        var user = User.Create("Chorister", "alto@example.com", h.Hasher.Hash("password123"), Evening.AddDays(-60));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }
}
