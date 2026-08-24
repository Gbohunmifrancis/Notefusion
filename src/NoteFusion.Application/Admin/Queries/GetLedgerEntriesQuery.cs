using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// A page of the money ledger across every account, newest first.
/// </summary>
/// <remarks>
/// The ledger is append-only: a correction is a compensating entry, never an edit, so this list is the
/// financial record and nothing on this page can change it. Gifted subscriptions do not appear at all —
/// no payment, no entry — which is deliberate, because a report that summed gifts would be counting
/// revenue nobody paid.
/// <para>
/// The balance is not returned here. It is on the operations summary, which is where the figure is read
/// against the payment states that produced it; a total attached to a filtered page would look like a
/// balance and be a subtotal.
/// </para>
/// </remarks>
/// <param name="Page">1-based. Values below 1 are clamped rather than rejected.</param>
/// <param name="PageSize">Clamped to <see cref="MaxPageSize"/>.</param>
/// <param name="Direction">Credits (money in) or debits (money out). Null returns both.</param>
/// <param name="Reason">Keep only entries written for this reason.</param>
/// <param name="FromUtc">Inclusive lower bound on when the entry was written.</param>
/// <param name="ToUtc">Exclusive upper bound, so a caller can pass midnight without double-counting a day.</param>
/// <param name="Search">Case-insensitive substring of the account's email or the payment's reference.</param>
public sealed record GetLedgerEntriesQuery(
    int Page = 1,
    int PageSize = 25,
    LedgerDirection? Direction = null,
    LedgerEntryReason? Reason = null,
    DateTime? FromUtc = null,
    DateTime? ToUtc = null,
    string? Search = null) : IRequest<Result<PagedResultDto<AdminLedgerRowDto>>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetLedgerEntriesQueryHandler
    : IRequestHandler<GetLedgerEntriesQuery, Result<PagedResultDto<AdminLedgerRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetLedgerEntriesQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PagedResultDto<AdminLedgerRowDto>>> Handle(
        GetLedgerEntriesQuery request, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, GetLedgerEntriesQuery.MaxPageSize);

        var query = _db.LedgerEntries.AsNoTracking();

        if (request.Direction is { } direction)
        {
            query = query.Where(e => e.Direction == direction);
        }

        if (request.Reason is { } reason)
        {
            query = query.Where(e => e.Reason == reason);
        }

        if (request.FromUtc is { } from)
        {
            query = query.Where(e => e.CreatedAtUtc >= from);
        }

        if (request.ToUtc is { } to)
        {
            query = query.Where(e => e.CreatedAtUtc < to);
        }

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var term = request.Search.Trim().ToLowerInvariant();
            query = query.Where(e =>
                _db.Users.Any(u => u.Id == e.UserId && u.Email.ToLower().Contains(term))
                || _db.PaymentTransactions.Any(t =>
                    t.Id == e.PaymentTransactionId && t.Reference.ToLower().Contains(term)));
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(e => e.CreatedAtUtc)
            // Two movements inside the same tick would otherwise page nondeterministically.
            .ThenBy(e => e.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(e => new AdminLedgerRowDto(
                e.Id,
                e.UserId,
                _db.Users.Where(u => u.Id == e.UserId).Select(u => u.Email).FirstOrDefault() ?? string.Empty,
                e.PaymentTransactionId,
                _db.PaymentTransactions
                    .Where(t => t.Id == e.PaymentTransactionId)
                    .Select(t => t.Reference)
                    .FirstOrDefault(),
                e.Direction.ToString(),
                e.Reason.ToString(),
                e.AmountMinor,
                e.Currency,
                e.Description,
                e.CreatedAtUtc))
            .ToListAsync(cancellationToken);

        return new PagedResultDto<AdminLedgerRowDto>(items, page, pageSize, totalCount);
    }
}
