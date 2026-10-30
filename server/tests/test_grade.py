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
        contour[s:e] = t.pitch + octave + cents / 100.0
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


# Maqam Rast from C: me and te a quarter tone flat (a target's cents).
RAST = [TargetNote(60, 0, 1), TargetNote(62, 1, 1), TargetNote(64, 2, 1, -50.0), TargetNote(65, 3, 1),
        TargetNote(67, 4, 1), TargetNote(69, 5, 1), TargetNote(71, 6, 1, -50.0), TargetNote(72, 7, 2)]


def test_a_quarter_tone_is_marked_against_its_own_pitch():
    g = grade(_take(RAST), SR, RAST, TEMPO)
    assert [n.status for n in g.notes] == ["hit"] * len(RAST)
    # Sung as the plain semitone, the quarter-tone notes are half a semitone sharp: near, not hit.
    plain = [TargetNote(t.pitch_midi, t.start_beat, t.dur_beats) for t in RAST]
    g = grade(_take(plain), SR, RAST, TEMPO)
    assert [n.status for n in g.notes][2] == "near" and [n.status for n in g.notes][6] == "near"
    assert 40 <= g.notes[2].cents <= 60


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


# ── The practice curriculum's rhythms ─────────────────────────────────────────
# Practice drills (C# DrillCatalogue) use quavers, dotted crotchets, syncopation, ties and crotchet triplets, never
# semiquavers, at no more than 96 BPM: no note is shorter than 0.3 s. The grader judges each note on the pitch sung
# while it was due, so a rhythm is fair if a singer whose every note lands a little early or late is still marked
# right note by note.

FASTEST_DRILL_BPM = 96.0
# "sight-syncopated" (quavers and syncopation), then "choir-triplet-tied" (a tie over the bar, then triplets),
# each as (semitones from doh, beats).
_SYNCOPATED = [(0, .5), (4, 1), (7, .5), (7, 1), (9, 1), (7, .5), (4, 1), (0, .5), (2, 1), (4, 1), (2, 1), (0, 2)]
_TIED_TRIPLETS = [(0, 1), (4, 1), (7, 1), (9, 2), (7, 2 / 3), (4, 2 / 3), (2, 2 / 3), (0, 1), (-1, 1), (0, 2)]
_DOTTED = [(0, 1.5), (2, .5), (4, 1), (7, 1), (9, 1.5), (7, .5), (4, 1), (2, 1), (0, 2)]


def _rhythm_targets(line, doh=60):
    out, at = [], 0.0
    for semis, beats in line:
        out.append(TargetNote(doh + semis, at, beats))
        at += beats
    return out


def _take_with_jitter(targets, tempo, jitter_sec, lead_in=1.0, sr=SR):
    """A voice singing each note ``jitter_sec[i]`` early (negative) or late, legato into the next."""
    beat = 60.0 / tempo
    starts = [lead_in + t.start_beat * beat + j for t, j in zip(targets, jitter_sec)]
    ends = starts[1:] + [lead_in + (targets[-1].start_beat + targets[-1].dur_beats) * beat]
    n = int(sr * (ends[-1] + 0.5))
    contour = np.full(n, np.nan)
    for t, s, e in zip(targets, starts, ends):
        contour[int(sr * s):int(sr * (e - 0.03))] = t.pitch_midi
    voiced = ~np.isnan(contour)
    f0 = np.where(voiced, _hz(np.nan_to_num(contour, nan=60.0)), 0.0)
    phase = 2.0 * np.pi * np.cumsum(f0) / sr
    y = sum(w * np.sin(k * phase) for k, w in enumerate((1.0, 0.5, 0.25), start=1))
    return (y * voiced * 0.5).astype(np.float32)


def test_the_curriculums_rhythms_are_marked_note_by_note_at_the_fastest_drill_tempo():
    rng = np.random.default_rng(7)
    for line in (_SYNCOPATED, _TIED_TRIPLETS, _DOTTED):
        targets = _rhythm_targets(line)
        assert min(t.dur_beats for t in targets) * 60.0 / FASTEST_DRILL_BPM >= 0.3
        # Each note up to 60 ms early or late, as an untrained singer's are.
        jitter = rng.uniform(-0.06, 0.06, len(targets))
        g = grade(_take_with_jitter(targets, FASTEST_DRILL_BPM, jitter), SR, targets, FASTEST_DRILL_BPM, lead_in_sec=1.0)
        assert [n.status for n in g.notes] == ["hit"] * len(targets), [(n.index, n.status, n.cents) for n in g.notes]
        assert g.score == 100


def test_a_wrong_quaver_in_a_rhythmic_drill_is_still_caught():
    targets = _rhythm_targets(_SYNCOPATED)
    sung = [TargetNote(t.pitch_midi + (2 if i == 2 else 0), t.start_beat, t.dur_beats) for i, t in enumerate(targets)]
    g = grade(_take_with_jitter(sung, FASTEST_DRILL_BPM, [0.0] * len(sung)), SR, targets, FASTEST_DRILL_BPM, lead_in_sec=1.0)
    assert g.notes[2].status == "wrong"
    assert sum(n.status == "hit" for n in g.notes) == len(targets) - 1
