using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Billing.Dtos;
using NoteFusion.Application.Billing.Queries;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Activity;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
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
    private readonly IClientApp? _client;

    public ConfirmPaymentCommandHandler(
        IApplicationDbContext db, ICurrentUser currentUser, ISender sender, IDateTimeProvider clock, IClientApp? client = null)
    {
        _db = db;
        _currentUser = currentUser;
        _sender = sender;
        _clock = clock;
        _client = client;
    }

    /// <summary>The activity row a return from a checkout writes (<c>ActivityNames</c>: "Came back from a checkout").</summary>
    public const string ActivityName = "billing.confirm";

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
        await RecordReturnAsync(userId, inFlight, now, ct);
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

    /// <summary>
    /// "Came back from a checkout" in the account's activity, only when there was one: the app asks this on every return
    /// to the front and every few seconds while a checkout is open, so the request alone says nothing (the activity
    /// filter leaves the route out). One row per checkout, naming its plan, written before the provider is asked so it
    /// never shares a save with fulfilment; a payment shows in the feed as its own row.
    /// </summary>
    private async Task RecordReturnAsync(Guid userId, IReadOnlyList<PaymentTransaction> inFlight, DateTime now, CancellationToken ct)
    {
        if (inFlight.Count == 0)
            return;
        var tx = inFlight[0];
        var plan = await _db.Plans.Where(p => p.Id == tx.PlanId).Select(p => p.Name).FirstOrDefaultAsync(ct) ?? "a plan";
        var detail = $"plan={plan};checkout={tx.Reference}";
        if (await _db.UserActivities.AnyAsync(a => a.UserId == userId && a.Name == ActivityName && a.Detail == detail, ct))
            return;
        _db.UserActivities.Add(UserActivity.Record(userId, ActivityName, detail, ActivityClient.From(_client?.Current), now));
        await _db.SaveChangesAsync(ct);
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
            try
            {
                _ = await _sender.Send(new ReconcilePaymentCommand(tx.Id), ct);
            }
            catch (DbUpdateException)
            {
                // Lost the race to fulfil this payment: the client polls this the moment the payment lands,
                // which is the same moment the webhook worker fulfils it, and the ledger's unique index
                // refused the second write. The winner's fulfilment is committed, so report the state rather
                // than a 500, and save nothing more on this context.
                return true;
            }

            if (tx.Status == PaymentStatus.Completed)
                return true;
        }

        return false;
    }
}
