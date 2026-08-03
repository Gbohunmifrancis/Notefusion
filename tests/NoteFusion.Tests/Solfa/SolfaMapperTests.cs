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
}
