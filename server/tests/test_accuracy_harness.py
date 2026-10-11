"""The measurement harness's own definitions: the frozen Vocadito reference, the voice
options the sung corpus's stress slices add, and the slices themselves.

The benchmarks themselves are slow and run by hand (``tests.accuracy``); these check
that what they score against, and what they render, say what they claim to.
"""

import json
from dataclasses import replace

import numpy as np

from tests.accuracy import vocadito, vocal_synth
from tests.accuracy.vocal_corpus import CASES, SLICE_CASES, SLICES, STYLES
from tests.accuracy.vocal_synth import VocalOptions

SR = vocal_synth.SAMPLE_RATE


def _reference() -> dict:
    return json.loads(vocadito.REFERENCE_PATH.read_text())


def test_frozen_vocadito_reference_scores_the_clips_both_annotators_agree_on():
    reference = _reference()
    clips = {int(c): entry for c, entry in reference["clips"].items()}
    assert sorted(clips) == list(range(1, 41))
    for entry in clips.values():
        agree = bool(entry["A1"] and entry["A2"] and entry["A1"]["root"] == entry["A2"]["root"])
        assert entry["consensus"] == agree
    assert reference["scored_clips"] == [c for c in sorted(clips) if clips[c]["consensus"]]
    assert len(reference["scored_clips"]) == 34


def test_frozen_vocadito_reference_labels_the_accidental_columns_tunes():
    reference = _reference()
    scored = reference["scored_clips"]
    tune_class = {int(c): entry["tune_class"] for c, entry in reference["clips"].items()}
    assert [c for c in scored if tune_class[c] == "chromatic"] == [19, 39, 40]
    assert len([c for c in scored if tune_class[c] == "diatonic_high"]) == 14


def test_slice_only_voice_options_do_not_reseed_the_corpus():
    # The render is seeded from repr(options): these stay out of it, so no corpus case is
    # re-drawn, and a slice style draws exactly what its corpus twin does.
    base = STYLES["hum_amateur"]
    assert repr(replace(base, legato=True, note_detune_clip_cents=100.0)) == repr(base)
    assert all(not case.options.legato and case.options.note_detune_clip_cents == 60.0 for case in CASES)


def _boundary_level(audio: np.ndarray, onset_sec: float, held_rms: float) -> float:
    """Quietest 5 ms around a note boundary, relative to the held note."""
    def rms(t: float) -> float:
        start = int(t * SR)
        return float(np.sqrt(np.mean(audio[start : start + int(0.005 * SR)] ** 2)))

    return min(rms(onset_sec + d) for d in np.arange(-0.03, 0.06, 0.0025)) / held_rms


def test_the_corpus_fingerprint_moves_only_with_what_a_render_depends_on():
    # The slice-only options left at their defaults render the corpus as before they existed,
    # so a baseline recorded then still matches; set, they are part of the render.
    from tests.accuracy.vocal_corpus import vocal_corpus_fingerprint

    assert vocal_corpus_fingerprint(CASES) == "e09ad8c34b63939a"  # vocal_baseline.json's corpus
    legato = tuple(replace(c, options=replace(c.options, legato=True)) for c in CASES)
    assert vocal_corpus_fingerprint(legato) != vocal_corpus_fingerprint(CASES)


def test_legato_joins_a_pitch_change_with_no_valley_but_still_rearticulates_a_repeat():
    notes = ((60, 1.0), (64, 1.0), (64, 1.0))  # a step up, then the same pitch again
    levels = {}
    for legato in (False, True):
        audio, refs = vocal_synth.render(notes, 60, replace(STYLES["hum_amateur"], legato=legato))
        middle = int((refs[1].onset_sec + 0.5) * SR)
        held = float(np.sqrt(np.mean(audio[middle : middle + int(0.05 * SR)] ** 2)))
        levels[legato] = [_boundary_level(audio, ref.onset_sec, held) for ref in refs[1:]]
    assert levels[False][0] < 0.3  # every note ramps in from silence
    assert levels[True][0] > 0.8  # legato: the step is carried on at full level
    assert levels[True][1] < 0.6  # but a repeated pitch is still re-articulated


def _cents_off_middle_c(options: VocalOptions) -> np.ndarray:
    """Each note's sung pitch in cents from C4, from a finely interpolated spectrum peak."""
    audio, refs = vocal_synth.render(((60, 1.0), (None, 1.0)) * 30, 120, options)
    n_fft = 1 << 18
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    cents = []
    for ref in refs:
        start, end = int((ref.onset_sec + 0.1) * SR), int((ref.onset_sec + ref.dur_sec - 0.1) * SR)
        spectrum = np.abs(np.fft.rfft(audio[start:end] * np.hanning(end - start), n_fft))
        k = int(np.argmax(np.where((freqs > 180) & (freqs < 380), spectrum, 0.0)))
        lo, mid, hi = np.log(spectrum[k - 1 : k + 2])
        hz = freqs[k] + 0.5 * (lo - hi) / (lo - 2 * mid + hi) * (freqs[1] - freqs[0])
        cents.append(1200 * np.log2(hz / 261.6256))
    return np.array(cents)


def test_a_wider_detune_clip_lets_a_note_land_beyond_75_cents():
    singer = VocalOptions(style="hum", jitter_cents=0.0, note_detune_cents=40.0)
    assert np.max(np.abs(_cents_off_middle_c(singer))) < 60.5
    assert np.max(np.abs(_cents_off_middle_c(replace(singer, note_detune_clip_cents=100.0)))) > 75.0


def test_slices_pose_the_defects_they_are_named_for():
    for case in SLICES["long_drift"]:
        seconds = case.options.lead_in_sec + sum(d for _, d in case.notes) * 60.0 / case.tempo_bpm + case.options.tail_sec
        assert 45.0 <= seconds <= 60.0
        assert -120.0 <= case.options.drift_cents <= -80.0
    assert all(case.options.note_detune_clip_cents > 75.0 for case in SLICES["wide_detune"])
    assert all(len(case.notes) <= 9 for case in SLICES["first_phrase"])
    assert all(case.options.legato for case in SLICES["legato"])
    names = [case.name for case in SLICE_CASES]
    assert len(set(names)) == len(names) and not set(names) & {case.name for case in CASES}
