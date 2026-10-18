using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.GooglePlay;
using NoteFusion.Application.Choirs;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
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

        var now = _clock.UtcNow;
        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);
        var ownPro = sub is not null && sub.IsActiveAt(now);

        // Pro through a choir as well (ProStatus): a singer, or the director, of a choir whose plan runs.
        var choir = await ChoirAccess.FindAsync(_db, userId, now, ct);
        var choirActive = choir is not null && choir.Choir.IsActiveAt(now);
        var isPro = ownPro || choirActive;

        // The song allowance, by the same counts the link submit gate enforces — songs still running
        // included, as the trial pill includes running transcriptions, so the count never shows a song
        // left that the gate would refuse. Every pool the account may draw on: its own, then its choir's.
        int songsTotal, songsRemaining;
        if (isPro)
        {
            var own = ownPro
                ? Math.Max(0, SongCredits.ProMonthlyAllowance - await SongCredits.CountHeldThisMonthAsync(_db, userId, now, ct))
                : 0;
            var pooled = choirActive
                ? Math.Max(0, SongCredits.ChoirMonthlyPool - await SongCredits.CountChoirHeldThisMonthAsync(_db, choir!.Choir.Id, now, ct))
                : 0;
            songsTotal = (ownPro ? SongCredits.ProMonthlyAllowance : 0) + (choirActive ? SongCredits.ChoirMonthlyPool : 0);
            songsRemaining = own + pooled;
        }
        else
        {
            songsTotal = SongCredits.FreePreviews;
            songsRemaining = Math.Max(0, songsTotal - await SongCredits.CountPreviewsUsedAsync(_db, userId, _device.Current, now, ct));
        }

        var choirName = choirActive ? choir!.Choir.Name : null;
        var choirRole = choirActive ? (choir!.IsDirector ? ChoirAccess.DirectorRole : ChoirAccess.MemberRole) : null;

        // Who bills the choir, told to its director only: a singer has nothing to manage.
        var choirBilling = choir is { IsDirector: true }
            ? await BillingOfAsync(userId, choir.Choir.Provider, GooglePlaySync.ChoirProduct, now, ct)
            : StoreBilling.None;

        // Pro through the choir alone: the membership shown is the choir's plan and period.
        if (!ownPro && choirActive)
        {
            var choirPlan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == choir!.Choir.PlanId, ct);
            return new SubscriptionDto(
                IsActive: true, choirPlan?.Code, SubscriptionStatus.Active, choir!.Choir.CurrentPeriodEndUtc,
                remaining, total, IsLifetime: false, IsGift: false,
                songsRemaining, songsTotal, choirPlan?.Name,
                FreeHarmonyAvailable: false,
                BoughtTranscriptionsRemaining: allowance.BoughtRemaining,
                BoughtTranscriptionsTotal: allowance.Bought,
                ChoirName: choirName,
                ChoirRole: choirRole,
                ChoirPeriodEndUtc: choir!.Choir.CurrentPeriodEndUtc,
                FreeTranscriptionsRemaining: allowance.FreeRemaining,
                FreeTranscriptionsPerWeek: allowance.Free,
                FreeResetsAtUtc: allowance.FreeResetsAtUtc,
                BilledThrough: choirBilling.BilledThrough,
                AutoRenews: choirBilling.AutoRenews,
                PaymentIssue: choirBilling.PaymentIssue,
                StoreProductId: choirBilling.StoreProductId);
        }

        if (sub is null)
            return new SubscriptionDto(
                IsActive: false, PlanCode: null, Status: null, CurrentPeriodEndUtc: null,
                TrialGenerationsRemaining: remaining, TrialGenerationsTotal: total,
                IsLifetime: false, IsGift: false,
                SongCreditsRemaining: songsRemaining, SongCreditsTotal: songsTotal,
                FreeHarmonyAvailable: account is { FreeHarmonyUsedAtUtc: null },
                BoughtTranscriptionsRemaining: allowance.BoughtRemaining,
                BoughtTranscriptionsTotal: allowance.Bought,
                ChoirPeriodEndUtc: choir?.Choir.CurrentPeriodEndUtc,
                FreeTranscriptionsRemaining: allowance.FreeRemaining,
                FreeTranscriptionsPerWeek: allowance.Free,
                FreeResetsAtUtc: allowance.FreeResetsAtUtc,
                // A director whose Google Play choir plan is on hold is told so, though nothing is running.
                PaymentIssue: choirBilling.PaymentIssue,
                StoreProductId: choirBilling.PaymentIssue is null ? null : choirBilling.StoreProductId,
                BilledThrough: choirBilling.PaymentIssue is null ? null : choirBilling.BilledThrough);

        var plan = await _db.Plans.FirstOrDefaultAsync(p => p.Id == sub.PlanId, ct);
        var billing = await BillingOfAsync(userId, sub.Provider, GooglePlaySync.ProProduct, now, ct);

        return new SubscriptionDto(
            isPro, plan?.Code, sub.Status, sub.CurrentPeriodEndUtc,
            remaining, total, sub.IsLifetime, sub.IsGift,
            songsRemaining, songsTotal, plan?.Name,
            FreeHarmonyAvailable: !isPro && account is { FreeHarmonyUsedAtUtc: null },
            BoughtTranscriptionsRemaining: allowance.BoughtRemaining,
            BoughtTranscriptionsTotal: allowance.Bought,
            ChoirName: choirName,
            ChoirRole: choirRole,
            ChoirPeriodEndUtc: choir?.Choir.CurrentPeriodEndUtc,
            FreeTranscriptionsRemaining: allowance.FreeRemaining,
            FreeTranscriptionsPerWeek: allowance.Free,
            FreeResetsAtUtc: allowance.FreeResetsAtUtc,
            BilledThrough: billing.BilledThrough,
            AutoRenews: billing.AutoRenews,
            PaymentIssue: billing.PaymentIssue,
            StoreProductId: billing.StoreProductId);
    }

    /// <summary>
    /// Who bills a membership. Google Play's is read off the account's live token for the product (the one whose
    /// access runs latest): whether Google will charge again, and a renewal it could not take.
    /// </summary>
    private async Task<StoreBilling> BillingOfAsync(
        Guid userId, PaymentProvider? provider, string productId, DateTime now, CancellationToken ct)
    {
        if (provider is null)
            return StoreBilling.None;
        if (provider != PaymentProvider.GooglePlay)
            return new StoreBilling("web", false, null, null);

        var token = await _db.GooglePlayPurchases.AsNoTracking()
            .Where(p => p.UserId == userId && p.ProductId == productId && p.ReplacedByToken == null)
            .OrderByDescending(p => p.ExpiryUtc)
            .FirstOrDefaultAsync(ct);
        if (token is null)
            return new StoreBilling("googlePlay", false, null, productId);

        var issue = token.State switch
        {
            GooglePlaySync.StateGrace => "grace",
            GooglePlaySync.StateOnHold => "hold",
            _ => null
        };
        var renews = token.AutoRenewing && GooglePlaySync.IsEntitledState(token.State) && token.ExpiryUtc > now;
        return new StoreBilling("googlePlay", renews, issue, productId);
    }

    private sealed record StoreBilling(string? BilledThrough, bool AutoRenews, string? PaymentIssue, string? StoreProductId)
    {
        public static readonly StoreBilling None = new(null, false, null, null);
    }
}
