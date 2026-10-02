using NoteFusion.Core.Enums;

namespace NoteFusion.Application.Transcriptions.Dtos;

/// <summary>Options for POST /v1/transcribe (TRD §6).</summary>
public sealed record TranscribeOptions
{
    public TranscriptionMode Mode { get; init; } = TranscriptionMode.Melody;

    /// <summary>Optional 'set Doh before recording' override, e.g. "F" or "Am".</summary>
    public string? Key { get; init; }

    /// <summary>Optional tap-tempo override in BPM.</summary>
    public int? Tempo { get; init; }

    /// <summary>Optional time signature override, e.g. "4/4", "3/4", "6/8".</summary>
    public string? TimeSignature { get; init; }

    /// <summary>
    /// Which lane the worker runs the job in. Pro work goes first, and in melody mode skips the polyphonic
    /// model altogether, which is most of the wait on a hummed clip.
    /// </summary>
    public TranscribePriority Priority { get; init; } = TranscribePriority.Normal;

    /// <summary>The most of the audio to transcribe, in seconds: a linked song's cap, or an anonymous preview's.</summary>
    public double? MaxSeconds { get; init; }
}

/// <summary>The worker's two queue lanes; wire values "normal" / "high".</summary>
public enum TranscribePriority
{
    Normal = 0,
    High = 1
}

/// <summary>A note of the part a take is judged against, in beats.</summary>
public sealed record GradeTargetNoteDto(int PitchMidi, double StartBeat, double DurBeats);

/// <summary>The part a sung take is judged against, and the count-in that preceded it in the recording.</summary>
public sealed record GradeTargetDto(IReadOnlyList<GradeTargetNoteDto> Notes, double TempoBpm, double LeadInSec = 0);

/// <summary>One note's verdict: the pitch sung while it was due, in cents off, and a status of hit / near / wrong / missed.</summary>
public sealed record GradeNoteDto(int Index, int TargetMidi, double? SungMidi, double? Cents, string Status);

/// <summary>
/// How a sung take compared to its part. <c>OctaveShift</c> is the octave the singer took it in (a bass
/// singing the tune down an octave is not wrong); <c>TuningCents</c> is the take's overall lean.
/// </summary>
public sealed record GradeResultDto(
    int Score,
    int Hits,
    int Near,
    int Wrong,
    int Missed,
    double TuningCents,
    double OffsetSec,
    int OctaveShift,
    string Summary,
    IReadOnlyList<GradeNoteDto> Notes);

/// <summary>One voice of the four-part harmony, in the same note shape as the melody.</summary>
public sealed record PartDto(IReadOnlyList<NoteEventDto> Notes, IReadOnlyList<string> SolfaLines);

/// <summary>The song a linked transcription came from — the acknowledgement line and the sheet's credit.</summary>
public sealed record SourceDto(
    string Provider,
    string Url,
    string Title,
    string Artist,
    string? ThumbnailUrl);

/// <summary>One note event in the API result; mirrors the TRD §6 result contract.</summary>
public sealed record NoteEventDto(
    int PitchMidi,
    double StartBeat,
    double DurBeats,
    int Degree,
    string Solfa,
    string OctaveMark,
    double Conf);

/// <summary>
/// Completed result of GET /v1/jobs/{jobId} (TRD §6).
///
/// <para>
/// <c>AudioPreviewBase64</c> carries a base64-encoded 16-bit PCM WAV file
/// synthesised server-side by the Python worker from the transcribed note list
/// (using numpy + soundfile — no system audio libraries required).  The mobile
/// client writes this to a temporary cache file with expo-file-system and plays
/// it through expo-av, giving the user instant audio feedback without any extra
/// network round-trip.  The field is an empty string when synthesis produced no
/// output (e.g. an empty note list survived the pipeline).
/// </para>
///
/// <para>
/// <c>PitchRefined</c> is false when the worker skipped its pyin refinement stage — now
/// only a decode failure or a wholly unvoiced clip, since NF_PYIN_MAX_SECONDS was raised
/// to match NF_MAX_CLIP_SECONDS (180 s) and a longer clip is refused rather than
/// under-refined.  Clients should present the notation with a caveat rather than
/// suppress it — the notes are still the best available reading, but they carry roughly
/// twice the spurious accidentals.
/// </para>
/// </summary>
public sealed record TranscriptionResultDto(
    string Key,
    double KeyConfidence,
    int Tempo,
    string TimeSignature,
    string MusicXml,
    string MidiBase64,
    IReadOnlyList<NoteEventDto> Notes,
    IReadOnlyList<string> SolfaLines,
    double OverallConfidence,
    string AudioPreviewBase64 = "",
    bool PitchRefined = true,
    string ChromaticSpelling = "direction",
    /// <summary>Linked songs only: where the song came from, for the acknowledgement line.</summary>
    SourceDto? Source = null,
    /// <summary>Linked songs only: the whole song's length, which may exceed what was transcribed.</summary>
    double SongDurationSec = 0,
    /// <summary>True when only the first part of the song was transcribed (a free preview, or past the Pro cap).</summary>
    bool Truncated = false,
    /// <summary>True when the vocals were isolated from the mix before transcription.</summary>
    bool Separated = false,
    /// <summary>Four-part harmony under the melody, keyed soprano / alto / tenor / bass. Pro only.</summary>
    IReadOnlyDictionary<string, PartDto>? Parts = null,
    /// <summary>The four parts as one MusicXML score. Pro only.</summary>
    string PartsMusicXml = "");

/// <summary>
/// Polling envelope for a transcription job.
///
/// <para>
/// <c>Stage</c> is <c>fetching</c>, <c>separating</c> or <c>transcribing</c> while a linked song is in
/// flight, and <c>Source</c> is known as soon as the link resolves — before the result exists — so a
/// client can show what is being transcribed while it waits.
/// </para>
///
/// <para>
/// <c>Error</c> carries the human-readable failure reason from the Python worker
/// (e.g. "No confident notes detected in the recording").  It is non-null only
/// when <c>Status == Failed</c>; the mobile should surface it directly instead
/// of showing a hardcoded fallback string.
/// </para>
/// </summary>
public sealed record TranscriptionJobDto(
    string JobId,
    TranscriptionStatus Status,
    double Progress,
    TranscriptionResultDto? Result,
    string? Error = null,
    string? Stage = null,
    SourceDto? Source = null);
