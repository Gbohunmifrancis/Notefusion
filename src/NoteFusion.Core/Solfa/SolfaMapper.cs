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

    /// <summary>
    /// The octave mark alone, in the wire format the Python worker emits (' above,
    /// , below) and the mobile client re-derives locally. Deliberately not the '₁'
    /// of <see cref="ToString"/>: that is a display convention, this is the contract
    /// clients string-compare against, so both ends must agree character for character.
    /// </summary>
    public string OctaveMark => OctaveShift switch
    {
        > 0 => new string('\'', OctaveShift),
        < 0 => new string(',', -OctaveShift),
        _ => string.Empty
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

    /// <summary>Diatonic degree for each semitone above doh (ascending/sharp convention).</summary>
    private static readonly int[] SemitoneToDegree = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7];

    /// <summary>
    /// The doh octave nearest the melody's median — the unmarked register every octave
    /// mark is measured from. Mirrors solfa.py's reference_doh so a note labelled by the
    /// worker and the same note re-labelled here land in the same octave.
    /// </summary>
    /// <param name="pitches">The piece's MIDI pitches. Empty falls back to the doh nearest middle C.</param>
    /// <param name="dohPitchClass">Doh for the current key (la-based for minor).</param>
    public static int ReferenceDoh(IReadOnlyList<int> pitches, int dohPitchClass)
    {
        Guard.InRange(dohPitchClass, 0, 11);

        double median = pitches.Count == 0
            ? 60.0
            : Median(pitches);

        int best = dohPitchClass;
        for (int p = dohPitchClass; p < 128; p += 12)
        {
            if (Math.Abs(p - median) < Math.Abs(best - median))
                best = p;
        }

        return best;
    }

    private static double Median(IReadOnlyList<int> pitches)
    {
        int[] sorted = [.. pitches.Order()];
        int mid = sorted.Length / 2;
        return sorted.Length % 2 == 1
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2.0;
    }

    /// <summary>The diatonic degree (1–7) a pitch sounds in the given key.</summary>
    public static int Degree(int pitchMidi, MusicalKey key)
    {
        Guard.InRange(pitchMidi, 0, 127);
        Guard.NotNull(key);

        return SemitoneToDegree[((pitchMidi - key.DohPitchClass) % 12 + 12) % 12];
    }

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
