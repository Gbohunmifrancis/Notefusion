using NoteFusion.Core.Enums;
using NoteFusion.Core.Seedwork;
using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Entities.Billing;

/// <summary>
/// A user's Pro subscription. One current row per user; its status and period window decide whether
/// Pro features are unlocked. Renewals extend the period; a failed renewal moves it to PastDue for a
/// grace window; cancellation keeps it usable until the period ends, then it expires.
/// </summary>
public class Subscription : BaseEntity
{
    private Subscription() { } // EF Core

    public Guid UserId { get; private set; }
    public Guid PlanId { get; private set; }
    public PaymentProvider Provider { get; private set; }
    public SubscriptionStatus Status { get; private set; }

    public DateTime CurrentPeriodStartUtc { get; private set; }
    public DateTime CurrentPeriodEndUtc { get; private set; }

    /// <summary>Provider's recurring token/subscription id, for charging renewals off-session.</summary>
    public string? ProviderSubscriptionRef { get; private set; }

    public DateTime? CanceledAtUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>Pro is unlocked while active, or cancelled but still inside the paid period.</summary>
    public bool IsActiveAt(DateTime utcNow)
        => Status is SubscriptionStatus.Active or SubscriptionStatus.Canceled
           && utcNow < CurrentPeriodEndUtc;

    public static Subscription Start(
        Guid userId, Guid planId, PaymentProvider provider,
        DateTime periodStartUtc, DateTime periodEndUtc, string? providerSubscriptionRef, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            PlanId = Guard.AgainstEmpty(planId),
            Provider = provider,
            Status = SubscriptionStatus.Active,
            CurrentPeriodStartUtc = periodStartUtc,
            CurrentPeriodEndUtc = RequireAfter(periodEndUtc, periodStartUtc),
            ProviderSubscriptionRef = providerSubscriptionRef,
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

    /// <summary>Extends into a new paid period after a successful renewal charge.</summary>
    public void Renew(DateTime periodStartUtc, DateTime periodEndUtc, DateTime utcNow)
    {
        CurrentPeriodStartUtc = periodStartUtc;
        CurrentPeriodEndUtc = RequireAfter(periodEndUtc, periodStartUtc);
        Status = SubscriptionStatus.Active;
        Touch(utcNow);
    }

    public void MarkPastDue(DateTime utcNow)
    {
        Status = SubscriptionStatus.PastDue;
        Touch(utcNow);
    }

    /// <summary>User cancels; the subscription remains usable until the period ends (no proration).</summary>
    public void Cancel(DateTime utcNow)
    {
        Status = SubscriptionStatus.Canceled;
        CanceledAtUtc = utcNow;
        Touch(utcNow);
    }

    public void Expire(DateTime utcNow)
    {
        Status = SubscriptionStatus.Expired;
        Touch(utcNow);
    }

    private void Touch(DateTime utcNow) => UpdatedAtUtc = utcNow;

    private static DateTime RequireAfter(DateTime end, DateTime start)
        => end > start ? end : throw new ArgumentException("Period end must be after start.", nameof(end));
}
