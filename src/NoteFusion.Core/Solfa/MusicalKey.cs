using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Solfa;

public enum KeyMode
{
    Major = 0,
    Minor = 1
}

/// <summary>
/// The detected (or user-overridden) key of a transcription. Solfa is movable-do,
/// so every syllable in the app is derived from this value — changing it re-labels
/// all solfa instantly with no re-transcription (TRD §4.1).
/// </summary>
public sealed record MusicalKey
{
    private static readonly string[] PitchNames =
        ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    /// <summary>
    /// Doh names spelled as the key signature spells them: each major key takes its spelling
    /// with fewer accidentals, so a Bb sheet (two flats) reads "Doh is Bb", never "A#" (ten
    /// sharps). F# and Gb tie at six; F# is kept.
    /// </summary>
    private static readonly string[] DohNames =
        ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

    /// <summary>Pitch class of the tonic, 0 = C … 11 = B.</summary>
    public int TonicPitchClass { get; }

    public KeyMode Mode { get; }

    /// <summary>Detection confidence 0–1; below-threshold values trigger the reduced-confidence UI.</summary>
    public double Confidence { get; }

    public MusicalKey(int tonicPitchClass, KeyMode mode, double confidence = 1.0)
    {
        TonicPitchClass = Guard.InRange(tonicPitchClass, 0, 11);
        Mode = mode;
        Confidence = Guard.InRange(confidence, 0.0, 1.0);
    }

    /// <summary>
    /// Pitch class of doh. Minor keys use la-based minor (TRD §4.1): doh is the tonic of
    /// the relative major, so A minor sings l t d … with doh = C.
    /// </summary>
    public int DohPitchClass => Mode == KeyMode.Major
        ? TonicPitchClass
        : (TonicPitchClass + 3) % 12;

    /// <summary>Relative major/minor twin — the most common detection ambiguity; switching must be one tap.</summary>
    public MusicalKey RelativeKey() => Mode == KeyMode.Major
        ? new MusicalKey((TonicPitchClass + 9) % 12, KeyMode.Minor, Confidence)
        : new MusicalKey((TonicPitchClass + 3) % 12, KeyMode.Major, Confidence);

    /// <summary>The 'Doh is F' header shown on the result screen and exported solfa sheets.</summary>
    public string DohHeader() => $"Doh is {DohNames[DohPitchClass]}";

    public override string ToString() =>
        $"{PitchNames[TonicPitchClass]} {(Mode == KeyMode.Major ? "major" : "minor")}";
}
