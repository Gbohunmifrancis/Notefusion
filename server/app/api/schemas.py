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


class JobResponse(ApiModel):
    status: str
    progress: float | None = None
    # ``fetching`` | ``separating`` | ``transcribing`` while a linked song is in flight.
    stage: str | None = None
    # Known as soon as the link resolves, before ``result`` exists.
    source: SourceDto | None = None
    result: ResultDto | None = None
    error: str | None = None
