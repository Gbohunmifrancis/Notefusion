using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;

namespace NoteFusion.Tests.Billing;

/// <summary>
/// Subscription access is time-boxed, so the rules that matter are "is Pro unlocked right now" across
/// the lifecycle: a cancelled subscription keeps working until the period ends, an expired one does not.
/// </summary>
public class SubscriptionTests
{
    private static readonly DateTime Start = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime End = new(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly Guid User = Guid.NewGuid();
    private static readonly Guid PlanId = Guid.NewGuid();

    private static Subscription NewActive() => Subscription.Start(
        User, PlanId, PaymentProvider.Squad, Start, End, "prov-sub-1", Start);

    [Fact]
    public void Starts_active_and_is_unlocked_within_the_period()
    {
        var sub = NewActive();

        Assert.Equal(SubscriptionStatus.Active, sub.Status);
        Assert.True(sub.IsActiveAt(Start.AddDays(10)));
        Assert.False(sub.IsActiveAt(End.AddSeconds(1)));
    }

    [Fact]
    public void A_cancelled_subscription_stays_unlocked_until_the_period_ends()
    {
        var sub = NewActive();

        sub.Cancel(Start.AddDays(5));

        Assert.Equal(SubscriptionStatus.Canceled, sub.Status);
        Assert.NotNull(sub.CanceledAtUtc);
        Assert.True(sub.IsActiveAt(Start.AddDays(20))); // still inside the paid window
        Assert.False(sub.IsActiveAt(End.AddSeconds(1)));
    }

    [Fact]
    public void An_expired_subscription_is_locked()
    {
        var sub = NewActive();

        sub.Expire(End);

        Assert.Equal(SubscriptionStatus.Expired, sub.Status);
        Assert.False(sub.IsActiveAt(Start.AddDays(1)));
    }

    [Fact]
    public void Renewing_extends_into_the_next_period()
    {
        var sub = NewActive();
        var nextEnd = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc);

        sub.MarkPastDue(End);
        sub.Renew(End, nextEnd, End);

        Assert.Equal(SubscriptionStatus.Active, sub.Status);
        Assert.True(sub.IsActiveAt(nextEnd.AddDays(-1)));
    }

    [Fact]
    public void Rejects_a_period_that_ends_before_it_starts()
    {
        Assert.Throws<ArgumentException>(() => Subscription.Start(
            User, PlanId, PaymentProvider.Squad, End, Start, null, Start));
    }
}
