using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Pushes a subscription's end date further out — making good on an outage, honouring a promise support
/// made, or stretching a comp. No money moves in either direction; this only changes how long access runs.
/// </summary>
/// <remarks>
/// Works on paid subscriptions as well as gifts, because giving a customer more than they paid for cannot
/// hurt them. Taking time away is the opposite, so this only ever moves the date forward — shortening
/// access is <see cref="EndSubscriptionCommand"/>, which says so in its name and is confirmed separately.
/// </remarks>
public sealed record ExtendSubscriptionCommand(Guid UserId, DateTime NewEndUtc, string? Note = null)
    : IRequest<Result>;

public sealed class ExtendSubscriptionCommandHandler : IRequestHandler<ExtendSubscriptionCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;
    private readonly IDateTimeProvider _clock;

    public ExtendSubscriptionCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, IAuditLogger audit, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _audit = audit;
        _clock = clock;
    }

    public async Task<Result> Handle(ExtendSubscriptionCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } actorId)
            return AdminErrors.NotAuthenticated;

        // Extending is granting by another name — it is the way an operator who already has Pro would give
        // themselves more of it, so it carries the same refusal as the gift.
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

        if (sub.IsLifetime)
            return AdminErrors.LifetimeNotExtendable;

        // Kind is pinned because the wire can hand us either — "2026-09-01T00:00:00Z" arrives as Utc,
        // a bare "2026-09-01" as Unspecified — and Npgsql rejects anything that is not Utc for a
        // timestamptz column. Pinning here means a date-only input still lands as midnight UTC.
        var newEnd = DateTime.SpecifyKind(request.NewEndUtc, DateTimeKind.Utc);
        var now = _clock.UtcNow;

        // Checked before the forward check so a date past the sentinel gets the specific answer rather than
        // "that is not forward enough", which it would fail on next.
        if (newEnd >= Subscription.LifetimeEndUtc)
            return AdminErrors.ExtensionTooFar;

        // Both bounds, because either one alone leaves a hole. Past the current end is the obvious case; past
        // *now* matters for a lapsed subscription, where a date that is forward of the old end but still
        // behind today would flip the status to Active and grant nothing — the console would report an
        // extension the user cannot use.
        if (newEnd <= sub.CurrentPeriodEndUtc || newEnd <= now)
            return AdminErrors.ExtensionNotForward;

        var previousEnd = sub.CurrentPeriodEndUtc;
        sub.ExtendTo(newEnd, now);

        _audit.Record(
            AdminAuditAction.ExtendSubscription,
            user,
            $"Extended access from {previousEnd:yyyy-MM-dd} to {newEnd:yyyy-MM-dd}. Nothing was charged.",
            request.Note);

        await _db.SaveChangesAsync(ct);
        return Result.Success();
    }
}
