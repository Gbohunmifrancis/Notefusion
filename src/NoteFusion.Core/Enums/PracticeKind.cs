namespace NoteFusion.Core.Enums;

/// <summary>
/// What a graded practice was. Wire values "drill" / "part". A kind is a row's XP rule and badge pool, so a later
/// one (a choir challenge, a track's lesson) is a new value here and a line in <c>PracticeRules.BaseXp</c>.
/// </summary>
public enum PracticeKind
{
    /// <summary>The free daily solfa drill (<c>POST /api/practice/drills/grade</c>).</summary>
    Drill = 0,

    /// <summary>A part of a sheet sung back and marked (Learn my part / Sing it, <c>POST /api/transcriptions/grade</c>).</summary>
    Part = 1
}
