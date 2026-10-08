using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Activity.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Activity.Queries;

/// <summary>
/// The activity log: every transcription asked for, newest first, saved or not, with what was sent and
/// how it ended. Every filter is optional; <paramref name="Saved"/> filters on whether the result reached
/// someone's library.
/// </summary>
public sealed record GetTranscriptionLogQuery(
    int Page = 1,
    int PageSize = 25,
    string? Search = null,
    string? Origin = null,
    string? Kind = null,
    string? Status = null,
    string? Client = null,
    bool? Saved = null,
    Guid? UserId = null,
    string? Device = null,
    DateTime? From = null,
    DateTime? To = null) : IRequest<Result<TranscriptionLogPageDto>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetTranscriptionLogQueryHandler
    : IRequestHandler<GetTranscriptionLogQuery, Result<TranscriptionLogPageDto>>
{
    private readonly IApplicationDbContext _db;

    public GetTranscriptionLogQueryHandler(IApplicationDbContext db) => _db = db;

    public async Task<Result<TranscriptionLogPageDto>> Handle(GetTranscriptionLogQuery request, CancellationToken ct)
    {
        // Clamped, not validated, like the users table: a pager overshooting the last page is normal.
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, GetTranscriptionLogQuery.MaxPageSize);

        var query = _db.TranscriptionLogs.AsNoTracking();

        if (request.UserId is { } userId)
        {
            // An account's own submissions, and the anonymous previews it claimed when it signed up.
            query = query.Where(l => l.UserId == userId
                || (l.JobId != null && _db.PreviewJobs.Any(p => p.JobId == l.JobId && p.ClaimedByUserId == userId)));
        }
        if (!string.IsNullOrWhiteSpace(request.Device))
            query = query.Where(l => l.DeviceHash == request.Device);
        if (!string.IsNullOrWhiteSpace(request.Origin))
            query = query.Where(l => l.Origin == request.Origin);
        if (!string.IsNullOrWhiteSpace(request.Kind))
            query = query.Where(l => l.Kind == request.Kind);
        if (!string.IsNullOrWhiteSpace(request.Status))
            query = query.Where(l => l.Status == request.Status);
        if (!string.IsNullOrWhiteSpace(request.Client))
            query = query.Where(l => l.Client == request.Client);
        if (request.From is { } from)
            query = query.Where(l => l.CreatedAtUtc >= from);
        if (request.To is { } to)
            query = query.Where(l => l.CreatedAtUtc < to);
        if (request.Saved is { } saved)
            query = query.Where(l => (l.JobId != null && _db.Transcriptions.Any(t => t.SourceJobId == l.JobId)) == saved);

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            // Lowered on both sides so the match is case-insensitive on Postgres and on the tests' SQLite.
            var term = request.Search.Trim().ToLowerInvariant();
            query = query.Where(l =>
                (l.FileName != null && l.FileName.ToLower().Contains(term))
                || (l.LinkUrl != null && l.LinkUrl.ToLower().Contains(term))
                || (l.SongTitle != null && l.SongTitle.ToLower().Contains(term))
                || (l.SongArtist != null && l.SongArtist.ToLower().Contains(term))
                || (l.FailureReason != null && l.FailureReason.ToLower().Contains(term))
                || (l.JobId != null && l.JobId.ToLower().Contains(term))
                || _db.Users.Any(u => u.Id == l.UserId
                    && (u.Email.ToLower().Contains(term) || u.FullName.ToLower().Contains(term))));
        }

        var summary = new TranscriptionLogSummaryDto(
            Total: await query.CountAsync(ct),
            Done: await query.CountAsync(l => l.Status == TranscriptionLog.Done, ct),
            Failed: await query.CountAsync(l => l.Status == TranscriptionLog.Failed, ct),
            Refused: await query.CountAsync(l => l.Status == TranscriptionLog.Refused, ct),
            Running: await query.CountAsync(l => l.Status == TranscriptionLog.Submitted, ct),
            Saved: await query.CountAsync(l => l.JobId != null && _db.Transcriptions.Any(t => t.SourceJobId == l.JobId), ct),
            StorePreviews: await query.CountAsync(l => l.UsedStorePreview, ct),
            TotalBytes: await query.SumAsync(l => (long?)l.SizeBytes, ct) ?? 0L);

        var rows = await query
            .OrderByDescending(l => l.CreatedAtUtc)
            .ThenBy(l => l.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(l => new
            {
                Log = l,
                Saved = l.JobId != null && _db.Transcriptions.Any(t => t.SourceJobId == l.JobId),
                ClaimedBy = l.JobId == null
                    ? null
                    : _db.PreviewJobs.Where(p => p.JobId == l.JobId).Select(p => p.ClaimedByUserId).FirstOrDefault()
            })
            .ToListAsync(ct);

        // Names for the page's accounts in one query rather than a join per row.
        var ownerIds = rows.Select(r => r.Log.UserId ?? r.ClaimedBy).OfType<Guid>().Distinct().ToList();
        var owners = await _db.Users.AsNoTracking()
            .Where(u => ownerIds.Contains(u.Id))
            .Select(u => new { u.Id, u.FullName, u.Email })
            .ToDictionaryAsync(u => u.Id, ct);

        var items = rows.Select(r =>
        {
            var l = r.Log;
            var ownerId = l.UserId ?? r.ClaimedBy;
            var owner = ownerId is { } id ? owners.GetValueOrDefault(id) : null;
            return new TranscriptionLogRowDto(
                l.Id, l.JobId, l.CreatedAtUtc, l.Origin, l.Client, l.Kind, l.Mode,
                l.FileName, l.ContentType, l.SizeBytes, l.LinkUrl, l.SongTitle, l.SongArtist,
                l.KeyRequested, l.TempoRequested, l.TimeSignatureRequested, l.StartSeconds, l.EndSeconds,
                l.Status, l.FailureReason, l.FinishedAtUtc, l.AudioSeconds,
                l.DetectedKey, l.DetectedTempo, l.NoteCount, l.Confidence, l.UsedStorePreview,
                r.Saved, ownerId, owner?.FullName, owner?.Email, l.DeviceHash);
        }).ToList();

        return new TranscriptionLogPageDto(
            new PagedResultDto<TranscriptionLogRowDto>(items, page, pageSize, summary.Total), summary);
    }
}
