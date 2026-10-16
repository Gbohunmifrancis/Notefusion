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
    /// The upload is a whole song with instruments behind the voice, not a hummed or sung line: the
    /// worker isolates the lead vocal first, reads the beat from the full mix, and returns the
    /// instrumental as <see cref="TranscriptionResultDto.BackingAudioBase64"/>. Linked songs always take
    /// this road; for uploads the client says which kind of recording it is.
    /// </summary>
    public bool Separate { get; init; }

    /// <summary>
    /// Whether the worker should synthesise the piano preview WAV. The mobile client plays it; the web
    /// client renders its own playback from the notes and sends false, which saves the worker about nine
    /// seconds and the response about ten megabytes on a three-minute song.
    /// </summary>
    public bool AudioPreview { get; init; } = true;

    /// <summary>
    /// Which lane the worker runs the job in. Pro work goes first, and in melody mode skips the polyphonic
    /// model altogether, which is most of the wait on a hummed clip.
    /// </summary>
    public TranscribePriority Priority { get; init; } = TranscribePriority.Normal;

    /// <summary>The most of the audio to transcribe, in seconds: a linked song's cap, or an anonymous preview's.</summary>
    public double? MaxSeconds { get; init; }

    /// <summary>
    /// Linked songs only: where in the song to start, in seconds. Null (or 0) is the start. The part
    /// transcribed runs from here for <see cref="EndSeconds"/> or <see cref="MaxSeconds"/>, whichever is less.
    /// </summary>
    public double? StartSeconds { get; init; }

    /// <summary>Linked songs only: where in the song to stop, in seconds; null runs to the cap.</summary>
    public double? EndSeconds { get; init; }

    /// <summary>
    /// Also write alto, tenor and bass under the tune. Off by default: a hummed or sung line is one
    /// voice, and parts composed under it are an arrangement the user asks for afterwards
    /// (<see cref="ITranscriptionApi.HarmoniseAsync"/>), not something the recording contained.
    /// </summary>
    public bool Harmony { get; init; }

    /// <summary>
    /// The transpose setting on the player's keyboard, in semitones (-11 to 11; 0 when it is off). A
    /// keyboard set to -4 sounds F when A is played, and the worker writes what the player's hands did:
    /// every pitch, the key and the chords move by the opposite amount before notation and solfa are built.
    /// </summary>
    public int KeyboardTranspose { get; init; }

    /// <summary>The furthest a keyboard's transpose setting goes either way, in semitones.</summary>
    public const int MaxKeyboardTranspose = 11;

    /// <summary>The tempo range the worker takes, in beats a minute (<c>server/app/api/routes.py</c>).</summary>
    public const int MinTempo = 20;

    /// <summary>See <see cref="MinTempo"/>.</summary>
    public const int MaxTempo = 400;
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

/// <summary>Alto, tenor and bass written under a melody on request: the four parts and their one score.</summary>
public sealed record HarmonyDto(IReadOnlyDictionary<string, PartDto>? Parts, string? PartsMusicXml);

/// <summary>
/// The song a linked transcription came from — the acknowledgement line and the sheet's credit.
/// <c>Preview</c> is set when the store's 30-second preview stood in for the full song (YouTube refused
/// it); <c>Notice</c> is the plain sentence the clients show for that. <c>StartSeconds</c> and
/// <c>EndSeconds</c> are the section the user chose, when they chose one, and <c>DurationSeconds</c> the
/// whole song's length when the service knew it — the credit line reads "1:05–1:35 of 3:33".
/// </summary>
public sealed record SourceDto(
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

/// <summary>
/// What a pasted link points at, before anything is transcribed: the song and its length, so the client
/// can offer a section of it, and <c>MaxSeconds</c>, the most of it this caller may have in one go — an
/// anonymous preview's half minute, a free account's minute, Pro's six.
/// </summary>
public sealed record LinkInfoDto(
    string Provider,
    string Url,
    string Title,
    string Artist,
    string? ThumbnailUrl,
    double? DurationSeconds,
    double MaxSeconds)
{
    public static LinkInfoDto From(SourceDto source, double maxSeconds)
        => new(source.Provider, source.Url, source.Title, source.Artist, source.ThumbnailUrl, source.DurationSeconds, maxSeconds);
}

/// <summary>
/// One chord heard under the tune, over a run of beats. <c>Root</c> and <c>Bass</c> are pitch classes
/// (0 = C), <c>Bass</c> only when it differs from the root (a slash chord). <c>Symbol</c> is the letter
/// name spelled in the key ("Dm", "Bb", "G/B"); <c>Solfa</c> is the root's syllable relative to doh.
/// </summary>
public sealed record ChordSymbolDto(
    double StartBeat,
    double DurBeats,
    int Root,
    string Quality,
    int? Bass,
    string Symbol,
    string Solfa);

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
    string PartsMusicXml = "",
    /// <summary>
    /// Where beat 0 falls in the source audio, in seconds. With <see cref="BackingAudioBase64"/> it lets a
    /// client play the notated melody over the song's own backing in time: the audio time of beat b is
    /// BeatOriginSec + b × 60 / Tempo.
    /// </summary>
    double BeatOriginSec = 0,
    /// <summary>Separated jobs only: the instrumental (mix minus the isolated vocal) as a small mono MP3.</summary>
    string BackingAudioBase64 = "",
    /// <summary>
    /// "heard" when <see cref="Parts"/> were transcribed from a choir recording, "written" when they were
    /// arranged under the tune on request; null without parts.
    /// </summary>
    string? PartsSource = null,
    /// <summary>
    /// The chords heard: always in chords mode, and for a song with accompaniment in melody mode; null
    /// otherwise.
    /// </summary>
    IReadOnlyList<ChordSymbolDto>? Chords = null,
    /// <summary>"heard" when <see cref="Chords"/> were read from the audio; null without chords.</summary>
    string? ChordsSource = null,
    /// <summary>
    /// Only when the doh is unsure: the other keys the voice fits nearly as well, nearest first (at
    /// most two), for the "or is it…?" prompt. Null otherwise.
    /// </summary>
    IReadOnlyList<KeyAlternativeDto>? KeyAlternatives = null);

/// <summary>
/// Another key the sung notes fit nearly as well. <c>Pitches</c> are the result's notes written in its
/// scale, index for index (most are unchanged): choosing it replaces the pitches and the key together,
/// so the notes the voice left in doubt are written as that key's scale tones, not as accidentals.
/// <c>MusicXml</c> is the sheet engraved that way, for a client that does not engrave its own (the web).
/// </summary>
public sealed record KeyAlternativeDto(string Key, IReadOnlyList<int> Pitches, string MusicXml = "");

/// <summary>
/// Polling envelope for a transcription job.
///
/// <para>
/// <c>Stage</c> is <c>queued</c> while the job waits for a worker (<c>QueuePosition</c> says how many
/// run before it), then <c>fetching</c>, <c>separating</c> or <c>transcribing</c> while it runs
/// (uploads skip <c>fetching</c>), and <c>Source</c> is known as soon as the link resolves — before the result exists — so a
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
    SourceDto? Source = null,
    int? QueuePosition = null);
