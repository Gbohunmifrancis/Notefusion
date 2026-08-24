"""Tests for the WAV audio preview returned alongside a transcription.

The preview had no coverage at all, which is how it shipped sounding the way it
did. Its output is audio, so the tests here assert the properties that can be
checked without listening — and each one corresponds to a specific way the old
voice was wrong:

  _smooth_ramp                     envelope segments join without a slope corner
  level independence               one note's loudness must not depend on whether
                                   *other* notes overlap somewhere else in the clip
  bounded output                   a pile-up compresses instead of clipping
  spectral decay                   a note darkens as it rings rather than droning
  percussive envelope              the body decays continuously instead of holding a
                                   level, which is what made it an organ not a piano
  register scaling                 bass notes ring longer than treble ones, and carry
                                   further up the partial series
  unison beating                   the shimmer is a breath, not a periodic dropout,
                                   measured per partial because the total envelope
                                   is blind to exactly this defect
  determinism                     identical notes render to identical bytes
  no aliasing                      no partial of the top note folds below f0

No ML models and no audio files: the preview synthesiser only needs numpy and
soundfile, both already required in production.
"""

import base64
import io

import numpy as np
import soundfile as sf
from app.pipeline.transcriber import (
    _STRING_DECAY_MAX_SEC,
    _STRING_DECAY_MIN_SEC,
    PREVIEW_SAMPLE_RATE,
    TranscribedNote,
    _body_rolloff,
    _smooth_ramp,
    _string_decay_sec,
    _synthesize_audio_preview,
)

BPM = 120


def note(pitch: int, start: float, dur: float, conf: float = 1.0) -> TranscribedNote:
    return TranscribedNote(
        pitch_midi=pitch,
        start_beat=start,
        dur_beats=dur,
        degree=1,
        solfa="d",
        octave_mark="",
        conf=conf,
    )


def render(notes: list[TranscribedNote], bpm: int = BPM) -> np.ndarray:
    """Decode what the function actually returns, WAV round-trip included."""
    y, sr = sf.read(
        io.BytesIO(base64.b64decode(_synthesize_audio_preview(notes, bpm))),
        dtype="float64",
    )
    assert sr == PREVIEW_SAMPLE_RATE
    return y


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)))


# ── _smooth_ramp ──────────────────────────────────────────────────────────────


class TestSmoothRamp:
    """The envelope is built from these, and a corner in the envelope is a click.

    A linear ramp meeting another linear segment leaves a slope discontinuity, which
    is audible as a tick at the start of every single note. The raised-cosine ramp
    has zero slope at both ends, so consecutive segments join smoothly.
    """

    def test_hits_both_endpoints_exactly(self):
        r = _smooth_ramp(64, 0.0, 1.0)
        assert r[0] == 0.0
        assert r[-1] == 1.0

    def test_is_monotone(self):
        assert np.all(np.diff(_smooth_ramp(64, 0.0, 1.0)) >= 0)
        # The release ramp, which is the only descending one the envelope now uses.
        assert np.all(np.diff(_smooth_ramp(64, 1.0, 0.0)) <= 0)

    def test_slope_is_zero_at_both_ends(self):
        """This is the whole point: it is what lets segments join without a corner."""
        r = _smooth_ramp(256, 0.0, 1.0)
        d = np.diff(r)
        # First and last steps are far smaller than the steepest step in the middle.
        assert abs(d[0]) < d.max() / 50
        assert abs(d[-1]) < d.max() / 50

    def test_join_is_smoother_than_a_linear_ramp(self):
        """Second difference spikes at a slope discontinuity; compare the two joins."""
        n = 330
        linear = np.concatenate([np.linspace(0.0, 1.0, n), np.full(n, 1.0)])
        smooth = np.concatenate([_smooth_ramp(n, 0.0, 1.0), np.full(n, 1.0)])
        assert np.abs(np.diff(smooth, 2)).max() < np.abs(np.diff(linear, 2)).max() / 20


# ── level independence ────────────────────────────────────────────────────────


class TestLevelIndependence:
    """The defect that made the preview sound broken.

    The old code divided the finished mix by its loudest sample. A run of ghost-note
    fragments landing on one instant is several times louder than a single note, so
    that one spike scaled the *whole* clip down and left the actual melody close to
    inaudible. Level must be a property of the note, not of the clip's worst moment.
    """

    # A window well inside the first note, clear of its attack and release.
    WINDOW = slice(int(0.10 * PREVIEW_SAMPLE_RATE), int(0.60 * PREVIEW_SAMPLE_RATE))

    def test_isolated_note_unaffected_by_overlaps_elsewhere(self):
        first = note(60, 0, 2)
        alone = rms(render([first])[self.WINDOW])
        # Five notes stacked on beat 4 — the shape a ghost-fragment pile-up takes.
        crowded = rms(render([first] + [note(60 + i, 4, 2) for i in range(5)])[self.WINDOW])
        assert alone > 0.01, "test window should be inside the note"
        drop_db = abs(20 * np.log10(crowded / alone))
        assert drop_db < 0.5, f"an unrelated pile-up moved this note by {drop_db:.1f} dB"

    def test_a_pile_up_does_not_clip(self):
        y = render([note(60 + i, 0, 2) for i in range(8)])
        assert np.max(np.abs(y)) < 1.0

    def test_confidence_scales_velocity(self):
        loud = rms(render([note(60, 0, 2, conf=1.0)])[self.WINDOW])
        soft = rms(render([note(60, 0, 2, conf=0.0)])[self.WINDOW])
        assert soft < loud


# ── voice ─────────────────────────────────────────────────────────────────────


class TestVoice:
    def test_spectrum_darkens_as_a_note_rings(self):
        """Upper partials decay faster than the fundamental, as a struck string does.

        A flat spectrum for the whole note is what made the old preview sound like a
        test tone; the centroid is the cheapest way to see it move.
        """
        y = render([note(60, 0, 4)])  # 4 beats at 120 BPM = 2 s

        def centroid(seg: np.ndarray) -> float:
            spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size)))
            freqs = np.fft.rfftfreq(seg.size, 1.0 / PREVIEW_SAMPLE_RATE)
            return float((spec * freqs).sum() / spec.sum())

        sr = PREVIEW_SAMPLE_RATE
        early = centroid(y[int(0.02 * sr) : int(0.12 * sr)])
        late = centroid(y[int(1.00 * sr) : int(1.10 * sr)])
        assert late < early * 0.9

    def test_no_aliasing_at_the_pipeline_pitch_ceiling(self):
        """Basic Pitch is capped at 1050 Hz (``max_freq_hz``), so the highest note the
        preview ever renders is about C6 — and that note's partial series runs well
        past Nyquist, so the generator's ``f_k >= nyquist`` guard is the only thing
        keeping it from aliasing.

        Asserted by measurement rather than arithmetic: an aliased partial folds down
        to ``sr - f_k``, which lands *below* the fundamental, somewhere no legitimate
        partial of a harmonic series can ever be. So energy under the fundamental is
        the signature, and looking for it catches a broken guard where recomputing the
        top partial from the constants would only restate the design.
        """
        y = render([note(84, 0, 4)])  # C6, the top of the pipeline's range
        f0 = 440.0 * 2.0 ** ((84 - 69) / 12.0)
        spec = np.abs(np.fft.rfft(y * np.hanning(y.size))) ** 2
        freqs = np.fft.rfftfreq(y.size, 1.0 / PREVIEW_SAMPLE_RATE)
        # 0.9·f0 leaves room for the analysis window's skirt around the fundamental.
        below = spec[(freqs > 20.0) & (freqs < 0.9 * f0)].sum()
        assert below / spec.sum() < 1e-4, "energy below f0 means a partial aliased"

    def test_bass_carries_further_up_the_partial_series_than_treble(self):
        """Register-tilted roll-off. A real piano's bass notes are spectrally much
        flatter than its treble ones, and one exponent for the whole compass is what
        left the old voice's C2 with its entire spectrum sitting at 72 Hz."""
        assert _body_rolloff(36) < _body_rolloff(60) < _body_rolloff(84)

    def test_unison_beating_never_nulls_a_partial(self):
        """The shimmer must be a breath, not a dropout.

        Three equal strings at f-d, f, f+d sum to sin(2·pi·f·t)·(1 + 2·cos(2·pi·d·t)),
        and (1 + 2·cos) crosses *zero* at 2·pi/3 — so modelling a unison that way makes
        every partial periodically vanish. That is the bug this file was given the
        measurement to catch: it showed up as 49 dB of "beating" and a C4 fundamental
        sitting 16 dB below its own third partial.

        Measured per partial, not on the total envelope, and the difference is not a
        detail — the total is *blind* to this defect. At theta = 2·pi/3 every partial
        whose index is not a multiple of 3 nulls, but k = 3, 6, 9 sit at three times
        amplitude, so the sum holds its level and only changes timbre. Restoring the
        historical formula moves total min/median from 0.554 to 0.556.

        Two partials are probed because the depth taper means neither alone is enough:
        k=1 (least modulated, so a uniform null is unmissable there) and k=4, the knee
        index and therefore the loudest partial carrying full depth. Thresholds are
        halved from the measured pass values; the historical bug scores 0.005 at k=1,
        and a depth of 1.0 with the taper intact scores 0.005 at k=4.
        """
        y = render([note(60, 0, 8)])  # 4 s, long enough for several beat cycles
        f0 = 440.0 * 2.0 ** ((60 - 69) / 12.0)
        for k, floor in ((1, 0.40), (4, 0.08)):
            env = self._partial_envelope(y, f0 * k)
            # Against a decaying reference, so the string's own decay is not a null.
            ratio = env.min() / np.median(env)
            assert ratio > floor, f"partial {k} is nulling, not beating ({ratio:.4f})"

    @staticmethod
    def _partial_envelope(y: np.ndarray, f: float) -> np.ndarray:
        """Amplitude of the single partial at ``f`` over the note body, in 25 ms steps.

        Heterodyning to DC and taking the block mean is a ~40 Hz low-pass: narrow
        enough to reject neighbouring partials a semitone-series apart, wide enough to
        keep the f +/- k·d beat sidebands, which are the thing being measured.
        """
        sr, block = PREVIEW_SAMPLE_RATE, 551
        start = int(0.05 * sr)
        seg = y[start : int(3.0 * sr)]
        n = seg.size // block * block
        t = (np.arange(n) + start) / sr
        return np.abs((seg[:n] * np.exp(-2j * np.pi * f * t)).reshape(-1, block).mean(axis=1))

    def test_body_decays_instead_of_holding_a_level(self):
        """A piano decays from the strike; it has no sustain plateau.

        The previous voice held every note at 0.80 × peak for its whole body, which
        is an *organ*, and that plateau was the main reason the preview sounded
        wrong. Compare two windows inside the note body, both clear of the attack
        and of the release ramp, so only the exponential can account for the drop.
        """
        sr = PREVIEW_SAMPLE_RATE
        y = render([note(60, 0, 8)])  # 8 beats at 120 BPM = 4 s
        early = rms(y[int(0.15 * sr) : int(0.45 * sr)])
        late = rms(y[int(2.50 * sr) : int(2.80 * sr)])
        assert late < early * 0.75, "note body is holding a level rather than decaying"

    def test_bass_rings_longer_than_treble(self):
        """Register scaling — one global decay makes low notes sound cut off."""
        assert _string_decay_sec(36) > _string_decay_sec(60) > _string_decay_sec(84)

    def test_decay_stays_inside_its_clamps_across_the_whole_compass(self):
        taus = [_string_decay_sec(p) for p in range(0, 128)]
        assert min(taus) >= _STRING_DECAY_MIN_SEC
        assert max(taus) <= _STRING_DECAY_MAX_SEC

    def test_tempo_sets_the_timescale(self):
        """Beat positions are converted with 60/bpm, so doubling the tempo must halve
        the clip. This is the link between the notation's beats and what is heard."""
        notes = [note(60, 0, 1), note(64, 1, 1), note(67, 2, 2)]
        assert len(render(notes, 240)) < len(render(notes, 120)) * 0.6


# ── contract ──────────────────────────────────────────────────────────────────


class TestContract:
    def test_no_notes_gives_an_empty_string(self):
        assert _synthesize_audio_preview([], BPM) == ""

    def test_is_deterministic(self):
        notes = [note(60, 0, 1), note(64, 1, 1), note(67, 2, 2)]
        assert _synthesize_audio_preview(notes, BPM) == _synthesize_audio_preview(
            notes, BPM
        )

    def test_very_short_note_still_renders(self):
        """Durations are floored at 40 ms, so a zero-length note must not vanish or
        divide by zero in the envelope."""
        y = render([note(60, 0, 0.0)])
        assert rms(y) > 0.0
