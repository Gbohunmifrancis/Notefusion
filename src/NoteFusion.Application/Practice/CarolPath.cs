using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice;

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
    public const double HeldLastBeats = SeasonPath.HeldLastBeats;

    public static readonly IReadOnlyList<SeasonDrillDefinition> Drills =
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

    /// <summary>The carols path as a <see cref="SeasonPath"/>: what everything that reads any season's path uses.</summary>
    public static readonly SeasonPath Path = new(
        Season, Title, BadgeCode, "Carol singer", "Sing all six carols on the Christmas path.", CodePrefix, Drills);

    public static int Count => Drills.Count;

    /// <summary>Whether a drill id is a carol drill's (its takes are the carols path's, never the main path's).</summary>
    public static bool IsCarol(string? drillId) => Path.Owns(drillId);

    /// <summary>The track's take of a carol drill: Playful's shorter and slower, else the full one.</summary>
    public static SeasonDrill For(SeasonDrillDefinition definition, PracticeTrack? track) => Path.For(definition, track);

    /// <summary>The carol drill an id names (<c>code@doh</c>, <c>~gentle</c> for Playful's), or null when it names none.</summary>
    public static SeasonDrill? Find(string? id) => Path.Find(id);

    /// <summary>A carol drill placed on its doh (<see cref="SeasonPath.Build"/>).</summary>
    public static SeasonDrill Build(SeasonDrillDefinition definition, bool gentle = false) => SeasonPath.Build(definition, gentle);

    /// <summary>Where a singer stands on each carol drill, from their marked takes (drill id and mark), in path order.</summary>
    public static IReadOnlyList<SeasonStanding> Read(IEnumerable<(string? DrillId, int Score)> takes) => Path.Read(takes);

    /// <summary>How many of the carol drills the takes passed: the Carol singer badge's progress.</summary>
    public static int Sung(IEnumerable<(string? DrillId, int Score)> takes) => Path.Sung(takes);

    /// <summary>The next drill to sing: the first not yet passed, or null once all are.</summary>
    public static SeasonDrillDefinition? Next(IReadOnlyList<SeasonStanding> standings) => SeasonPath.Next(standings);
}
