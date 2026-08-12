using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

/// <summary>
/// A page of accounts for the admin table, newest first, optionally filtered by name or email.
/// </summary>
/// <param name="Page">1-based. Values below 1 are clamped rather than rejected.</param>
/// <param name="PageSize">Clamped to <see cref="MaxPageSize"/> so one request cannot pull the table.</param>
/// <param name="Search">Case-insensitive substring of name or email. Null or blank disables it.</param>
public sealed record GetAdminUsersQuery(int Page = 1, int PageSize = 25, string? Search = null)
    : IRequest<Result<PagedResultDto<AdminUserRowDto>>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetAdminUsersQueryHandler
    : IRequestHandler<GetAdminUsersQuery, Result<PagedResultDto<AdminUserRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetAdminUsersQueryHandler(IApplicationDbContext db) => _db = db;

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

        var totalCount = await query.CountAsync(cancellationToken);

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
                u.Role.ToString(),
                u.IsActive,
                u.GoogleId != null,
                u.PasswordHash != null,
                u.CreatedAt,
                u.LastLoginAt,
                _db.Transcriptions.Count(t => t.UserId == u.Id)))
            .ToListAsync(cancellationToken);

        return new PagedResultDto<AdminUserRowDto>(items, page, pageSize, totalCount);
    }
}
