using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Preview.Commands;
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
        {
            // The worker does not know a preview that never ended: it restarted under it. Recorded as failed,
            // so it stops counting as running, and the browser is told plainly instead of polling a 404.
            if (result.Error.Type == ErrorType.NotFound && preview.CompletedAtUtc is null)
            {
                await PreviewOutcome.RecordAsync(_db, preview, null, PreviewOutcome.LostReason, _clock.UtcNow, cancellationToken);
                return new TranscriptionJobDto(request.JobId, TranscriptionStatus.Failed, 0, null,
                    "The transcription service restarted while working on this, so the preview was lost. Create a free account to try it again.",
                    ErrorCode: Core.Entities.TranscriptionJob.LostCode);
            }
            return result;
        }

        var job = result.Value;
        if (job.Status is TranscriptionStatus.Done or TranscriptionStatus.Failed)
            await PreviewOutcome.RecordAsync(_db, preview, job, job.Error, _clock.UtcNow, cancellationToken);
        return job.Result is null ? job : job with { Result = ProGate.ForFree(job.Result) };
    }
}
