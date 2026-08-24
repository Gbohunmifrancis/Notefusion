using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Common.Settings;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// A page of payment attempts across every account, newest first — the reconciliation console's table.
/// </summary>
/// <remarks>
/// Attempts, not sales: a failed checkout is the row that explains most billing tickets, and the stuck
/// ones are the reason this list exists at all.
/// </remarks>
/// <param name="Page">1-based. Values below 1 are clamped rather than rejected.</param>
/// <param name="PageSize">Clamped to <see cref="MaxPageSize"/> so one request cannot pull the whole history.</param>
/// <param name="Status">Keep only this state. Null returns every state.</param>
/// <param name="Provider">Keep only this gateway — the filter for "is Paystack having a bad afternoon".</param>
/// <param name="StuckOnly">
/// Keep only what the background sweep would pick up: still <c>Processing</c> past the grace window.
/// Combines with <paramref name="Status"/> rather than overriding it, so an impossible pair (stuck plus
/// <c>Completed</c>) correctly returns nothing instead of quietly ignoring one of them.
/// </param>
/// <param name="FromUtc">Inclusive lower bound on creation time.</param>
/// <param name="ToUtc">Exclusive upper bound on creation time, so a caller can pass midnight without double-counting a day.</param>
/// <param name="Search">Case-insensitive substring of our reference, the provider's reference, or the account's email.</param>
public sealed record GetPaymentsQuery(
    int Page = 1,
    int PageSize = 25,
    PaymentStatus? Status = null,
    PaymentProvider? Provider = null,
    bool StuckOnly = false,
    DateTime? FromUtc = null,
    DateTime? ToUtc = null,
    string? Search = null) : IRequest<Result<PagedResultDto<AdminPaymentRowDto>>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetPaymentsQueryHandler
    : IRequestHandler<GetPaymentsQuery, Result<PagedResultDto<AdminPaymentRowDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;
    private readonly BillingSettings _settings;

    public GetPaymentsQueryHandler(IApplicationDbContext db, IDateTimeProvider clock, BillingSettings settings)
    {
        _db = db;
        _clock = clock;
        _settings = settings;
    }

    public async Task<Result<PagedResultDto<AdminPaymentRowDto>>> Handle(
        GetPaymentsQuery request, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, GetPaymentsQuery.MaxPageSize);

        var stuckCutoff = PaymentOps.StuckCutoff(_clock.UtcNow, _settings);

        var query = _db.PaymentTransactions.AsNoTracking();

        if (request.Status is { } status)
        {
            query = query.Where(t => t.Status == status);
        }

        if (request.Provider is { } provider)
        {
            query = query.Where(t => t.Provider == provider);
        }

        if (request.StuckOnly)
        {
            query = query.Where(t => t.Status == PaymentStatus.Processing && t.UpdatedAtUtc < stuckCutoff);
        }

        if (request.FromUtc is { } from)
        {
            query = query.Where(t => t.CreatedAtUtc >= from);
        }

        if (request.ToUtc is { } to)
        {
            query = query.Where(t => t.CreatedAtUtc < to);
        }

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // Lowered on both sides so the match behaves the same on Postgres and on the SQLite the tests
            // use. The email match is an EXISTS rather than a join so a payment whose account has since
            // been deleted still appears under its reference.
            var term = request.Search.Trim().ToLowerInvariant();
            query = query.Where(t =>
                t.Reference.ToLower().Contains(term)
                || (t.ProviderReference != null && t.ProviderReference.ToLower().Contains(term))
                || _db.Users.Any(u => u.Id == t.UserId && u.Email.ToLower().Contains(term)));
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(t => t.CreatedAtUtc)
            // Two attempts inside the same tick would otherwise page nondeterministically.
            .ThenBy(t => t.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(t => new AdminPaymentRowDto(
                t.Id,
                t.UserId,
                // Correlated rather than joined, for left-join semantics: an inner join would drop the
                // payment entirely if its account or plan row were gone, and a payment that vanishes from
                // the reconciliation table is the one failure this page must not have.
                _db.Users.Where(u => u.Id == t.UserId).Select(u => u.Email).FirstOrDefault() ?? string.Empty,
                _db.Users.Where(u => u.Id == t.UserId).Select(u => u.FullName).FirstOrDefault() ?? string.Empty,
                t.Reference,
                t.ProviderReference,
                t.Provider.ToString(),
                t.Status.ToString(),
                t.AmountMinor,
                t.Currency,
                _db.Plans.Where(p => p.Id == t.PlanId).Select(p => p.Name).FirstOrDefault(),
                t.FailureReason,
                t.Status == PaymentStatus.Processing && t.UpdatedAtUtc < stuckCutoff,
                t.CreatedAtUtc,
                t.UpdatedAtUtc))
            .ToListAsync(cancellationToken);

        return new PagedResultDto<AdminPaymentRowDto>(items, page, pageSize, totalCount);
    }
}
