"""Wire contract (TRD par. 6). Must stay in sync with the C# client:
NoteFusion.Infrastructure/Api/TranscriptionApiContracts.cs (camelCase; the staff
XML field is 'musicxml', all lowercase, matching the TRD).

audio_preview_base64 carries a base64-encoded 16-bit PCM WAV synthesised from the
note list by _synthesize_audio_preview().  The mobile client writes it to a temp
file and plays it with expo-av so users can hear their transcription immediately.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class SubmitResponse(ApiModel):
    job_id: str


class NoteEventDto(ApiModel):
    pitch_midi: int
    start_beat: float
    dur_beats: float
    degree: int
    solfa: str
    octave_mark: str
    conf: float


class SourceDto(ApiModel):
    """The song a linked transcription came from, for the acknowledgement line."""
    provider: str
    url: str
    title: str
    artist: str
    thumbnail_url: str | None = None
    # Set only when YouTube refused the song and the store's 30-second preview stood in
    # (the result is then ``truncated`` too); ``notice`` is the plain sentence to show.
    preview: bool | None = None
    notice: str | None = None
    # The section of the song that was transcribed, when the caller chose one (absent for
    # a preview stand-in, which has no position), and the whole song's length when known.
    start_seconds: float | None = None
    end_seconds: float | None = None
    duration_seconds: float | None = None


class LinkInfoRequest(ApiModel):
    url: str


class LinkInfoResponse(ApiModel):
    """What a pasted link points at, for the clients' section picker: ``duration_seconds``
    is null when the song's length could not be learned in time."""
    provider: str
    url: str
    title: str
    artist: str
    thumbnail_url: str | None = None
    duration_seconds: float | None = None


class PartDto(ApiModel):
    """One voice of the four-part harmony, in the same note shape as the melody."""
    notes: list[NoteEventDto]
    solfa_lines: list[str]


class ChordDto(ApiModel):
    """One chord over a run of beats (``app.pipeline.chords``): root and bass as pitch
    classes in the written key, ``bass`` only for a slash chord, ``symbol`` spelled in the
    key ("Bb", "F#m", "G/B") and ``solfa`` the root's syllable."""
    start_beat: float
    dur_beats: float
    root: int
    quality: str  # maj | min | 7 | maj7 | min7 | dim | sus4
    bass: int | None = None
    symbol: str
    solfa: str


class KeyAlternativeDto(ApiModel):
    """Another doh the voice fits nearly as well, offered when the doh is unsure: its key and
    the pitch of every note written in its scale, index for index with ``notes``."""
    key: str
    pitches: list[int]
    # The sheet engraved in this key, for a client that does not engrave its own.
    musicxml: str = ""


class HymnMatchDto(ApiModel):
    """A hymn in our library the tune clearly matches (``app.pipeline.hymn_match``).

    ``kind`` "score": the hymnbook version follows, written in the key that was sung — its key,
    time signature, the take's pace as ``tempo``, the ``pickup`` in beats, ``notes`` in the same
    shape as the result's, ``solfa_lines``, ``musicxml`` and the first verse as ``lyrics`` — for
    the clients' "Use the hymnbook version?" prompt.  ``kind`` "incipit": recognition only; the
    tune is named and linked, and none of the score fields is set.  ``credit`` is the line the
    hymn's page shows; ``source`` and ``licence`` say where it came from and on what terms.
    """
    slug: str
    title: str
    tune: str = ""
    url: str
    source: str
    licence: str
    credit: str
    kind: str  # score | incipit
    confidence: float
    key: str | None = None
    time_signature: str | None = None
    tempo: int | None = None
    pickup: float | None = None
    notes: list[NoteEventDto] | None = None
    solfa_lines: list[str] | None = None
    musicxml: str | None = None
    lyrics: str | None = None


class ResultDto(ApiModel):
    key: str
    key_confidence: float
    tempo: int
    time_signature: str
    musicxml: str
    midi_base64: str
    notes: list[NoteEventDto]
    solfa_lines: list[str]
    overall_confidence: float
    # Base64-encoded 16-bit PCM WAV preview synthesised server-side from the note list.
    # Empty string when synthesis produced no output (e.g. no notes survived the pipeline).
    # The camelCase alias "audioPreviewBase64" is emitted automatically by to_camel.
    audio_preview_base64: str = ""
    # False when pyin refinement contributed nothing to this clip: a failed decode, or no
    # voiced frame at all. The duration cause is unreachable now that NF_PYIN_MAX_SECONDS
    # equals NF_MAX_CLIP_SECONDS. Clients should caveat the notation rather than
    # hide it: the notes are still the best available reading, they just carry roughly
    # twice the spurious accidentals. Defaults True so an older worker cannot make a
    # good transcription look degraded.
    pitch_refined: bool = True
    # ``direction`` preserves the historical rising/sharpened, falling/flattened rule.
    chromatic_spelling: str = "direction"
    # Linked-song jobs only.  ``truncated`` means the song outlasted the caller's cap
    # (a free preview, or the Pro six minutes) and only the first part was transcribed;
    # ``separated`` means the vocals were isolated before transcription.
    source: SourceDto | None = None
    song_duration_sec: float = 0.0
    truncated: bool = False
    separated: bool = False
    # Four-part harmony under the melody: soprano (the tune), alto, tenor, bass.
    parts: dict[str, PartDto] | None = None
    # The four parts as one MusicXML score.
    parts_musicxml: str = ""
    # "heard" (a choir recording, mode="choir") or "written" (arranged on request); null without parts.
    parts_source: str | None = None
    # Audio time of beat 0, in seconds, so the notated melody can be played over the
    # backing in time: audio time of beat b is beat_origin_sec + b * 60 / tempo when there
    # is no beat_times_sec.
    beat_origin_sec: float = 0.0
    # With backing_audio_base64 only (absent otherwise): entry i is the audio time, in seconds
    # to the ms, of notation beat i, i = 0..n with n at or past the last note's end beat,
    # increasing.  Interpolate linearly between entries; before 0 (a pickup) extrapolate with
    # the first interval, past n with the last.  Beat 0 is beat_origin_sec's beat 0, the start
    # of the first bar.  It follows the band where it speeds up or slows down and the tempo's
    # fraction that ``tempo`` rounds away.
    beat_times_sec: list[float] | None = None
    # Separated jobs only: the instrumental as a small mono MP3 (base64).
    backing_audio_base64: str = ""
    # The chords heard: always in mode "chords", and in melody mode for a song with
    # accompaniment; null otherwise.  ``chords_source`` is "heard" when there are chords.
    chords: list[ChordDto] | None = None
    chords_source: str | None = None
    # Only when the doh is unsure: the others it could be, nearest first (at most two).
    key_alternatives: list[KeyAlternativeDto] | None = None
    # Only when the tune clearly matches a hymn we hold: the hymn, and its hymnbook version.
    hymn_match: HymnMatchDto | None = None


class IdentifiedHymnDto(ApiModel):
    """The hymn a hummed clip was recognised as (``POST /v1/identify``)."""
    slug: str
    title: str
    tune: str
    # The hymn's page (absolute); for an incipit, wherever the incipit's source lives.
    url: str
    # "hymn" (a hymn page), "tune" (a tune page, no words) or "incipit" (recognition only).
    kind: str
    confidence: float
    # The opening words of the first verse, plainly spelled; null for a tune without words.
    first_line: str | None = None


class IdentifyResponse(ApiModel):
    match: IdentifiedHymnDto | None = None
    # Notes the decoder heard in the clip, and whether that was too few to name any hymn.
    notes_heard: int
    too_short: bool
    seconds_heard: float


class GradeTargetNoteDto(ApiModel):
    pitch_midi: int
    start_beat: float
    dur_beats: float


class GradeTargetDto(ApiModel):
    """The part a take is judged against, in beats, and the count-in that preceded it."""

    notes: list[GradeTargetNoteDto]
    tempo_bpm: float
    lead_in_sec: float = 0.0
    #: When set, the take is cut to this many seconds instead of refused past ``GRADE_MAX_SECONDS``:
    #: a practice drill is a few seconds long, and a singer who keeps the microphone open is not wrong.
    max_sec: float | None = None
    #: When set, the take is lined up within this many seconds of the count-in's timing instead of the grader's
    #: 1.5: pitch match plays each note's reference tone between the held notes, and a wide search could line
    #: those tones up with the notes in place of the singer.
    offset_search_sec: float | None = None


class HarmoniseNoteDto(ApiModel):
    pitch_midi: int
    start_beat: float
    dur_beats: float
    conf: float = 1.0


class HarmoniseRequest(ApiModel):
    """A melody as the clients hold it, to have alto, tenor and bass written under it."""

    key: str
    tempo_bpm: int
    time_signature: str = "4/4"
    notes: list[HarmoniseNoteDto]


class HarmoniseResponse(ApiModel):
    parts: dict[str, PartDto] | None = None
    parts_musicxml: str = ""


class GradeNoteDto(ApiModel):
    index: int
    target_midi: int
    sung_midi: float | None = None
    cents: float | None = None
    status: str  # hit | near | wrong | missed


class GradeResponse(ApiModel):
    score: int
    hits: int
    near: int
    wrong: int
    missed: int
    tuning_cents: float
    offset_sec: float
    octave_shift: int
    summary: str
    notes: list[GradeNoteDto]


class JobResponse(ApiModel):
    status: str
    progress: float | None = None
    # ``queued`` while the job waits for a worker, then ``fetching`` | ``separating`` |
    # ``transcribing`` while it runs (uploads skip ``fetching``).
    stage: str | None = None
    # How many jobs run before this one; only while ``stage`` is ``queued``.
    queue_position: int | None = None
    # Known as soon as the link resolves, before ``result`` exists.
    source: SourceDto | None = None
    result: ResultDto | None = None
    error: str | None = None
