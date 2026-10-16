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
    // The same cases are asserted in server/tests/test_solfa.py.

    [Theory]
    [InlineData(new[] { 60, 64, 67 }, 0, 60)]
    [InlineData(new[] { 48, 55, 60, 67, 72, 79 }, 0, 60)]
    [InlineData(new[] { 36, 38, 40 }, 0, 36)]
    [InlineData(new[] { 84, 86, 88 }, 0, 84)]
    [InlineData(new[] { 60 }, 5, 53)]                 // F3: the doh at or below, not the nearer F4
    [InlineData(new[] { 62, 66, 69, 71 }, 2, 62)]     // a tune around soh keeps its doh below it
    [InlineData(new[] { 64, 67, 69, 71, 72 }, 0, 60)] // middle note t: still the doh below
    public void Reference_doh_is_the_doh_at_or_below_the_middle_note(int[] pitches, int dohPitchClass, int expected)
    {
        Assert.Equal(expected, SolfaMapper.ReferenceDoh(pitches, dohPitchClass, KeyMode.Major));
    }

    [Theory]
    [InlineData(new[] { 57, 59, 60, 59, 57, 56, 57 }, 60)] // centred on lah: l, t, d under doh C4
    [InlineData(new[] { 60, 62, 64, 62, 60 }, 60)]         // centred on doh: as in major
    [InlineData(new[] { 69, 71, 72, 74, 76 }, 72)]         // l, t, d r m an octave up
    public void A_minor_tune_centred_on_its_lah_keeps_the_lah_under_doh(int[] pitches, int expected)
    {
        Assert.Equal(expected, SolfaMapper.ReferenceDoh(pitches, 0, KeyMode.Minor)); // A minor, doh C
    }

    [Fact]
    public void Reference_doh_reads_an_empty_tune_as_middle_c()
    {
        // An empty saved transcription is mapped on every read, so this path is defined.
        Assert.Equal(60, SolfaMapper.ReferenceDoh([], 0, KeyMode.Major));
        Assert.Equal(53, SolfaMapper.ReferenceDoh([], 5, KeyMode.Major));
        Assert.Equal(60, SolfaMapper.ReferenceDoh([], 0, KeyMode.Minor));
    }

    [Fact]
    public void Reference_doh_stays_on_the_midi_range()
    {
        Assert.Equal(120, SolfaMapper.ReferenceDoh([127], 0, KeyMode.Minor)); // 132 would be off the top
        Assert.Equal(10, SolfaMapper.ReferenceDoh([3], 10, KeyMode.Major));   // -2 would be off the bottom
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

    // ── AscendingFlags — the hymn-book rule, mirrored case for case ────────────
    // Every case below is asserted with the same pitches and the same expectation in
    // server/tests/test_solfa.py. A divergence here means a saved transcription reads
    // one way from the worker and another from the library endpoint.

    [Fact]
    public void A_chromatic_rising_a_semitone_is_spelled_sharp()
    {
        bool[] flags = SolfaMapper.AscendingFlags([60, 61, 62], 0); // C C# D

        Assert.True(flags[1]);
        Assert.Equal("de", SolfaMapper.Map(61, CMajor, MiddleCDoh, ChromaticSpelling.Ascending).Text);
    }

    [Fact]
    public void A_chromatic_falling_a_semitone_is_spelled_flat()
    {
        bool[] flags = SolfaMapper.AscendingFlags([62, 61, 60], 0); // D Db C

        Assert.False(flags[1]);
        Assert.Equal("ra", SolfaMapper.Map(61, CMajor, MiddleCDoh, ChromaticSpelling.Descending).Text);
    }

    [Fact]
    public void The_spelling_comes_from_where_the_note_goes_not_where_it_came_from()
    {
        // C Db C — an upper neighbour of doh falls back to it, so it is a lowered ray (ra).
        Assert.False(SolfaMapper.AscendingFlags([60, 61, 60], 0)[1]);
        // E D# E — a lower neighbour of me rises back, so it is a raised ray (re).
        Assert.True(SolfaMapper.AscendingFlags([64, 63, 64], 0)[1]);
        // What a Friend bar 9 (F major, G F# G): reached from above, rising back to ray — de,
        // as the book prints, where the old approach rule printed ra.
        Assert.True(SolfaMapper.AscendingFlags([67, 66, 67], 5)[1]);
    }

    [Theory]
    [InlineData(61, true)]  // de, not ra
    [InlineData(63, false)] // ma, not re
    [InlineData(66, true)]  // fe, not sa
    [InlineData(68, true)]  // se, not la
    [InlineData(70, false)] // ta, not le
    public void A_note_that_does_not_move_a_semitone_takes_the_hymn_book_default(int pitch, bool sharp)
    {
        Assert.Equal([sharp], SolfaMapper.AscendingFlags([pitch], 0));                   // the last note
        Assert.Equal([sharp, sharp], SolfaMapper.AscendingFlags([pitch, pitch], 0));     // repeated, then nothing
        Assert.Equal(sharp, SolfaMapper.AscendingFlags([pitch, pitch + 5], 0)[0]);       // a leap up
        Assert.Equal(sharp, SolfaMapper.AscendingFlags([pitch, pitch - 4], 0)[0]);       // a leap down
    }

    [Theory]
    [InlineData(63, 65, "ma")] // up a tone to fah: Eb-F, a step, where D#-F would be a third
    [InlineData(70, 72, "ta")] // up a tone to doh: Bb-C
    [InlineData(61, 59, "de")] // down a tone to te: C#-B
    [InlineData(66, 64, "fe")] // down a tone to me: F#-E (Crown Him bars 6 and 11)
    public void A_tone_step_to_a_scale_note_keeps_the_default_which_keeps_it_a_step(int pitch, int next, string expected)
    {
        bool flag = SolfaMapper.AscendingFlags([pitch, next], 0)[0];

        Assert.Equal(expected, SolfaMapper.Map(pitch, CMajor, MiddleCDoh,
            flag ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending).Text);
    }

    [Fact]
    public void The_defaults_are_read_from_doh_not_from_c()
    {
        // In G major (doh G) F natural is the flattened te: ta, the default for that degree.
        Assert.False(SolfaMapper.AscendingFlags([65], 7)[0]);
        // And C# is the raised fah: fe.
        Assert.True(SolfaMapper.AscendingFlags([61], 7)[0]);
    }

    [Fact]
    public void An_empty_melody_has_no_flags()
    {
        Assert.Empty(SolfaMapper.AscendingFlags([], 0));
    }

    [Fact]
    public void A_repeated_chromatic_keeps_one_spelling()
    {
        // D Db Db C and D C# C# D: the run reads the note after it, so one sung pitch is
        // never printed "ra de".
        Assert.Equal([false, false], SolfaMapper.AscendingFlags([62, 61, 61, 60], 0)[1..3]);
        Assert.Equal([true, true], SolfaMapper.AscendingFlags([62, 61, 61, 62], 0)[1..3]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(7)]
    [InlineData(9)]
    [InlineData(11)]
    public void Direction_cannot_change_a_diatonic_syllable(int semitone)
    {
        // The two tables are identical on all seven diatonic degrees, which is what
        // makes directional spelling unable to touch a note that prints no accidental.
        var up = SolfaMapper.Map(60 + semitone, CMajor, MiddleCDoh, ChromaticSpelling.Ascending);
        var down = SolfaMapper.Map(60 + semitone, CMajor, MiddleCDoh, ChromaticSpelling.Descending);

        Assert.Equal(up.Text, down.Text);
    }

    [Theory]
    [InlineData(1, "de", "ra")]
    [InlineData(3, "re", "ma")]
    [InlineData(6, "fe", "sa")]
    [InlineData(8, "se", "la")]
    [InlineData(10, "le", "ta")]
    public void Every_chromatic_degree_has_both_spellings(int semitone, string up, string down)
    {
        // Degree needs no equivalent assertion here: Degree() takes no spelling, so in
        // this tier re-spelling structurally cannot move it. solfa.py returns both from
        // one call, which is why the Python mirror of this test asserts it.
        Assert.Equal(up, SolfaMapper.Map(60 + semitone, CMajor, MiddleCDoh, ChromaticSpelling.Ascending).Text);
        Assert.Equal(down, SolfaMapper.Map(60 + semitone, CMajor, MiddleCDoh, ChromaticSpelling.Descending).Text);
    }

    [Fact]
    public void Direction_does_not_move_the_octave_mark()
    {
        var up = SolfaMapper.Map(73, CMajor, MiddleCDoh, ChromaticSpelling.Ascending);
        var down = SolfaMapper.Map(73, CMajor, MiddleCDoh, ChromaticSpelling.Descending);

        Assert.Equal("'", up.OctaveMark);
        Assert.Equal(up.OctaveMark, down.OctaveMark);
    }
}
