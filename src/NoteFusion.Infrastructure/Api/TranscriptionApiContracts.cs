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

/// <summary>POST /v1/links/resolve's body: the one link to look at.</summary>
internal sealed record ResolveLinkRequest(string Url);

internal sealed record GradeNote(int Index, int TargetMidi, double? SungMidi, double? Cents, string Status);

internal sealed record GradeResponse(
    int Score, int Hits, int Near, int Wrong, int Missed, double TuningCents, double OffsetSec, int OctaveShift,
    string Summary, IReadOnlyList<GradeNote> Notes);

/// <summary>POST /v1/identify's answer: the hymn a hummed clip is (or null), and what was heard.</summary>
internal sealed record IdentifyResponse(IdentifiedHymn? Match, int NotesHeard, bool TooShort, double SecondsHeard);

internal sealed record IdentifiedHymn(string Slug, string Title, string? Tune, string Url, string Kind, double Confidence, string? FirstLine);

internal sealed record GradeTargetNote(int PitchMidi, double StartBeat, double DurBeats);

/// <summary>
/// POST /v1/grade's target (and /v1/grade/run's). <c>MaxSec</c> (a drill's cap) and <c>OffsetSearchSec</c> (pitch
/// match's narrow alignment) are left off the wire when unset, as before they existed.
/// </summary>
internal sealed record GradeTarget(
    IReadOnlyList<GradeTargetNote> Notes,
    double TempoBpm,
    double LeadInSec,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? MaxSec = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] double? OffsetSearchSec = null);

/// <summary>POST /v1/grade/rhythm's target: each clap's beat from beat one.</summary>
internal sealed record RhythmTarget(IReadOnlyList<double> Beats, double TempoBpm, double LeadInSec, double MaxSec);

/// <summary>A note held in a range take (POST /v1/range).</summary>
internal sealed record WireHold(int Midi, double Pitch, double Cents, double StartSec, double Seconds);

internal sealed record RangeResponse(IReadOnlyList<WireHold> Holds, WireHold? Lowest, WireHold? Highest, double SecondsHeard);

internal sealed record WireRunNote(int Index, int TargetMidi, bool Followed, string Status);

internal sealed record WireTracePoint(double T, double Midi);

/// <summary>POST /v1/grade/run's answer.</summary>
internal sealed record RunGradeResponse(
    int Score, int Followed, int RunNotes, string LandingStatus, double? LandingCents, int LandingMidi, double OffsetSec,
    int OctaveShift, string Summary, IReadOnlyList<WireRunNote> Notes, IReadOnlyList<WireTracePoint> Trace);

internal sealed record WireClap(int Index, double Beat, double? ErrorMs, string Status);

/// <summary>POST /v1/grade/rhythm's answer.</summary>
internal sealed record RhythmGradeResponse(
    int Score, int Hits, int Near, int Missed, int Extra, double OffsetSec, double TempoRatio, string Summary,
    IReadOnlyList<WireClap> Claps);

internal sealed record HarmoniseNote(int PitchMidi, double StartBeat, double DurBeats, double Conf);

internal sealed record HarmoniseRequest(string Key, int TempoBpm, string TimeSignature, IReadOnlyList<HarmoniseNote> Notes);

/// <summary>POST /v1/harmonise's answer. The score field is spelled as pydantic's to_camel spells <c>parts_musicxml</c>.</summary>
internal sealed record HarmoniseResponse(
    Dictionary<string, WirePart>? Parts,
    [property: JsonPropertyName("partsMusicxml")] string PartsMusicXml = "");

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
    string? Stage,
    WireSource? Source,
    /// <summary>
    /// Human-readable failure reason set by the Python worker (LowConfidenceError or
    /// unexpected exception).  Null when the job is still running or succeeded.
    /// </summary>
    string? Error,
    /// <summary>How many jobs run before this one; only while <c>Stage</c> is <c>queued</c>.</summary>
    int? QueuePosition = null,
    /// <summary>A failed job's step and its reason in one word (the worker's <c>links.STAGES</c> / <c>failure_code</c>).</summary>
    string? FailureStage = null,
    string? FailureCode = null);

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
    bool PitchRefined = true,
    /// <summary>Chromatic solfa convention used by the worker for this result.</summary>
    string ChromaticSpelling = "direction",
    WireSource? Source = null,
    double SongDurationSec = 0,
    bool Truncated = false,
    bool Separated = false,
    Dictionary<string, WirePart>? Parts = null,
    // pydantic's to_camel turns ``parts_musicxml`` into ``partsMusicxml`` (lower-case x), not the
    // ``partsMusicXml`` the naming policy derives from this name; matching is case-sensitive, so
    // without the explicit name the four-part score was dropped on the way in.
    [property: JsonPropertyName("partsMusicxml")] string PartsMusicXml = "",
    double BeatOriginSec = 0,
    string BackingAudioBase64 = "",
    string? PartsSource = null,
    IReadOnlyList<WireChord>? Chords = null,
    string? ChordsSource = null,
    IReadOnlyList<WireKeyAlternative>? KeyAlternatives = null,
    WireHymnMatch? HymnMatch = null,
    // ``beat_times_sec``: the audio time of each notated beat, when the worker tracked them. Optional: a worker
    // that predates it sends nothing, and the clock is then beatOriginSec + b × 60 / tempo.
    IReadOnlyList<double>? BeatTimesSec = null);

/// <summary>
/// A hymn the tune clearly matches (<c>app.pipeline.hymn_match</c>): for <c>kind</c> "score" with its
/// hymnbook version in the sung key; for "incipit" the hymn's name and link only.
/// </summary>
internal sealed record WireHymnMatch(
    string Slug,
    string Title,
    string Url,
    string Source,
    string Licence,
    string Credit,
    string Kind,
    double Confidence,
    string Tune = "",
    string? Key = null,
    string? TimeSignature = null,
    int? Tempo = null,
    double? Pickup = null,
    IReadOnlyList<WireNoteEvent>? Notes = null,
    IReadOnlyList<string>? SolfaLines = null,
    [property: JsonPropertyName("musicxml")] string? MusicXml = null,
    string? Lyrics = null);

/// <summary>Another doh the voice fits nearly as well (<c>app.pipeline.transcriber.KeyAlternative</c>).</summary>
internal sealed record WireKeyAlternative(
    string Key,
    IReadOnlyList<int> Pitches,
    [property: JsonPropertyName("musicxml")] string MusicXml = "");

/// <summary>One chord heard under the tune, as the worker names it (<c>app.pipeline.chords.Chord</c>).</summary>
internal sealed record WireChord(
    double StartBeat,
    double DurBeats,
    int Root,
    string Quality,
    int? Bass,
    string Symbol,
    string Solfa);

internal sealed record WirePart(IReadOnlyList<WireNoteEvent> Notes, IReadOnlyList<string> SolfaLines);

internal sealed record WireSource(
    string Provider,
    string Url,
    string Title,
    string Artist,
    string? ThumbnailUrl,
    bool? Preview = null,
    string? Notice = null,
    double? StartSeconds = null,
    double? EndSeconds = null,
    double? DurationSeconds = null);

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
[JsonSerializable(typeof(ResolveLinkRequest))]
[JsonSerializable(typeof(GradeResponse))]
[JsonSerializable(typeof(GradeTarget))]
[JsonSerializable(typeof(RhythmTarget))]
[JsonSerializable(typeof(RangeResponse))]
[JsonSerializable(typeof(RunGradeResponse))]
[JsonSerializable(typeof(RhythmGradeResponse))]
[JsonSerializable(typeof(IdentifyResponse))]
[JsonSerializable(typeof(HarmoniseRequest))]
[JsonSerializable(typeof(HarmoniseResponse))]
[JsonSerializable(typeof(JobResponse))]
internal sealed partial class ApiJsonContext : JsonSerializerContext;
