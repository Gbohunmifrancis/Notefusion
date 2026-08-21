using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Carries one open transcription job forward: asks the ML service where it got to, and when the answer
/// is terminal, banks the result, charges the trial if one is owed, and pushes the owner.
/// </summary>
/// <remarks>
/// <para>
/// This is what lets a recording finish while the app is closed. Until it existed, the only thing that
/// ever noticed a job complete was the client polling it, so navigating away from the record screen
/// abandoned the transcription silently — the poll is torn down on unmount.
/// </para>
/// <para>
/// Idempotent through <c>TranscriptionJob.Settle</c>: a job closed by a client poll returns success
/// here without sending anything, which is what stops every foreground transcription also arriving as
/// a notification seconds later.
/// </para>
/// </remarks>
public sealed record NotifyTranscriptionReadyCommand(Guid JobRowId) : IRequest<Result>
{
    /// <summary>
    /// How long a job may stay open before we stop waiting. Comfortably past both the ML service's own
    /// job TTL and the longest recording it will accept, so reaching this means the job is genuinely
    /// lost — a dyno cycled mid-transcription, most likely — rather than merely slow.
    /// </summary>
    public static readonly TimeSpan GiveUpAfter = TimeSpan.FromMinutes(30);
}

public sealed class NotifyTranscriptionReadyCommandHandler
    : IRequestHandler<NotifyTranscriptionReadyCommand, Result>
{
    private readonly IApplicationDbContext _db;
    private readonly ITranscriptionApi _api;
    private readonly IDateTimeProvider _clock;
    private readonly IPushSender _push;

    public NotifyTranscriptionReadyCommandHandler(
        IApplicationDbContext db, ITranscriptionApi api, IDateTimeProvider clock, IPushSender push)
    {
        _db = db;
        _api = api;
        _clock = clock;
        _push = push;
    }

    public async Task<Result> Handle(NotifyTranscriptionReadyCommand request, CancellationToken ct)
    {
        var job = await _db.TranscriptionJobs.FirstOrDefaultAsync(j => j.Id == request.JobRowId, ct);
        if (job is null)
            return TranscriptionErrors.JobNotFound;

        // A client poll got there first. Nothing to say: they are looking at the result.
        if (job.SettledAtUtc is not null)
            return Result.Success();

        var now = _clock.UtcNow;
        var expired = now - job.CreatedAtUtc > NotifyTranscriptionReadyCommand.GiveUpAfter;

        var poll = await _api.GetJobAsync(job.JobId, ct);

        // Deliberately not reading anything into *which* failure this is. The API client cannot tell a
        // 404 from a 502 — both come back as ErrorType.Failure with a status code in the message — so
        // inferring "the job is gone" from an error string would break the day that string changes.
        // Either the job is young enough to try again next tick, or it is old enough to be lost.
        if (poll.IsFailure)
            return expired ? await CloseAsFailedAsync(job, null, now, ct) : Result.Success();

        return poll.Value.Status switch
        {
            TranscriptionStatus.Done when poll.Value.Result is { } result
                => await CloseAsDoneAsync(job, result, now, ct),

            TranscriptionStatus.Failed
                => await CloseAsFailedAsync(job, poll.Value.Error, now, ct),

            // Still running — or, for a Done with no result attached, malformed enough that the age
            // cutoff is the only honest way to end it.
            _ => expired ? await CloseAsFailedAsync(job, null, now, ct) : Result.Success()
        };
    }

    private async Task<Result> CloseAsDoneAsync(
        TranscriptionJob job, TranscriptionResultDto result, DateTime now, CancellationToken ct)
    {
        job.Settle(TranscriptionResultCache.Serialize(result), now);

        // Same rule and the same idempotent method the client poll uses, because either path may be the
        // one that first observes success and the allowance must be spent exactly once regardless.
        if (!await IsProAsync(job.UserId, ct))
        {
            job.ConsumeTrial(now);
        }

        // Committed before the push, matching the billing notices: delivery is best-effort and cannot
        // throw, so pushing first would risk notifying twice about a job we then failed to close.
        await _db.SaveChangesAsync(ct);

        await _push.SendAsync(
            [job.UserId],
            new PushMessage(
                "Your transcription is ready",
                $"{result.Key} · {result.Tempo} BPM — tap to review and save it.",
                new Dictionary<string, string> { ["jobId"] = job.JobId }),
            ct);

        return Result.Success();
    }

    /// <summary>
    /// Closes a job that will not produce a result, and says so. Silence would be the safer-looking
    /// choice, but the point of the notification is that the user stopped watching: leaving them with
    /// nothing means they never learn to try again.
    /// </summary>
    private async Task<Result> CloseAsFailedAsync(
        TranscriptionJob job, string? reason, DateTime now, CancellationToken ct)
    {
        // No result cached, which is how a tap on this notification knows it has nothing to show.
        job.Settle(null, now);
        await _db.SaveChangesAsync(ct);

        await _push.SendAsync(
            [job.UserId],
            new PushMessage(
                "We couldn't transcribe that recording",
                string.IsNullOrWhiteSpace(reason)
                    ? "Something went wrong on our side. Try recording it again."
                    : reason,
                new Dictionary<string, string> { ["jobId"] = job.JobId }),
            ct);

        return Result.Success();
    }

    private async Task<bool> IsProAsync(Guid userId, CancellationToken ct)
    {
        var sub = await _db.Subscriptions
            .OrderByDescending(s => s.CurrentPeriodEndUtc)
            .FirstOrDefaultAsync(s => s.UserId == userId, ct);

        return sub is not null && sub.IsActiveAt(_clock.UtcNow);
    }
}
