using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Activity;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Queries;

/// <summary>Polls the ML service for a job's status/result (GET /v1/jobs/{jobId}).</summary>
public sealed record GetTranscriptionJobQuery(string JobId) : IRequest<Result<TranscriptionJobDto>>;

/// <summary>
/// Also where a free account's trial is spent, and where a client poll banks the finished result.
/// Charging on observed success — the submit call always answers <c>Pending</c>, and the status comes
/// from the ML service rather than the client — means the count cannot be inflated by a failed job or
/// dodged by a client that simply stops asking.
/// </summary>
/// <remarks>
/// No longer the only place the API learns a transcription succeeded: <c>NotifyTranscriptionReady</c>
/// reaches the same conclusion from the background sweep, for the user who left the screen. Both
/// paths go through the same idempotent entity methods, so whichever arrives first wins and the second
/// is a no-op.
/// </remarks>
public sealed class GetTranscriptionJobQueryHandler : IRequestHandler<GetTranscriptionJobQuery, Result<TranscriptionJobDto>>
{
    /// <summary>What the client is told about a job the transcription service lost (with <see cref="TranscriptionJob.LostCode"/>).</summary>
    internal const string LostSentence =
        "The transcription service restarted while working on this, so the job was lost. Nothing was charged — please submit it again.";

    /// <summary>
    /// How long the worker keeps a finished job (its <c>NF_JOB_TTL_SECONDS</c>). A job settled longer ago than this, with
    /// its result banked, is answered from our copy without asking: the worker would only say it no longer has it.
    /// </summary>
    internal static readonly TimeSpan WorkerKeepsJobsFor = TimeSpan.FromMinutes(15);

    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IQuotaGate _gate;

    public GetTranscriptionJobQueryHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock,
        IQuotaGate gate)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _gate = gate;
    }

    public async Task<Result<TranscriptionJobDto>> Handle(
        GetTranscriptionJobQuery request, CancellationToken cancellationToken)
    {
        var job = await _db.TranscriptionJobs
            .FirstOrDefaultAsync(j => j.JobId == request.JobId, cancellationToken);

        // NotFound rather than Forbidden: confirming a stranger's job id exists is itself a leak. A job
        // with no row is not one of the caller's either — an anonymous preview, polled on its own route,
        // or an id made up — and the worker's answer for it would be someone else's result, uncharged.
        if (job is null || _currentUser.UserId is not { } caller || job.UserId != caller)
        {
            return TranscriptionErrors.JobNotFound;
        }

        if (job is { SettledAtUtc: { } settledAt, ResultJson: { } banked } && _clock.UtcNow - settledAt > WorkerKeepsJobsFor
            && Settled(request.JobId, banked, job.FailureCode) is { Result: not null } kept)
            return await FromRowAsync(job, kept, cancellationToken);

        var result = await _api.GetJobAsync(request.JobId, cancellationToken);
        if (result.IsFailure)
        {
            // The ML service keeps jobs in memory with a TTL, on a dyno that cycles daily, so a poll
            // arriving late — after a completion push, typically — gets nothing back. Our own copy is
            // the authority once it exists.
            if (job.SettledAtUtc is null)
            {
                // A job we recorded, never settled, and the worker has forgotten: the worker restarted
                // under it (the queue is in memory; an out-of-memory kill is the usual cause). The
                // client was polling a job that will never finish and used to be shown a bare
                // "service returned 404"; it is told plainly that the job is lost, nothing was
                // charged, and the thing to do is submit again — with the code that says so.
                if (result.Error.Type == ErrorType.NotFound)
                {
                    // Closed here, uncharged, so it stops holding a free place (TrialUsage counts open jobs)
                    // and the sweep has nothing left to say about it: the client is being told now.
                    job.Settle(null, _clock.UtcNow, TranscriptionJob.LostCode);
                    await ActivityRecorder.FailAsync(_db, request.JobId, "The transcription service restarted and lost the job.", _clock.UtcNow, cancellationToken);
                    await _db.SaveChangesAsync(cancellationToken);
                    return Lost(request.JobId);
                }
                return result;
            }
            var settled = Settled(request.JobId, job.ResultJson, job.FailureCode);
            if (settled.Result is null)
                return settled;
            return await FromRowAsync(job, settled, cancellationToken);
        }

        if (result.Value.Status == TranscriptionStatus.Failed)
        {
            // Closed here, as a finished job is below: it stops holding a free place at once, and the sweep
            // does not push a failure the client is looking at in this very response. The code (a job the
            // worker could not finish across its restarts) is kept for a later poll answered from this row.
            job.Settle(null, _clock.UtcNow, result.Value.ErrorCode);
            await ActivityRecorder.FailAsync(_db, request.JobId, result.Value.Error, _clock.UtcNow, cancellationToken);
            await _db.SaveChangesAsync(cancellationToken);
            return result;
        }

        if (result.Value.Status != TranscriptionStatus.Done)
        {
            return result;
        }

        var closedWithoutResult = job.SettledAtUtc is not null && job.ResultJson is null;

        // Bank the result and close the job. Two consequences: this poll's answer survives the ML
        // service forgetting the job, and the completion sweep will not push about a transcription the
        // client is being handed in this very response.
        if (result.Value.Result is { } finished)
        {
            job.Settle(TranscriptionResultCache.Serialize(finished), _clock.UtcNow);
            await ActivityRecorder.FinishAsync(_db, request.JobId, finished, _clock.UtcNow, cancellationToken);
        }

        // A job the sweep already closed as failed or lost (the worker finished after the deadline) stays
        // free, as the user was told it was. The late result is still handed over, and filed.
        if (closedWithoutResult)
        {
            return result.Value.Result is null
                ? result
                : await FiledAsync(job, result.Value.Result, await IsProAsync(job.UserId, cancellationToken)
                    ? result.Value
                    : result.Value with { Result = ProGate.ForFree(result.Value.Result) }, cancellationToken);
        }

        // Pro at the moment of success, so nothing to charge. Asked here rather than recorded at submit
        // time: a job row is written for Pro submissions too, and stamping the verdict on it up front
        // would mean a subscription that lapses months later finds its past Pro work already counted
        // against the five. The cost of asking late is that a job outliving the subscription that paid
        // for it does spend a trial — one credit, in the minutes a transcription takes, so not worth a
        // column to avoid.
        var isPro = await IsProAsync(job.UserId, cancellationToken);
        if (job.IsSong)
        {
            // A song is its own allowance (Pro monthly songs, or the one free preview) and never a trial
            // generation: the preview exists precisely so a free account can try the feature without it
            // costing one of their recordings.
            job.ConsumeSongCredit(_clock.UtcNow);
        }
        else if (!isPro)
        {
            job.ConsumeTrial(_clock.UtcNow);
        }

        // No-ops when neither method changed anything, which is the common case for a client that
        // polls a finished job more than once.
        await _db.SaveChangesAsync(cancellationToken);

        // Downloads are Pro: the MIDI is the one export the client cannot rebuild from the notes, so a
        // free account does not receive it. The notes, the staff and the solfa text are theirs to read.
        var shown = isPro || result.Value.Result is null
            ? result.Value
            : result.Value with { Result = ProGate.ForFree(result.Value.Result) };
        return result.Value.Result is null ? shown : await FiledAsync(job, result.Value.Result, shown, cancellationToken);
    }

    /// <summary>
    /// The finished job's envelope with the library sheet it is filed as: filed now, the moment it is first seen
    /// done, or the one filed (or saved) before (<see cref="LibraryFiling"/>).
    /// </summary>
    private async Task<TranscriptionJobDto> FiledAsync(
        TranscriptionJob job, TranscriptionResultDto finished, TranscriptionJobDto shown, CancellationToken ct)
        => LibraryFiling.WithSheet(shown, await LibraryFiling.FileAsync(_db, _gate, _clock, job, finished, ct));

    /// <summary>A settled job's answer from our own copy, as its owner may see it, with the sheet it is filed as.</summary>
    private async Task<TranscriptionJobDto> FromRowAsync(TranscriptionJob job, TranscriptionJobDto settled, CancellationToken ct)
        => await FiledAsync(job, settled.Result!, await IsProAsync(job.UserId, ct)
            ? settled
            : settled with { Result = ProGate.ForFree(settled.Result!) }, ct);

    private static TranscriptionJobDto Lost(string jobId)
        => new(jobId, TranscriptionStatus.Failed, 0, null, LostSentence, ErrorCode: TranscriptionJob.LostCode);

    /// <summary>
    /// Answers from our own row. A settled job with no cached result did not finish: one closed as lost (the
    /// worker restarted under it, or never answered by the deadline) still says so, with its code, for as long
    /// as anyone asks; any other says the recording could not be transcribed. Either beats passing on the ML
    /// service's 404 — the client has a message for <c>Failed</c> and only a generic retry for a transport error.
    /// </summary>
    private static TranscriptionJobDto Settled(string jobId, string? resultJson, string? failureCode)
    {
        var cached = resultJson is null ? null : TranscriptionResultCache.Deserialize(resultJson);

        if (cached is not null)
            return new TranscriptionJobDto(jobId, TranscriptionStatus.Done, 1, cached);
        return failureCode == TranscriptionJob.LostCode
            ? Lost(jobId) with { Progress = 1 }
            : new TranscriptionJobDto(jobId, TranscriptionStatus.Failed, 1, null,
                "That recording could not be transcribed. Try again with a clearer take.");
    }

    private Task<bool> IsProAsync(Guid userId, CancellationToken ct) => ProStatus.IsProAsync(_db, _clock, userId, ct);
}
