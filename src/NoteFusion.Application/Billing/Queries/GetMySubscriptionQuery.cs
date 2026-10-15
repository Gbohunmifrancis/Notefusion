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

        // The ceiling is resolved once and fed to both halves of what the app displays.
        var account = await _db.Users
            .Where(u => u.Id == userId)
            .Select(u => new { u.Country, u.FreeHarmonyUsedAtUtc })
            .FirstOrDefaultAsync(ct);
        var country = account?.Country;

        // Counted by the same helper the submit gate uses, against the same country, so the number the
        // app shows and the number that triggers the paywall cannot drift apart. That includes the
        // device half (a second account on a spent handset sees 0 left, not 3 followed by a refusal), the
        // transcriptions still running, which hold their place until they settle, and the ones bought.
        var allowance = await TrialUsage.ReadAsync(_db, userId, _device.Current, country, _clock.UtcNow, ct);
        var total = allowance.Total;
        var remaining = allowance.Remaining;

        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        var isPro = sub is not null && sub.IsActiveAt(_clock.UtcNow);

        // The song allowance, by the same counts the link submit gate enforces — songs still running
        // included, as the trial pill includes running transcriptions, so the count never shows a song
        // left that the gate would refuse.
        var songsTotal = isPro ? SongCredits.ProMonthlyAllowance : SongCredits.FreePreviews;
        var songsUsed = isPro
            ? await SongCredits.CountHeldThisMonthAsync(_db, userId, _clock.UtcNow, ct)
            : await SongCredits.CountPreviewsUsedAsync(_db, userId, _device.Current, _clock.UtcNow, ct);
        var songsRemaining = Math.Max(0, songsTotal - songsUsed);

        if (sub is null)
            return new SubscriptionDto(
                IsActive: false, PlanCode: null, Status: null, CurrentPeriodEndUtc: null,
                TrialGenerationsRemaining: remaining, TrialGenerationsTotal: total,
                IsLifetime: false, IsGift: false,
                SongCreditsRemaining: songsRemaining, SongCreditsTotal: songsTotal,
                FreeHarmonyAvailable: account is { FreeHarmonyUsedAtUtc: null },
                BoughtTranscriptionsRemaining: allowance.BoughtRemaining,
                BoughtTranscriptionsTotal: allowance.Bought);

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);

        return new SubscriptionDto(
            isPro, plan?.Code, sub.Status, sub.CurrentPeriodEndUtc,
            remaining, total, sub.IsLifetime, sub.IsGift,
            songsRemaining, songsTotal, plan?.Name,
            FreeHarmonyAvailable: !isPro && account is { FreeHarmonyUsedAtUtc: null },
            BoughtTranscriptionsRemaining: allowance.BoughtRemaining,
            BoughtTranscriptionsTotal: allowance.Bought);
    }
}
