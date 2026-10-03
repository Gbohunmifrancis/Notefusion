namespace NoteFusion.Core.Entities;

/// <summary>
/// One chord heard under the tune, over a run of beats. Stored as pitch classes only, like
/// <see cref="NoteEvent"/> stores pitches: its letter name and solfa are derived from the key on
/// every read (<see cref="Solfa.ChordSpeller"/>), so a key override re-labels it and a transpose
/// respells it.
/// </summary>
public sealed record ChordEvent
{
    public required double StartBeat { get; init; }

    public required double DurationBeats { get; init; }

    /// <summary>Pitch class of the root, 0 = C … 11 = B.</summary>
    public required int Root { get; init; }

    /// <summary>One of <see cref="Solfa.ChordSpeller.Qualities"/>: maj, min, 7, maj7, min7, dim, sus4.</summary>
    public required string Quality { get; init; }

    /// <summary>Pitch class of the bass when it is not the root (an inversion, written as a slash chord); null otherwise.</summary>
    public int? Bass { get; init; }

    /// <summary>The same chord <paramref name="semitones"/> higher (or lower), root and bass alike.</summary>
    public ChordEvent Shift(int semitones)
        => this with { Root = Mod12(Root + semitones), Bass = Bass is { } bass ? Mod12(bass + semitones) : null };

    private static int Mod12(int value) => (value % 12 + 12) % 12;
}
