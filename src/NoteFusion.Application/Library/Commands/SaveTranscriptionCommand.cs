using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.Transcriptions;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// Saves a completed transcription result to the current user's library (F-08). The client posts the
/// result it received from the job-polling endpoint, along with a chosen title.
/// </summary>
/// <param name="HymnSlug">
/// Set when the user took the hymnbook version the job offered (<see cref="HymnMatchDto"/>): the sheet then
/// keeps that hymn's credit. The credit is read from the job's own result, never from the request, so it
/// is the line the hymn's page shows; a slug the job did not offer is ignored.
/// </param>
public sealed record SaveTranscriptionCommand(
    string Title,
    string Key,
    int TempoBpm,
    string TimeSignature,
    string MusicXml,
    IReadOnlyList<NoteEventDto> Notes,
    double OverallConfidence,
    string? SourceJobId,
    string Lyrics = "",
    IReadOnlyDictionary<string, PartDto>? Parts = null,
    string? PartsMusicXml = null,
    IReadOnlyList<ChordSymbolDto>? Chords = null,
    string? HymnSlug = null) : IRequest<Result<SavedTranscriptionDto>>;

public sealed class SaveTranscriptionCommandValidator : AbstractValidator<SaveTranscriptionCommand>
{
    public SaveTranscriptionCommandValidator()
    {
        RuleFor(x => x.Title).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Key).NotEmpty();
        RuleFor(x => x.TempoBpm).InclusiveBetween(20, 300);
        RuleFor(x => x.TimeSignature).NotEmpty();
        RuleFor(x => x.MusicXml).NotEmpty().WithinScoreSize();
        RuleFor(x => x.OverallConfidence).InclusiveBetween(0.0, 1.0);
        RuleFor(x => x.Lyrics).MaximumLength(20_000);
        RuleFor(x => x.Notes).NotNull().WithinNoteCount();
        RuleFor(x => x.Parts).WithinPartsSize();
        RuleFor(x => x.PartsMusicXml).WithinScoreSize();
        RuleForEach(x => x.Chords).SetValidator(new ChordSymbolDtoValidator()).When(x => x.Chords is not null);
        RuleFor(x => x.HymnSlug).MaximumLength(200);
    }
}

public sealed class SaveTranscriptionCommandHandler : IRequestHandler<SaveTranscriptionCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;
    private readonly IQuotaGate _gate;

    public SaveTranscriptionCommandHandler(IApplicationDbContext db, ICurrentUser currentUser, IQuotaGate gate)
    {
        _db = db;
        _currentUser = currentUser;
        _gate = gate;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(SaveTranscriptionCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var keyResult = KeyParser.Parse(request.Key);
        if (keyResult.IsFailure)
            return LibraryErrors.InvalidKey;

        var notes = request.Notes.Select(n => new NoteEvent
        {
            PitchMidi = n.PitchMidi,
            StartBeat = n.StartBeat,
            DurationBeats = n.DurBeats,
            Confidence = n.Conf
        });

        var transcription = new Transcription(
            userId,
            request.Title.Trim(),
            keyResult.Value,
            request.TempoBpm,
            request.TimeSignature,
            request.MusicXml,
            notes,
            request.OverallConfidence,
            request.SourceJobId);

        transcription.SetLyrics(request.Lyrics ?? string.Empty);
        transcription.SetParts(PartNotes.FromDtos(request.Parts), request.PartsMusicXml);
        transcription.SetChords(SheetChords.FromDtos(request.Chords));
        if (await OfferedHymnAsync(userId, request, cancellationToken) is { } hymn)
            transcription.CreditHymn(hymn.Slug, hymn.Title, hymn.Url, hymn.Credit);

        // One sheet per job. The library sweep keeps a finished job nobody saved
        // (AutoSaveFinishedTranscriptionsCommand); a Save pressed after that is the user's own version —
        // their title, their doh — so it replaces the kept copy rather than standing beside it. The
        // replace-and-insert runs under the account's save lock, which the sweep takes too: a double tap, or
        // a save landing while the sweep keeps the same job, would otherwise both see "nothing saved yet"
        // and leave two sheets for one job.
        await using var lease = await _gate.AcquireAsync(QuotaGateExtensions.SaveKey(userId), cancellationToken);
        if (!string.IsNullOrWhiteSpace(request.SourceJobId))
        {
            var kept = await _db.Transcriptions
                .Where(t => t.UserId == userId && t.SourceJobId == request.SourceJobId)
                .ToListAsync(cancellationToken);
            // The replaced copy knew the recording: its beat clock, whether it came from a link, how far it has been
            // transposed, and the backing kept with it, which moves to this one rather than going with the old row.
            if (kept.FirstOrDefault() is { } filed)
                transcription.TakePlaybackFrom(filed);
            else
                await KeepRecordingFactsAsync(transcription, userId, request.SourceJobId, cancellationToken);
            _db.Transcriptions.RemoveRange(kept);
        }

        _db.Transcriptions.Add(transcription);
        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(transcription, includeNotes: true);
    }

    /// <summary>
    /// For a sheet saved from a job with no filed copy left (its owner deleted it): the beat clock and whether it came
    /// from a link, from the job's banked result. Never the backing: that went with the deleted copy.
    /// </summary>
    private async Task KeepRecordingFactsAsync(Transcription sheet, Guid userId, string jobId, CancellationToken ct)
    {
        var job = await _db.TranscriptionJobs.AsNoTracking()
            .FirstOrDefaultAsync(j => j.JobId == jobId && j.UserId == userId && j.ResultJson != null, ct);
        if (job is null || TranscriptionResultCache.Deserialize(job.ResultJson!) is not { } result)
            return;
        sheet.KeepTiming(result.BeatOriginSec, result.BeatTimesSec);
        if (LibraryFiling.IsFromLink(job, result))
            sheet.MarkFromLink();
    }

    /// <summary>The hymn the request names, when the job it came from offered that hymn's score.</summary>
    private async Task<HymnMatchDto?> OfferedHymnAsync(Guid userId, SaveTranscriptionCommand request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.HymnSlug) || string.IsNullOrWhiteSpace(request.SourceJobId))
            return null;
        var json = await _db.TranscriptionJobs.AsNoTracking()
            .Where(j => j.JobId == request.SourceJobId && j.UserId == userId && j.ResultJson != null)
            .Select(j => j.ResultJson)
            .FirstOrDefaultAsync(ct);
        var hymn = json is null ? null : TranscriptionResultCache.Deserialize(json)?.HymnMatch;
        return hymn is { Kind: "score" } && hymn.Slug == request.HymnSlug.Trim() ? hymn : null;
    }
}
