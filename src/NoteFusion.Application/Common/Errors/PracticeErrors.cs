using NoteFusion.Shared.Results;

namespace NoteFusion.Application.Common.Errors;

/// <summary>Practice (drills, XP, streaks) error codes. Every message is a sentence a singer can act on.</summary>
public static class PracticeErrors
{
    public static readonly Error DrillNotFound =
        Error.Validation("PRACTICE_DRILL_UNKNOWN", "That drill isn't available any more. Open Practice for your next drill.");

    public static readonly Error NoTake =
        Error.Validation("PRACTICE_TAKE_MISSING", "No recording came through. Sing the drill again.");

    /// <summary>A take's lead-in that is not a number of seconds from 0 to the older apps' two bars.</summary>
    public static readonly Error LeadIn =
        Error.Validation("PRACTICE_LEAD_IN", "That take's count-in didn't come through. Sing the drill again.");

    public static readonly Error ReminderHour =
        Error.Validation("PRACTICE_REMINDER_HOUR", "Pick a reminder time between 8 in the morning and 9 at night.");

    /// <summary>The carols path asked for outside the Christmas season.</summary>
    public static readonly Error SeasonOff =
        Error.NotFound("PRACTICE_SEASON_OFF", "The carols are back next Christmas. Your path is in Practice.");

    /// <summary>The Midnight path asked for outside the Halloween season.</summary>
    public static readonly Error MidnightOff =
        Error.NotFound("PRACTICE_SEASON_OFF", "The Midnight path is back next Halloween. Your path is in Practice.");

    /// <summary>A season's path asked for outside its season, or a season there is none of.</summary>
    public static Error SeasonOffFor(string? season) => season == Practice.HalloweenPath.Season ? MidnightOff : SeasonOff;

    public static readonly Error TrackUnknown =
        Error.Validation("PRACTICE_TRACK_UNKNOWN", "Pick a practice style: Playful or Focused.");

    /// <summary>A mode the server does not have ("warm-up", "pitch-match", "intervals", "harmony", "runs", "rhythm").</summary>
    public static readonly Error ModeUnknown =
        Error.NotFound("PRACTICE_MODE_UNKNOWN", "That way to practise isn't here. Open Practice to see what is.");

    /// <summary>A mode switched off on the server (<c>PracticeModes__*</c>).</summary>
    public static readonly Error ModeOff =
        Error.NotFound("PRACTICE_MODE_OFF", "That way to practise is resting for now. Try today's path or another one.");

    public static readonly Error ExerciseNotFound =
        Error.Validation("PRACTICE_EXERCISE_UNKNOWN", "That exercise isn't available any more. Open it again from Practice.");

    /// <summary>A range take that says neither "low" nor "high".</summary>
    public static readonly Error RangeEnd =
        Error.Validation("PRACTICE_RANGE_END", "Say which note this was: your lowest or your highest.");

    /// <summary>A range take with no note held long and steadily enough to read.</summary>
    public static readonly Error RangeNotHeard =
        Error.Validation("PRACTICE_RANGE_NOT_HEARD", "We couldn't hear a steady note. Hold one note for three seconds, close to the microphone.");

    /// <summary>The account has had its day's drills marked (<see cref="Practice.PracticeRules.DrillGradesPerDay"/>).</summary>
    public static Error DailyDrillLimit(int limit) =>
        Error.Forbidden("PRACTICE_DAILY_LIMIT", $"That's all {limit} of today's marked drills. Well sung! More from midnight.");
}
