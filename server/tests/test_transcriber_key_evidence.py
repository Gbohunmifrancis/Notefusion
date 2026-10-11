"""Key evidence beyond the solo voice's own scale fit.

The voice engine decides the doh from the sung notes alone and snaps them into that scale.
When something else knows the key better — the user, who typed it; a song's backing, whose
chords say where the music rests — the notes are written again in that scale from the same
sung pitches, unless the voice is plainly not in it.

The sung line throughout is a G major tune whose F#s are sung 55 cents flat, nearer F than
F#: alone, the voice fits C major and writes them as F (``tests.test_vocal.FLAT_TI_SUNG``).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app.pipeline import transcriber, vocal
from app.pipeline.transcriber import Event, transcribe
from tests.accuracy import chords_bench as bench
from tests.test_vocal import FLAT_TI_SUNG, FLAT_TI_TUNE

SR = vocal.SAMPLE_RATE
BEAT = 60.0 / 90.0
LEAD_IN = 0.4
DIATONIC = {"d", "r", "m", "f", "s", "l", "t"}


def _sing(path: Path, pitches: list[float], seconds: float | None = None) -> Path:
    """One steady harmonic tone per beat at 90 BPM, a short breath between notes."""
    total = seconds if seconds is not None else LEAD_IN + len(pitches) * BEAT + 0.5
    y = np.zeros(int(total * SR))
    for i, m in enumerate(pitches):
        a = int((LEAD_IN + i * BEAT) * SR)
        t = np.arange(int(0.85 * BEAT * SR)) / SR
        f0 = 440.0 * 2.0 ** ((m - 69.0) / 12.0)
        tone = sum(w * np.sin(2 * np.pi * k * f0 * t) for k, w in enumerate((1.0, 0.5, 0.25), start=1))
        y[a:a + t.size] += tone * np.minimum(1.0, np.minimum(t, t[-1] - t) / 0.02)
    sf.write(str(path), (0.4 * y / np.max(np.abs(y))).astype(np.float32), SR)
    return path


@pytest.fixture(scope="module")
def flat_ti(tmp_path_factory) -> Path:
    return _sing(tmp_path_factory.mktemp("sung") / "flat_ti.wav", FLAT_TI_SUNG)


def _pitches(result) -> list[int]:
    return [n.pitch_midi for n in result.notes]


# ── The key the user gave ─────────────────────────────────────────────────────


def test_rewrite_in_root_writes_the_engines_notes_again_from_the_sung_pitches():
    fit = vocal.ScaleFit(offset=0.1, root=0, cost_margin=0.4, tonal_margin=1.0)
    snapped = vocal.snap_to_scale([m - fit.offset for m in FLAT_TI_SUNG], fit.root)
    events = [Event(i * 0.5, i * 0.5 + 0.45, p, 0.8, pyin_midi=m - fit.offset, stability=1.0)
              for i, (m, p) in enumerate(zip(FLAT_TI_SUNG, snapped))]
    events, offset = transcriber._rewrite_in_root(events, fit, 7)
    assert [e.pitch for e in events] == FLAT_TI_TUNE
    # The tuned pitch each note carries is measured against the new offset, so it still sits
    # next to the note written.
    assert [e.pyin_midi + offset for e in events] == pytest.approx(FLAT_TI_SUNG)


def test_rewrite_in_root_declines_a_scale_the_voice_is_plainly_not_in():
    scale = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]
    fit = vocal.ScaleFit(offset=0.0, root=0, cost_margin=1.0, tonal_margin=1.0)
    events = [Event(i * 0.5, i * 0.5 + 0.45, p, 0.8, pyin_midi=p + 0.05, stability=1.0) for i, p in enumerate(scale)]
    assert transcriber._rewrite_in_root(events, fit, 6) is None


def test_the_users_key_writes_the_notes_in_its_own_scale(flat_ti):
    alone = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True)
    assert _pitches(alone).count(77) == 3  # the voice alone: C major, the F#s written F
    given = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="G major")
    assert given.key == "G major"
    assert _pitches(given) == FLAT_TI_TUNE
    assert {n.solfa for n in given.notes} <= DIATONIC


def test_the_users_key_is_read_in_the_keyboards_written_pitch(flat_ti):
    # A keyboard set to -4 plays B major shapes for the G major heard; the user's key is the
    # written one.  Same notes four semitones up, same syllables, same confidence per note.
    heard = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="G major")
    played = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="B major",
                        keyboard_transpose=-4)
    assert played.key == "B major"
    assert _pitches(played) == [p + 4 for p in FLAT_TI_TUNE]
    assert [n.solfa for n in played.notes] == [n.solfa for n in heard.notes]
    assert [n.conf for n in played.notes] == [n.conf for n in heard.notes]


def test_a_key_the_voice_is_plainly_not_in_only_relabels(flat_ti):
    alone = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True)
    wrong = transcribe(flat_ti, mode="melody", audio_preview=False, fast=True, key_override="F# major")
    assert wrong.key == "F# major"
    assert _pitches(wrong) == _pitches(alone)


# ── A song's backing ─────────────────────────────────────────────────────────


def _backing(path: Path, case: bench.Case) -> Path:
    notes, seconds = bench.notes_for(case)
    sf.write(str(path), bench.render(notes, seconds, use_samples=False), bench.SAMPLE_RATE)
    return path


def test_a_songs_chords_give_the_doh_the_voice_missed(tmp_path):
    case = bench.Case("song_G", "G major", 90, [("G", 4), ("C", 4), ("D", 4), ("G", 4)], style="bass", lead_in=LEAD_IN)
    backing = _backing(tmp_path / "backing.wav", case)
    vocal_path = _sing(tmp_path / "vocal.wav", FLAT_TI_SUNG, seconds=sf.info(str(backing)).duration)
    result = transcribe(vocal_path, mode="melody", audio_preview=False, fast=True, chord_source=backing)
    assert result.key == "G major"
    assert _pitches(result) == FLAT_TI_TUNE
    assert {n.solfa for n in result.notes} <= DIATONIC
    # The chord row is spelled in the key the tune is in.
    assert [c.solfa for c in result.chords] == ["d", "f", "s", "d"]


def test_a_backing_in_a_scale_the_voice_is_not_in_leaves_the_voices_doh(tmp_path):
    # An in-tune C major line over a backing in A-flat: the chords are sure of their key, and
    # the voice is plainly not in its scale.
    case = bench.Case("song_Ab", "Ab major", 90, [("Ab", 4), ("Db", 4), ("Eb", 4), ("Ab", 4)], style="bass", lead_in=LEAD_IN)
    backing = _backing(tmp_path / "backing.wav", case)
    line = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 60]
    vocal_path = _sing(tmp_path / "vocal.wav", line, seconds=sf.info(str(backing)).duration)
    result = transcribe(vocal_path, mode="melody", audio_preview=False, fast=True, chord_source=backing)
    assert result.key == "C major"
    assert _pitches(result) == line
    assert result.chords
