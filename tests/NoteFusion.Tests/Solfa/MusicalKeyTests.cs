using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Solfa;

public class MusicalKeyTests
{
    [Fact]
    public void Relative_key_round_trips_between_major_and_minor()
    {
        var cMajor = new MusicalKey(0, KeyMode.Major);

        var aMinor = cMajor.RelativeKey();
        var backToC = aMinor.RelativeKey();

        Assert.Equal(9, aMinor.TonicPitchClass);
        Assert.Equal(KeyMode.Minor, aMinor.Mode);
        Assert.Equal(cMajor, backToC);
    }

    [Fact]
    public void Relative_major_and_minor_share_the_same_doh()
    {
        var fMajor = new MusicalKey(5, KeyMode.Major);
        var dMinor = fMajor.RelativeKey();

        Assert.Equal(fMajor.DohPitchClass, dMinor.DohPitchClass);
        Assert.Equal("Doh is F", dMinor.DohHeader());
    }

    [Fact]
    public void Rejects_out_of_range_tonic()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new MusicalKey(12, KeyMode.Major));
    }
}
