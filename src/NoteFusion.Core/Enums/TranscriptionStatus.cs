using System.Text.Json.Serialization;

namespace NoteFusion.Core.Enums;

/// <summary>Lifecycle of a transcription job (TRD §6: POST /v1/transcribe → 202 + job polling).</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TranscriptionStatus
{
    Pending = 0,
    Processing = 1,
    Done = 2,
    Failed = 3
}
