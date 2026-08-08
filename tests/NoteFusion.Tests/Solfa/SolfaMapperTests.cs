using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Solfa;

public class SolfaMapperTests
{
    private static readonly MusicalKey CMajor = new(0, KeyMode.Major);
    private const int MiddleCDoh = 60; // C4 as the unmarked doh register

    [Theory]
    [InlineData(60, "d")] // C4 — doh
    [InlineData(62, "r")]
    [InlineData(64, "m")]
    [InlineData(65, "f")]
    [InlineData(67, "s")]
    [InlineData(69, "l")]
    [InlineData(71, "t")] // B4 — still the unmarked octave
    public void Maps_diatonic_degrees_in_major(int midi, string expected)
    {
        var syllable = SolfaMapper.Map(midi, CMajor, MiddleCDoh);

        Assert.Equal(expected, syllable.Text);
        Assert.Equal(0, syllable.OctaveShift);
    }

    [Fact]
    public void Sharpened_fourth_is_fe_when_ascending()
    {
        var syllable = SolfaMapper.Map(66, CMajor, MiddleCDoh); // F#4

        Assert.Equal("fe", syllable.Text);
    }

    [Fact]
    public void Flattened_fifth_is_sa_when_descending()
    {
        var syllable = SolfaMapper.Map(66, CMajor, MiddleCDoh, ChromaticSpelling.Descending); // Gb4

        Assert.Equal("sa", syllable.Text);
    }

    [Fact]
    public void Octave_above_reference_is_marked_with_tick()
    {
        var syllable = SolfaMapper.Map(72, CMajor, MiddleCDoh); // C5

        Assert.Equal("d", syllable.Text);
        Assert.Equal(1, syllable.OctaveShift);
        Assert.Equal("d'", syllable.ToString());
    }

    [Fact]
    public void Note_below_reference_doh_is_marked_subscript()
    {
        var syllable = SolfaMapper.Map(59, CMajor, MiddleCDoh); // B3

        Assert.Equal("t", syllable.Text);
        Assert.Equal(-1, syllable.OctaveShift);
        Assert.Equal("t₁", syllable.ToString());
    }

    [Fact]
    public void Minor_keys_use_la_based_doh()
    {
        var aMinor = new MusicalKey(9, KeyMode.Minor); // A minor → doh is C (relative major)

        var tonic = SolfaMapper.Map(69, aMinor, MiddleCDoh); // A4, the minor tonic

        Assert.Equal("l", tonic.Text);
        Assert.Equal("Doh is C", aMinor.DohHeader());
    }

    [Fact]
    public void Key_change_relabels_the_same_pitch()
    {
        var gMajor = new MusicalKey(7, KeyMode.Major);

        var inC = SolfaMapper.Map(67, CMajor, MiddleCDoh); // G4 in C major
        var inG = SolfaMapper.Map(67, gMajor, 67);         // G4 in G major

        Assert.Equal("s", inC.Text);
        Assert.Equal("d", inG.Text);
    }

    // ── Wire format ───────────────────────────────────────────────────────────
    // OctaveMark is what crosses the API boundary; ToString's '₁' is a display
    // convention. The Python worker emits ',' below, so a note it labelled and the
    // same note re-labelled here must produce the identical string.

    [Theory]
    [InlineData(72, "'")]    // C5 — one above
    [InlineData(84, "''")]   // C6 — two above
    [InlineData(60, "")]     // C4 — the unmarked register
    [InlineData(59, ",")]    // B3 — one below
    [InlineData(47, ",,")]   // B2 — two below
    public void Octave_mark_uses_the_python_wire_format(int midi, string expected)
    {
        Assert.Equal(expected, SolfaMapper.Map(midi, CMajor, MiddleCDoh).OctaveMark);
    }

    // ── ReferenceDoh ──────────────────────────────────────────────────────────
    // Expected values taken from solfa.reference_doh in server/app/pipeline/solfa.py.

    [Theory]
    [InlineData(new[] { 60, 64, 67 }, 0, 60)]
    [InlineData(new[] { 48, 55, 60, 67, 72, 79 }, 0, 60)]
    [InlineData(new[] { 36, 38, 40 }, 0, 36)]
    [InlineData(new[] { 84, 86, 88 }, 0, 84)]
    [InlineData(new[] { 60 }, 5, 65)] // 65 is nearer to 60 than 53 is
    public void Reference_doh_matches_the_python_engine(int[] pitches, int dohPitchClass, int expected)
    {
        Assert.Equal(expected, SolfaMapper.ReferenceDoh(pitches, dohPitchClass));
    }

    [Fact]
    public void Reference_doh_falls_back_to_the_doh_nearest_middle_c_when_there_are_no_pitches()
    {
        // Python takes a NaN median here and returns the first candidate by accident;
        // an empty note list never reaches its solfa stage. This path does get hit —
        // an empty saved transcription is mapped on every read — so it is defined.
        Assert.Equal(60, SolfaMapper.ReferenceDoh([], 0));
        Assert.Equal(65, SolfaMapper.ReferenceDoh([], 5));
    }

    // ── Degree ────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(60, 1)] // d
    [InlineData(61, 1)] // de — a raised first is still degree 1
    [InlineData(62, 2)]
    [InlineData(64, 3)]
    [InlineData(65, 4)]
    [InlineData(66, 4)] // fe
    [InlineData(67, 5)]
    [InlineData(69, 6)]
    [InlineData(71, 7)]
    [InlineData(72, 1)] // d' — octave-invariant
    public void Degree_matches_the_python_semitone_table(int midi, int expected)
    {
        Assert.Equal(expected, SolfaMapper.Degree(midi, CMajor));
    }

    [Fact]
    public void Degree_is_measured_from_doh_not_the_minor_tonic()
    {
        var aMinor = new MusicalKey(9, KeyMode.Minor); // doh is C

        Assert.Equal(6, SolfaMapper.Degree(69, aMinor)); // A4 is la — the sixth
        Assert.Equal(1, SolfaMapper.Degree(60, aMinor)); // C4 is doh
    }
}
