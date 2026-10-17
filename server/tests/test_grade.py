"""Sing-along grading on synthesised takes: alignment, octave tolerance, per-note verdicts."""

from io import BytesIO

import numpy as np
import soundfile as sf
from app.pipeline import grade as grading
from app.pipeline.grade import TargetNote, grade
from fastapi.testclient import TestClient

SR = 22050
TEMPO = 100.0
BEAT = 60.0 / TEMPO


def _hz(m):
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def _take(targets, offsets_cents=None, lead_in=0.0, late=0.0, octave=0, skip=(), sr=SR):
    """A harmonic 'voice' singing the part, optionally late, down an octave, or off by cents."""
    end = lead_in + late + max(t.start_beat + t.dur_beats for t in targets) * BEAT + 0.3
    n = int(sr * end)
    contour = np.full(n, np.nan)
    for i, t in enumerate(targets):
        if i in skip:
            continue
        s = int(sr * (lead_in + late + t.start_beat * BEAT))
        e = int(sr * (lead_in + late + (t.start_beat + t.dur_beats) * BEAT)) - int(sr * 0.04)
        cents = (offsets_cents or {}).get(i, 0.0)
        contour[s:e] = t.pitch_midi + octave + cents / 100.0
    voiced = ~np.isnan(contour)
    f0 = np.where(voiced, _hz(np.nan_to_num(contour, nan=60.0)), 0.0)
    phase = 2.0 * np.pi * np.cumsum(f0) / sr
    y = sum(w * np.sin(k * phase) for k, w in enumerate((1.0, 0.5, 0.25), start=1))
    return (y * voiced * 0.5).astype(np.float32)


TUNE = [TargetNote(60, 0, 1), TargetNote(62, 1, 1), TargetNote(64, 2, 1), TargetNote(65, 3, 1),
        TargetNote(67, 4, 2), TargetNote(65, 6, 1), TargetNote(64, 7, 1), TargetNote(60, 8, 2)]


def test_a_clean_take_scores_full_marks():
    g = grade(_take(TUNE), SR, TUNE, TEMPO)
    assert [n.status for n in g.notes] == ["hit"] * len(TUNE)
    assert g.score == 100
    assert abs(g.tuning_cents) < 15


def test_a_late_entry_is_aligned_not_punished():
    g = grade(_take(TUNE, lead_in=1.2, late=0.4), SR, TUNE, TEMPO, lead_in_sec=1.2)
    assert 0.3 <= g.offset_sec <= 0.5
    assert g.score >= 90


def test_an_octave_down_is_the_same_part():
    g = grade(_take(TUNE, octave=-12), SR, TUNE, TEMPO)
    assert g.octave_shift == -12
    assert g.score == 100


def test_flat_and_wrong_notes_are_called_out():
    # Note 2 is 55 cents flat (near), note 4 is a whole tone wrong, note 6 is not sung.
    g = grade(_take(TUNE, offsets_cents={2: -55.0, 4: 200.0}, skip=(6,)), SR, TUNE, TEMPO)
    statuses = [n.status for n in g.notes]
    assert statuses[2] == "near" and -80 <= g.notes[2].cents <= -35
    assert statuses[4] == "wrong"
    assert statuses[6] == "missed" and g.notes[6].cents is None
    assert statuses[0] == "hit"
    assert g.hits == 5 and g.near == 1 and g.wrong == 1 and g.missed == 1
    assert g.score == int(round(100 * (5 + 0.5) / 8))
    assert "wrong note" in g.summary and "not sung" in g.summary


def test_a_consistently_sharp_take_is_told_so():
    g = grade(_take(TUNE, offsets_cents={i: 30.0 for i in range(len(TUNE))}), SR, TUNE, TEMPO)
    assert g.tuning_cents >= 20
    assert "sharp" in g.summary


def test_silence_is_all_missed():
    g = grade(np.zeros(SR * 6, dtype=np.float32), SR, TUNE, TEMPO)
    assert g.missed == len(TUNE) and g.score == 0


def test_the_grade_route_round_trips(monkeypatch):
    from app.main import app

    buf = BytesIO()
    sf.write(buf, _take(TUNE[:3]), SR, format="WAV")
    target = {"notes": [{"pitchMidi": t.pitch_midi, "startBeat": t.start_beat, "durBeats": t.dur_beats} for t in TUNE[:3]],
              "tempoBpm": TEMPO, "leadInSec": 0.0}
    import json
    with TestClient(app) as client:
        r = client.post("/v1/grade", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")}, data={"target": json.dumps(target)})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["score"] == 100
        assert [n["status"] for n in body["notes"]] == ["hit", "hit", "hit"]
        assert "tuningCents" in body and "octaveShift" in body

        bad = client.post("/v1/grade", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")}, data={"target": "{"})
        assert bad.status_code == 422


def test_a_drill_take_is_cut_at_its_cap_not_refused():
    """``maxSec`` cuts a take that runs on (a singer who left the microphone open) rather than refusing it."""
    import json

    from app.main import app

    take = _take(TUNE[:3])
    tail = np.zeros(int(SR * 8.0), dtype=np.float32)  # eight seconds of the room after the last note
    buf = BytesIO()
    sf.write(buf, np.concatenate([take, tail]), SR, format="WAV")
    notes = [{"pitchMidi": t.pitch_midi, "startBeat": t.start_beat, "durBeats": t.dur_beats} for t in TUNE[:3]]
    with TestClient(app) as client:
        r = client.post("/v1/grade", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                        data={"target": json.dumps({"notes": notes, "tempoBpm": TEMPO, "leadInSec": 0.0, "maxSec": 4.0})})
        assert r.status_code == 200, r.text
        assert r.json()["score"] == 100

        bad = client.post("/v1/grade", files={"audio": ("take.wav", BytesIO(buf.getvalue()), "audio/wav")},
                          data={"target": json.dumps({"notes": notes, "tempoBpm": TEMPO, "maxSec": 0})})
        assert bad.status_code == 422
