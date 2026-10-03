using FluentValidation;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Library.Commands;

/// <summary>Wire chords to stored chords: pitch classes and timing only, never the symbol or solfa the client sent.</summary>
internal static class SheetChords
{
    public static List<ChordEvent>? FromDtos(IReadOnlyList<ChordSymbolDto>? chords)
    {
        if (chords is null || chords.Count == 0) return null;
        return [.. chords.Select(c => new ChordEvent
        {
            StartBeat = c.StartBeat,
            DurationBeats = c.DurBeats,
            Root = c.Root,
            Quality = c.Quality,
            // A bass on the root is no slash chord.
            Bass = c.Bass == c.Root ? null : c.Bass
        })];
    }
}

/// <summary>One chord a client sends back with a sheet: a pitch class root, a known quality and a place in time.</summary>
public sealed class ChordSymbolDtoValidator : AbstractValidator<ChordSymbolDto>
{
    private const string Unreadable = "One of the chords on this sheet could not be read. Please transcribe the song again.";

    public ChordSymbolDtoValidator()
    {
        RuleFor(c => c.Root).InclusiveBetween(0, 11).WithMessage(Unreadable);
        RuleFor(c => c.Bass).InclusiveBetween(0, 11).When(c => c.Bass is not null).WithMessage(Unreadable);
        RuleFor(c => c.Quality).Must(ChordSpeller.IsQuality).WithMessage(Unreadable);
        RuleFor(c => c.StartBeat).GreaterThanOrEqualTo(0).WithMessage(Unreadable);
        RuleFor(c => c.DurBeats).GreaterThanOrEqualTo(0).WithMessage(Unreadable);
    }
}
