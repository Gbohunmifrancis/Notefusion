using NoteFusion.Shared.Results;

namespace NoteFusion.Core.Solfa;

/// <summary>
/// Parses human-written key names ("C", "Bb", "F#", "Am", "F# minor", "Eb major") into a
/// <see cref="MusicalKey"/>. Used for the optional "set Doh before recording" override and for
/// mapping the ML service's detected key string back into the domain model.
///
/// <para>
/// Accepted flat notations: <c>b</c>, <c>♭</c>, and <c>-</c> (music21's internal flat symbol,
/// e.g. "B- major" for B♭ major). Without the <c>-</c> support, any key that the Python worker
/// detected and returned as a music21 name could not be round-tripped through this parser —
/// causing a 422 on the <c>PUT /api/library/{id}/key</c> re-key endpoint.
/// </para>
///
/// <para>
/// Part of the solfa engine core IP — every accepted spelling is covered by a unit test.
/// </para>
/// </summary>
public static class KeyParser
{
    private static readonly Error Invalid =
        Error.Validation("KEY_INVALID",
            "Key must be a note (A–G) with an optional #/b and an optional major/minor, " +
            "e.g. \"C\", \"Bb\", \"F#\", \"B- major\", \"F# minor\", \"Am\".");

    /// <summary>
    /// The longest key string read at all: twice the longest real spelling ("F# minor", "Bb major"). The worker
    /// refuses longer ones too, so an endless run of accidentals is turned away here rather than parsed there.
    /// </summary>
    public const int MaxLength = 16;

    // Pitch class of each natural note letter.
    private static readonly IReadOnlyDictionary<char, int> NaturalPitchClass =
        new Dictionary<char, int>
        {
            ['c'] = 0,
            ['d'] = 2,
            ['e'] = 4,
            ['f'] = 5,
            ['g'] = 7,
            ['a'] = 9,
            ['b'] = 11
        };

    /// <summary>
    /// Parses a key string. Accepts a trailing "m"/"min"/"minor" or "maj"/"major"
    /// (case-insensitive) and accidentals:
    /// <list type="bullet">
    ///   <item><c>#</c> / <c>♯</c> — sharp</item>
    ///   <item><c>b</c> / <c>♭</c> — flat (common notation)</item>
    ///   <item><c>-</c>            — flat (music21 internal notation, e.g. "B-")</item>
    /// </list>
    /// Multiple accidentals stack (e.g. "Abb" = A double-flat = G). Defaults to major
    /// when no mode suffix is present.
    /// </summary>
    public static Result<MusicalKey> Parse(string? text, double confidence = 1.0)
    {
        if (string.IsNullOrWhiteSpace(text))
            return Invalid;

        var s = text.Trim();
        if (s.Length > MaxLength)
            return Invalid;

        var mode = KeyMode.Major;

        // Peel off an explicit mode suffix, longest first so "minor" isn't read as "m" + "inor".
        foreach (var (suffix, m) in ModeSuffixes)
        {
            if (s.Length > suffix.Length &&
                s.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
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
                // Sharp — standard ASCII, Unicode, or double-sharp sequences
                case '#' or '♯':
                    pitchClass++;
                    break;

                // Flat — standard 'b', Unicode '♭', or music21's '-' (e.g. "B- major")
                case 'b' or 'B' or '♭' or '-':
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
        ("min",   KeyMode.Minor),
        ("maj",   KeyMode.Major),
        ("major", KeyMode.Major),
        ("m",     KeyMode.Minor)
    ];
}
