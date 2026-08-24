using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// One inbox row with the request body it stored — the only place the raw callback is readable outside a
/// database session, and the field that explains a parked event.
/// </summary>
public sealed record GetWebhookEventQuery(Guid WebhookEventId) : IRequest<Result<AdminWebhookEventDetailDto>>;

public sealed class GetWebhookEventQueryHandler
    : IRequestHandler<GetWebhookEventQuery, Result<AdminWebhookEventDetailDto>>
{
    private readonly IApplicationDbContext _db;

    public GetWebhookEventQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<AdminWebhookEventDetailDto>> Handle(
        GetWebhookEventQuery request, CancellationToken cancellationToken)
    {
        var e = await _db.WebhookEvents
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.WebhookEventId, cancellationToken);

        if (e is null)
            return BillingErrors.WebhookEventNotFound;

        var paymentTransactionId = await _db.PaymentTransactions
            .AsNoTracking()
            .Where(t => t.Reference == e.PaymentReference)
            .Select(t => (Guid?)t.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var row = new AdminWebhookEventRowDto(
            e.Id,
            e.Provider.ToString(),
            e.ProviderEventId,
            e.EventType,
            e.PaymentReference,
            paymentTransactionId,
            e.Status.ToString(),
            e.ProcessAttempts,
            e.LastError,
            e.ReceivedAtUtc,
            e.LastAttemptAtUtc,
            e.ProcessedAtUtc);

        return new AdminWebhookEventDetailDto(row, e.Payload);
    }
}
