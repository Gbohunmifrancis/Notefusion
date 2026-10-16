using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Solfa;

/// <summary>
/// Which chromatic syllable set to use for a non-diatonic note (TRD §4.2).
/// Chosen from where the note goes by <see cref="SolfaMapper.AscendingFlags"/>, not from a
/// user setting: regional conventions do vary, but a per-user override would let the same
/// transcription read differently on two devices, and the wire format carries the syllable
/// as a string.
/// </summary>
public enum ChromaticSpelling
{
    /// <summary>Sharpened degrees: de re fe se le. What a chromatic rising a semitone takes.</summary>
    Ascending = 0,

    /// <summary>Flattened degrees: ra ma sa la ta. What a chromatic falling a semitone takes.</summary>
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
    /// The name a tonic solfa hymn book gives each semitone above doh when the note does not
    /// move on by a semitone (a leap, a tone, the last note): de, ma, fe, se, ta. True means the
    /// sharpened name. Diatonic entries are unobservable (both tables agree there).
    /// <para>
    /// de over ra: the raised doh of V/ii and the major tonic chord in a minor key. ma over re:
    /// the flattened me of a chord borrowed from the minor and of a blue note; a raised re leading to me rises a
    /// semitone and is named by that. fe over sa: the raised fah of V/V and the melodic minor,
    /// by far the commonest accidental in hymns. se over la: the leading note of a minor key
    /// (to lah) and of V/vi. ta over le: the flat seventh of V/IV. Each default is also the
    /// name that keeps a tone step a step: ma–f, ta–d', de–t, fe–m.
    /// </para>
    /// </summary>
    private static readonly bool[] DefaultSharp =
        [true, true, true, false, true, true, true, true, true, true, false, true];

    /// <summary>
    /// Which chromatic table each note is spelled from — the tonic solfa hymn-book rule.
    /// Mirrors solfa.py's <c>ascending_flags</c>, mobile solfa.ts's <c>ascendingFlags</c> and
    /// web choir.js's <c>ascendingFlags</c>.
    /// <para>
    /// A chromatic note is named for where it goes, not where it came from: one that rises a
    /// semitone to the next note is a sharpened degree (de re fe se le — it leads up into that
    /// note); one that falls a semitone is a flattened degree (ra ma sa la ta). Anything else —
    /// a tone, a leap, the last note — takes the name hymn books print for that pitch in the
    /// key (<see cref="DefaultSharp"/>: de ma fe se ta). So "d de r" and "r ra d", but a lower
    /// neighbour "r de r" and an upper one "d ra d"; and "l, se, l," keeps the leading note in a
    /// la-based minor whichever side it is reached from.
    /// </para>
    /// <para>
    /// Equal neighbours are one run and share a flag, read from the next <em>differing</em>
    /// pitch: a chromatic sung twice must not be spelled <c>ra</c> then <c>de</c>.
    /// </para>
    /// <para>
    /// Only the five chromatic semitones {1, 3, 6, 8, 10} can be affected — the two tables
    /// agree on all seven diatonic degrees, so a diatonic note's flag is unobservable.
    /// </para>
    /// </summary>
    /// <param name="pitches">
    /// MIDI pitches in melodic (time) order. This is a statement about a note's position in
    /// the tune, not about the note in isolation, so the caller owns the ordering — a note
    /// list read back out of the database is not necessarily in start-beat order.
    /// </param>
    /// <param name="dohPitchClass">Doh for the current key (la-based for minor).</param>
    public static bool[] AscendingFlags(IReadOnlyList<int> pitches, int dohPitchClass)
    {
        Guard.NotNull(pitches);
        Guard.InRange(dohPitchClass, 0, 11);

        bool[] flags = new bool[pitches.Count];
        int start = 0;
        while (start < pitches.Count)
        {
            int end = start; // last index of the run of pitches equal to pitches[start]
            while (end + 1 < pitches.Count && pitches[end + 1] == pitches[start])
                end++;

            int step = end + 1 < pitches.Count ? pitches[end + 1] - pitches[start] : 0;
            bool flag = step switch
            {
                1 => true,
                -1 => false,
                _ => DefaultSharp[((pitches[start] - dohPitchClass) % 12 + 12) % 12]
            };

            for (int i = start; i <= end; i++)
                flags[i] = flag;

            start = end + 1;
        }

        return flags;
    }

    /// <summary>
    /// The unmarked doh — the register every octave mark is measured from, as a tonic solfa
    /// hymn book sets it: the doh at or below the melody's middle (median) note, so a tune that
    /// sits between doh and soh prints with no marks (Holy, Holy, Holy: d d m m s s) and only
    /// what lies under its doh takes a comma (Amazing Grace: s, d m d m r d l, s,). In a
    /// la-based minor key the middle note is first raised a minor third — lah's distance below
    /// doh — so a minor tune centred on its lah keeps that lah under an unmarked doh (l, t, d)
    /// instead of pushing the doh up an octave. Mirrors solfa.py's reference_doh so a note
    /// labelled by the worker and the same note re-labelled here land in the same octave.
    /// </summary>
    /// <param name="pitches">The piece's MIDI pitches. Empty is read as a middle note of middle C.</param>
    /// <param name="dohPitchClass">Doh for the current key (la-based for minor).</param>
    /// <param name="mode">The key's mode; minor raises the middle note by three semitones.</param>
    public static int ReferenceDoh(IReadOnlyList<int> pitches, int dohPitchClass, KeyMode mode)
    {
        Guard.NotNull(pitches);
        Guard.InRange(dohPitchClass, 0, 11);

        double middle = (pitches.Count == 0 ? 60.0 : Median(pitches)) + (mode == KeyMode.Minor ? 3 : 0);

        int reference = (int)Math.Floor((middle - dohPitchClass) / 12.0) * 12 + dohPitchClass;
        while (reference > 127) reference -= 12;
        while (reference < 0) reference += 12;
        return reference;
    }

    private static double Median(IReadOnlyList<int> pitches)
    {
        int[] sorted = [.. pitches.Order()];
        int mid = sorted.Length / 2;
        return sorted.Length % 2 == 1
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2.0;
    }

    /// <summary>The bare syllable (no octave mark) for a note this many semitones above doh.</summary>
    public static string Syllable(int semitonesFromDoh, ChromaticSpelling spelling)
    {
        Guard.InRange(semitonesFromDoh, 0, 11);

        return spelling == ChromaticSpelling.Ascending
            ? AscendingSyllables[semitonesFromDoh]
            : DescendingSyllables[semitonesFromDoh];
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
    /// MIDI pitch of the unmarked doh register for this piece (<see cref="ReferenceDoh"/>).
    /// Notes in higher/lower octaves get ' / ₁ marks relative to it.
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
