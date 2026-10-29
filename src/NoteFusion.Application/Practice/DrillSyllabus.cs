namespace NoteFusion.Application.Practice;

/// <summary>
/// The rhythms a drill may use, cumulative up the grades (<see cref="DrillSyllabus.Rhythm"/>). Crotchets are always
/// allowed; a drill's last note is held and never counts as a minim or a tie.
/// </summary>
[Flags]
public enum DrillRhythm
{
    Crotchets = 0,
    /// <summary>Held notes inside the line: minims and dotted minims.</summary>
    Minims = 1,
    Quavers = 2,
    /// <summary>The dotted crotchet and its quaver.</summary>
    Dotted = 4,
    /// <summary>A note held over the bar line.</summary>
    Ties = 8,
    /// <summary>A crotchet (or longer) starting off the beat: quaver–crotchet–quaver.</summary>
    Syncopation = 16,
    /// <summary>Crotchet triplets: three notes in two beats.</summary>
    Triplets = 32
}

/// <summary>One unit of a grade: its title, and what the singer can do once it is sung (the unit milestone's line).</summary>
public sealed record DrillUnit(string Title, string Learned);

/// <summary>
/// What one grade of the practice path asks, on every axis that makes singing harder: length, range, the widest
/// leap, keys (as the dohs a drill is placed on, the minor keys as their relative majors' dohs), rhythm, chromatic
/// notes and tempo. Every pattern of the grade keeps to it (tests pin that), and the grade's five units, easiest
/// first, are its <see cref="DrillPattern.Step"/>s. Drawn from ABRSM's and Trinity's sight-singing parameters, the
/// Kodály sequence and the Tonic Sol-fa College certificates: <c>docs/PRACTICE_CURRICULUM.md</c>.
/// </summary>
/// <param name="Tier">The catalogue tier (0–9); the ladder's levels are tiers 0–7.</param>
/// <param name="Label">"Grade 3", "Advanced 1": what the clients show.</param>
/// <param name="MaxLeap">The widest leap, in semitones, anywhere in a line.</param>
/// <param name="ChordLeap">Leaps up to this are allowed between notes of the doh chord (d m s) even past <paramref name="MaxLeap"/>.</param>
/// <param name="Octaves">Whether an octave leap is allowed.</param>
/// <param name="MajorDohs">Pitch classes a major drill's doh may be on.</param>
/// <param name="MinorDohs">Pitch classes a minor drill's doh may be on (A minor is doh C, so 0); empty: no minor yet.</param>
/// <param name="Chromatic">Whether notes outside the mode are allowed (minor's se and fe are the mode's own).</param>
/// <param name="CanDo">The grade milestone's line, after "You can now".</param>
/// <param name="PlayfulCanDo">The same for Playful's gentler slice of the grade; null when Playful never reaches it.</param>
public sealed record DrillSyllabus(
    int Tier,
    string Label,
    string Focus,
    int MinNotes,
    int MaxNotes,
    int MaxAmbitus,
    int MaxLeap,
    int ChordLeap,
    bool Octaves,
    IReadOnlyList<int> MajorDohs,
    IReadOnlyList<int> MinorDohs,
    DrillRhythm Rhythm,
    bool Chromatic,
    int TempoBpm,
    string CanDo,
    string? PlayfulCanDo,
    IReadOnlyList<DrillUnit> Units)
{
    /// <summary>Units in every grade, easiest first: a pattern's <see cref="DrillPattern.Step"/> is its unit.</summary>
    public const int UnitsPerGrade = 5;

    // Keys, cumulatively as ABRSM's singing sight-singing tests bring them in: C, G, F (Grade 1); D (2); B♭ and
    // A minor (3); A, E♭, E minor, D minor (4); E, B minor, G minor (5); A♭, C minor (6); F♯ minor (7); C♯ minor,
    // F minor (8). Minor keys are listed by their doh (A minor: doh C).
    private const int C = 0, D = 2, Eb = 3, E = 4, F = 5, G = 7, Ab = 8, A = 9, Bb = 10;

    private static readonly int[] Grade1Keys = [C, F, G];
    private static readonly int[] Grade2Keys = [C, D, F, G];
    private static readonly int[] Grade3Keys = [C, D, F, G, Bb];
    private static readonly int[] Grade4Keys = [C, D, Eb, F, G, A, Bb];
    private static readonly int[] Grade5Keys = [C, D, Eb, E, F, G, A, Bb];
    private static readonly int[] AllKeys = [C, D, Eb, E, F, G, Ab, A, Bb];
    private static readonly int[] Grade6Minors = [C, D, Eb, F, G, Bb];
    private static readonly int[] Grade7Minors = [C, D, Eb, F, G, A, Bb];
    private static readonly int[] AllMinors = AllKeys;

    private const DrillRhythm Grade1Rhythm = DrillRhythm.Minims;
    private const DrillRhythm Grade2Rhythm = Grade1Rhythm | DrillRhythm.Quavers;
    private const DrillRhythm Grade4Rhythm = Grade2Rhythm | DrillRhythm.Dotted;
    private const DrillRhythm Grade5Rhythm = Grade4Rhythm | DrillRhythm.Ties;
    private const DrillRhythm Grade6Rhythm = Grade5Rhythm | DrillRhythm.Syncopation;
    private const DrillRhythm Grade8Rhythm = Grade6Rhythm | DrillRhythm.Triplets;

    /// <summary>Every grade, tier by tier: the ladder's eight, then Focused's two Advanced grades.</summary>
    public static readonly IReadOnlyList<DrillSyllabus> All =
    [
        new(0, "Grade 1", "Steps around doh", 3, 7, 5, 2, 2, false, Grade1Keys, [], Grade1Rhythm, false, 72,
            "sing doh, ray, me and fah in tune, step by step, in C, F and G.",
            "sing doh, ray and me in tune.",
            [
                new("Doh, ray, me", "You can sing doh, ray and me, up and down."),
                new("Up and home", "You can step away from doh and find your way home."),
                new("Fah and repeated notes", "You can reach fah and hold a note steady when it repeats."),
                new("Held notes and te below", "You can hold a note for two beats and dip to te below doh."),
                new("Longer lines", "You can sing a seven-note line by step without losing doh."),
            ]),
        new(1, "Grade 2", "The doh chord", 3, 7, 9, 2, 7, false, Grade2Keys, [], Grade2Rhythm, false, 76,
            "leap around the doh chord — doh, me, soh — and sing pairs of quavers.",
            "leap between doh, me and soh.",
            [
                new("Soh and me", "You can sing soh and me, the calling notes."),
                new("Up the chord and back", "You can sing the doh chord up and down."),
                new("Chord and steps", "You can mix leaps in the doh chord with steps."),
                new("Quaver pairs", "You can sing two quavers in a beat."),
                new("Longer chord lines", "You can sing seven-note lines around the doh chord, quavers and all."),
            ]),
        new(2, "Grade 3", "Scales", 4, 8, 12, 5, 7, false, Grade3Keys, [], Grade2Rhythm, false, 80,
            "sing the whole major scale up and down, with leaps of a third and a fourth.",
            "sing the scale from doh to soh and on to the top doh.",
            [
                new("Five-note scales", "You can sing five notes of the scale either way."),
                new("The whole scale", "You can sing the scale from doh to the top doh."),
                new("Thirds", "You can skip a third up or down the scale."),
                new("Fourths and quavers", "You can leap a fourth to the top doh and run in quavers."),
                new("Long scale lines", "You can sing eight-note scale lines with long held notes."),
            ]),
        new(3, "Grade 4", "Leaps", 4, 8, 12, 7, 7, true, Grade4Keys, [], Grade4Rhythm, false, 80,
            "leap a fourth, a fifth and an octave cleanly, and sing dotted rhythms, in keys up to three sharps or flats.",
            "leap a fourth, a fifth and an octave.",
            [
                new("Leaps of a fifth", "You can leap a fifth between doh and soh."),
                new("Leaps of a fourth", "You can leap a fourth from any note."),
                new("The octave", "You can leap a whole octave and land in tune."),
                new("Dotted rhythms", "You can sing a dotted crotchet and its quaver."),
                new("Leaps in longer lines", "You can keep leaps in tune through a long dotted line."),
            ]),
        new(4, "Grade 5", "Below doh and wider", 4, 9, 14, 9, 9, true, Grade5Keys, [], Grade5Rhythm, false, 84,
            "sing below doh to low soh, leap a sixth, and hold notes over the bar line.",
            "sing down to low soh and lah and back.",
            [
                new("Low soh", "You can sing down to low soh and back to doh."),
                new("Down to low lah", "You can sing low lah and te and sweep over the top doh."),
                new("Low soh to soh", "You can sing a whole octave from low soh."),
                new("Sixths and ties", "You can leap a sixth and hold a note over the bar line."),
                new("Wide lines, tied", "You can sing wide, tied lines from low soh to lah."),
            ]),
        new(5, "Grade 6", "Lah: the minor", 3, 10, 14, 9, 9, true, AllKeys, Grade6Minors, Grade6Rhythm, false, 84,
            "sing in the minor, lah to lah, through se the leading note, with syncopated rhythms.",
            "sing low lah in the doh key.",
            [
                new("Low lah in the doh key", "You can sing low lah under doh."),
                new("Lah is home", "You can sing a minor line that rests on lah."),
                new("Se, the leading note", "You can sing se and lead it home to lah."),
                new("Minor sixths and syncopation", "You can leap a minor sixth and sing off the beat."),
                new("Longer minor lines", "You can sing ten-note minor lines through se."),
            ]),
        new(6, "Grade 7", "Te: chromatic notes", 3, 10, 15, 9, 9, true, AllKeys, Grade7Minors, Grade6Rhythm, true, 88,
            "sing the chromatic notes fe, de and ta, and turn a line towards soh or fah.",
            "sing fe, de and ta in short tunes.",
            [
                new("Fe, de and ta", "You can sing fe, de and ta a semitone from home."),
                new("Chromatic turns", "You can sing a chromatic note on the way to the next."),
                new("Neighbour notes", "You can step to a chromatic neighbour and back."),
                new("Chromatic lines", "You can sing fe, de and ta inside a long line."),
                new("Turning to soh and fah", "You can turn a tune towards soh through fe, or fah through ta."),
            ]),
        new(7, "Grade 8", "Choir-ready", 5, 12, 16, 10, 10, true, AllKeys, AllMinors, Grade8Rhythm, true, 88,
            "sing a whole choir line at sight: sevenths, triplets, chromatic notes and a turn to a new key.",
            null,
            [
                new("Long hymn lines", "You can sing an eight-note hymn line from low soh."),
                new("Minor and chromatic lines", "You can sing long minor and chromatic lines."),
                new("Sevenths and dotted hymns", "You can leap a minor seventh and sing a dotted hymn tune."),
                new("Triplets", "You can sing three notes in two beats."),
                new("Modulating phrases", "You can sing a twelve-note phrase that turns to a new key."),
            ]),
        new(8, "Advanced 1", "Wide leaps", 5, 12, 17, 11, 11, true, AllKeys, AllMinors, Grade8Rhythm, true, 84,
            "pitch any leap up to a major seventh, the diminished seventh and the tritone included.",
            null,
            [
                new("Sixths", "You can pitch major and minor sixths from any note."),
                new("Minor sevenths", "You can pitch a minor seventh up or down."),
                new("Major sevenths and the minor", "You can pitch a major seventh and leap to se."),
                new("Diminished sevenths and tritones", "You can sing the diminished seventh and the tritone."),
                new("Wide leaps in rhythm", "You can keep wide leaps in tune in dotted, syncopated and triplet rhythms."),
            ]),
        new(9, "Advanced 2", "Sight-singing", 8, 16, 17, 11, 11, true, AllKeys, AllMinors, Grade8Rhythm, true, 88,
            "sight-sing a sixteen-note phrase in any key: minor, chromatic, modulating, syncopated and tied.",
            null,
            [
                new("Hymn lines", "You can sight-sing a whole hymn line."),
                new("Minor and chromatic lines", "You can sight-sing minor and chromatic lines."),
                new("Turning to new keys", "You can sight-sing a phrase that turns to a new key."),
                new("Syncopation and triplets", "You can sight-sing syncopations and triplets."),
                new("Long phrases", "You can sight-sing a sixteen-note phrase, ties and all."),
            ]),
    ];

    /// <summary>A tier's grade: the ten above, and past them the Mastery tiers (<see cref="MasteryCatalogue.Syllabus"/>).</summary>
    public static DrillSyllabus For(int tier)
        => MasteryCatalogue.IsMastery(tier) ? MasteryCatalogue.Syllabus(tier) : All[Math.Clamp(tier, 0, All.Count - 1)];
}
