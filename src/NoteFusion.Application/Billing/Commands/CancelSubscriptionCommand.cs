using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Cancels the caller's own subscription. Access is not withdrawn and nothing is refunded: the period
/// they paid for runs to the end, because <c>Subscription.IsActiveAt</c> counts Canceled as active
/// until <c>CurrentPeriodEndUtc</c>.
/// </summary>
/// <remarks>
/// Worth being precise about what this changes, because "cancel" usually means "stop the recurring
/// charge" and here there is no recurring charge to stop: nothing in this system bills off-session —
/// <c>PaymentFulfillment</c> is the only caller of <c>Renew</c>, and it only runs when a fresh payment
/// arrives. So one payment buys one period either way. What cancelling does is make the *end* of that
/// period honest: <see cref="NotifySubscriptionExpiringCommand"/> reads the status, so the notice
/// switches from "renews in N days" to "ends in N days — resubscribe to keep Pro", and the app stops
/// describing the plan as renewing. It records the customer's intent so the reminders stop implying
/// otherwise.
/// <para>
/// Idempotent: cancelling twice succeeds and changes nothing, so a double tap or a retried request
/// cannot fail in the customer's face.
/// </para>
/// </remarks>
public sealed record CancelSubscriptionCommand : IRequest<Result>;

public sealed class CancelSubscriptionCommandHandler : IRequestHandler<CancelSubscriptionCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public CancelSubscriptionCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result> Handle(CancelSubscriptionCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        // Ordered the same way GetMySubscriptionQuery orders it, so the row the app is showing is the
        // row this cancels. Ordering differently here is how you get a customer cancelling a lapsed
        // subscription while the current one keeps going.
        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);

        if (sub is null)
            return BillingErrors.NoActiveSubscription;

        // Before the active check, because a lifetime subscription is always active: it would otherwise
        // fall through and be marked Canceled, which changes nothing (the sentinel period end never
        // arrives) while telling the customer their access is ending. Refusing is the honest answer.
        if (sub.IsLifetime)
            return BillingErrors.LifetimeNotCancelable;

        // Google charges again whatever this row says; only a cancellation in Google Play stops it.
        if (sub.Provider == PaymentProvider.GooglePlay)
            return BillingErrors.ManagedByGooglePlay;

        if (sub.Status == SubscriptionStatus.Canceled)
            return Result.Success();

        if (!sub.IsActiveAt(_clock.UtcNow))
            return BillingErrors.NoActiveSubscription;

        sub.Cancel(_clock.UtcNow);
        await _db.SaveChangesAsync(ct);

        return Result.Success();
    }
}
