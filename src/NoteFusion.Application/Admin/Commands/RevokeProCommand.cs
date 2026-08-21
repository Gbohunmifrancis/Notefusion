using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Takes back a comped subscription — a gift granted to the wrong account, or one whose reason has expired.
/// </summary>
/// <remarks>
/// Refuses outright on anything a gateway paid for. That refusal is the point of the command existing
/// separately from <see cref="EndSubscriptionCommand"/>: the two are one click apart in the console, and a
/// mis-click on the one labelled "take the gift back" must not be able to cut off a paying customer.
/// </remarks>
public sealed record RevokeProCommand(Guid UserId, string? Note = null) : IRequest<Result>;

public sealed class RevokeProCommandHandler : IRequestHandler<RevokeProCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public RevokeProCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result> Handle(RevokeProCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is null)
            return AdminErrors.NotAuthenticated;

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == request.UserId, ct);
        if (user is null)
            return UserErrors.NotFound;

        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == request.UserId, ct);

        if (sub is null)
            return AdminErrors.NoSubscription;

        if (!sub.IsGift)
            return AdminErrors.PaidSubscriptionNotRevocable;

        var now = _clock.UtcNow;

        // Already over — the period lapsed, or someone revoked it a moment ago. Succeeding without a second
        // trail entry keeps a double click from reading as two separate revocations.
        if (!sub.IsActiveAt(now))
            return Result.Success();

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);

        sub.EndNow(now);

        _audit.Record(
            AdminAuditAction.RevokePro,
            user,
            $"Revoked the gifted {plan?.Name ?? "Pro"} subscription. Access ended immediately.",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
