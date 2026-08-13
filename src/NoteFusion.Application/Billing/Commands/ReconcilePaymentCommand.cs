using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Reconciles one stuck payment against the provider — the recovery path for a webhook we never
/// received. Given a transaction still in <c>Processing</c>, it asks the provider what actually
/// happened: on a confirmed, amount-matched success it fulfils exactly as the webhook path would (same
/// <see cref="PaymentFulfillment"/>, one transaction); on a definite non-success it leaves the row for
/// the next sweep or a later webhook. Idempotent — an already-completed payment is a no-op — so it is
/// safe to run repeatedly alongside live webhooks.
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

        // Nothing to reconcile unless it is mid-flight; terminal and pre-checkout states are left alone.
        if (tx.Status != PaymentStatus.Processing)
            return Result.Success();

        var verification = await _gateways.Resolve(tx.Provider).VerifyAsync(tx.Reference, ct);
        if (verification.IsFailure)
            return verification.Error;
        var v = verification.Value;

        // Provider hasn't settled it (yet). Leave as-is; a later sweep or webhook will catch it.
        if (!v.Succeeded)
            return Result.Success();

        if (v.AmountMinor != tx.AmountMinor
            || !string.Equals(v.Currency, tx.Currency, StringComparison.OrdinalIgnoreCase))
        {
            return BillingErrors.VerificationMismatch;
        }

        var receipt = await PaymentFulfillment.ApplyAsync(_db, tx, v, _clock.UtcNow, ct);
        await _db.SaveChangesAsync(ct);

        // The webhook we never received would have sent this; reconciliation is that path's stand-in,
        // so it owes the same receipt. Best-effort and post-commit, for the same reasons as there.
        if (receipt is not null)
            await _email.SendSubscriptionReceiptAsync(receipt.Recipient, receipt.Receipt, ct);

        return Result.Success();
    }
}
