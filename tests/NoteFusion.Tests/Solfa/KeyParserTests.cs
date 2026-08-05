using NoteFusion.Core.Solfa;

namespace NoteFusion.Tests.Solfa;

/// <summary>
/// Covers every accepted spelling and every rejection path of <see cref="KeyParser"/>.
///
/// KeyParser feeds two distinct code paths:
///   1. The user's optional "set Doh before recording" override (mobile key picker).
///   2. The ML service's detected-key string returned by the Python worker.
///
/// Path 2 is the tricky one: music21 returns flat keys using a dash ("-") rather than
/// the conventional "b" (e.g. "B- major" for B♭ major, "E- minor" for E♭ minor).
/// It also returns minor-key tonics in lowercase ("a minor", "f# minor").
/// The Python pipeline normalises these before they reach C#, but KeyParser must also
/// accept them directly so that any key string stored in the library can be round-tripped
/// through re-key calls without returning HTTP 422.
/// </summary>
public class KeyParserTests
{
    // ── Bare note letters (default major) ────────────────────────────────────

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

    // ── Standard "b" / "♭" accidentals ──────────────────────────────────────

    [Theory]
    [InlineData("C#", 1)]
    [InlineData("C♯", 1)]
    [InlineData("Db", 1)]
    [InlineData("D♭", 1)]
    [InlineData("F#", 6)]
    [InlineData("Gb", 6)]
    [InlineData("Bb", 10)]
    [InlineData("Eb", 3)]
    [InlineData("Ab", 8)]
    [InlineData("B#", 0)]   // wraps above B → C
    [InlineData("Cb", 11)]  // wraps below C → B
    public void Applies_standard_accidentals_with_wraparound(string text, int expectedPitchClass)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess);
        Assert.Equal(expectedPitchClass, result.Value.TonicPitchClass);
    }

    // ── music21 dash-flat notation ("-") ─────────────────────────────────────
    //
    // music21 uses a trailing "-" for flats (e.g. "B-" = B♭, "E-" = E♭).
    // The Python pipeline normalises these before returning to C#, but KeyParser
    // must also accept them directly so library re-key calls never return 422
    // when an old detected-key string (pre-normalisation) is passed.

    [Theory]
    [InlineData("B-", 10, KeyMode.Major)]   // B♭
    [InlineData("E-", 3, KeyMode.Major)]   // E♭
    [InlineData("A-", 8, KeyMode.Major)]   // A♭
    [InlineData("D-", 1, KeyMode.Major)]   // D♭
    [InlineData("G-", 6, KeyMode.Major)]   // G♭
    [InlineData("C-", 11, KeyMode.Major)]   // C♭
    [InlineData("F-", 4, KeyMode.Major)]   // F♭  (enharmonic = E)
    [InlineData("B- major", 10, KeyMode.Major)]
    [InlineData("E- major", 3, KeyMode.Major)]
    [InlineData("E- minor", 3, KeyMode.Minor)]
    [InlineData("B- minor", 10, KeyMode.Minor)]
    [InlineData("b- major", 10, KeyMode.Major)]   // lowercase tonic (music21 minor style)
    [InlineData("e- minor", 3, KeyMode.Minor)]
    [InlineData("a- major", 8, KeyMode.Major)]
    public void Accepts_music21_dash_flat_notation(string text, int expectedPitchClass, KeyMode expectedMode)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess, $"Expected success for \"{text}\" but got: {(result.IsFailure ? result.Error.Message : "")}");
        Assert.Equal(expectedPitchClass, result.Value.TonicPitchClass);
        Assert.Equal(expectedMode, result.Value.Mode);
    }

    // ── music21 detected-key round-trips ─────────────────────────────────────
    //
    // These are the exact strings music21 emits for common detected keys after
    // _normalise_key_name() processes them. Every string the Python pipeline can
    // return as result.key must survive KeyParser.Parse without error.

    [Theory]
    [InlineData("C major", 0, KeyMode.Major)]
    [InlineData("G major", 7, KeyMode.Major)]
    [InlineData("D major", 2, KeyMode.Major)]
    [InlineData("A major", 9, KeyMode.Major)]
    [InlineData("E major", 4, KeyMode.Major)]
    [InlineData("F major", 5, KeyMode.Major)]
    [InlineData("Bb major", 10, KeyMode.Major)]
    [InlineData("Eb major", 3, KeyMode.Major)]
    [InlineData("Ab major", 8, KeyMode.Major)]
    [InlineData("F# major", 6, KeyMode.Major)]
    [InlineData("A minor", 9, KeyMode.Minor)]
    [InlineData("E minor", 4, KeyMode.Minor)]
    [InlineData("D minor", 2, KeyMode.Minor)]
    [InlineData("G minor", 7, KeyMode.Minor)]
    [InlineData("B minor", 11, KeyMode.Minor)]
    [InlineData("F# minor", 6, KeyMode.Minor)]
    [InlineData("C minor", 0, KeyMode.Minor)]
    [InlineData("Bb minor", 10, KeyMode.Minor)]
    [InlineData("Eb minor", 3, KeyMode.Minor)]
    public void Accepts_all_normalised_detected_key_names(string text, int expectedPitchClass, KeyMode expectedMode)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess, $"Detected-key round-trip failed for \"{text}\"");
        Assert.Equal(expectedPitchClass, result.Value.TonicPitchClass);
        Assert.Equal(expectedMode, result.Value.Mode);
    }

    // ── Minor mode suffixes ───────────────────────────────────────────────────

    [Theory]
    [InlineData("Am", 9)]
    [InlineData("A minor", 9)]
    [InlineData("A min", 9)]
    [InlineData("F# minor", 6)]
    [InlineData("Ebm", 3)]
    [InlineData("Bbm", 10)]
    [InlineData("f# minor", 6)]   // lowercase tonic OK
    [InlineData("a minor", 9)]   // music21-style lowercase minor
    public void Parses_minor_mode_suffixes(string text, int expectedPitchClass)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess);
        Assert.Equal(expectedPitchClass, result.Value.TonicPitchClass);
        Assert.Equal(KeyMode.Minor, result.Value.Mode);
    }

    // ── Explicit major mode suffixes ─────────────────────────────────────────

    [Theory]
    [InlineData("C major")]
    [InlineData("C maj")]
    [InlineData("Bb major")]
    [InlineData("F# major")]
    [InlineData("Eb major")]
    public void Parses_explicit_major_mode(string text)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsSuccess);
        Assert.Equal(KeyMode.Major, result.Value.Mode);
    }

    // ── Stacked / cancelling accidentals ─────────────────────────────────────

    [Fact]
    public void Cancelling_accidentals_net_to_the_natural()
    {
        // "#" then "b" both accepted; they cancel → C natural (pc 0).
        var result = KeyParser.Parse("C#b");

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.TonicPitchClass);
    }

    [Fact]
    public void Dash_and_sharp_also_cancel()
    {
        // "B-#" = B♭ raised back to B natural = pc 11
        var result = KeyParser.Parse("B-#");

        Assert.True(result.IsSuccess);
        Assert.Equal(11, result.Value.TonicPitchClass);
    }

    [Fact]
    public void Double_flat_via_dashes_lowers_by_two()
    {
        // "D--" = D double-flat = enharmonic C = pc 0
        var result = KeyParser.Parse("D--");

        Assert.True(result.IsSuccess);
        Assert.Equal(0, result.Value.TonicPitchClass);
    }

    // ── "m" suffix guard ─────────────────────────────────────────────────────

    [Fact]
    public void Minor_suffix_is_not_greedily_read_off_a_bare_letter()
    {
        // "m" alone: peeling "m" leaves an empty note body → must be rejected.
        var result = KeyParser.Parse("m");

        Assert.True(result.IsFailure);
    }

    // ── Rejection paths ──────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    [InlineData("H")]      // not a note letter
    [InlineData("Cx")]     // unknown accidental character 'x'
    [InlineData("123")]
    [InlineData("-")]      // dash with no tonic letter
    [InlineData("#")]      // sharp with no tonic letter
    public void Rejects_invalid_input(string? text)
    {
        var result = KeyParser.Parse(text);

        Assert.True(result.IsFailure);
        Assert.Equal("KEY_INVALID", result.Error.Code);
    }

    // ── Confidence passthrough ───────────────────────────────────────────────

    [Fact]
    public void Carries_supplied_confidence_onto_the_key()
    {
        var result = KeyParser.Parse("G", confidence: 0.42);

        Assert.True(result.IsSuccess);
        Assert.Equal(0.42, result.Value.Confidence, precision: 5);
    }

    [Fact]
    public void Default_confidence_is_one()
    {
        var result = KeyParser.Parse("C major");

        Assert.True(result.IsSuccess);
        Assert.Equal(1.0, result.Value.Confidence, precision: 5);
    }

    // ── B-natural regression ─────────────────────────────────────────────────

    [Fact]
    public void B_natural_is_not_flattened_by_the_mode_m_suffix()
    {
        // "Bm" should parse as B minor (pc 11), not as B♭ major.
        // The 'm' is a mode suffix, not a flat accidental on the tonic.
        var result = KeyParser.Parse("Bm");

        Assert.True(result.IsSuccess);
        Assert.Equal(11, result.Value.TonicPitchClass);
        Assert.Equal(KeyMode.Minor, result.Value.Mode);
    }
}
