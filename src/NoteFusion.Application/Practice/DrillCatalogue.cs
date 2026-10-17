using System.Security.Cryptography;
using System.Text;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice;

/// <summary>
/// A drill as written: a few solfa syllables, with octave marks the way a tonic solfa hymn book prints them (' above,
/// , below the unmarked doh), for one tier of the ladder. Minor patterns are la-based (l, t, d r m).
/// </summary>
public sealed record DrillPattern(string Code, int Tier, string Title, KeyMode Mode, string Solfa)
{
    public IReadOnlyList<string> Tokens => Solfa.Split(' ', StringSplitOptions.RemoveEmptyEntries);
}

/// <summary>
/// A pattern placed in a key: pitches, the solfa engine's labels for them, and the take's timing. Each note is a
/// beat and the last is held for two; the take starts with <see cref="DrillCatalogue.LeadInBeats"/> of count-in.
/// </summary>
public sealed record Drill(string Id, DrillPattern Pattern, MusicalKey Key, int DohMidi, int TempoBpm, IReadOnlyList<NoteEventDto> Notes)
{
    public double BeatSeconds => 60.0 / TempoBpm;
    public double LeadInSeconds => DrillCatalogue.LeadInBeats * BeatSeconds;
    public double PassageSeconds => Notes.Sum(n => n.DurBeats) * BeatSeconds;

    /// <summary>The longest take kept: count-in, the passage, and <see cref="PracticeRules.DrillTakeTailSeconds"/>.</summary>
    public double MaxTakeSeconds => Math.Round(LeadInSeconds + PassageSeconds + PracticeRules.DrillTakeTailSeconds, 2);

    public GradeTargetDto Target()
        => new(Notes.Select(n => new GradeTargetNoteDto(n.PitchMidi, n.StartBeat, n.DurBeats)).ToList(), TempoBpm, LeadInSeconds);

    /// <summary>"Eb major", "B minor": the key named as its signature spells it, readable by <see cref="KeyParser"/>.</summary>
    public string KeyName => Key.Mode == KeyMode.Major
        ? $"{Key.DohHeader()["Doh is ".Length..]} major"
        : Key.ToString();
}

/// <summary>
/// The free daily drill: a small catalogue of solfa patterns by level — steps (d r m), the triad (d m s), scales,
/// leaps, the low register, la-based minor, then the chromatics de, fe, ta and se — each placed in a key that keeps
/// every note between A3 and D5, where an untrained voice sings comfortably (a man an octave down, which the
/// grader accepts). Pitches come from the syllables; the labels the client shows come back out of the solfa
/// engine (<see cref="SolfaMapper"/>), and a pattern whose labels would not round-trip is a programmer error.
/// </summary>
/// <remarks>
/// A drill is named by its id (<c>code@dohMidi</c>) and rebuilt from it on grading, so the notes a take is judged
/// against are always the server's, never the client's. Today's drill is chosen from the user id and the local date
/// alone, at the level the account started the day on, so it is the same drill all day.
/// </remarks>
public static class DrillCatalogue
{
    /// <summary>A bar of the first note and a bar of clicks in 4/4 — mobile <c>lib/take.leadInFor</c>.</summary>
    public const int LeadInBeats = 8;

    public const string TimeSignature = "4/4";

    /// <summary>The comfortable range every placed drill keeps to: A3 to D5.</summary>
    public const int LowestMidi = 57;
    public const int HighestMidi = 74;

    /// <summary>The dohs a drill is placed on: C, D, Eb, F, G, A, Bb (minor drills: their relative minors).</summary>
    public static readonly IReadOnlyList<int> DohPitchClasses = [0, 2, 3, 5, 7, 9, 10];

    /// <summary>Tempo per tier: unhurried for the first steps, a little quicker by the chromatics.</summary>
    private static readonly int[] TierTempo = [72, 72, 80, 80, 84, 84, 88, 92];

    public static readonly IReadOnlyList<DrillPattern> Patterns =
    [
        // Doh — steps around doh.
        new("steps-up", 0, "Steps up from doh", KeyMode.Major, "d r m"),
        new("steps-down", 0, "Steps down to doh", KeyMode.Major, "m r d"),
        new("steps-turn", 0, "Up and home", KeyMode.Major, "d r m r d"),
        new("steps-neighbour", 0, "Doh and its neighbour", KeyMode.Major, "d r d"),
        new("steps-dip", 0, "Down and back up", KeyMode.Major, "m r d r m"),
        new("steps-fah", 0, "Up to fah and home", KeyMode.Major, "d r m f m r d"),

        // Ray — the doh chord.
        new("triad-up", 1, "The doh chord, rising", KeyMode.Major, "d m s"),
        new("triad-down", 1, "The doh chord, falling", KeyMode.Major, "s m d"),
        new("triad-arch", 1, "Up the chord and back", KeyMode.Major, "d m s m d"),
        new("triad-octave", 1, "The chord to the top doh", KeyMode.Major, "d m s d'"),
        new("triad-from-soh", 1, "From soh and back", KeyMode.Major, "s m d m s"),

        // Me — scales.
        new("scale-five-up", 2, "Five notes up", KeyMode.Major, "d r m f s"),
        new("scale-five-down", 2, "Five notes down", KeyMode.Major, "s f m r d"),
        new("scale-up", 2, "The scale, rising", KeyMode.Major, "d r m f s l t d'"),
        new("scale-down", 2, "The scale, falling", KeyMode.Major, "d' t l s f m r d"),
        new("scale-top", 2, "Soh up to doh", KeyMode.Major, "s l t d'"),

        // Fah — leaps.
        new("leap-fifth", 3, "Leap to soh", KeyMode.Major, "d s m d"),
        new("leap-fourth", 3, "Leap to fah", KeyMode.Major, "d f l s"),
        new("leap-octave", 3, "Leap to the top doh", KeyMode.Major, "s d' s m"),
        new("leap-sixth", 3, "Leap to lah", KeyMode.Major, "d l s m d"),
        new("leap-thirds", 3, "Thirds and a fifth", KeyMode.Major, "m d s m"),

        // Soh — below doh, and wider.
        new("low-soh", 4, "Down to low soh", KeyMode.Major, "s, d m d"),
        new("low-soh-steps", 4, "From low soh, up", KeyMode.Major, "s, d r m"),
        new("low-soh-return", 4, "Up the chord, down to low soh", KeyMode.Major, "d s m d s,"),
        new("wide-arch", 4, "Over the top doh", KeyMode.Major, "m s d' s m"),
        new("wide-chord", 4, "The chord, both ways", KeyMode.Major, "d m s d' s m d"),

        // Lah — la-based minor.
        new("minor-up", 5, "Minor: lah up to me", KeyMode.Minor, "l, t, d r m"),
        new("minor-down", 5, "Minor: me down to lah", KeyMode.Minor, "m r d t, l,"),
        new("minor-chord", 5, "Minor: the lah chord", KeyMode.Minor, "l, d m l"),
        new("minor-leading", 5, "Minor: the leading note", KeyMode.Minor, "l, se, l,"),
        new("minor-cadence", 5, "Minor: home through se", KeyMode.Minor, "m d t, se, l,"),
        new("minor-phrase", 5, "Minor: a phrase", KeyMode.Minor, "l, d m r d t, l,"),

        // Te — chromatics.
        new("chromatic-de", 6, "de, leading to ray", KeyMode.Major, "d de r"),
        new("chromatic-de-turn", 6, "de, between rays", KeyMode.Major, "d r de r"),
        new("chromatic-fe", 6, "fe, leading to soh", KeyMode.Major, "s fe s"),
        new("chromatic-fe-rise", 6, "Me, fe, soh", KeyMode.Major, "m fe s"),
        new("chromatic-ta", 6, "ta, falling to lah", KeyMode.Major, "d' ta l"),
        new("chromatic-ta-turn", 6, "Soh, ta, lah", KeyMode.Major, "s ta l s"),

        // Choir-ready — longer lines with everything in them.
        new("choir-fe-line", 7, "A line through fe", KeyMode.Major, "d m s fe s m r d"),
        new("choir-low-line", 7, "From low soh to soh", KeyMode.Major, "s, d t, d r m f s"),
        new("choir-ta-fe", 7, "ta and fe on the way down", KeyMode.Major, "d' t l ta l s fe s"),
        new("choir-melodic-minor", 7, "Minor: the melodic scale", KeyMode.Minor, "l, t, d r m fe se l"),
        new("choir-de-line", 7, "A line through de", KeyMode.Major, "m de r t, d"),
    ];

    public static int TopTier => Patterns.Max(p => p.Tier);

    public static int TempoFor(int tier) => TierTempo[Math.Clamp(tier, 0, TierTempo.Length - 1)];

    /// <summary>Semitones from the unmarked doh for each syllable of <paramref name="pattern"/>.</summary>
    public static IReadOnlyList<int> Offsets(DrillPattern pattern) => pattern.Tokens.Select(Offset).ToList();

    /// <summary>The unmarked-doh MIDI pitches <paramref name="pattern"/> may be placed on, lowest first.</summary>
    public static IReadOnlyList<int> Placements(DrillPattern pattern)
    {
        var offsets = Offsets(pattern);
        var low = offsets.Min();
        var high = offsets.Max();
        return DohPitchClasses
            .SelectMany(pc => new[] { 48 + pc, 60 + pc })
            .Where(doh => doh + low >= LowestMidi && doh + high <= HighestMidi)
            .Order()
            .ToList();
    }

    /// <summary>
    /// The pattern placed with its unmarked doh on <paramref name="dohMidi"/>: pitches from the syllables, labels
    /// from the solfa engine. Throws when the engine would label it differently — a catalogue mistake.
    /// </summary>
    public static Drill Build(DrillPattern pattern, int dohMidi)
    {
        var dohPc = dohMidi % 12;
        var key = pattern.Mode == KeyMode.Major
            ? new MusicalKey(dohPc, KeyMode.Major)
            : new MusicalKey((dohPc + 9) % 12, KeyMode.Minor);

        var pitches = Offsets(pattern).Select(o => dohMidi + o).ToList();
        var reference = SolfaMapper.ReferenceDoh(pitches, key.DohPitchClass, key.Mode);
        var ascending = SolfaMapper.AscendingFlags(pitches, key.DohPitchClass);

        var notes = new List<NoteEventDto>(pitches.Count);
        for (var i = 0; i < pitches.Count; i++)
        {
            var syllable = SolfaMapper.Map(
                pitches[i], key, reference, ascending[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
            var last = i == pitches.Count - 1;
            notes.Add(new NoteEventDto(
                pitches[i], i, last ? 2 : 1, SolfaMapper.Degree(pitches[i], key), syllable.Text, syllable.OctaveMark, 1.0));
        }

        var labels = string.Join(' ', notes.Select(n => n.Solfa + n.OctaveMark));
        if (labels != string.Join(' ', pattern.Tokens))
            throw new InvalidOperationException(
                $"Drill '{pattern.Code}' on {dohMidi} is labelled \"{labels}\" by the solfa engine, not \"{pattern.Solfa}\".");

        return new Drill($"{pattern.Code}@{dohMidi}", pattern, key, dohMidi, TempoFor(pattern.Tier), notes);
    }

    /// <summary>The drill an id names, or null when it names none (an old id, a typo, a range it may not use).</summary>
    public static Drill? Find(string? id)
    {
        var parts = id?.Split('@');
        if (parts is not { Length: 2 } || !int.TryParse(parts[1], out var doh))
            return null;
        var pattern = Patterns.FirstOrDefault(p => p.Code == parts[0]);
        if (pattern is null || !Placements(pattern).Contains(doh))
            return null;
        return Build(pattern, doh);
    }

    /// <summary>
    /// Today's drill for an account at <paramref name="levelIndex"/>: a pattern of that level's tier (the top tier
    /// beyond it) in one of its keys, both picked from a hash of the user and the date — the same all day, a different
    /// one most days.
    /// </summary>
    public static Drill ForDay(Guid userId, DateOnly date, int levelIndex)
    {
        var tier = Math.Clamp(levelIndex, 0, TopTier);
        var choices = Patterns.Where(p => p.Tier == tier).ToList();
        var seed = Seed(userId, date);
        var pattern = choices[(int)(seed % (ulong)choices.Count)];
        var placements = Placements(pattern);
        var doh = placements[(int)(seed / (ulong)choices.Count % (ulong)placements.Count)];
        return Build(pattern, doh);
    }

    /// <summary>A stable hash (unlike <c>GetHashCode</c>, which changes every process).</summary>
    private static ulong Seed(Guid userId, DateOnly date)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{userId:N}:{date:yyyy-MM-dd}"));
        return BitConverter.ToUInt64(bytes, 0);
    }

    /// <summary>One syllable with its octave marks, as semitones from the unmarked doh.</summary>
    private static int Offset(string token)
    {
        var up = token.Count(c => c == '\'');
        var down = token.Count(c => c == ',');
        var text = token.TrimEnd('\'', ',');
        for (var semitone = 0; semitone < 12; semitone++)
        {
            if (SolfaMapper.Syllable(semitone, ChromaticSpelling.Ascending) == text
                || SolfaMapper.Syllable(semitone, ChromaticSpelling.Descending) == text)
                return semitone + 12 * (up - down);
        }
        throw new InvalidOperationException($"'{token}' is not a solfa syllable.");
    }
}
