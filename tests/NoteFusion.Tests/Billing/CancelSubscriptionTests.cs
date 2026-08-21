using NoteFusion.Application.Billing.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Cancelling a subscription from the app. The rule that matters is that cancelling does not take
/// anything away: the customer paid for a period and keeps it, so a build that flips them to Free on the
/// spot has stolen the rest of the month. The other half is that "cancel" here cannot mean "stop the
/// recurring charge", because nothing in this system charges off-session — so what it must do is record
/// the intent, which the expiring-soon notice then reads to stop claiming the plan renews.
/// </summary>
public class CancelSubscriptionTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Cancelling_keeps_pro_until_the_period_ends()
    {
        using var h = new TestHarness(Now);
        var (user, sub) = Seed(h, endsIn: TimeSpan.FromDays(20));

        var result = await Cancel(h, user);

        Assert.True(result.IsSuccess);
        Assert.Equal(SubscriptionStatus.Canceled, sub.Status);
        Assert.Equal(Now, sub.CanceledAtUtc);

        // The whole point: they paid to the 8th of next month, so they have Pro until the 8th.
        Assert.True(sub.IsActiveAt(Now));
        Assert.True(sub.IsActiveAt(Now.AddDays(19)));
        Assert.False(sub.IsActiveAt(Now.AddDays(21)));
    }

    [Fact]
    public async Task Cancelling_twice_is_a_no_op_rather_than_an_error()
    {
        using var h = new TestHarness(Now);
        var (user, sub) = Seed(h, endsIn: TimeSpan.FromDays(20));

        await Cancel(h, user);
        h.Clock.UtcNow = Now.AddDays(1);
        var second = await Cancel(h, user);

        // A double tap, or a retry after a dropped response, must not fail in the customer's face.
        Assert.True(second.IsSuccess);
        Assert.Equal(Now, sub.CanceledAtUtc); // and the original timestamp stands
    }

    [Fact]
    public async Task A_lifetime_purchase_cannot_be_cancelled()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Lee Life", "lee@example.com", h.Hasher.Hash("password123"), Now.AddDays(-90));
        var plan = Plan.Create(Guid.NewGuid(), "pro_lifetime", "NoteFusion Pro Lifetime", 9900, "USD", BillingInterval.Lifetime);
        var sub = Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack,
            Now.AddDays(-90), Subscription.LifetimeEndUtc, null, Now.AddDays(-90));
        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(sub);
        h.Db.SaveChanges();

        var result = await Cancel(h, user);

        // Marking it Canceled would change nothing — the sentinel period end never arrives — while
        // telling someone who paid the most that their access is ending.
        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_LIFETIME_NOT_CANCELABLE", result.Error.Code);
        Assert.Equal(SubscriptionStatus.Active, sub.Status);
    }

    [Fact]
    public async Task A_user_who_never_subscribed_gets_nothing_to_cancel()
    {
        using var h = new TestHarness(Now);
        var user = User.Create("Free Fran", "fran@example.com", h.Hasher.Hash("password123"), Now.AddDays(-3));
        h.Db.Users.Add(user);
        h.Db.SaveChanges();

        var result = await Cancel(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_NO_ACTIVE_SUBSCRIPTION", result.Error.Code);
    }

    [Fact]
    public async Task An_already_lapsed_subscription_cannot_be_cancelled()
    {
        using var h = new TestHarness(Now);
        var (user, sub) = Seed(h, endsIn: TimeSpan.FromDays(-1));

        var result = await Cancel(h, user);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_NO_ACTIVE_SUBSCRIPTION", result.Error.Code);
        Assert.Equal(SubscriptionStatus.Active, sub.Status);
    }

    [Fact]
    public async Task One_user_cannot_cancel_another_users_subscription()
    {
        using var h = new TestHarness(Now);
        var (_, victim) = Seed(h, endsIn: TimeSpan.FromDays(20));
        var attacker = User.Create("Nosy Ned", "ned@example.com", h.Hasher.Hash("password123"), Now);
        h.Db.Users.Add(attacker);
        h.Db.SaveChanges();

        var result = await Cancel(h, attacker);

        // The command takes no id at all — it cancels whoever is signed in — which is what makes this
        // unreachable rather than merely guarded. The test pins the shape so a later "cancel by id"
        // convenience cannot quietly open it.
        Assert.True(result.IsFailure);
        Assert.Equal(SubscriptionStatus.Active, victim.Status);
    }

    [Fact]
    public async Task A_signed_out_caller_is_rejected()
    {
        using var h = new TestHarness(Now);

        var result = await new CancelSubscriptionCommandHandler(h.Db, new StubCurrentUser(null), h.Clock)
            .Handle(new CancelSubscriptionCommand(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_NOT_AUTHENTICATED", result.Error.Code);
    }

    [Fact]
    public async Task The_expiring_notice_stops_claiming_the_plan_renews_once_cancelled()
    {
        using var h = new TestHarness(Now);
        var (user, sub) = Seed(h, endsIn: TimeSpan.FromDays(5));

        await Cancel(h, user);
        await new NotifySubscriptionExpiringCommandHandler(h.Db, h.Clock, h.Email, h.Push)
            .Handle(new NotifySubscriptionExpiringCommand(sub.Id), CancellationToken.None);

        // This is the whole observable effect of cancelling, so it is worth asserting end-to-end rather
        // than trusting that the notice happens to read Status.
        Assert.False(Assert.Single(h.Email.Expiring).WillRenew);
        Assert.Contains("ends", Assert.Single(h.Push.Sent).Message.Title);
    }

    // ---------------------------------------------------------------- fixtures

    private static (User User, Subscription Subscription) Seed(TestHarness h, TimeSpan endsIn)
    {
        var user = User.Create("Pat Pro", "pat@example.com", h.Hasher.Hash("password123"), Now.AddDays(-60));
        var plan = Plan.Create(Guid.NewGuid(), "pro_monthly", "NoteFusion Pro", 499, "USD", BillingInterval.Monthly);
        var sub = Subscription.Start(
            user.Id, plan.Id, PaymentProvider.Paystack,
            Now - TimeSpan.FromDays(30) + endsIn, Now + endsIn, "prov-sub-1", Now.AddDays(-30));

        h.Db.Users.Add(user);
        h.Db.Plans.Add(plan);
        h.Db.Subscriptions.Add(sub);
        h.Db.SaveChanges();

        return (user, sub);
    }

    private static Task<Result> Cancel(TestHarness h, User caller)
        => new CancelSubscriptionCommandHandler(h.Db, new StubCurrentUser(caller.Id), h.Clock)
            .Handle(new CancelSubscriptionCommand(), CancellationToken.None);
}
