using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.WebPreview;

public sealed record GetWebPreviewJobQuery(string JobId, string PreviewToken)
    : MediatR.IRequest<Result<WebPreviewJobDto>>;

public sealed class GetWebPreviewJobQueryHandler : MediatR.IRequestHandler<GetWebPreviewJobQuery, Result<WebPreviewJobDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ITranscriptionApi _api;
    private readonly IDateTimeProvider _clock;

    public GetWebPreviewJobQueryHandler(
        IApplicationDbContext db,
        ITranscriptionApi api,
        IDateTimeProvider clock)
    {
        _db = db;
        _api = api;
        _clock = clock;
    }

    public async Task<Result<WebPreviewJobDto>> Handle(
        GetWebPreviewJobQuery request,
        CancellationToken cancellationToken)
    {
        var job = await _db.WebPreviewJobs
            .FirstOrDefaultAsync(j => j.JobId == request.JobId, cancellationToken);
        if (job is null || job.PreviewTokenHash != WebPreviewToken.Hash(request.PreviewToken))
            return WebPreviewErrors.InvalidToken;

        var now = _clock.UtcNow;
        if (job.IsExpired(now))
            return WebPreviewErrors.Expired;

        var remote = await _api.GetJobAsync(request.JobId, cancellationToken);
        if (remote.IsFailure)
        {
            if (job.SettledAtUtc is null)
                return remote.Error;

            return Cached(job);
        }

        var current = remote.Value;
        if (current.Status == TranscriptionStatus.Done && current.Result is not null)
        {
            job.Settle(now, TranscriptionResultCache.Serialize(current.Result), null);
            await _db.SaveChangesAsync(cancellationToken);
            return ToDto(job, TranscriptionStatus.Done, current.Progress,
                WebPreviewResultProjection.From(current.Result), null);
        }

        if (current.Status == TranscriptionStatus.Failed)
        {
            job.Settle(now, null, current.Error);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return ToDto(job, current.Status, current.Progress, null, current.Error);
    }

    private static Result<WebPreviewJobDto> Cached(Core.Entities.WebPreviewJob job)
    {
        var cached = job.ResultJson is null
            ? null
            : TranscriptionResultCache.Deserialize(job.ResultJson);
        return cached is not null
            ? ToDto(job, TranscriptionStatus.Done, 1, WebPreviewResultProjection.From(cached), null)
            : ToDto(job, TranscriptionStatus.Failed, 1, null,
                job.Error ?? "That recording could not be previewed. Try again with a clearer take.");
    }

    private static WebPreviewJobDto ToDto(
        Core.Entities.WebPreviewJob job,
        TranscriptionStatus status,
        double progress,
        WebPreviewResultDto? result,
        string? error)
        => new(job.JobId, null, status, progress, job.ExpiresAtUtc, result, error);
}
