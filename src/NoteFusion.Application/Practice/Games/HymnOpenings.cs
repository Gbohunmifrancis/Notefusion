using System.Globalization;

namespace NoteFusion.Application.Practice.Games;

/// <summary>A hymn's opening as Name that hymn plays it: from its first note, in quarter-note beats.</summary>
public sealed record HymnOpening(
    string Slug,
    string Title,
    string? FirstLine,
    string Key,
    string TimeSignature,
    int TempoBpm,
    IReadOnlyList<(int PitchMidi, double StartBeat, double DurBeats)> Notes);

/// <summary>
/// The hymns Name that hymn asks about: well-known hymns and gospel songs we publish, each with the opening the game
/// plays. The notes are the hymn page's own, cut by <see cref="Cut"/> (a test reads <c>web-site/hymns/pack.json</c> and
/// checks every entry), so a hymn edited on the site fails the build until its line here is regenerated. A tune page
/// (<c>tune-…</c>) is named for the song people know it as and has no first line.
/// </summary>
public static class HymnOpenings
{
    /// <summary>Bars after any pickup the opening plays, and at most this many more while it has under <see cref="MinNotes"/> notes.</summary>
    public const int Bars = 2;
    public const int ExtraBars = 2;
    public const int MinNotes = 7;

    public static readonly IReadOnlyList<HymnOpening> All =
    [
        Entry("amazing-grace", "Amazing Grace", "Amazing grace! how sweet the sound", "G major", "3/4", 76, "62:0:1 67:1:2 71:3:0.5 67:3.5:0.5 71:4:2 69:6:1 67:7:2 64:9:1"),
        Entry("abide-with-me", "Abide with Me", "Abide with me; fast falls the eventide;", "Eb major", "4/4", 72, "67:0:2 67:2:1 65:3:1 63:4:2 70:6:2 72:8:1 70:9:1 70:10:1 68:11:1"),
        Entry("blessed-assurance", "Blessed Assurance", "Blessed assurance, Jesus is mine!", "D major", "9/8", 100, "66:0:0.5 64:0.5:0.5 62:1:0.5 69:1.5:1.5 69:3:1.5 67:4.5:0.5 69:5:0.5 71:5.5:0.5 69:6:3 69:9:0.5 66:9.5:0.5 69:10:0.5"),
        Entry("holy-holy-holy", "Holy, Holy, Holy! Lord God Almighty", "Holy, holy, holy! Lord God Almighty!", "D major", "4/4", 92, "62:0:1 62:1:1 66:2:1 66:3:1 69:4:2 69:6:2 71:8:2 71:10:1 71:11:1"),
        Entry("it-is-well-with-my-soul", "It Is Well with My Soul", "When peace, like a river, attendeth my way,", "Db major", "4/4", 76, "68:0:1 68:1:2 66:3:1 65:4:1 65:5:2 63:7:1 65:8:1"),
        Entry("what-a-friend-we-have-in-jesus", "What a Friend We Have in Jesus", "What a friend we have in Jesus,", "F major", "4/4", 92, "72:0:1.5 72:1.5:0.5 74:2:0.5 72:2.5:0.5 69:3:0.5 65:3.5:0.5 65:4:2 62:6:2"),
        Entry("nearer-my-god-to-thee", "Nearer, My God, to Thee", "Nearer, my God, to Thee, nearer to Thee!", "G major", "6/4", 108, "71:0:3 69:3:2 67:5:1 67:6:2 64:8:1 64:9:3 62:12:3 67:15:2 71:17:1"),
        Entry("all-hail-the-power-of-jesus-name", "All Hail the Power of Jesus’ Name", "All hail the power of Jesus’ name!", "G major", "4/4", 100, "62:0:1 67:1:1 67:2:1 71:3:1 71:4:1 69:5:1 67:6:1 69:7:1 71:8:1"),
        Entry("o-come-all-ye-faithful", "O Come, All Ye Faithful", "O come, all ye faithful,", "G major", "4/4", 100, "67:0:1 67:1:2 62:3:1 67:4:1 69:5:2 62:7:2 71:9:1 69:10:1 71:11:1 72:12:1"),
        Entry("joy-to-the-world", "Joy to the World", "Joy to the world, the Lord is come!", "D major", "2/4", 80, "74:0:1 73:1:0.75 71:1.75:0.25 69:2:1.5 67:3.5:0.5 66:4:1 64:5:1"),
        Entry("silent-night", "Silent Night", "Silent night, holy night,", "Bb major", "6/8", 78, "65:0:1.5 67:1.5:0.5 65:2:1 62:3:3 65:6:1.5 67:7.5:0.5 65:8:1"),
        Entry("to-god-be-the-glory", "To God Be the Glory", "To God be the glory, great things He hath done!", "Ab major", "3/4", 120, "63:0:1 63:1:2 65:3:0.5 67:3.5:0.5 68:4:1 63:5:1 68:6:1"),
        Entry("guide-me-o-thou-great-jehovah", "Guide Me, O Thou Great Jehovah", "Guide me, O Thou great Jehovah,", "G major", "4/4", 84, "62:0:1 64:1:1 62:2:1.5 67:3.5:0.5 67:4:0.5 66:4.5:0.5 67:5:0.5 69:5.5:0.5 71:6:1 69:7:1"),
        Entry("praise-my-soul-the-king-of-heaven", "Praise My Soul the King of Heaven", "Praise, my soul, the King of heaven;", "Eb major", "2/4", 120, "70:0:1 70:1:1 70:2:1 70:3:1 75:4:1 74:5:1 72:6:2"),
        Entry("crown-him-with-many-crowns", "Crown Him with Many Crowns", "Crown Him with many crowns,", "D major", "4/4", 100, "62:0:1 62:1:0.5 62:1.5:0.5 66:2:1 66:3:1 71:4:3 71:7:1"),
        Entry("when-i-survey-the-wondrous-cross", "When I Survey the Wondrous Cross", "When I survey the wondrous cross", "D major", "3/4", 92, "62:0:1 66:1:1 67:2:1 64:3:1 62:4:2 66:6:1 69:7:2 71:9:1"),
        Entry("a-mighty-fortress-is-our-god", "A Mighty Fortress Is Our God", "A mighty fortress is our God,", "D major", "4/4", 110, "74:0:1 74:1:1 74:2:1 69:3:0.5 71:3.5:0.5 73:4:1 74:5:0.5 73:5.5:0.5 71:6:1 69:7:1 74:8:1"),
        Entry("jesus-loves-me", "Jesus Loves Me", "Jesus loves me! this I know,", "Eb major", "4/4", 100, "70:0:1 67:1:1 67:2:1 65:3:1 67:4:1 70:5:1 70:6:2"),
        Entry("o-for-a-thousand-tongues", "O for a Thousand Tongues", "O for a thousand tongues to sing", "Ab major", "3/2", 132, "63:0:2 68:2:1 68:3:1 70:4:2 70:6:2 72:8:1 70:9:1 68:10:2 70:12:2"),
        Entry("come-thou-fount-of-every-blessing", "Come, Thou Fount of Every Blessing", "Come, Thou Fount of every blessing,", "Eb major", "3/4", 90, "67:0:0.5 65:0.5:0.5 63:1:1 63:2:1 67:3:0.5 70:3.5:0.5 65:4:1 65:5:1 67:6:0.5 70:6.5:0.5"),
        Entry("the-churchs-one-foundation", "The Church’s One Foundation", "The Church’s one foundation", "D major", "4/4", 96, "66:0:1 66:1:1 66:2:1 67:3:1 66:4:1 66:5:2 64:7:1 62:8:1"),
        Entry("all-people-that-on-earth-do-dwell", "All People That on Earth Do Dwell", "All people that on earth do dwell,", "G major", "4/4", 84, "67:0:2 67:2:1 66:3:1 64:4:1 62:5:1 67:6:1 69:7:1"),
        Entry("praise-to-the-lord-the-almighty", "Praise to the Lord, the Almighty", "Praise to the Lord, the Almighty, the King of creation!", "G major", "3/4", 120, "67:0:1 67:1:1 74:2:1 71:3:1.5 69:4.5:0.5 67:5:1 66:6:1 64:7:1 62:8:1"),
        Entry("o-god-our-help-in-ages-past", "O God, Our Help in Ages Past", "O God, our help in ages past,", "C major", "4/4", 92, "67:0:1 64:1:1 69:2:1 67:3:1 72:4:1 72:5:1 71:6:1 72:7:1 67:8:1"),
        Entry("hark-the-herald-angels-sing", "Hark! The Herald Angels Sing", "Hark! the herald angels sing", "F major", "4/4", 104, "60:0:1 65:1:1 65:2:1.5 64:3.5:0.5 65:4:1 69:5:1 69:6:1 67:7:1"),
        Entry("o-little-town-of-bethlehem", "O Little Town of Bethlehem", "O little town of Bethlehem,", "F major", "4/4", 100, "69:0:1 69:1:1 69:2:1 68:3:1 69:4:1 72:5:1 70:6:1 62:7:1 67:8:1"),
        Entry("away-in-a-manger", "Away in a Manger", "Away in a manger, no crib for a bed,", "F major", "3/4", 96, "72:0:1 72:1:1.5 70:2.5:0.5 69:3:1 69:4:1.5 67:5.5:0.5 65:6:1"),
        Entry("i-need-thee-every-hour", "I Need Thee Every Hour", "I need Thee every hour,", "Ab major", "3/4", 80, "68:0:1 72:1:1.5 70:2.5:0.5 68:3:0.5 67:3.5:0.5 68:4:2 68:6:1"),
        Entry("when-the-roll-is-called-up-yonder", "When the Roll Is Called Up Yonder", "When the trumpet of the Lord shall sound, and time shall be no more,", "Ab major", "4/4", 100, "68:0:0.75 70:0.75:0.25 72:1:0.75 72:1.75:0.25 72:2:0.75 72:2.75:0.25 72:3:0.75 70:3.75:0.25 68:4:0.75 68:4.75:0.25 70:5:0.75 68:5.75:0.25 68:6:0.75 65:6.75:0.25 63:7:1 68:8:0.75 70:8.75:0.25"),
        Entry("the-first-noel", "The First Noel", "The first Noel the angel did say", "D major", "3/4", 100, "66:0:0.5 64:0.5:0.5 62:1:1.5 64:2.5:0.5 66:3:0.5 67:3.5:0.5 69:4:2 71:6:0.5 73:6.5:0.5"),
        Entry("angels-we-have-heard-on-high", "Angels We Have Heard on High", "Angels we have heard on high", "F major", "4/4", 130, "69:0:1 69:1:1 69:2:1 72:3:1 72:4:1.5 70:5.5:0.5 69:6:2"),
        Entry("what-child-is-this", "What Child Is This?", "What Child is this who, laid to rest", "D major", "6/8", 80, "64:0:0.5 67:0.5:1 69:1.5:0.5 71:2:0.75 72:2.75:0.25 71:3:0.5 69:3.5:1 66:4.5:0.5 62:5:0.75 64:5.75:0.25 66:6:0.5"),
        Entry("all-creatures-of-our-god-and-king", "All Creatures of Our God and King", "All creatures of our God and King", "D major", "6/4", 132, "62:0:2 62:2:1 64:3:1 66:4:1 62:5:1 66:6:1 67:7:1 69:8:4 62:12:2"),
        Entry("jesus-shall-reign", "Jesus Shall Reign", "Jesus shall reign where'er the sun", "Eb major", "2/2", 120, "63:0:2 67:2:1 68:3:1 70:4:2 72:6:1 74:7:1 75:8:2 74:10:1 72:11:1"),
        Entry("pass-me-not-o-gentle-saviour", "Pass Me Not, O Gentle Saviour", "Pass me not, O gentle Saviour,", "Ab major", "4/4", 100, "72:0:1.5 70:1.5:0.5 68:2:0.75 67:2.75:0.25 68:3:0.75 65:3.75:0.25 63:4:2 68:6:2"),
        Entry("take-my-life-and-let-it-be", "Take My Life and Let It Be", "Take my life, and let it be", "G major", "3/4", 132, "67:0:2 67:2:1 66:3:2 62:5:1 72:6:2 72:8:1 71:9:3"),
        Entry("just-as-i-am-without-one-plea", "Just as I Am Without One Plea", "Just as I am, without one plea,", "D major", "6/4", 100, "62:0:0.5 64:0.5:0.5 66:1:2 66:3:1 69:4:1.5 67:5.5:0.5 66:6:1 64:7:1.5 66:8.5:0.5 67:9:1 66:10:2 69:12:1"),
        Entry("savior-like-a-shepherd-lead-us", "Savior, Like a Shepherd Lead Us", "Savior, like a shepherd lead us,", "Eb major", "4/4", 100, "67:0:1 67:1:1 67:2:0.5 65:2.5:0.5 67:3:0.5 68:3.5:0.5 70:4:1 75:5:1 70:6:1 67:7:1"),
        Entry("jesus-christ-is-risen-today", "Jesus Christ Is Risen Today", "Jesus Christ is risen today, Alleluia!", "C major", "4/4", 100, "60:0:1 64:1:1 67:2:1 60:3:1 65:4:1 69:5:1 69:6:1 67:7:1"),
        Entry("for-the-beauty-of-the-earth", "For the Beauty of the Earth", "For the beauty of the earth,", "G major", "4/4", 100, "67:0:1 66:1:0.5 67:1.5:0.5 69:2:1 67:3:1 72:4:1 72:5:1 71:6:2"),
        Entry("come-ye-thankful-people-come", "Come, Ye Thankful People, Come", "Come, ye thankful people, come,", "F major", "4/4", 108, "69:0:1.5 69:1.5:0.5 72:2:1 69:3:1 65:4:1 67:5:1 69:6:2"),
        Entry("it-came-upon-a-midnight-clear", "It Came upon a Midnight Clear", "It came upon the midnight clear,", "Bb major", "6/8", 60, "65:0:0.5 74:0.5:1 69:1.5:0.5 72:2:0.5 70:2.5:0.5 67:3:0.5 65:3.5:1 67:4.5:0.5 65:5:1 65:6:0.5"),
        Entry("tune-power-in-the-blood", "There Is Power in the Blood", null, "Bb major", "4/4", 132, "65:0:1 65:1:0.5 65:1.5:0.5 65:2:1 65:3:0.5 65:3.5:0.5 67:4:1 67:5:0.5 67:5.5:0.5 65:6:1.5 70:7.5:0.5"),
        Entry("tune-trust-and-obey", "Trust and Obey", null, "F major", "3/4", 96, "65:0:0.5 67:0.5:0.5 69:1:1 69:2:1 67:3:1 65:4:2 65:6:0.5 69:6.5:0.5"),
        Entry("tune-sweet-hour", "Sweet Hour of Prayer", null, "Db major", "6/8", 110, "61:0:0.5 65:0.5:1 66:1.5:0.5 68:2:1 68:3:0.5 70:3.5:1 72:4.5:0.5 73:5:1 70:6:0.5"),
        Entry("tune-near-the-cross", "Jesus, Keep Me Near the Cross", null, "F major", "6/4", 132, "69:0:2 70:2:1 69:3:2 67:5:1 65:6:2 62:8:1 62:9:3"),
        Entry("tune-showers-of-blessing", "There Shall Be Showers of Blessing", null, "Bb major", "6/8", 96, "65:0:0.5 65:0.5:0.5 65:1:0.5 65:1.5:0.5 67:2:0.5 69:2.5:0.5 70:3:1.5 65:4.5:1.5"),
        Entry("tune-god-be-with-you", "God Be with You Till We Meet Again", null, "C major", "4/4", 115, "64:0:1.5 64:1.5:0.5 64:2:0.5 64:2.5:0.5 64:3:0.5 64:3.5:0.5 67:4:1 62:5:1 64:6:2"),
        Entry("tune-surrender", "I Surrender All", null, "D major", "4/4", 130, "66:0:1.5 66:1.5:0.5 67:2:1 66:3:1 64:4:1.5 64:5.5:0.5 66:6:1 64:7:1"),
    ];

    private static readonly Dictionary<string, HymnOpening> BySlug = All.ToDictionary(h => h.Slug);

    public static HymnOpening? Find(string slug) => BySlug.GetValueOrDefault(slug);

    /// <summary>Quarter-note beats in a bar of <paramref name="timeSignature"/> ("6/8" is three).</summary>
    public static double BarBeats(string timeSignature)
    {
        var parts = timeSignature.Split('/');
        return int.Parse(parts[0], CultureInfo.InvariantCulture) * 4.0 / int.Parse(parts[1], CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// A hymn's opening: its pickup (which the pack places at the end of the first bar) and <see cref="Bars"/> bars after
    /// it, a bar more at a time (up to <see cref="ExtraBars"/>) while that is under <see cref="MinNotes"/> notes, moved so
    /// the first note is beat 0.
    /// </summary>
    public static IReadOnlyList<(int PitchMidi, double StartBeat, double DurBeats)> Cut(
        IReadOnlyList<(int PitchMidi, double StartBeat, double DurBeats)> notes, string timeSignature, double pickupBeats)
    {
        var bar = BarBeats(timeSignature);
        var end = (pickupBeats > 0 ? bar : 0) + Bars * bar;
        List<(int, double, double)> opening;
        for (var extra = 0; ; extra++, end += bar)
        {
            opening = notes.Where(n => n.StartBeat < end - 1e-9).ToList();
            if (opening.Count >= MinNotes || extra >= ExtraBars)
                break;
        }

        var first = notes[0].StartBeat;
        return opening.Select(n => (n.Item1, Math.Round(n.Item2 - first, 3), n.Item3)).ToList();
    }

    private static HymnOpening Entry(string slug, string title, string? firstLine, string key, string time, int tempo, string notes)
        => new(slug, title, firstLine, key, time, tempo, notes.Split(' ')
            .Select(n => n.Split(':'))
            .Select(p => (int.Parse(p[0], CultureInfo.InvariantCulture), double.Parse(p[1], CultureInfo.InvariantCulture),
                double.Parse(p[2], CultureInfo.InvariantCulture)))
            .ToList());
}
