using System.Globalization;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice;

/// <summary>
/// One drill of a season's path, as written: a phrase of a song we publish (<see cref="HymnSlug"/>), its notes as solfa
/// with hymn-book octave marks and its lengths in beats, in the song's own key where it fits the comfortable range.
/// Playful sings the first <see cref="PlayfulNotes"/> notes when it has a shorter take. <see cref="Backing"/> is the
/// tune the piano plays while the singer sings a part under it (same rhythm); <see cref="Syllables"/> a sing-along's
/// words, a syllable a note ("" where a note carries on the one before). <see cref="Carol"/> is the song's title (a
/// carol at Christmas; the wire still calls it that).
/// </summary>
public sealed record SeasonDrillDefinition(
    int Index,
    string Code,
    string Title,
    string Carol,
    string HymnSlug,
    string Cue,
    string? Detail,
    int DohMidi,
    string TimeSignature,
    double PickupBeats,
    int TempoBpm,
    string Solfa,
    string Rhythm,
    int? PlayfulNotes = null,
    string? Backing = null,
    IReadOnlyList<string>? Syllables = null,
    IReadOnlyList<string>? Words = null);

/// <summary>A season drill placed: the drill the grader marks, and what the piano plays and the words, cut to the same notes.</summary>
public sealed record SeasonDrill(
    SeasonDrillDefinition Definition,
    Drill Drill,
    IReadOnlyList<NoteEventDto>? Backing,
    IReadOnlyList<string>? Syllables,
    bool Gentle)
{
    /// <summary>The line under the drill's title: a fixed one, "Doh is Bb · 4 notes" for a part, or the solfa sung.</summary>
    public string Detail => Definition.Detail
        ?? (Backing is not null
            ? $"{Drill.Key.DohHeader()} · {Drill.Notes.Count} notes"
            : string.Join(' ', Drill.Notes.Select(n => n.Solfa + n.OctaveMark)));
}

/// <summary>A season drill on one singer's path: passed (marked <see cref="PracticeRules.PassScore"/> or more) and its best mark.</summary>
public sealed record SeasonStanding(SeasonDrillDefinition Definition, bool Passed, int? BestScore);

/// <summary>
/// A season's practice side-path (Christmas's carols, <see cref="CarolPath"/>; Halloween's Midnight path,
/// <see cref="HalloweenPath"/>): six short drills from songs we publish, served only while its season is on
/// (<see cref="Flags.FeatureFlags"/>). Its drills are marked by the same grader, earn XP and count against the day's drills
/// like any other, and never move the main path (their ids are never a path's offer). All of them passed earn the
/// season's badge, which can be earned only while the season is on and is kept for good.
/// </summary>
/// <remarks>
/// <para>
/// <b>Real notes.</b> Every drill is a run of its song's melody as the hymn page publishes it (a test reads
/// <c>web-site/hymns/pack.json</c> and checks), labelled by the solfa engine like every drill (<see cref="Build"/>
/// throws if a label differs from what is written). A la-based minor tune is written from its relative major's doh, as
/// the hymn book writes it. Each drill's last note is held for at least <see cref="HeldLastBeats"/> beats, as every
/// drill's is.
/// </para>
/// <para>
/// <b>Order.</b> The next drill is the first not yet passed; any may be sung again, and a pass counts whenever it was
/// sung, on either pace (Playful's gentle drills share their codes). Playful sings the shorter takes at
/// <see cref="PracticeRules.PlayfulTempoDrop"/> slower; no track and Focused, the full ones.
/// </para>
/// </remarks>
public sealed class SeasonPath
{
    /// <summary>The fewest beats a drill's last note is held for.</summary>
    public const double HeldLastBeats = 2;

    public SeasonPath(
        string season, string title, string badgeCode, string badgeTitle, string badgeDescription, string codePrefix,
        IReadOnlyList<SeasonDrillDefinition> drills)
    {
        Season = season;
        Title = title;
        BadgeCode = badgeCode;
        BadgeTitle = badgeTitle;
        BadgeDescription = badgeDescription;
        CodePrefix = codePrefix;
        Drills = drills;
    }

    /// <summary>The season's flag key ("christmas").</summary>
    public string Season { get; }

    /// <summary>"Carols for Christmas".</summary>
    public string Title { get; }

    /// <summary>The badge all the drills earn ("carol_singer"), its name and what it asks.</summary>
    public string BadgeCode { get; }
    public string BadgeTitle { get; }
    public string BadgeDescription { get; }

    /// <summary>Every drill's code starts so, which is how the path's takes are told from the main path's.</summary>
    public string CodePrefix { get; }

    public IReadOnlyList<SeasonDrillDefinition> Drills { get; }

    public int Count => Drills.Count;

    /// <summary>Whether a drill id is one of this path's (its takes are this path's, never the main path's).</summary>
    public bool Owns(string? drillId) => drillId?.StartsWith(CodePrefix, StringComparison.Ordinal) == true;

    /// <summary>The track's take of a drill: Playful's shorter and slower, else the full one.</summary>
    public SeasonDrill For(SeasonDrillDefinition definition, PracticeTrack? track)
        => Build(definition, gentle: track == PracticeTrack.Playful);

    /// <summary>The drill an id names (<c>code@doh</c>, <c>~gentle</c> for Playful's), or null when it names none of this path's.</summary>
    public SeasonDrill? Find(string? id)
    {
        if (!Owns(id))
            return null;
        var gentle = id!.EndsWith(DrillCatalogue.GentleSuffix, StringComparison.Ordinal);
        var parts = (gentle ? id[..^DrillCatalogue.GentleSuffix.Length] : id).Split('@');
        if (parts.Length != 2 || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var doh))
            return null;
        var definition = Drills.FirstOrDefault(d => d.Code == parts[0]);
        return definition is null || definition.DohMidi != doh ? null : Build(definition, gentle);
    }

    /// <summary>
    /// A drill placed on its doh: pitches from the syllables, labels from the solfa engine (from the tune's doh when the
    /// singer sings a part under it), the last note held, Playful's take cut short and slowed. Throws when the engine
    /// would label it otherwise than written: a mistake in the path's file.
    /// </summary>
    public static SeasonDrill Build(SeasonDrillDefinition definition, bool gentle = false)
    {
        var tokens = Tokens(definition.Solfa);
        var beats = definition.Rhythm.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(b => double.Parse(b, CultureInfo.InvariantCulture)).ToList();
        if (beats.Count != tokens.Count)
            throw new InvalidOperationException($"Season drill '{definition.Code}' has {tokens.Count} notes but {beats.Count} lengths.");
        var backingTokens = definition.Backing is null ? null : Tokens(definition.Backing);
        if (backingTokens is not null && backingTokens.Count != tokens.Count)
            throw new InvalidOperationException($"Season drill '{definition.Code}' has {tokens.Count} notes but {backingTokens.Count} in its backing.");
        if (definition.Syllables is { } syllables && syllables.Count != tokens.Count)
            throw new InvalidOperationException($"Season drill '{definition.Code}' has {tokens.Count} notes but {syllables.Count} syllables.");

        var count = gentle && definition.PlayfulNotes is { } shorter ? shorter : tokens.Count;
        tokens = tokens.Take(count).ToList();
        beats = beats.Take(count).ToList();
        beats[^1] = Math.Max(beats[^1], HeldLastBeats);
        backingTokens = backingTokens?.Take(count).ToList();

        var key = new MusicalKey(definition.DohMidi % 12, KeyMode.Major);
        var pitches = tokens.Select(t => definition.DohMidi + DrillCatalogue.Offset(t)).ToList();
        var backingPitches = backingTokens?.Select(t => definition.DohMidi + DrillCatalogue.Offset(t)).ToList();
        // A part is marked from the tune's doh, so it reads exactly as the hymn book prints it under the tune.
        var reference = SolfaMapper.ReferenceDoh(backingPitches ?? pitches, key.DohPitchClass, key.Mode);

        var notes = Label(definition, pitches, beats, key, reference, tokens, "drill");
        var backing = backingPitches is null ? null : Label(definition, backingPitches, beats, key, reference, backingTokens!, "backing");

        var pattern = new DrillPattern(definition.Code, 0, definition.Index, definition.Title, KeyMode.Major,
            string.Join(' ', tokens), string.Join(' ', beats.Select(b => b.ToString(CultureInfo.InvariantCulture))));
        var id = DrillCatalogue.IdOf(pattern, definition.DohMidi, gentle);
        var tempo = gentle ? definition.TempoBpm - PracticeRules.PlayfulTempoDrop : definition.TempoBpm;
        var drill = new Drill(id, pattern, key, definition.DohMidi, tempo, notes);
        return new SeasonDrill(definition, drill, backing, definition.Syllables?.Take(count).ToList(), gentle);
    }

    /// <summary>Where a singer stands on each of the path's drills, from their marked takes (drill id and mark), in path order.</summary>
    public IReadOnlyList<SeasonStanding> Read(IEnumerable<(string? DrillId, int Score)> takes)
    {
        var best = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (drillId, score) in takes)
        {
            if (!Owns(drillId))
                continue;
            var code = drillId!.Split('@')[0];
            best[code] = Math.Max(score, best.GetValueOrDefault(code, int.MinValue));
        }
        return Drills
            .Select(d => best.TryGetValue(d.Code, out var mark)
                ? new SeasonStanding(d, mark >= PracticeRules.PassScore, mark)
                : new SeasonStanding(d, false, null))
            .ToList();
    }

    /// <summary>How many of the path's drills the takes passed: its badge's progress.</summary>
    public int Sung(IEnumerable<(string? DrillId, int Score)> takes) => Read(takes).Count(s => s.Passed);

    /// <summary>The next drill to sing: the first not yet passed, or null once all are.</summary>
    public static SeasonDrillDefinition? Next(IReadOnlyList<SeasonStanding> standings)
        => standings.FirstOrDefault(s => !s.Passed)?.Definition;

    private static List<string> Tokens(string solfa) => solfa.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();

    private static List<NoteEventDto> Label(
        SeasonDrillDefinition definition, IReadOnlyList<int> pitches, IReadOnlyList<double> beats, MusicalKey key, int reference,
        IReadOnlyList<string> written, string what)
    {
        var ascending = SolfaMapper.AscendingFlags(pitches, key.DohPitchClass);
        var notes = new List<NoteEventDto>(pitches.Count);
        var at = 0.0;
        for (var i = 0; i < pitches.Count; i++)
        {
            var syllable = SolfaMapper.Map(pitches[i], key, reference, ascending[i] ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
            notes.Add(new NoteEventDto(
                pitches[i], Math.Round(at, 6), Math.Round(beats[i], 6), SolfaMapper.Degree(pitches[i], key), syllable.Text, syllable.OctaveMark, 1.0));
            at += beats[i];
        }

        var labels = string.Join(' ', notes.Select(n => n.Solfa + n.OctaveMark));
        if (labels != string.Join(' ', written))
            throw new InvalidOperationException(
                $"Season drill '{definition.Code}' ({what}) is labelled \"{labels}\" by the solfa engine, not \"{string.Join(' ', written)}\".");
        return notes;
    }
}

/// <summary>The seasons' paths: the one for a season key, and the drill any of them owns.</summary>
public static class SeasonPaths
{
    public static IReadOnlyList<SeasonPath> All => [CarolPath.Path, HalloweenPath.Path];

    /// <summary>The path of the season <paramref name="season"/> ("christmas", "halloween"), or null.</summary>
    public static SeasonPath? For(string? season) => All.FirstOrDefault(p => p.Season == season);

    /// <summary>The path that owns a drill id, or null when none does.</summary>
    public static SeasonPath? Owning(string? drillId) => All.FirstOrDefault(p => p.Owns(drillId));

    /// <summary>Whether a drill id is any season path's.</summary>
    public static bool IsSeasonal(string? drillId) => Owning(drillId) is not null;

    /// <summary>The season drill an id names, on whichever path owns it, or null.</summary>
    public static SeasonDrill? Find(string? drillId) => Owning(drillId)?.Find(drillId);

    /// <summary>The season whose path's badge <paramref name="badgeCode"/> is, or null for a badge of no season.</summary>
    public static string? SeasonOfBadge(string badgeCode) => All.FirstOrDefault(p => p.BadgeCode == badgeCode)?.Season;
}
