using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Ends a subscription now, paid or gifted — fraud, a chargeback, an account being closed for cause.
/// </summary>
/// <remarks>
/// The blunt one, and the reason <see cref="RevokeProCommand"/> exists alongside it: this will cut off a
/// paying customer, so the console asks for a separate confirmation and the trail records who decided to.
/// <para>
/// No refund. Money moving back is a live call to Paystack or Bachs, and a status change that quietly
/// implied one would be worse than none at all — the operator issues the refund in the gateway's own
/// dashboard, where the money actually is. What this does is stop access; the audit note is where the reason
/// and the refund reference belong.
/// </para>
/// </remarks>
public sealed record EndSubscriptionCommand(Guid UserId, string? Note = null) : IRequest<Result>;

public sealed class EndSubscriptionCommandHandler : IRequestHandler<EndSubscriptionCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public EndSubscriptionCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result> Handle(EndSubscriptionCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;

        // Included for completeness rather than because self-ending is a threat: with the other three
        // refused, leaving this one open would mean the console's own rule about own-account billing has an
        // exception, and an exception is what someone reasons from next time.
        if (actorId == request.UserId)
            return AdminErrors.CannotBillSelf;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == request.UserId, ct);

        if (sub is null)
            return AdminErrors.NoSubscription;

        var now = _clock.UtcNow;

        if (!sub.IsActiveAt(now))
            return Result.Success();

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);
        var paidFor = sub.IsGift ? "gifted" : "paid";
        var remaining = sub.IsLifetime
            ? "lifetime access"
            : $"{Math.Max(0, (int)Math.Ceiling((sub.CurrentPeriodEndUtc - now).TotalDays))} day(s) of the current period";

        // The unused remainder is named in the summary because that is the number a refund conversation
        // starts from, and this command deliberately does not act on it.
        _audit.Record(
            AdminAuditAction.EndSubscription,
            user,
            $"Ended the {paidFor} {plan?.Name ?? "Pro"} subscription immediately, forfeiting {remaining}. "
            + "No refund was issued.",
            request.Note);

        sub.EndNow(now);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
