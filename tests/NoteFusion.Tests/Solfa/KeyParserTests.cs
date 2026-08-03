using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Solfa;

/// <summary>
/// Covers every accepted spelling and every rejection path of <see cref="KeyParser"/> — it feeds both
/// the user's "set Doh" override and the ML service's detected-key string, so a wrong parse silently
/// mislabels the whole piece.
/// </summary>
public class KeyParserTests
{
    [Theory]
    [InlineData("C", 0, KeyMode.Major)]
    [InlineData("c", 0, KeyMode.Major)]
    [InlineData("D", 2, KeyMode.Major)]
    [InlineData("E", 4, KeyMode.Major)]
    [InlineData("F", 5, KeyMode.Major)]
    [InlineData("G", 7, KeyMode.Major)]
    [InlineData("A", 9, KeyMode.Major)]
    [InlineData("B", 11, KeyMode.Major)]
    public void Parses_bare_note_letters_as_major(string text, int pitchClass, KeyMode mode)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess);
        Assert.Equal(pitchClass, result.Value.TonicPitchClass);
        Assert.Equal(mode, result.Value.Mode);
    }

    [Theory]
    [InlineData("C#", 1)]
    [InlineData("C♯", 1)]
    [InlineData("Db", 1)]
    [InlineData("D♭", 1)]
    [InlineData("F#", 6)]
    [InlineData("Gb", 6)]
    [InlineData("B#", 0)]  // wraps above B
    [InlineData("Cb", 11)] // wraps below C
    public void Applies_accidentals_with_wraparound(string text, int expectedPitchClass)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess);
        Assert.Equal(expectedPitchClass, result.Value.TonicPitchClass);
    }

    [Theory]
    [InlineData("Am", 9)]
    [InlineData("A minor", 9)]
    [InlineData("A min", 9)]
    [InlineData("F# minor", 6)]
    [InlineData("Ebm", 3)]
    public void Parses_minor_mode_suffixes(string text, int expectedPitchClass)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess);
        Assert.Equal(expectedPitchClass, result.Value.TonicPitchClass);
        Assert.Equal(KeyMode.Minor, result.Value.Mode);
    }

    [Theory]
    [InlineData("C major")]
    [InlineData("C maj")]
    [InlineData("Bb major")]
    public void Parses_explicit_major_mode(string text)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess);
        Assert.Equal(KeyMode.Major, result.Value.Mode);
    }

    [Fact]
    public void Minor_suffix_is_not_greedily_read_off_a_bare_letter()
    {
        // "m" alone would leave an empty note — must be rejected, not read as "minor of nothing".
        var result = KeyParser.Parse("m");

        Assert.True(result.IsFailure);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("H")]      // not a note letter
    [InlineData("Cx")]     // unknown accidental char
    [InlineData("123")]
    public void Rejects_invalid_input(string? text)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsFailure);
        Assert.Equal("KEY_INVALID", result.Error.Code);
    }

    [Fact]
    public void Cancelling_accidentals_net_to_the_natural()
    {
        // "#" then "b" are both valid accidental chars and cancel: C#b == C.
        var result = KeyParser.Parse("C#b");

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.TonicPitchClass);
    }

    [Fact]
    public void Carries_supplied_confidence_onto_the_key()
    {
        var result = KeyParser.Parse("G", confidence: 0.42);

        Assert.True(result.IsSuccess);
        Assert.Equal(0.42, result.Value.Confidence, precision: 5);
    }
}
