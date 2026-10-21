using NoteFusion.Core.Entities;

namespace NoteFusion.Application.Practice;

/// <summary>
/// The Halloween season's Midnight path: six short drills from the songs for Halloween we publish (the Mountain King's
/// tiptoe and its climb, Bach's Toccata turn, the skeletons' waltz from Danse Macabre, the Marionette's fall, and
/// Chopin's Funeral March to finish), served only while the season is on, as the carols path is at
/// Christmas (<see cref="SeasonPath"/>). All six passed earn the "Night Singer" badge, earned only in season and kept for good.
/// </summary>
/// <remarks>
/// Every drill is a run of its tune as its page publishes it (a test reads <c>web-site/hymns/pack.json</c>), labelled by
/// the solfa engine. The minor tunes are written la-based, from their relative major's doh, as the hymn book writes them;
/// a raised note is named for where it goes (<c>fe</c>, <c>se</c>), a lowered one too (<c>sa</c>). The Marionette's fall is
/// sung a fourth lower than the page prints it, to stay in the comfortable range (its doh moves with it). Chopin's march
/// keeps its semiquavers, so it is sung at 50 crotchets a minute, the fastest at which a semiquaver lasts
/// <see cref="PracticeRules.ShortestNoteSeconds"/>.
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
        // IN THE HALL OF THE MOUNTAIN KING, B minor (doh D): the tiptoe up from low lah, la-based minor (bar 1).
        new(1, "midnight-king", "Mountain King run", "In the Hall of the Mountain King", "tune-in-the-hall-of-the-mountain-king",
            "the Mountain King's tiptoe", null, 62, "4/4", 0, 96,
            "l, t, d r m d m", ".5 .5 .5 .5 .5 .5 1"),
        // TOCCATA IN D MINOR, D minor (doh F): the turn on the top note, then the fall to low lah through se.
        new(2, "midnight-toccata", "Toccata turn", "Toccata in D minor", "tune-toccata-in-d-minor",
            "Bach's organ turn", null, 65, "4/4", 0, 80,
            "m r m r d t, l, se, l,", ".5 .5 2 .5 .5 .5 .5 1 2"),
        // IN THE HALL OF THE MOUNTAIN KING: its answer, a fifth up, climbing through the raised notes fe and se (bar 9).
        new(3, "midnight-climb", "The climb", "In the Hall of the Mountain King", "tune-in-the-hall-of-the-mountain-king",
            "the Mountain King's climb", null, 62, "4/4", 0, 96,
            "m fe se l t se t", ".5 .5 .5 .5 .5 .5 1"),
        // DANSE MACABRE, G minor (doh B♭): the skeletons' waltz, falling a semitone at a time through sa.
        new(4, "midnight-waltz", "Skeleton waltz", "Danse Macabre", "tune-danse-macabre",
            "the skeletons' waltz", null, 58, "3/4", 0, 100,
            "l l s s sa sa f f m", "2 1 2 1 2 1 2 1 1"),
        // FUNERAL MARCH OF A MARIONETTE, D minor: the fall from soh down to low te, sung a fourth lower (doh C).
        new(5, "midnight-march", "Marionette march", "Funeral March of a Marionette", "tune-funeral-march-of-a-marionette",
            "the Marionette's fall", null, 60, "6/8", 2, 96,
            "s t l se f m r d t,", ".5 1 .5 .5 .5 .5 .5 .5 .5"),
        // CHOPIN'S FUNERAL MARCH, B♭ minor (doh D♭): the tolling bell, dum, dum-da-dum on lah, then the turn down from
        // doh through te (bars 3–4). The tune sits about lah, so the unmarked octave starts at the doh below it.
        new(6, "midnight-chopin", "Funeral bell", "Chopin's Funeral March", "tune-chopins-funeral-march",
            "Chopin's funeral bell", null, 49, "4/4", 0, 50,
            "l l l l d' t t l l l l", "1 .75 .25 1 .75 .25 .75 .25 .75 .25 2"),
    ];

    public static readonly SeasonPath Path = new(
        Season, Title, BadgeCode, "Night Singer", "Sing all six drills on the Midnight path.", CodePrefix, Drills);
}
