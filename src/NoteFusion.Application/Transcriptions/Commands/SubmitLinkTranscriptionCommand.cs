using MediatR;
using Microsoft.EntityFrameworkCore;
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
/// Submits a song behind a streaming link (YouTube, Spotify, Apple Music) for transcription of its lead
/// vocal. The worker fetches the audio, isolates the voice and transcribes it; this handler decides how
/// much of the song the caller is entitled to and in which lane it runs.
/// </summary>
/// <remarks>
/// Pro: up to <see cref="SongCredits.ProMaxSeconds"/> of the song, in the high-priority lane, up to
/// <see cref="SongCredits.ProMonthlyAllowance"/> songs a month. Free with a bought transcription left: the same
/// length, in the normal lane, spending that transcription (<see cref="TranscriptionJob.PaidByCredit"/>). Free
/// otherwise: one <see cref="SongCredits.FreePreviewSeconds"/> preview, ever, in the normal lane. Either takes the first of the song unless the user chose a section
/// (<see cref="SongSections"/>). Nothing is charged here — a song is charged when it finishes
/// (<see cref="Queries.GetTranscriptionJobQueryHandler"/>, <see cref="NotifyTranscriptionReadyCommandHandler"/>),
/// so a link the platform refuses costs nothing.
/// </remarks>
public sealed record SubmitLinkTranscriptionCommand(
    string Url,
    TranscriptionMode Mode,
    string? Key,
    int? Tempo,
    string? TimeSignature = null,
    /// <summary>False to skip the synthesised preview WAV. See <see cref="TranscribeOptions.AudioPreview"/>.</summary>
    bool AudioPreview = true,
    /// <summary>The player's keyboard transpose setting. See <see cref="TranscribeOptions.KeyboardTranspose"/>.</summary>
    int KeyboardTranspose = 0,
    /// <summary>Where in the song to start, in seconds; null is the start. See <see cref="TranscribeOptions.StartSeconds"/>.</summary>
    double? StartSeconds = null,
    /// <summary>Where in the song to stop, in seconds; null runs to the allowance. See <see cref="TranscribeOptions.EndSeconds"/>.</summary>
    double? EndSeconds = null) : IRequest<Result<string>>;

public sealed class SubmitLinkTranscriptionCommandHandler : IRequestHandler<SubmitLinkTranscriptionCommand, Result<string>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;
    private readonly Activity.ActivityRecorder _activity;
    private readonly IQuotaGate _gate;

    public SubmitLinkTranscriptionCommandHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock,
        IDeviceFingerprint device,
        Activity.ActivityRecorder activity,
        IQuotaGate gate)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _device = device;
        _activity = activity;
        _gate = gate;
    }

    public async Task<Result<string>> Handle(SubmitLinkTranscriptionCommand request, CancellationToken ct)
    {
        var submitted = await SubmitAsync(request, ct);

        var log = _activity.Describe(
            TranscriptionLog.AccountOrigin, "link", request.Mode,
            linkUrl: SongLinks.TryExtract(request.Url, out var url) ? url : request.Url,
            key: request.Key, tempo: request.Tempo, timeSignature: request.TimeSignature,
            startSeconds: request.StartSeconds, endSeconds: request.EndSeconds);
        if (submitted.IsSuccess)
            await _activity.AcceptedAsync(submitted.Value, log, ct);
        else
            await _activity.RefusedAsync(log, submitted.Error, ct);

        return submitted;
    }

    private async Task<Result<string>> SubmitAsync(SubmitLinkTranscriptionCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        // Only the link goes on, not the words a share sheet wrapped around it.
        if (!SongLinks.TryExtract(request.Url, out var url))
            return TranscriptionErrors.InvalidLink;
        if (Math.Abs(request.KeyboardTranspose) > TranscribeOptions.MaxKeyboardTranspose)
            return TranscriptionErrors.InvalidKeyboardTranspose;

        var key = SubmitTranscriptionCommandHandler.SanitiseKey(request.Key);
        if (key is not null && KeyParser.Parse(key).IsFailure)
            return TranscriptionErrors.InvalidKey;

        var fingerprint = _device.Current;
        var isPro = await ProStatus.IsProAsync(_db, _clock, userId, ct);

        // Held from the count to the recorded job, so parallel links from one account are counted one
        // after another rather than all against the same rows (see IQuotaGate).
        await using var lease = await _gate.AcquireAsync(QuotaGateExtensions.UserKey(userId), ct);

        var paidByCredit = false;
        if (isPro)
        {
            if (await SongGate.CheckAsync(_db, userId, _clock.UtcNow, ct) is { } refused)
                return Result.Failure<string>(refused);
        }
        else
        {
            // A bought transcription pays for the whole song — the reason most people buy one — and is used
            // ahead of the free preview, which stays for later. Without one, the preview as before.
            paidByCredit = await HasBoughtTranscriptionAsync(userId, fingerprint, ct);
            if (!paidByCredit)
            {
                var used = await SongCredits.CountPreviewsUsedAsync(_db, userId, fingerprint, _clock.UtcNow, ct);
                if (used >= SongCredits.FreePreviews)
                    return BillingErrors.SongPreviewUsed;
            }
        }

        var maxSeconds = isPro || paidByCredit ? SongCredits.ProMaxSeconds : SongCredits.FreePreviewSeconds;
        var section = await SongSections.ChooseAsync(_api, url, request.StartSeconds, request.EndSeconds, maxSeconds, ct);
        if (section.IsFailure)
            return Result.Failure<string>(section.Error);

        var options = new TranscribeOptions
        {
            Mode = request.Mode,
            Key = key,
            Tempo = request.Tempo,
            TimeSignature = request.TimeSignature,
            Priority = isPro ? TranscribePriority.High : TranscribePriority.Normal,
            MaxSeconds = maxSeconds,
            StartSeconds = section.Value.StartSeconds,
            EndSeconds = section.Value.EndSeconds,
            AudioPreview = request.AudioPreview,
            KeyboardTranspose = request.KeyboardTranspose
        };

        var submitted = await _api.SubmitLinkAsync(url, options, ct);
        if (submitted.IsFailure)
            return submitted;

        // Attributed before the id leaves the server, so the first poll can check ownership, and
        // stamped with whether it was a Pro job: the free preview count must not include songs a
        // subscriber ran before their plan lapsed, and a lapsed subscriber's past songs must not be
        // re-read as previews.
        _db.TranscriptionJobs.Add(
            TranscriptionJob.RecordLink(submitted.Value, userId, _clock.UtcNow, fingerprint, isPro, paidByCredit));
        await _db.SaveChangesAsync(ct);

        return submitted;
    }

    private async Task<bool> HasBoughtTranscriptionAsync(Guid userId, string? fingerprint, CancellationToken ct)
    {
        var country = await _db.Users.Where(u => u.Id == userId).Select(u => u.Country).FirstOrDefaultAsync(ct);
        var allowance = await TrialUsage.ReadAsync(_db, userId, fingerprint, country, _clock.UtcNow, ct);
        return allowance.BoughtRemaining > 0;
    }
}
