using NoteFusion.Application.Activity.Commands;
using NoteFusion.Application.Analytics.Queries;
using NoteFusion.Application.AppEvents.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Listen;

/// <summary>
/// The phone's own events (Listen from anywhere) and the console page that reads them: what a batch keeps, and that the
/// page counts takes, endings, reminders, settings and Pro locks the way the app logs them, and follows a take to its job.
/// </summary>
public class ListenAnalyticsTests
{
    private static readonly DateTime Now = new(2026, 10, 22, 12, 0, 0, DateTimeKind.Utc);

    // ---------------------------------------------------------------- what a batch keeps

    [Fact]
    public void An_event_keeps_a_clean_name_its_details_and_a_sensible_time()
    {
        var user = Guid.NewGuid();

        var ok = AppEvent.TryCreate(user, "listen_take_end", "reason=cap;sec=360\n", Now.AddMinutes(-3), "hash", 61, Now)!;
        Assert.Equal("listen_take_end", ok.Name);
        Assert.Equal("reason=cap;sec=360", ok.Detail);
        Assert.Equal(Now.AddMinutes(-3), ok.OccurredAtUtc);
        Assert.Equal(61, ok.AppBuild);

        // A phone clock running ahead is stamped now; one from before the phone's log was kept is not counted.
        Assert.Equal(Now, AppEvent.TryCreate(user, "listen_reminder", null, Now.AddHours(2), null, 0, Now)!.OccurredAtUtc);
        Assert.Null(AppEvent.TryCreate(user, "listen_reminder", null, Now.AddDays(-31), null, 0, Now));

        // Names are lower-case words and underscores, nothing else.
        Assert.Null(AppEvent.TryCreate(user, "Listen Take", null, Now, null, 0, Now));
        Assert.Null(AppEvent.TryCreate(user, "listen;drop table", null, Now, null, 0, Now));
        Assert.Null(AppEvent.TryCreate(user, new string('a', 61), null, Now, null, 0, Now));
        Assert.Null(AppEvent.TryCreate(user, "", null, Now, null, 0, Now));

        // Details are cut to their column.
        Assert.Equal(AppEvent.DetailMaxLength, AppEvent.TryCreate(user, "listen_x", new string('d', 500), Now, null, 0, Now)!.Detail!.Length);
    }

    [Fact]
    public void Details_read_back_as_pairs()
    {
        var d = AppEvent.ParseDetail("from=tile;sec=42; reason = cap ;junk;=x");
        Assert.Equal("tile", d["from"]);
        Assert.Equal("42", d["sec"]);
        Assert.Equal("cap", d["reason"]);
        Assert.Equal(3, d.Count);
        Assert.Empty(AppEvent.ParseDetail(null));
    }

    [Fact]
    public async Task A_batch_is_kept_for_the_signed_in_account_and_malformed_events_are_dropped()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, "pat@example.com");
        var handler = new RecordAppEventsCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock);

        var result = await handler.Handle(new RecordAppEventsCommand(61,
        [
            new AppEventInput("listen_take_start", "from=bubble;source=room;pro=1", Now.AddMinutes(-2)),
            new AppEventInput("BAD NAME", null, Now),
            new AppEventInput("listen_take_end", "reason=stop;sent=1;sec=30", null),
        ], "device-hash"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Accepted);
        var rows = h.Db.AppEvents.OrderBy(e => e.Name).ToList();
        Assert.All(rows, r => Assert.Equal(user.Id, r.UserId));
        Assert.All(rows, r => Assert.Equal("device-hash", r.DeviceHash));
        Assert.Equal(Now, rows.Single(r => r.Name == "listen_take_end").OccurredAtUtc);
    }

    [Fact]
    public async Task A_batch_is_cut_at_its_limit_and_refused_without_an_account()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, "pat@example.com");
        var many = Enumerable.Range(0, 80).Select(i => new AppEventInput("listen_reminder", $"at={i}", Now)).ToList();

        var kept = await new RecordAppEventsCommandHandler(h.Db, new StubCurrentUser(user.Id), h.Clock)
            .Handle(new RecordAppEventsCommand(61, many), CancellationToken.None);
        Assert.Equal(RecordAppEventsCommandHandler.MaxBatch, kept.Value.Accepted);

        var anonymous = await new RecordAppEventsCommandHandler(h.Db, new StubCurrentUser(), h.Clock)
            .Handle(new RecordAppEventsCommand(61, many), CancellationToken.None);
        Assert.True(anonymous.IsFailure);
    }

    [Fact]
    public async Task Old_events_go_with_the_rest_of_the_activity()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, "pat@example.com");
        Add(h, user, "listen_take_start", "from=tile", Now.AddDays(-20));
        h.Db.SaveChanges();

        h.Clock.UtcNow = Now.AddDays(TranscriptionLog.RetentionDays);
        var purged = await new PurgeOldActivityCommandHandler(h.Db, h.Clock).Handle(new PurgeOldActivityCommand(), CancellationToken.None);

        Assert.Equal(1, purged.Value.AppEvents);
        Assert.Empty(h.Db.AppEvents);
    }

    // ---------------------------------------------------------------- the console page

    [Fact]
    public async Task The_page_counts_takes_by_way_in_and_source_and_follows_them_to_their_jobs()
    {
        using var h = new TestHarness(Now);
        var pro = Seed(h, "pro@example.com");
        var free = Seed(h, "free@example.com");
        var at = Now.AddDays(-2);

        // Pro: a button take sent and finished; a notification take from the phone's sound, sent and still running.
        Add(h, pro, "listen_take_start", "from=bubble;source=room;pro=1", at);
        Add(h, pro, "listen_take_end", "from=bubble;source=room;reason=stop;via=bubble;sec=40;heard=35;sent=1;reminders=0", at.AddSeconds(40));
        Add(h, pro, "listen_take_queued", "from=bubble;source=room;sec=40;job=job-done", at.AddSeconds(45));
        Add(h, pro, "listen_take_start", "from=notification;source=phone;pro=1", at.AddHours(1));
        Add(h, pro, "listen_take_end", "from=notification;source=phone;reason=music_stopped;via=quiet;sec=200;heard=150;sent=1;reminders=1", at.AddHours(1).AddSeconds(200));
        Add(h, pro, "listen_reminder", "from=notification;at=120", at.AddHours(1).AddSeconds(120));
        Add(h, pro, "listen_take_queued", "job=job-running", at.AddHours(1).AddSeconds(205));
        // Free: a tile take that heard nothing, a forgotten one stopped from its reminder, and a refusal.
        Add(h, free, "listen_take_start", "from=tile;source=room;pro=0", at);
        Add(h, free, "listen_take_end", "from=tile;source=room;reason=nothing_heard;via=quiet;sec=60;heard=0;sent=0;unsent=nothing_heard", at.AddMinutes(1));
        Add(h, free, "listen_take_start", "from=tile;source=room;pro=0", at.AddHours(2));
        Add(h, free, "listen_reminder", "from=tile;at=120", at.AddHours(2).AddSeconds(120));
        Add(h, free, "listen_take_end", "from=tile;source=room;reason=cancel;via=reminder;sec=125;heard=100;sent=0;unsent=cancel;reminders=1", at.AddHours(2).AddSeconds(125));
        Add(h, free, "listen_take_refused", "from=bubble;reason=not_pro", at.AddHours(3));
        Add(h, free, "listen_notice_dismissed", null, at.AddHours(3));

        var done = TranscriptionJob.Record("job-done", pro.Id, at.AddSeconds(45));
        done.Settle("{\"notes\":[]}", at.AddMinutes(2));
        h.Db.TranscriptionJobs.Add(done);
        h.Db.TranscriptionJobs.Add(TranscriptionJob.Record("job-running", pro.Id, at.AddHours(1)));
        h.Db.SaveChanges();

        var page = (await Query(h)).Value;

        Assert.Equal(2, page.Summary.People);
        Assert.Equal(1, page.Summary.ProPeople);
        Assert.Equal(4, page.Summary.TakesStarted);
        Assert.Equal(2, page.Summary.TakesSent);
        Assert.Equal(2, page.Summary.TakesUnsent);
        Assert.Equal(1, page.Summary.Transcriptions);
        Assert.Equal(0, page.Summary.TranscriptionsFailed);
        Assert.Equal(1, page.Summary.TranscriptionsPending);
        Assert.Equal(2, page.Summary.Reminders);
        Assert.Equal(1, page.Summary.StoppedFromReminder);
        Assert.Equal(2, page.Summary.EndedByThemselves); // music_stopped and nothing_heard
        Assert.Equal(120, page.Summary.AverageSentSeconds); // (40 + 200) / 2
        Assert.Equal(1, page.Summary.NoticeDismissed);

        Assert.Equal(["bubble", "notification", "tile"], page.ByEntry.Select(b => b.Key));
        Assert.Equal((1, 1, 1), Triple(page.ByEntry, "bubble"));
        Assert.Equal((1, 1, 1), Triple(page.ByEntry, "notification"));
        Assert.Equal((2, 0, 1), Triple(page.ByEntry, "tile"));
        Assert.Equal((3, 1, 2), Triple(page.BySource, "room"));
        Assert.Equal((1, 1, 1), Triple(page.BySource, "phone"));

        // Kinds are read off the endings; these takes predate "Listen for", so all four count as Singing.
        Assert.Equal(["melody", "poly", "chords"], page.ByKind.Select(b => b.Key));
        Assert.Equal((4, 2, 2), Triple(page.ByKind, "melody"));

        Assert.Equal(4, page.Endings.Sum(e => e.Count));
        Assert.Equal(1, page.Endings.Single(e => e.Key == "music_stopped").Sent);
        Assert.Equal("not_pro", Assert.Single(page.Refusals).Key);

        Assert.Equal(31, page.Days.Count); // the last 30 days and today, each a reporting day
        var day = page.Days.Single(d => d.Date == DateOnly.FromDateTime(at.AddHours(1)));
        Assert.Equal(4, day.Started);
        Assert.Equal(2, day.Sent);
        Assert.Equal(2, day.People);
    }

    [Fact]
    public async Task Settings_are_read_as_each_account_last_left_them_and_lock_taps_follow_to_upgrades()
    {
        using var h = new TestHarness(Now);
        var a = Seed(h, "a@example.com");
        var b = Seed(h, "b@example.com");
        var c = Seed(h, "c@example.com");

        // a: button on, then off; notification on. b: button on, source phone, tile. c: only taps a lock, then buys Pro.
        Add(h, a, "listen_setting", "setting=button;on=1", Now.AddDays(-50));
        Add(h, a, "listen_setting", "setting=button;on=0", Now.AddDays(-5));
        Add(h, a, "listen_setting", "setting=notification;on=1", Now.AddDays(-4));
        Add(h, b, "listen_setting", "setting=button;on=1", Now.AddDays(-3));
        Add(h, b, "listen_setting", "setting=source;value=phone", Now.AddDays(-3));
        Add(h, b, "listen_setting", "setting=tile;on=1", Now.AddDays(-3));
        Add(h, c, "listen_pro_lock", "setting=button", Now.AddDays(-6));
        Add(h, c, "listen_pro_lock", "setting=notification", Now.AddDays(-6));
        Add(h, a, "listen_pro_lock", "setting=button", Now.AddDays(-10));

        var pro = Plan.Create(Guid.NewGuid(), "pro_monthly_usd", "Pro", 999, "USD", BillingInterval.Monthly);
        var song = Plan.Create(Guid.NewGuid(), "single_usd", "One song", 199, "USD", BillingInterval.Single);
        h.Db.Plans.AddRange(pro, song);
        Pay(h, c, pro, Now.AddDays(-4));   // within a week of c's tap: counted
        Pay(h, a, song, Now.AddDays(-9));  // a bought one song, not Pro: not counted
        h.Db.SaveChanges();

        var settings = (await Query(h)).Value.Settings;

        Assert.Equal(1, settings.ButtonOn);        // b; a turned it off
        Assert.Equal(1, settings.NotificationOn);  // a
        Assert.Equal(1, settings.TileAdded);       // b
        Assert.Equal(1, settings.PhoneSound);      // b
        Assert.Equal(3, settings.ProLockTaps);
        Assert.Equal(2, settings.ProLockPeople);
        Assert.Equal(1, settings.UpgradedAfterLock);
    }

    [Fact]
    public async Task Takes_are_counted_by_what_they_were_sent_as()
    {
        using var h = new TestHarness(Now);
        var user = Seed(h, "pat@example.com");
        var at = Now.AddDays(-1);
        // Started as Singing, the chip tapped to Chords during the take: it counts as Chords.
        Add(h, user, "listen_take_start", "from=bubble;source=room;kind=melody;pro=1", at);
        Add(h, user, "listen_take_end", "from=bubble;source=room;kind=chords;reason=stop;sec=30;heard=28;sent=1", at.AddSeconds(30));
        Add(h, user, "listen_take_start", "from=tile;source=room;kind=poly;pro=1", at.AddHours(1));
        Add(h, user, "listen_take_end", "from=tile;source=room;kind=poly;reason=cancel;sec=10;heard=9;sent=0", at.AddHours(1).AddSeconds(10));
        h.Db.SaveChanges();

        var byKind = (await Query(h)).Value.ByKind;

        Assert.Equal((0, 0, 0), Triple(byKind, "melody"));
        Assert.Equal((1, 0, 1), Triple(byKind, "poly"));
        Assert.Equal((1, 1, 1), Triple(byKind, "chords"));
    }

    [Fact]
    public async Task Nothing_logged_is_an_empty_page_not_an_error()
    {
        using var h = new TestHarness(Now);
        var page = (await Query(h)).Value;
        Assert.Equal(0, page.Summary.TakesStarted);
        Assert.Equal(0, page.Summary.AverageSentSeconds);
        Assert.Equal(3, page.ByEntry.Count);
        Assert.Empty(page.Endings);
    }

    // ---------------------------------------------------------------- helpers

    private static Task<NoteFusion.Shared.Results.Result<NoteFusion.Application.Analytics.Dtos.ListenAnalyticsDto>> Query(TestHarness h)
        => new GetListenAnalyticsQueryHandler(h.Db, h.Clock).Handle(new GetListenAnalyticsQuery(), CancellationToken.None);

    private static (int, int, int) Triple(IEnumerable<NoteFusion.Application.Analytics.Dtos.ListenBreakdownDto> list, string key)
    {
        var b = list.Single(x => x.Key == key);
        return (b.Started, b.Sent, b.People);
    }

    private static User Seed(TestHarness h, string email)
    {
        var user = User.Create("Pat", email, h.Hasher.Hash("password123"), Now.AddDays(-100));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static void Add(TestHarness h, User user, string name, string? detail, DateTime at)
        => h.Db.AppEvents.Add(AppEvent.TryCreate(user.Id, name, detail, at, null, 61, at)!);

    private static void Pay(TestHarness h, User user, Plan plan, DateTime at)
    {
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Bachs, $"checkout:{reference}", reference, plan.AmountMinor, plan.Currency, at.AddMinutes(-5));
        tx.AttachCheckout("chk_" + reference, "https://checkout.example/" + reference, null, at.AddMinutes(-4));
        tx.MarkVerified("chk_" + reference, null, at);
        tx.MarkCompleted(at);
        h.Db.PaymentTransactions.Add(tx);
    }
}
