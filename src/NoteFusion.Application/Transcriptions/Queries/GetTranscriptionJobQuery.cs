using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
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
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public GetTranscriptionJobQueryHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<TranscriptionJobDto>> Handle(
        GetTranscriptionJobQuery request, CancellationToken cancellationToken)
    {
        var job = await _db.TranscriptionJobs
            .FirstOrDefaultAsync(j => j.JobId == request.JobId, cancellationToken);

        // NotFound rather than Forbidden: confirming a stranger's job id exists is itself a leak.
        // Until this row existed, any signed-in caller could poll any job id and read the result.
        if (job is not null && _currentUser.UserId is { } caller && job.UserId != caller)
        {
            return TranscriptionErrors.JobNotFound;
        }

        var result = await _api.GetJobAsync(request.JobId, cancellationToken);
        if (result.IsFailure)
        {
            // The ML service keeps jobs in memory with a TTL, on a dyno that cycles daily, so a poll
            // arriving late — after a completion push, typically — gets nothing back. Our own copy is
            // the authority once it exists.
            if (job?.SettledAtUtc is null)
            {
                // A job we recorded, never settled, and the worker has forgotten: the worker restarted
                // under it (the queue is in memory; an out-of-memory kill is the usual cause). The
                // client was polling a job that will never finish and used to be shown a bare
                // "service returned 404"; it is told plainly that the job is lost, nothing was
                // charged, and the thing to do is submit again.
                if (job is not null && result.Error.Type == ErrorType.NotFound)
                {
                    return new TranscriptionJobDto(
                        request.JobId, TranscriptionStatus.Failed, 0,
                        null,
                        "The transcription service restarted while working on this, so the job was lost. Nothing was charged — please submit it again.");
                }
                return result;
            }
            var settled = Settled(request.JobId, job.ResultJson);
            return settled.Result is null || await IsProAsync(job.UserId, cancellationToken)
                ? settled
                : settled with { Result = ProGate.ForFree(settled.Result) };
        }

        // A job with no row was submitted before this table existed, or anonymously. Let it through
        // uncharged — breaking an in-flight transcription across a deploy is the worse trade.
        if (job is null || result.Value.Status != TranscriptionStatus.Done)
        {
            return result;
        }

        // Bank the result and close the job. Two consequences: this poll's answer survives the ML
        // service forgetting the job, and the completion sweep will not push about a transcription the
        // client is being handed in this very response.
        if (result.Value.Result is { } finished)
        {
            job.Settle(TranscriptionResultCache.Serialize(finished), _clock.UtcNow);
        }

        // Pro at the moment of success, so nothing to charge. Asked here rather than recorded at submit
        // time: a job row is written for Pro submissions too, and stamping the verdict on it up front
        // would mean a subscription that lapses months later finds its past Pro work already counted
        // against the five. The cost of asking late is that a job outliving the subscription that paid
        // for it does spend a trial — one credit, in the minutes a transcription takes, so not worth a
        // column to avoid.
        var isPro = await IsProAsync(job.UserId, cancellationToken);
        if (job.Kind == Core.Enums.TranscriptionJobKind.Link)
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
        return isPro || result.Value.Result is null
            ? result
            : result.Value with { Result = ProGate.ForFree(result.Value.Result) };
    }

    /// <summary>
    /// Answers from our own row. A settled job with no cached result did not finish, and saying so
    /// beats passing on the ML service's 404 — the client has a message for <c>Failed</c> and only a
    /// generic retry for a transport error.
    /// </summary>
    private static TranscriptionJobDto Settled(string jobId, string? resultJson)
    {
        var cached = resultJson is null ? null : TranscriptionResultCache.Deserialize(resultJson);

        return cached is null
            ? new TranscriptionJobDto(jobId, TranscriptionStatus.Failed, 1, null,
                "That recording could not be transcribed. Try again with a clearer take.")
            : new TranscriptionJobDto(jobId, TranscriptionStatus.Done, 1, cached);
    }

    private Task<bool> IsProAsync(Guid userId, CancellationToken ct) => ProStatus.IsProAsync(_db, _clock, userId, ct);
}
