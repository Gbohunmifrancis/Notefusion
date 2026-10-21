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
    public void Doh_header_is_spelled_like_the_key_signature()
    {
        // Bb major is written with two flats; "A#" would be ten sharps no choir reads.
        Assert.Equal("Doh is Bb", new MusicalKey(10, KeyMode.Major).DohHeader());
        Assert.Equal("Doh is Bb", new MusicalKey(7, KeyMode.Minor).DohHeader()); // G minor, la-based
        Assert.Equal("Doh is Db", new MusicalKey(1, KeyMode.Major).DohHeader());
        Assert.Equal("Doh is Eb", new MusicalKey(3, KeyMode.Major).DohHeader());
        Assert.Equal("Doh is Ab", new MusicalKey(8, KeyMode.Major).DohHeader());
        Assert.Equal("Doh is F#", new MusicalKey(6, KeyMode.Major).DohHeader());
    }

    [Fact]
    public void Key_name_is_spelled_like_the_key_signature_and_reads_back()
    {
        // A saved Bb hymn, or one transposed into Eb, must not come back as "A# major" / "D# major".
        string[] major = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
        string[] minor = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
        for (var pc = 0; pc < 12; pc++)
        {
            Assert.Equal($"{major[pc]} major", new MusicalKey(pc, KeyMode.Major).ToString());
            Assert.Equal($"{minor[pc]} minor", new MusicalKey(pc, KeyMode.Minor).ToString());
            foreach (var mode in new[] { KeyMode.Major, KeyMode.Minor })
            {
                var back = KeyParser.Parse(new MusicalKey(pc, mode).ToString());
                Assert.True(back.IsSuccess);
                Assert.Equal(pc, back.Value.TonicPitchClass);
                Assert.Equal(mode, back.Value.Mode);
            }
        }
    }

    [Fact]
    public void Rejects_out_of_range_tonic()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new MusicalKey(12, KeyMode.Major));
    }
}
