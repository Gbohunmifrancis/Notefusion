import io
from pathlib import Path
from fastapi.testclient import TestClient
from music21 import meter, note, stream, tempo

from app.main import app
from app.pipeline.score_transcriber import transcribe_score


def _create_sample_midi(path: Path) -> None:
    s = stream.Stream()
    s.insert(0, tempo.MetronomeMark(number=120))
    s.insert(0, meter.TimeSignature("4/4"))
    s.append(note.Note("C4", quarterLength=1.0))
    s.append(note.Note("D4", quarterLength=1.0))
    s.append(note.Note("E4", quarterLength=1.0))
    s.append(note.Note("F4", quarterLength=1.0))
    s.write("midi", fp=str(path))


def test_transcribe_score_midi(tmp_path):
    midi_path = tmp_path / "test.mid"
    _create_sample_midi(midi_path)

    result = transcribe_score(midi_path)
    assert result.tempo == 120
    assert result.time_signature == "4/4"
    assert len(result.notes) == 4
    assert [n.solfa for n in result.notes] == ["d", "r", "m", "f"]
    assert result.overall_confidence == 1.0
    assert len(result.musicxml) > 0
    assert len(result.midi_base64) > 0
    assert len(result.audio_preview_base64) > 0


def test_transcribe_score_endpoint(tmp_path):
    midi_path = tmp_path / "test.mid"
    _create_sample_midi(midi_path)
    data = midi_path.read_bytes()

    with TestClient(app) as client:
        r = client.post(
            "/v1/transcribe/score",
            files={"score": ("test.mid", io.BytesIO(data), "audio/midi")},
            data={"time_signature": "4/4"},
        )
        assert r.status_code == 202
        job_id = r.json()["jobId"]
        assert job_id

        # Check job
        r_job = client.get(f"/v1/jobs/{job_id}")
        assert r_job.status_code == 200
        status = r_job.json()["status"]
        assert status in ("pending", "processing", "done")


def test_transcribe_score_multi_part_satb(tmp_path):
    score = stream.Score()
    soprano = stream.Part(id="Soprano")
    soprano.insert(0, tempo.MetronomeMark(number=100))
    soprano.insert(0, meter.TimeSignature("4/4"))
    soprano.append(note.Note("C5", quarterLength=1.0))
    soprano.append(note.Note("D5", quarterLength=1.0))

    alto = stream.Part(id="Alto")
    alto.insert(0, tempo.MetronomeMark(number=100))
    alto.insert(0, meter.TimeSignature("4/4"))
    alto.append(note.Note("E4", quarterLength=1.0))
    alto.append(note.Note("F4", quarterLength=1.0))

    score.insert(0, soprano)
    score.insert(0, alto)

    mxml_path = tmp_path / "satb.xml"
    score.write("musicxml", fp=str(mxml_path))

    # Transcribe soprano (default)
    res_sop = transcribe_score(mxml_path, key_override="C major", part_index=0)
    assert [n.pitch_midi for n in res_sop.notes] == [72, 74]
    assert [n.solfa for n in res_sop.notes] == ["d", "r"]

    # Transcribe alto (part_index=1)
    res_alto = transcribe_score(mxml_path, key_override="C major", part_index=1)
    assert [n.pitch_midi for n in res_alto.notes] == [64, 65]
    assert [n.solfa for n in res_alto.notes] == ["m", "f"]

