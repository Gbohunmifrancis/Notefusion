using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice.Modes;

/// <summary>A choir part and the notes it is written in (MIDI, inclusive).</summary>
public sealed record VoicePartRange(string Part, int Lowest, int Highest)
{
    public double Middle => (Lowest + Highest) / 2.0;
}

/// <summary>
/// What a measured range says, in the singer's words: the two notes ("G3 to D5"), the span ("An octave and a fifth"),
/// the range in solfa with doh on C ("s, up to r'", from the solfa engine), and the choir part it sits best in.
/// </summary>
public static class VoiceRanges
{
    /// <summary>
    /// The parts' ranges, as <c>server/app/pipeline/harmony.py</c> writes parts in them (SOPRANO_RANGE, ALTO_RANGE,
    /// TENOR_RANGE, BASS_RANGE): soprano C4–E5, alto F3–D5, tenor C3–G4, bass E2–C4.
    /// </summary>
    public static readonly IReadOnlyList<VoicePartRange> Parts =
    [
        new("soprano", 60, 76),
        new("alto", 53, 74),
        new("tenor", 48, 67),
        new("bass", 40, 60),
    ];

    /// <summary>The doh the range is written from in solfa: C.</summary>
    public static readonly MusicalKey SolfaKey = new(0, KeyMode.Major);

    /// <summary>Parts whose fit is within this of the best are a tie, settled by whose middle is nearer the singer's.</summary>
    private const double FitTie = 0.05;

    private static readonly string[] IntervalNames =
        ["", "a semitone", "a tone", "a minor third", "a major third", "a fourth", "a tritone", "a fifth",
         "a minor sixth", "a major sixth", "a minor seventh", "a major seventh"];

    private static readonly string[] OctaveWords = ["", "An octave", "Two octaves", "Three octaves", "Four octaves"];

    /// <summary>
    /// The part a range sits best in: the one whose written range it covers the most of (the share of the part's notes
    /// the singer reaches comfortably), the nearer middle settling a tie. A guide, not a label.
    /// </summary>
    public static string SuggestPart(int low, int high)
    {
        double Fit(VoicePartRange p) => Math.Max(0, Math.Min(high, p.Highest) - Math.Max(low, p.Lowest)) / (double)(p.Highest - p.Lowest);
        var best = Parts.Max(Fit);
        var middle = (low + high) / 2.0;
        return Parts.Where(p => Fit(p) >= best - FitTie).MinBy(p => Math.Abs(p.Middle - middle))!.Part;
    }

    /// <summary>"G3", "Bb4", "F#3": a note named as the key signatures spell it (the doh names), with its octave.</summary>
    public static string Name(int midi)
        => $"{new MusicalKey(((midi % 12) + 12) % 12, KeyMode.Major).DohHeader()["Doh is ".Length..]}{midi / 12 - 1}";

    /// <summary>"An octave and a fifth", "A sixth", "Two octaves": a span in semitones, said plainly.</summary>
    public static string Span(int semitones)
    {
        var s = Math.Max(0, semitones);
        var octaves = s / 12;
        var rest = IntervalNames[s % 12];
        if (octaves == 0)
            return rest.Length == 0 ? "One note" : char.ToUpperInvariant(rest[0]) + rest[1..];
        var head = OctaveWords[Math.Min(octaves, OctaveWords.Length - 1)];
        return rest.Length == 0 ? head : $"{head} and {rest}";
    }

    /// <summary>The range as the clients show it; each end null until measured, the rest once both are.</summary>
    public static VoiceRangeDto Describe(int? low, int? high, HeldNoteDto? heard = null)
    {
        string? lowSolfa = null, highSolfa = null, part = null, span = null;
        int? semitones = null;
        if (low is { } lo && high is { } hi)
        {
            var reference = SolfaMapper.ReferenceDoh([lo, hi], SolfaKey.DohPitchClass, SolfaKey.Mode);
            var flags = SolfaMapper.AscendingFlags([lo, hi], SolfaKey.DohPitchClass);
            lowSolfa = Label(lo, reference, flags[0]);
            highSolfa = Label(hi, reference, flags[1]);
            part = SuggestPart(lo, hi);
            semitones = hi - lo;
            span = Span(hi - lo);
        }
        return new VoiceRangeDto(
            low, high, low is { } l ? Name(l) : null, high is { } h ? Name(h) : null, semitones, span, SolfaKey.DohHeader(),
            lowSolfa, highSolfa, part, heard);
    }

    private static string Label(int midi, int reference, bool ascending)
    {
        var s = SolfaMapper.Map(midi, SolfaKey, reference, ascending ? ChromaticSpelling.Ascending : ChromaticSpelling.Descending);
        return s.Text + s.OctaveMark;
    }
}
