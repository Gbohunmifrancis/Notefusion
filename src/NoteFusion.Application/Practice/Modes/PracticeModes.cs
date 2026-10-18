using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Modes;

/// <summary>
/// The server's switches for the practice modes (section <c>PracticeModes</c>): <c>PracticeModes__WarmUp</c>,
/// <c>__PitchMatch</c>, <c>__Intervals</c>, <c>__Harmony</c>, <c>__Runs</c>, <c>__Rhythm</c>, each on unless set to
/// false. A mode switched off leaves the progress response's <c>modes</c> (so the clients stop showing it, no app update
/// needed) and its routes answer <c>PRACTICE_MODE_OFF</c>.
/// </summary>
public sealed class PracticeModeSettings
{
    public bool WarmUp { get; init; } = true;
    public bool PitchMatch { get; init; } = true;
    public bool Intervals { get; init; } = true;
    public bool Harmony { get; init; } = true;
    public bool Runs { get; init; } = true;
    public bool Rhythm { get; init; } = true;

    public bool IsOn(string mode) => mode switch
    {
        PracticeModes.WarmUp => WarmUp,
        PracticeModes.PitchMatch => PitchMatch,
        PracticeModes.Intervals => Intervals,
        PracticeModes.Harmony => Harmony,
        PracticeModes.Runs => Runs,
        PracticeModes.Rhythm => Rhythm,
        _ => false
    };
}

/// <summary>
/// "More ways to practise": the six modes beside the practice path, their wire ids, which track lists which, and the
/// <see cref="PracticeKind"/> each records. Every marked mode is marked by the server and spends one of the day's
/// marked drills (<see cref="PracticeRules.UsesDrillAllowance"/>); the warm-up is never marked. None moves the path.
/// </summary>
public static class PracticeModes
{
    public const string WarmUp = "warm-up";
    public const string PitchMatch = "pitch-match";
    public const string Runs = "runs";
    public const string Intervals = "intervals";
    public const string Harmony = "harmony";
    public const string Rhythm = "rhythm";

    /// <summary>Every mode, in the order the hub lists them (Focused, and no track chosen).</summary>
    public static readonly IReadOnlyList<string> All = [WarmUp, PitchMatch, Runs, Intervals, Harmony, Rhythm];

    /// <summary>Playful's four: riffs and harmony are beyond its gentle path.</summary>
    public static readonly IReadOnlyList<string> Playful = [WarmUp, PitchMatch, Intervals, Rhythm];

    /// <summary>The modes with exercises to mark (all but the warm-up).</summary>
    public static readonly IReadOnlyList<string> Marked = [PitchMatch, Runs, Intervals, Harmony, Rhythm];

    /// <summary>The modes a track lists, in the hub's order.</summary>
    public static IReadOnlyList<string> ForTrack(PracticeTrack? track) => track == PracticeTrack.Playful ? Playful : All;

    /// <summary>The modes a track lists that the server has switched on.</summary>
    public static IReadOnlyList<string> Live(PracticeTrack? track, PracticeModeSettings settings)
        => ForTrack(track).Where(settings.IsOn).ToList();

    /// <summary>The practice row a mode's take is recorded as; null for the warm-up (never marked) and anything else.</summary>
    public static PracticeKind? KindOf(string mode) => mode switch
    {
        PitchMatch => PracticeKind.PitchMatch,
        Intervals => PracticeKind.Interval,
        Harmony => PracticeKind.Harmony,
        Runs => PracticeKind.Run,
        Rhythm => PracticeKind.Rhythm,
        _ => null
    };
}
