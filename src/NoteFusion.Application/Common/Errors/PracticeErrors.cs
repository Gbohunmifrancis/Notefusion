using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Practice (drills, XP, streaks) error codes. Every message is a sentence a singer can act on.</summary>
public static class PracticeErrors
{
    public static readonly Error DrillNotFound =
        Error.Validation("PRACTICE_DRILL_UNKNOWN", "That drill isn't available any more. Open Practice for your next drill.");

    public static readonly Error NoTake =
        Error.Validation("PRACTICE_TAKE_MISSING", "No recording came through. Sing the drill again.");

    public static readonly Error ReminderHour =
        Error.Validation("PRACTICE_REMINDER_HOUR", "Pick a reminder time between 8 in the morning and 9 at night.");

    public static readonly Error TrackUnknown =
        Error.Validation("PRACTICE_TRACK_UNKNOWN", "Pick a practice style: Playful or Focused.");

    /// <summary>The account has had its day's drills marked (<see cref="Practice.PracticeRules.DrillGradesPerDay"/>).</summary>
    public static Error DailyDrillLimit(int limit) =>
        Error.Forbidden("PRACTICE_DAILY_LIMIT", $"That's all {limit} of today's marked drills. Well sung! More from midnight.");
}
