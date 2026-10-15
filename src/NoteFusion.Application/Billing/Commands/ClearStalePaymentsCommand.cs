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
/// are checked against the gateway: settled payments are fulfilled, while checkouts the provider reports
/// unpaid are marked <see cref="PaymentStatus.Failed"/> so users can open a fresh checkout. A row the
/// provider could not answer for is left Processing — never failed on age alone.
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
        for (var batch = 0; batch < 10; batch++)
        {
            var stalePending = await _db.PaymentTransactions
                .Where(t => t.Status == PaymentStatus.Pending && t.CreatedAtUtc < pendingCutoff)
                .OrderBy(t => t.CreatedAtUtc)
                .Take(BatchSize)
                .ToListAsync(ct);

            if (stalePending.Count == 0)
                break;

            foreach (var tx in stalePending)
            {
                tx.MarkFailed("Initiation expired: checkout session was not created in time.", now);
                clearedPending++;
            }

            await _db.SaveChangesAsync(ct);

            if (stalePending.Count < BatchSize)
                break;
        }

        // 2. Settle Processing payments beyond maximum checkout lifetime. Only the provider can say a checkout
        // is dead: age alone is not evidence, and a provider we could not reach has told us nothing. So a
        // row is failed only on the provider's own answer that it was not paid; anything we could not
        // settle stays Processing, where the admin payment alert already counts it as stuck.
        var seen = new List<Guid>();
        for (var batch = 0; batch < 10; batch++)
        {
            // Rows left alone stay Processing and would otherwise be fetched again by the next batch.
            var staleProcessing = await _db.PaymentTransactions
                .Where(t => t.Status == PaymentStatus.Processing
                            && t.UpdatedAtUtc < processingCutoff
                            && !seen.Contains(t.Id))
                .OrderBy(t => t.UpdatedAtUtc)
                .Take(BatchSize)
                .ToListAsync(ct);

            if (staleProcessing.Count == 0)
                break;

            var fulfillments = new List<Fulfillment>();
            foreach (var tx in staleProcessing)
            {
                seen.Add(tx.Id);

                var verification = await _gateways.Resolve(tx.Provider)
                    .VerifyAsync(new GatewayVerificationRequest(tx.Reference, tx.ProviderReference), ct);

                if (verification.IsFailure)
                {
                    _logger.LogWarning(
                        "Stale payment {Reference} could not be verified and stays Processing: {Error}",
                        tx.Reference, verification.Error.Message);
                    continue;
                }

                var v = verification.Value;
                if (v.Succeeded)
                {
                    // Stale, but the provider confirms the money settled: fulfil rather than fail. Same
                    // amount rule as ReconcilePaymentCommand — paying more than the price is still paid.
                    if (string.Equals(v.Currency, tx.Currency, StringComparison.OrdinalIgnoreCase)
                        && v.AmountMinor >= tx.AmountMinor)
                    {
                        var fulfillment = await PaymentFulfillment.ApplyAsync(_db, tx, v, now, ct);
                        if (fulfillment is not null)
                            fulfillments.Add(fulfillment);
                        fulfilled++;
                    }
                    else
                    {
                        _logger.LogWarning(
                            "Stale payment {Reference} settled for {Amount} {Currency}, expected {Expected} {ExpectedCurrency}; left for review.",
                            tx.Reference, v.AmountMinor, v.Currency, tx.AmountMinor, tx.Currency);
                    }
                }
                else if (v.Terminal)
                {
                    tx.MarkFailed("Provider confirmed checkout can no longer be paid.", now);
                    clearedProcessing++;
                }
                else
                {
                    // Answered "not paid" but not final — Paystack's `abandoned` never becomes final on its own.
                    // Past every provider's checkout lifetime that answer is as good as final, and left alone
                    // these rows would pile up in Processing for good, filling the reconciliation sweep and the
                    // admin alert with abandoned carts. Closing it is safe: a payment that lands after all
                    // reopens and fulfils the row (PaymentFulfillment).
                    tx.MarkFailed(
                        "Checkout session expired: exceeded maximum validity window and can no longer be processed.", now);
                    clearedProcessing++;
                }
            }

            await PaymentFulfillment.SaveAsync(_db, fulfillments, ct);

            // Only after the commit: a receipt for a fulfilment that failed to save would be a lie.
            foreach (var receipt in fulfillments.Select(f => f.Receipt).OfType<FulfillmentReceipt>())
                await _email.SendSubscriptionReceiptAsync(receipt.Recipient, receipt.Receipt, ct);

            if (staleProcessing.Count < BatchSize)
                break;
        }

        if (clearedPending > 0 || clearedProcessing > 0 || fulfilled > 0)
        {
            _logger.LogInformation(
                "Stale payments cleanup: {Pending} pending cleared, {Processing} processing cleared, {Fulfilled} fulfilled.",
                clearedPending, clearedProcessing, fulfilled);
        }

        return new ClearStalePaymentsResult(clearedPending, clearedProcessing, fulfilled);
    }
}
