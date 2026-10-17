using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.Practice;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// The console's Practice page, computed against seeded rows: the headline on the singer's own calendar day,
/// first-practice cohorts and the week-on-week return comparison, streaks (buckets, freezes, breaks), the path funnel
/// replayed as the app reads it, the daily drill allowance and what free singers bought after hitting it, reminder
/// conversion (a take at 1h59 counts, at 2h01 does not), badges, an empty window, and the team left out.
/// </summary>
public class PracticeAnalyticsTests
{
    // Friday 20 November 2026, midday UTC. The window is Monday 2 to Sunday 15 November.
    private static readonly DateTime Now = new(2026, 11, 20, 12, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime From = new(2026, 11, 2);
    private static readonly DateTime To = new(2026, 11, 15);

    private static DateOnly D(int month, int day) => new(2026, month, day);
    private static DateTime Utc(int month, int day, int hour, int minute = 0) => new(2026, month, day, hour, minute, 0, DateTimeKind.Utc);

    private static async Task<PracticeAnalyticsDto> Read(TestHarness h, DateTime? from = null, DateTime? to = null)
    {
        var result = await new GetPracticeAnalyticsQueryHandler(h.Db, h.Clock)
            .Handle(new GetPracticeAnalyticsQuery(from ?? From, to ?? To), default);
        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Message : null);
        return result.Value;
    }

    [Fact]
    public async Task An_empty_window_is_zeros_and_nulls_with_every_day_listed()
    {
        using var h = new TestHarness(Now);

        var d = await Read(h);

        Assert.Equal(D(11, 2), d.FirstDay);
        Assert.Equal(D(11, 15), d.LastDay);
        Assert.Equal(14, d.Daily.Count);
        Assert.All(d.Daily, day => Assert.Equal(0, day.Practisers + day.Drills + day.Parts + day.Xp + day.BadgesEarned));
        Assert.Equal(0, d.Headline.Practisers);
        Assert.Null(d.Headline.AverageScore);
        Assert.Null(d.Headline.TakesPerPractiserDay);
        Assert.Empty(d.Retention.Cohorts);
        Assert.Null(d.Retention.PractiserRate);
        Assert.Null(d.Retention.OtherRate);
        Assert.All(d.Streaks.Current, b => Assert.Equal(0, b.Count));
        Assert.Equal(["none", "playful", "focused"], d.Path.Select(t => t.Track));
        Assert.All(d.Path, t => Assert.Equal(0, t.Singers));
        Assert.Null(d.Allowance.ConversionRate);
        Assert.Equal(0, d.Reminders.Sent);
        Assert.All(d.Reminders.Kinds, k => Assert.Null(k.Within2hRate));
        Assert.Equal(PracticeBadges.All.Select(b => b.Code), d.Badges.Select(b => b.Code));
    }

    [Fact]
    public async Task The_headline_counts_takes_on_the_singers_own_day_and_leaves_the_team_out()
    {
        using var h = new TestHarness(Now);
        var lagos = Seed(h, "lagos@example.com");
        var la = Seed(h, "la@example.com");
        var earlier = Seed(h, "earlier@example.com");
        var staff = Seed(h, "staff@example.com");
        staff.SetInternal(true);
        lagos.ChoosePracticeTrack(PracticeTrack.Playful, Now);

        // Lagos: three drills on Tuesday 3rd (80, 60, 100) and a part on Wednesday 4th.
        Take(h, lagos, PracticeKind.Drill, 80, D(11, 3), Utc(11, 3, 18));
        Take(h, lagos, PracticeKind.Drill, 60, D(11, 3), Utc(11, 3, 18, 5));
        Take(h, lagos, PracticeKind.Drill, 100, D(11, 3), Utc(11, 3, 18, 10));
        Take(h, lagos, PracticeKind.Part, 85, D(11, 4), Utc(11, 4, 19));
        // Los Angeles: Monday 16th 04:00 UTC, past the window in UTC, is still Sunday the 15th there; and 1 November
        // 07:30 UTC is 31 October.
        Take(h, la, PracticeKind.Drill, 70, D(11, 15), Utc(11, 16, 4));
        Take(h, la, PracticeKind.Drill, 90, D(10, 31), Utc(11, 1, 7, 30));
        // The window before (19 Oct – 1 Nov): someone else, and LA's 31 October.
        Take(h, earlier, PracticeKind.Drill, 50, D(10, 25), Utc(10, 25, 18));
        // The team's own practice counts nowhere.
        Take(h, staff, PracticeKind.Drill, 100, D(11, 5), Utc(11, 5, 18));
        h.Db.SaveChanges();

        var d = await Read(h);
        var k = d.Headline;

        Assert.Equal(2, k.Practisers);
        Assert.Equal(2, k.PractisersPrevious);
        Assert.Equal(1, k.NewPractisers);            // Lagos began in the window; LA on 31 October
        Assert.Equal(5, k.Takes);
        Assert.Equal(2, k.TakesPrevious);
        Assert.Equal((4, 1), (k.Drills, k.Parts));
        Assert.Equal(3, k.PractiserDays);            // Lagos 3rd and 4th, LA 15th
        Assert.Equal(1.67, k.TakesPerPractiserDay);
        Assert.Equal(79.0, k.AverageScore);          // (80 + 60 + 100 + 85 + 70) / 5
        Assert.Equal(45 + 25 + 10, k.XpEarned);      // 15 + 10 + 20 drills, a part of 85, a drill of 70
        Assert.Equal(1, k.Dau);                      // LA on the 15th, on their own calendar
        Assert.Equal(1, k.Wau);
        Assert.Equal(3, k.Mau);                      // 17 Oct – 15 Nov: Lagos, LA and the earlier singer
        Assert.Equal(1, k.PractisersByTrack.Single(c => c.Label == "Playful").Count);
        Assert.Equal(1, k.PractisersByTrack.Single(c => c.Label == "Not chosen").Count);

        Assert.Equal(1, d.Daily.Single(x => x.Date == D(11, 15)).Practisers);
        Assert.Equal((3, 45), (d.Daily.Single(x => x.Date == D(11, 3)).Drills, d.Daily.Single(x => x.Date == D(11, 3)).Xp));
        Assert.Equal(0, d.Daily.Single(x => x.Date == D(11, 5)).Drills);
    }

    [Fact]
    public async Task Cohorts_count_a_return_exactly_one_seven_and_thirty_days_on_once_that_day_is_over()
    {
        using var h = new TestHarness(Now);
        var s1 = Seed(h, "s1@example.com");
        var s2 = Seed(h, "s2@example.com");
        var s3 = Seed(h, "s3@example.com");
        var s4 = Seed(h, "s4@example.com");
        var veteran = Seed(h, "veteran@example.com");

        Days(h, s1, D(11, 2), D(11, 3), D(11, 9));   // D1 and D7
        Days(h, s2, D(11, 2));                        // neither
        Days(h, s3, D(11, 10), D(11, 11));            // week of the 9th: D1; D7 (17th) is over and missed
        Days(h, s4, D(11, 14), D(11, 15));            // D1; D7 (21st) not over yet
        Days(h, veteran, D(10, 20), D(11, 3));        // first practised before the window: no cohort
        h.Db.SaveChanges();

        var cohorts = (await Read(h)).Retention.Cohorts;

        Assert.Equal([D(11, 2), D(11, 9)], cohorts.Select(c => c.WeekStart));
        var first = cohorts[0];
        Assert.Equal(2, first.Singers);
        Assert.Equal((0.5, 2), (first.D1, first.EligibleD1));
        Assert.Equal((0.5, 2), (first.D7, first.EligibleD7));
        Assert.Equal((null, 0), (first.D30, first.EligibleD30));
        var second = cohorts[1];
        Assert.Equal(2, second.Singers);
        Assert.Equal((1.0, 2), (second.D1, second.EligibleD1));
        Assert.Equal((0.0, 1), (second.D7, second.EligibleD7));
    }

    [Fact]
    public async Task Practisers_are_compared_with_other_active_accounts_on_coming_back_the_next_week()
    {
        using var h = new TestHarness(Now);
        var back = Seed(h, "back@example.com");
        var once = Seed(h, "once@example.com");
        var transcriber = Seed(h, "transcriber@example.com");
        var gone = Seed(h, "gone@example.com");

        // The week of 2 November is the only one whose next week is over by the 20th.
        Days(h, back, D(11, 3), D(11, 10));
        Days(h, once, D(11, 4));
        Job(h, transcriber, Utc(11, 4, 10));
        Job(h, transcriber, Utc(11, 11, 10));
        Job(h, gone, Utc(11, 5, 10));
        h.Db.SaveChanges();

        var r = (await Read(h)).Retention;

        var week = Assert.Single(r.Weeks);
        Assert.Equal(new WeeklyReturnDto(D(11, 2), 2, 1, 2, 1), week);
        Assert.Equal((2, 1, 0.5), (r.PractiserWeeks, r.PractiserWeeksBack, r.PractiserRate));
        Assert.Equal((2, 1, 0.5), (r.OtherWeeks, r.OtherWeeksBack, r.OtherRate));
    }

    [Fact]
    public async Task Streaks_are_bucketed_at_the_windows_end_with_freezes_and_breaks_on_their_days()
    {
        using var h = new TestHarness(Now);
        var daily = Seed(h, "daily@example.com", "Ada Daily");
        var slipped = Seed(h, "slipped@example.com", "Bola Slipped");
        var single = Seed(h, "single@example.com");
        var before = Seed(h, "before@example.com");

        Days(h, daily, [.. Enumerable.Range(1, 15).Select(d => D(11, d))]);
        // Mon–Wed, Thursday frozen, Friday ends a 3-day streak; then Saturday 14th, Sunday 15th frozen.
        Days(h, slipped, D(11, 2), D(11, 3), D(11, 4), D(11, 14));
        // One day, Wednesday frozen, Thursday ends a 1-day run: not counted as a broken streak.
        Days(h, single, D(11, 10));
        // Fri–Sun before the window: Monday 2nd frozen, Tuesday 3rd ends a 3-day streak inside it.
        Days(h, before, D(10, 30), D(10, 31), D(11, 1));
        h.Db.SaveChanges();

        var d = await Read(h);
        var s = d.Streaks;

        Assert.Equal(D(11, 15), s.AsOf);
        int Bucket(string label) => s.Current.Single(b => b.Label == label).Count;
        Assert.Equal((1, 1, 0, 0, 1, 0), (Bucket("0"), Bucket("1"), Bucket("2–3"), Bucket("4–7"), Bucket("8–29"), Bucket("30+")));
        Assert.Equal(4, s.FreezesUsed);
        Assert.Equal(2, s.StreaksBroken);
        Assert.Equal([D(11, 2), D(11, 5), D(11, 11), D(11, 15)], d.Daily.Where(x => x.FreezesUsed > 0).Select(x => x.Date));
        Assert.Equal([D(11, 3), D(11, 6)], d.Daily.Where(x => x.StreaksBroken > 0).Select(x => x.Date));
        Assert.Equal([("Ada Daily", 15, 15), ("Bola Slipped", 1, 3)], s.Longest.Select(l => (l.FullName, l.Current, l.Best)));
    }

    [Fact]
    public async Task The_path_funnel_replays_each_singers_path_and_rates_the_takes_at_each_unit()
    {
        using var h = new TestHarness(Now);
        var steady = Seed(h, "steady@example.com");
        var playful = Seed(h, "playful@example.com");
        playful.ChoosePracticeTrack(PracticeTrack.Playful, Now);

        // Unit 1 passed in four, then unit 2: a miss, the retry passed, and two under 50 that step back.
        var steadyPath = new PathSinger(h, steady, null);
        steadyPath.Sing(D(11, 3), 85, 85, 85, 85, 60, 85, 30, 25);
        // Playful's first unit is three drills.
        var playfulPath = new PathSinger(h, playful, PracticeTrack.Playful);
        playfulPath.Sing(D(11, 4), 90, 80, 80);
        h.Db.SaveChanges();

        var d = await Read(h);

        var none = d.Path.Single(t => t.Track == "none");
        Assert.Equal((1, 8), (none.Singers, none.Takes));
        var grade1 = none.Grades[0];
        Assert.Equal(("Grade 1", 1, 0, 8), (grade1.Label, grade1.Reached, grade1.Completed, grade1.Takes));
        var unit1 = grade1.Units[0];
        Assert.Equal((1, 1, 1, 4), (unit1.UnitNumber, unit1.Reached, unit1.Completed, unit1.Takes));
        Assert.Equal((1.0, 0.0, 0.0, 85.0), (unit1.PassRate, unit1.RetryRate, unit1.StepBackRate, unit1.AverageScore));
        var unit2 = grade1.Units[1];
        Assert.Equal((2, 1, 0, 4), (unit2.UnitNumber, unit2.Reached, unit2.Completed, unit2.Takes));
        Assert.Equal((0.25, 0.5, 0.25, 50.0), (unit2.PassRate, unit2.RetryRate, unit2.StepBackRate, unit2.AverageScore));
        Assert.Equal(2, grade1.Units.Count); // units nobody reached are left out
        Assert.All(none.Grades.Skip(1), g => Assert.Equal(0, g.Reached));

        var gentle = d.Path.Single(t => t.Track == "playful");
        Assert.Equal((1, 3), (gentle.Singers, gentle.Takes));
        Assert.Equal((1, 1), (gentle.Grades[0].Units[0].Completed, gentle.Grades[0].Units[1].Reached));
        Assert.Equal(0, d.Path.Single(t => t.Track == "focused").Singers);

        // Each singer's first unit, on the day the take that finished it was sung.
        Assert.Equal(1, d.Daily.Single(x => x.Date == D(11, 3)).UnitsCompleted);
        Assert.Equal(1, d.Daily.Single(x => x.Date == D(11, 4)).UnitsCompleted);
        Assert.Equal(0, d.Daily.Sum(x => x.GradesCompleted));
    }

    [Fact]
    public async Task The_daily_limit_is_ten_drills_free_and_twenty_on_Pro_and_free_hitters_who_buy_within_a_week_convert()
    {
        using var h = new TestHarness(Now);
        var monthly = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "NoteFusion Pro (Monthly)", 999, "USD", BillingInterval.Monthly);
        var single = Plan.Create(Guid.NewGuid(), "single_usd", "One song", 199, "USD", BillingInterval.Single);
        h.Db.Plans.AddRange(monthly, single);

        var buyer = Seed(h, "buyer@example.com");
        var slow = Seed(h, "slow@example.com");
        var recent = Seed(h, "recent@example.com");
        var pro = Seed(h, "pro@example.com");
        var light = Seed(h, "light@example.com");
        h.Db.Subscriptions.Add(Subscription.Start(pro.Id, monthly.Id, PaymentProvider.Bachs, Utc(10, 1, 0), Utc(12, 1, 0), null, Utc(10, 1, 0)));

        Drills(h, buyer, D(11, 5), 10);
        Drills(h, slow, D(11, 6), 10);
        Drills(h, recent, D(11, 14), 10);   // its seven days are not over on the 20th
        Drills(h, pro, D(11, 5), 10);        // Pro: ten is not its limit
        Drills(h, pro, D(11, 6), 20);        // twenty is
        Drills(h, light, D(11, 7), 5);
        Pay(h, buyer, monthly, Utc(11, 8, 9));    // three days after the hit
        Pay(h, slow, single, Utc(11, 20, 9));     // fourteen days after: too late to count
        h.Db.SaveChanges();

        var a = (await Read(h)).Allowance;

        Assert.Equal((10, 20), (a.FreeLimit, a.ProLimit));
        Assert.Equal(5, a.DrillSingers);
        Assert.Equal((4, 3, 1, 4), (a.HitLimit, a.HitFreeLimit, a.HitProLimit, a.LimitDays));
        Assert.Equal((3, 2), (a.FreeHitters, a.FreeHittersDecided));
        Assert.Equal((1, 1, 0), (a.Bought, a.BoughtMembership, a.BoughtSingle));
        Assert.Equal(0.5, a.ConversionRate);
    }

    [Fact]
    public async Task A_reminder_converts_when_a_take_follows_within_two_hours_or_the_same_local_day()
    {
        using var h = new TestHarness(Now);
        var quick = Seed(h, "quick@example.com");
        var slow = Seed(h, "slow@example.com");
        var late = Seed(h, "late@example.com");
        var earlyBird = Seed(h, "early@example.com");
        var failed = Seed(h, "failed@example.com");
        var returned = Seed(h, "returned@example.com");
        var silent = Seed(h, "silent@example.com");

        // 19:00 in Lagos; a take at 1h59 converts on both counts, one at 2h01 only on the day.
        Remind(h, quick, D(11, 5), PracticeReminderKind.StreakAtRisk, Utc(11, 5, 18));
        Take(h, quick, PracticeKind.Drill, 80, D(11, 5), Utc(11, 5, 19, 59));
        Remind(h, slow, D(11, 5), PracticeReminderKind.Ordinary, Utc(11, 5, 18));
        Take(h, slow, PracticeKind.Drill, 80, D(11, 5), Utc(11, 5, 20, 1));
        // A late "last chance" at 21:45 and a take 1h45 later, past midnight: within two hours, but the next day.
        Remind(h, late, D(11, 6), PracticeReminderKind.LastChance, Utc(11, 6, 20, 45));
        Take(h, late, PracticeKind.Drill, 80, D(11, 7), Utc(11, 6, 22, 30));
        // A take before the reminder does not count for it.
        Take(h, earlyBird, PracticeKind.Drill, 80, D(11, 8), Utc(11, 8, 17));
        Remind(h, earlyBird, D(11, 8), PracticeReminderKind.Ordinary, Utc(11, 8, 18));
        Remind(h, failed, D(11, 9), PracticeReminderKind.Ordinary, null);
        // "We'll stop reminding you": one came back afterwards, one did not.
        Remind(h, returned, D(11, 2), PracticeReminderKind.Final, Utc(11, 2, 18));
        Take(h, returned, PracticeKind.Part, 70, D(11, 18), Utc(11, 18, 18));
        Remind(h, silent, D(11, 3), PracticeReminderKind.Final, Utc(11, 3, 18));

        // The switch: one turned off, one on by having practised.
        silent.SetPracticeReminders(false, null, null, Now);
        // Phones: two on the new reminder code, one not; a browser is not a phone.
        quick.RegisterDeviceToken("ExponentPushToken[a]", "android", 30, Now, serverReminders: true);
        slow.RegisterDeviceToken("ExponentPushToken[b]", "ios", 30, Now, serverReminders: true);
        late.RegisterDeviceToken("ExponentPushToken[c]", "android", 28, Now);
        late.RegisterDeviceToken("web-endpoint", "web", 0, Now);
        h.Db.SaveChanges();

        var r = (await Read(h)).Reminders;

        Assert.Equal((6, 1, 0), (r.Sent, r.Failed, r.Pending));
        Assert.Equal(6, r.AccountsReminded);
        Assert.Equal((2, 2), (r.PractisedWithin2h, r.PractisedSameDay));
        ReminderKindStatDto Kind(PracticeReminderKind k) => r.Kinds.Single(x => x.Kind == k);
        Assert.Equal((1, 1, 1), (Kind(PracticeReminderKind.StreakAtRisk).Sent, Kind(PracticeReminderKind.StreakAtRisk).PractisedWithin2h, Kind(PracticeReminderKind.StreakAtRisk).PractisedSameDay));
        Assert.Equal((2, 0, 1, 1), (Kind(PracticeReminderKind.Ordinary).Sent, Kind(PracticeReminderKind.Ordinary).PractisedWithin2h, Kind(PracticeReminderKind.Ordinary).PractisedSameDay, Kind(PracticeReminderKind.Ordinary).Failed));
        Assert.Equal((0.0, 0.5), (Kind(PracticeReminderKind.Ordinary).Within2hRate, Kind(PracticeReminderKind.Ordinary).SameDayRate));
        Assert.Equal((1, 0), (Kind(PracticeReminderKind.LastChance).PractisedWithin2h, Kind(PracticeReminderKind.LastChance).PractisedSameDay));
        Assert.Null(Kind(PracticeReminderKind.FreezeReady).Within2hRate);
        Assert.Equal((2, 1), (r.FinalSent, r.FinalCameBack));
        Assert.Equal(2, r.Daily.Single(x => x.Date == D(11, 5)).Ordinary + r.Daily.Single(x => x.Date == D(11, 5)).StreakAtRisk);
        Assert.Equal(1, r.Daily.Single(x => x.Date == D(11, 9)).Failed);
        Assert.Equal(1, r.RemindersOff);
        Assert.Equal(6, r.RemindersApplicable);       // the five who practised, and the one who switched off
        Assert.Equal((3, 2), (r.Phones, r.PhonesOnServerReminders));
    }

    [Fact]
    public async Task Badges_are_counted_in_the_window_and_ever_by_code()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "a@example.com");
        var b = Seed(h, "b@example.com");
        var c = Seed(h, "c@example.com");
        var staff = Seed(h, "staff@example.com");
        staff.SetInternal(true);
        h.Db.Achievements.Add(Achievement.Award(a.Id, "first_drill", Utc(11, 3, 18)));
        h.Db.Achievements.Add(Achievement.Award(b.Id, "first_drill", Utc(11, 4, 18)));
        h.Db.Achievements.Add(Achievement.Award(c.Id, "first_drill", Utc(10, 4, 18)));
        h.Db.Achievements.Add(Achievement.Award(a.Id, "streak_3", Utc(11, 5, 18)));
        h.Db.Achievements.Add(Achievement.Award(staff.Id, "first_drill", Utc(11, 5, 18)));
        h.Db.SaveChanges();

        var d = await Read(h);

        var first = d.Badges.Single(x => x.Code == "first_drill");
        Assert.Equal(("First drill", 2, 3), (first.Title, first.EarnedInWindow, first.EarnedAllTime));
        Assert.Equal((1, 1), (d.Badges.Single(x => x.Code == "streak_3").EarnedInWindow, d.Badges.Single(x => x.Code == "streak_3").EarnedAllTime));
        Assert.Equal(3, d.Daily.Sum(x => x.BadgesEarned));
        Assert.Equal(1, d.Daily.Single(x => x.Date == D(11, 5)).BadgesEarned);
    }

    // ── Seeding ─────────────────────────────────────────────────────────────

    private static User Seed(TestHarness h, string email, string name = "Singer")
    {
        var user = User.Create(name, email, "hash", Utc(9, 1, 9));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void Take(TestHarness h, User user, PracticeKind kind, int score, DateOnly day, DateTime at, string? drillId = null)
        => h.Db.PracticeSessions.Add(PracticeSession.Record(
            user.Id, kind, score, 3, 0, 0, 0, 6, at, day, drillId: kind == PracticeKind.Drill ? drillId ?? "steps-up@60" : null));

    /// <summary>One drill a day on each of <paramref name="days"/>, at 19:00 Lagos.</summary>
    private static void Days(TestHarness h, User user, params DateOnly[] days)
    {
        foreach (var day in days)
            Take(h, user, PracticeKind.Drill, 80, day, day.ToDateTime(new TimeOnly(18, 0), DateTimeKind.Utc));
    }

    private static void Drills(TestHarness h, User user, DateOnly day, int count)
    {
        for (var i = 0; i < count; i++)
            Take(h, user, PracticeKind.Drill, 85, day, day.ToDateTime(new TimeOnly(18, i), DateTimeKind.Utc));
    }

    private static void Job(TestHarness h, User user, DateTime at)
        => h.Db.TranscriptionJobs.Add(TranscriptionJob.Record($"job-{Guid.NewGuid():N}", user.Id, at));

    private static void Pay(TestHarness h, User user, Plan plan, DateTime at)
    {
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Bachs, $"checkout:{reference}", reference, plan.AmountMinor, plan.Currency, at.AddMinutes(-5));
        tx.AttachCheckout("ps_" + reference, "https://checkout.example/" + reference, null, at.AddMinutes(-4));
        tx.MarkVerified("ps_" + reference, null, at);
        tx.MarkCompleted(at);
        h.Db.PaymentTransactions.Add(tx);
    }

    /// <summary>A reminder claimed on <paramref name="day"/>: sent at <paramref name="sentAt"/>, or failed when null.</summary>
    private static void Remind(TestHarness h, User user, DateOnly day, PracticeReminderKind kind, DateTime? sentAt)
    {
        var claimed = sentAt ?? day.ToDateTime(new TimeOnly(18, 0), DateTimeKind.Utc);
        var slot = kind == PracticeReminderKind.LastChance ? PracticeReminderSlot.LastChance : PracticeReminderSlot.Daily;
        var reminder = PracticeReminder.Claim(user.Id, day, slot, kind, 2, "Title", "Body", true, 1, claimed);
        if (sentAt is { } at)
            reminder.MarkSent(1, at);
        else
            reminder.MarkFailed(1, "Expo said no");
        h.Db.PracticeReminders.Add(reminder);
    }

    /// <summary>A singer who sings the drill their path offers next, as the app would hand it to them.</summary>
    private sealed class PathSinger(TestHarness h, User user, PracticeTrack? track)
    {
        private readonly List<PathTake> _takes = [];
        private readonly List<PracticeFact> _facts = [];

        public void Sing(DateOnly day, params int[] scores)
        {
            var minute = 0;
            foreach (var score in scores)
            {
                var at = day.ToDateTime(new TimeOnly(17, 0), DateTimeKind.Utc).AddMinutes(++minute);
                var reading = PracticePath.Read(user.Id, _takes, t => PracticeMath.LevelFor(PracticeMath.TotalXp(_facts.Where(f => f.CreatedAtUtc < t))).Index);
                var level = PracticeMath.LevelFor(PracticeMath.TotalXp(_facts)).Index;
                var drill = PracticePath.Next(user.Id, track, reading, level).Drill;
                var session = PracticeSession.Record(user.Id, PracticeKind.Drill, score, 3, 0, 0, 0, 6, at, day, drillId: drill.Id);
                h.Db.PracticeSessions.Add(session);
                _takes.Add(new PathTake(session.Id, drill.Id, score, at, day));
                _facts.Add(new PracticeFact(PracticeKind.Drill, score, false, day, at));
            }
        }
    }
}
