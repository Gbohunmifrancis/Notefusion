"""Unit tests for the voice engine (app.pipeline.vocal).

Everything here runs on synthesised audio or hand-built contours in well under a second;
the end-to-end accuracy of the engine on sung material is measured by the vocal corpus
(``python -m tests.accuracy.report --vocal``), not here.
"""

import numpy as np
import pytest

from app.pipeline import vocal

SR = vocal.SAMPLE_RATE
HOP_SEC = vocal.HOP / SR


def _midi_to_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def _tone(midi_contour: np.ndarray, sr: int = SR, harmonics=(1.0, 0.5, 0.25)) -> np.ndarray:
    """Phase-integrated harmonic tone following a per-sample MIDI contour (NaN = silence)."""
    voiced = ~np.isnan(midi_contour)
    f0 = np.where(voiced, _midi_to_hz(np.nan_to_num(midi_contour, nan=60.0)), 0.0)
    phase = 2.0 * np.pi * np.cumsum(f0) / sr
    y = sum(w * np.sin(k * phase) for k, w in enumerate(harmonics, start=1))
    return (y * voiced * 0.5).astype(np.float32)


def _contour(notes, sr: int = SR, glide_sec: float = 0.0, lead_sec: float = 0.2) -> np.ndarray:
    """Per-sample MIDI contour from (midi | None, seconds) pairs with optional glides."""
    total = int(sr * (lead_sec + sum(d for _, d in notes) + 0.2))
    out = np.full(total, np.nan)
    cursor = int(sr * lead_sec)
    previous = None
    for midi, dur in notes:
        n = int(sr * dur)
        if midi is not None:
            out[cursor : cursor + n] = midi
            if previous is not None and glide_sec > 0:
                g = int(sr * glide_sec)
                lo, hi = cursor - g // 2, cursor + g // 2
                ramp = 0.5 - 0.5 * np.cos(np.pi * np.arange(hi - lo) / (hi - lo))
                out[lo:hi] = previous + (midi - previous) * ramp
            previous = midi
        else:
            previous = None
        cursor += n
    return out


def _contour_obj(midi: np.ndarray, rms: np.ndarray | None = None) -> vocal.Contour:
    n = midi.size
    times = np.arange(n) * HOP_SEC
    rms = np.ones(n) if rms is None else rms
    return vocal.Contour(times=times, midi=midi, voiced_prob=np.ones(n), rms=rms, rms_fast=rms)


# ── Tuning ────────────────────────────────────────────────────────────────────


def test_tuning_offset_recovers_a_sharp_clip():
    midis = [60.4, 62.4, 64.4, 65.4, 67.4, 60.4]
    assert vocal.tuning_offset_cents(midis, [1.0] * len(midis)) == pytest.approx(40.0, abs=1.0)


def test_tuning_offset_recovers_a_flat_clip_across_the_wrap():
    # -45 cents sits next to +55 on the circle; a linear mean would read it as +5.
    midis = [59.55, 61.55, 63.55, 64.55, 66.55]
    assert vocal.tuning_offset_cents(midis, [1.0] * 5) == pytest.approx(-45.0, abs=1.0)


def test_tuning_offset_declines_when_deviations_are_scattered():
    midis = [60.0, 62.25, 64.5, 65.75, 67.0, 69.3]
    assert vocal.tuning_offset_cents(midis, [1.0] * 6) == 0.0


def test_tuning_offset_declines_on_too_few_notes():
    assert vocal.tuning_offset_cents([60.4, 62.4], [1.0, 1.0]) == 0.0


# ── Segmentation ──────────────────────────────────────────────────────────────


def test_segment_run_cuts_at_a_step_and_not_inside_a_steady_note():
    midi = np.concatenate([np.full(30, 60.0), np.full(30, 62.0), np.full(30, 67.0)])
    spans = vocal.segment_run(midi, HOP_SEC)
    assert len(spans) == 3
    # Boundaries land within a few frames of the true steps.
    assert abs(spans[0][1] - 30) <= 3 and abs(spans[1][1] - 60) <= 3


def test_segment_run_keeps_a_vibrato_note_whole():
    t = np.arange(80) * HOP_SEC
    midi = 64.0 + 0.9 * np.sin(2 * np.pi * 5.5 * t)  # ±0.9 semitone at 5.5 Hz
    assert len(vocal.segment_run(midi, HOP_SEC)) == 1


def test_segment_run_detects_a_semitone_step_under_vibrato():
    t = np.arange(40) * HOP_SEC
    wobble = 0.5 * np.sin(2 * np.pi * 5.5 * t)
    midi = np.concatenate([64.0 + wobble, 65.0 + wobble])
    spans = vocal.segment_run(midi, HOP_SEC)
    assert len(spans) == 2
    assert abs(spans[0][1] - 40) <= 4


def test_segment_run_ignores_a_single_frame_glitch():
    midi = np.full(60, 60.0)
    midi[30] = 72.0
    c = vocal.smooth(_contour_obj(midi))
    assert len(vocal.segment(c)) == 1


# ── Clean-up ──────────────────────────────────────────────────────────────────


def test_clean_splits_a_transition_sliver_between_its_neighbours():
    midi = np.concatenate([np.full(20, 60.0), np.full(3, 62.0), np.full(20, 64.0)])
    c = vocal.smooth(_contour_obj(midi))
    c = vocal.Contour(c.times, c.midi, c.voiced_prob, c.rms, c.rms_fast, np.ones(midi.size, dtype=bool))
    notes = vocal.clean(c, [(0, 20), (20, 23), (23, 43)])
    assert [round(m) for _, _, m in notes] == [60, 64]
    assert notes[0][1] == notes[1][0]  # no gap left behind


def test_clean_joins_a_same_pitch_split_without_a_restrike():
    midi = np.full(40, 60.0)
    c = vocal.smooth(_contour_obj(midi))
    notes = vocal.clean(c, [(0, 20), (20, 40)])
    assert len(notes) == 1


def test_clean_keeps_a_repeated_note_with_an_amplitude_dip():
    midi = np.full(40, 60.0)
    rms = np.ones(40)
    rms[19:22] = 0.3  # a re-articulation dip between the two strikes
    c = vocal.smooth(_contour_obj(midi, rms))
    notes = vocal.clean(c, [(0, 40)])
    assert len(notes) == 2


def test_clean_does_not_split_on_tremolo():
    midi = np.full(60, 60.0)
    t = np.arange(60) * HOP_SEC
    rms = 1.0 - 0.25 * (1 + np.sin(2 * np.pi * 5.5 * t)) / 2  # 25% ripple at a vibrato rate
    c = vocal.smooth(_contour_obj(midi, rms))
    assert len(vocal.clean(c, [(0, 60)])) == 1


def test_clean_drops_a_fragment_too_short_to_be_a_note():
    midi = np.concatenate([np.full(20, 60.0), np.full(1, 67.0)])
    c = vocal.smooth(_contour_obj(midi))
    notes = vocal.clean(c, [(0, 20), (20, 21)])
    assert [round(m) for _, _, m in notes] == [60]


# ── Key-aware rounding ────────────────────────────────────────────────────────


def test_notate_rounds_plainly_when_unambiguous():
    midis = [60.1, 62.0, 63.9, 65.2, 67.0, 69.1]
    assert vocal.notate(midis, [1.0] * 6) == [60, 62, 64, 65, 67, 69]


def test_notate_gives_an_ambiguous_note_to_the_diatonic_neighbour():
    # A C-major line; the fourth note sits 45 cents above E — between E and F.
    midis = [60.0, 62.0, 64.0, 64.45, 67.0, 69.0, 71.0, 72.0]
    out = vocal.notate(midis, [1.0] * 8)
    assert out[3] in (64, 65)  # both diatonic in C: plain rounding wins (64)
    midis = [60.0, 62.0, 64.0, 66.45, 67.0, 69.0, 71.0, 72.0]  # between F# and G
    assert vocal.notate(midis, [1.0] * 8)[3] == 67


def test_notate_keeps_a_clearly_chromatic_note():
    midis = [60.0, 62.0, 64.0, 66.05, 67.0, 69.0, 71.0, 72.0]  # a sung F# in C
    assert vocal.notate(midis, [1.0] * 8)[3] == 66


def test_diatonic_set_reads_a_minor_key_with_its_raised_seventh():
    # A minor: A B C D E F G# A — G# (68) is the raised 7th.
    midis = [69, 71, 72, 74, 76, 77, 68, 69, 76, 72, 69]
    members, _margin = vocal.diatonic_set(midis, [1.0] * len(midis))
    assert 8 in members  # G#
    assert members >= {9, 11, 0, 2, 4, 5, 7}


# ── End to end on synthesised voice ───────────────────────────────────────────


def test_analyse_transcribes_a_sharp_legato_line_without_ghost_notes():
    notes = [(60, 0.5), (62, 0.5), (64, 0.5), (65, 0.5), (67, 1.0), (64, 0.5), (60, 1.0)]
    midi = _contour(notes, glide_sec=0.1) + 0.4  # sung 40 cents sharp, with 100 ms glides
    result = vocal.analyse(_tone(midi))
    assert [n.pitch for n in result.notes] == [p for p, _ in notes]
    assert result.tuning_cents == pytest.approx(40.0, abs=8.0)


def test_analyse_follows_the_tuning_rather_than_rounding_at_random():
    notes = [(60, 0.5), (62, 0.5), (64, 0.5), (65, 0.5), (67, 0.5), (69, 0.5), (71, 0.5), (72, 1.0)]
    midi = _contour(notes, glide_sec=0.08) - 0.45  # 45 cents flat
    result = vocal.analyse(_tone(midi))
    assert [n.pitch for n in result.notes] == [p for p, _ in notes]


def test_analyse_keeps_vibrato_notes_whole():
    notes = [(65, 0.8), (69, 0.8), (67, 0.8), (65, 1.0)]
    midi = _contour(notes, glide_sec=0.1)
    t = np.arange(midi.size) / SR
    midi = midi + 0.6 * np.sin(2 * np.pi * 5.8 * t)  # ±60 cents of vibrato
    result = vocal.analyse(_tone(midi))
    assert [n.pitch for n in result.notes] == [p for p, _ in notes]


def test_analyse_times_notes_where_they_were_sung():
    notes = [(60, 0.6), (64, 0.6), (67, 0.6)]
    result = vocal.analyse(_tone(_contour(notes, glide_sec=0.06, lead_sec=0.5)))
    starts = [n.start for n in result.notes]
    assert starts == pytest.approx([0.5, 1.1, 1.7], abs=0.06)


def test_analyse_fixes_a_missing_fundamental_octave_error():
    # Only even harmonics of 220 Hz: the sound is A4 (440 Hz), and a tracker that reads
    # A3 has read the harmonic pattern an octave low.
    notes = [(57, 0.6), (59, 0.6), (61, 0.6), (62, 0.6), (64, 0.6)]
    midi = _contour(notes)
    tone = _tone(midi, harmonics=(0.0, 1.0, 0.0, 0.5, 0.0, 0.25))
    result = vocal.analyse(tone)
    assert [n.pitch for n in result.notes] == [p + 12 for p, _ in notes]


def test_analyse_returns_nothing_on_silence():
    assert vocal.analyse(np.zeros(SR, dtype=np.float32)).notes == []


def test_condition_normalises_and_removes_dc():
    y = np.full(SR, 0.3, dtype=np.float32) + 0.01 * np.sin(np.arange(SR) * 2 * np.pi * 220 / SR).astype(np.float32)
    out = vocal.condition(y)
    assert abs(float(out[SR // 2 :].mean())) < 0.02
    assert float(np.max(np.abs(out))) == pytest.approx(0.9, abs=0.05)
