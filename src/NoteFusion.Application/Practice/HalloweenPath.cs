using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Practice;

/// <summary>
/// The Halloween season's Midnight path: six short drills from the songs for Halloween we publish (the Mountain King's
/// tiptoe, Bach's Toccata turn, a ghostly round, Dem Bones' climb, the Marionette's march, and All Saints to finish, on
/// the eve of All Saints' Day), served only while the season is on, as the carols path is at Christmas
/// (<see cref="SeasonPath"/>). All six passed earn the "Night Singer" badge, earned only in season and kept for good.
/// </summary>
/// <remarks>
/// Every drill is a run of its song's melody as the hymn page publishes it (a test reads <c>web-site/hymns/pack.json</c>),
/// labelled by the solfa engine. The minor tunes are written la-based, from their relative major's doh, as the hymn book
/// writes them; a raised soh is <c>se</c>.
/// </remarks>
public static class HalloweenPath
{
    public const string Season = FeatureFlag.Halloween;
    public const string Title = "The Midnight path";
    public const string BadgeCode = "night_singer";

    /// <summary>Every Midnight drill's code starts so, which is how its takes are told from the main path's.</summary>
    public const string CodePrefix = "midnight-";

    public static readonly IReadOnlyList<SeasonDrillDefinition> Drills =
    [
        // ALL SAINTS (DARMSTADT), C major: its opening line, falling from the top doh (the eve of All Saints' Day).
        new(6, "midnight-saints", "All Saints line", "All Saints (Darmstadt)", "all-saints-darmstadt",
            "All Saints, from the top doh down", null, 60, "4/4", 0, 92,
            "d' s l l s f m d", "1 1 1 1 1.5 .5 1 1"),
    ];

    public static readonly SeasonPath Path = new(
        Season, Title, BadgeCode, "Night Singer", "Sing all six drills on the Midnight path.", CodePrefix, Drills);
}
