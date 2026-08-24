using System.Text.Json.Serialization;

namespace NoteFusion.Infrastructure.Api;

// Wire-level records for the Python transcription API (TRD §6). Kept internal so the
// JSON shape can evolve with the server without touching Application DTOs.
//
// IMPORTANT: every field name here must match the camelCase alias the Python Pydantic
// models emit (alias_generator = to_camel).  The ApiJsonContext source-generation
// options use JsonKnownNamingPolicy.CamelCase so C# PascalCase properties are mapped
// automatically — the one exception is "musicxml" which is all-lowercase in the
// Python schema and needs an explicit [JsonPropertyName].

internal sealed record SubmitResponse(string JobId);

/// <summary>
/// Polling envelope returned by GET /v1/jobs/{id}.
/// Previously missing the <c>error</c> field, which caused Python transcription
/// failure messages (e.g. "No confident notes detected") to be silently discarded
/// and the mobile to show a hardcoded fallback string instead of the real reason.
/// </summary>
internal sealed record JobResponse(
    string Status,
    double? Progress,
    JobResultResponse? Result,
    /// <summary>
    /// Human-readable failure reason set by the Python worker (LowConfidenceError or
    /// unexpected exception).  Null when the job is still running or succeeded.
    /// </summary>
    string? Error);

internal sealed record JobResultResponse(
    string Key,
    double KeyConfidence,
    int Tempo,
    string TimeSignature,
    [property: JsonPropertyName("musicxml")] string MusicXml,
    string MidiBase64,
    IReadOnlyList<WireNoteEvent> Notes,
    IReadOnlyList<string> SolfaLines,
    double OverallConfidence,
    /// <summary>
    /// Base64-encoded 16-bit PCM WAV audio preview synthesised server-side from
    /// the note list using numpy + soundfile.  Empty string when synthesis produced
    /// no output (e.g. no notes survived the pipeline).
    ///
    /// The mobile client writes this to a cache file with expo-file-system and
    /// plays it through expo-av so users can hear their transcription immediately
    /// after the result arrives — no extra network round-trip required.
    /// </summary>
    string AudioPreviewBase64 = "",
    /// <summary>
    /// False when the worker's pyin refinement stage contributed nothing to this clip —
    /// a decode failure, or a wholly unvoiced clip.  The duration cause is no longer
    /// reachable through this API: NF_PYIN_MAX_SECONDS now equals the worker's
    /// NF_MAX_CLIP_SECONDS (180 s), so anything long enough to skip refinement is
    /// rejected upstream with a 413 instead.
    ///
    /// It is not cosmetic: with that stage dark the worker's own accuracy corpus records
    /// spurious accidentals rising from 1.53 to 3.53 per clip, so the notation is worth
    /// showing with a caveat rather than showing silently.  Defaults true so a worker
    /// predating the field cannot make a good transcription look degraded.
    /// </summary>
    bool PitchRefined = true);

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
/// Registering JobResponse here also covers JobResultResponse and WireNoteEvent
/// transitively — no separate [JsonSerializable] entries are needed for those.
/// </summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(SubmitResponse))]
[JsonSerializable(typeof(JobResponse))]
internal sealed partial class ApiJsonContext : JsonSerializerContext;
