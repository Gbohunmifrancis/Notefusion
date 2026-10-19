using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Billing.GooglePlay;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Infrastructure.Billing;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Google Play purchases through <see cref="GooglePlaySync"/>, against a scripted Google: what is granted, recorded,
/// acknowledged and refused, and how the membership follows Google through renewal, cancellation, grace, hold and refund.
/// </summary>
public class GooglePlaySyncTests
{
    private static readonly DateTime Now = new(2026, 10, 18, 12, 0, 0, DateTimeKind.Utc);
    private const string Token = "play-token-1";
    private const string Order = "GPA.3333-4137-0319-36762";

    [Fact]
    public async Task A_new_subscription_is_granted_to_googles_date_recorded_once_and_acknowledged()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        play.Orders[Order] = new PlayOrder(750_000, "NGN", "PROCESSED");

        var dto = await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        Assert.True(dto.IsSuccess);
        Assert.True(dto.Value.IsActive);
        Assert.Equal(Now.AddDays(30), dto.Value.CurrentPeriodEndUtc);
        Assert.Equal("googlePlay", dto.Value.BilledThrough);
        Assert.True(dto.Value.AutoRenews);
        Assert.Equal("pro", dto.Value.StoreProductId);

        var tx = Assert.Single(h.Db.PaymentTransactions);
        Assert.Equal(PaymentProvider.GooglePlay, tx.Provider);
        Assert.Equal(Order, tx.Reference);
        Assert.Equal(PaymentStatus.Completed, tx.Status);
        Assert.Equal(750_000, tx.AmountMinor);
        Assert.Equal(monthly.Id, tx.PlanId);
        Assert.Single(h.Db.LedgerEntries);
        Assert.Single(h.Db.AdminPaymentAlerts);
        Assert.Equal(["pro:" + Token], play.Acknowledged);
        Assert.True(h.Db.GooglePlayPurchases.Single().Acknowledged);
        Assert.Single(h.Email.Receipts);

        // The same purchase again (the app's restore, Google's notification): nothing new.
        var again = await Register(h, play, user, GooglePlaySync.ProProduct, Token);
        Assert.True(again.IsSuccess);
        Assert.Single(h.Db.PaymentTransactions);
        Assert.Single(h.Email.Receipts);
        Assert.Single(play.Acknowledged);
    }

    [Fact]
    public async Task A_purchase_made_on_another_account_is_refused_and_grants_nothing()
    {
        using var h = new TestHarness(Now);
        var (buyer, _, _) = Seed(h);
        var other = AddUser(h, "other@example.com");
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(buyer, GooglePlaySync.StateActive, Now.AddDays(30), Order);

        var result = await Register(h, play, other, GooglePlaySync.ProProduct, Token);

        Assert.Equal(BillingErrors.PlayOtherAccount, result.Error);
        Assert.Empty(h.Db.PaymentTransactions);
        Assert.Empty(h.Db.Subscriptions);
    }

    [Fact]
    public async Task A_token_claimed_by_one_account_cannot_be_claimed_by_another()
    {
        using var h = new TestHarness(Now);
        var (first, _, _) = Seed(h);
        var second = AddUser(h, "second@example.com");
        var play = new FakePlay();
        // Bought without an account id (outside the app): the first account to hand it over owns it.
        play.Subscriptions[Token] = Sub(null, GooglePlaySync.StateActive, Now.AddDays(30), Order);

        Assert.True((await Register(h, play, first, GooglePlaySync.ProProduct, Token)).IsSuccess);
        var stolen = await Register(h, play, second, GooglePlaySync.ProProduct, Token);

        Assert.Equal(BillingErrors.PlayOtherAccount, stolen.Error);
        Assert.Equal(first.Id, h.Db.GooglePlayPurchases.Single().UserId);
    }

    [Fact]
    public async Task A_renewal_records_its_order_and_moves_the_period_to_googles_new_date()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        play.Orders[Order] = new PlayOrder(750_000, "NGN", "PROCESSED");
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        h.Clock.UtcNow = Now.AddDays(30);
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(60), Order + "..0");
        play.Orders[Order + "..0"] = new PlayOrder(750_000, "NGN", "PROCESSED");
        var notified = await Notify(h, play, Token);

        Assert.True(notified.IsSuccess);
        Assert.Equal(2, h.Db.PaymentTransactions.Count());
        var sub = h.Db.Subscriptions.Single();
        Assert.Equal(Now.AddDays(60), sub.CurrentPeriodEndUtc);
        Assert.Equal(SubscriptionStatus.Active, sub.Status);
        // Google sends a receipt for each charge; ours went with the purchase only.
        Assert.Single(h.Email.Receipts);
    }

    [Fact]
    public async Task Cancelled_in_play_keeps_pro_to_the_paid_date_and_stops_saying_it_renews()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateCanceled, Now.AddDays(30), Order, autoRenew: false);
        await Notify(h, play, Token);

        var sub = h.Db.Subscriptions.Single();
        Assert.Equal(SubscriptionStatus.Canceled, sub.Status);
        Assert.Equal(Now.AddDays(30), sub.CurrentPeriodEndUtc);
        var dto = await Mine(h, user);
        Assert.True(dto.IsActive);
        Assert.False(dto.AutoRenews);
        Assert.Null(dto.PaymentIssue);
    }

    [Fact]
    public async Task A_failed_renewal_keeps_pro_through_the_grace_period_then_pauses_it_on_hold()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        // Google extends the expiry through the grace period, with no new order.
        h.Clock.UtcNow = Now.AddDays(31);
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateGrace, Now.AddDays(33), Order);
        await Notify(h, play, Token);
        var grace = await Mine(h, user);
        Assert.True(grace.IsActive);
        Assert.Equal("grace", grace.PaymentIssue);
        Assert.Single(h.Db.PaymentTransactions);

        // Still unpaid: account hold, an expiry in the past.
        h.Clock.UtcNow = Now.AddDays(34);
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateOnHold, Now.AddDays(33), Order);
        await Notify(h, play, Token);
        var hold = await Mine(h, user);
        Assert.False(hold.IsActive);
        Assert.Equal("hold", hold.PaymentIssue);
        Assert.Equal("googlePlay", hold.BilledThrough);
    }

    [Fact]
    public async Task A_refund_ends_pro_at_once()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        h.Clock.UtcNow = Now.AddDays(2);
        play.Subscriptions[Token] = Sub(user, "SUBSCRIPTION_STATE_EXPIRED", Now.AddDays(2).AddMinutes(-5), Order, autoRenew: false);
        await Notify(h, play, Token);

        Assert.False((await Mine(h, user)).IsActive);
        Assert.Equal(SubscriptionStatus.Expired, h.Db.Subscriptions.Single().Status);
    }

    [Fact]
    public async Task A_pending_purchase_grants_nothing_until_google_has_the_money()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StatePending, null, null);

        var dto = await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        Assert.True(dto.IsSuccess);
        Assert.False(dto.Value.IsActive);
        Assert.Empty(h.Db.PaymentTransactions);
        Assert.Empty(play.Acknowledged);
    }

    [Fact]
    public async Task Access_google_grants_never_waits_on_an_order_it_cannot_read()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        // No order readable (the service account lacks financial access): the plan's price stands in.

        var dto = await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        Assert.True(dto.Value.IsActive);
        var tx = h.Db.PaymentTransactions.Single();
        Assert.Equal(monthly.AmountMinor, tx.AmountMinor);
        Assert.Equal(monthly.Currency, tx.Currency);
    }

    [Fact]
    public async Task A_refunded_order_is_not_counted_as_money()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        play.Orders[Order] = new PlayOrder(750_000, "NGN", "REFUNDED");

        var dto = await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        // Google still grants the period, so Pro runs; the refunded money is not recorded.
        Assert.True(dto.Value.IsActive);
        Assert.Empty(h.Db.PaymentTransactions);
    }

    [Fact]
    public async Task An_upgrade_to_yearly_replaces_the_old_token_and_switches_the_plan()
    {
        using var h = new TestHarness(Now);
        var (user, _, yearly) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        play.Subscriptions["play-token-2"] = Sub(
            user, GooglePlaySync.StateActive, Now.AddDays(365), "GPA.9999-0000-0000-00001", basePlan: "yearly", linked: Token);
        play.Subscriptions[Token] = Sub(user, "SUBSCRIPTION_STATE_EXPIRED", Now, Order, autoRenew: false);
        await Register(h, play, user, GooglePlaySync.ProProduct, "play-token-2");

        var sub = h.Db.Subscriptions.Single();
        Assert.Equal(yearly.Id, sub.PlanId);
        Assert.Equal(Now.AddDays(365), sub.CurrentPeriodEndUtc);
        Assert.Equal("play-token-2", h.Db.GooglePlayPurchases.Single(p => p.PurchaseToken == Token).ReplacedByToken);

        // The old token's own expiry, notified late, changes nothing: it no longer governs.
        await Notify(h, play, Token);
        Assert.Equal(Now.AddDays(365), h.Db.Subscriptions.Single().CurrentPeriodEndUtc);
    }

    [Fact]
    public async Task A_choir_bought_through_play_starts_the_directors_choir_to_googles_date()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var choirPlan = Plan.Create(Guid.NewGuid(), "choir_monthly_ngn", "NoteFusion Choir (Monthly)", 2_500_000, "NGN",
            BillingInterval.Monthly, choirSeats: 25);
        h.Db.Plans.Add(choirPlan);
        h.Db.SaveChanges();
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order, product: GooglePlaySync.ChoirProduct);

        var dto = await Register(h, play, user, GooglePlaySync.ChoirProduct, Token);

        Assert.True(dto.Value.IsActive);
        var choir = h.Db.Choirs.Single();
        Assert.Equal(PaymentProvider.GooglePlay, choir.Provider);
        Assert.Equal(Now.AddDays(30), choir.CurrentPeriodEndUtc);
        Assert.Equal(choirPlan.Id, choir.PlanId);
        Assert.Empty(h.Db.Subscriptions);
        Assert.Equal("director", dto.Value.ChoirRole);
        Assert.Equal("googlePlay", dto.Value.BilledThrough);
    }

    [Fact]
    public async Task A_one_song_purchase_is_one_bought_transcription_consumed_at_google_and_counted_once()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var song = Plan.Create(Guid.NewGuid(), "one_song_ngn", "One song", 150_000, "NGN", BillingInterval.Single);
        h.Db.Plans.Add(song);
        h.Db.SaveChanges();
        var play = new FakePlay();
        play.OneTime[Token] = new PlayOneTimePurchase("PURCHASED", Order, user.Id.ToString("N"), false, false, "NG", "{}");
        play.Orders[Order] = new PlayOrder(150_000, "NGN", "PROCESSED");

        var dto = await Register(h, play, user, GooglePlaySync.SongProduct, Token);

        Assert.True(dto.IsSuccess);
        Assert.Equal(1, dto.Value.BoughtTranscriptionsRemaining);
        Assert.False(dto.Value.IsActive);
        Assert.Equal(["one_song:" + Token], play.Consumed);

        await Register(h, play, user, GooglePlaySync.SongProduct, Token);
        Assert.Single(h.Db.PaymentTransactions);
        Assert.Single(play.Consumed);
    }

    [Fact]
    public async Task Without_a_service_account_nothing_is_granted_and_the_app_is_told_to_try_again()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay { IsConfigured = false };

        var result = await Register(h, play, user, GooglePlaySync.ProProduct, Token);

        Assert.Equal(BillingErrors.PlayNotConfigured, result.Error);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task The_website_cannot_charge_or_cancel_a_membership_google_play_renews()
    {
        using var h = new TestHarness(Now);
        var (user, monthly, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);
        var caller = new StubCurrentUser(user.Id);

        var checkout = await new InitiateCheckoutCommandHandler(
                h.Db, caller, new PaymentGatewayFactory([], new BillingSettings()), h.Clock, new BillingSettings(), h.Email)
            .Handle(new InitiateCheckoutCommand(monthly.Id), CancellationToken.None);
        var cancel = await new CancelSubscriptionCommandHandler(h.Db, caller, h.Clock)
            .Handle(new CancelSubscriptionCommand(), CancellationToken.None);

        Assert.Equal(BillingErrors.ManagedByGooglePlay, checkout.Error);
        Assert.Equal(BillingErrors.ManagedByGooglePlay, cancel.Error);
        Assert.Equal(SubscriptionStatus.Active, h.Db.Subscriptions.Single().Status);
    }

    [Fact]
    public async Task No_buy_again_email_goes_to_a_membership_google_play_renews()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddHours(6), Order);
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);
        var sent = h.Email.Sent.Count;

        var result = await new NotifySubscriptionExpiringCommandHandler(h.Db, h.Clock, h.Email, h.Push)
            .Handle(new NotifySubscriptionExpiringCommand(h.Db.Subscriptions.Single().Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(sent, h.Email.Sent.Count);
    }

    // ---------------------------------------------------------------- notifications

    [Fact]
    public async Task A_notification_for_another_app_or_an_unknown_token_is_acknowledged_and_changes_nothing()
    {
        using var h = new TestHarness(Now);
        Seed(h);
        var play = new FakePlay();

        var otherApp = await Handle(h, play, """{"packageName":"com.someone.else","subscriptionNotification":{"purchaseToken":"x"}}""");
        var unknown = await Handle(h, play, """{"packageName":"com.notefusion.com","subscriptionNotification":{"purchaseToken":"nope"}}""");
        var test = await Handle(h, play, """{"packageName":"com.notefusion.com","testNotification":{"version":"1.0"}}""");

        Assert.True(otherApp.IsSuccess);
        Assert.True(unknown.IsSuccess);
        Assert.True(test.IsSuccess);
        Assert.Empty(h.Db.GooglePlayPurchases);
    }

    [Fact]
    public async Task A_notification_google_could_not_be_asked_about_is_delivered_again()
    {
        using var h = new TestHarness(Now);
        Seed(h);
        var play = new FakePlay { Unavailable = true };

        var result = await Handle(h, play, $$$"""{"packageName":"com.notefusion.com","subscriptionNotification":{"purchaseToken":"{{{Token}}}"}}""");

        Assert.True(result.IsFailure);
        Assert.Equal(ErrorType.Network, result.Error.Type);
    }

    [Fact]
    public async Task A_purchase_notified_before_the_app_calls_waits_for_the_app_whatever_account_id_it_names()
    {
        using var h = new TestHarness(Now);
        var (user, _, _) = Seed(h);
        var play = new FakePlay();
        play.Subscriptions[Token] = Sub(user, GooglePlaySync.StateActive, Now.AddDays(30), Order);

        var result = await Notify(h, play, Token);

        // The account id is whatever the buying app set; on its own it ties nothing (a modified app could name anyone).
        Assert.True(result.IsSuccess);
        Assert.False((await Mine(h, user)).IsActive);
        Assert.Empty(h.Db.GooglePlayPurchases);
        Assert.Empty(play.Acknowledged);

        // The account's own app hands it over, and it is granted then.
        await Register(h, play, user, GooglePlaySync.ProProduct, Token);
        Assert.True((await Mine(h, user)).IsActive);
        Assert.Single(play.Acknowledged);
    }

    // ---------------------------------------------------------------- helpers

    private static (User User, Plan Monthly, Plan Yearly) Seed(TestHarness h)
    {
        var user = User.Create("Ada Obi", "ada@example.com", h.Hasher.Hash("secret"), Now.AddDays(-10));
        var monthly = Plan.Create(Guid.NewGuid(), "pro_monthly_ngn", "NoteFusion Pro (Monthly)", 750_000, "NGN", BillingInterval.Monthly);
        var yearly = Plan.Create(Guid.NewGuid(), "pro_yearly_ngn_v2", "NoteFusion Pro (Yearly)", 6_000_000, "NGN", BillingInterval.Yearly);
        h.Db.Users.Add(user);
        h.Db.Plans.AddRange(monthly, yearly);
        h.Db.SaveChanges();
        return (user, monthly, yearly);
    }

    private static User AddUser(TestHarness h, string email)
    {
        var user = User.Create("Someone Else", email, h.Hasher.Hash("secret"), Now.AddDays(-5));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();
        return user;
    }

    private static PlaySubscription Sub(
        User? owner, string state, DateTime? expiry, string? orderId, bool autoRenew = true, string basePlan = "monthly",
        string? linked = null, string product = GooglePlaySync.ProProduct)
        => new(state, product, basePlan, expiry, autoRenew, orderId, linked, owner?.Id.ToString("N"),
            Acknowledged: false, RegionCode: "NG", Raw: "{}");

    private static GooglePlaySync Sync(TestHarness h, IGooglePlayClient play)
        => new(h.Db, play, h.Clock, h.Email, h.QuotaGate, NullLogger<GooglePlaySync>.Instance);

    private static Task<Result<Application.Billing.Dtos.SubscriptionDto>> Register(
        TestHarness h, IGooglePlayClient play, User user, string product, string token)
    {
        var caller = new StubCurrentUser(user.Id);
        return new RegisterGooglePlayPurchaseCommandHandler(Sync(h, play), caller, new HarnessSender(h, currentUser: caller))
            .Handle(new RegisterGooglePlayPurchaseCommand(product, token), CancellationToken.None);
    }

    private static Task<Result> Notify(TestHarness h, IGooglePlayClient play, string token)
        => Handle(h, play, $$$"""{"packageName":"com.notefusion.com","subscriptionNotification":{"notificationType":2,"purchaseToken":"{{{token}}}","subscriptionId":"pro"}}""");

    private static Task<Result> Handle(TestHarness h, IGooglePlayClient play, string json)
        => new HandleGooglePlayNotificationCommandHandler(Sync(h, play), play, NullLogger<HandleGooglePlayNotificationCommandHandler>.Instance)
            .Handle(new HandleGooglePlayNotificationCommand(json), CancellationToken.None);

    private static async Task<Application.Billing.Dtos.SubscriptionDto> Mine(TestHarness h, User user)
        => (await new GetMySubscriptionQueryHandler(h.Db, new StubCurrentUser(user.Id), h.Clock, h.Device)
            .Handle(new GetMySubscriptionQuery(), CancellationToken.None)).Value;

    /// <summary>Google, scripted: what each token and order reads as, and what was acknowledged or consumed.</summary>
    private sealed class FakePlay : IGooglePlayClient
    {
        public bool IsConfigured { get; init; } = true;
        public bool Unavailable { get; init; }
        public string PackageName => "com.notefusion.com";
        public Dictionary<string, PlaySubscription> Subscriptions { get; } = [];
        public Dictionary<string, PlayOneTimePurchase> OneTime { get; } = [];
        public Dictionary<string, PlayOrder> Orders { get; } = [];
        public List<string> Acknowledged { get; } = [];
        public List<string> Consumed { get; } = [];

        public Task<Result<PlaySubscription>> GetSubscriptionAsync(string purchaseToken, CancellationToken ct)
            => Task.FromResult<Result<PlaySubscription>>(Unavailable
                ? BillingErrors.PlayUnavailable
                : Subscriptions.TryGetValue(purchaseToken, out var s) ? s : BillingErrors.PlayPurchaseNotFound);

        public Task<Result<PlayOneTimePurchase>> GetOneTimePurchaseAsync(string productId, string purchaseToken, CancellationToken ct)
            => Task.FromResult<Result<PlayOneTimePurchase>>(
                OneTime.TryGetValue(purchaseToken, out var p) ? p with { Consumed = Consumed.Contains($"{productId}:{purchaseToken}") }
                    : BillingErrors.PlayPurchaseNotFound);

        public Task<Result<PlayOrder>> GetOrderAsync(string orderId, CancellationToken ct)
            => Task.FromResult<Result<PlayOrder>>(Orders.TryGetValue(orderId, out var o) ? o : BillingErrors.PlayUnavailable);

        public Task<Result> AcknowledgeSubscriptionAsync(string productId, string purchaseToken, CancellationToken ct)
        {
            Acknowledged.Add($"{productId}:{purchaseToken}");
            if (Subscriptions.TryGetValue(purchaseToken, out var s))
                Subscriptions[purchaseToken] = s with { Acknowledged = true };
            return Task.FromResult(Result.Success());
        }

        public Task<Result> ConsumeAsync(string productId, string purchaseToken, CancellationToken ct)
        {
            Consumed.Add($"{productId}:{purchaseToken}");
            return Task.FromResult(Result.Success());
        }
    }
}
