using NoteFusion.Shared.Guards;

namespace NoteFusion.Core.Solfa;

/// <summary>
/// Names a chord in a key: its letter-name symbol ("Dm", "Bb", "G/B") and its root's solfa. Mirrors the
/// worker's <c>chords.label</c> (server/app/pipeline/chords.py) — keep the two in lock-step, so a chord
/// read back from the library is named exactly as the transcription named it.
/// </summary>
/// <remarks>
/// The root takes the letter of its scale degree, counted from doh: diatonic roots get the key's own
/// spelling (Bb in F major, F# in A major), a chromatic root the degree above lowered — or, for a
/// diminished chord, the degree below raised, since that is the leading-tone chord it almost always is.
/// The solfa follows the same choice: a flattened degree (ta, ma, la, ra, sa), or for a diminished
/// chord the sharpened one (fe, de, re, se, le). Movable-do, so a transpose respells the symbol and
/// leaves the solfa as it was.
/// </remarks>
public static class ChordSpeller
{
    /// <summary>The chord qualities the worker reads, as the wire spells them.</summary>
    public static readonly IReadOnlyList<string> Qualities = ["maj", "min", "7", "maj7", "min7", "dim", "sus4"];

    private static readonly IReadOnlyDictionary<string, string> Suffixes = new Dictionary<string, string>
    {
        ["maj"] = "", ["min"] = "m", ["7"] = "7", ["maj7"] = "maj7", ["min7"] = "m7", ["dim"] = "dim", ["sus4"] = "sus4"
    };

    private const string Letters = "CDEFGAB";
    private static readonly int[] LetterPitchClass = [0, 2, 4, 5, 7, 9, 11];

    // For each semitone above doh: the scale degree (0-6) whose letter names it, flat-side and
    // sharp-side. Diatonic semitones name the same degree both ways.
    private static readonly int[] FlatDegree = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
    private static readonly int[] SharpDegree = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

    private static readonly string[] Plain = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    private static readonly string[] PlainSharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    // Tonic spellings with the fewest accidentals: Db major (five flats), G# minor (five sharps).
    private static readonly string[] MajorTonic = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    private static readonly string[] MinorTonic = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

    // Letters up from the root to each chord tone: a third is two letters, a fifth four, a seventh six.
    private static readonly IReadOnlyDictionary<int, int> ToneSteps = new Dictionary<int, int>
    {
        [3] = 2, [4] = 2, [5] = 3, [6] = 4, [7] = 4, [10] = 6, [11] = 6
    };

    public static bool IsQuality(string? quality) => quality is not null && Suffixes.ContainsKey(quality);

    /// <summary>Doh's letter name: the tonic for major, the relative major's tonic (spelled from the tonic's letter) for minor.</summary>
    public static string DohName(MusicalKey key)
    {
        Guard.NotNull(key);
        if (key.Mode == KeyMode.Major)
            return MajorTonic[key.TonicPitchClass];

        string tonic = MinorTonic[key.TonicPitchClass];
        int doh = key.DohPitchClass;
        char letter = Letters[(Letters.IndexOf(tonic[0]) + 2) % 7];
        return Name(letter, doh) ?? Plain[doh];
    }

    /// <summary>
    /// The letter name of a root in <paramref name="key"/>. <paramref name="sharp"/> names a chromatic
    /// root from the degree below (raised) rather than the degree above (lowered). A spelling that would
    /// need a double accidental falls back to the plain name, flats in a flat key.
    /// </summary>
    public static string SpellRoot(int pitchClass, MusicalKey key, bool sharp)
    {
        Guard.InRange(pitchClass, 0, 11);
        string dohName = DohName(key);
        int semis = Mod12(pitchClass - key.DohPitchClass);
        int degree = (sharp ? SharpDegree : FlatDegree)[semis];
        char letter = Letters[(Letters.IndexOf(dohName[0]) + degree) % 7];
        if (Name(letter, pitchClass) is { } named)
            return named;
        bool flatKey = dohName[1..].Contains('b') || dohName == "F";
        return (flatKey ? Plain : PlainSharp)[pitchClass];
    }

    /// <summary>A chord tone (the bass of a slash chord) spelled from the root's letter: a third two letters up, and so on.</summary>
    public static string SpellTone(string rootName, int rootPitchClass, int pitchClass)
    {
        Guard.NotNullOrWhiteSpace(rootName);
        Guard.InRange(pitchClass, 0, 11);
        if (ToneSteps.TryGetValue(Mod12(pitchClass - rootPitchClass), out int steps)
            && Name(Letters[(Letters.IndexOf(rootName[0]) + steps) % 7], pitchClass) is { } named)
            return named;
        return (rootName[1..].Contains('b') ? Plain : PlainSharp)[pitchClass];
    }

    /// <summary>The chord's symbol and its root's solfa syllable in <paramref name="key"/>.</summary>
    public static (string Symbol, string Solfa) Label(int root, string quality, int? bass, MusicalKey key)
    {
        Guard.InRange(root, 0, 11);
        Guard.NotNull(key);
        if (!IsQuality(quality))
            throw new ArgumentException($"Unknown chord quality '{quality}'.", nameof(quality));

        bool sharp = quality == "dim";
        string rootName = SpellRoot(root, key, sharp);
        string symbol = rootName + Suffixes[quality];
        if (bass is { } b)
            symbol += "/" + SpellTone(rootName, root, Guard.InRange(b, 0, 11));
        string solfa = SolfaMapper.Syllable(
            Mod12(root - key.DohPitchClass), sharp ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
        return (symbol, solfa);
    }

    /// <summary><paramref name="letter"/> altered to sound as <paramref name="pitchClass"/>, or null if that needs a double accidental.</summary>
    private static string? Name(char letter, int pitchClass)
    {
        int alter = Mod12(pitchClass - LetterPitchClass[Letters.IndexOf(letter)] + 6) - 6;
        return alter switch
        {
            0 => letter.ToString(),
            1 => letter + "#",
            -1 => letter + "b",
            _ => null
        };
    }

    private static int Mod12(int value) => (value % 12 + 12) % 12;
}
