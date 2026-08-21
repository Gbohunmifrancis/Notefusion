using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Asks the provider — right now, on the caller's behalf — whether their in-flight checkout was paid,
/// and returns the resulting subscription state. The app sends this the moment the checkout browser
/// closes.
/// </summary>
/// <remarks>
/// This exists because the webhook is the slow part. Nothing on our side takes minutes:
/// <c>PaymentWebhookWorker</c> drains the inbox every few seconds and
/// <c>PaymentReconciliationWorker</c> only looks at rows already ten minutes stale. The wait a user
/// experiences is the provider deciding to call us. So rather than wait to be told, we ask — the
/// answer is available from the provider's verify endpoint the instant the payment lands.
/// <para>
/// It adds no payment logic of its own: it picks the caller's pending transaction and hands it to
/// <see cref="ReconcilePaymentCommand"/>, which is already the "a webhook never arrived" recovery path
/// and already documented as idempotent and safe to run alongside live webhooks. Fulfilment therefore
/// happens in exactly one place no matter which route gets there first.
/// </para>
/// <para>
/// The transaction is chosen server-side from the authenticated identity and is never a parameter.
/// Taking an id from the caller would let anyone reconcile — and so trigger fulfilment and a receipt
/// email for — a transaction belonging to someone else.
/// </para>
/// </remarks>
public sealed record ConfirmPaymentCommand : IRequest<Result<SubscriptionDto>>;

public sealed class ConfirmPaymentCommandHandler : IRequestHandler<ConfirmPaymentCommand, Result<SubscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly ISender _sender;

    public ConfirmPaymentCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, ISender sender)
    {
        _db = db;
        _currentUser = currentUser;
        _sender = sender;
    }

    public async Task<Result<SubscriptionDto>> Handle(ConfirmPaymentCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var pending = await _db.PaymentTransactions
            .Where(t => t.UserId == userId && t.Status == PaymentStatus.Processing)
            .OrderByDescending(t => t.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);

        // No pending checkout is the happy path, not an error: a webhook that beat us here has already
        // completed the row.
        if (pending is not null)
        {
            // Result deliberately discarded. A provider we could not reach must not cost the user their
            // subscription state, and reconcile leaves the row in Processing on any transient failure —
            // so the webhook and the 15-minute sweep are both still coming. Reporting what we know now
            // is more useful to the client than a 502, and every genuine outcome is already on the row.
            _ = await _sender.Send(new ReconcilePaymentCommand(pending.Id), ct);
        }

        return await _sender.Send(new GetMySubscriptionQuery(), ct);
    }
}
