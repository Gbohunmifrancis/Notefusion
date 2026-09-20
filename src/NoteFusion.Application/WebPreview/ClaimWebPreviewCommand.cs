using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.WebPreview;

/// <summary>
/// Moves a finished anonymous preview into the caller's library, which is what makes the web funnel
/// continue rather than end: the visitor signs up on the page they are already on, the result they just
/// watched appear becomes a saved transcription, and the mobile app finds it waiting at first sign-in.
/// </summary>
/// <remarks>
/// Deliberately a transfer rather than a re-transcription. The worker's full result — MusicXML included —
/// is already cached on the job by <see cref="GetWebPreviewJobQuery"/>, so claiming costs a row insert and
/// no ML compute, and the notation the user keeps is byte-for-byte the one they were shown.
/// <para>
/// The preview token stays required even though the caller is authenticated. Signing in proves who you
/// are; it does not prove you are the person whose browser made this preview, and the job is otherwise
/// addressable by an ID that appears in telemetry.
/// </para>
/// </remarks>
public sealed record ClaimWebPreviewCommand(
    string JobId,
    string PreviewToken,
    string? Title) : MediatR.IRequest<Result<SavedTranscriptionDto>>;

public sealed class ClaimWebPreviewCommandHandler
    : MediatR.IRequestHandler<ClaimWebPreviewCommand, Result<SavedTranscriptionDto>>
{
    /// <summary>What a claim is called when the visitor gave it no name of its own.</summary>
    private const string FallbackTitle = "Web preview";

    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IDateTimeProvider _clock;

    public ClaimWebPreviewCommandHandler(
        IApplicationDbContext db,
        ICurrentUser currentUser,
        IDateTimeProvider clock)
    {
        _db = db;
        _currentUser = currentUser;
        _clock = clock;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(
        ClaimWebPreviewCommand request,
        CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var job = await _db.WebPreviewJobs
            .FirstOrDefaultAsync(j => j.JobId == request.JobId, cancellationToken);

        // Same answer for "no such job" and "wrong token", for the reason the polling query gives it: the
        // job ID travels through telemetry, and a distinguishable response would confirm one exists.
        if (job is null || job.PreviewTokenHash != WebPreviewToken.Hash(request.PreviewToken))
            return WebPreviewErrors.InvalidToken;

        // A claim already made survives expiry — the transcription is in a library now, and the retention
        // window governs the anonymous preview, not what somebody kept from it.
        if (job.ClaimedByUserId is { } owner)
        {
            if (owner != userId)
                return WebPreviewErrors.AlreadyClaimed;

            var existing = await _db.Transcriptions
                .Include(t => t.Notes)
                .FirstOrDefaultAsync(t => t.Id == job.ClaimedTranscriptionId, cancellationToken);
            return existing is null
                ? LibraryErrors.NotFound
                : SavedTranscriptionMapper.ToDto(existing, includeNotes: true);
        }

        if (job.IsExpired(_clock.UtcNow))
            return WebPreviewErrors.Expired;

        if (job.ResultJson is null)
            return WebPreviewErrors.NotReady;

        var cached = TranscriptionResultCache.Deserialize(job.ResultJson);
        if (cached is null)
            return WebPreviewErrors.NotReady;

        var keyResult = KeyParser.Parse(cached.Key);
        if (keyResult.IsFailure)
            return LibraryErrors.InvalidKey;

        var title = string.IsNullOrWhiteSpace(request.Title)
            ? FallbackTitle
            : request.Title.Trim();

        var transcription = new Transcription(
            userId,
            title.Length > 120 ? title[..120] : title,
            keyResult.Value,
            cached.Tempo,
            cached.TimeSignature,
            cached.MusicXml,
            cached.Notes.Select(n => new NoteEvent
            {
                PitchMidi = n.PitchMidi,
                StartBeat = n.StartBeat,
                DurationBeats = n.DurBeats,
                Confidence = n.Conf
            }),
            cached.OverallConfidence,
            job.JobId);

        if (!job.Claim(userId, transcription.Id, _clock.UtcNow))
            return WebPreviewErrors.AlreadyClaimed;

        _db.Transcriptions.Add(transcription);
        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(transcription, includeNotes: true);
    }
}
