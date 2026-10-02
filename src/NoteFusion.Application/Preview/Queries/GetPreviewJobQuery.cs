using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Preview.Queries;

/// <summary>
/// Polls an anonymous preview. Only a job id this API minted as a preview answers here — a
/// stranger's real job id gets NotFound — and the result is handed over as a free account would
/// see it: notes, solfa and staff, no MIDI, no parts.
/// </summary>
public sealed record GetPreviewJobQuery(string JobId) : IRequest<Result<TranscriptionJobDto>>;

public sealed class GetPreviewJobQueryHandler : IRequestHandler<GetPreviewJobQuery, Result<TranscriptionJobDto>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly IDateTimeProvider _clock;

    public GetPreviewJobQueryHandler(ITranscriptionApi api, IApplicationDbContext db, IDateTimeProvider clock)
    {
        _api = api;
        _db = db;
        _clock = clock;
    }

    public async Task<Result<TranscriptionJobDto>> Handle(GetPreviewJobQuery request, CancellationToken cancellationToken)
    {
        var preview = await _db.PreviewJobs.FirstOrDefaultAsync(p => p.JobId == request.JobId, cancellationToken);
        if (preview is null)
            return TranscriptionErrors.JobNotFound;

        var result = await _api.GetJobAsync(request.JobId, cancellationToken);
        if (result.IsFailure)
            return result;

        var job = result.Value;
        if (job.Status is TranscriptionStatus.Done or TranscriptionStatus.Failed)
        {
            if (preview.Complete(job.Status == TranscriptionStatus.Done, job.Result?.Source?.Title ?? job.Source?.Title, _clock.UtcNow))
                await _db.SaveChangesAsync(cancellationToken);
        }
        return job.Result is null ? job : job with { Result = ProGate.ForFree(job.Result) };
    }
}
