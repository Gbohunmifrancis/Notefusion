using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Devices.Commands;
using NoteFusion.Application.Practice;
using NoteFusion.Application.Practice.Commands;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Practice.Queries;
using NoteFusion.Application.Practice.Reminders;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Practice;
using NoteFusion.Infrastructure.Push;
using NoteFusion.Tests.Support;
using NSubstitute;

namespace NoteFusion.Tests.Practice;

/// <summary>
/// Practice reminders, pushed to phones: the Duolingo-style schedule on the singer's own clock (Lagos, London,
/// Los Angeles, Kolkata), the decaying schedule and its stop, quiet hours, two a day at most, the freeze, a practice
/// resetting everything, idempotent claims and the one retry, opt-outs and channels (phones on new app code only,
/// never web push), sound, the words' length, and GET/PUT /api/practice/reminders.
/// </summary>
public class PracticeReminderTests
{
    private static readonly IReadOnlyDictionary<PracticeReminderSlot, DateTime> Nothing =
        new Dictionary<PracticeReminderSlot, DateTime>();

    private static DateOnly D(string day) => DateOnly.ParseExact(day, "yyyy-MM-dd", CultureInfo.InvariantCulture);
    private static DateTime At(string day, int hour, int minute = 0) => D(day).ToDateTime(new TimeOnly(hour, minute));
    private static DateTime Utc(string day, int hour, int minute = 0) => DateTime.SpecifyKind(At(day, hour, minute), DateTimeKind.Utc);

    private static ReminderAccount Practised(params string[] days)
        => new(days.Select(D).ToHashSet(), null, D("2026-01-01"), null);

    private static IReadOnlyDictionary<PracticeReminderSlot, DateTime> Claimed(params (PracticeReminderSlot Slot, DateTime At)[] claims)
        => claims.ToDictionary(c => c.Slot, c => c.At);

    // Practised Monday 5 to Friday 9 October 2026: a five-day streak with the week's freeze unused.
    private static readonly string[] WorkWeek = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];

    // ── The schedule ─────────────────────────────────────────────────────────

    [Fact]
    public void A_lapsed_singer_is_reminded_on_days_1_2_3_5_7_14_30_then_told_once_that_we_stop()
    {
        var once = Practised("2026-10-05"); // a Monday, one take
        var heard = new SortedDictionary<int, PracticeReminderKind>();
        for (var gap = 1; gap <= 90; gap++)
        {
            var day = D("2026-10-05").AddDays(gap).ToDateTime(new TimeOnly(19, 5));
            if (PracticeReminderRules.Due(once, day, Nothing) is { } due)
                heard[gap] = due.Kind;
        }

        Assert.Equal([1, 2, 3, 5, 7, 14, 30, 45], heard.Keys);
        // Day 1 the one-day streak is alive; day 2 the week's freeze still bridges Tuesday. Then the decay.
        Assert.Equal(PracticeReminderKind.Ordinary, heard[1]);
        Assert.Equal(PracticeReminderKind.Ordinary, heard[2]);
        Assert.All([3, 5, 7, 14, 30], gap => Assert.Equal(PracticeReminderKind.LearningWaiting, heard[gap]));
        Assert.Equal(PracticeReminderKind.Final, heard[45]);
        Assert.Equal([1, 2, 3, 5, 7, 14, 30], PracticeReminderRules.DecayDays);
    }

    [Fact]
    public void A_streak_gets_the_freeze_line_then_at_risk_and_last_chance_then_slipped()
    {
        var week = Practised(WorkWeek);

        // Saturday: the week's freeze would carry today, so it says so, and there is no last chance tonight.
        var saturday = PracticeReminderRules.Due(week, At("2026-10-10", 19), Nothing);
        Assert.Equal(new DueReminder(PracticeReminderSlot.Daily, PracticeReminderKind.FreezeReady, 5), saturday);
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-10", 21, 30), Claimed((PracticeReminderSlot.Daily, At("2026-10-10", 19)))));

        // Sunday: Saturday used the freeze, so today really ends it: at risk at 19:00, last chance at 21:30.
        Assert.Equal(new DueReminder(PracticeReminderSlot.Daily, PracticeReminderKind.StreakAtRisk, 5),
            PracticeReminderRules.Due(week, At("2026-10-11", 19), Nothing));
        var daily = Claimed((PracticeReminderSlot.Daily, At("2026-10-11", 19)));
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-11", 21, 29), daily));
        Assert.Equal(new DueReminder(PracticeReminderSlot.LastChance, PracticeReminderKind.LastChance, 5),
            PracticeReminderRules.Due(week, At("2026-10-11", 21, 30), daily));
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-11", 21, 40),
            Claimed((PracticeReminderSlot.Daily, At("2026-10-11", 19)), (PracticeReminderSlot.LastChance, At("2026-10-11", 21, 30)))));

        // Monday: it ended at midnight. Then the decay from Friday's practice: nothing Tuesday (4), Wednesday (5).
        Assert.Equal(new DueReminder(PracticeReminderSlot.Daily, PracticeReminderKind.StreakLost, 5),
            PracticeReminderRules.Due(week, At("2026-10-12", 19), Nothing));
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-13", 19), Nothing));
        Assert.Equal(PracticeReminderKind.LearningWaiting, PracticeReminderRules.Due(week, At("2026-10-14", 19), Nothing)!.Kind);
    }

    [Fact]
    public void Nothing_before_the_hour_on_a_day_practised_or_in_the_quiet_hours()
    {
        var week = Practised(WorkWeek);

        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-11", 18, 59), Nothing));
        Assert.Null(PracticeReminderRules.Due(Practised([.. WorkWeek, "2026-10-11"]), At("2026-10-11", 21, 30), Nothing));

        // A run that missed the whole evening sends nothing once the quiet hours start, nor before they end.
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-11", 22, 0), Nothing));
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-11", 23, 50), Nothing));
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-11", 7, 59), Nothing));

        Assert.False(PracticeReminderRules.IsQuiet(new TimeOnly(21, 59)));
        Assert.True(PracticeReminderRules.IsQuiet(new TimeOnly(22, 0)));
        Assert.True(PracticeReminderRules.IsQuiet(new TimeOnly(7, 59)));
        Assert.False(PracticeReminderRules.IsQuiet(new TimeOnly(8, 0)));
    }

    [Fact]
    public void A_late_first_reminder_means_no_last_chance_and_never_more_than_two()
    {
        // The singer's hour is 21:00: the last chance would follow half an hour later, so it does not.
        var late = Practised(WorkWeek) with { Hour = 21 };
        Assert.Equal(PracticeReminderKind.StreakAtRisk, PracticeReminderRules.Due(late, At("2026-10-11", 21), Nothing)!.Kind);
        Assert.Null(PracticeReminderRules.Due(late, At("2026-10-11", 21, 35), Claimed((PracticeReminderSlot.Daily, At("2026-10-11", 21)))));

        // The worker was down until 21:40: the last chance goes alone, and the daily one is not sent after it.
        var week = Practised(WorkWeek);
        Assert.Equal(PracticeReminderSlot.LastChance, PracticeReminderRules.Due(week, At("2026-10-11", 21, 40), Nothing)!.Slot);
        Assert.Null(PracticeReminderRules.Due(week, At("2026-10-11", 21, 50), Claimed((PracticeReminderSlot.LastChance, At("2026-10-11", 21, 40)))));

        Assert.Equal(2, PracticeReminderRules.MaxPerDay);
        Assert.Equal(19, PracticeReminderRules.HourOf(null));
        Assert.Equal(8, PracticeReminderRules.HourOf(3));
        Assert.Equal(21, PracticeReminderRules.HourOf(23));
    }

    [Fact]
    public void A_practice_resets_the_schedule()
    {
        // Lapsed 44 days, then a take: the next day is an ordinary streak day, not the final "we'll stop".
        var lapsed = Practised("2026-08-01");
        Assert.Null(PracticeReminderRules.Due(lapsed, At("2026-09-14", 19), Nothing)); // day 44
        Assert.Equal(PracticeReminderKind.Final, PracticeReminderRules.Due(lapsed, At("2026-09-15", 19), Nothing)!.Kind);

        var back = Practised("2026-08-01", "2026-09-14");
        Assert.Equal(PracticeReminderKind.Ordinary, PracticeReminderRules.Due(back, At("2026-09-15", 19), Nothing)!.Kind);
        // ...and the decay counts from the new take: day 45 after it is the final one again, not day 45 after the old.
        Assert.Equal(PracticeReminderKind.Final, PracticeReminderRules.Due(back, At("2026-10-29", 19), Nothing)!.Kind);

        // Switching reminders back on restarts it too: a month-old lapse is reminded the next day.
        var switchedOn = Practised("2026-08-01") with { Since = D("2026-10-01") };
        Assert.Equal(PracticeReminderKind.LearningWaiting, PracticeReminderRules.Due(switchedOn, At("2026-10-02", 19), Nothing)!.Kind);
    }

    [Fact]
    public void Someone_who_never_practised_is_reminded_from_when_reminders_started()
    {
        var chose = new ReminderAccount(new HashSet<DateOnly>(), D("2026-10-10"), D("2025-01-01"), null);
        Assert.Null(PracticeReminderRules.Due(chose, At("2026-10-10", 19), Nothing));
        Assert.Equal(PracticeReminderKind.LearningWaiting, PracticeReminderRules.Due(chose, At("2026-10-11", 19), Nothing)!.Kind);
        Assert.Equal(PracticeReminderKind.Final, PracticeReminderRules.Due(chose, At("2026-11-24", 19), Nothing)!.Kind);

        Assert.True(PracticeReminderRules.IsOn(null, hasPractised: true, hasTrack: false));
        Assert.True(PracticeReminderRules.IsOn(null, hasPractised: false, hasTrack: true));
        Assert.False(PracticeReminderRules.IsOn(null, hasPractised: false, hasTrack: false));
        Assert.False(PracticeReminderRules.IsOn(false, hasPractised: true, hasTrack: true));
    }

    // ── Time zones (the sweep, on a UTC clock) ───────────────────────────────

    [Theory]
    [InlineData("Africa/Lagos", "2026-10-17", 18, 0)]          // WAT, UTC+1
    [InlineData(null, "2026-10-17", 18, 0)]                    // no zone stored: Lagos
    [InlineData("Europe/London", "2026-10-17", 18, 0)]         // BST, UTC+1
    [InlineData("Europe/London", "2026-10-27", 19, 0, "2026-10-26")] // GMT after the clocks go back
    [InlineData("America/Los_Angeles", "2026-10-18", 2, 0)]    // PDT, UTC-7: still the 17th there
    [InlineData("Asia/Kolkata", "2026-10-17", 13, 30)]         // IST, UTC+5:30
    public async Task The_reminder_goes_at_seven_in_the_evening_on_the_singers_own_clock(
        string? zone, string utcDay, int utcHour, int utcMinute, string practisedOn = "2026-10-16")
    {
        using var h = new TestHarness(Utc(utcDay, utcHour, utcMinute).AddMinutes(-1));
        var singer = Singer(h, "zone@example.com", zone, practisedOn);
        var localToday = D(practisedOn).AddDays(1);

        Assert.Empty(await Service(h).FindDueAsync(10, default));

        h.Clock.UtcNow = Utc(utcDay, utcHour, utcMinute);
        var due = Assert.Single(await Service(h).FindDueAsync(10, default));
        Assert.Equal((singer, localToday, PracticeReminderKind.Ordinary), (due.UserId, due.LocalDate, due.Due.Kind));

        Assert.Equal(1, await Run(h));
        var row = h.Db.PracticeReminders.AsNoTracking().Single();
        Assert.Equal((localToday, PracticeReminderSlot.Daily, PracticeReminderStatus.Sent), (row.LocalDate, row.Slot, row.Status));
    }

    [Fact]
    public async Task A_whole_day_of_ten_minute_sweeps_sends_the_evening_reminder_and_the_last_chance_and_no_more()
    {
        // Sunday 11 October in Lagos, a five-day streak whose freeze was spent on Saturday.
        using var h = new TestHarness(Utc("2026-10-10", 23, 0)); // 00:00 WAT
        Singer(h, "streak@example.com", "Africa/Lagos", WorkWeek);

        var sent = 0;
        for (var t = Utc("2026-10-10", 23, 0); t < Utc("2026-10-11", 23, 0); t = t.AddMinutes(10))
        {
            h.Clock.UtcNow = t;
            sent += await Run(h);
        }

        Assert.Equal(2, sent);
        var rows = h.Db.PracticeReminders.AsNoTracking().OrderBy(r => r.CreatedAtUtc).ToList();
        Assert.Equal(
            [(PracticeReminderSlot.Daily, PracticeReminderKind.StreakAtRisk, Utc("2026-10-11", 18, 0)),
             (PracticeReminderSlot.LastChance, PracticeReminderKind.LastChance, Utc("2026-10-11", 20, 30))],
            rows.Select(r => (r.Slot, r.Kind, r.CreatedAtUtc)));
        Assert.All(rows, r => Assert.Equal(D("2026-10-11"), r.LocalDate));
        Assert.Equal(2, h.Push.DeviceSends.Count);
        Assert.Contains("midnight", h.Push.DeviceSends[0].Message.Title + h.Push.DeviceSends[0].Message.Body);
    }

    // ── Idempotency and retries ──────────────────────────────────────────────

    [Fact]
    public async Task Two_sweeps_claiming_the_same_reminder_send_it_once()
    {
        using var h = new TestHarness(Utc("2026-10-17", 18, 5));
        Singer(h, "ada@example.com", "Africa/Lagos", "2026-10-16");

        var candidate = Assert.Single(await Service(h).FindDueAsync(10, default));
        Assert.True(await Service(h).SendAsync(candidate, default));
        Assert.False(await Service(h).SendAsync(candidate, default)); // the second sweep's insert hits the unique claim

        h.Clock.UtcNow = Utc("2026-10-17", 18, 15);
        Assert.Equal(0, await Run(h));
        Assert.Single(h.Push.DeviceSends);
        Assert.Single(h.Db.PracticeReminders.AsNoTracking());
    }

    [Fact]
    public async Task A_failed_send_is_retried_once_with_the_same_words_and_never_a_third_time()
    {
        using var h = new TestHarness(Utc("2026-10-17", 18, 5));
        Singer(h, "ada@example.com", "Africa/Lagos", "2026-10-16");
        h.Push.DeviceOutcome = PushDelivery.Failed("Expo push returned 500.");

        Assert.Equal(1, await Run(h));
        var row = h.Db.PracticeReminders.AsNoTracking().Single();
        Assert.Equal((PracticeReminderStatus.Failed, 1, "Expo push returned 500."), (row.Status, row.Attempts, row.Error));

        h.Clock.UtcNow = Utc("2026-10-17", 18, 15);
        Assert.Equal(1, await Run(h)); // the retry, still failing
        row = h.Db.PracticeReminders.AsNoTracking().Single();
        Assert.Equal((PracticeReminderStatus.Failed, 2), (row.Status, row.Attempts));

        h.Push.DeviceOutcome = null;
        h.Clock.UtcNow = Utc("2026-10-17", 18, 25);
        Assert.Equal(0, await Run(h));
        Assert.Equal(2, h.Push.DeviceSends.Count);
        Assert.Equal(
            (h.Push.DeviceSends[0].Message.Title, h.Push.DeviceSends[0].Message.Body),
            (h.Push.DeviceSends[1].Message.Title, h.Push.DeviceSends[1].Message.Body));
    }

    [Fact]
    public async Task A_retry_that_succeeds_is_marked_sent_and_one_after_a_practice_is_not_sent()
    {
        using var h = new TestHarness(Utc("2026-10-17", 18, 5));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos", "2026-10-16");
        var bob = Singer(h, "bob@example.com", "Africa/Lagos", "2026-10-16");
        h.Push.DeviceOutcome = PushDelivery.Failed("timeout");
        Assert.Equal(2, await Run(h));

        // Bob practises before the retry: his is closed unsent. Ada's goes through.
        Take(h, bob, "2026-10-17");
        h.Push.DeviceOutcome = null;
        h.Clock.UtcNow = Utc("2026-10-17", 18, 15);
        Assert.Equal(1, await Run(h));

        var rows = h.Db.PracticeReminders.AsNoTracking().ToDictionary(r => r.UserId);
        Assert.Equal((PracticeReminderStatus.Sent, 2, (string?)null), (rows[ada].Status, rows[ada].Attempts, rows[ada].Error));
        Assert.Equal(Utc("2026-10-17", 18, 15), rows[ada].SentAtUtc);
        Assert.Equal((PracticeReminderStatus.Failed, "Not retried: practised since."), (rows[bob].Status, rows[bob].Error));
        Assert.Equal(3, h.Push.DeviceSends.Count);
    }

    [Fact]
    public async Task An_open_push_breaker_stops_the_run_before_anything_is_claimed()
    {
        using var h = new TestHarness(Utc("2026-10-17", 18, 5));
        Singer(h, "ada@example.com", "Africa/Lagos", "2026-10-16");
        var health = Substitute.For<IProviderHealth>();
        health.IsUnavailable(OutboundProviders.Push).Returns(true);

        Assert.Equal(0, await Run(h, health: health));
        Assert.Empty(h.Db.PracticeReminders);
        Assert.Empty(h.Push.DeviceSends);
    }

    // ── Who is reminded, and where ───────────────────────────────────────────

    [Fact]
    public async Task Switched_off_never_asked_and_unreachable_accounts_get_nothing_and_leave_no_row()
    {
        using var h = new TestHarness(Utc("2026-10-17", 18, 5));
        var off = Singer(h, "off@example.com", "Africa/Lagos", "2026-10-16");
        h.Db.Users.Single(u => u.Id == off).SetPracticeReminders(false, null, null, h.Clock.UtcNow);
        Singer(h, "never@example.com", "Africa/Lagos"); // never practised, no track: never asked for it
        Singer(h, "nophone@example.com", "Africa/Lagos", ["2026-10-16"], device: null); // push switched off: unregistered
        Singer(h, "oldapp@example.com", "Africa/Lagos", ["2026-10-16"], device: false); // still schedules its own
        var webOnly = Singer(h, "web@example.com", "Africa/Lagos", ["2026-10-16"], device: null);
        h.Db.WebPushSubscriptions.Add(WebPushSubscription.Create(
            webOnly, "https://fcm.googleapis.com/fcm/send/web", Push.WebPushTests.BrowserKey, Push.WebPushTests.BrowserAuth, null, h.Clock.UtcNow));
        h.Db.SaveChanges();

        Assert.Equal(0, await Run(h));
        Assert.Empty(h.Db.PracticeReminders);
        Assert.Empty(h.Push.DeviceSends);
        Assert.Empty(h.WebPush.Sent);
    }

    [Fact]
    public async Task Only_the_phones_on_new_app_code_are_reminded_never_the_web_push_subscriptions()
    {
        using var h = new TestHarness(Utc("2026-10-17", 18, 5));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos", "2026-10-16");
        var user = h.Db.Users.Include(u => u.DeviceTokens).Single(u => u.Id == ada);
        user.RegisterDeviceToken("ExponentPushToken[tablet-old-app]", "android", 30, h.Clock.UtcNow, serverReminders: false);
        h.Db.WebPushSubscriptions.Add(WebPushSubscription.Create(
            ada, "https://fcm.googleapis.com/fcm/send/ada", Push.WebPushTests.BrowserKey, Push.WebPushTests.BrowserAuth, null, h.Clock.UtcNow));
        h.Db.SaveChanges();

        Assert.Equal(1, await Run(h));
        var (tokens, _) = Assert.Single(h.Push.DeviceSends);
        Assert.Equal([PhoneToken(ada)], tokens);
        Assert.Empty(h.WebPush.Sent);
        Assert.Empty(h.Push.Sent); // nothing by user id either, which would reach the old-app tablet
        Assert.Equal(1, h.Db.PracticeReminders.AsNoTracking().Single().Devices);
    }

    [Fact]
    public async Task Choosing_a_track_turns_reminders_on_from_the_next_day()
    {
        using var h = new TestHarness(Utc("2026-10-16", 10, 0));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos");
        await new SetPracticeTrackCommandHandler(h.Db, new StubCurrentUser(ada), h.Clock, new StubClientTimeZone())
            .Handle(new SetPracticeTrackCommand("focused"), default);

        h.Clock.UtcNow = Utc("2026-10-16", 18, 5);
        Assert.Equal(0, await Run(h)); // the day it was chosen
        h.Clock.UtcNow = Utc("2026-10-17", 18, 5);
        Assert.Equal(1, await Run(h));
        var row = h.Db.PracticeReminders.AsNoTracking().Single();
        Assert.Equal(PracticeReminderKind.LearningWaiting, row.Kind);
        // Focused reads plainly: no Doh, no emoji.
        Assert.Contains(PracticeReminderCopy.Plain[PracticeReminderKind.LearningWaiting], t => t.Title == row.Title && t.Body == row.Body);
    }

    [Fact]
    public async Task Practising_before_the_hour_cancels_the_days_reminder()
    {
        using var h = new TestHarness(Utc("2026-10-17", 17, 0));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos", WorkWeek);
        Take(h, ada, "2026-10-17");

        h.Clock.UtcNow = Utc("2026-10-17", 18, 5);
        Assert.Equal(0, await Run(h));
        h.Clock.UtcNow = Utc("2026-10-17", 20, 35);
        Assert.Equal(0, await Run(h));
    }

    // ── What it says, and how it sounds ──────────────────────────────────────

    [Fact]
    public async Task The_freeze_day_says_the_freeze_is_ready_and_never_that_the_streak_ends()
    {
        using var h = new TestHarness(Utc("2026-10-10", 18, 5)); // Saturday, Lagos
        Singer(h, "ada@example.com", "Africa/Lagos", WorkWeek);

        Assert.Equal(1, await Run(h));
        var message = Assert.Single(h.Push.DeviceSends).Message;
        Assert.Contains("freeze", (message.Title + message.Body).ToLowerInvariant());
        Assert.DoesNotContain("midnight", message.Title + message.Body);

        foreach (var voice in new[] { PracticeReminderCopy.Playful, PracticeReminderCopy.Plain })
        {
            Assert.All(voice[PracticeReminderKind.FreezeReady], t => Assert.Contains("freeze", (t.Title + t.Body).ToLowerInvariant()));
            Assert.All(voice[PracticeReminderKind.StreakAtRisk].Concat(voice[PracticeReminderKind.LastChance]),
                t => Assert.Matches("midnight|tonight", t.Title + t.Body));
        }
    }

    [Theory]
    [InlineData(true, "default", PracticeReminderService.AndroidChannel)]
    [InlineData(false, null, PracticeReminderService.AndroidQuietChannel)]
    public async Task The_push_sounds_unless_the_apps_sound_is_off_opens_Practice_and_expires_at_the_quiet_hours(
        bool sound, string? iosSound, string channel)
    {
        using var h = new TestHarness(Utc("2026-10-17", 18, 5));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos", "2026-10-16");
        h.Db.Users.Single(u => u.Id == ada).SetPracticeReminders(null, null, sound, h.Clock.UtcNow);
        h.Db.SaveChanges();

        Assert.Equal(1, await Run(h));
        var message = Assert.Single(h.Push.DeviceSends).Message;
        Assert.Equal((iosSound, channel), (message.Sound, message.ChannelId));
        Assert.Equal("Practice", message.Data!["screen"]);
        // 19:05 in Lagos: held for an offline phone until 22:00 and no later.
        Assert.Equal((int)TimeSpan.FromMinutes(175).TotalSeconds, message.TimeToLiveSeconds);
        Assert.Equal(sound, h.Db.PracticeReminders.AsNoTracking().Single().Sound);
    }

    [Fact]
    public void Every_variant_fits_a_phone_notification_with_any_streak_and_each_situation_has_several()
    {
        var tracks = new PracticeTrack?[] { PracticeTrack.Playful, PracticeTrack.Focused, null };
        foreach (var kind in Enum.GetValues<PracticeReminderKind>())
        {
            foreach (var track in tracks)
            {
                var variants = PracticeReminderCopy.VariantsFor(kind, track);
                Assert.True(variants.Count >= 2, $"{kind} ({track}) has {variants.Count} variant(s)");
                for (var i = 0; i < variants.Count; i++)
                {
                    foreach (var streak in new[] { 0, 1, 2, 9, 99, 999, 9999 })
                    {
                        var text = PracticeReminderCopy.For(kind, track, streak, i);
                        Assert.True(text.Title.Length <= PracticeReminderCopy.MaxTitleLength, $"{kind} title too long: {text.Title}");
                        Assert.True(text.Body.Length <= PracticeReminderCopy.MaxBodyLength, $"{kind} body too long: {text.Body}");
                        Assert.DoesNotContain("{", text.Title + text.Body);
                        Assert.True(text.Title.Length <= PracticeReminder.TitleMaxLength && text.Body.Length <= PracticeReminder.BodyMaxLength);
                    }
                }

                // Consecutive days read differently.
                Assert.NotEqual(PracticeReminderCopy.For(kind, track, 6, 10), PracticeReminderCopy.For(kind, track, 6, 11));
            }
        }

        Assert.Equal(50, PracticeReminderCopy.MaxTitleLength);
        Assert.Equal(120, PracticeReminderCopy.MaxBodyLength);
        Assert.All(PracticeReminderCopy.Playful[PracticeReminderKind.Final].Concat(PracticeReminderCopy.Plain[PracticeReminderKind.Final]),
            t => Assert.StartsWith("We'll stop reminding you; Practice is here when you want it.", t.Body));
        Assert.Equal("🔥 Your 6-day streak ends at midnight",
            PracticeReminderCopy.For(PracticeReminderKind.StreakAtRisk, PracticeTrack.Playful, 6, 0).Title);
        Assert.Equal(new ReminderText("Your streak slipped", "Start a new one today? Your XP and badges are all still yours."),
            PracticeReminderCopy.For(PracticeReminderKind.StreakLost, PracticeTrack.Focused, 6, 0));
        // Doh speaks to Playful (and anyone without a track); Focused is plain.
        Assert.All(PracticeReminderCopy.Plain.Values.SelectMany(v => v), t => Assert.DoesNotContain("Doh", t.Title + t.Body));
        Assert.Contains(PracticeReminderCopy.Playful.Values.SelectMany(v => v), t => t.Title.Contains("Doh"));
    }

    // ── GET/PUT /api/practice/reminders ──────────────────────────────────────

    [Fact]
    public async Task Reminders_are_off_until_a_singer_practises_or_picks_a_track_and_the_settings_save()
    {
        using var h = new TestHarness(Utc("2026-10-17", 10, 0));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos");

        Assert.Equal(new PracticeRemindersDto(false, 19, true), await Get(h, ada));
        Take(h, ada, "2026-10-17");
        Assert.Equal(new PracticeRemindersDto(true, 19, true), await Get(h, ada));

        var saved = await Put(h, ada, new SetPracticeRemindersCommand(null, 9, false));
        Assert.Equal(new PracticeRemindersDto(true, 9, false), saved.Value);
        Assert.Equal(new PracticeRemindersDto(false, 9, false), (await Put(h, ada, new SetPracticeRemindersCommand(false, null, null))).Value);

        // Switched back on later: the schedule restarts from then.
        h.Clock.UtcNow = Utc("2026-10-20", 10, 0);
        Assert.True((await Put(h, ada, new SetPracticeRemindersCommand(true, null, null))).Value.Enabled);
        Assert.Equal(Utc("2026-10-20", 10, 0), h.Db.Users.AsNoTracking().Single(u => u.Id == ada).PracticeRemindersSinceUtc);
    }

    [Theory]
    [InlineData(7)]
    [InlineData(22)]
    [InlineData(-1)]
    public async Task An_hour_in_the_quiet_hours_is_refused(int hour)
    {
        using var h = new TestHarness(Utc("2026-10-17", 10, 0));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos");

        var result = await Put(h, ada, new SetPracticeRemindersCommand(true, hour, null));

        Assert.True(result.IsFailure);
        Assert.Equal("PRACTICE_REMINDER_HOUR", result.Error.Code);
        Assert.Null(h.Db.Users.AsNoTracking().Single(u => u.Id == ada).PracticeRemindersOn);
    }

    // ── The pieces around it ─────────────────────────────────────────────────

    [Fact]
    public async Task A_device_says_whether_its_app_code_takes_server_reminders_and_older_code_turns_it_off()
    {
        using var h = new TestHarness(Utc("2026-10-17", 10, 0));
        var ada = Singer(h, "ada@example.com", "Africa/Lagos", [], device: null);
        var handler = new RegisterDeviceCommandHandler(h.Db, h.Clock, new StubCurrentUser(ada));

        await handler.Handle(new RegisterDeviceCommand("ExponentPushToken[x]", "android", 30, ServerReminders: true), default);
        Assert.True(h.Db.DeviceTokens.AsNoTracking().Single().ServerReminders);

        h.Db.ChangeTracker.Clear();
        await handler.Handle(new RegisterDeviceCommand("ExponentPushToken[x]", "android", 30), default);
        Assert.False(h.Db.DeviceTokens.AsNoTracking().Single().ServerReminders);
    }

    [Fact]
    public async Task The_accounts_time_zone_follows_the_clients_header_and_a_garbled_one_is_ignored()
    {
        using var h = new TestHarness(Utc("2026-10-17", 10, 0));
        var ada = Singer(h, "tz@example.com", null, [], device: null);
        var middleware = new NoteFusion.Api.Middleware.ClientTimeZoneMiddleware(_ => Task.CompletedTask);

        async Task<string?> Request(string? header)
        {
            var context = new Microsoft.AspNetCore.Http.DefaultHttpContext();
            if (header is not null) context.Request.Headers["X-Time-Zone"] = header;
            await middleware.InvokeAsync(context, new StubCurrentUser(ada), h.Db,
                NullLogger<NoteFusion.Api.Middleware.ClientTimeZoneMiddleware>.Instance);
            return h.Db.Users.AsNoTracking().Single(u => u.Id == ada).TimeZone;
        }

        Assert.Equal("Asia/Kolkata", await Request("Asia/Kolkata"));
        Assert.Equal("Asia/Kolkata", await Request("Not/A_Zone"));
        Assert.Equal("Asia/Kolkata", await Request(null));
        Assert.Equal("Europe/London", await Request("Europe/London"));
    }

    [Theory]
    [InlineData("Asia/Kolkata", "Asia/Kolkata")]
    [InlineData(" Europe/London ", "Europe/London")]
    [InlineData("+05:30", "+05:30")]
    [InlineData("Africa/Lagos", "Africa/Lagos")]
    [InlineData("Mars/Olympus_Mons", null)]
    [InlineData("+15:00", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void Only_a_zone_the_server_knows_is_stored(string? header, string? stored)
        => Assert.Equal(stored, PracticeTime.Known(header));

    [Fact]
    public async Task Expo_is_sent_the_sound_channel_priority_and_time_to_live_only_when_a_message_sets_them()
    {
        var handler = new StubHttpMessageHandler((_, _) => StubHttpMessageHandler.Respond(
            HttpStatusCode.OK, """{"data":[{"status":"ok"},{"status":"error","message":"DeviceNotRegistered"}]}"""));
        var sender = new ExpoPushSender(Substitute.For<IDeviceTokenService>(), NullLogger<ExpoPushSender>.Instance, new HttpClient(handler));

        var delivery = await sender.SendToDevicesAsync(["ExponentPushToken[a]", "ExponentPushToken[b]"],
            new PushMessage("t", "b", new Dictionary<string, string> { ["screen"] = "Practice" }, "default", "reminders", 600));
        Assert.Equal(PushDelivery.Ok(1, 1), delivery);
        var first = JsonDocument.Parse(handler.Requests[0].Body!).RootElement[0];
        Assert.Equal(("default", "reminders", "high", 600),
            (first.GetProperty("sound").GetString(), first.GetProperty("channelId").GetString(),
             first.GetProperty("priority").GetString(), first.GetProperty("ttl").GetInt32()));

        await sender.SendToDevicesAsync(["ExponentPushToken[a]"], new PushMessage("t", "b"));
        var plain = JsonDocument.Parse(handler.Requests[1].Body!).RootElement[0];
        Assert.False(plain.TryGetProperty("sound", out _) || plain.TryGetProperty("channelId", out _)
                     || plain.TryGetProperty("priority", out _) || plain.TryGetProperty("ttl", out _));
    }

    [Fact]
    public async Task Expo_refusing_every_device_or_answering_an_error_is_a_failed_delivery()
    {
        var refused = new ExpoPushSender(Substitute.For<IDeviceTokenService>(), NullLogger<ExpoPushSender>.Instance,
            new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.OK, """{"data":[{"status":"error","message":"DeviceNotRegistered"}]}""")));
        Assert.Equal(PushDelivery.Failed("DeviceNotRegistered", 1), await refused.SendToDevicesAsync(["ExponentPushToken[a]"], new PushMessage("t", "b")));

        var down = new ExpoPushSender(Substitute.For<IDeviceTokenService>(), NullLogger<ExpoPushSender>.Instance,
            new HttpClient(StubHttpMessageHandler.Returning(HttpStatusCode.BadGateway, "")));
        Assert.Equal("Expo push returned 502.", (await down.SendToDevicesAsync(["ExponentPushToken[a]"], new PushMessage("t", "b"))).Error);
    }

    [Fact]
    public void Settings_from_the_environment_default_to_on_every_ten_minutes()
    {
        var blank = PracticeReminderDependencyInjection.ResolveSettings(Config(new()
        {
            ["PracticeReminders:Enabled"] = "", ["PracticeReminders:IntervalMinutes"] = "", ["PracticeReminders:BatchSize"] = "",
        }));
        Assert.Equal((true, 10, 500), (blank.Enabled, blank.IntervalMinutes, blank.BatchSize));

        var off = PracticeReminderDependencyInjection.ResolveSettings(Config(new() { ["PracticeReminders:Enabled"] = "false" }));
        Assert.False(off.Enabled);
    }

    [Fact]
    public async Task The_admin_list_shows_each_reminder_with_its_words()
    {
        using var h = new TestHarness(Utc("2026-10-11", 18, 5));
        Singer(h, "ada@example.com", "Africa/Lagos", WorkWeek);
        await Run(h);

        var overview = (await new GetPracticeReminderLogQueryHandler(h.Db, h.Clock, new PracticeReminderSettings())
            .Handle(new GetPracticeReminderLogQuery(), default)).Value;

        Assert.True(overview.Enabled);
        Assert.Equal((1, 1), (overview.SentLast24Hours, overview.AccountsLast7Days));
        var row = Assert.Single(overview.Recent);
        Assert.Equal(("ada@example.com", PracticeReminderKind.StreakAtRisk, 5, PracticeReminderStatus.Sent),
            (row.Email, row.Kind, row.Streak, row.Status));
        Assert.Equal(row.Title, Assert.Single(h.Push.DeviceSends).Message.Title);
        Assert.Equal(1, overview.Kinds.Single(k => k.Kind == PracticeReminderKind.StreakAtRisk).Sent);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static string PhoneToken(Guid userId) => $"ExponentPushToken[{userId:N}]";

    private static Guid Singer(TestHarness h, string email, string? zone, params string[] practised)
        => Singer(h, email, zone, practised, device: true);

    /// <param name="device">true: a phone on app code that takes server reminders; false: one on older code; null: none.</param>
    private static Guid Singer(TestHarness h, string email, string? zone, string[] practised, bool? device)
    {
        var user = User.Create(email, email, "hash", Utc("2026-01-01", 9, 0));
        h.Db.Users.Add(user);
        if (device is { } current)
            user.RegisterDeviceToken(PhoneToken(user.Id), "android", 30, h.Clock.UtcNow, serverReminders: current);
        h.Db.SaveChanges();
        if (zone is not null)
            h.Db.Users.Where(u => u.Id == user.Id).ExecuteUpdate(s => s.SetProperty(u => u.TimeZone, zone));
        foreach (var day in practised)
            Take(h, user.Id, day);
        return user.Id;
    }

    private static void Take(TestHarness h, Guid userId, string localDay)
    {
        h.Db.PracticeSessions.Add(PracticeSession.Record(
            userId, PracticeKind.Drill, 80, 3, 0, 0, 0, 4, Utc(localDay, 12, 0), D(localDay)));
        h.Db.SaveChanges();
    }

    private static PracticeReminderService Service(TestHarness h, IProviderHealth? health = null)
        => new(h.Db, h.Clock, h.Push, health);

    private static Task<int> Run(TestHarness h, PracticeReminderSettings? settings = null, IProviderHealth? health = null)
    {
        settings ??= new PracticeReminderSettings();
        return new PracticeReminderRunner(h.Db, Service(h, health), settings, NullLogger<PracticeReminderRunner>.Instance)
            .RunAsync(default);
    }

    private static async Task<Application.Practice.Dtos.PracticeRemindersDto> Get(TestHarness h, Guid userId)
        => (await new GetPracticeRemindersQueryHandler(h.Db, new StubCurrentUser(userId))
            .Handle(new GetPracticeRemindersQuery(), default)).Value;

    private static Task<Shared.Results.Result<Application.Practice.Dtos.PracticeRemindersDto>> Put(
        TestHarness h, Guid userId, SetPracticeRemindersCommand command)
        => new SetPracticeRemindersCommandHandler(h.Db, new StubCurrentUser(userId), h.Clock).Handle(command, default);

    private static IConfiguration Config(Dictionary<string, string?> values)
        => new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
