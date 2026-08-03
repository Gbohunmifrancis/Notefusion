using NoteFusion.Shared.Results;

namespace NoteFusion.Core.Solfa;

/// <summary>
/// Parses human-written key names ("C", "Bb", "F#", "Am", "F# minor", "Eb major") into a
/// <see cref="MusicalKey"/>. Used for the optional "set Doh before recording" override and for
/// mapping the ML service's detected key string. Part of the solfa engine core IP — every
/// accepted spelling is covered by a unit test.
/// </summary>
public static class KeyParser
{
    private static readonly Error Invalid =
        Error.Validation("KEY_INVALID", "Key must be a note (A–G) with an optional #/b and an optional major/minor, e.g. \"C\", \"Bb\", \"F# minor\", \"Am\".");

    // Pitch class of each natural note letter.
    private static readonly IReadOnlyDictionary<char, int> NaturalPitchClass = new Dictionary<char, int>
    {
        ['c'] = 0, ['d'] = 2, ['e'] = 4, ['f'] = 5, ['g'] = 7, ['a'] = 9, ['b'] = 11
    };

    /// <summary>
    /// Parses a key string. Accepts a trailing "m"/"min"/"minor" or "maj"/"major" (case-insensitive),
    /// and accidentals "#"/"♯" (sharp) or "b"/"♭" (flat). Defaults to major when no mode is given.
    /// </summary>
    public static Result<MusicalKey> Parse(string? text, double confidence = 1.0)
    {
        if (string.IsNullOrWhiteSpace(text))
            return Invalid;

        var s = text.Trim();
        var mode = KeyMode.Major;

        // Peel off an explicit mode suffix, longest first so "minor" isn't read as "m" + "inor".
        foreach (var (suffix, m) in ModeSuffixes)
        {
            if (s.Length > suffix.Length && s.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            {
                mode = m;
                s = s[..^suffix.Length].TrimEnd();
                break;
            }
        }

        if (s.Length == 0)
            return Invalid;

        var letter = char.ToLowerInvariant(s[0]);
        if (!NaturalPitchClass.TryGetValue(letter, out var pitchClass))
            return Invalid;

        var rest = s[1..].Trim();
        foreach (var ch in rest)
        {
            switch (ch)
            {
                case '#' or '♯':
                    pitchClass++;
                    break;
                case 'b' or 'B' or '♭':
                    pitchClass--;
                    break;
                default:
                    return Invalid;
            }
        }

        pitchClass = ((pitchClass % 12) + 12) % 12;
        return new MusicalKey(pitchClass, mode, confidence);
    }

    // Ordered longest-first within each mode so multi-char suffixes win over "m"/"".
    private static readonly (string Suffix, KeyMode Mode)[] ModeSuffixes =
    [
        ("minor", KeyMode.Minor),
        ("min", KeyMode.Minor),
        ("maj", KeyMode.Major),
        ("major", KeyMode.Major),
        ("m", KeyMode.Minor)
    ];
}
