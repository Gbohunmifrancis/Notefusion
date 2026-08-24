using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// A page of the webhook inbox, newest first — every provider callback we stored and whether it drained.
/// </summary>
/// <param name="Page">1-based. Values below 1 are clamped rather than rejected.</param>
/// <param name="PageSize">Clamped to <see cref="MaxPageSize"/>.</param>
/// <param name="Status">Keep only this processing state. Null returns every state.</param>
/// <param name="Provider">Keep only this gateway's callbacks.</param>
/// <param name="Search">
/// Case-insensitive substring of the provider's event id, the event type, or the payment reference. The
/// payload is deliberately not searched: it is a whole request body per row, and a scan across all of them
/// is a table scan over the largest column in the schema.
/// </param>
public sealed record GetWebhookEventsQuery(
    int Page = 1,
    int PageSize = 25,
    WebhookStatus? Status = null,
    PaymentProvider? Provider = null,
    string? Search = null) : IRequest<Result<PagedResultDto<AdminWebhookEventRowDto>>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetWebhookEventsQueryHandler
    : IRequestHandler<GetWebhookEventsQuery, Result<PagedResultDto<AdminWebhookEventRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetWebhookEventsQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PagedResultDto<AdminWebhookEventRowDto>>> Handle(
        GetWebhookEventsQuery request, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, GetWebhookEventsQuery.MaxPageSize);

        var query = _db.WebhookEvents.AsNoTracking();

        if (request.Status is { } status)
        {
            query = query.Where(e => e.Status == status);
        }

        if (request.Provider is { } provider)
        {
            query = query.Where(e => e.Provider == provider);
        }

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var term = request.Search.Trim().ToLowerInvariant();
            query = query.Where(e =>
                e.ProviderEventId.ToLower().Contains(term)
                || e.EventType.ToLower().Contains(term)
                || (e.PaymentReference != null && e.PaymentReference.ToLower().Contains(term)));
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(e => e.ReceivedAtUtc)
            // Two callbacks inside the same tick would otherwise page nondeterministically.
            .ThenBy(e => e.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(e => new AdminWebhookEventRowDto(
                e.Id,
                e.Provider.ToString(),
                e.ProviderEventId,
                e.EventType,
                e.PaymentReference,
                // Resolved so the row can link through. Correlated rather than joined because most of the
                // value is in the events that do NOT match a payment — a reference we cannot place is a
                // finding, and an inner join would hide exactly those rows.
                _db.PaymentTransactions
                    .Where(t => t.Reference == e.PaymentReference)
                    .Select(t => (Guid?)t.Id)
                    .FirstOrDefault(),
                e.Status.ToString(),
                e.ProcessAttempts,
                e.LastError,
                e.ReceivedAtUtc,
                e.LastAttemptAtUtc,
                e.ProcessedAtUtc))
            .ToListAsync(cancellationToken);

        return new PagedResultDto<AdminWebhookEventRowDto>(items, page, pageSize, totalCount);
    }
}
