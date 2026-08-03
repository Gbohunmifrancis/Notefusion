using System.Text.Json.Serialization;

namespace NoteFusion.Infrastructure.Api;

// Wire-level records for the Python transcription API (TRD §6). Kept internal so the
// JSON shape can evolve with the server without touching Application DTOs.

internal sealed record SubmitResponse(string JobId);

internal sealed record JobResponse(
    string Status,
    double? Progress,
    JobResultResponse? Result);

internal sealed record JobResultResponse(
    string Key,
    double KeyConfidence,
    int Tempo,
    string TimeSignature,
    [property: JsonPropertyName("musicxml")] string MusicXml,
    string MidiBase64,
    IReadOnlyList<WireNoteEvent> Notes,
    IReadOnlyList<string> SolfaLines,
    double OverallConfidence);

internal sealed record WireNoteEvent(
    int PitchMidi,
    double StartBeat,
    double DurBeats,
    int Degree,
    string Solfa,
    string OctaveMark,
    double Conf);

/// <summary>
/// Source-generated serializer context: reflection-based System.Text.Json is not
/// trim-safe, and the Android head ships with TrimMode=full.
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(SubmitResponse))]
[JsonSerializable(typeof(JobResponse))]
internal sealed partial class ApiJsonContext : JsonSerializerContext;
