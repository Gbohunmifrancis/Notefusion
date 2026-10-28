using FluentValidation;
using MediatR;
using Microsoft.EntityFrameworkCore;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Common.Interfaces;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Library.Commands;

/// <summary>
/// Tap-to-correct (F-07). The client sends the whole corrected note list — not a single index —
/// because a correction may delete a note, and that shifts every index after it.
/// </summary>
/// <remarks>
/// <c>MusicXml</c>, when sent, is the staff the client wrote from the corrected notes (the web app's "Fix a note"),
/// stored with them so the sheet opens with a staff that agrees with its solfa; left out (the phone, which draws its
/// staff from the notes), the stored score is kept as it was.
/// Only pitch, position, duration and confidence are read off the wire. The solfa fields on
/// <see cref="NoteEventDto"/> are derived, never stored, so whatever the client sends for them is
/// ignored and the response carries solfa re-derived for the *stored* key.
/// </remarks>
public sealed record UpdateTranscriptionNotesCommand(Guid Id, IReadOnlyList<NoteEventDto> Notes, string? MusicXml = null)
    : IRequest<Result<SavedTranscriptionDto>>;

public sealed class UpdateTranscriptionNotesCommandValidator : AbstractValidator<UpdateTranscriptionNotesCommand>
{
    public UpdateTranscriptionNotesCommandValidator()
    {
        RuleFor(x => x.Id).NotEmpty();
        RuleFor(x => x.Notes)
            .NotEmpty()
            .WithMessage("A transcription must keep at least one note.")
            .WithinNoteCount();
        RuleFor(x => x.MusicXml).WithinScoreSize();

        RuleForEach(x => x.Notes).ChildRules(note =>
        {
            // The editor arrives at new pitches by arithmetic (±1 semitone, ±12 for an octave),
            // so the one thing worth re-checking is that the result is still a real MIDI note.
            note.RuleFor(n => n.PitchMidi).InclusiveBetween(0, 127);
            note.RuleFor(n => n.Conf).InclusiveBetween(0.0, 1.0);
        });
    }
}

public sealed class UpdateTranscriptionNotesCommandHandler
    : IRequestHandler<UpdateTranscriptionNotesCommand, Result<SavedTranscriptionDto>>
{
    private readonly IApplicationDbContext _db;
    private readonly ICurrentUser _currentUser;

    public UpdateTranscriptionNotesCommandHandler(IApplicationDbContext db, ICurrentUser currentUser)
    {
        _db = db;
        _currentUser = currentUser;
    }

    public async Task<Result<SavedTranscriptionDto>> Handle(
        UpdateTranscriptionNotesCommand request, CancellationToken cancellationToken)
    {
        if (_currentUser.UserId is not { } userId)
            return UserErrors.NotFound;

        var item = await _db.Transcriptions.FirstOrDefaultAsync(t => t.Id == request.Id, cancellationToken);
        if (item is null)
            return LibraryErrors.NotFound;
        if (item.UserId != userId)
            return LibraryErrors.NotOwnedByUser;

        item.ReplaceNotes(request.Notes.Select(n => new NoteEvent
        {
            PitchMidi = n.PitchMidi,
            StartBeat = n.StartBeat,
            DurationBeats = n.DurBeats,
            Confidence = n.Conf
        }), string.IsNullOrWhiteSpace(request.MusicXml) ? null : request.MusicXml);

        await _db.SaveChangesAsync(cancellationToken);

        return SavedTranscriptionMapper.ToDto(item, includeNotes: true);
    }
}
