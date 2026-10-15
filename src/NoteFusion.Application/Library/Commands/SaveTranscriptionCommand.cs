using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// Saves a completed transcription result to the current user's library (F-08). The client posts the
/// result it received from the job-polling endpoint, along with a chosen title.
/// </summary>
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
    IReadOnlyList<ChordSymbolDto>? Chords = null) : IRequest<Result<SavedTranscriptionDto>>;

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
            _db.Transcriptions.RemoveRange(kept);
        }

        _db.Transcriptions.Add(transcription);
        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(transcription, includeNotes: true);
    }
}
