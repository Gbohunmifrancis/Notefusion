using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice.Modes;

/// <summary>
/// The warm-up: about three minutes of breath, lip trills, sirens and the range finder. Breath, trills and sirens have
/// no right notes to mark, so nothing here is scored and nothing earns XP (only marked takes do); the range finder
/// measures and keeps the singer's range (<c>POST /api/practice/range</c>). The guides are notes the apps' own synth
/// plays, labelled by the solfa engine, with doh on C (a man sings them an octave down).
/// </summary>
public static class WarmUpRoutine
{
    /// <summary>The guides' doh: C4, rising a step each round.</summary>
    public const int GuideDohMidi = 60;

    public static WarmUpDto Build()
    {
        var steps = new List<WarmUpStepDto>
        {
            new("breathe", "breath", "Breathe", "In for 4, hold for 4, out on \"sss\" for 8.", 45,
                new BreathPatternDto(InCounts: 4, HoldCounts: 4, OutCounts: 8, CountsPerMinute: 64, Cycles: 3), null),
            new("lip-trills", "guide", "Lip trills", "\"Brrr\" on loose lips, five notes up and back. Doh is C, then up a step each time.", 60,
                null, Guide("lip-trills", "d r m f s f m r d", ".5 .5 .5 .5 .5 .5 .5 .5 2", tempo: 92, rounds: 5, step: 1, glide: false)),
            new("sirens", "guide", "Sirens on \"ng\"", "Slide from low to high and back, one smooth line.", 45,
                null, Guide("sirens", "d s d' s d", "2 2 2 2 2", tempo: 60, rounds: 3, step: 1, glide: true)),
            new("range", "range", "Find your range", "Your lowest and highest comfortable notes.", 30, null, null),
        };
        return new WarmUpDto(steps.Sum(s => s.Seconds), steps);
    }

    private static WarmUpGuideDto Guide(string code, string solfa, string rhythm, int tempo, int rounds, int step, bool glide)
    {
        var (key, notes) = DrillCatalogue.Place(new DrillPattern(code, 0, 1, code, KeyMode.Major, solfa, rhythm), GuideDohMidi);
        return new WarmUpGuideDto($"{key.DohHeader()["Doh is ".Length..]} major", key.DohHeader(), tempo, notes, rounds, step, glide);
    }
}
