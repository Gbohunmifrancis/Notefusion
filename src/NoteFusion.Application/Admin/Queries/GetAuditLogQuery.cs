using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// A page of the admin audit trail, newest first.
/// </summary>
/// <param name="Page">1-based. Values below 1 are clamped rather than rejected.</param>
/// <param name="PageSize">Clamped to <see cref="MaxPageSize"/> so one request cannot pull the whole trail.</param>
/// <param name="Action">Keep only this action. Null returns every action.</param>
/// <param name="TargetUserId">Keep only entries about this account — the per-user history on a detail page.</param>
/// <param name="Search">Case-insensitive substring of either email or the summary. Null or blank disables it.</param>
public sealed record GetAuditLogQuery(
    int Page = 1,
    int PageSize = 25,
    AdminAuditAction? Action = null,
    Guid? TargetUserId = null,
    string? Search = null) : IRequest<Result<PagedResultDto<AuditLogRowDto>>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetAuditLogQueryHandler
    : IRequestHandler<GetAuditLogQuery, Result<PagedResultDto<AuditLogRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetAuditLogQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PagedResultDto<AuditLogRowDto>>> Handle(
        GetAuditLogQuery request, CancellationToken cancellationToken)
    {
        // Clamped rather than validated, for the same reason as the user table: a paging control that
        // overshoots the last page is normal, and failing the request turns it into an error state.
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, GetAuditLogQuery.MaxPageSize);

        var query = _db.AdminAuditLogs.AsNoTracking();

        if (request.Action is { } action)
        {
            query = query.Where(a => a.Action == action);
        }

        if (request.TargetUserId is { } targetUserId)
        {
            query = query.Where(a => a.TargetUserId == targetUserId);
        }

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // Lowered on both sides so the match behaves the same on Postgres and on the SQLite the
            // tests use, without depending on either one's collation.
            var term = request.Search.Trim().ToLowerInvariant();
            query = query.Where(a =>
                a.ActorEmail.ToLower().Contains(term)
                || (a.TargetEmail != null && a.TargetEmail.ToLower().Contains(term))
                || a.Summary.ToLower().Contains(term));
        }

        var totalCount = await query.CountAsync(cancellationToken);

        var items = await query
            .OrderByDescending(a => a.OccurredAtUtc)
            // Two actions inside the same tick would otherwise page nondeterministically.
            .ThenBy(a => a.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new AuditLogRowDto(
                a.Id,
                a.ActorUserId,
                a.ActorEmail,
                a.Action.ToString(),
                a.TargetUserId,
                a.TargetEmail,
                a.IpAddress,
                a.Summary,
                a.Note,
                a.OccurredAtUtc))
            .ToListAsync(cancellationToken);

        return new PagedResultDto<AuditLogRowDto>(items, page, pageSize, totalCount);
    }
}
