using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice;

/// <summary>
/// The path past its last grade: Mastery 1, 2, 3… with no end in sight (<see cref="Tiers"/> of them), one tier after
/// another on each track. Every Mastery drill is a line the catalogue already holds, sung quicker, or two of them joined
/// into one long line. Focused's tiers draw on its hardest grades (Grade 8, Advanced 1 and 2): hymn lines, minor and
/// chromatic lines, turns to new keys, rhythm, then two phrases as one; Playful's on its own gentle tunes from Grades 5
/// to 7, joined into longer ones. Each tier's beat is <see cref="TempoStep"/> quicker than the last, up to
/// <see cref="MaxTempo"/> and never so quick that a note is shorter than <see cref="PracticeRules.ShortestNoteSeconds"/>,
/// and the keys are every key. A joined line is labelled afresh by the solfa engine, and one it would not label the
/// same in every key it can be placed in is left out, so every Mastery drill is placed, labelled and marked like any.
/// </summary>
/// <remarks>
/// A Mastery pattern's code names its track, tier and unit and the lines it is made of (<c>mf3u5-a+b</c>,
/// <c>mp2u1-a+b</c>), so a drill id is rebuilt from it like any other (<see cref="DrillCatalogue.Find"/>).
/// </remarks>
public static partial class MasteryCatalogue
{
    /// <summary>Mastery tiers on each track: far past what anyone sings, so the path goes on.</summary>
    public const int Tiers = 200;

    /// <summary>How much quicker each tier's beat is than the last's.</summary>
    public const int TempoStep = 4;

    /// <summary>The quickest beat a Mastery drill is sung at.</summary>
    public const int MaxTempo = 160;

    /// <summary>The first Mastery tier: the one after the catalogue's top.</summary>
    public static int FirstTier => DrillCatalogue.TopTier + 1;

    public static bool IsMastery(int tier) => tier >= FirstTier;

    /// <summary>Mastery's number for a tier (Mastery 1 is the first tier past the catalogue).</summary>
    public static int Number(int tier) => tier - FirstTier + 1;

    /// <summary>Units in a Mastery tier: Focused's five, Playful's three.</summary>
    public static int UnitsOn(PracticeTrack? track) => track == PracticeTrack.Playful ? PracticeRules.PlayfulTopStep : DrillSyllabus.UnitsPerGrade;

    private static readonly DrillUnit[] FocusedUnits =
    [
        new("Hymn lines, quicker", "You can sight-sing a hymn line at this tier's beat."),
        new("Minor and chromatic, quicker", "You can sight-sing minor and chromatic lines at this tier's beat."),
        new("New keys, quicker", "You can follow a line into a new key at this tier's beat."),
        new("Rhythm, quicker", "You can keep syncopations, triplets and wide leaps in time at this tier's beat."),
        new("Two phrases as one", "You can sing two phrases as one long line without losing doh."),
    ];

    private static readonly DrillUnit[] PlayfulUnits =
    [
        new("Longer tunes", "You can sing two tunes as one longer tune."),
        new("Quicker tunes", "You can sing your tunes at a quicker beat."),
        new("Long and quick", "You can sing a long tune at a quick beat."),
    ];

    /// <summary>A Mastery tier's syllabus: every key, every rhythm and chromatic note its lines hold, and its beat.</summary>
    public static DrillSyllabus Syllabus(int tier)
    {
        var n = Number(tier);
        var tempo = TempoOf(tier, 1);
        int[] keys = [0, 2, 3, 4, 5, 7, 8, 9, 10];
        return new DrillSyllabus(
            tier, $"Mastery {n}", "Quicker and longer", DrillCatalogue.MinNotes, 2 * DrillCatalogue.MaxNotes, 17, 11, 11, true,
            keys, keys, (DrillRhythm)127, true, tempo,
            $"sing every line of Mastery {n}, up to {tempo} beats a minute.",
            $"sing long tunes at {tempo} beats a minute.",
            [.. FocusedUnits]);
    }

    /// <summary>The unit a Mastery tier has at a step on a track (Playful's three are its own).</summary>
    public static DrillUnit UnitOf(PracticeTrack? track, int step)
        => track == PracticeTrack.Playful ? PlayfulUnits[Math.Clamp(step, 1, PlayfulUnits.Length) - 1] : FocusedUnits[Math.Clamp(step, 1, FocusedUnits.Length) - 1];

    /// <summary>A tier's beat at a unit: <see cref="TempoStep"/> quicker each tier, a little quicker each unit, never past <see cref="MaxTempo"/>.</summary>
    public static int TempoOf(int tier, int step)
        => Math.Min(MaxTempo, 88 + TempoStep * Number(tier) + (Math.Clamp(step, 1, DrillSyllabus.UnitsPerGrade) - 1) * PracticeRules.TempoPerStep);

    /// <summary>The quickest a pattern may be sung: its shortest note no shorter than <see cref="PracticeRules.ShortestNoteSeconds"/>.</summary>
    public static int TempoCap(DrillPattern pattern)
        => (int)Math.Floor(60 * pattern.Beats.Min() / PracticeRules.ShortestNoteSeconds + 1e-9);

    private static readonly ConcurrentDictionary<(int Track, int Tier, int Step), IReadOnlyList<DrillPattern>> Units = new();

    /// <summary>The patterns of one Mastery unit on a track (none with no track chosen: its path is the ladder alone).</summary>
    public static IReadOnlyList<DrillPattern> UnitPatterns(PracticeTrack? track, int tier, int step)
    {
        if (track is null || !IsMastery(tier) || Number(tier) > Tiers || step < 1 || step > UnitsOn(track))
            return [];
        return Units.GetOrAdd(((int)track.Value, tier, step), key => Generate(track.Value, key.Tier, key.Step));
    }

    /// <summary>The Mastery pattern a code names, or null.</summary>
    public static DrillPattern? Find(string code)
    {
        var m = CodeShape().Match(code);
        if (!m.Success)
            return null;
        var track = m.Groups[1].Value == "p" ? PracticeTrack.Playful : PracticeTrack.Focused;
        var n = int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture);
        var step = int.Parse(m.Groups[3].Value, CultureInfo.InvariantCulture);
        if (n < 1 || n > Tiers)
            return null;
        return UnitPatterns(track, FirstTier + n - 1, step).FirstOrDefault(p => p.Code == code);
    }

    [GeneratedRegex(@"^m([fp])([1-9][0-9]{0,2})u([1-5])-")]
    private static partial Regex CodeShape();

    private static IReadOnlyList<DrillPattern> Sources(int tier, int step)
        => DrillCatalogue.Patterns.Where(p => p.Tier == tier && p.Step == step).ToList();

    private static IReadOnlyList<DrillPattern> Generate(PracticeTrack track, int tier, int step)
    {
        var n = Number(tier);
        var prefix = $"m{(track == PracticeTrack.Playful ? "p" : "f")}{n}u{step}-";
        if (track == PracticeTrack.Playful)
        {
            var gentle = DrillCatalogue.Patterns.Where(p => p.Tier is >= 4 and <= PracticeRules.PlayfulTopTier && DrillCatalogue.IsPlayful(p)).ToList();
            return step == 2
                ? gentle.Select(p => Copy(prefix, tier, step, p)).ToList()
                : Joins(prefix, tier, step, gentle, n, 6, plain: true);
        }

        return step switch
        {
            1 => Sources(9, 1).Concat(Sources(7, 1)).Select(p => Copy(prefix, tier, step, p)).ToList(),
            2 => Sources(9, 2).Concat(Sources(7, 2)).Select(p => Copy(prefix, tier, step, p)).ToList(),
            3 => Sources(9, 3).Concat(Sources(7, 5)).Select(p => Copy(prefix, tier, step, p)).ToList(),
            4 => Sources(9, 4).Concat(Sources(8, 5)).Select(p => Copy(prefix, tier, step, p)).ToList(),
            _ => Joins(prefix, tier, step, Enumerable.Range(1, 5).SelectMany(s => Sources(9, s)).ToList(), n, 6, plain: false),
        };
    }

    private static DrillPattern Copy(string prefix, int tier, int step, DrillPattern source)
        => new(prefix + source.Code, tier, step, source.Title, source.Mode, source.Solfa, source.Rhythm);

    /// <summary>
    /// Up to <paramref name="count"/> lines of two joined, picked afresh for each tier: the pairs of the same mode whose
    /// joined line the engine labels the same in every key it fits (and that fits a key of the tier at all). A
    /// <paramref name="plain"/> line (Playful's) moves straight on from its first half's last note and keeps to plain
    /// beats and held notes, as Playful's tunes do.
    /// </summary>
    private static List<DrillPattern> Joins(string prefix, int tier, int step, IReadOnlyList<DrillPattern> pool, int n, int count, bool plain)
    {
        var pairs = (from a in pool from b in pool where a != b && a.Mode == b.Mode select (a, b)).ToList();
        var joined = new List<DrillPattern>();
        for (var i = 0; i < pairs.Count && joined.Count < count; i++)
        {
            var (a, b) = pairs[(int)(((long)i * 7919 + (long)n * 104729 + step) % pairs.Count)];
            if (Join(prefix, tier, step, a, b, plain) is { } line && joined.All(j => j.Code != line.Code))
                joined.Add(line);
        }
        return joined;
    }

    private static DrillPattern? Join(string prefix, int tier, int step, DrillPattern a, DrillPattern b, bool plain)
    {
        var tokens = a.Tokens.Concat(b.Tokens).ToList();
        if (tokens.Count > 2 * DrillCatalogue.MaxNotes)
            return null;
        var first = RhythmTokens(a).ToList();
        if (plain)
            first[^1] = "1";
        var rhythm = string.Join(' ', first.Concat(RhythmTokens(b)));
        var draft = new DrillPattern(prefix + a.Code + "+" + b.Code, tier, step, $"{a.Title}, then {b.Title}", a.Mode, string.Join(' ', tokens), rhythm);

        // The engine labels the whole line afresh: its octave marks are the line's, not each half's.
        var placements = DrillCatalogue.AnyPlacements(draft);
        if (placements.Count == 0)
            return null;
        var line = draft with { Solfa = DrillCatalogue.EngineLabels(draft, placements[0]) };
        if (plain && (DrillCatalogue.RhythmOf(line) & ~DrillRhythm.Minims) != DrillRhythm.Crotchets)
            return null;
        var keys = DrillCatalogue.AnyPlacements(line);
        if (keys.Count == 0 || DrillCatalogue.Placements(line).Count == 0)
            return null;
        foreach (var doh in keys)
        {
            if (DrillCatalogue.EngineLabels(line, doh) != line.Solfa)
                return null;
        }
        return line;
    }

    /// <summary>A pattern's lengths as written ("2/3" kept a triplet), a beat each and the last held when it gives none.</summary>
    private static IEnumerable<string> RhythmTokens(DrillPattern p)
        => p.Rhythm?.Split(' ', StringSplitOptions.RemoveEmptyEntries)
           ?? p.Tokens.Select((_, i) => i == p.Tokens.Count - 1 ? "2" : "1");
}
