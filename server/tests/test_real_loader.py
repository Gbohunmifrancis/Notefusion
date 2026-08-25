import json

import pytest

from tests.accuracy.real_loader import load_real_cases


def _write_case(root, name="humming_c_major_01"):
    (root / f"{name}.wav").write_bytes(b"RIFF")
    (root / f"{name}.truth.json").write_text(json.dumps({
        "key": "C major",
        "tempo_bpm": 100,
        "notes": [
            {"pitch_midi": 60, "onset_sec": 0.42, "dur_sec": 0.55},
            {"pitch_midi": 62, "onset_sec": 1.01, "dur_sec": 0.58},
        ],
    }), encoding="utf-8")


def test_loads_real_sidecar_and_normalises_beats(tmp_path):
    _write_case(tmp_path)
    case = load_real_cases(tmp_path)[0]
    assert case.name == "humming_c_major_01"
    assert case.notes[0].onset_beat == pytest.approx(0.0)
    assert case.notes[1].onset_beat == pytest.approx((1.01 - 0.42) * 100 / 60)
    assert case.notes[0].dur_beats == pytest.approx(0.55 * 100 / 60)


def test_rejects_legacy_bare_list(tmp_path):
    (tmp_path / "clip.wav").write_bytes(b"RIFF")
    (tmp_path / "clip.truth.json").write_text("[]", encoding="utf-8")
    with pytest.raises(ValueError, match="legacy bare-list"):
        load_real_cases(tmp_path)


def test_rejects_missing_audio(tmp_path):
    (tmp_path / "clip.truth.json").write_text(json.dumps({
        "key": "C major", "tempo_bpm": 100,
        "notes": [{"pitch_midi": 60, "onset_sec": 0, "dur_sec": 1}],
    }), encoding="utf-8")
    with pytest.raises(ValueError, match="missing audio"):
        load_real_cases(tmp_path)


def test_loads_audio_beside_truth_sidecar(tmp_path):
    _write_case(tmp_path)
    case = load_real_cases(tmp_path)[0]
    assert case.audio_path.name == "humming_c_major_01.wav"
