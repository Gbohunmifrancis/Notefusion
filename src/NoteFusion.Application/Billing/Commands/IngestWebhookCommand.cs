using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities.Billing;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Billing.Commands;

/// <summary>
/// Persists a provider webhook into the inbox (the "Persist Event" step of
/// Receive → Validate Signature → Persist Event → Publish → Worker). The signature is verified by the
/// controller BEFORE this runs. Writing the row is idempotent: a replayed webhook (same provider +
/// event id) returns the existing row's id instead of inserting a duplicate, which is what makes
/// downstream processing exactly-once. Returns the inbox row id so the caller can enqueue it.
/// </summary>
/// <param name="Settles">
/// False for an event that cannot settle a payment (see <c>WebhookMessage.Settles</c>): it is kept for the
/// record but stored already handled, so the worker never retries it into a parked failure.
/// </param>
public sealed record IngestWebhookCommand(
    PaymentProvider Provider,
    string ProviderEventId,
    string EventType,
    string? PaymentReference,
    string Payload,
    bool Settles = true) : IRequest<Result<Guid>>;

public sealed class IngestWebhookCommandHandler : IRequestHandler<IngestWebhookCommand, Result<Guid>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public IngestWebhookCommandHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<Guid>> Handle(IngestWebhookCommand request, CancellationToken ct)
    {
        var existing = await _db.WebhookEvents.FirstOrDefaultAsync(
            e => e.Provider == request.Provider && e.ProviderEventId == request.ProviderEventId, ct);
        if (existing is not null)
            return existing.Id; // duplicate delivery — already stored, safe to ignore

        var e = WebhookEvent.Receive(
            request.Provider, request.ProviderEventId, request.EventType,
            request.PaymentReference, request.Payload, _clock.UtcNow);

        // Acknowledged, not processed: nothing to verify or fulfil, so it is handled the moment it is kept.
        if (!request.Settles)
            e.MarkProcessed(_clock.UtcNow);

        _db.WebhookEvents.Add(e);

        try
        {
            await _db.SaveChangesAsync(ct);
            return e.Id;
        }
        catch (DbUpdateException)
        {
            // Lost a race with a concurrent delivery of the same event; the unique index is the real
            // guard. Re-read the winner and treat this call as the duplicate it is.
            var winner = await _db.WebhookEvents.FirstOrDefaultAsync(
                x => x.Provider == request.Provider && x.ProviderEventId == request.ProviderEventId, ct);
            return winner is not null ? winner.Id : Result.Failure<Guid>(Error.Failure("BILLING_WEBHOOK_PERSIST_FAILED", "Could not persist the webhook event."));
        }
    }
}
