using NoteFusion.Application.Billing.Commands;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Tests.Support;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// The warning that goes out before a paid period ends. Nothing else in the system looks ahead of a
/// period end, so without this a renewal charge arrives with no warning — which is how chargebacks
/// start — and a cancelled subscription lapses in silence.
/// <para>
/// The rule worth pinning is "once per period". The flag stores the period end it was sent for rather
/// than a bool, so <c>Renew()</c> moving the end re-arms the notice with no reset logic to forget; a
/// build that stores a bool passes the send-once test and then never warns the customer again.
/// </para>
/// </summary>
public class SubscriptionExpiryTests
{
    private static readonly DateTime Now = new(2026, 8, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_subscription_ending_in_five_days_is_warned_by_email_and_push()
    {
        using var h = new TestHarness(Now);
        var (user, sub) = Seed(h, endsIn: TimeSpan.FromDays(5));

        var result = await Notify(h, sub);

        Assert.True(result.IsSuccess);
        Assert.Equal(("subscription-expiring", user.Email), Kind(h));

        var expiry = Assert.Single(h.Email.Expiring);
        Assert.Equal("NoteFusion Pro", expiry.PlanName);
        Assert.Equal(5, expiry.DaysLeft);
        // Nothing renews by itself, so even an active membership is told the date it ends.
        Assert.False(expiry.WillRenew);

        // Both channels, because either one alone is silently unreachable for some accounts.
        var (recipients, message) = Assert.Single(h.Push.Sent);
        Assert.Equal([user.Id], recipients);
        Assert.Equal("Upgrade", message.Data!["screen"]);
    }

    [Fact]
    public async Task A_cancelled_subscription_is_told_it_ends_rather_than_renews()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromDays(5));
        sub.Cancel(Now.AddDays(-1));
        h.Db.SaveChanges();

        await Notify(h, sub);

        // Still inside the paid window, so they keep Pro — but telling them it "renews automatically"
        // would be a lie, and the one that costs the most trust.
        Assert.False(Assert.Single(h.Email.Expiring).WillRenew);
        Assert.Contains("ends", Assert.Single(h.Push.Sent).Message.Title);
    }

    [Fact]
    public async Task The_same_period_is_never_warned_about_twice()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromDays(5));

        await Notify(h, sub);
        h.Clock.UtcNow = Now.AddDays(1); // the next sweep, still inside the window
        var second = await Notify(h, sub);

        Assert.True(second.IsSuccess); // a no-op, not an error — the worker must not log this as a failure
        Assert.Single(h.Email.Sent);
        Assert.Single(h.Push.Sent);
    }

    [Fact]
    public async Task Renewing_into_a_new_period_re_arms_the_notice()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromDays(5));
        await Notify(h, sub);

        sub.Renew(Now.AddDays(5), Now.AddDays(35), Now.AddDays(5));
        h.Db.SaveChanges();

        // A month on, the new period end is inside the window again.
        h.Clock.UtcNow = Now.AddDays(30);
        await Notify(h, sub);

        Assert.Equal(2, h.Email.Sent.Count);
        Assert.Equal(2, h.Push.Sent.Count);
    }

    [Fact]
    public async Task A_subscription_ending_in_twenty_days_is_left_alone()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromDays(20));

        var result = await Notify(h, sub);

        Assert.True(result.IsSuccess);
        Assert.Empty(h.Email.Sent);
        Assert.Empty(h.Push.Sent);
        Assert.Null(sub.ExpiryNoticeSentForPeriodEndUtc); // and the flag is unspent, so the real sweep still will
    }

    [Fact]
    public async Task A_period_that_has_already_ended_is_not_warned_about()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromDays(-1));

        await Notify(h, sub);

        Assert.Empty(h.Email.Sent);
    }

    [Fact]
    public async Task An_expired_subscription_is_not_warned_about()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromDays(5));
        sub.Expire(Now);
        h.Db.SaveChanges();

        await Notify(h, sub);

        Assert.Empty(h.Email.Sent);
    }

    [Fact]
    public async Task A_past_due_subscription_is_not_warned_about()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromDays(5));
        sub.MarkPastDue(Now);
        h.Db.SaveChanges();

        await Notify(h, sub);

        // Its renewal charge has already failed and the payment-failed email already said so. A second
        // message about the same problem reads as a system that does not know what it sent.
        Assert.Empty(h.Email.Sent);
    }

    [Fact]
    public async Task The_last_day_is_reported_as_one_day_not_zero()
    {
        using var h = new TestHarness(Now);
        var (_, sub) = Seed(h, endsIn: TimeSpan.FromHours(6));

        await Notify(h, sub);

        Assert.Equal(1, Assert.Single(h.Email.Expiring).DaysLeft);
        Assert.Contains("1 day.", Assert.Single(h.Push.Sent).Message.Body);
    }

    [Fact]
    public async Task A_subscription_that_no_longer_exists_is_reported_not_found()
    {
        using var h = new TestHarness(Now);

        var result = await Handler(h).Handle(
            new NotifySubscriptionExpiringCommand(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("BILLING_SUBSCRIPTION_NOT_FOUND", result.Error.Code);
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

    private static NotifySubscriptionExpiringCommandHandler Handler(TestHarness h)
        => new(h.Db, h.Clock, h.Email, h.Push);

    private static Task<NoteFusion.Shared.Results.Result> Notify(TestHarness h, Subscription sub)
        => Handler(h).Handle(new NotifySubscriptionExpiringCommand(sub.Id), CancellationToken.None);

    private static (string Kind, string Email) Kind(TestHarness h)
    {
        var sent = Assert.Single(h.Email.Sent);
        return (sent.Kind, sent.To.Email);
    }
}
