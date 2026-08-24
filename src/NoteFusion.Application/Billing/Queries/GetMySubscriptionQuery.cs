using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Queries;

/// <summary>
/// The caller's subscription state — the single source of truth the app uses to gate Pro features.
/// Returns an inactive placeholder (rather than NotFound) when the user has never subscribed, so the
/// client has one uniform shape to branch on.
/// </summary>
public sealed record GetMySubscriptionQuery : IRequest<Result<SubscriptionDto>>;

public sealed class GetMySubscriptionQueryHandler : IRequestHandler<GetMySubscriptionQuery, Result<SubscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;

    public GetMySubscriptionQueryHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock,
        IDeviceFingerprint device)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _device = device;
    }

    public async Task<Result<SubscriptionDto>> Handle(GetMySubscriptionQuery request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        // Counted by the same helper the submit gate uses, from the same constant, so the number the
        // app shows and the number that triggers the paywall cannot drift apart. That includes the
        // device half: a second account on a spent handset must see 0 left, not 5 followed by a refusal.
        var remaining = await TrialUsage.CountRemainingAsync(_db, userId, _device.Current, ct);

        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);

        if (sub is null)
            return new SubscriptionDto(
                IsActive: false, PlanCode: null, Status: null, CurrentPeriodEndUtc: null,
                TrialGenerationsRemaining: remaining, TrialGenerationsTotal: FreeTier.TrialGenerations,
                IsLifetime: false);

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);

        return new SubscriptionDto(
            sub.IsActiveAt(_clock.UtcNow), plan?.Code, sub.Status, sub.CurrentPeriodEndUtc,
            remaining, FreeTier.TrialGenerations, sub.IsLifetime);
    }
}
