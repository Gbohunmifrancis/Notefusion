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
}

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
    string ChromaticSpelling = "direction");

/// <summary>
/// Polling envelope for a transcription job.
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
    string? Error = null);
