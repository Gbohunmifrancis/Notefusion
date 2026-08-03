"""Wire contract (TRD par. 6). Must stay in sync with the Android client:
NoteFusion.Infrastructure/Api/TranscriptionApiContracts.cs (camelCase; the staff
XML field is 'musicxml', all lowercase, matching the TRD).
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


class JobResponse(ApiModel):
    status: str
    progress: float | None = None
    result: ResultDto | None = None
    error: str | None = None
