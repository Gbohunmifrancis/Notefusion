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


def _dipped(onset: np.ndarray, voiced_prob: np.ndarray | None = None) -> vocal.Contour:
    """One held pitch whose level dips at frame 20, with the given onset and voicing tracks."""
    midi = np.full(40, 60.0)
    rms = np.ones(40)
    rms[19:22] = 0.3
    c = vocal.smooth(_contour_obj(midi, rms))
    vp = np.ones(40) if voiced_prob is None else voiced_prob
    return vocal.Contour(c.times, c.midi, vp, c.rms, c.rms_fast, c.stable, onset=onset)


def test_clean_does_not_split_on_a_dip_with_no_new_attack():
    # Reverb beating against a held note, or a separated stem thinning out: the level dips,
    # but nothing starts again — no spectral-flux onset, no break in the voicing.
    notes = vocal.clean(_dipped(onset=np.ones(40)), [(0, 40)])
    assert len(notes) == 1


def test_clean_splits_a_dip_followed_by_an_attack():
    onset = np.ones(40)
    onset[22] = 3.0  # the level comes back as a new attack
    assert len(vocal.clean(_dipped(onset), [(0, 40)])) == 2


def test_clean_splits_a_dip_where_the_voicing_breaks():
    vp = np.full(40, 0.9)
    vp[19:22] = 0.1  # a glottal stop: pyin loses the voice for a moment
    assert len(vocal.clean(_dipped(np.ones(40), vp), [(0, 40)])) == 2


def _reverb(y: np.ndarray, rt60: float = 1.3) -> np.ndarray:
    """A plain exponential-noise hall, mixed in at the level a produced vocal carries."""
    from scipy import signal

    rng = np.random.default_rng(7)
    t = np.arange(int(rt60 * SR)) / SR
    ir = signal.sosfilt(signal.butter(1, 4000, fs=SR, output="sos"), rng.standard_normal(t.size) * np.exp(-6.91 * t / rt60))
    ir[: int(0.02 * SR)] = 0.0
    wet = signal.fftconvolve(y, ir)[: y.size]
    return y + wet * 0.35 * np.sqrt(np.mean(y ** 2)) / np.sqrt(np.mean(wet ** 2))


def test_analyse_keeps_a_reverberant_held_note_whole():
    from tests.accuracy import vocal_synth
    from tests.accuracy.vocal_corpus import STYLES

    y, _ = vocal_synth.render(((60, 1.0), (64, 6.0), (62, 1.0)), 90, STYLES["ah_vibrato"], sr=SR)
    assert [n.pitch for n in vocal.analyse(_reverb(y), SR).notes] == [60, 64, 62]


def test_analyse_still_splits_repeated_notes_under_reverb():
    from tests.accuracy import vocal_synth
    from tests.accuracy.vocal_corpus import STYLES

    y, _ = vocal_synth.render(((60, 1.0), (64, 2.0), (64, 2.0), (64, 2.0), (62, 1.0)), 90, STYLES["ah_vibrato"], sr=SR)
    assert [n.pitch for n in vocal.analyse(_reverb(y), SR).notes] == [60, 64, 64, 64, 62]


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


# ── Scale-fit notation ───────────────────────────────────────────────────────


def test_fit_scale_finds_the_offset_and_the_scale_of_a_scattered_singer():
    # C major, sung 35 cents flat overall, each note off by up to a third of a semitone
    # more: the deviations are spread too wide for a circular mean, which gives up, and
    # rounding each note on its own then writes three of them a semitone low...
    intended = [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]
    scatter = [0.30, -0.33, 0.20, -0.28, 0.33, -0.30, 0.25, -0.20, 0.30, -0.33, 0.05]
    sung = [p - 0.35 + e for p, e in zip(intended, scatter)]
    assert vocal.tuning_offset_cents(sung, [1.0] * len(sung)) == 0.0
    assert vocal.notate(sung, [1.0] * len(sung)) != intended
    # ...but the seven-of-twelve pattern of the scale pins it down.
    offset, root = vocal.fit_scale(sung, [1.0] * len(sung))
    assert root == 0
    assert offset == pytest.approx(-0.35, abs=0.05)
    assert vocal.snap_to_scale([m - offset for m in sung], root) == intended


def test_fit_scale_declines_on_too_few_notes():
    assert vocal.fit_scale([60.1, 62.0, 64.2], [1.0, 1.0, 1.0]) is None


def test_fit_scale_ignores_unvoiced_notes():
    sung = [60.0, 62.0, float("nan"), 64.0, 65.0, 67.0, 69.0]
    assert vocal.fit_scale(sung, [1.0] * len(sung)) == pytest.approx((0.0, 0), abs=0.02)


def test_fit_scale_breaks_a_pentatonic_tie_on_the_tonal_profile():
    # Do-re-mi-sol-la lies in C, F and G major alike; long Cs and a final C say C.
    sung = [60, 62, 64, 67, 69, 67, 64, 62, 60]
    weights = [2.0, 1, 1, 1, 1, 1, 1, 1, 3.0]
    assert vocal.fit_scale(sung, weights)[1] == 0


def test_snap_to_scale_writes_an_off_pitch_note_as_its_scale_tone():
    # In C major a note 35 cents below F is an imprecise F, not an E-natural-plus.
    assert vocal.snap_to_scale([64.65], 0) == [65]
    # 35 cents above F# is an imprecise G, 30 cents below it an imprecise F.
    assert vocal.snap_to_scale([66.35, 65.7], 0) == [67, 65]


def test_snap_to_scale_keeps_a_clearly_chromatic_note():
    # G major with a sung C#: within SCALE_KEEP_CHROMATIC of it, so it is real music.
    assert vocal.snap_to_scale([73.1, 72.9], 7) == [73, 73]
    # 30 cents off C# toward D is past the keep band: the singer meant D.
    assert vocal.snap_to_scale([73.3], 7) == [74]


def test_span_pitch_ignores_unvoiced_frames_inside_a_joined_note():
    # Two pieces of one note joined across a gap the bridge did not fill: the NaN frames
    # used to make the note's pitch NaN, and notate() then failed the whole transcription.
    midi = np.concatenate([np.full(20, 62.0), np.full(3, np.nan), np.full(20, 62.1)])
    pitch, _ = vocal._span_pitch(vocal.smooth(_contour_obj(midi)), 0, midi.size)
    assert pitch == pytest.approx(62.05, abs=0.06)


def test_analyse_survives_a_dropout_inside_a_note():
    notes = [(60, 0.5), (62, 0.5), (64, 0.6), (65, 0.5), (67, 0.8)]
    midi = _contour(notes, glide_sec=0.06)
    # A 55 ms dropout in the middle of the E: longer than the bridge, shorter than the join.
    start = int(SR * (0.2 + 1.0 + 0.25))
    midi[start : start + int(SR * 0.055)] = np.nan
    result = vocal.analyse(_tone(midi))
    # The sound stops for 55 ms, so the E may come back as two Es; what must not happen is
    # a wrong pitch or a failure.
    pitches = [n.pitch for n in result.notes]
    collapsed = [p for i, p in enumerate(pitches) if i == 0 or p != pitches[i - 1]]
    assert collapsed == [p for p, _ in notes]


def test_fix_octaves_handles_a_note_near_the_top_of_the_spectrum():
    # A high note whose sixth harmonic window starts on the last FFT bin used to index past
    # the spectrum.
    c = _contour_obj(np.full(40, 103.0))
    y = _tone(np.full(40 * vocal.HOP, 103.0))
    assert vocal.fix_octaves(y, SR, c, [(0, 40, 103.0)]) == [(0, 40, 103.0)]


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


# ── Scale fit: near-ties, margins, confidence ─────────────────────────────────


def test_fit_scale_settles_a_near_tie_on_the_tonal_profile():
    # G A B C C# D | D C# C B A G with a little scatter: C and C# are each sung twice, so
    # G major (where C# is chromatic) and D major (where C is) cost the same to within
    # the scatter.  The long G's and the final G say G.
    sung = [67.05, 69.0, 70.95, 72.1, 73.0, 74.05, 74.0, 72.9, 72.0, 71.05, 69.0, 66.95]
    weights = [1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 2]
    fit = vocal.fit_scale_detail(sung, weights)
    assert fit.root == 7
    assert fit.cost_margin <= vocal.SCALE_FIT_TIE_RATIO
    assert fit.tonal_margin > 0.0
    assert vocal.fit_scale(sung, weights) == (fit.offset, fit.root)


def test_a_decisive_fit_is_sure_and_a_tie_is_only_as_sure_as_its_profile():
    sure = vocal.ScaleFit(0.0, 0, cost_margin=0.2, tonal_margin=1.0)
    tie_clear = vocal.ScaleFit(0.0, 0, cost_margin=0.0, tonal_margin=0.3)
    tie_unclear = vocal.ScaleFit(0.0, 0, cost_margin=0.0, tonal_margin=0.02)
    assert sure.confidence == pytest.approx(1.0)
    assert sure.confidence > tie_clear.confidence > tie_unclear.confidence
    assert tie_unclear.confidence < 0.1


def test_a_full_scale_sung_in_tune_fits_with_a_wide_margin():
    sung = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]
    fit = vocal.fit_scale_detail(sung, [1.0] * len(sung))
    assert fit.root == 0
    assert fit.cost_margin > vocal.SCALE_FIT_TIE_RATIO
    assert fit.confidence >= 0.5


# ── Re-strikes with a strong attack ──────────────────────────────────────────


def _shallow_dip(onset: np.ndarray) -> vocal.Contour:
    """One held pitch whose level dips only to 0.7 at frame 20: too shallow on its own."""
    midi = np.full(40, 60.0)
    rms = np.ones(40)
    rms[19:22] = 0.7
    c = vocal.smooth(_contour_obj(midi, rms))
    return vocal.Contour(c.times, c.midi, np.ones(40), c.rms, c.rms_fast, c.stable, onset=onset)


def test_clean_splits_a_shallow_dip_that_comes_back_as_a_clear_attack():
    # A hum re-struck on the same pitch: the 23 ms frame straddles the dip and reads it at
    # 0.7 of the flanks, but the spectral flux of the new attack is unmistakable.
    onset = np.ones(40)
    onset[22] = vocal.ONSET_CUE_STRONG_FLUX + 1.0
    assert len(vocal.clean(_shallow_dip(onset), [(0, 40)])) == 2


def test_clean_keeps_a_shallow_dip_with_only_an_ordinary_attack():
    onset = np.ones(40)
    onset[22] = vocal.ONSET_CUE_FLUX + 0.5  # an attack, but not a strong one
    assert len(vocal.clean(_shallow_dip(onset), [(0, 40)])) == 1


def test_analyse_reports_how_steadily_each_note_was_held():
    y = _tone(_contour([(60, 0.6), (64, 0.6), (67, 0.6), (64, 0.6), (60, 0.6)]))
    notes = vocal.analyse(y, SR).notes
    assert [n.pitch for n in notes] == [60, 64, 67, 64, 60]
    assert all(n.stability > 0.9 for n in notes)


def test_a_quarter_tone_singer_is_written_in_the_simpler_key():
    # Every note 50 cents off: B-flat major 50 cents flat and B major 50 cents sharp are
    # the same reading.  Nothing in the audio separates them, so the simpler key wins.
    sung = [m + 0.5 for m in (70, 72, 74, 75, 77, 79, 81, 82, 81, 79, 77, 75, 74, 72, 70)]
    assert vocal.fit_scale(sung, [1.0] * len(sung))[1] == 10
