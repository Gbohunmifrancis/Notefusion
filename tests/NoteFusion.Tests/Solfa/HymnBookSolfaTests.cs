using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Solfa;

/// <summary>
/// The hymn-book conventions, end to end: a tune's pitches in, its solfa with octave marks out.
/// This table is the lock-step contract — the same rows, with the same expected strings, are in
/// server/tests/test_solfa.py, mobile/src/lib/solfa.test.ts and web-site/tests/choir.test.mjs.
/// Change one and you change all four.
/// </summary>
public class HymnBookSolfaTests
{
    public static TheoryData<string, int[], string> Cases => new()
    {
        // A chromatic is named for where it goes: a semitone up is sharpened, a semitone down flattened.
        { "C major", [60, 61, 62], "d de r" },
        { "C major", [62, 61, 60], "r ra d" },
        { "C major", [60, 61, 60], "d ra d" },     // upper neighbour: it falls back, so ra
        { "C major", [64, 63, 64], "m re m" },     // lower neighbour: it rises back, so re
        { "C major", [67, 66, 67], "s fe s" },
        { "C major", [69, 68, 69], "l se l" },
        { "C major", [69, 70, 69], "l ta l" },
        { "C major", [71, 70, 69], "t ta l" },
        { "C major", [67, 68, 67], "s la s" },
        // Anything else — the last note, a leap, a tone — takes the default: de ma fe se ta.
        { "C major", [60, 61], "d de" },
        { "C major", [62, 63], "r ma" },
        { "C major", [65, 66], "f fe" },
        { "C major", [67, 68], "s se" },
        { "C major", [71, 70], "t ta" },
        { "C major", [60, 66, 60], "d fe d" },
        { "C major", [67, 70, 67], "s ta s" },
        { "C major", [72, 68, 65], "d' se f" },
        { "C major", [63, 65], "ma f" },
        { "C major", [70, 72], "ta d'" },
        { "C major", [61, 59], "de t," },
        { "C major", [66, 64], "fe m" },
        { "C major", [62, 61, 61, 60], "r ra ra d" },
        { "C major", [62, 61, 61, 62], "r de de r" },
        // The held hymns' bars, as the books print them.
        { "F major", [67, 66, 67, 69, 70, 67], "r de r m f r" },  // What a Friend, bar 9
        { "Db major", [70, 68, 67, 68], "l s fe s" },              // It Is Well, bar 7
        { "D major", [68, 66, 64, 69, 74], "fe m r s d'" },        // Crown Him, bar 6
        { "G major", [76, 74, 73, 74], "l s fe s" },               // All Hail, bar 9
        { "C major", [72, 67, 69, 66, 67], "d' s l fe s" },        // O God Our Help, bar 4
        { "D major", [71, 68, 69, 71, 69, 68, 69], "l fe s l s fe s" }, // Thine Be the Glory, bars 14-15
        // La-based minor: se stays the leading note to lah, fe the melodic minor's raised fah.
        { "A minor", [69, 71, 72, 74, 76, 77, 80, 81, 80, 77, 76], "l, t, d r m f se l se f m" },
        { "A minor", [76, 78, 80, 81], "m fe se l" },
        // The unmarked octave starts at the doh at or below the middle note.
        { "D major", [62, 62, 66, 66, 69, 69, 71, 71, 71, 69, 66], "d d m m s s l l l s m" }, // Holy, Holy, Holy
        { "G major", [62, 67, 71, 67, 71, 69, 67, 64, 62], "s, d m d m r d l, s," },        // Amazing Grace
        { "C major", [67, 64, 69, 67, 72, 72, 71, 72], "s m l s d' d' t d'" },               // St Anne
        { "Bb major", [65, 67, 65, 62], "s l s m" },                                         // Silent Night
        // ...and in a minor key, at the doh at or below a minor third above it: lah stays under doh.
        { "A minor", [57, 59, 60, 59, 57, 56, 57], "l, t, d t, l, se, l," },
        { "A minor", [57, 59, 60, 62, 64, 62, 60, 59, 57], "l, t, d r m r d t, l," },
    };

    [Theory]
    [MemberData(nameof(Cases))]
    public void A_tune_reads_as_a_tonic_solfa_hymn_book_prints_it(string keyText, int[] pitches, string expected)
    {
        var key = KeyParser.Parse(keyText).Value;
        int referenceDoh = SolfaMapper.ReferenceDoh(pitches, key.DohPitchClass, key.Mode);
        bool[] sharp = SolfaMapper.AscendingFlags(pitches, key.DohPitchClass);

        string actual = string.Join(' ', pitches.Select((p, i) =>
        {
            var s = SolfaMapper.Map(p, key, referenceDoh, sharp[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
            return s.Text + s.OctaveMark;
        }));

        Assert.Equal(expected, actual);
    }
}
