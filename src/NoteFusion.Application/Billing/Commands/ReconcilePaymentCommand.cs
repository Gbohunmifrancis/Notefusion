using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Reconciles one stuck payment against the provider — the recovery path for a webhook we never
/// received. Given a transaction still in <c>Processing</c>, it asks the provider what actually
/// happened: on a confirmed, amount-matched success it fulfils exactly as the webhook path would (same
/// <see cref="PaymentFulfillment"/>, one transaction); on a final non-success it closes the row so the
/// user can start over; on anything still open it leaves the row for the next sweep or a later webhook.
/// A <c>Failed</c> row is asked about too, because a checkout we closed can still have been paid: a
/// confirmed success fulfils it, and any other answer leaves it Failed. Idempotent — an
/// already-completed payment is a no-op — so it is safe to run repeatedly alongside live webhooks.
/// </summary>
public sealed record ReconcilePaymentCommand(Guid PaymentTransactionId) : IRequest<Result>;

public sealed class ReconcilePaymentCommandHandler : IRequestHandler<ReconcilePaymentCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IPaymentGatewayFactory _gateways;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;

    public ReconcilePaymentCommandHandler(
        IApplicationDbContext db, IPaymentGatewayFactory gateways, IDateTimeProvider clock, IEmailSender email)
    {
        _db = db;
        _gateways = gateways;
        _clock = clock;
        _email = email;
    }

    public async Task<Result> Handle(ReconcilePaymentCommand request, CancellationToken ct)
    {
        var tx = await _db.PaymentTransactions.FirstOrDefaultAsync(t => t.Id == request.PaymentTransactionId, ct);
        if (tx is null)
            return BillingErrors.TransactionNotFound;

        return await ReconcileAsync(_db, _gateways, _clock, _email, tx, ct);
    }

    /// <summary>
    /// The reconciliation itself, for a transaction the caller has already loaded (tracked). Shared with
    /// <see cref="InitiateCheckoutCommand"/>, which settles an old in-flight checkout this way before it
    /// opens a new one — so there is still exactly one place that turns a provider's answer into state.
    /// </summary>
    internal static async Task<Result> ReconcileAsync(
        IApplicationDbContext db, IPaymentGatewayFactory gateways, IDateTimeProvider clock, IEmailSender email,
        PaymentTransaction tx, CancellationToken ct)
    {
        // Nothing to reconcile unless it is mid-flight or was closed; Completed, Verified and pre-checkout
        // states are left alone.
        if (tx.Status is not (PaymentStatus.Processing or PaymentStatus.Failed))
            return Result.Success();

        var verification = await gateways.Resolve(tx.Provider)
            .VerifyAsync(new GatewayVerificationRequest(tx.Reference, tx.ProviderReference), ct);
        if (verification.IsFailure)
            return verification.Error;
        var v = verification.Value;

        // Provider hasn't settled it. A final answer — the session expired or was cancelled — closes the
        // row, which is the only thing that lets the user's next attempt open a fresh checkout instead of
        // being handed this dead one again. Anything less final is left for a later sweep or webhook,
        // because the customer may still pay it. A row that is already Failed simply stays so.
        if (!v.Succeeded)
        {
            if (v.Terminal && tx.Status == PaymentStatus.Processing)
            {
                tx.MarkFailed("Provider reports this checkout can no longer be paid.", clock.UtcNow);
                await db.SaveChangesAsync(ct);
            }

            return Result.Success();
        }

        if (!string.Equals(v.Currency, tx.Currency, StringComparison.OrdinalIgnoreCase)
            || v.AmountMinor < tx.AmountMinor)
        {
            return BillingErrors.VerificationMismatchDetail(tx.AmountMinor, tx.Currency, v.AmountMinor, v.Currency, v.Raw);
        }

        var fulfillment = await PaymentFulfillment.ApplyAsync(db, tx, v, clock.UtcNow, ct);
        await PaymentFulfillment.SaveAsync(db, fulfillment, ct);

        // The webhook we never received would have sent this; reconciliation is that path's stand-in,
        // so it owes the same receipt. Best-effort and post-commit, for the same reasons as there.
        if (fulfillment?.Receipt is { } receipt)
            await email.SendSubscriptionReceiptAsync(receipt.Recipient, receipt.Receipt, ct);

        return Result.Success();
    }
}
