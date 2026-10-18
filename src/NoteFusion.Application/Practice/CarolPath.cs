using System.Globalization;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice;

/// <summary>
/// One drill of the carols path, as written: a phrase of a carol we publish (<see cref="HymnSlug"/>), its notes as solfa
/// with hymn-book octave marks and its lengths in beats, in the carol's own key where it fits the comfortable range.
/// Playful sings the first <see cref="PlayfulNotes"/> notes when it has a shorter take. <see cref="Backing"/> is the
/// tune the piano plays while the singer sings a part under it (same rhythm); <see cref="Syllables"/> a sing-along's
/// words, a syllable a note ("" where a note carries on the one before).
/// </summary>
public sealed record CarolDrillDefinition(
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

/// <summary>A carol drill placed: the drill the grader marks, and what the piano plays and the words, cut to the same notes.</summary>
public sealed record CarolDrill(
    CarolDrillDefinition Definition,
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

/// <summary>A carol drill on one singer's path: passed (marked <see cref="PracticeRules.PassScore"/> or more) and its best mark.</summary>
public sealed record CarolStanding(CarolDrillDefinition Definition, bool Passed, int? BestScore);

/// <summary>
/// The Christmas season's carols path: six short drills from carols we hold (a Gloria warm-up, Joy to the World's
/// falling scale, Silent Night in thirds and sung along with its words, Hark! the Herald's leap and the First Noel's
/// climb), served only while the season is on (<see cref="Flags.FeatureFlags"/>). A side-path with its own place: its
/// drills are marked by the same grader, earn XP and count against the day's drills like any other, and never move
/// the main path (their ids are never a path's offer). All six passed earn the "Carol singer" badge, which can be
/// earned only while the season is on and is kept for good.
/// </summary>
/// <remarks>
/// <para>
/// <b>Real notes.</b> Every drill is a run of its carol's melody as the hymn page publishes it (a test reads
/// <c>web-site/hymns/pack.json</c> and checks), labelled by the solfa engine like every drill (<see cref="Build"/>
/// throws if a label differs from what is written). Sing in thirds is the hymn-book alto under Silent Night's tune, a
/// third below, labelled from the tune's doh as parts are. Two rhythm changes keep every note markable
/// (<see cref="PracticeRules.ShortestNoteSeconds"/>): Joy to the World's dotted quaver and semiquaver ("to the") are
/// sung as two even quavers, and each drill's last note is held for at least two beats, as every drill's is.
/// </para>
/// <para>
/// <b>Order.</b> The next drill is the first not yet passed; any may be sung again, and a pass counts whenever it was
/// sung, on either pace (Playful's gentle drills share their codes). Playful sings the shorter takes at
/// <see cref="PracticeRules.PlayfulTempoDrop"/> slower; no track and Focused, the full ones.
/// </para>
/// </remarks>
public static class CarolPath
{
    public const string Season = "christmas";
    public const string Title = "Carols for Christmas";
    public const string BadgeCode = "carol_singer";

    /// <summary>Every carol drill's code starts so, which is how its takes are told from the main path's.</summary>
    public const string CodePrefix = "carol-";

    /// <summary>The fewest beats a drill's last note is held for.</summary>
    public const double HeldLastBeats = 2;

    public static readonly IReadOnlyList<CarolDrillDefinition> Drills =
    [
        // GLORIA, F major: the "Glo-" melisma of the refrain, in one breath (bars 9–12).
        new(1, "carol-gloria", "Gloria warm-up", "Angels We Have Heard on High", "angels-we-have-heard-on-high",
            "the Gloria warm-up", "one breath", 65, "4/4", 0, 96,
            "s l s f m f s f m r m f m r d r", "2 .5 .5 .5 .5 2 .5 .5 .5 .5 2 .5 .5 .5 .5 1.5",
            PlayfulNotes: 6),
        // ANTIOCH, D major: "Joy to the world, the Lord is come!", the scale from the top doh down.
        new(2, "carol-joy", "All the way down", "Joy to the World", "joy-to-the-world",
            "Joy to the World, all the way down", null, 62, "2/4", 0, 80,
            "d' t l s f m r d", "1 .5 .5 1.5 .5 1 1 1.5"),
        // STILLE NACHT, B♭ major: the alto under "Silent night, holy night", the tune on the piano.
        new(3, "carol-thirds", "Sing in thirds", "Silent Night", "silent-night",
            "Silent Night, in thirds", null, 58, "6/8", 0, 78,
            "m f m d m f m d", "1.5 .5 1 3 1.5 .5 1 3",
            PlayfulNotes: 4, Backing: "s l s m s l s m"),
        // STILLE NACHT, the whole first verse with its words, in A (in B♭ it climbs to E♭5, past the comfortable top).
        new(4, "carol-along", "Sing along", "Silent Night", "silent-night",
            "Silent Night, sing along", "the first verse, with the words", 57, "6/8", 0, 78,
            "s l s m s l s m r' r' t d' d' s l l d' t l s l s m l l d' t l s l s m r' r' f' r' t d' m' d' s m s f r d",
            "1.5 .5 1 3 1.5 .5 1 3 2 1 3 2 1 3 2 1 1.5 .5 1 1.5 .5 1 3 2 1 1.5 .5 1 1.5 .5 1 3 2 1 1.5 .5 1 3 3 1 1 1 1.5 .5 1 3",
            Syllables:
            [
                "Si", "lent", "night,", "", "ho", "ly", "night,", "", "All", "is", "calm,", "all", "is", "bright,",
                "Round", "yon", "vir", "gin", "moth", "er", "and", "child.", "", "Ho", "ly", "in", "fant", "so", "ten", "der",
                "and", "mild,", "Sleep", "in", "heav", "en", "ly", "peace,", "", "Sleep", "in", "heav", "en", "ly", "peace.", "",
            ],
            Words:
            [
                "Silent night, holy night,", "All is calm, all is bright", "Round yon Virgin Mother and Child.",
                "Holy Infant, so tender and mild,", "Sleep in heavenly peace,", "Sleep in heavenly peace.",
            ]),
        // MENDELSSOHN, F major: "Hark! the herald angels sing", from low soh up to doh.
        new(5, "carol-hark", "Leap up to doh", "Hark! The Herald Angels Sing", "hark-the-herald-angels-sing",
            "Hark! The Herald Angels Sing, leap up to doh", null, 65, "4/4", 0, 96,
            "s, d d t, d m m r", "1 1 1.5 .5 1 1 1 1",
            PlayfulNotes: 5),
        // THE FIRST NOEL, D major: "The first Noel", up the scale to soh (from the pickup).
        new(6, "carol-noel", "Step up to soh", "The First Noel", "the-first-noel",
            "The First Noel, step up to soh", null, 62, "3/4", 1, 96,
            "m r d r m f s", ".5 .5 1.5 .5 .5 .5 2"),
    ];

    public static int Count => Drills.Count;

    /// <summary>Whether a drill id is a carol drill's (its takes are the carols path's, never the main path's).</summary>
    public static bool IsCarol(string? drillId) => drillId?.StartsWith(CodePrefix, StringComparison.Ordinal) == true;

    /// <summary>The track's take of a carol drill: Playful's shorter and slower, else the full one.</summary>
    public static CarolDrill For(CarolDrillDefinition definition, PracticeTrack? track)
        => Build(definition, gentle: track == PracticeTrack.Playful);

    /// <summary>The carol drill an id names (<c>code@doh</c>, <c>~gentle</c> for Playful's), or null when it names none.</summary>
    public static CarolDrill? Find(string? id)
    {
        if (!IsCarol(id))
            return null;
        var gentle = id!.EndsWith(DrillCatalogue.GentleSuffix, StringComparison.Ordinal);
        var parts = (gentle ? id[..^DrillCatalogue.GentleSuffix.Length] : id).Split('@');
        if (parts.Length != 2 || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var doh))
            return null;
        var definition = Drills.FirstOrDefault(d => d.Code == parts[0]);
        return definition is null || definition.DohMidi != doh ? null : Build(definition, gentle);
    }

    /// <summary>
    /// A carol drill placed on its doh: pitches from the syllables, labels from the solfa engine (from the tune's doh
    /// when the singer sings a part under it), the last note held, Playful's take cut short and slowed. Throws when the
    /// engine would label it otherwise than written: a mistake in this file.
    /// </summary>
    public static CarolDrill Build(CarolDrillDefinition definition, bool gentle = false)
    {
        var tokens = Tokens(definition.Solfa);
        var beats = definition.Rhythm.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(b => double.Parse(b, CultureInfo.InvariantCulture)).ToList();
        if (beats.Count != tokens.Count)
            throw new InvalidOperationException($"Carol drill '{definition.Code}' has {tokens.Count} notes but {beats.Count} lengths.");
        var backingTokens = definition.Backing is null ? null : Tokens(definition.Backing);
        if (backingTokens is not null && backingTokens.Count != tokens.Count)
            throw new InvalidOperationException($"Carol drill '{definition.Code}' has {tokens.Count} notes but {backingTokens.Count} in its backing.");
        if (definition.Syllables is { } syllables && syllables.Count != tokens.Count)
            throw new InvalidOperationException($"Carol drill '{definition.Code}' has {tokens.Count} notes but {syllables.Count} syllables.");

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
        return new CarolDrill(definition, drill, backing, definition.Syllables?.Take(count).ToList(), gentle);
    }

    /// <summary>Where a singer stands on each carol drill, from their marked takes (drill id and mark), in path order.</summary>
    public static IReadOnlyList<CarolStanding> Read(IEnumerable<(string? DrillId, int Score)> takes)
    {
        var best = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var (drillId, score) in takes)
        {
            if (!IsCarol(drillId))
                continue;
            var code = drillId!.Split('@')[0];
            best[code] = Math.Max(score, best.GetValueOrDefault(code, int.MinValue));
        }
        return Drills
            .Select(d => best.TryGetValue(d.Code, out var mark)
                ? new CarolStanding(d, mark >= PracticeRules.PassScore, mark)
                : new CarolStanding(d, false, null))
            .ToList();
    }

    /// <summary>How many of the carol drills the takes passed: the Carol singer badge's progress.</summary>
    public static int Sung(IEnumerable<(string? DrillId, int Score)> takes) => Read(takes).Count(s => s.Passed);

    /// <summary>The next drill to sing: the first not yet passed, or null once all are.</summary>
    public static CarolDrillDefinition? Next(IReadOnlyList<CarolStanding> standings)
        => standings.FirstOrDefault(s => !s.Passed)?.Definition;

    private static List<string> Tokens(string solfa) => solfa.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();

    private static List<NoteEventDto> Label(
        CarolDrillDefinition definition, IReadOnlyList<int> pitches, IReadOnlyList<double> beats, MusicalKey key, int reference,
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
                $"Carol drill '{definition.Code}' ({what}) is labelled \"{labels}\" by the solfa engine, not \"{string.Join(' ', written)}\".");
        return notes;
    }
}
