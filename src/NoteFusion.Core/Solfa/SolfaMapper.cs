using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Solfa;

/// <summary>Which chromatic syllable set to use for a non-diatonic note (TRD §4.2).</summary>
public enum ChromaticSpelling
{
    /// <summary>Sharpened degrees: de re fe se le.</summary>
    Ascending = 0,

    /// <summary>Flattened degrees: ra ma sa la ta (regional conventions vary; configurable in settings).</summary>
    Descending = 1
}

/// <summary>A mapped solfa syllable with its octave register relative to the reference doh octave.</summary>
public sealed record SolfaSyllable(string Text, int OctaveShift)
{
    /// <summary>
    /// Rendered with octave ticks following common Nigerian choral practice:
    /// d' one octave above, d₁ one octave below (TRD §4.2).
    /// </summary>
    public override string ToString() => OctaveShift switch
    {
        > 0 => Text + new string('\'', OctaveShift),
        < 0 => Text + string.Concat(Enumerable.Repeat('₁', -OctaveShift)),
        _ => Text
    };
}

/// <summary>
/// Movable-do degree-to-syllable mapping — the solfa engine core (TRD §4).
/// Pure and stateless: a key change is a re-labelling, never a re-transcription.
/// </summary>
public static class SolfaMapper
{
    private static readonly string[] AscendingSyllables =
        ["d", "de", "r", "re", "m", "f", "fe", "s", "se", "l", "le", "t"];

    private static readonly string[] DescendingSyllables =
        ["d", "ra", "r", "ma", "m", "f", "sa", "s", "la", "l", "ta", "t"];

    /// <summary>
    /// Maps a MIDI pitch to its movable-do syllable in the given key.
    /// </summary>
    /// <param name="pitchMidi">MIDI note number (0–127).</param>
    /// <param name="key">Current key; doh is derived from it (la-based for minor).</param>
    /// <param name="referenceDohMidi">
    /// MIDI pitch of the unmarked doh register for this piece (typically the doh nearest the
    /// melody's median). Notes in higher/lower octaves get ' / ₁ marks relative to it.
    /// </param>
    /// <param name="spelling">Chromatic syllable set for non-diatonic notes.</param>
    public static SolfaSyllable Map(
        int pitchMidi,
        MusicalKey key,
        int referenceDohMidi,
        ChromaticSpelling spelling = ChromaticSpelling.Ascending)
    {
        Guard.InRange(pitchMidi, 0, 127);
        Guard.NotNull(key);
        Guard.InRange(referenceDohMidi, 0, 127);

        int semitonesFromDoh = ((pitchMidi - key.DohPitchClass) % 12 + 12) % 12;

        string[] table = spelling == ChromaticSpelling.Ascending
            ? AscendingSyllables
            : DescendingSyllables;

        // Octave register is measured from the reference doh, using the doh-based scale
        // position so that e.g. t just below d' stays in the unmarked octave.
        int octaveShift = (int)Math.Floor((pitchMidi - referenceDohMidi) / 12.0);

        return new SolfaSyllable(table[semitonesFromDoh], octaveShift);
    }
}
