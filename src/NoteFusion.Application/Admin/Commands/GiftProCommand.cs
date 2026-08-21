using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Comps an account Pro — the support answer to a botched transcription, a launch partner, or a reviewer
/// who needs to see the paid product.
/// </summary>
/// <remarks>
/// A gift is deliberately <em>not</em> a payment. It attaches a real plan, so there is something to name
/// and an interval to compute the period from, but writes no <c>PaymentTransaction</c> and no
/// <c>LedgerEntry</c>: the ledger is the source of truth for money held, and a gift did not move any. The
/// only mark it leaves is a null <c>Subscription.Provider</c>, which is what <c>IsGift</c> reads.
/// <para>
/// The plan attached is whichever seeded plan matches the requested duration, price and currency included.
/// That price is never charged and never reaches the ledger — it is there because a subscription has to
/// point at a plan, and pointing at a fabricated zero-price one would put a plan in the table that nobody
/// can buy.
/// </para>
/// </remarks>
public sealed record GiftProCommand(Guid UserId, BillingInterval Duration, string? Note = null) : IRequest<Result>;

public sealed class GiftProCommandHandler : IRequestHandler<GiftProCommand, Result>
{
    /// <summary>
    /// Which seeded plan stands in for each gift length. Naira for the recurring tiers because those are the
    /// only monthly and yearly plans still on sale (<c>BillingSeeder</c> retired the USD ones); the currency
    /// is immaterial to a gift, since nothing is charged.
    /// </summary>
    private static readonly Dictionary<BillingInterval, string> PlanCodes = new()
    {
        [BillingInterval.Monthly] = "pro_monthly_ngn",
        [BillingInterval.Yearly] = "pro_yearly_ngn",
        [BillingInterval.Lifetime] = "pro_lifetime",
    };

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public GiftProCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result> Handle(GiftProCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is null)
            return AdminErrors.NotAuthenticated;

        if (!PlanCodes.TryGetValue(request.Duration, out var planCode))
            return AdminErrors.GiftPlanMissing(request.Duration.ToString());

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        // Not filtered on IsActive: a retired plan is still a legitimate label for what was granted, and a
        // gift is not a sale, so "no longer on offer" does not apply to it.
        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Code == planCode, ct);
        if (plan is null)
            return AdminErrors.GiftPlanMissing(planCode);

        var now = _clock.UtcNow;

        // Ordered the way GetMySubscriptionQuery orders it, so the row this reads is the row the user's app
        // is showing them.
        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == request.UserId, ct);

        if (sub is not null && sub.IsActiveAt(now))
            return AdminErrors.AlreadySubscribed;

        var periodEnd = BillingPeriod.Advance(now, plan.Interval);

        if (sub is null)
            _db.Subscriptions.Add(Subscription.Grant(user.Id, plan.Id, now, periodEnd, now));
        else
            sub.ApplyGrant(plan.Id, now, periodEnd, now);

        var window = plan.Interval == BillingInterval.Lifetime
            ? "for life"
            : $"until {periodEnd:yyyy-MM-dd}";

        _audit.Record(
            AdminAuditAction.GiftPro,
            user,
            $"Granted {plan.Name} {window}. No payment was taken.",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
