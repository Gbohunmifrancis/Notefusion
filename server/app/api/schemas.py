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


class JobResponse(ApiModel):
    status: str
    progress: float | None = None
    result: ResultDto | None = None
    error: str | None = None
