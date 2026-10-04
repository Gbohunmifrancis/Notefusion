using System.Xml;
using FluentValidation;
using MediatR;
using NoteFusion.Application.Common.Errors;
using NoteFusion.Application.Library.Commands;
using NoteFusion.Application.Library.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Notation;
using NoteFusion.Core.Solfa;
using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Transcriptions.Commands;

/// <summary>
/// Transposes a result that has not been saved yet — the same move as the library's transpose,
/// on a sheet the client still holds. Stateless: nothing is stored. The notes come back labelled
/// for the new key, which (movable-do) means the solfa reads as it did and only Doh has moved.
/// </summary>
public sealed record TransposeSheetCommand(
    string Key,
    int Semitones,
    IReadOnlyList<NoteEventDto> Notes,
    string MusicXml,
    IReadOnlyDictionary<string, PartDto>? Parts = null,
    string? PartsMusicXml = null,
    IReadOnlyList<ChordSymbolDto>? Chords = null) : IRequest<Result<TransposedSheetDto>>;

public sealed record TransposedSheetDto(
    string Key,
    IReadOnlyList<NoteEventDto> Notes,
    string MusicXml,
    IReadOnlyDictionary<string, PartDto>? Parts,
    string? PartsMusicXml,
    IReadOnlyList<ChordSymbolDto>? Chords = null);

public sealed class TransposeSheetCommandValidator : AbstractValidator<TransposeSheetCommand>
{
    public TransposeSheetCommandValidator()
    {
        RuleFor(x => x.Key).NotEmpty();
        RuleFor(x => x.Semitones).InclusiveBetween(-12, 12);
        RuleFor(x => x.Notes).NotNull();
        RuleFor(x => x.MusicXml).NotNull();
        RuleForEach(x => x.Chords).SetValidator(new ChordSymbolDtoValidator()).When(x => x.Chords is not null);
    }
}

public sealed class TransposeSheetCommandHandler : IRequestHandler<TransposeSheetCommand, Result<TransposedSheetDto>>
{
    public Task<Result<TransposedSheetDto>> Handle(TransposeSheetCommand request, CancellationToken cancellationToken)
        => Task.FromResult(Transpose(request));

    private static Result<TransposedSheetDto> Transpose(TransposeSheetCommand request)
    {
        var keyResult = KeyParser.Parse(request.Key);
        if (keyResult.IsFailure)
            return LibraryErrors.InvalidKey;
        if (request.Semitones is < -12 or > 12)
            return LibraryErrors.InvalidTransposition;

        var key = keyResult.Value;
        var newKey = new MusicalKey(((key.TonicPitchClass + request.Semitones) % 12 + 12) % 12, key.Mode, key.Confidence);

        List<NoteEvent> notes = request.Notes.Select(n => new NoteEvent
        {
            PitchMidi = Math.Clamp(n.PitchMidi + request.Semitones, 0, 127),
            StartBeat = n.StartBeat,
            DurationBeats = n.DurBeats,
            Confidence = n.Conf
        }).ToList();
        var parts = PartNotes.FromDtos(request.Parts)?
            .ToDictionary(kv => kv.Key, kv => kv.Value
                .Select(n => n with { PitchMidi = Math.Clamp(n.PitchMidi + request.Semitones, 0, 127) }).ToList());
        var chords = SheetChords.FromDtos(request.Chords)?.Select(c => c.Shift(request.Semitones)).ToList();

        string musicXml;
        string? partsMusicXml;
        try
        {
            musicXml = string.IsNullOrWhiteSpace(request.MusicXml)
                ? request.MusicXml
                : MusicXmlTransposer.Transpose(request.MusicXml, request.Semitones, newKey);
            partsMusicXml = string.IsNullOrWhiteSpace(request.PartsMusicXml)
                ? request.PartsMusicXml
                : MusicXmlTransposer.Transpose(request.PartsMusicXml!, request.Semitones, newKey);
        }
        catch (XmlException)
        {
            return LibraryErrors.InvalidScore;
        }

        return new TransposedSheetDto(
            newKey.ToString(),
            SolfaLabels.Label(notes, newKey),
            musicXml,
            SolfaLabels.LabelParts(parts, newKey, notes),
            partsMusicXml,
            ChordLabels.Label(chords, newKey));
    }
}
