namespace NoteFusion.Core.Enums;

/// <summary>
/// What a graded practice was. Wire values "drill" / "part" / "pitchMatch" … A kind is a row's XP rule and badge pool,
/// so a later one (a choir challenge, a track's lesson) is a new value here and a line in <c>PracticeRules.BaseXp</c>.
/// Stored as an int: a new value needs no migration.
/// </summary>
public enum PracticeKind
{
    /// <summary>The free daily solfa drill (<c>POST /api/practice/drills/grade</c>).</summary>
    Drill = 0,

    /// <summary>A part of a sheet sung back and marked (Learn my part / Sing it, <c>POST /api/transcriptions/grade</c>).</summary>
    Part = 1,

    // The practice modes (POST /api/practice/modes/grade). Each spends one of the day's marked drills and earns as a
    // drill does; none moves the practice path, which reads Drill rows only.

    /// <summary>A pitch-match set: eight held notes, each after its reference tone, in one take.</summary>
    PitchMatch = 2,

    /// <summary>An interval: doh, then the note asked.</summary>
    Interval = 3,

    /// <summary>A harmony line sung against a tune the app plays.</summary>
    Harmony = 4,

    /// <summary>A riff or run at one speed: note by note when slow enough, on its shape and landing note at speed.</summary>
    Run = 5,

    /// <summary>A rhythm clapped (or tapped) back, marked clap by clap.</summary>
    Rhythm = 6,

    /// <summary>
    /// A quick game, tapped not sung (<c>POST /api/practice/games/grade</c>): Which note?, Staff to solfa, Name that hymn.
    /// Earns less than a drill and spends none of the day's marked drills.
    /// </summary>
    Game = 7,

    /// <summary>A scale sung up and back down (the Scales mode): major and minor, pentatonic, the modes, the world's.</summary>
    Scale = 8
}
