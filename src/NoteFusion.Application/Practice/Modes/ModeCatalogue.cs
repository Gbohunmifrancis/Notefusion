using System.Globalization;
using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice.Modes;

/// <summary>A pitch-match set: eight notes, each heard and then held.</summary>
public sealed record PitchMatchSet(string Code, string Title, string Solfa, bool Playful);

/// <summary>
/// An interval from doh: doh, then the note asked, written as the solfa engine labels the pair (so "soh below doh" is
/// <c>d' s</c>: the unmarked octave starts at the doh at or below the pair's middle).
/// </summary>
public sealed record IntervalPattern(string Code, string Title, string Interval, bool Up, string Solfa, bool Playful);

/// <summary>A harmony line (<see cref="Line"/>, sung) a diatonic third above or below a tune (played), one rhythm for both.</summary>
public sealed record HarmonyLine(string Code, string Title, bool Above, string Tune, string Line, string Rhythm);

/// <summary>A riff or run: quick notes (semiquavers at its tempo) landing on a held note, in a unit of four.</summary>
public sealed record RunPattern(string Code, string Unit, string Title, string Solfa, string Rhythm);

/// <summary>A rhythm to clap back: each clap's length in beats, <c>r</c> before a rest's.</summary>
public sealed record RhythmPattern(string Code, string Title, string Beats, bool Playful);

/// <summary>
/// The practice modes' content, all our own and written in tonic solfa: pitch-match sets, intervals in the order RCM
/// and Trinity ask them (minor third, major third, fifth, fourth, octave, sixths, sevenths), harmony lines a third
/// above or under a tune, riffs and runs in three units, and rhythms in the Kodály order (crotchets and quaver pairs,
/// rests and minims, then dotted and syncopated). Pitched content is placed like the drills: labelled by the solfa
/// engine (<see cref="DrillCatalogue.Place"/>) and in a key that keeps every sung note between A3 and D5, chosen per
/// singer and per day; the id carries the key (and a run's speed), and a take is marked against the exercise rebuilt
/// from it.
/// </summary>
/// <remarks>
/// Timing keeps the drill grader honest: every note it marks one by one lasts at least
/// <see cref="PracticeRules.ShortestNoteSeconds"/>; a run's speeds above that are marked by the run grader, and a
/// rhythm's claps are at least that far apart, so each one's ±140 ms window is its own.
/// </remarks>
public static class ModeCatalogue
{
    public const string TimeSignature = "4/4";

    // ── Pitch match ─────────────────────────────────────────────────────────

    public const int PitchMatchTempo = 60;
    public const int PitchMatchToneBeats = 2;
    public const int PitchMatchHoldBeats = 4;
    public const int PitchMatchNotes = 8;

    /// <summary>
    /// How far the worker may look to line a pitch-match take up: a phone's recording latency, and well short of the
    /// distance from a reference tone to its note, so the tones heard in the take cannot stand in for the singer.
    /// </summary>
    public const double PitchMatchOffsetSearchSec = 0.35;

    public static readonly IReadOnlyList<PitchMatchSet> PitchMatchSets =
    [
        new("home-notes", "Doh, me and soh", "d m s m d s m d", Playful: true),
        new("steps", "Up and down the steps", "d r m f s f m r", Playful: true),
        new("scale", "The whole scale", "d r m f s l t d'", Playful: true),
        new("round-the-scale", "Round the scale", "d m s d' l f r t,", Playful: false),
        new("below-doh", "Down below doh", "d m r d t, l, s, d", Playful: false),
        new("in-between", "The notes in between", "d de r m f fe s ta", Playful: false),
    ];

    // ── Intervals ───────────────────────────────────────────────────────────

    public const int IntervalTempo = 72;

    public static readonly IReadOnlyList<IntervalPattern> Intervals =
    [
        new("third-down", "Lah below doh", "a minor third", Up: false, "d' l", Playful: true),
        new("third-up", "Me above doh", "a major third", Up: true, "d m", Playful: true),
        new("fifth-up", "Soh above doh", "a fifth", Up: true, "d s", Playful: true),
        new("fourth-up", "Fah above doh", "a fourth", Up: true, "d f", Playful: true),
        new("fourth-down", "Soh below doh", "a fourth", Up: false, "d' s", Playful: false),
        new("octave-up", "Doh above doh", "an octave", Up: true, "d d'", Playful: true),
        new("octave-down", "Doh below doh", "an octave", Up: false, "d' d", Playful: false),
        new("sixth-up", "Lah above doh", "a major sixth", Up: true, "d l", Playful: false),
        new("sixth-down", "Me below doh", "a minor sixth", Up: false, "d' m", Playful: false),
        new("seventh-up", "Te above doh", "a major seventh", Up: true, "d t", Playful: false),
        new("seventh-down", "Ray below doh", "a minor seventh", Up: false, "d' r", Playful: false),
    ];

    // ── Sing the harmony (Focused) ──────────────────────────────────────────

    public const int HarmonyTempo = 72;

    public static readonly IReadOnlyList<HarmonyLine> HarmonyLines =
    [
        new("thirds-steps", "Thirds over steps", Above: true, "d r m r d", "m f s f m", "1 1 1 1 2"),
        new("thirds-climb", "Thirds up the scale", Above: true, "d r m f s", "m f s l t", "1 1 1 1 2"),
        new("thirds-home", "Thirds coming home", Above: true, "s f m r d", "t l s f m", "1 1 1 1 2"),
        new("thirds-hymn", "A hymn line in thirds", Above: true, "d m r d t, d", "m s f m r m", "1 1 1 1 2 2"),
        new("alto-steps", "The alto under it", Above: false, "m f s f m", "d r m r d", "1 1 1 1 2"),
        new("alto-line", "An alto line", Above: false, "s l s f m r m", "m f m r d t, d", "1 1 1 1 1 1 2"),
    ];

    // ── Riffs & runs (Focused) ──────────────────────────────────────────────

    /// <summary>A run's tempo at full speed: its semiquavers are a quarter of a second.</summary>
    public const int RunTempo = 60;

    /// <summary>The speeds a run is sung at, as a percentage of <see cref="RunTempo"/>.</summary>
    public static readonly IReadOnlyList<int> RunSpeeds = [60, 70, 80, 90, 100];

    public static readonly IReadOnlyList<RunPattern> Runs =
    [
        new("down-the-scale", "Runs down to doh", "Down the scale", "s f m r d", ".25 .25 .25 .25 2"),
        new("pentatonic", "Runs down to doh", "Pentatonic run", "d' l s m r d", ".25 .25 .25 .25 .25 2"),
        new("gospel-turn", "Runs down to doh", "Gospel turn", "r m r d t, d", ".25 .25 .25 .25 .25 2"),
        new("blue-note", "Runs down to doh", "Blue-note slide", "m ma r d", ".25 .25 .25 2"),
        new("up-the-scale", "Up and over", "Up the scale", "d r m f s", ".25 .25 .25 .25 2"),
        new("pentatonic-climb", "Up and over", "Pentatonic climb", "d r m s l s", ".25 .25 .25 .25 .25 2"),
        new("turn-round-soh", "Up and over", "A turn round soh", "s l s fe s", ".25 .25 .25 .25 2"),
        new("over-the-top", "Up and over", "Over the top", "m s l d' l s", ".25 .25 .25 .25 .25 2"),
        new("long-fall", "Longer runs", "A long fall", "d' t l s f m r d", ".25 .25 .25 .25 .25 .25 .25 2"),
        new("gospel-run", "Longer runs", "Gospel run", "s l s m r d r d", ".25 .25 .25 .25 .25 .25 .25 2"),
        new("blue-run", "Longer runs", "Blue-note run", "s f m ma r d", ".25 .25 .25 .25 .25 2"),
        new("turn-and-fall", "Longer runs", "Turn and fall", "m f m r d t, d", ".25 .25 .25 .25 .25 .25 2"),
    ];

    // ── Rhythm ──────────────────────────────────────────────────────────────

    public const int RhythmTempo = 80;

    public static readonly IReadOnlyList<RhythmPattern> Rhythms =
    [
        new("steady", "Four steady claps", "1 1 1 1", Playful: true),
        new("ti-ti", "Two quick claps", "1 1 .5 .5 1", Playful: true),
        new("quick-quick-slow", "Quick, quick, slow", ".5 .5 1 .5 .5 1", Playful: true),
        new("rest", "A beat of rest", "1 1 r1 1", Playful: true),
        new("long", "A long clap", "2 1 1", Playful: true),
        new("two-bars", "Two bars", "1 .5 .5 1 1 .5 .5 .5 .5 2", Playful: false),
        new("dotted", "A dotted rhythm", "1.5 .5 1 1", Playful: false),
        new("off-the-beat", "Off the beat", ".5 1 .5 1 1", Playful: false),
        new("dotted-two-bars", "Dotted, two bars", "1.5 .5 1 1 1 .5 .5 2", Playful: false),
        new("syncopated-two-bars", "Syncopated, two bars", ".5 1 .5 1 1 .5 .5 1 r1 1", Playful: false),
    ];

    // ── Placement ───────────────────────────────────────────────────────────

    /// <summary>Where a backing line (the tune under a harmony) may sit: it is played, not sung, so wider.</summary>
    public const int BackingLowestMidi = 48;
    public const int BackingHighestMidi = 79;

    /// <summary>A mode's exercises on a track, in teaching order, each in today's key for this singer.</summary>
    public static IReadOnlyList<PracticeExercise> ForTrack(string mode, PracticeTrack? track, Guid userId, DateOnly date)
    {
        var playful = track == PracticeTrack.Playful;
        int Doh(string code, IReadOnlyList<int> dohs)
            => dohs[(int)(DrillCatalogue.Hash(userId, $"{mode}:{code}:{date:yyyy-MM-dd}") % (ulong)dohs.Count)];

        return mode switch
        {
            PracticeModes.PitchMatch => PitchMatchSets.Where(s => !playful || s.Playful)
                .Select(s => BuildPitchMatch(s, Doh(s.Code, Placements(s)))).ToList(),
            PracticeModes.Intervals => Intervals.Where(p => !playful || p.Playful)
                .Select(p => BuildInterval(p, Doh(p.Code, Placements(p)))).ToList(),
            // Focused's modes (Playful's hub does not list them): the same for anyone who asks.
            PracticeModes.Harmony => HarmonyLines.Select(h => BuildHarmony(h, Doh(h.Code, Placements(h)))).ToList(),
            PracticeModes.Runs => Runs.Select(r => BuildRun(r, Doh(r.Code, Placements(r)), RunSpeeds[0])).ToList(),
            PracticeModes.Rhythm => Rhythms.Where(r => !playful || r.Playful).Select(BuildRhythm).ToList(),
            _ => []
        };
    }

    /// <summary>
    /// The exercise an id names (<c>mode:code@doh</c>, <c>runs:code@doh~speed</c>, <c>rhythm:code</c>), or null when it names
    /// none: an unknown mode or code, a doh the exercise is never placed on, or a speed it is never sung at. Any track's
    /// exercise is found, so a take sung before a switch is still marked.
    /// </summary>
    public static PracticeExercise? Find(string? id)
    {
        if (Parse(id) is not { } parsed)
            return null;
        var (mode, code, doh, speed) = parsed;
        switch (mode)
        {
            case PracticeModes.Rhythm when doh is null && speed is null:
                return Rhythms.FirstOrDefault(r => r.Code == code) is { } rhythm ? BuildRhythm(rhythm) : null;
            case PracticeModes.PitchMatch when speed is null && PitchMatchSets.FirstOrDefault(s => s.Code == code) is { } set
                                               && doh is { } d1 && Placements(set).Contains(d1):
                return BuildPitchMatch(set, d1);
            case PracticeModes.Intervals when speed is null && Intervals.FirstOrDefault(p => p.Code == code) is { } interval
                                              && doh is { } d2 && Placements(interval).Contains(d2):
                return BuildInterval(interval, d2);
            case PracticeModes.Harmony when speed is null && HarmonyLines.FirstOrDefault(h => h.Code == code) is { } line
                                            && doh is { } d3 && Placements(line).Contains(d3):
                return BuildHarmony(line, d3);
            case PracticeModes.Runs when speed is { } pct && RunSpeeds.Contains(pct) && Runs.FirstOrDefault(r => r.Code == code) is { } run
                                         && doh is { } d4 && Placements(run).Contains(d4):
                return BuildRun(run, d4, pct);
            default:
                return null;
        }
    }

    /// <summary>The code an exercise id names, and its speed (runs), without building it; null for an id that is not one.</summary>
    public static (string Mode, string Code, int? Speed)? CodeOf(string? id)
        => Parse(id) is { } parsed ? (parsed.Mode, parsed.Code, parsed.Speed) : null;

    private static (string Mode, string Code, int? Doh, int? Speed)? Parse(string? id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > Core.Entities.PracticeSession.DrillIdMaxLength)
            return null;
        var colon = id.IndexOf(':');
        if (colon <= 0)
            return null;
        var mode = id[..colon];
        var rest = id[(colon + 1)..];
        int? speed = null;
        var tilde = rest.IndexOf('~');
        if (tilde >= 0)
        {
            if (!int.TryParse(rest[(tilde + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out var pct))
                return null;
            speed = pct;
            rest = rest[..tilde];
        }
        int? doh = null;
        var at = rest.IndexOf('@');
        if (at >= 0)
        {
            if (!int.TryParse(rest[(at + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out var d))
                return null;
            doh = d;
            rest = rest[..at];
        }
        return rest.Length == 0 ? null : (mode, rest, doh, speed);
    }

    // ── Builders ────────────────────────────────────────────────────────────

    public static PracticeExercise BuildPitchMatch(PitchMatchSet set, int doh)
    {
        // Each note's tone plays for two beats (backing), then the singer holds it for four (marked).
        var span = PitchMatchToneBeats + PitchMatchHoldBeats;
        var rhythm = string.Join(' ', Enumerable.Repeat(span.ToString(CultureInfo.InvariantCulture), Tokens(set.Solfa).Length));
        var (key, notes) = DrillCatalogue.Place(Pattern(set.Code, set.Solfa, rhythm), doh);
        var tones = notes.Select(n => n with { DurBeats = PitchMatchToneBeats }).ToList();
        var holds = notes.Select(n => n with { StartBeat = n.StartBeat + PitchMatchToneBeats, DurBeats = PitchMatchHoldBeats }).ToList();
        return new PracticeExercise(
            $"{PracticeModes.PitchMatch}:{set.Code}@{doh}", PracticeModes.PitchMatch, set.Code, set.Title,
            "Hear each note, then hold it in tune for four beats.", null, key, PitchMatchTempo,
            holds, tones, [], ExerciseGrader.Notes, OffsetSearchSec: PitchMatchOffsetSearchSec, DohMidi: doh);
    }

    public static PracticeExercise BuildInterval(IntervalPattern p, int doh)
    {
        var (key, notes) = DrillCatalogue.Place(Pattern(p.Code, p.Solfa, "2 2"), doh);
        var target = SyllableName(notes[1].Solfa);
        return new PracticeExercise(
            $"{PracticeModes.Intervals}:{p.Code}@{doh}", PracticeModes.Intervals, p.Code, p.Title,
            $"Hear doh and sing it, then jump {(p.Up ? "up" : "down")} {p.Interval} to {target}.", p.Interval, key, IntervalTempo,
            notes, [], [], ExerciseGrader.Notes, DohMidi: doh);
    }

    public static PracticeExercise BuildHarmony(HarmonyLine h, int doh)
    {
        var (key, line) = DrillCatalogue.Place(Pattern(h.Code, h.Line, h.Rhythm), doh);
        var (_, tune) = DrillCatalogue.Place(Pattern(h.Code, h.Tune, h.Rhythm), doh);
        return new PracticeExercise(
            $"{PracticeModes.Harmony}:{h.Code}@{doh}", PracticeModes.Harmony, h.Code, h.Title,
            h.Above ? "Sing the line a third above the tune." : "Sing the alto line, a third under the tune.",
            h.Above ? "A third above" : "A third below", key, HarmonyTempo, line, tune, [], ExerciseGrader.Notes, DohMidi: doh);
    }

    public static PracticeExercise BuildRun(RunPattern r, int doh, int speedPercent)
    {
        var (key, notes) = DrillCatalogue.Place(Pattern(r.Code, r.Solfa, r.Rhythm), doh);
        var tempo = RunTempoAt(speedPercent);
        var shortest = notes.Min(n => n.DurBeats) * 60.0 / tempo;
        return new PracticeExercise(
            $"{PracticeModes.Runs}:{r.Code}@{doh}~{speedPercent}", PracticeModes.Runs, r.Code, r.Title,
            "Hear it, sing it slowly, then bring it up to speed.", r.Unit, key, tempo, notes, [], [],
            shortest >= PracticeRules.ShortestNoteSeconds - 1e-9 ? ExerciseGrader.Notes : ExerciseGrader.Run,
            SpeedPercent: speedPercent, DohMidi: doh);
    }

    /// <summary>A run at every one of its speeds, slowest first (the same key).</summary>
    public static IReadOnlyList<PracticeExercise> AtEverySpeed(PracticeExercise run)
        => run.Mode == PracticeModes.Runs && Runs.FirstOrDefault(r => r.Code == run.Code) is { } pattern && run.DohMidi is { } doh
            ? RunSpeeds.Select(pct => BuildRun(pattern, doh, pct)).ToList()
            : [];

    public static PracticeExercise BuildRhythm(RhythmPattern r)
        => new($"{PracticeModes.Rhythm}:{r.Code}", PracticeModes.Rhythm, r.Code, r.Title, "Listen, then clap it back.", null,
            null, RhythmTempo, [], [], Claps(r), ExerciseGrader.Rhythm);

    /// <summary>A run's tempo at a speed (60 % of 60 BPM is 36).</summary>
    public static int RunTempoAt(int speedPercent) => (int)Math.Round(RunTempo * speedPercent / 100.0);

    /// <summary>A rhythm's claps: each one's beat and length (a rest is a gap before the next).</summary>
    public static IReadOnlyList<RhythmClapDto> Claps(RhythmPattern r)
    {
        var claps = new List<RhythmClapDto>();
        var at = 0.0;
        foreach (var token in Tokens(r.Beats))
        {
            var rest = token.StartsWith('r');
            var beats = double.Parse(rest ? token[1..] : token, CultureInfo.InvariantCulture);
            if (!rest)
                claps.Add(new RhythmClapDto(at, beats));
            at += beats;
        }
        return claps;
    }

    // ── Keys ────────────────────────────────────────────────────────────────

    public static IReadOnlyList<int> Placements(PitchMatchSet s) => Fitting(Offsets(s.Solfa), null);
    public static IReadOnlyList<int> Placements(IntervalPattern p) => Fitting(Offsets(p.Solfa), null);
    public static IReadOnlyList<int> Placements(HarmonyLine h) => Fitting(Offsets(h.Line), Offsets(h.Tune));
    public static IReadOnlyList<int> Placements(RunPattern r) => Fitting(Offsets(r.Solfa), null);

    /// <summary>Every doh of the drills' keys that keeps the sung notes between A3 and D5 (and a backing line in its window).</summary>
    private static List<int> Fitting(IReadOnlyList<int> sung, IReadOnlyList<int>? backing)
        => DrillCatalogue.DohPitchClasses
            .SelectMany(pc => new[] { 48 + pc, 60 + pc })
            .Where(doh => doh + sung.Min() >= DrillCatalogue.LowestMidi && doh + sung.Max() <= DrillCatalogue.HighestMidi)
            .Where(doh => backing is null || (doh + backing.Min() >= BackingLowestMidi && doh + backing.Max() <= BackingHighestMidi))
            .Order()
            .ToList();

    private static IReadOnlyList<int> Offsets(string solfa) => DrillCatalogue.Offsets(Pattern("", solfa, null));

    private static DrillPattern Pattern(string code, string solfa, string? rhythm)
        => new(code, 0, 1, code, KeyMode.Major, solfa, rhythm);

    private static string[] Tokens(string text) => text.Split(' ', StringSplitOptions.RemoveEmptyEntries);

    /// <summary>"soh" for "s": the name a prompt says a syllable by.</summary>
    private static string SyllableName(string syllable) => syllable switch
    {
        "d" => "doh",
        "r" => "ray",
        "m" => "me",
        "f" => "fah",
        "s" => "soh",
        "l" => "lah",
        "t" => "te",
        _ => syllable
    };
}
