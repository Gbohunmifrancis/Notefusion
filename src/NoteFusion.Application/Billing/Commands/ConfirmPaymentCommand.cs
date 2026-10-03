using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
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
/// <c>PaymentReconciliationWorker</c> only looks at rows a few minutes stale. The wait a user
/// experiences is the provider deciding to call us. So rather than wait to be told, we ask — the
/// answer is available from the provider's verify endpoint the instant the payment lands.
/// <para>
/// It adds no payment logic of its own: it picks the caller's recent checkouts and hands each to
/// <see cref="ReconcilePaymentCommand"/>, which is already the "a webhook never arrived" recovery path
/// and already documented as idempotent and safe to run alongside live webhooks. Fulfilment therefore
/// happens in exactly one place no matter which route gets there first. Not just the newest one: a user
/// who opened a second checkout (or tapped Upgrade on two devices) may have paid the older, so the
/// in-flight rows are asked about newest first until one completes. A checkout closed in the last couple
/// of hours is asked about too — a row a sweep failed while the customer was still paying is exactly the
/// one they are waiting on.
/// </para>
/// <para>
/// The transactions are chosen server-side from the authenticated identity and are never a parameter.
/// Taking an id from the caller would let anyone reconcile — and so trigger fulfilment and a receipt
/// email for — a transaction belonging to someone else.
/// </para>
/// </remarks>
public sealed record ConfirmPaymentCommand : IRequest<Result<SubscriptionDto>>;

public sealed class ConfirmPaymentCommandHandler : IRequestHandler<ConfirmPaymentCommand, Result<SubscriptionDto>>
{
    /// <summary>How far back an in-flight checkout is still worth asking about, and how many of them.</summary>
    private static readonly TimeSpan InFlightWindow = TimeSpan.FromHours(48);
    private const int MaxInFlight = 3;

    /// <summary>How recently a closed checkout may have been closed for it to be asked about again.</summary>
    private static readonly TimeSpan RecentlyFailedWindow = TimeSpan.FromHours(2);
    private const int MaxRecentlyFailed = 2;

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly ISender _sender;
    private readonly IDateTimeProvider _clock;

    public ConfirmPaymentCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, ISender sender, IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _sender = sender;
        _clock = clock;
    }

    public async Task<Result<SubscriptionDto>> Handle(ConfirmPaymentCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var now = _clock.UtcNow;
        var inFlightSince = now - InFlightWindow;

        // Tracked, and the same instances the reconcile handler loads from this scoped context, so each
        // one's Status reads what reconciliation just did to it.
        var inFlight = await _db.PaymentTransactions
            .Where(t => t.UserId == userId
                        && t.Status == PaymentStatus.Processing
                        && t.CreatedAtUtc >= inFlightSince)
            .OrderByDescending(t => t.CreatedAtUtc)
            .Take(MaxInFlight)
            .ToListAsync(ct);

        // Nothing in flight is the happy path, not an error: a webhook that beat us here has already
        // completed the row.
        if (await ReconcileUntilOneCompletesAsync(inFlight, ct))
            return await _sender.Send(new GetMySubscriptionQuery(), ct);

        // Rows this call just closed are excluded: the provider was asked about them a moment ago.
        var askedAlready = inFlight.Select(t => t.Id).ToList();
        var failedSince = now - RecentlyFailedWindow;
        var recentlyFailed = await _db.PaymentTransactions
            .Where(t => t.UserId == userId
                        && t.Status == PaymentStatus.Failed
                        && t.UpdatedAtUtc >= failedSince
                        && t.ProviderReference != null
                        && !askedAlready.Contains(t.Id))
            .OrderByDescending(t => t.UpdatedAtUtc)
            .Take(MaxRecentlyFailed)
            .ToListAsync(ct);

        await ReconcileUntilOneCompletesAsync(recentlyFailed, ct);

        return await _sender.Send(new GetMySubscriptionQuery(), ct);
    }

    /// <summary>True as soon as one of <paramref name="candidates"/> is fulfilled; the rest are not asked.</summary>
    private async Task<bool> ReconcileUntilOneCompletesAsync(
        IReadOnlyList<PaymentTransaction> candidates, CancellationToken ct)
    {
        foreach (var tx in candidates)
        {
            // Result deliberately discarded. A provider we could not reach must not cost the user their
            // subscription state, and reconcile leaves the row as it was on any transient failure — so
            // the webhook and the sweep are both still coming. Reporting what we know now is more useful
            // to the client than a 502, and every genuine outcome is already on the row.
            _ = await _sender.Send(new ReconcilePaymentCommand(tx.Id), ct);
            if (tx.Status == PaymentStatus.Completed)
                return true;
        }

        return false;
    }
}
