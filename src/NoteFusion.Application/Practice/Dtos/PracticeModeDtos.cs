using NoteFusion.Application.Transcriptions.Dtos;
using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Practice.Dtos;

// ── Warm up (GET /api/practice/warm-up) ─────────────────────────────────────

/// <summary>
/// GET /api/practice/warm-up: the guided routine, about three minutes, never marked and earning nothing. Each step is
/// timed (<c>Seconds</c>); a "breath" step carries its counts, a "guide" step the notes the app's synth plays (the
/// pattern, then again <c>StepSemitones</c> higher each round, <c>Rounds</c> times; <c>Glide</c> slides from note to
/// note, a siren), and the "range" step is the range finder (<c>POST /api/practice/range</c>, low then high).
/// </summary>
public sealed record WarmUpDto(int TotalSeconds, IReadOnlyList<WarmUpStepDto> Steps);

/// <summary>One step of the warm-up. <c>Kind</c>: "breath", "guide" or "range".</summary>
public sealed record WarmUpStepDto(
    string Id,
    string Kind,
    string Title,
    string Instruction,
    int Seconds,
    BreathPatternDto? Breath,
    WarmUpGuideDto? Guide);

/// <summary>A breathing pattern in counts at <c>CountsPerMinute</c>: in, hold, out, <c>Cycles</c> times.</summary>
public sealed record BreathPatternDto(int InCounts, int HoldCounts, int OutCounts, int CountsPerMinute, int Cycles);

/// <summary>What the synth plays for a guided step: the notes in beats at <c>TempoBpm</c>, labelled by the solfa engine.</summary>
public sealed record WarmUpGuideDto(
    string Key,
    string DohHeader,
    int TempoBpm,
    IReadOnlyList<NoteEventDto> Notes,
    int Rounds,
    int StepSemitones,
    bool Glide);

// ── Range finder (GET/POST /api/practice/range) ─────────────────────────────

/// <summary>
/// The singer's comfortable range as measured: each end (MIDI and its name, "G3"), null until that end is measured;
/// once both are: the span ("An octave and a fifth"), the range in solfa with doh on C (<c>LowSolfa</c> "s,",
/// <c>HighSolfa</c> "r'", labelled by the solfa engine) and the choir part it sits best in (<c>VoicePart</c>:
/// "soprano" / "alto" / "tenor" / "bass", the ranges harmony.py writes parts in — a guide, not a label). <c>Heard</c>
/// is the note this take held (POST only).
/// </summary>
public sealed record VoiceRangeDto(
    int? LowMidi,
    int? HighMidi,
    string? Low,
    string? High,
    int? SpanSemitones,
    string? Span,
    string DohHeader,
    string? LowSolfa,
    string? HighSolfa,
    string? VoicePart,
    HeldNoteDto? Heard = null);

/// <summary>A note held in a take: the note (MIDI, "A3"), how long it was held and how far off it the voice sat.</summary>
public sealed record HeldNoteDto(int Midi, string Name, double Seconds, double Cents);

// ── The modes (GET /api/practice/modes/{mode}) ──────────────────────────────

/// <summary>
/// GET /api/practice/modes/{mode} ("pitch-match", "intervals", "harmony", "runs", "rhythm"): the mode's exercises on the
/// caller's track, each placed in today's key for them, with the day's marked-drill allowance a take spends.
/// </summary>
public sealed record PracticeModeDto(
    string Mode,
    DateOnly Date,
    PracticeTrack? Track,
    DrillAllowanceDto Allowance,
    IReadOnlyList<PracticeExerciseDto> Exercises);

/// <summary>
/// One exercise. <c>Id</c> is what a take is sent with (<c>mode:code@doh</c>, a run's speed after <c>~</c>); <c>Code</c>
/// names it across keys and speeds. <c>Notes</c> are what the singer sings and is marked on; <c>Backing</c> what the
/// app plays and does not mark (pitch match's reference tone before each held note, the tune under a harmony line);
/// <c>Claps</c> a rhythm's claps (no notes). <c>Grader</c>: "notes" (note by note, cents), "run" (shape and landing
/// note) or "rhythm" (clap by clap). <c>BestScore</c> is the caller's best mark at this code (null before any).
/// A run lists its <c>Speeds</c>, each its own exercise id, tempo and grader; its notes are in beats, the same at
/// every speed. Times are in beats at <c>TempoBpm</c>; the take is a count-in (sent as <c>leadInSec</c>), then the
/// passage, and the worker keeps no more than <c>MaxTakeSeconds</c> of it.
/// </summary>
public sealed record PracticeExerciseDto(
    string Id,
    string Mode,
    string Code,
    string Title,
    string Prompt,
    string? Group,
    string? Key,
    string? DohHeader,
    int TempoBpm,
    string TimeSignature,
    IReadOnlyList<NoteEventDto> Notes,
    IReadOnlyList<NoteEventDto> Backing,
    IReadOnlyList<RhythmClapDto> Claps,
    double MaxTakeSeconds,
    string Grader,
    int? BestScore,
    int? SpeedPercent,
    IReadOnlyList<RunSpeedDto>? Speeds);

/// <summary>A clap of a rhythm, in beats.</summary>
public sealed record RhythmClapDto(double StartBeat, double DurBeats);

/// <summary>
/// A run at one speed (60–100 %): its exercise id and tempo, its quickest note in seconds there, and how it is marked
/// there — "notes" while every note lasts <see cref="PracticeRules.ShortestNoteSeconds"/>, "run" above.
/// </summary>
public sealed record RunSpeedDto(int Percent, string ExerciseId, int TempoBpm, double ShortestNoteSeconds, string Grader, int? BestScore);

// ── A marked take (POST /api/practice/modes/grade) ──────────────────────────

/// <summary>
/// A mode's take, marked by the server and recorded as practice. <c>Score</c> and <c>Summary</c> are the mark whatever
/// marked it; the grader's own answer is in <c>Marks</c> ("notes": the drill grader's per-note marks), <c>Run</c> or
/// <c>Rhythm</c>. <c>Reward</c> is what the take earned (XP, level, streak, badges), as a drill's.
/// </summary>
public sealed record PracticeModeGradeDto(
    string Mode,
    string ExerciseId,
    string Grader,
    int Score,
    string Summary,
    int? SpeedPercent,
    GradeResultDto? Marks,
    RunGradeDto? Run,
    RhythmGradeDto? Rhythm,
    PracticeRewardDto Reward);

/// <summary>
/// A full-speed run's mark: how many of the run's notes (the landing note apart) the voice went through in order, and
/// the landing note judged as any held note (<c>Landing</c>: "hit" / "near" / "wrong" / "missed", with its cents).
/// <c>Trace</c> is the take's pitch line from beat one (seconds, MIDI with the octave taken out), to draw over the run.
/// </summary>
public sealed record RunGradeDto(
    int Score,
    int Followed,
    int RunNotes,
    string Landing,
    double? LandingCents,
    int LandingMidi,
    double OffsetSec,
    int OctaveShift,
    string Summary,
    IReadOnlyList<RunNoteMarkDto> Notes,
    IReadOnlyList<TracePointDto> Trace);

/// <summary>One note of a run: followed or not ("hit" / "wrong", or "missed" when nothing was sung then).</summary>
public sealed record RunNoteMarkDto(int Index, int TargetMidi, bool Followed, string Status);

/// <summary>A point of a take's pitch line: seconds from beat one, and the pitch (fractional MIDI).</summary>
public sealed record TracePointDto(double T, double Midi);

/// <summary>
/// A rhythm's mark: claps in time (<c>Hits</c>, within 70 ms), close (<c>Near</c>, within 140 ms), missed, and extra
/// claps (each costs half a clap). <c>TempoRatio</c> is the tempo clapped over the tempo given (above 1 is quicker).
/// </summary>
public sealed record RhythmGradeDto(
    int Score,
    int Hits,
    int Near,
    int Missed,
    int Extra,
    double OffsetSec,
    double TempoRatio,
    string Summary,
    IReadOnlyList<ClapMarkDto> Claps);

/// <summary>One clap of the rhythm: its beat, how early (negative) or late it came, and "hit" / "near" / "missed".</summary>
public sealed record ClapMarkDto(int Index, double Beat, double? ErrorMs, string Status);
