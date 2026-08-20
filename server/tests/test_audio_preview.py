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
  determinism                     identical notes render to identical bytes
  Nyquist headroom                 no partial can alias at the pipeline's pitch cap

No ML models and no audio files: the preview synthesiser only needs numpy and
soundfile, both already required in production.
"""

import base64
import io

import numpy as np
import soundfile as sf
from app.pipeline.transcriber import (
    _HARMONIC_WEIGHTS,
    _INHARMONICITY,
    _SUSTAIN_LEVEL,
    PREVIEW_SAMPLE_RATE,
    TranscribedNote,
    _smooth_ramp,
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
        assert np.all(np.diff(_smooth_ramp(64, 1.0, _SUSTAIN_LEVEL)) <= 0)

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

    def test_partials_fit_under_nyquist_at_the_pipeline_pitch_ceiling(self):
        """Basic Pitch is capped at 1050 Hz (``max_freq_hz``), so the highest note
        the preview ever has to render is about C6. Every partial of that note must
        stay below Nyquist or the preview aliases — which would put spurious low
        tones under the melody."""
        top = 1050.0 * len(_HARMONIC_WEIGHTS)
        top *= 1.0 + _INHARMONICITY * len(_HARMONIC_WEIGHTS) ** 2
        assert top < 0.5 * PREVIEW_SAMPLE_RATE

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
