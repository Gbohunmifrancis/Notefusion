using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Billing.Commands;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Commands;

/// <summary>
/// Reconciles one payment on an operator's say-so, ahead of the sweep that would have got to it anyway,
/// and writes the audit entry for having asked.
/// </summary>
/// <remarks>
/// The reconciliation itself is <see cref="ReconcilePaymentCommand"/> — the same code the background
/// worker runs, unchanged. This wrapper exists for two things the worker does not need: an audit entry
/// naming the operator, and an answer that says which kind of success it was, because the inner command is
/// idempotent and reports "already settled, nothing to do" as plain success.
/// <para>
/// No separation-of-duties guard, unlike the subscription actions: this asks the provider what happened
/// and applies the answer. An operator pointing it at their own payment can only be told what they already
/// paid — there is no grant here to hand themselves, and refusing would leave them unable to unstick their
/// own checkout.
/// </para>
/// <para>
/// The attempt is recorded whether or not the provider cooperated. A verification that comes back
/// mismatched is the single most important thing on this page to have a trail of, and it is a failure
/// result.
/// </para>
/// </remarks>
public sealed record ReconcilePaymentAdminCommand(Guid PaymentTransactionId, string? Note = null)
    : IRequest<Result<AdminReconcileResultDto>>;

public sealed class ReconcilePaymentAdminCommandHandler
    : IRequestHandler<ReconcilePaymentAdminCommand, Result<AdminReconcileResultDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ISender _sender;
    private readonly ICurrentUser _currentUser;
    private readonly IAuditLogger _audit;

    public ReconcilePaymentAdminCommandHandler(
        IApplicationDbContext db, ISender sender, ICurrentUser currentUser, IAuditLogger audit)
    {
        _db = db;
        _sender = sender;
        _currentUser = currentUser;
        _audit = audit;
    }

    public async Task<Result<AdminReconcileResultDto>> Handle(
        ReconcilePaymentAdminCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is null)
            return AdminErrors.NotAuthenticated;

        // Tracked, and deliberately the same instance the inner handler will load from this scoped context:
        // after it saves, reading Status here reports what actually happened without a second query.
        var tx = await _db.PaymentTransactions
            .FirstOrDefaultAsync(t => t.Id == request.PaymentTransactionId, cancellationToken);

        if (tx is null)
            return BillingErrors.TransactionNotFound;

        var previous = tx.Status;
        var reference = tx.Reference;

        var target = await _db.Users.FirstOrDefaultAsync(u => u.Id == tx.UserId, cancellationToken);

        var result = await _sender.Send(new ReconcilePaymentCommand(tx.Id), cancellationToken);

        if (result.IsFailure)
        {
            var summary = $"Reconciliation of payment {reference} could not be completed: {result.Error.Message}";
            if (summary.Length > 295)
                summary = summary[..292] + "...";

            _audit.Record(
                AdminAuditAction.ReconcilePayment,
                target,
                summary,
                request.Note);

            await _db.SaveChangesAsync(cancellationToken);
            return result.Error;
        }

        var changed = tx.Status != previous;

        _audit.Record(
            AdminAuditAction.ReconcilePayment,
            target,
            changed
                ? $"Reconciled payment {reference} with the provider. {previous} → {tx.Status}."
                : $"Reconciled payment {reference} with the provider. No change; it was already {previous}.",
            request.Note);

        await _db.SaveChangesAsync(cancellationToken);

        return new AdminReconcileResultDto(
            tx.Id,
            previous.ToString(),
            tx.Status.ToString(),
            changed,
            Describe(previous, tx.Status));
    }

    /// <summary>
    /// Turns the state pair into the sentence the console shows. Written here rather than in the client
    /// because the meaning of each pair is a billing rule — "verified but not completed means they paid and
    /// have nothing" is not something a dashboard should be left to work out.
    /// </summary>
    private static string Describe(PaymentStatus previous, PaymentStatus current)
        => (previous, current) switch
        {
            (_, PaymentStatus.Completed) when previous != PaymentStatus.Completed =>
                "The provider confirmed the payment. The subscription was applied and a receipt sent.",

            (_, PaymentStatus.Failed) when previous != PaymentStatus.Failed =>
                "The provider reports this checkout can no longer be paid, so it is closed. "
                + "The customer can start a new one.",

            (_, PaymentStatus.Verified) when previous != PaymentStatus.Verified =>
                "The provider confirmed the payment, but applying the subscription did not finish. "
                + "The money is safe and nothing will be charged again — this needs a developer, not another "
                + "reconciliation.",

            (PaymentStatus.Completed, _) => "This payment was already completed; there was nothing to reconcile.",

            (PaymentStatus.Failed, _) => "This payment had already failed; there was nothing to reconcile.",

            (PaymentStatus.Pending, _) =>
                "Checkout was never opened for this payment, so the provider has nothing to report on it yet.",

            // The money moved and the entitlement was never written. Reconciliation deliberately only acts
            // on Processing rows, so saying "try again" here would be sending the operator round a loop that
            // cannot end: this state is not recoverable from the console today.
            (PaymentStatus.Verified, _) =>
                "The money is confirmed but the subscription was never applied, and reconciliation does not "
                + "retry this state. Escalate it — the customer has paid and has nothing.",

            // Still Processing. The customer may yet pay it, so nothing is closed on a provider that has
            // not given a final answer.
            _ => "The provider has not settled this payment yet. It stays open for the next sweep."
        };
}
