using NoteFusion.Application.Admin.ConsoleAlerts;
using NoteFusion.Application.Push.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The console's alerts: failed payment attempts, a wave of accounts, one inbox making several, and floods of
/// transcriptions, each to the admins' console browsers only and at most once per cooldown; admins' own never counted.
/// </summary>
public class AdminConsoleAlertTests
{
    private static readonly DateTime Now = new(2026, 10, 25, 12, 0, 0, DateTimeKind.Utc);
    private static readonly Dictionary<string, DateTime> NoneYet = new();

    private static readonly AdminConsoleAlertSettings Settings = new()
    {
        SignupBurst = 3, SignupWindowMinutes = 15, InboxBurst = 2, JobBurstPerSender = 4, JobBurstTotal = 8, JobWindowMinutes = 10,
    };

    private static User Admin(TestHarness h, bool consoleSubscribed = true)
    {
        var admin = User.CreateAdmin("Francis", "francis@notefusion.studio", h.Hasher.Hash("pw"), Now.AddDays(-90));
        h.Db.Users.Add(admin);
        if (consoleSubscribed)
            h.Db.WebPushSubscriptions.Add(WebPushSubscription.Create(admin.Id, "https://fcm.googleapis.com/fcm/send/console-1",
                "p", "a", null, Now, WebPushSubscription.ConsoleAudience));
        h.Db.SaveChanges();
        return admin;
    }

    private static User Person(TestHarness h, string email, DateTime at)
    {
        var user = User.Create(email.Split('@')[0], email, h.Hasher.Hash("pw"), at);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static Task<NoteFusion.Shared.Results.Result<AdminConsoleAlertRun>> Run(TestHarness h, IReadOnlyDictionary<string, DateTime>? last = null)
        => new SendAdminConsoleAlertsCommandHandler(h.Db, h.WebPush, Settings)
            .Handle(new SendAdminConsoleAlertsCommand(Now.AddMinutes(-1), Now, last ?? NoneYet), default);

    [Fact]
    public async Task A_failed_payment_attempt_reaches_the_admins_console_with_who_and_how_much()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var ada = Person(h, "ada@example.com", Now.AddDays(-3));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "Pro Monthly", 750_000, "NGN", BillingInterval.Monthly);
        h.Db.Plans.Add(plan);
        var payment = PaymentTransaction.Create(ada.Id, plan.Id, PaymentProvider.Paystack, "idem-1", "ref-1", 750_000, "NGN", Now.AddMinutes(-5));
        payment.MarkFailed("Card declined", Now.AddSeconds(-30));
        h.Db.PaymentTransactions.Add(payment);
        await h.Db.SaveChangesAsync();

        var run = (await Run(h)).Value;

        Assert.Equal(1, run.FailedPayments);
        var (to, push) = Assert.Single(h.WebPush.SentToConsole);
        Assert.Equal(admin.Id, to);
        Assert.StartsWith("Payment failed · ₦7,500", push.Title);
        Assert.Contains("ada", push.Body);
        Assert.Equal($"/payments/{payment.Id}", push.Url);
        Assert.Empty(h.WebPush.Sent);   // never the web app's browsers
    }

    [Fact]
    public async Task A_wave_of_accounts_rings_once_per_cooldown()
    {
        using var h = new TestHarness(Now);
        Admin(h);
        for (var i = 0; i < 3; i++)
            Person(h, $"new{i}@example.com", Now.AddMinutes(-i - 1));

        var first = (await Run(h)).Value;
        Assert.Contains("signups", first.Alerted);
        Assert.Contains(h.WebPush.SentToConsole, s => s.Notification.Title == "3 new accounts in 15 minutes");

        h.WebPush.SentToConsole.Clear();
        var again = (await Run(h, new Dictionary<string, DateTime> { ["signups"] = Now.AddMinutes(-20) })).Value;
        Assert.DoesNotContain("signups", again.Alerted);
        Assert.Empty(h.WebPush.SentToConsole);
    }

    [Fact]
    public async Task Several_accounts_on_one_inbox_ring_with_the_inbox_masked()
    {
        using var h = new TestHarness(Now);
        Admin(h);
        Person(h, "chi.di@gmail.com", Now.AddMinutes(-40));
        Person(h, "chidi+2@gmail.com", Now.AddMinutes(-20));

        var run = (await Run(h)).Value;

        Assert.Contains("inbox:chidi@gmail.com", run.Alerted);
        var push = Assert.Single(h.WebPush.SentToConsole).Notification;
        Assert.Equal("2 accounts on one inbox in an hour", push.Title);
        Assert.Contains("ch•••@gmail.com", push.Body);
    }

    [Fact]
    public async Task One_account_or_one_phone_sending_far_more_than_usual_rings_and_admins_never_count()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var ada = Person(h, "ada@example.com", Now.AddDays(-5));
        var bola = Person(h, "bola@example.com", Now.AddDays(-5));
        var chi = Person(h, "chi@example.com", Now.AddDays(-5));
        for (var i = 0; i < 4; i++)
            h.Db.TranscriptionJobs.Add(TranscriptionJob.Record($"ada-{i}", ada.Id, Now.AddMinutes(-i), "phone-a"));
        // One phone, two accounts, each under the line: the phone is not.
        for (var i = 0; i < 2; i++)
        {
            h.Db.TranscriptionJobs.Add(TranscriptionJob.Record($"bola-{i}", bola.Id, Now.AddMinutes(-i), "phone-b"));
            h.Db.TranscriptionJobs.Add(TranscriptionJob.Record($"chi-{i}", chi.Id, Now.AddMinutes(-i), "phone-b"));
        }
        for (var i = 0; i < 10; i++)
            h.Db.TranscriptionJobs.Add(TranscriptionJob.Record($"admin-{i}", admin.Id, Now.AddMinutes(-i), "phone-x"));
        await h.Db.SaveChangesAsync();

        var run = (await Run(h)).Value;

        Assert.Contains($"jobs:user:{ada.Id}", run.Alerted);
        Assert.Contains("jobs:device:phone-b", run.Alerted);
        Assert.Contains("jobs:all", run.Alerted);   // 8 from real people; the admin's 10 are left out
        Assert.DoesNotContain(run.Alerted, k => k.Contains(admin.Id.ToString()) || k.Contains("phone-x"));
        Assert.Contains(h.WebPush.SentToConsole, s => s.Notification.Url == $"/users/{ada.Id}");
    }

    [Fact]
    public async Task Nothing_unusual_sends_nothing()
    {
        using var h = new TestHarness(Now);
        Admin(h);
        Person(h, "ada@example.com", Now.AddMinutes(-3));

        var run = (await Run(h)).Value;

        Assert.Empty(run.Alerted);
        Assert.Empty(h.WebPush.SentToConsole);
    }

    [Fact]
    public async Task The_console_subscription_is_kept_apart_from_the_web_apps()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h, consoleSubscribed: false);
        var save = new SaveWebPushSubscriptionCommandHandler(h.Db, h.Clock, new StubCurrentUser(admin.Id, UserRole.Admin), new FixedKeys());
        var keys = new WebPushSubscriptionKeysDto(Convert.ToBase64String(P256()).TrimEnd('='), Convert.ToBase64String(new byte[16]).TrimEnd('='));

        Assert.True((await save.Handle(new SaveWebPushSubscriptionCommand("https://fcm.googleapis.com/fcm/send/c", keys, null, WebPushSubscription.ConsoleAudience), default)).IsSuccess);
        Assert.True((await save.Handle(new SaveWebPushSubscriptionCommand("https://fcm.googleapis.com/fcm/send/a", keys), default)).IsSuccess);

        Assert.Equal(WebPushSubscription.ConsoleAudience, h.Db.WebPushSubscriptions.Single(s => s.Endpoint.EndsWith("/c")).Audience);
        Assert.Equal(WebPushSubscription.AppAudience, h.Db.WebPushSubscriptions.Single(s => s.Endpoint.EndsWith("/a")).Audience);
    }

    private static byte[] P256()
    {
        var key = new byte[65];
        key[0] = 0x04;
        return key;
    }

    private sealed class FixedKeys : NoteFusion.Application.Common.Interfaces.IWebPushKeys
    {
        public string? PublicKey => "key";
    }
}
