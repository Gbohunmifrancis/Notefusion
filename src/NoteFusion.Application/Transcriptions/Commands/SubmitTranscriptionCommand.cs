using MediatR;
using Microsoft.EntityFrameworkCore;

using NoteFusion.Application.Activity;
using NoteFusion.Application.Common;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Submits captured audio to the Python ML service and returns the job id to poll. The C# backend is
/// the only gateway — the client never talks to the ML service directly (architecture decision).
/// </summary>
public sealed record SubmitTranscriptionCommand(
    Stream Audio,
    string FileName,
    TranscriptionMode Mode,
    string? Key,
    int? Tempo,
    string? TimeSignature = null,
    /// <summary>A whole song with instruments: isolate the voice first. See <see cref="TranscribeOptions.Separate"/>.</summary>
    bool Separate = false,
    /// <summary>False to skip the synthesised preview WAV. See <see cref="TranscribeOptions.AudioPreview"/>.</summary>
    bool AudioPreview = true,
    /// <summary>The player's keyboard transpose setting. See <see cref="TranscribeOptions.KeyboardTranspose"/>.</summary>
    int KeyboardTranspose = 0,
    /// <summary>The upload's media type as the client declared it; for the activity log only.</summary>
    string? ContentType = null,
    /// <summary>The upload's size in bytes; for the activity log only.</summary>
    long? SizeBytes = null,
    /// <summary>
    /// The client's <c>Idempotency-Key</c> (the phone sends its take's own id): a repeat from the same account is
    /// handed the job the first one started, never a second job or a second charge. See <see cref="TranscriptionJob.IdempotencyKey"/>.
    /// </summary>
    string? IdempotencyKey = null,
    /// <summary>Melody only: no voice in the take means read it as chords. See <see cref="TranscribeOptions.NoVoiceAsChords"/>.</summary>
    bool NoVoiceAsChords = false) : IRequest<Result<string>>;

public sealed class SubmitTranscriptionCommandHandler : IRequestHandler<SubmitTranscriptionCommand, Result<string>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;
    private readonly ITrialDeviceRecorder _devices;
    private readonly ActivityRecorder _activity;
    private readonly IQuotaGate _gate;

    public SubmitTranscriptionCommandHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock,
        IDeviceFingerprint device,
        ITrialDeviceRecorder devices,
        ActivityRecorder activity,
        IQuotaGate gate)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _device = device;
        _devices = devices;
        _activity = activity;
        _gate = gate;
    }

    public async Task<Result<string>> Handle(SubmitTranscriptionCommand request, CancellationToken cancellationToken)
    {
        var (submitted, repeat) = await SubmitAsync(request, cancellationToken);

        // A repeat of a submit that already started its job (the answer was lost on the way back): the job and its
        // activity row exist from the first time, so there is nothing new to record.
        if (repeat)
            return submitted;

        var ext = Path.GetExtension(request.FileName).ToLowerInvariant();
        var kind = ext is ".musicxml" or ".xml" or ".mxl" or ".mid" or ".midi" or ".abc" ? "score"
            : request.Separate ? "song" : "upload";
        var log = _activity.Describe(
            TranscriptionLog.AccountOrigin, kind, request.Mode, request.FileName, request.ContentType, request.SizeBytes,
            key: request.Key, tempo: request.Tempo, timeSignature: request.TimeSignature);
        if (submitted.IsSuccess)
            await _activity.AcceptedAsync(submitted.Value, log, cancellationToken);
        else
            await _activity.RefusedAsync(log, submitted.Error, cancellationToken);

        return submitted;
    }

    /// <returns>The job id, and whether it is the job an earlier submit with the same key started.</returns>
    private async Task<(Result<string> Submitted, bool Repeat)> SubmitAsync(
        SubmitTranscriptionCommand request, CancellationToken cancellationToken)
    {
        if (Math.Abs(request.KeyboardTranspose) > TranscribeOptions.MaxKeyboardTranspose)
            return (TranscriptionErrors.InvalidKeyboardTranspose, false);
        if (!Meters.TryRead(request.TimeSignature, out var meter))
            return (TranscriptionErrors.InvalidTimeSignature, false);
        if (request.Tempo is < TranscribeOptions.MinTempo or > TranscribeOptions.MaxTempo)
            return (TranscriptionErrors.InvalidTempo, false);
        var idempotencyKey = string.IsNullOrWhiteSpace(request.IdempotencyKey) ? null : request.IdempotencyKey.Trim();
        if (idempotencyKey is { Length: > TranscriptionJob.IdempotencyKeyMaxLength })
            return (TranscriptionErrors.InvalidIdempotencyKey, false);

        // Read once: the header cannot change mid-request, and the gate below and the stamp further down
        // must agree about which handset this is or the two would count different things.
        var fingerprint = _device.Current;
        var metered = false;
        var ext = Path.GetExtension(request.FileName).ToLowerInvariant();
        var isScore = ext is ".musicxml" or ".xml" or ".mxl" or ".mid" or ".midi" or ".abc";
        var isPro = false;
        var paidByCredit = false;
        Guid? choirPool = null;

        // Where this account's Pro comes from, read before the lease because it names the choir whose song
        // pool the lease must also cover.
        var access = _currentUser.UserId is { } member
            ? await ProStatus.ReadAsync(_db, _clock, member, cancellationToken)
            : null;

        // One submit per account at a time, from the count to the recorded job: the job row is what the
        // next count sees, and it is written only after the worker answers, so parallel submits would all
        // count the same rows and all pass. With a choir, one song submit per choir at a time as well.
        // A free account also holds its handset and its inbox, whose free ones every account on them shares.
        var mailbox = _currentUser.UserId is { } holder && access is { IsPro: false }
            ? await TrialUsage.MailboxOfAsync(_db, holder, cancellationToken)
            : null;
        await using var lease = _currentUser.UserId is { } signedIn
            ? await _gate.AcquireAllAsync(
                access!.GateKeys(signedIn).Concat(access.IsPro
                    ? []
                    : [QuotaGateExtensions.DeviceKey(fingerprint), QuotaGateExtensions.MailboxKey(mailbox)]),
                cancellationToken)
            : null;

        // Under the account's lease, before any count: a repeat of a submit that started its job is that job (it
        // holds or has spent its own place already), whatever the allowance says now. Two repeats at once queue on
        // the lease, so the second sees the first one's row.
        if (idempotencyKey is not null && _currentUser.UserId is { } keyOwner)
        {
            var started = await _db.TranscriptionJobs
                .Where(j => j.UserId == keyOwner && j.IdempotencyKey == idempotencyKey)
                .Select(j => j.JobId)
                .FirstOrDefaultAsync(cancellationToken);
            if (started is not null)
                return (started, true);
        }

        if (_currentUser.UserId is { } userId)
        {
            isPro = access!.IsPro;
            metered = !isPro;

            if (metered)
            {
                // Successful generations, not saved rows. Counting Transcriptions meant deleting one
                // handed the free slot back, so the limit was avoidable by anyone who noticed. And counted
                // per device as well as per account, because adding a second Google account to an Android
                // phone is four taps and used to be worth a fresh trial. Running jobs count too: they are
                // charged when they finish, so without them any number could be started at once.
                // This week's free ones cover hums and recordings; a free one while any is left, then a bought
                // one. A song with the voice isolated is not a free one: only a bought one pays for it (as for
                // a whole linked song). Each bought one is the account's own, so it is marked on the job and
                // never spent by another account on the same phone.
                // The country sets the allowance; the zone is where a refusal says the free ones come back.
                var account = await _db.Users
                    .Where(u => u.Id == userId)
                    .Select(u => new { u.Country, u.TimeZone })
                    .FirstOrDefaultAsync(cancellationToken);

                var allowance = await TrialUsage.ReadAsync(_db, userId, fingerprint, account?.Country, _clock.UtcNow, cancellationToken);
                var song = request.Separate && !isScore;

                if (song)
                {
                    if (allowance.BoughtRemaining <= 0)
                        return (BillingErrors.SongNotFree, false);
                    paidByCredit = true;
                }
                else
                {
                    if (allowance.Remaining <= 0)
                    {
                        // Told the numbers that actually applied to them, not a global one: a refusal that names
                        // a different count than the trial pill did is indistinguishable from a billing bug.
                        return (BillingErrors.FreeTierLimitReached(
                            allowance.Free, allowance.Bought, allowance.FreeResetsAtUtc, account?.TimeZone), false);
                    }

                    paidByCredit = allowance.FreeRemaining == 0;
                }
            }
            else if (request.Separate && !isScore)
            {
                // A whole song with the voice isolated is the work a song credit pays for, whether the song
                // arrived as a link or as a file. Same gate as the link submit, so "N of 20 songs" counts
                // every song and the twenty-first is refused the same way. A score file has no voice to
                // isolate, so it is neither gated nor charged as a song whatever the form said.
                var pool = await SongGate.CheckAsync(_db, access, userId, _clock.UtcNow, cancellationToken);
                if (pool.IsFailure)
                    return (Result.Failure<string>(pool.Error), false);
                choirPool = pool.Value.ChoirId;
            }
        }
        // Normalise the optional key override:
        //   • null / whitespace        → treat as "no override"
        //   • "Auto" / "auto" / "none" → treat as "no override" (mobile UI default)
        //   • anything else            → validate with KeyParser before forwarding
        //
        // This guard must live here (not only in the HTTP client) so that direct callers
        // (tests, future gRPC, CLI) are protected just as much as the HTTP surface.
        var key = SanitiseKey(request.Key);

        if (key is not null && KeyParser.Parse(key).IsFailure)
            return (TranscriptionErrors.InvalidKey, false);

        var options = new TranscribeOptions
        {
            Mode = request.Mode,
            Key = key,
            Tempo = request.Tempo,
            TimeSignature = meter,
            Separate = request.Separate,
            AudioPreview = request.AudioPreview,
            KeyboardTranspose = request.KeyboardTranspose,
            NoVoiceAsChords = request.NoVoiceAsChords && request.Mode == TranscriptionMode.Melody,
            // Pro reads the whole file up to six minutes, as it does a linked song, and so does a song paid for with a
            // bought transcription; anything else its first three minutes.
            MaxSeconds = isPro || (request.Separate && paidByCredit) ? SongCredits.ProMaxSeconds : FreeTier.UploadSeconds,
            // Pro work goes to the front of the worker's queue and takes its fast lane.
            Priority = isPro ? TranscribePriority.High : TranscribePriority.Normal
        };

        var submitted = isScore
            ? await _api.SubmitScoreAsync(request.Audio, request.FileName, options, cancellationToken)
            : await _api.SubmitAsync(request.Audio, request.FileName, options, cancellationToken);

        // Attribute the job before the id leaves the server, so the very first poll can check
        // ownership. Nothing is charged here — the audio has not been transcribed yet, and a job that
        // fails must not cost the user one of their five. The device is stamped now rather than at
        // consume time because the poll that charges the trial may be the completion sweep, which runs
        // on a timer with no request behind it and so no header to read.
        if (submitted.IsSuccess && _currentUser.UserId is { } owner)
        {
            // Only for accounts the allowance applies to: a Pro subscriber's handset is not part of the
            // trial ledger, and registering it would spend a geo lookup to learn nothing. Before the job is
            // staged, because a first sighting is saved on its own (see ITrialDeviceRecorder).
            if (metered && fingerprint is not null)
            {
                await _devices.RecordAsync(fingerprint, owner, cancellationToken);
            }

            var row = isPro && request.Separate && !isScore
                ? TranscriptionJob.RecordSong(submitted.Value, owner, _clock.UtcNow, fingerprint, choirPool)
                : TranscriptionJob.Record(submitted.Value, owner, _clock.UtcNow, fingerprint, paidByCredit);
            row.KeyBy(idempotencyKey);
            _db.TranscriptionJobs.Add(row);

            await _db.SaveChangesAsync(cancellationToken);
        }

        return (submitted, false);
    }

    /// <summary>
    /// Returns null when the caller's key string means "no override", or the trimmed
    /// key string when it is a genuine key name that should be validated and forwarded.
    /// </summary>
    internal static string? SanitiseKey(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var trimmed = raw.Trim();

        // Values the mobile UI sends when the user has not chosen a key.
        // Comparison is case-insensitive so "AUTO", "Auto", and "auto" are all handled.
        if (trimmed.Equals("Auto", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("None", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("Null", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("null", StringComparison.OrdinalIgnoreCase))
            return null;

        return trimmed;
    }
}
