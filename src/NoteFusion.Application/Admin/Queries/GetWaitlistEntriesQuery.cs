using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

public sealed record AdminWaitlistEntryDto(
    Guid Id,
    string Email,
    string? FullName,
    string? Role,
    string? Source,
    DateTime CreatedAtUtc,
    bool IsInvited,
    DateTime? InvitedAtUtc);

public sealed record GetWaitlistEntriesQuery(
    int Page = 1,
    int PageSize = 25,
    string? Search = null) : IRequest<Result<PagedResultDto<AdminWaitlistEntryDto>>>;

public sealed class GetWaitlistEntriesQueryHandler
    : IRequestHandler<GetWaitlistEntriesQuery, Result<PagedResultDto<AdminWaitlistEntryDto>>>
{
    private const int MaxPageSize = 100;
    private readonly IApplicationDbContext _db;

    public GetWaitlistEntriesQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<PagedResultDto<AdminWaitlistEntryDto>>> Handle(
        GetWaitlistEntriesQuery request, CancellationToken ct)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, MaxPageSize);

        var query = _db.WaitlistEntries.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var term = request.Search.Trim().ToLower();
            query = query.Where(w =>
                w.Email.ToLower().Contains(term) ||
                (w.FullName != null && w.FullName.ToLower().Contains(term)) ||
                (w.Role != null && w.Role.ToLower().Contains(term)));
        }

        var totalCount = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(w => w.CreatedAtUtc)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(w => new AdminWaitlistEntryDto(
                w.Id,
                w.Email,
                w.FullName,
                w.Role,
                w.Source,
                w.CreatedAtUtc,
                w.IsInvited,
                w.InvitedAtUtc))
            .ToListAsync(ct);

        return new PagedResultDto<AdminWaitlistEntryDto>(items, page, pageSize, totalCount);
    }
}
