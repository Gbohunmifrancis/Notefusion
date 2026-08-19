using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Applies the business effect of a verified payment, exactly once. Invoked by the webhook worker for
/// each inbox row. The flow re-verifies with the provider (signature proves the message came from them,
/// not that the money moved), checks amount and currency against our own transaction, then writes the
/// ledger credit, the subscription, the completed status, and the processed flag in ONE atomic
/// SaveChanges. It is fully idempotent: an already-completed payment, or an already-processed event,
/// returns success and changes nothing (a duplicate webhook is a no-op).
/// </summary>
public sealed record ProcessWebhookEventCommand(Guid WebhookEventId) : IRequest<Result>;

public sealed class ProcessWebhookEventCommandHandler : IRequestHandler<ProcessWebhookEventCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly IPaymentGatewayFactory _gateways;
    private readonly IDateTimeProvider _clock;
    private readonly IEmailSender _email;

    public ProcessWebhookEventCommandHandler(
        IApplicationDbContext db, IPaymentGatewayFactory gateways, IDateTimeProvider clock, IEmailSender email)
    {
        _db = db;
        _gateways = gateways;
        _clock = clock;
        _email = email;
    }

    public async Task<Result> Handle(ProcessWebhookEventCommand request, CancellationToken ct)
    {
        var e = await _db.WebhookEvents.FirstOrDefaultAsync(x => x.Id == request.WebhookEventId, ct);
        if (e is null)
            return BillingErrors.WebhookEventNotFound;

        // Already handled (or parked). Nothing to do — makes reprocessing safe.
        if (e.Status != WebhookStatus.Received)
            return Result.Success();

        if (string.IsNullOrWhiteSpace(e.PaymentReference))
            return Error.Validation("BILLING_WEBHOOK_NO_REFERENCE", "Webhook carried no payment reference.");

        var tx = await _db.PaymentTransactions.FirstOrDefaultAsync(t => t.Reference == e.PaymentReference, ct);
        if (tx is null)
            return BillingErrors.TransactionNotFound;

        var now = _clock.UtcNow;

        // Duplicate of an already-fulfilled payment: succeed and do nothing (spec: return 200, no effect).
        if (tx.Status == PaymentStatus.Completed)
        {
            e.MarkProcessed(now);
            await _db.SaveChangesAsync(ct);
            return Result.Success();
        }

        // Authoritative check with the provider. Done BEFORE any entity is mutated, so a failure here
        // never leaves half-applied state to save.
        var verification = await _gateways.Resolve(tx.Provider)
            .VerifyAsync(new GatewayVerificationRequest(tx.Reference, tx.ProviderReference), ct);
        if (verification.IsFailure)
            return verification.Error;
        var v = verification.Value;

        if (!v.Succeeded)
        {
            // Provider says this payment did not succeed; there is nothing to fulfil. Mark handled so
            // the worker stops retrying; a later success will arrive as its own event.
            //
            // When the answer is final — an expired or cancelled session — the transaction has to be
            // closed as well, not just the event. A row left Processing still reads as an in-flight
            // checkout, so InitiateCheckout keeps handing this user the dead session's URL and no later
            // attempt can open a new one: the upgrade path stays bricked until someone edits the database.
            // Anything less than final is left alone, because the customer may still pay it.
            if (v.Terminal)
                tx.MarkFailed($"Provider reported '{e.EventType}'; this checkout can no longer be paid.", now);

            e.MarkProcessed(now);
            await _db.SaveChangesAsync(ct);
            return Result.Success();
        }

        // Integrity gate: never fulfil on a mismatched amount or currency.
        if (v.AmountMinor != tx.AmountMinor
            || !string.Equals(v.Currency, tx.Currency, StringComparison.OrdinalIgnoreCase))
        {
            return BillingErrors.VerificationMismatch;
        }

        // ---- Fulfilment: a single unit of work. Every write below commits together or not at all. ----
        var receipt = await PaymentFulfillment.ApplyAsync(_db, tx, v, now, ct);
        e.MarkProcessed(now);
        await _db.SaveChangesAsync(ct);

        // After the commit: a receipt sent for a fulfilment that then failed to save would be a lie.
        // The send is best-effort (IEmailSender never throws), so a mail outage cannot fail the webhook
        // and make the provider retry a payment we have already fulfilled.
        if (receipt is not null)
            await _email.SendSubscriptionReceiptAsync(receipt.Recipient, receipt.Receipt, ct);

        return Result.Success();
    }
}
