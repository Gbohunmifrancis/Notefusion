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

/// <summary>Completed result of GET /v1/jobs/{jobId} (TRD §6).</summary>
public sealed record TranscriptionResultDto(
    string Key,
    double KeyConfidence,
    int Tempo,
    string TimeSignature,
    string MusicXml,
    string MidiBase64,
    IReadOnlyList<NoteEventDto> Notes,
    IReadOnlyList<string> SolfaLines,
    double OverallConfidence);

/// <summary>Polling envelope for a transcription job.</summary>
public sealed record TranscriptionJobDto(
    string JobId,
    TranscriptionStatus Status,
    double Progress,
    TranscriptionResultDto? Result);
