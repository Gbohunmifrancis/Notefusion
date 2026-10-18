using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common;
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
/// <param name="IsOnline">
/// Keep only accounts seen within <see cref="LastSeen.OnlineWindow"/> when <c>true</c>. Null returns all.
/// Kept for older console builds; <paramref name="LastSeenWithin"/> "online" is the same filter.
/// </param>
/// <param name="LastSeenWithin">
/// "online" (5 minutes), "today" (24 hours), "week", "month", or "inactive" (not seen for 30 days, or
/// never). Null or anything else returns all. "Seen" is the last signed-in request, falling back to the
/// last sign-in for accounts not seen since presence was recorded.
/// </param>
/// <param name="Sort">"lastSeen" lists the most recently seen first; anything else is newest account first.</param>
/// <param name="IncludeInternal">
/// The list is customers only by default: admins and internal accounts are the team (AnalyticsScope).
/// True lists everyone, for finding a team account to manage.
/// </param>
/// <param name="Plan">"pro": accounts whose own membership unlocks Pro now; "free": the rest. Anything else lists both.</param>
public sealed record GetAdminUsersQuery(
    int Page = 1,
    int PageSize = 25,
    string? Search = null,
    bool? IsActive = null,
    bool? IsOnline = null,
    string? LastSeenWithin = null,
    string? Sort = null,
    bool IncludeInternal = false,
    string? Plan = null)
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

        var query = (request.IncludeInternal ? _db.Users : _db.RealUsers()).AsNoTracking();

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

        var now = _clock.UtcNow;

        var onlineSince = now - LastSeen.OnlineWindow;
        var within = request.IsOnline == true ? LastSeen.Online : request.LastSeenWithin?.Trim().ToLowerInvariant();
        DateTime? seenSince = within switch
        {
            LastSeen.Online => onlineSince,
            LastSeen.Today => now.AddDays(-1),
            LastSeen.Week => now.AddDays(-7),
            LastSeen.Month => now.AddDays(-30),
            _ => null
        };
        if (seenSince is { } since)
        {
            query = query.Where(u => (u.LastSeenAtUtc ?? u.LastLoginAt) >= since);
        }
        else if (within == LastSeen.Inactive)
        {
            var monthAgo = now.AddDays(-30);
            query = query.Where(u => (u.LastSeenAtUtc ?? u.LastLoginAt) == null || (u.LastSeenAtUtc ?? u.LastLoginAt) < monthAgo);
        }

        // Subscriptions that unlock Pro at this instant. Composed into the projection below rather than
        // repeated in it, and deliberately the same predicate GetSystemHealthQuery counts with — the
        // users table and the health page must not disagree about who is a subscriber.
        var live = _db.Subscriptions.Where(s =>
            (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.Canceled)
            && s.CurrentPeriodEndUtc > now);

        // The phone admin's Pro / Free chips: the same rule as the row's HasProAccess, applied before paging.
        switch (request.Plan?.Trim().ToLowerInvariant())
        {
            case "pro":
                query = query.Where(u => live.Any(s => s.UserId == u.Id));
                break;
            case "free":
                query = query.Where(u => !live.Any(s => s.UserId == u.Id));
                break;
        }

        var totalCount = await query.CountAsync(cancellationToken);

        // The per-row transcription count is a correlated subquery in one round trip rather than a
        // count per row, which would be an N+1 across the whole page.
        var ordered = request.Sort == "lastSeen"
            ? query.OrderByDescending(u => (u.LastSeenAtUtc ?? u.LastLoginAt) ?? u.CreatedAt)
            : query.OrderByDescending(u => u.CreatedAt);
        var items = await ordered
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
                u.LastLoginAt ?? u.CreatedAt,
                0, // filled from TranscriptionCounts below: saved sheets alone undercount
                live.Any(s => s.UserId == u.Id),
                live.Any(s => s.UserId == u.Id && s.Provider == null),
                0,
                0,
                u.LastSeenAtUtc ?? u.LastLoginAt,
                (u.LastSeenAtUtc ?? u.LastLoginAt) >= onlineSince,
                u.Role == UserRole.Admin || u.IsInternal,
                u.Country,
                _db.Choirs.Any(c => c.CurrentPeriodEndUtc > now
                    && (c.OwnerId == u.Id || _db.ChoirMembers.Any(m => m.ChoirId == c.Id && m.UserId == u.Id)))))
            .ToListAsync(cancellationToken);

        var counts = await TranscriptionCounts.ForUsersAsync(_db, items.Select(i => i.Id).ToList(), cancellationToken);
        items = items.Select(i => counts.TryGetValue(i.Id, out var c)
                ? i with { TranscriptionCount = c.Transcribed, SavedTranscriptionCount = c.Saved, FailedTranscriptionCount = c.Failed }
                : i)
            .ToList();

        return new PagedResultDto<AdminUserRowDto>(items, page, pageSize, totalCount);
    }
}
