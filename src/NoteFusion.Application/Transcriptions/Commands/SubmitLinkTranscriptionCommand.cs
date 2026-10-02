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
/// Pro: the first <see cref="SongCredits.ProMaxSeconds"/> of the song, in the high-priority lane, up to
/// <see cref="SongCredits.ProMonthlyAllowance"/> songs a month. Free: one <see cref="SongCredits.FreePreviewSeconds"/>
/// preview, ever, in the normal lane. Nothing is charged here — a song is charged when it finishes
/// (<see cref="Queries.GetTranscriptionJobQueryHandler"/>, <see cref="NotifyTranscriptionReadyCommandHandler"/>),
/// so a link the platform refuses costs nothing.
/// </remarks>
public sealed record SubmitLinkTranscriptionCommand(
    string Url,
    TranscriptionMode Mode,
    string? Key,
    int? Tempo,
    string? TimeSignature = null) : IRequest<Result<string>>;

public sealed class SubmitLinkTranscriptionCommandHandler : IRequestHandler<SubmitLinkTranscriptionCommand, Result<string>>
{
    private readonly ITranscriptionApi _api;
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;
    private readonly IDeviceFingerprint _device;

    public SubmitLinkTranscriptionCommandHandler(
        ITranscriptionApi api,
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock,
        IDeviceFingerprint device)
    {
        _api = api;
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
        _device = device;
    }

    public async Task<Result<string>> Handle(SubmitLinkTranscriptionCommand request, CancellationToken ct)
    {
        if (_currentUser.UserId is not { } userId)
            return BillingErrors.NotAuthenticated;

        var url = (request.Url ?? string.Empty).Trim();
        if (url.Length is 0 or > 2048 || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            return TranscriptionErrors.InvalidLink;

        var key = SubmitTranscriptionCommandHandler.SanitiseKey(request.Key);
        if (key is not null && KeyParser.Parse(key).IsFailure)
            return TranscriptionErrors.InvalidKey;

        var fingerprint = _device.Current;
        var isPro = await ProStatus.IsProAsync(_db, _clock, userId, ct);

        if (isPro)
        {
            var used = await SongCredits.CountUsedThisMonthAsync(_db, userId, _clock.UtcNow, ct);
            if (used >= SongCredits.ProMonthlyAllowance)
                return BillingErrors.SongCreditsExhausted(SongCredits.ProMonthlyAllowance);
        }
        else
        {
            var used = await SongCredits.CountPreviewsUsedAsync(_db, userId, fingerprint, ct);
            if (used >= SongCredits.FreePreviews)
                return BillingErrors.SongPreviewUsed;
        }

        var options = new TranscribeOptions
        {
            Mode = request.Mode,
            Key = key,
            Tempo = request.Tempo,
            TimeSignature = request.TimeSignature,
            Priority = isPro ? TranscribePriority.High : TranscribePriority.Normal,
            MaxSeconds = isPro ? SongCredits.ProMaxSeconds : SongCredits.FreePreviewSeconds
        };

        var submitted = await _api.SubmitLinkAsync(url, options, ct);
        if (submitted.IsFailure)
            return submitted;

        // Attributed before the id leaves the server, so the first poll can check ownership, and
        // stamped with whether it was a Pro job: the free preview count must not include songs a
        // subscriber ran before their plan lapsed, and a lapsed subscriber's past songs must not be
        // re-read as previews.
        _db.TranscriptionJobs.Add(TranscriptionJob.RecordLink(submitted.Value, userId, _clock.UtcNow, fingerprint, isPro));
        await _db.SaveChangesAsync(ct);

        return submitted;
    }
}
