using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// A page of accounts for the admin table, newest first, optionally filtered by name or email.
/// </summary>
/// <param name="Page">1-based. Values below 1 are clamped rather than rejected.</param>
/// <param name="PageSize">Clamped to <see cref="MaxPageSize"/> so one request cannot pull the table.</param>
/// <param name="Search">Case-insensitive substring of name or email. Null or blank disables it.</param>
/// <param name="IsActive">
/// Keep only accounts that can sign in (<c>true</c>) or only suspended ones (<c>false</c>). Null returns
/// both. Filtered here rather than in the client because the client only holds one page: filtering after
/// paging would show "12 of 340" on a page of 25 and never reach the suspended account on page nine.
/// </param>
public sealed record GetAdminUsersQuery(
    int Page = 1,
    int PageSize = 25,
    string? Search = null,
    bool? IsActive = null)
    : IRequest<Result<PagedResultDto<AdminUserRowDto>>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetAdminUsersQueryHandler
    : IRequestHandler<GetAdminUsersQuery, Result<PagedResultDto<AdminUserRowDto>>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetAdminUsersQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<PagedResultDto<AdminUserRowDto>>> Handle(
        GetAdminUsersQuery request, CancellationToken cancellationToken)
    {
        // Clamped rather than validated: a paging control that overshoots the last page is a normal
        // thing for a UI to do, and failing the request would turn it into an error state.
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, GetAdminUsersQuery.MaxPageSize);

        var query = _db.Users.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // Lowered on both sides so the match is case-insensitive on Postgres and on the SQLite
            // the tests use, without depending on either one's collation.
            var term = request.Search.Trim().ToLowerInvariant();
            query = query.Where(u => u.Email.ToLower().Contains(term) || u.FullName.ToLower().Contains(term));
        }

        if (request.IsActive is { } isActive)
        {
            query = query.Where(u => u.IsActive == isActive);
        }

        var totalCount = await query.CountAsync(cancellationToken);

        // Subscriptions that unlock Pro at this instant. Composed into the projection below rather than
        // repeated in it, and deliberately the same predicate GetSystemHealthQuery counts with — the
        // users table and the health page must not disagree about who is a subscriber.
        var now = _clock.UtcNow;
        var live = _db.Subscriptions.Where(s =>
            (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
            && s.CurrentPeriodEndUtc > now);

        // The per-row transcription count is a correlated subquery in one round trip rather than a
        // count per row, which would be an N+1 across the whole page.
        var items = await query
            .OrderByDescending(u => u.CreatedAt)
            .ThenBy(u => u.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(u => new AdminUserRowDto(
                u.Id,
                u.FullName,
                u.Email,
                u.ProfilePictureUrl,
                u.Role.ToString(),
                u.IsActive,
                u.GoogleId != null,
                u.PasswordHash != null,
                u.CreatedAt,
                u.LastLoginAt,
                _db.Transcriptions.Count(t => t.UserId == u.Id),
                live.Any(s => s.UserId == u.Id),
                live.Any(s => s.UserId == u.Id && s.Provider == null)))
            .ToListAsync(cancellationToken);

        return new PagedResultDto<AdminUserRowDto>(items, page, pageSize, totalCount);
    }
}
