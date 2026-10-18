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

    /// <summary>
    /// Which gateway took the money — and null when nobody did, because an operator granted the
    /// subscription from the admin console. That is the only distinction between a gift and a sale in this
    /// table: a gift attaches a real plan (so there is something to name and a period to compute) but
    /// writes no <c>PaymentTransaction</c> and no ledger entry, because a gift is not revenue and reporting
    /// that sums the ledger must not start counting it as income.
    /// </summary>
    public PaymentProvider? Provider { get; private set; }

    public SubscriptionStatus Status { get; private set; }

    public DateTime CurrentPeriodStartUtc { get; private set; }
    public DateTime CurrentPeriodEndUtc { get; private set; }

    /// <summary>Provider's recurring token/subscription id, for charging renewals off-session.</summary>
    public string? ProviderSubscriptionRef { get; private set; }

    public DateTime? CanceledAtUtc { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }

    /// <summary>
    /// The <see cref="CurrentPeriodEndUtc"/> the "expiring soon" notice was last sent for. Storing the
    /// date rather than a bool is what makes the notice re-arm itself: <see cref="Renew"/> moves the
    /// period end, so the stored value stops matching and the next period gets its own warning, with no
    /// reset step anyone can forget to call.
    /// </summary>
    public DateTime? ExpiryNoticeSentForPeriodEndUtc { get; private set; }

    /// <summary>
    /// Bumped by every change to this row, and checked by the database on every save (a concurrency
    /// token). Two payments for one member fulfilled at once both read the same period end; without this
    /// the second save would silently overwrite the first and a paid period would vanish. With it the
    /// second save fails, and <c>PaymentFulfillment</c> reloads the row and stacks its period again.
    /// A plain counter rather than Postgres <c>xmin</c>, so the same rule holds on SQLite in the tests.
    /// </summary>
    public int Version { get; private set; }

    /// <summary>
    /// The period end used by a plan that never renews. A far-future sentinel rather than a nullable
    /// end, so <see cref="IsActiveAt"/> and every query that filters on the period window keep working
    /// untouched — the alternative was a null check in each of them, where one omission silently locks a
    /// paying customer out.
    /// </summary>
    public static readonly DateTime LifetimeEndUtc = new(9999, 12, 31, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>True when this was bought outright, so there is no renewal date to show or charge.</summary>
    public bool IsLifetime => CurrentPeriodEndUtc >= LifetimeEndUtc;

    /// <summary>
    /// True when an operator granted this rather than a customer buying it. Read from the absence of a
    /// provider rather than a separate flag, so the two can never disagree about which one it is.
    /// </summary>
    public bool IsGift => Provider is null;

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

    /// <summary>
    /// Opens a subscription nobody paid for: an operator comping an account from the admin console.
    /// Identical to <see cref="Start"/> apart from the missing provider and reference, which is what marks
    /// it a gift for the rest of the system.
    /// </summary>
    public static Subscription Grant(
        Guid userId, Guid planId, DateTime periodStartUtc, DateTime periodEndUtc, DateTime utcNow)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = Guard.AgainstEmpty(userId),
            PlanId = Guard.AgainstEmpty(planId),
            Provider = null,
            Status = SubscriptionStatus.Active,
            CurrentPeriodStartUtc = periodStartUtc,
            CurrentPeriodEndUtc = RequireAfter(periodEndUtc, periodStartUtc),
            CreatedAtUtc = utcNow,
            UpdatedAtUtc = utcNow
        };

    /// <summary>
    /// Re-points a lapsed row at a fresh gift. Needed because a user has at most one subscription row (the
    /// unique index on <c>UserId</c>), so comping someone who subscribed once before has to reuse the row
    /// they already have rather than insert a second one.
    /// </summary>
    /// <remarks>
    /// Everything provider-shaped is cleared, not left behind: a stale <see cref="ProviderSubscriptionRef"/>
    /// on a provider-less row would be a token pointing at a gateway that is no longer involved, and a stale
    /// <see cref="CanceledAtUtc"/> would date the new grant to an old cancellation. Clearing
    /// <see cref="ExpiryNoticeSentForPeriodEndUtc"/> re-arms the expiry warning for the new period.
    /// </remarks>
    public void ApplyGrant(Guid planId, DateTime periodStartUtc, DateTime periodEndUtc, DateTime utcNow)
    {
        PlanId = Guard.AgainstEmpty(planId);
        Provider = null;
        ProviderSubscriptionRef = null;
        Status = SubscriptionStatus.Active;
        CurrentPeriodStartUtc = periodStartUtc;
        CurrentPeriodEndUtc = RequireAfter(periodEndUtc, periodStartUtc);
        CanceledAtUtc = null;
        ExpiryNoticeSentForPeriodEndUtc = null;
        Touch(utcNow);
    }

    /// <summary>Extends into a new paid period after a successful renewal charge.</summary>
    public void Renew(DateTime periodStartUtc, DateTime periodEndUtc, DateTime utcNow)
    {
        CurrentPeriodStartUtc = periodStartUtc;
        CurrentPeriodEndUtc = RequireAfter(periodEndUtc, periodStartUtc);
        Status = SubscriptionStatus.Active;
        // A fresh payment is a fresh decision: a member who cancelled and then paid again is not
        // cancelled any more.
        CanceledAtUtc = null;
        Touch(utcNow);
    }

    /// <summary>The plan this membership is on from now, after a payment for a different plan.</summary>
    public void SwitchPlan(Guid planId, DateTime utcNow)
    {
        PlanId = Guard.AgainstEmpty(planId);
        Touch(utcNow);
    }

    /// <summary>Records that a real gateway payment now backs this row, whatever backed it before.</summary>
    /// <remarks>
    /// This exists for the account that was comped and then bought: without it the row keeps a null provider
    /// after the money arrives, so <see cref="IsGift"/> would report a paying customer as a gift — which the
    /// dashboard would print, and which the revoke-a-gift action would then happily act on. The period and
    /// the plan belong to <see cref="Renew"/>; this answers only "did anyone pay for this".
    /// </remarks>
    public void AttachPayment(PaymentProvider provider, string? providerSubscriptionRef, DateTime utcNow)
    {
        Provider = provider;
        if (!string.IsNullOrWhiteSpace(providerSubscriptionRef))
            ProviderSubscriptionRef = providerSubscriptionRef;

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

    /// <summary>
    /// Pushes the period end further out — an operator making good on an outage, or extending a comp.
    /// No money is involved either way; this only moves the date access runs to.
    /// </summary>
    /// <remarks>
    /// A subscription that had lapsed is restored to Active, because moving the date alone would leave
    /// <see cref="IsActiveAt"/> false and the extension invisible. A <see cref="SubscriptionStatus.Canceled"/>
    /// one deliberately stays cancelled: the customer said they do not want it to continue past the period,
    /// and quietly re-arming that on their behalf is not ours to do — the period simply runs longer.
    /// </remarks>
    public void ExtendTo(DateTime newEndUtc, DateTime utcNow)
    {
        if (newEndUtc <= CurrentPeriodEndUtc)
            throw new ArgumentException("An extension must move the period end forward.", nameof(newEndUtc));

        CurrentPeriodEndUtc = newEndUtc;
        if (Status is SubscriptionStatus.Expired or SubscriptionStatus.PastDue)
            Status = SubscriptionStatus.Active;

        // The warning was sent for the old end date, and this row now ends somewhere else, so the next
        // sweep should warn again. Left alone it would still match nothing, but only by accident.
        ExpiryNoticeSentForPeriodEndUtc = null;
        Touch(utcNow);
    }

    /// <summary>
    /// Follows a store that renews this membership itself (Google Play): the period ends when the store says,
    /// later or earlier than before. Its grace period moves the end out, account hold, a refund or expiry bring it
    /// back to the past, and a cancellation in the store keeps the end and marks the row cancelled. A lifetime row
    /// is never shortened by it.
    /// </summary>
    public void FollowStore(DateTime periodEndUtc, bool canceled, DateTime utcNow)
    {
        if (IsLifetime)
            return;

        CurrentPeriodEndUtc = periodEndUtc;
        if (CurrentPeriodStartUtc > periodEndUtc)
            CurrentPeriodStartUtc = periodEndUtc;
        Status = periodEndUtc <= utcNow
            ? SubscriptionStatus.Expired
            : canceled ? SubscriptionStatus.Canceled : SubscriptionStatus.Active;
        CanceledAtUtc = canceled ? CanceledAtUtc ?? utcNow : null;
        ExpiryNoticeSentForPeriodEndUtc = null;
        Touch(utcNow);
    }

    /// <summary>
    /// Cuts access off now, rather than at the end of a period nobody is going to honour: an operator
    /// revoking a gift, or ending a subscription for cause.
    /// </summary>
    /// <remarks>
    /// Both the status and the period end move, because <see cref="IsActiveAt"/> reads them together and
    /// Expired-with-a-future-end is a row that says two different things. Collapsing the window to zero is
    /// the honest record of a grant that was withdrawn the moment it was given. Nothing is refunded here —
    /// money moving back is a gateway call, not a status change.
    /// </remarks>
    public void EndNow(DateTime utcNow)
    {
        Status = SubscriptionStatus.Expired;
        CurrentPeriodEndUtc = utcNow;
        Touch(utcNow);
    }

    private void Touch(DateTime utcNow)
    {
        UpdatedAtUtc = utcNow;
        Version++;
    }

    private static DateTime RequireAfter(DateTime end, DateTime start)
        => end > start ? end : throw new ArgumentException("Period end must be after start.", nameof(end));
}
