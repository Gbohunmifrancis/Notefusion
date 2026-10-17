using System.Security.Cryptography;
using System.Text;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
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
/// A drill is named by its id (<c>code@dohMidi</c>, or <c>code@dohMidi~gentle</c> at Playful's slower pace) and rebuilt
/// from it on grading, so the notes a take is judged against are always the server's, never the client's. Today's
/// drill is chosen from the user id and the local date alone, at the level the account started the day on, from the
/// slice of the catalogue its track offers (<see cref="PatternsFor"/>): the same drill all day on each track. A singer
/// who switches track mid-day is shown that track's drill of the day at once, and switching back brings the first one
/// back; a take of either is still marked, and the day's marked-drill allowance is one for both.
/// <para>
/// Tiers 0–7 are the ladder every track climbs (one per level). Tiers above it are Focused-only: wide leaps (sixths,
/// sevenths, minor lines through se) and sight-singing phrases of 8–12 notes, some modulating.
/// </para>
/// </remarks>
public static class DrillCatalogue
{
    /// <summary>A bar of the first note and a bar of clicks in 4/4 — mobile <c>lib/take.leadInFor</c>.</summary>
    public const int LeadInBeats = 8;

    public const string TimeSignature = "4/4";

    /// <summary>The fewest and most notes a drill has: the longest are Focused's sight-singing phrases.</summary>
    public const int MinNotes = 3;
    public const int MaxNotes = 12;

    /// <summary>The drill-id suffix for a pattern at Playful's slower pace.</summary>
    public const string GentleSuffix = "~gentle";

    /// <summary>The comfortable range every placed drill keeps to: A3 to D5.</summary>
    public const int LowestMidi = 57;
    public const int HighestMidi = 74;

    /// <summary>The dohs a drill is placed on: C, D, Eb, F, G, A, Bb (minor drills: their relative minors).</summary>
    public static readonly IReadOnlyList<int> DohPitchClasses = [0, 2, 3, 5, 7, 9, 10];

    /// <summary>
    /// Tempo per tier: unhurried for the first steps, a little quicker by the chromatics; Focused's wide leaps and
    /// long phrases a touch steadier again. Playful takes <see cref="PracticeRules.PlayfulTempoDrop"/> off.
    /// </summary>
    private static readonly int[] TierTempo = [72, 72, 80, 80, 84, 84, 88, 92, 84, 88];

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

        // Focused only — wide leaps: sixths and sevenths, and minor lines that leap to and from se.
        new("sixth-ray-te", 8, "Sixths: doh to lah, ray to te", KeyMode.Major, "d l s r t l s"),
        new("sixth-minor-me", 8, "A minor sixth: me to the top doh", KeyMode.Major, "m d' t l s m"),
        new("seventh-te", 8, "A seventh: doh up to te", KeyMode.Major, "d t d' s m d"),
        new("seventh-fah", 8, "A seventh: low soh up to fah", KeyMode.Major, "s, f m r d"),
        new("seventh-down", 8, "Falling a seventh: top doh to ray", KeyMode.Major, "d' r m f m r d"),
        new("minor-se-leap", 8, "Minor: me down to se", KeyMode.Minor, "l, d m se, l,"),
        new("minor-harmonic", 8, "Minor: the harmonic scale", KeyMode.Minor, "l, t, d r m f se l"),
        new("minor-se-sixth", 8, "Minor: se up to me", KeyMode.Minor, "l, se, m d t, l,"),

        // Focused only — sight-singing: phrases of 8 to 12 notes, two of them turning to a new key and back.
        new("sight-hymn-line", 9, "A hymn line", KeyMode.Major, "d m s l s m r d t, d"),
        new("sight-to-soh", 9, "Turning to soh through fe", KeyMode.Major, "d m r f m s fe s l t l s"),
        new("sight-to-fah", 9, "Turning to fah through ta", KeyMode.Major, "d m s ta l f s m f"),
        new("sight-minor-line", 9, "Minor: a line through se", KeyMode.Minor, "l, d m l se l m d t, l,"),
        new("sight-sixths-line", 9, "Sixths in a long line", KeyMode.Major, "s, m r d l s f m r d t, d"),
        new("sight-chromatic-line", 9, "Up through de and fe", KeyMode.Major, "d de r m fe s l s f m r d"),
    ];

    /// <summary>The top of the ladder every track climbs: one tier per level, Doh to Choir-ready.</summary>
    public static int LadderTopTier => PracticeRules.Levels.Count - 1;

    /// <summary>The top of the catalogue: the Focused-only tiers above the ladder.</summary>
    public static int TopTier => Patterns.Max(p => p.Tier);

    /// <summary>A pattern Playful may offer: short, and from the lower tiers.</summary>
    public static bool IsPlayful(DrillPattern pattern)
        => pattern.Tier <= PracticeRules.PlayfulTopTier && pattern.Tokens.Count <= PracticeRules.PlayfulMaxNotes;

    /// <summary>
    /// The tier a track's day is drawn from at <paramref name="levelIndex"/>: the level's own (the ladder's top beyond
    /// it) with no track chosen; held to <see cref="PracticeRules.PlayfulTopTier"/> on Playful; and
    /// <see cref="PracticeRules.FocusedTierLead"/> ahead on Focused, into the tiers only Focused sees.
    /// </summary>
    public static int TierFor(PracticeTrack? track, int levelIndex)
    {
        var level = Math.Max(0, levelIndex);
        return track switch
        {
            PracticeTrack.Playful => Math.Min(level, PracticeRules.PlayfulTopTier),
            PracticeTrack.Focused => Math.Min(level + PracticeRules.FocusedTierLead, TopTier),
            _ => Math.Min(level, LadderTopTier)
        };
    }

    /// <summary>The patterns a track offers a singer at <paramref name="levelIndex"/>: today's drill is one of these.</summary>
    public static IReadOnlyList<DrillPattern> PatternsFor(PracticeTrack? track, int levelIndex)
    {
        var tier = TierFor(track, levelIndex);
        return Patterns.Where(p => p.Tier == tier && (track != PracticeTrack.Playful || IsPlayful(p))).ToList();
    }

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
    public static Drill Build(DrillPattern pattern, int dohMidi, bool gentle = false)
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

        return gentle
            ? new Drill($"{pattern.Code}@{dohMidi}{GentleSuffix}", pattern, key, dohMidi, TempoFor(pattern.Tier) - PracticeRules.PlayfulTempoDrop, notes)
            : new Drill($"{pattern.Code}@{dohMidi}", pattern, key, dohMidi, TempoFor(pattern.Tier), notes);
    }

    /// <summary>
    /// The drill an id names, or null when it names none (an old id, a typo, a range it may not use, the gentle pace
    /// on a pattern Playful never offers). Any track's drill is found, so a take sung before a switch is still marked.
    /// </summary>
    public static Drill? Find(string? id)
    {
        var gentle = id?.EndsWith(GentleSuffix, StringComparison.Ordinal) == true;
        var parts = (gentle ? id![..^GentleSuffix.Length] : id)?.Split('@');
        if (parts is not { Length: 2 } || !int.TryParse(parts[1], out var doh))
            return null;
        var pattern = Patterns.FirstOrDefault(p => p.Code == parts[0]);
        if (pattern is null || !Placements(pattern).Contains(doh) || (gentle && !IsPlayful(pattern)))
            return null;
        return Build(pattern, doh, gentle);
    }

    /// <summary>
    /// Today's drill for an account at <paramref name="levelIndex"/> on <paramref name="track"/>: a pattern of the
    /// track's slice (<see cref="PatternsFor"/>) in one of its keys, both picked from a hash of the user and the date —
    /// the same all day, a different one most days. Playful's is at the gentle pace.
    /// </summary>
    public static Drill ForDay(Guid userId, DateOnly date, int levelIndex, PracticeTrack? track = null)
    {
        var choices = PatternsFor(track, levelIndex);
        var seed = Seed(userId, date);
        var pattern = choices[(int)(seed % (ulong)choices.Count)];
        var placements = Placements(pattern);
        var doh = placements[(int)(seed / (ulong)choices.Count % (ulong)placements.Count)];
        return Build(pattern, doh, gentle: track == PracticeTrack.Playful);
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
