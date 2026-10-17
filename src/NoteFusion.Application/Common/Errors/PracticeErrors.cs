using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Practice (drills, XP, streaks) error codes. Every message is a sentence a singer can act on.</summary>
public static class PracticeErrors
{
    public static readonly Error DrillNotFound =
        Error.Validation("PRACTICE_DRILL_UNKNOWN", "That drill isn't available any more. Open today's drill and sing it again.");

    public static readonly Error NoTake =
        Error.Validation("PRACTICE_TAKE_MISSING", "No recording came through. Sing the drill again.");

    public static readonly Error TrackUnknown =
        Error.Validation("PRACTICE_TRACK_UNKNOWN", "Pick a practice style: Playful or Focused.");

    /// <summary>The account has had its day's drills marked (<see cref="Practice.PracticeRules.DrillGradesPerDay"/>).</summary>
    public static Error DailyDrillLimit(int limit) =>
        Error.Forbidden("PRACTICE_DAILY_LIMIT", $"That's your {limit} marked drills for today. Well sung! Come back tomorrow for more.");
}
