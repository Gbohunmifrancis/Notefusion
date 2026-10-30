using NoteFusion.Application.Practice.Dtos;
using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;
using NoteFusion.Core.Solfa;

namespace NoteFusion.Application.Practice.Modes;

/// <summary>How a mode's take is marked: note by note (the drill grader), a run's shape and landing note, or clap by clap.</summary>
public enum ExerciseGrader
{
    Notes = 0,
    Run = 1,
    Rhythm = 2
}

/// <summary>
/// One exercise of a practice mode, placed in a key and rebuilt from its id when a take of it is marked, so the notes a
/// take is judged against are always the server's (<see cref="ModeCatalogue.Find"/>). <see cref="Notes"/> are sung and
/// marked; <see cref="Backing"/> is played by the app and never marked; <see cref="Claps"/> are a rhythm's. Times are in
/// beats at <see cref="TempoBpm"/>. <see cref="OffsetSearchSec"/>, when set, narrows how far the worker looks to line
/// the take up (pitch match, whose reference tones sit between the notes it marks). <see cref="DohMidi"/> is the
/// unmarked doh it is placed on (null for a rhythm). <see cref="Cents"/>, when set, is each sung note's distance in cents
/// from its written pitch (a maqam's quarter tone, -50): played and marked there, written as the syllable it is under.
/// </summary>
public sealed record PracticeExercise(
    string Id,
    string Mode,
    string Code,
    string Title,
    string Prompt,
    string? Group,
    MusicalKey? Key,
    int TempoBpm,
    IReadOnlyList<NoteEventDto> Notes,
    IReadOnlyList<NoteEventDto> Backing,
    IReadOnlyList<RhythmClapDto> Claps,
    ExerciseGrader Grader,
    double? OffsetSearchSec = null,
    int? SpeedPercent = null,
    int? DohMidi = null,
    IReadOnlyList<int>? Cents = null)
{
    /// <summary>The practice row a take of it is recorded as.</summary>
    public PracticeKind Kind => PracticeModes.KindOf(Mode) ?? throw new InvalidOperationException($"'{Mode}' is not a marked mode.");

    public double BeatSeconds => 60.0 / TempoBpm;

    /// <summary>From beat one to the end of the last thing sung, played or clapped.</summary>
    public double PassageSeconds => Notes.Concat(Backing).Select(n => n.StartBeat + n.DurBeats)
        .Concat(Claps.Select(c => c.StartBeat + c.DurBeats))
        .DefaultIfEmpty(0)
        .Max() * BeatSeconds;

    /// <summary>The quickest marked note (or gap between claps) in seconds at this tempo.</summary>
    public double ShortestNoteSeconds => (Notes.Count > 0 ? Notes.Min(n => n.DurBeats) : Claps.DefaultIfEmpty(new RhythmClapDto(0, 1)).Min(c => c.DurBeats)) * BeatSeconds;

    /// <summary>The longest count-in a take may have: the drills' (<see cref="DrillCatalogue.LegacyLeadInBeats"/> beats).</summary>
    public double MaxLeadInSeconds => DrillCatalogue.LegacyLeadInBeats * BeatSeconds;

    /// <summary>The take kept after a count-in of <paramref name="leadInSec"/>: it, the passage, and the drills' tail.</summary>
    public double MaxTakeSecondsAfter(double leadInSec) => Math.Round(leadInSec + PassageSeconds + PracticeRules.DrillTakeTailSeconds, 2);

    /// <summary>The longest take any app sends: the longest count-in, the passage and the tail.</summary>
    public double MaxTakeSeconds => MaxTakeSecondsAfter(MaxLeadInSeconds);

    /// <summary>The notes to mark, beat one <paramref name="leadInSec"/> into the take.</summary>
    public GradeTargetDto Target(double leadInSec)
        => new(Notes.Select((n, i) => new GradeTargetNoteDto(n.PitchMidi, n.StartBeat, n.DurBeats, Cents?[i] ?? 0)).ToList(), TempoBpm, leadInSec);

    /// <summary>"Eb major": the key as its signature spells it; null for a rhythm.</summary>
    public string? KeyName => Key is null ? null
        : Key.Mode == KeyMode.Major ? $"{Key.DohHeader()["Doh is ".Length..]} major" : Key.ToString();

    /// <summary>The grader's wire name: "notes", "run" or "rhythm".</summary>
    public string GraderName => GraderWireName(Grader);

    public static string GraderWireName(ExerciseGrader grader) => grader switch
    {
        ExerciseGrader.Run => "run",
        ExerciseGrader.Rhythm => "rhythm",
        _ => "notes"
    };
}
