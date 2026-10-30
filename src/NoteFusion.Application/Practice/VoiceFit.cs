namespace NoteFusion.Application.Practice;

/// <summary>
/// The singer's measured range (<c>users.VoiceRange{Low,High}Midi</c>), when they asked for practice placed in it: of the
/// keys a drill or exercise may be placed in, the ones whose notes sit inside the range. The grader takes a take an
/// octave or two off (a man sings the A3–D5 drills an octave down), so a key fits when its notes, moved by whole
/// octaves, lie within the range, with a semitone's grace at either end. When no key fits, the nearest misses are kept;
/// with no range (or the switch off) every key is.
/// </summary>
public sealed record VoiceFit(int Low, int High)
{
    /// <summary>A semitone either side: the range finder reads a comfortable note, not the very edge.</summary>
    public const int Grace = 1;

    private static readonly int[] OctaveShifts = [-24, -12, 0, 12];

    /// <summary>The fit for a range and the singer's switch; null (every key) unless both ends are known and it is on.</summary>
    public static VoiceFit? For(int? low, int? high, bool placeInRange)
        => placeInRange && low is { } l && high is { } h && h > l ? new VoiceFit(l, h) : null;

    /// <summary>
    /// The keys (unmarked dohs) of <paramref name="placements"/> that fit, in their order: every one whose notes
    /// (<paramref name="offsets"/> from the doh), moved by some whole number of octaves, lie within the range; else those
    /// that miss it by the fewest semitones. Never empty when <paramref name="placements"/> is not.
    /// </summary>
    public IReadOnlyList<int> Choose(IReadOnlyList<int> placements, IReadOnlyList<int> offsets)
    {
        if (placements.Count == 0 || offsets.Count == 0)
            return placements;
        var lowest = offsets.Min();
        var highest = offsets.Max();
        var misses = placements.Select(doh => (Doh: doh, Miss: OctaveShifts.Min(shift => Miss(doh + shift + lowest, doh + shift + highest)))).ToList();
        var best = misses.Min(m => m.Miss);
        return misses.Where(m => m.Miss == best).Select(m => m.Doh).ToList();
    }

    /// <summary>How many semitones a span sticks out of the range (with its grace), 0 when it sits inside.</summary>
    private int Miss(int bottom, int top)
        => Math.Max(0, Low - Grace - bottom) + Math.Max(0, top - (High + Grace));
}
