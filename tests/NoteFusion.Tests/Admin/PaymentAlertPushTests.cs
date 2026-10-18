using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using System.Security.Claims;
using NoteFusion.Api.Auth;
using NoteFusion.Api.Controllers;
using NoteFusion.Application.Admin.PaymentAlerts;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Admin;

/// <summary>
/// The admins' "someone just paid" push (board f-admin/08): claimed with the payment's ledger credit, sent once, only
/// to admin phones with alerts on, each the way it asked to be told; and the Payment alerts routes are an admin's
/// alone, on their own phone.
/// </summary>
public class PaymentAlertPushTests
{
    /// <summary>18:42 in Lagos.</summary>
    private static readonly DateTime Now = new(2026, 10, 18, 17, 42, 0, DateTimeKind.Utc);

    // ── The claim ─────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_completed_payment_claims_one_alert_however_often_it_is_fulfilled()
    {
        using var h = new TestHarness(Now);
        var (_, tx) = SeedPayment(h, Customer(h));

        await Fulfil(h, tx, "evt_1");
        await Fulfil(h, tx, "evt_2"); // a redelivered webhook, or the sweep arriving after it

        var alert = Assert.Single(h.Db.AdminPaymentAlerts);
        Assert.Equal(tx.Id, alert.PaymentTransactionId);
        Assert.Null(alert.SentAtUtc);
    }

    [Fact]
    public async Task A_checkout_that_only_opened_claims_nothing()
    {
        using var h = new TestHarness(Now);
        SeedPayment(h, Customer(h));
        Device(h, Admin(h), "ExponentPushToken[admin]", alerts: true);

        await Send(h);

        Assert.Empty(h.Db.AdminPaymentAlerts);
        Assert.Empty(h.Push.DeviceSends);
    }

    [Fact]
    public void The_database_refuses_a_second_alert_for_one_payment()
    {
        using var h = new TestHarness(Now);
        var (_, tx) = SeedPayment(h, Customer(h));
        h.Db.AdminPaymentAlerts.Add(AdminPaymentAlert.Claim(tx.Id, Now));
        h.Db.SaveChanges();

        h.Db.AdminPaymentAlerts.Add(AdminPaymentAlert.Claim(tx.Id, Now));
        Assert.ThrowsAny<Exception>(() => h.Db.SaveChanges());
    }

    // ── Who is told ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_admin_phone_with_alerts_on_is_told_once_with_the_payment_to_open()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[admin]", alerts: true);
        var (_, tx) = SeedPayment(h, Customer(h));
        await Fulfil(h, tx);

        await Send(h);
        await Send(h);
        h.Clock.UtcNow += TimeSpan.FromMinutes(5);
        await Send(h);

        var (tokens, message) = Assert.Single(h.Push.DeviceSends);
        Assert.Equal(["ExponentPushToken[admin]"], tokens);
        Assert.Equal("₦7,500 · Pro Monthly · first payment", message.Title);
        Assert.Equal("Ada Obi just paid for the first time.", message.Body);
        Assert.Equal("AdminPayment", message.Data!["screen"]);
        Assert.Equal(tx.Id.ToString(), message.Data["paymentId"]);
        Assert.Equal("payments-v1", message.ChannelId);
        Assert.Equal("payment.wav", message.Sound);
        Assert.Equal("payment", message.CategoryId);
        Assert.Equal(PaymentAlertChannels.TimeToLiveSeconds, message.TimeToLiveSeconds);

        var alert = h.Db.AdminPaymentAlerts.Single();
        Assert.Equal((1, 1, 1), (alert.Devices, alert.Accepted, alert.Attempts));
        Assert.NotNull(alert.SentAtUtc);
    }

    [Fact]
    public async Task Payment_pushes_never_reach_a_customers_phone()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var customer = Customer(h);
        Device(h, admin, "ExponentPushToken[admin]", alerts: true);
        // Even a customer's row with the switch on (set while the account was an admin, say) is not told.
        Device(h, customer, "ExponentPushToken[customer]", alerts: true);
        var (_, tx) = SeedPayment(h, customer);
        await Fulfil(h, tx);

        await Send(h);

        var (tokens, _) = Assert.Single(h.Push.DeviceSends);
        Assert.DoesNotContain("ExponentPushToken[customer]", tokens);
        Assert.Empty(h.Push.Sent); // nothing by account either
    }

    [Fact]
    public async Task A_demoted_or_suspended_admin_and_a_phone_handed_to_a_customer_are_not_told()
    {
        using var h = new TestHarness(Now);
        var demoted = Admin(h, "was@notefusion.studio");
        var suspended = Admin(h, "off@notefusion.studio");
        var handedOn = Admin(h, "old@notefusion.studio");
        Admin(h, "keeper@notefusion.studio"); // keeps a second active admin, as demoting needs
        Device(h, demoted, "ExponentPushToken[demoted]", alerts: true);
        Device(h, suspended, "ExponentPushToken[suspended]", alerts: true);
        Device(h, handedOn, "ExponentPushToken[shared]", alerts: true);
        var customer = Customer(h);
        Device(h, customer, "ExponentPushToken[shared]", alerts: false);
        demoted.DemoteFromAdmin();
        suspended.Suspend();
        h.Db.SaveChanges();

        var (_, tx) = SeedPayment(h, customer);
        await Fulfil(h, tx);
        await Send(h);

        Assert.Empty(h.Push.DeviceSends);
        Assert.NotNull(h.Db.AdminPaymentAlerts.Single().SentAtUtc); // settled: nobody to tell is not a failure
    }

    [Fact]
    public async Task An_admin_phone_with_alerts_off_is_not_told()
    {
        using var h = new TestHarness(Now);
        Device(h, Admin(h), "ExponentPushToken[admin]", alerts: false);
        var (_, tx) = SeedPayment(h, Customer(h));
        await Fulfil(h, tx);

        await Send(h);

        Assert.Empty(h.Push.DeviceSends);
    }

    // ── How each phone is told ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Several_payments_found_together_are_one_summary_that_opens_payments()
    {
        using var h = new TestHarness(Now);
        Device(h, Admin(h), "ExponentPushToken[admin]", alerts: true);
        var ada = Customer(h, "Ada Obi", "ada@example.com");
        var kwame = Customer(h, "Kwame Mensah", "kwame@example.com", "GH");
        var (_, first) = SeedPayment(h, ada);
        var (_, second) = SeedPayment(h, kwame, amount: 3_999, currency: "USD", planName: "NoteFusion Pro (Yearly)", interval: BillingInterval.Yearly);
        await Fulfil(h, first, "evt_a");
        h.Clock.UtcNow += TimeSpan.FromSeconds(4); // within one of the sender's runs
        await Fulfil(h, second, "evt_b");

        await Send(h);

        var message = Assert.Single(h.Push.DeviceSends).Message;
        Assert.Equal("2 payments · ₦7,500 · $39.99", message.Title);
        Assert.Equal("Ada Obi and Kwame Mensah", message.Body);
        Assert.Equal("AdminPayments", message.Data!["screen"]);
        Assert.False(message.Data.ContainsKey("paymentId"));
        Assert.All(h.Db.AdminPaymentAlerts, a => Assert.NotNull(a.SentAtUtc));
    }

    [Fact]
    public async Task Each_phone_is_told_its_own_way()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[loud]", alerts: true);
        Device(h, admin, "ExponentPushToken[private]", alerts: true, hideNames: true, sound: "phone", vibrate: false);
        var muted = Device(h, admin, "ExponentPushToken[muted]", alerts: true);
        muted.MutePaymentAlerts(Now.AddHours(1), Now);
        h.Db.SaveChanges();
        var (_, tx) = SeedPayment(h, Customer(h));
        await Fulfil(h, tx);

        await Send(h);

        Assert.Equal(3, h.Push.DeviceSends.Count);
        var loud = h.Push.DeviceSends.Single(s => s.Tokens.Contains("ExponentPushToken[loud]")).Message;
        Assert.Equal(("payments-v1", "payment.wav"), (loud.ChannelId, loud.Sound));
        Assert.Contains("Ada Obi", loud.Body);

        var hidden = h.Push.DeviceSends.Single(s => s.Tokens.Contains("ExponentPushToken[private]")).Message;
        Assert.Equal(("payments-v1-phone-still", "default"), (hidden.ChannelId, hidden.Sound));
        Assert.Equal("₦7,500 · Pro Monthly · first payment", hidden.Title);
        Assert.Equal("Tap to see who paid.", hidden.Body);

        var quiet = h.Push.DeviceSends.Single(s => s.Tokens.Contains("ExponentPushToken[muted]")).Message;
        Assert.Equal((PaymentAlertChannels.Quiet, (string?)null), (quiet.ChannelId, quiet.Sound));
    }

    [Fact]
    public async Task Quiet_at_night_rings_silently_in_the_quiet_hours_only()
    {
        using var h = new TestHarness(new DateTime(2026, 10, 18, 22, 30, 0, DateTimeKind.Utc)); // 23:30 in Lagos
        Device(h, Admin(h), "ExponentPushToken[admin]", alerts: true, quietAtNight: true);
        var (_, tx) = SeedPayment(h, Customer(h));
        await Fulfil(h, tx);

        await Send(h);

        var message = Assert.Single(h.Push.DeviceSends).Message;
        Assert.Equal(PaymentAlertChannels.Quiet, message.ChannelId);
        Assert.Null(message.Sound);
    }

    // ── When the push service fails ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_failed_send_is_tried_again_after_a_minute_and_not_after_three_tries()
    {
        using var h = new TestHarness(Now);
        Device(h, Admin(h), "ExponentPushToken[admin]", alerts: true);
        var (_, tx) = SeedPayment(h, Customer(h));
        await Fulfil(h, tx);
        h.Push.DeviceOutcome = PushDelivery.Failed("Could not reach the Expo push service.");

        await Send(h);
        await Send(h); // too soon
        Assert.Single(h.Push.DeviceSends);

        h.Clock.UtcNow += TimeSpan.FromMinutes(2);
        await Send(h);
        h.Clock.UtcNow += TimeSpan.FromMinutes(2);
        await Send(h);
        h.Clock.UtcNow += TimeSpan.FromMinutes(2);
        await Send(h);

        Assert.Equal(AdminPaymentAlert.MaxAttempts, h.Push.DeviceSends.Count);
        var alert = h.Db.AdminPaymentAlerts.Single();
        Assert.Null(alert.SentAtUtc);
        Assert.Equal(AdminPaymentAlert.MaxAttempts, alert.Attempts);
    }

    [Fact]
    public async Task An_attempt_that_never_recorded_its_result_is_not_sent_again()
    {
        // The claim is committed before the send: a crash after Expo took it must not ring a second time.
        using var h = new TestHarness(Now);
        Device(h, Admin(h), "ExponentPushToken[admin]", alerts: true);
        var (_, tx) = SeedPayment(h, Customer(h));
        await Fulfil(h, tx);
        h.Db.AdminPaymentAlerts.Single().BeginAttempt(Now);
        h.Db.SaveChanges();

        h.Clock.UtcNow += TimeSpan.FromMinutes(5);
        await Send(h);

        Assert.Empty(h.Push.DeviceSends);
    }

    [Fact]
    public async Task An_hour_old_payment_is_no_longer_news()
    {
        using var h = new TestHarness(Now);
        Device(h, Admin(h), "ExponentPushToken[admin]", alerts: true);
        var (_, tx) = SeedPayment(h, Customer(h));
        await Fulfil(h, tx);

        h.Clock.UtcNow += TimeSpan.FromMinutes(61);
        await Send(h);

        Assert.Empty(h.Push.DeviceSends);
    }

    // ── Payment alerts on the phone: the routes ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_admin_sets_their_own_phone_and_cannot_touch_anyone_elses()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        var other = Admin(h, "other@notefusion.studio");
        Device(h, admin, "ExponentPushToken[mine]", alerts: false);
        Device(h, other, "ExponentPushToken[theirs]", alerts: false);
        var caller = new StubCurrentUser(admin.Id, UserRole.Admin);

        var before = (await new GetPaymentAlertSettingsQueryHandler(h.Db, caller, h.Clock)
            .Handle(new GetPaymentAlertSettingsQuery("ExponentPushToken[mine]"), default)).Value;
        Assert.True(before.Registered);
        Assert.False(before.On);
        Assert.Equal(("chime", true, true), (before.Sound, before.Vibrate, before.Problems));

        var set = await new SetPaymentAlertSettingsCommandHandler(h.Db, caller, h.Clock).Handle(
            new SetPaymentAlertSettingsCommand("ExponentPushToken[mine]", true, "none", false, true, true, false), default);
        Assert.True(set.IsSuccess);
        Assert.Equal((true, "none", false, true, true, false),
            (set.Value.On, set.Value.Sound, set.Value.Vibrate, set.Value.QuietAtNight, set.Value.HideNames, set.Value.Problems));

        var theirs = await new SetPaymentAlertSettingsCommandHandler(h.Db, caller, h.Clock).Handle(
            new SetPaymentAlertSettingsCommand("ExponentPushToken[theirs]", true, "chime", true, false, false, true), default);
        Assert.Equal("ADMIN_ALERTS_DEVICE_UNKNOWN", theirs.Error.Code);
        Assert.False(h.Db.DeviceTokens.Single(t => t.Token == "ExponentPushToken[theirs]").PaymentAlerts);

        var unknown = (await new GetPaymentAlertSettingsQueryHandler(h.Db, caller, h.Clock)
            .Handle(new GetPaymentAlertSettingsQuery("ExponentPushToken[theirs]"), default)).Value;
        Assert.False(unknown.Registered);
    }

    [Fact]
    public async Task Mute_for_an_hour_then_unmute()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[mine]", alerts: true);
        var caller = new StubCurrentUser(admin.Id, UserRole.Admin);
        var handler = new MutePaymentAlertsCommandHandler(h.Db, caller, h.Clock);

        var muted = await handler.Handle(new MutePaymentAlertsCommand("ExponentPushToken[mine]", 60), default);
        Assert.Equal(Now.AddHours(1), muted.Value.MutedUntilUtc);

        var unmuted = await handler.Handle(new MutePaymentAlertsCommand("ExponentPushToken[mine]", 0), default);
        Assert.Null(unmuted.Value.MutedUntilUtc);
    }

    [Fact]
    public async Task A_test_alert_goes_to_the_callers_phone_alone_and_never_a_customers()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[mine]", alerts: true);
        Device(h, admin, "ExponentPushToken[tablet]", alerts: true);

        var sent = await new SendTestPaymentAlertCommandHandler(h.Db, new StubCurrentUser(admin.Id, UserRole.Admin), h.Push, h.Clock)
            .Handle(new SendTestPaymentAlertCommand("ExponentPushToken[mine]"), default);

        Assert.True(sent.Value.Sent);
        var (tokens, message) = Assert.Single(h.Push.DeviceSends);
        Assert.Equal(["ExponentPushToken[mine]"], tokens);
        Assert.Equal("payments-v1", message.ChannelId);
        Assert.Equal("payment", message.CategoryId);

        // An account that is not an admin in the database gets nothing, whatever its token says.
        var customer = Customer(h);
        Device(h, customer, "ExponentPushToken[customer]", alerts: true);
        var refused = await new SendTestPaymentAlertCommandHandler(h.Db, new StubCurrentUser(customer.Id, UserRole.Admin), h.Push, h.Clock)
            .Handle(new SendTestPaymentAlertCommand("ExponentPushToken[customer]"), default);
        Assert.Equal("ADMIN_ALERTS_DEVICE_UNKNOWN", refused.Error.Code);
        Assert.Single(h.Push.DeviceSends);
    }

    [Fact]
    public async Task A_test_alert_Google_refuses_says_why_instead_of_saying_sent()
    {
        using var h = new TestHarness(Now);
        var admin = Admin(h);
        Device(h, admin, "ExponentPushToken[mine]", alerts: true);
        h.Push.DeviceOutcome = PushDelivery.Ok(1) with { Tickets = ["ticket-1"] };
        var caller = new StubCurrentUser(admin.Id, UserRole.Admin);

        // Expo took it, but Google's receipt says Expo has no FCM key for the app: every Android push is lost.
        var noKey = await new SendTestPaymentAlertCommandHandler(
                h.Db, caller, h.Push, h.Clock, new StubReceipts(new PushReceipt(PushProblems.InvalidCredentials, "x")))
            .Handle(new SendTestPaymentAlertCommand("ExponentPushToken[mine]"), default);
        Assert.Equal("ADMIN_ALERTS_TEST_REFUSED", noKey.Error.Code);
        Assert.Contains("FCM V1 service account key", noKey.Error.Message);

        // Google took it.
        var took = await new SendTestPaymentAlertCommandHandler(
                h.Db, caller, h.Push, h.Clock, new StubReceipts(new PushReceipt(null, null)))
            .Handle(new SendTestPaymentAlertCommand("ExponentPushToken[mine]"), default);
        Assert.True(took.Value.Sent);
        Assert.True(took.Value.Confirmed);

        // No answer in time: sent, not confirmed.
        var pending = await new SendTestPaymentAlertCommandHandler(h.Db, caller, h.Push, h.Clock, new StubReceipts(null))
            .Handle(new SendTestPaymentAlertCommand("ExponentPushToken[mine]"), default);
        Assert.True(pending.Value.Sent);
        Assert.False(pending.Value.Confirmed);

        // Refused at the send itself: this phone's registration is dead.
        h.Push.DeviceOutcome = PushDelivery.Failed("not registered", 1, PushProblems.DeviceNotRegistered);
        var dead = await new SendTestPaymentAlertCommandHandler(h.Db, caller, h.Push, h.Clock, new StubReceipts(null))
            .Handle(new SendTestPaymentAlertCommand("ExponentPushToken[mine]"), default);
        Assert.Equal("ADMIN_ALERTS_TEST_REFUSED", dead.Error.Code);
        Assert.Contains("Profile › Notifications", dead.Error.Message);
    }

    private sealed class StubReceipts(PushReceipt? receipt) : IPushReceipts
    {
        public Task<PushReceipt?> WaitAsync(string ticketId, TimeSpan within, CancellationToken ct = default)
            => Task.FromResult(receipt);

        public PushReceiptStats Stats(DateTime utcNow) => PushReceiptStats.None;
    }

    [Fact]
    public void Every_new_admin_route_requires_the_admin_policy()
    {
        // Payment alerts, and the existing routes the phone admin newly reads with new parameters.
        foreach (var controller in new[] { typeof(AdminAlertsController), typeof(AdminLockController), typeof(AdminController), typeof(AnalyticsController) })
        {
            var authorize = controller.GetCustomAttribute<AuthorizeAttribute>();
            Assert.NotNull(authorize);
            Assert.Equal(AuthorizationPolicies.Admin, authorize!.Policy);
            Assert.All(controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly),
                m => Assert.Null(m.GetCustomAttribute<AllowAnonymousAttribute>()));
        }

        Assert.Equal("api/admin/alerts", typeof(AdminAlertsController).GetCustomAttribute<RouteAttribute>(inherit: false)!.Template);
        Assert.Equal("device", typeof(AdminAlertsController).GetMethod(nameof(AdminAlertsController.GetDevice))!.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.Equal("device", typeof(AdminAlertsController).GetMethod(nameof(AdminAlertsController.SetDevice))!.GetCustomAttribute<HttpPutAttribute>()!.Template);
        Assert.Equal("device/mute", typeof(AdminAlertsController).GetMethod(nameof(AdminAlertsController.Mute))!.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.Equal("test", typeof(AdminAlertsController).GetMethod(nameof(AdminAlertsController.Test))!.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }

    [Fact]
    public async Task On_a_phone_with_no_lock_the_admin_password_opens_admin_and_wrong_ones_count_towards_the_lockout()
    {
        using var h = new TestHarness(Now);
        var admin = User.CreateAdmin("Francis", "admin@notefusion.studio", h.Hasher.Hash("correct horse 9"), Now.AddDays(-90));
        h.Db.Users.Add(admin);
        h.Db.SaveChanges();
        var handler = new NoteFusion.Application.Admin.Commands.ConfirmAdminPasswordCommandHandler(
            h.Db, new StubCurrentUser(admin.Id, UserRole.Admin), h.Hasher, h.Clock);
        var command = (string p) => new NoteFusion.Application.Admin.Commands.ConfirmAdminPasswordCommand(p);

        Assert.True((await handler.Handle(command("correct horse 9"), default)).IsSuccess);
        Assert.Equal("ADMIN_PASSWORD_INCORRECT", (await handler.Handle(command("guess"), default)).Error.Code);

        for (var i = 0; i < 10 && !admin.IsLockedOut(h.Clock.UtcNow); i++)
            await handler.Handle(command("guess"), default);
        Assert.Equal("ADMIN_PASSWORD_LOCKED", (await handler.Handle(command("correct horse 9"), default)).Error.Code);
    }

    [Fact]
    public async Task A_customer_is_forbidden_the_admin_policy_even_with_a_token_that_claims_admin()
    {
        using var h = new TestHarness(Now);
        var customer = Customer(h);
        var admin = Admin(h);

        // The policy as Program.cs registers it, evaluated as ASP.NET does for each [Authorize(Policy = Admin)] route.
        var policy = new AuthorizationOptions().AddNoteFusionPolicies().GetPolicy(AuthorizationPolicies.Admin)!;
        var handler = new CurrentAdminHandler(new UserAccessCache(new MemoryCache(new MemoryCacheOptions())), h.Db, new HttpContextAccessor());
        // A browser's token (no phone claim): the phone's lock passes it, and the role is what is tested here.
        var phone = new UnlockedPhoneHandler(new NoteFusion.Infrastructure.Security.InMemoryAdminPhoneLock(), new HttpContextAccessor(), h.Clock);

        async Task<bool> Allowed(Guid userId, string role)
        {
            var principal = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.Role, role), new Claim("sub", userId.ToString())], "Bearer"));
            var context = new AuthorizationHandlerContext(policy.Requirements, principal, null);
            foreach (var requirement in policy.Requirements.OfType<IAuthorizationHandler>())
                await requirement.HandleAsync(context);
            await handler.HandleAsync(context);
            await phone.HandleAsync(context);
            return context.HasSucceeded;
        }

        Assert.True(await Allowed(admin.Id, "Admin"));
        Assert.False(await Allowed(customer.Id, "User"));
        Assert.False(await Allowed(customer.Id, "Admin")); // a forged or stale claim: the database says User
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────

    private static Task<Result<PaymentAlertRun>> Send(TestHarness h)
        => new SendPaymentAlertsCommandHandler(h.Db, h.Push, h.Clock, NullLogger<SendPaymentAlertsCommandHandler>.Instance)
            .Handle(new SendPaymentAlertsCommand(), default);

    private static User Admin(TestHarness h, string email = "admin@notefusion.studio")
    {
        var user = User.CreateAdmin("Francis", email, "hash", Now.AddDays(-90));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static User Customer(TestHarness h, string name = "Ada Obi", string email = "ada@example.com", string country = "NG")
    {
        var existing = h.Db.Users.FirstOrDefault(u => u.Email == email);
        if (existing is not null)
            email = $"{Guid.NewGuid():N}@example.com";
        var user = User.Create(name, email, "hash", Now.AddDays(-30));
        user.RecordCountry(country);
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static DeviceToken Device(
        TestHarness h, User user, string token, bool alerts, bool hideNames = false, string sound = "chime",
        bool vibrate = true, bool quietAtNight = false, string platform = "android")
    {
        var device = DeviceToken.Create(user.Id, token, platform, 42, Now.AddDays(-1));
        device.SetPaymentAlerts(alerts, sound, vibrate, quietAtNight, hideNames, problems: true, Now.AddDays(-1));
        h.Db.DeviceTokens.Add(device);
        h.Db.SaveChanges();
        return device;
    }

    private static (Plan Plan, PaymentTransaction Tx) SeedPayment(
        TestHarness h, User user, long amount = 750_000, string currency = "NGN",
        string planName = "NoteFusion Pro (Monthly)", BillingInterval interval = BillingInterval.Monthly)
    {
        var plan = Plan.Create(Guid.NewGuid(), $"plan_{Guid.NewGuid():N}", planName, amount, currency, interval);
        var reference = $"NF_{Guid.NewGuid():N}";
        var tx = PaymentTransaction.Create(user.Id, plan.Id, PaymentProvider.Paystack, $"checkout:{reference}", reference, amount, currency, Now.AddMinutes(-3));
        tx.AttachCheckout($"ps_{reference}", "https://checkout.paystack.com/x", "{}", Now.AddMinutes(-3));
        h.Db.Plans.Add(plan);
        h.Db.PaymentTransactions.Add(tx);
        h.Db.SaveChanges();
        return (plan, tx);
    }

    /// <summary>Fulfils the payment the way production does: through the webhook handler.</summary>
    private static async Task Fulfil(TestHarness h, PaymentTransaction tx, string eventId = "evt_paid")
    {
        var e = WebhookEvent.Receive(PaymentProvider.Paystack, eventId, "charge.success", tx.Reference, "{}", h.Clock.UtcNow);
        h.Db.WebhookEvents.Add(e);
        await h.Db.SaveChangesAsync();

        var verification = new GatewayVerification(
            Succeeded: true, AmountMinor: tx.AmountMinor, Currency: tx.Currency, ProviderReference: $"ps_{tx.Reference}",
            ProviderSubscriptionRef: null, Raw: "{}", Terminal: true);
        var result = await new ProcessWebhookEventCommandHandler(h.Db, new Gateway(verification), h.Clock, h.Email)
            .Handle(new ProcessWebhookEventCommand(e.Id), default);
        Assert.True(result.IsSuccess);
    }

    private sealed class Gateway(GatewayVerification answer) : IPaymentGatewayFactory, IPaymentGateway
    {
        public PaymentProvider Provider => PaymentProvider.Paystack;
        public IReadOnlyCollection<string> SupportedCurrencies { get; } = ["NGN", "USD"];
        public IPaymentGateway Resolve(PaymentProvider provider) => this;
        public Result<IPaymentGateway> SelectForCurrency(string currency) => Result.Success<IPaymentGateway>(this);

        public Task<Result<GatewayInitiation>> InitiateAsync(GatewayInitiationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(new GatewayInitiation("https://checkout.paystack.com/s", "ps_1", "{}")));

        public Task<Result<GatewayVerification>> VerifyAsync(GatewayVerificationRequest request, CancellationToken ct)
            => Task.FromResult(Result.Success(answer));
    }
}
