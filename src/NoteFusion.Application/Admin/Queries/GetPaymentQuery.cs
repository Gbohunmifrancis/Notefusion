using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// One payment attempt in full: the row, the raw provider payloads, and everything that happened because
/// of it — the ledger movements it produced and the webhook events that named it.
/// </summary>
/// <remarks>
/// The three parts are fetched separately rather than as one projection because this is a single row and
/// the readability is worth more than the round trips. Nothing here is capped: a payment has at most a
/// couple of ledger movements, and the unique index on the inbox bounds the events to the distinct
/// callbacks the provider actually sent.
/// </remarks>
public sealed record GetPaymentQuery(Guid PaymentTransactionId) : IRequest<Result<AdminPaymentDetailDto>>;

public sealed class GetPaymentQueryHandler : IRequestHandler<GetPaymentQuery, Result<AdminPaymentDetailDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly BillingSettings _settings;

    public GetPaymentQueryHandler(IApplicationDbContext db, IDateTimeProvider clock, BillingSettings settings)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<AdminPaymentDetailDto>> Handle(
        GetPaymentQuery request, CancellationToken cancellationToken)
    {
        var tx = await _db.PaymentTransactions
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == request.PaymentTransactionId, cancellationToken);

        if (tx is null)
            return BillingErrors.TransactionNotFound;

        var account = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id == tx.UserId)
            .Select(u => new { u.Email, u.FullName })
            .FirstOrDefaultAsync(cancellationToken);

        var planName = await _db.Plans
            .AsNoTracking()
            .Where(p => p.Id == tx.PlanId)
            .Select(p => p.Name)
            .FirstOrDefaultAsync(cancellationToken);

        var stuckCutoff = PaymentOps.StuckCutoff(_clock.UtcNow, _settings);

        var row = new AdminPaymentRowDto(
            tx.Id,
            tx.UserId,
            account?.Email ?? string.Empty,
            account?.FullName ?? string.Empty,
            tx.Reference,
            tx.ProviderReference,
            tx.Provider.ToString(),
            tx.Status.ToString(),
            tx.AmountMinor,
            tx.Currency,
            planName,
            tx.FailureReason,
            tx.Status == PaymentStatus.Processing && tx.UpdatedAtUtc < stuckCutoff,
            tx.CreatedAtUtc,
            tx.UpdatedAtUtc);

        var ledger = await _db.LedgerEntries
            .AsNoTracking()
            .Where(e => e.PaymentTransactionId == tx.Id)
            .OrderByDescending(e => e.CreatedAtUtc)
            .Select(e => new AdminLedgerEntryDto(
                e.Id,
                e.Direction.ToString(),
                e.Reason.ToString(),
                e.AmountMinor,
                e.Currency,
                e.Description,
                e.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        // Matched on our own reference, which is what we send the provider and what it echoes back. An
        // event that arrived with no reference we could read is not attached to any payment by definition,
        // and shows up only on the inbox page.
        var events = await _db.WebhookEvents
            .AsNoTracking()
            .Where(e => e.PaymentReference == tx.Reference)
            .OrderByDescending(e => e.ReceivedAtUtc)
            .Select(e => new AdminWebhookEventRowDto(
                e.Id,
                e.Provider.ToString(),
                e.ProviderEventId,
                e.EventType,
                e.PaymentReference,
                tx.Id,
                e.Status.ToString(),
                e.ProcessAttempts,
                e.LastError,
                e.ReceivedAtUtc,
                e.LastAttemptAtUtc,
                e.ProcessedAtUtc))
            .ToListAsync(cancellationToken);

        return new AdminPaymentDetailDto(
            row,
            tx.IdempotencyKey,
            tx.CheckoutUrl,
            tx.InitiateRaw,
            tx.VerifyRaw,
            ledger,
            events);
    }
}
