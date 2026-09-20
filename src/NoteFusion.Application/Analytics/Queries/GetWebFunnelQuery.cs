using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Analytics.Queries;

public sealed record GetWebFunnelQuery(DateTime? FromUtc, DateTime? ToUtc)
    : MediatR.IRequest<Result<WebFunnelDto>>;

public sealed class GetWebFunnelQueryHandler : MediatR.IRequestHandler<GetWebFunnelQuery, Result<WebFunnelDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetWebFunnelQueryHandler(IApplicationDbContext db, IDateTimeProvider clock)
    {
        _db = db;
        _clock = clock;
    }

    public async Task<Result<WebFunnelDto>> Handle(GetWebFunnelQuery request, CancellationToken cancellationToken)
    {
        var to = request.ToUtc?.ToUniversalTime() ?? _clock.UtcNow;
        var from = request.FromUtc?.ToUniversalTime() ?? to.AddDays(-30);
        if (from >= to || to - from > TimeSpan.FromDays(366))
            return Error.Validation("ANALYTICS_INVALID_WINDOW", "The analytics window must be positive and no longer than 366 days.");

        var jobs = await _db.WebPreviewJobs
            .Where(j => j.CreatedAtUtc >= from && j.CreatedAtUtc < to)
            .Select(j => new { j.SettledAtUtc, j.ResultJson, j.ExpiresAtUtc, j.ClaimedByUserId })
            .ToListAsync(cancellationToken);
        var events = await _db.ProductEvents
            .Where(e => e.OccurredAtUtc >= from && e.OccurredAtUtc < to)
            .GroupBy(e => e.Name)
            .Select(g => new WebFunnelMetricDto(g.Key, g.Count()))
            .OrderByDescending(x => x.Count)
            .ToListAsync(cancellationToken);

        // The conversion the funnel exists to measure: browsers that were anonymous when they arrived and
        // had an account by the time they left. Counted over the visitor, not the event, because one
        // person signing up emits several authenticated rows and would otherwise read as several people.
        var convertedVisitors = await _db.ProductEvents
            .Where(e => e.OccurredAtUtc >= from && e.OccurredAtUtc < to)
            .Where(e => e.UserId != null && e.AnonymousId != null)
            .Select(e => e.AnonymousId)
            .Distinct()
            .CountAsync(cancellationToken);

        return new WebFunnelDto(
            from,
            to,
            jobs.Count,
            jobs.Count(j => j.ResultJson is not null),
            jobs.Count(j => j.SettledAtUtc is not null && j.ResultJson is null),
            jobs.Count(j => j.SettledAtUtc is null && j.ExpiresAtUtc <= _clock.UtcNow),
            events,
            jobs.Count(j => j.ClaimedByUserId is not null),
            convertedVisitors);
    }
}
