using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Analytics;

/// <summary>
/// The overview's numbers mean what their labels say: active today is today, active in the window moves
/// with the window, a gift is not a conversion, an account from before the source stamp is placed where
/// its traces put it, coming back to transcribe counts as coming back, and the live feed sees who is on.
/// </summary>
public class DashboardAccuracyTests
{
    private static readonly DateTime Now = new(2026, 10, 14, 15, 0, 0, DateTimeKind.Utc); // 16:00 local

    [Fact]
    public async Task Active_today_is_today_and_active_follows_the_window()
    {
        using var h = new TestHarness(Now);
        var today = Signup(h, "today@example.com", Now.AddDays(-90));
        var lastWeek = Signup(h, "week@example.com", Now.AddDays(-90));
        Signup(h, "gone@example.com", Now.AddDays(-90));
        h.Db.Users.Single(u => u.Id == today).MarkSeen(Now.AddHours(-2));
        h.Db.Users.Single(u => u.Id == lastWeek).MarkSeen(Now.AddDays(-6));
        var job = TranscriptionJob.Record("j-old", lastWeek, Now.AddDays(-40)); // active in the previous window
        h.Db.TranscriptionJobs.Add(job);
        h.Db.SaveChanges();

        var users = (await Overview(h)).Users;

        Assert.Equal(1, users.ActiveToday);
        Assert.Equal(2, users.ActiveUsers);         // seen in the last 30 days: today, last week
        Assert.Equal(1, users.ActiveUsersPrevious); // the job 40 days ago
    }

    [Fact]
    public async Task Web_to_pro_counts_payments_not_gifts()
    {
        using var h = new TestHarness(Now);
        var paid = Signup(h, "paid@example.com", Now.AddDays(-5), "web");
        var gifted = Signup(h, "gift@example.com", Now.AddDays(-5), "web");
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "Pro", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(Subscription.Start(paid, plan.Id, PaymentProvider.Paystack, Now.AddDays(-2), Now.AddDays(28), "s1", Now.AddDays(-2)));
        h.Db.Subscriptions.Add(Subscription.Grant(gifted, plan.Id, Now.AddDays(-2), Now.AddDays(28), Now.AddDays(-2)));
        h.Db.SaveChanges();

        Assert.Equal(1, (await Overview(h)).WebFunnel.WebProConversions);
    }

    [Fact]
    public async Task Accounts_without_a_source_are_placed_by_their_traces()
    {
        using var h = new TestHarness(Now);
        Signup(h, "stamped@example.com", Now.AddDays(-3), "web");
        var phone = Signup(h, "phone@example.com", Now.AddDays(-3));
        var browser = Signup(h, "browser@example.com", Now.AddDays(-3));
        Signup(h, "nothing@example.com", Now.AddDays(-3));
        h.Db.DeviceTokens.Add(DeviceToken.Create(phone, "push-token", "android", 30, Now));
        h.Db.WebEvents.Add(WebEvent.TryCreate("pageview", null, "/app", null, null, "v1", "s1", browser, "desktop", Now)!);
        h.Db.SaveChanges();

        var sources = (await Overview(h)).SignupSources.ToDictionary(s => s.Label, s => s.Count);
        Assert.Equal((2, 1, 1), (sources["Web"], sources["Mobile"], sources["Unknown"]));
    }

    [Fact]
    public async Task Transcribing_on_a_later_day_counts_as_coming_back()
    {
        using var h = new TestHarness(Now);
        var returner = Signup(h, "back@example.com", Now.AddDays(-9));
        Signup(h, "once@example.com", Now.AddDays(-9));
        h.Db.TranscriptionJobs.Add(TranscriptionJob.Record("j-later", returner, Now.AddDays(-7)));
        h.Db.SaveChanges();

        var cohort = Assert.Single((await Overview(h)).Retention);
        Assert.Equal((2, 1), (cohort.CohortSize, cohort.ReturnedCount));
    }

    [Fact]
    public async Task Keys_follow_the_window()
    {
        using var h = new TestHarness(DateTime.UtcNow.AddMinutes(1));
        var ada = Signup(h, "ada@example.com", h.Clock.UtcNow.AddDays(-1));
        h.Db.Transcriptions.Add(new Transcription(ada, "Now", new Core.Solfa.MusicalKey(0, Core.Solfa.KeyMode.Major), 90, "4/4", "<x/>",
            [new NoteEvent { PitchMidi = 60, StartBeat = 0, DurationBeats = 1, Confidence = 0.9 }], 0.9));
        h.Db.SaveChanges();

        var inWindow = await Overview(h);
        Assert.Equal("C major", Assert.Single(inWindow.TopKeys).Label);
        var before = await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock)
            .Handle(new GetAnalyticsOverviewQuery(new DateTime(2026, 1, 1), new DateTime(2026, 1, 31)), default);
        Assert.Empty(before.Value.TopKeys);
    }

    [Fact]
    public async Task Live_activity_lists_who_is_online_and_what_just_started()
    {
        using var h = new TestHarness(Now);
        var on = Signup(h, "on@example.com", Now.AddDays(-3));
        var off = Signup(h, "off@example.com", Now.AddDays(-3));
        h.Db.Users.Single(u => u.Id == on).MarkSeen(Now.AddMinutes(-1));
        h.Db.Users.Single(u => u.Id == off).MarkSeen(Now.AddMinutes(-30));
        h.Db.TranscriptionJobs.Add(TranscriptionJob.RecordLink("j-new", on, Now.AddMinutes(-2), null, false));
        h.Db.TranscriptionJobs.Add(TranscriptionJob.Record("j-stale", off, Now.AddMinutes(-40)));
        h.Db.PreviewJobs.Add(PreviewJob.Record("p-new", "upload", null, null, Now.AddMinutes(-3)));
        h.Db.SaveChanges();

        var live = (await new GetLiveActivityQueryHandler(h.Db, h.Clock).Handle(new GetLiveActivityQuery(), default)).Value;

        Assert.Equal("on@example.com", Assert.Single(live.Online).Email);
        Assert.Equal(["j-new", "p-new"], live.Transcribing.Select(j => j.JobId));
        Assert.Equal(("song link", "on@example.com", false), (live.Transcribing[0].Kind, live.Transcribing[0].Email, live.Transcribing[0].Preview));
        Assert.True(live.Transcribing[1].Preview);
    }

    private static async Task<Application.Analytics.Dtos.AnalyticsOverviewDto> Overview(TestHarness h)
        => (await new GetAnalyticsOverviewQueryHandler(h.Db, h.Clock).Handle(new GetAnalyticsOverviewQuery(), default)).Value;

    private static Guid Signup(TestHarness h, string email, DateTime createdAt, string? source = null)
    {
        var user = User.Create(email.Split('@')[0], email, "hash", createdAt);
        user.RecordSignupSource(source);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user.Id;
    }
}
