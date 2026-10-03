using NoteFusion.Core.Entities;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Solfa;

/// <summary>
/// Chord names and solfa, mirrored from the worker's <c>chords.label</c>. Movable-do: the root's syllable
/// is measured from doh, so a transpose respells the symbol and leaves the syllable alone, and a key
/// override changes the syllable without touching the chord.
/// </summary>
public class ChordSpellerTests
{
    private static readonly MusicalKey FMajor = new(5, KeyMode.Major);
    private static readonly MusicalKey CMajor = new(0, KeyMode.Major);

    [Theory]
    [InlineData(5, "maj", null, "F", "d")]
    [InlineData(2, "min", null, "Dm", "l")]
    [InlineData(7, "min", null, "Gm", "r")]
    [InlineData(7, "maj", null, "G", "r")]     // the major chord on ray: same syllable, another quality
    [InlineData(10, "maj", null, "Bb", "f")]   // diatonic roots take the key's own spelling
    [InlineData(0, "7", null, "C7", "s")]
    [InlineData(9, "min7", null, "Am7", "m")]
    [InlineData(5, "maj7", null, "Fmaj7", "d")]
    [InlineData(10, "sus4", null, "Bbsus4", "f")]
    [InlineData(4, "dim", null, "Edim", "t")]
    [InlineData(3, "maj", null, "Eb", "ta")]   // a chromatic root is the degree above, lowered
    [InlineData(7, "maj", 11, "G/B", "r")]     // a slash chord's bass is spelled from the root's letter
    [InlineData(5, "maj", 0, "F/C", "d")]
    public void Chords_in_F_major_are_named_from_its_letters(int root, string quality, int? bass, string symbol, string solfa)
        => Assert.Equal((symbol, solfa), ChordSpeller.Label(root, quality, bass, FMajor));

    [Theory]
    [InlineData(8, "maj", "Ab", "la")]
    [InlineData(10, "7", "Bb7", "ta")]
    [InlineData(1, "maj", "Db", "ra")]
    [InlineData(6, "dim", "F#dim", "fe")]      // a diminished chord is the leading-tone chord: the degree below, raised
    [InlineData(1, "dim", "C#dim", "de")]
    [InlineData(8, "dim", "G#dim", "se")]
    public void A_chromatic_root_takes_a_flattened_degree_unless_the_chord_is_diminished(int root, string quality, string symbol, string solfa)
        => Assert.Equal((symbol, solfa), ChordSpeller.Label(root, quality, null, CMajor));

    [Fact]
    public void A_minor_key_is_named_from_its_relative_majors_doh()
    {
        var dMinor = new MusicalKey(2, KeyMode.Minor);

        Assert.Equal(("Dm", "l"), ChordSpeller.Label(2, "min", null, dMinor));
        Assert.Equal(("A7", "m"), ChordSpeller.Label(9, "7", null, dMinor));
        Assert.Equal(("Bb", "f"), ChordSpeller.Label(10, "maj", null, dMinor));
    }

    [Theory]
    [InlineData(0, KeyMode.Major, "C")]
    [InlineData(1, KeyMode.Major, "Db")]
    [InlineData(6, KeyMode.Major, "F#")]
    [InlineData(10, KeyMode.Major, "Bb")]
    [InlineData(9, KeyMode.Minor, "C")]
    [InlineData(3, KeyMode.Minor, "Gb")]   // Eb minor, six flats
    [InlineData(8, KeyMode.Minor, "B")]    // G# minor
    [InlineData(1, KeyMode.Minor, "E")]    // C# minor
    [InlineData(10, KeyMode.Minor, "Db")]  // Bb minor
    public void Doh_is_spelled_with_the_fewest_accidentals(int tonic, KeyMode mode, string doh)
        => Assert.Equal(doh, ChordSpeller.DohName(new MusicalKey(tonic, mode)));

    [Fact]
    public void A_spelling_that_needs_a_double_accidental_falls_back_to_the_plain_name()
    {
        // In Db major the flat side of G is Abb; the plain name in a flat key is G.
        Assert.Equal(("G", "sa"), ChordSpeller.Label(7, "maj", null, new MusicalKey(1, KeyMode.Major)));
    }

    [Fact]
    public void Transposing_a_chord_respells_its_symbol_and_keeps_its_solfa()
    {
        var aMajor = new MusicalKey(9, KeyMode.Major);
        ChordEvent[] inF =
        [
            new() { StartBeat = 0, DurationBeats = 4, Root = 2, Quality = "min" },
            new() { StartBeat = 4, DurationBeats = 4, Root = 10, Quality = "maj" },
            new() { StartBeat = 8, DurationBeats = 4, Root = 7, Quality = "maj", Bass = 11 },
            new() { StartBeat = 12, DurationBeats = 4, Root = 0, Quality = "7" },
        ];

        var before = inF.Select(c => ChordSpeller.Label(c.Root, c.Quality, c.Bass, FMajor)).ToArray();
        var after = inF.Select(c => c.Shift(4)).Select(c => ChordSpeller.Label(c.Root, c.Quality, c.Bass, aMajor)).ToArray();

        Assert.Equal(["Dm", "Bb", "G/B", "C7"], before.Select(l => l.Symbol));
        Assert.Equal(["F#m", "D", "B/D#", "E7"], after.Select(l => l.Symbol));
        Assert.Equal(before.Select(l => l.Solfa), after.Select(l => l.Solfa));
    }

    [Fact]
    public void Shifting_wraps_round_the_octave_root_and_bass_alike()
    {
        var chord = new ChordEvent { StartBeat = 0, DurationBeats = 1, Root = 11, Quality = "maj", Bass = 3 };

        Assert.Equal((1, (int?)5), (chord.Shift(2).Root, chord.Shift(2).Bass));
        Assert.Equal((8, (int?)0), (chord.Shift(-3).Root, chord.Shift(-3).Bass));
        Assert.Null((chord with { Bass = null }).Shift(5).Bass);
    }

    [Fact]
    public void An_unknown_quality_is_a_programmer_error()
    {
        Assert.False(ChordSpeller.IsQuality("power"));
        Assert.Throws<ArgumentException>(() => ChordSpeller.Label(0, "power", null, CMajor));
    }

    [Fact]
    public void The_bare_syllable_comes_from_the_chromatic_table_asked_for()
    {
        Assert.Equal("ta", SolfaMapper.Syllable(10, ChromaticSpelling.Descending));
        Assert.Equal("le", SolfaMapper.Syllable(10, ChromaticSpelling.Ascending));
        Assert.Equal("s", SolfaMapper.Syllable(7, ChromaticSpelling.Descending));
    }
}
