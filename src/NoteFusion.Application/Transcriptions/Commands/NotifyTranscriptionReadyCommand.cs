using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common;
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
    /// How long a job may go without an answer before we stop waiting. Comfortably past both the ML
    /// service's own job TTL and the longest recording it will accept, so no answer by then means the job is
    /// genuinely lost — a dyno cycled mid-transcription, most likely — rather than merely slow.
    /// </summary>
    public static readonly TimeSpan GiveUpAfter = TrialUsage.RunningFor;

    /// <summary>
    /// How long a job the worker still reports as queued or running is waited for. Such a job is in a busy
    /// queue, not lost: closing it at <see cref="GiveUpAfter"/> made its result free when it came, and freed
    /// its place in the allowance while it was still on its way.
    /// </summary>
    public static readonly TimeSpan GiveUpOnRunningAfter = TrialUsage.HeldFor;

    /// <summary>A job older than this is closed without a push when it fails: the user has long moved on.</summary>
    public static readonly TimeSpan TooOldToMention = TimeSpan.FromDays(1);

    /// <summary>
    /// The ready (and failed) push is sent to someone who stopped watching, so it must arrive now: a time to live
    /// makes the sender ask FCM for high priority, which Android delivers through Doze instead of holding it for
    /// the next maintenance window (with the screen off that was minutes, or not before the phone was picked up).
    /// A push that has not arrived within the day is no longer worth showing.
    /// </summary>
    public const int PushTimeToLiveSeconds = 24 * 60 * 60;
}

public sealed class NotifyTranscriptionReadyCommandHandler
    : IRequestHandler<NotifyTranscriptionReadyCommand, Result>
{
    /// <summary>What the user is told about a job the worker no longer knows.</summary>
    internal const string LostReason =
        "The transcription service restarted while working on this, so it was lost. Nothing was charged — please try it again.";

    private readonly IApplicationDbContext _db;
    private readonly ITranscriptionApi _api;
    private readonly IDateTimeProvider _clock;
    private readonly IPushSender _push;
    private readonly ITranscriptionNotifier _notifier;
    private readonly IWebPushSender _webPush;
    private readonly IQuotaGate _gate;

    public NotifyTranscriptionReadyCommandHandler(
        IApplicationDbContext db, ITranscriptionApi api, IDateTimeProvider clock, IPushSender push,
        ITranscriptionNotifier notifier, IWebPushSender webPush, IQuotaGate gate)
    {
        _db = db;
        _api = api;
        _clock = clock;
        _push = push;
        _notifier = notifier;
        _webPush = webPush;
        _gate = gate;
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

        Result<TranscriptionJobDto> poll;
        try
        {
            poll = await _api.GetJobAsync(job.JobId, ct);
        }
        catch (Exception) when (expired && !ct.IsCancellationRequested)
        {
            // The last ask of a job past its deadline timed out (the HTTP client throws rather than answers).
            // No answer at the deadline is the same as a lost job: closing it here is what stops a worker
            // that hangs from keeping the job open — and holding a free place or a song credit — forever.
            return await CloseAsFailedAsync(job, null, TranscriptionJob.LostCode, now, ct);
        }

        if (poll.IsFailure)
        {
            // A 404 is the worker saying it does not know the job: it restarted under it without a journal
            // (the queue is in memory) and a journaled restart replays before it answers anything, so the
            // job is not coming back. Closed now, as the client's poll closes it, rather than holding the
            // user's place for the rest of the deadline. Any other failure (unreachable, a 5xx) proves
            // nothing: a young job is tried again next tick, one past the deadline is given up on.
            if (poll.Error.Type == ErrorType.NotFound)
                return await CloseAsFailedAsync(job, LostReason, TranscriptionJob.LostCode, now, ct);
            return expired ? await CloseAsFailedAsync(job, null, TranscriptionJob.LostCode, now, ct) : Result.Success();
        }

        return poll.Value.Status switch
        {
            TranscriptionStatus.Done when poll.Value.Result is { } result
                => await CloseAsDoneAsync(job, result, now, ct),

            TranscriptionStatus.Failed
                => await CloseAsFailedAsync(job, poll.Value.Error, poll.Value.ErrorCode, now, ct),

            // A Done with no result attached: malformed enough that the age cutoff is the only honest way to end it.
            TranscriptionStatus.Done
                => expired ? await CloseAsFailedAsync(job, null, TranscriptionJob.LostCode, now, ct) : Result.Success(),

            // Still queued or running: the worker has it, so it is waited for (and keeps holding its place)
            // until it finishes, or for GiveUpOnRunningAfter at most.
            _ => now - job.CreatedAtUtc > NotifyTranscriptionReadyCommand.GiveUpOnRunningAfter
                ? await CloseAsFailedAsync(job, null, TranscriptionJob.LostCode, now, ct)
                : Result.Success()
        };
    }

    private async Task<Result> CloseAsDoneAsync(
        TranscriptionJob job, TranscriptionResultDto result, DateTime now, CancellationToken ct)
    {
        job.Settle(TranscriptionResultCache.Serialize(result), now);
        await Activity.ActivityRecorder.FinishAsync(_db, job.JobId, result, now, ct);

        // Same rule and the same idempotent methods the client poll uses, because either path may be the
        // one that first observes success and the allowance must be spent exactly once regardless.
        if (job.IsSong)
        {
            job.ConsumeSongCredit(now);
        }
        else if (!await IsProAsync(job.UserId, ct))
        {
            job.ConsumeTrial(now);
        }

        // Committed before the push, matching the billing notices: delivery is best-effort and cannot
        // throw, so pushing first would risk notifying twice about a job we then failed to close.
        await _db.SaveChangesAsync(ct);

        // Filed in the owner's library now, before anyone is told: the push opens a sheet that is already theirs.
        var sheet = await Library.LibraryFiling.FileAsync(_db, _gate, _clock, job, result, ct);

        // What the owner is sent over the live connection is what their poll would answer: a free account's copy
        // without the Pro parts (MIDI, harmony), which only the stored result keeps.
        var shown = await IsProAsync(job.UserId, ct) ? result : ProGate.ForFree(result);
        var dto = Library.LibraryFiling.WithSheet(new TranscriptionJobDto(job.JobId, TranscriptionStatus.Done, 1, shown), sheet);
        await _notifier.NotifyJobCompletedAsync(job.UserId, dto, ct);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == job.UserId, ct);
        var firstName = user?.FullName?.Split(' ')[0];
        if (string.IsNullOrWhiteSpace(firstName)) firstName = "there";

        // While the Christmas season is on for everyone, the product's festive words, on the phone and the web alike.
        var christmas = await Flags.FeatureFlags.ChristmasForEveryoneAsync(_db, now, ct)
            ? ReadyPushCopy.Christmas(firstName, result)
            : null;

        await _push.SendAsync(
            [job.UserId],
            new PushMessage(
                christmas?.Title ?? $"Hey {firstName}, your transcription is ready!",
                christmas?.Body ?? $"{result.Key} · {result.Tempo} BPM — tap to review and save it.",
                new Dictionary<string, string> { ["jobId"] = job.JobId },
                TimeToLiveSeconds: NotifyTranscriptionReadyCommand.PushTimeToLiveSeconds),
            ct);

        // The web app's browsers, for a tab that was closed (an open one collected it by its poll first).
        await _webPush.SendAsync(
            job.UserId,
            christmas is null
                ? Push.WebPush.Ready(job.JobId, result.Source?.Title ?? await JobNameAsync(job.JobId, ct))
                : Push.WebPush.Ready(job.JobId, christmas.Title, christmas.Body),
            ct);

        return Result.Success();
    }

    /// <summary>
    /// Closes a job that will not produce a result, and says so. Silence would be the safer-looking
    /// choice, but the point of the notification is that the user stopped watching: leaving them with
    /// nothing means they never learn to try again.
    /// </summary>
    /// <param name="code">
    /// <see cref="TranscriptionJob.LostCode"/> when the service lost the job or never answered; kept on the row so
    /// a client asking later is still told, after the worker has forgotten it.
    /// </param>
    private async Task<Result> CloseAsFailedAsync(
        TranscriptionJob job, string? reason, string? code, DateTime now, CancellationToken ct)
    {
        // No result cached, which is how a tap on this notification knows it has nothing to show.
        job.Settle(null, now, code);
        await Activity.ActivityRecorder.FailAsync(
            _db, job.JobId, reason ?? "No result by the deadline; the job was lost.", now, ct);
        await _db.SaveChangesAsync(ct);

        // A job from days ago that a sweep is only now clearing (a backlog the sweep could not close before)
        // is closed quietly: "your transcription failed" about something the user has long forgotten is noise.
        if (now - job.CreatedAtUtc > NotifyTranscriptionReadyCommand.TooOldToMention)
            return Result.Success();

        var dto = new TranscriptionJobDto(job.JobId, TranscriptionStatus.Failed, 1, null, reason, ErrorCode: code);
        await _notifier.NotifyJobCompletedAsync(job.UserId, dto, ct);

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == job.UserId, ct);
        var firstName = user?.FullName?.Split(' ')[0];
        if (string.IsNullOrWhiteSpace(firstName)) firstName = "there";

        var sentence = string.IsNullOrWhiteSpace(reason)
            ? "Something went wrong on our side. Try recording it again."
            : reason;
        await _push.SendAsync(
            [job.UserId],
            new PushMessage(
                $"Sorry {firstName}, the transcription failed",
                sentence,
                new Dictionary<string, string> { ["jobId"] = job.JobId },
                TimeToLiveSeconds: NotifyTranscriptionReadyCommand.PushTimeToLiveSeconds),
            ct);

        await _webPush.SendAsync(job.UserId, Push.WebPush.Failed(job.JobId, await JobNameAsync(job.JobId, ct), sentence), ct);

        return Result.Success();
    }

    /// <summary>What the job is called on screen (the song's title or the file's name), from the activity log.</summary>
    private async Task<string?> JobNameAsync(string jobId, CancellationToken ct)
    {
        var log = await _db.TranscriptionLogs
            .Where(l => l.JobId == jobId)
            .Select(l => new { l.SongTitle, l.FileName })
            .FirstOrDefaultAsync(ct);
        return log is null ? null : Push.WebPush.NameOf(log.SongTitle, log.FileName);
    }

    private Task<bool> IsProAsync(Guid userId, CancellationToken ct) => Common.ProStatus.IsProAsync(_db, _clock, userId, ct);
}
