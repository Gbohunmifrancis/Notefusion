using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Activity;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Commands;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Preview.Commands;

/// <summary>
/// Carries one open website preview to its end without the browser: asks the worker where it got to and,
/// when the answer is terminal, the job is lost, or it is past the deadline, records the outcome.
/// </summary>
/// <remarks>
/// Until this existed only the visitor's own poll ever completed a preview, so every visitor who closed the
/// tab while it ran (a linked song takes minutes) left a preview "still running" for good — and the worker's
/// completion webhook for it was answered 404, because the webhook only looked for account jobs. Run by the
/// webhook and by the completion sweep, as <see cref="NotifyTranscriptionReadyCommand"/> is for account jobs,
/// with the same deadline. A preview has no owner to tell, so this only records.
/// </remarks>
public sealed record SettlePreviewJobCommand(Guid PreviewRowId) : IRequest<Result>;

public sealed class SettlePreviewJobCommandHandler : IRequestHandler<SettlePreviewJobCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ITranscriptionApi _api;
    private readonly IDateTimeProvider _clock;

    public SettlePreviewJobCommandHandler(IApplicationDbContext db, ITranscriptionApi api, IDateTimeProvider clock)
    {
        _db = db;
        _api = api;
        _clock = clock;
    }

    public async Task<Result> Handle(SettlePreviewJobCommand request, CancellationToken ct)
    {
        var preview = await _db.PreviewJobs.FirstOrDefaultAsync(p => p.Id == request.PreviewRowId, ct);
        if (preview is null)
            return TranscriptionErrors.JobNotFound;
        if (preview.CompletedAtUtc is not null)
            return Result.Success();

        var now = _clock.UtcNow;
        var expired = now - preview.CreatedAtUtc > NotifyTranscriptionReadyCommand.GiveUpAfter;

        Result<TranscriptionJobDto> poll;
        try
        {
            poll = await _api.GetJobAsync(preview.JobId, ct);
        }
        catch (Exception) when (expired && !ct.IsCancellationRequested)
        {
            await PreviewOutcome.RecordAsync(_db, preview, null, PreviewOutcome.ExpiredReason, now, ct);
            return Result.Success();
        }

        if (poll.IsFailure)
        {
            if (poll.Error.Type == ErrorType.NotFound)
                await PreviewOutcome.RecordAsync(_db, preview, null, PreviewOutcome.LostReason, now, ct);
            else if (expired)
                await PreviewOutcome.RecordAsync(_db, preview, null, PreviewOutcome.ExpiredReason, now, ct);
            return Result.Success();
        }

        var job = poll.Value;
        if (job.Status is TranscriptionStatus.Done or TranscriptionStatus.Failed)
            await PreviewOutcome.RecordAsync(_db, preview, job, job.Error, now, ct);
        else if (expired)
            await PreviewOutcome.RecordAsync(_db, preview, null, PreviewOutcome.ExpiredReason, now, ct);

        return Result.Success();
    }
}

/// <summary>Records how a preview ended, once: the browser's poll and the background follow-up share it.</summary>
public static class PreviewOutcome
{
    /// <summary>The worker no longer knows the job: it restarted under it.</summary>
    public const string LostReason = "The transcription service restarted and lost the preview.";

    /// <summary>No result by the deadline.</summary>
    public const string ExpiredReason = "No result after 30 minutes; the preview was given up on.";

    /// <summary>
    /// Completes <paramref name="preview"/> from the worker's terminal answer, or as failed when
    /// <paramref name="job"/> is null, logs it, and commits. A no-op on a preview already completed.
    /// </summary>
    public static async Task<bool> RecordAsync(
        IApplicationDbContext db, PreviewJob preview, TranscriptionJobDto? job, string? reason, DateTime now, CancellationToken ct)
    {
        var succeeded = job is { Status: TranscriptionStatus.Done, Result: not null };
        if (!preview.Complete(succeeded, job?.Result?.Source?.Title ?? job?.Source?.Title, now))
            return false;

        if (succeeded)
            await ActivityRecorder.FinishAsync(db, preview.JobId, job!.Result!, now, ct);
        else
            await ActivityRecorder.FailAsync(db, preview.JobId, reason, now, ct);
        await db.SaveChangesAsync(ct);
        return true;
    }
}
