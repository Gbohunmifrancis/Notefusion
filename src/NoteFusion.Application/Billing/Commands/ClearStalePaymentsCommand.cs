using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Result summary of sweeping and clearing stale payments that can no longer be processed.
/// </summary>
public sealed record ClearStalePaymentsResult(
    int ClearedPendingCount,
    int ClearedProcessingCount,
    int FulfilledCount);

/// <summary>
/// Sweeps and closes stale payment attempts that are confirmed to be unpayable and cannot be processed again.
/// <para>
/// 1. Abandoned <see cref="PaymentStatus.Pending"/> rows: initiation never completed and no hosted checkout session
/// was created. After <see cref="BillingSettings.StalePendingHours"/>, they are closed so returning users start clean.
/// </para>
/// <para>
/// 2. Expired <see cref="PaymentStatus.Processing"/> rows: hosted checkouts have strict provider-enforced TTLs
/// (at most 24 hours across Bachs and Paystack). Rows older than <see cref="BillingSettings.StaleProcessingHours"/>
/// are checked against the gateway one last time: settled payments are fulfilled, while expired/unpayable checkouts
/// are marked <see cref="PaymentStatus.Failed"/> so users can open a fresh checkout.
/// </para>
/// </summary>
public sealed record ClearStalePaymentsCommand : IRequest<Result<ClearStalePaymentsResult>>;

public sealed class ClearStalePaymentsCommandHandler
    : IRequestHandler<ClearStalePaymentsCommand, Result<ClearStalePaymentsResult>>
{
    private const int BatchSize = 50;

    private readonly IApplicationDbContext _db;
    private readonly IPaymentGatewayFactory _gateways;
    private readonly IDateTimeProvider _clock;
    private readonly BillingSettings _settings;
    private readonly IEmailSender _email;
    private readonly ILogger<ClearStalePaymentsCommandHandler> _logger;

    public ClearStalePaymentsCommandHandler(
        IApplicationDbContext db,
        IPaymentGatewayFactory gateways,
        IDateTimeProvider clock,
        BillingSettings settings,
        IEmailSender email,
        ILogger<ClearStalePaymentsCommandHandler> logger)
    {
        _db = db;
        _gateways = gateways;
        _clock = clock;
        _settings = settings;
        _email = email;
        _logger = logger;
    }

    public async Task<Result<ClearStalePaymentsResult>> Handle(
        ClearStalePaymentsCommand request, CancellationToken ct)
    {
        var now = _clock.UtcNow;
        var pendingCutoff = now - TimeSpan.FromHours(Math.Max(1, _settings.StalePendingHours));
        var processingCutoff = now - TimeSpan.FromHours(Math.Max(1, _settings.StaleProcessingHours));

        var clearedPending = 0;
        var clearedProcessing = 0;
        var fulfilled = 0;

        // 1. Clear abandoned Pending payments (never created a session with the provider).
        var stalePending = await _db.PaymentTransactions
            .Where(t => t.Status == PaymentStatus.Pending && t.CreatedAtUtc < pendingCutoff)
            .OrderBy(t => t.CreatedAtUtc)
            .Take(BatchSize)
            .ToListAsync(ct);

        foreach (var tx in stalePending)
        {
            tx.MarkFailed("Initiation expired: checkout session was not created in time.", now);
            clearedPending++;
        }

        // 2. Clear expired Processing payments beyond maximum checkout lifetime.
        var staleProcessing = await _db.PaymentTransactions
            .Where(t => t.Status == PaymentStatus.Processing && t.UpdatedAtUtc < processingCutoff)
            .OrderBy(t => t.UpdatedAtUtc)
            .Take(BatchSize)
            .ToListAsync(ct);

        foreach (var tx in staleProcessing)
        {
            // Perform one final check with the provider before declaring the checkout expired.
            if (!string.IsNullOrWhiteSpace(tx.ProviderReference))
            {
                var verification = await _gateways.Resolve(tx.Provider)
                    .VerifyAsync(new GatewayVerificationRequest(tx.Reference, tx.ProviderReference), ct);

                if (verification.IsSuccess)
                {
                    var v = verification.Value;
                    if (v.Succeeded)
                    {
                        // Even though it was stale, the provider confirms funds settled! Fulfill rather than fail.
                        if (v.AmountMinor == tx.AmountMinor
                            && string.Equals(v.Currency, tx.Currency, StringComparison.OrdinalIgnoreCase))
                        {
                            var receipt = await PaymentFulfillment.ApplyAsync(_db, tx, v, now, ct);
                            fulfilled++;

                            if (receipt is not null)
                                await _email.SendSubscriptionReceiptAsync(receipt.Recipient, receipt.Receipt, ct);

                            continue;
                        }
                    }
                    else if (v.Terminal)
                    {
                        tx.MarkFailed("Provider confirmed checkout can no longer be paid.", now);
                        clearedProcessing++;
                        continue;
                    }
                }
            }

            // Exceeded maximum hosted checkout lifetime and cannot be processed again.
            tx.MarkFailed(
                "Checkout session expired: exceeded maximum validity window and can no longer be processed.", now);
            clearedProcessing++;
        }

        if (clearedPending > 0 || clearedProcessing > 0 || fulfilled > 0)
        {
            await _db.SaveChangesAsync(ct);
            _logger.LogInformation(
                "Stale payments cleanup: {Pending} pending cleared, {Processing} processing cleared, {Fulfilled} fulfilled.",
                clearedPending, clearedProcessing, fulfilled);
        }

        return new ClearStalePaymentsResult(clearedPending, clearedProcessing, fulfilled);
    }
}
