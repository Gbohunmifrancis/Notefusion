using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Admin.Dtos;
using NoteFusion.Application.Analytics.Dtos;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Admin.Queries;

/// <summary>
/// Paged list of saved transcriptions across all users for monitoring ML pipeline output and quality.
/// </summary>
public sealed record GetAdminTranscriptionsQuery(
    int Page = 1,
    int PageSize = 25,
    TranscriptionStatus? Status = null,
    string? Search = null) : IRequest<Result<PagedResultDto<AdminTranscriptionRowDto>>>
{
    public const int MaxPageSize = 100;
}

public sealed class GetAdminTranscriptionsQueryHandler
    : IRequestHandler<GetAdminTranscriptionsQuery, Result<PagedResultDto<AdminTranscriptionRowDto>>>
{
    private readonly IApplicationDbContext _db;

    public GetAdminTranscriptionsQueryHandler(IApplicationDbContext db)
    {
        _db = db;
    }

    public async Task<Result<PagedResultDto<AdminTranscriptionRowDto>>> Handle(
        GetAdminTranscriptionsQuery request, CancellationToken ct)
    {
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, GetAdminTranscriptionsQuery.MaxPageSize);

        var query = from t in _db.Transcriptions.AsNoTracking()
                    join u in _db.Users.AsNoTracking() on t.UserId equals u.Id
                    select new
                    {
                        Transcription = t,
                        UserEmail = u.Email
                    };

        if (request.Status.HasValue)
        {
            query = query.Where(x => x.Transcription.Status == request.Status.Value);
        }

        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var term = request.Search.Trim().ToLower();
            query = query.Where(x =>
                x.Transcription.Title.ToLower().Contains(term)
                || x.UserEmail.ToLower().Contains(term));
        }

        var total = await query.CountAsync(ct);

        var items = await query
            .OrderByDescending(x => x.Transcription.CreatedAtUtc)
            .ThenBy(x => x.Transcription.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(x => new AdminTranscriptionRowDto(
                x.Transcription.Id,
                x.Transcription.UserId,
                x.UserEmail,
                x.Transcription.Title,
                x.Transcription.Key.ToString(),
                x.Transcription.TempoBpm,
                x.Transcription.TimeSignature,
                x.Transcription.OverallConfidence,
                x.Transcription.Status.ToString(),
                x.Transcription.CreatedAtUtc))
            .ToListAsync(ct);

        return new PagedResultDto<AdminTranscriptionRowDto>(items, page, pageSize, total);
    }
}
