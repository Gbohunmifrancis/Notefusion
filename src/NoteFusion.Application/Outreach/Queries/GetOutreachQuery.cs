using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Outreach.Queries;

/// <summary>One outreach send, for the admin console.</summary>
public sealed record OutreachMessageDto(
    Guid Id,
    Guid UserId,
    string? FullName,
    string? Email,
    OutreachSegment Segment,
    OutreachChannel Channel,
    OutreachStatus Status,
    int Attempts,
    string? Error,
    DateTime CreatedAtUtc,
    DateTime? SentAtUtc);

/// <summary>How many accounts each segment has reached, and on which channel.</summary>
public sealed record OutreachSegmentSummaryDto(
    OutreachSegment Segment,
    int Users,
    int EmailsSent,
    int PushesSent,
    int Failed,
    int Pending);

/// <param name="Enabled">Whether the sweep is sending.</param>
/// <param name="DisabledReason">Why not, when it is not.</param>
/// <param name="Unsubscribed">Accounts that used the unsubscribe link.</param>
public sealed record OutreachOverviewDto(
    bool Enabled,
    string? DisabledReason,
    int Unsubscribed,
    IReadOnlyList<OutreachSegmentSummaryDto> Segments,
    IReadOnlyList<OutreachMessageDto> Recent);

/// <summary>The outreach audit trail: a count per segment, and the newest sends (at most 200).</summary>
public sealed record GetOutreachQuery(int Take = 100) : IRequest<Result<OutreachOverviewDto>>;

public sealed class GetOutreachQueryHandler : IRequestHandler<GetOutreachQuery, Result<OutreachOverviewDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly OutreachSettings _settings;

    public GetOutreachQueryHandler(IApplicationDbContext db, OutreachSettings settings)
    {
        _db = db;
        _settings = settings;
    }

    public async Task<Result<OutreachOverviewDto>> Handle(GetOutreachQuery request, CancellationToken ct)
    {
        var take = Math.Clamp(request.Take, 1, 200);

        // One short row per send ever made: a few per account at most, so folded in memory.
        var all = await _db.OutreachMessages.AsNoTracking()
            .Select(m => new { m.UserId, m.Segment, m.Channel, m.Status })
            .ToListAsync(ct);

        var segments = Enum.GetValues<OutreachSegment>()
            .Select(s =>
            {
                var rows = all.Where(m => m.Segment == s).ToList();
                return new OutreachSegmentSummaryDto(
                    s,
                    rows.Select(m => m.UserId).Distinct().Count(),
                    rows.Count(m => m.Channel == OutreachChannel.Email && m.Status == OutreachStatus.Sent),
                    rows.Count(m => m.Channel == OutreachChannel.Push && m.Status == OutreachStatus.Sent),
                    rows.Count(m => m.Status == OutreachStatus.Failed),
                    rows.Count(m => m.Status == OutreachStatus.Pending));
            })
            .ToList();

        var latest = await _db.OutreachMessages.AsNoTracking()
            .OrderByDescending(m => m.CreatedAtUtc)
            .Take(take)
            .ToListAsync(ct);
        var ids = latest.Select(m => m.UserId).Distinct().ToList();
        var people = await _db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email })
            .ToDictionaryAsync(u => u.Id, ct);

        var recent = latest
            .Select(m => new OutreachMessageDto(
                m.Id, m.UserId,
                people.TryGetValue(m.UserId, out var p) ? p.FullName : null,
                people.TryGetValue(m.UserId, out var q) ? q.Email : null,
                m.Segment, m.Channel, m.Status, m.Attempts, m.Error,
                DateTime.SpecifyKind(m.CreatedAtUtc, DateTimeKind.Utc),
                m.SentAtUtc is { } sent ? DateTime.SpecifyKind(sent, DateTimeKind.Utc) : null))
            .ToList();

        var unsubscribed = await _db.EmailOptOuts.CountAsync(ct);

        return new OutreachOverviewDto(_settings.IsActive, _settings.DisabledReason, unsubscribed, segments, recent);
    }
}
