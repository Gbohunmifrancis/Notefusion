"""Reference audio synthesis for the accuracy harness — labelled notes → WAV.

``render()`` returns the audio buffer *and* the exact ground truth that produced
it, so every metric in ``tests.accuracy.metrics`` is scored against numbers we
know rather than numbers we guessed.  Measurement only: nothing here imports or
mutates ``app/``.

Why this voice and not any other
────────────────────────────────
The timbre was cloned from ``_synthesize_audio_preview``
(``app/pipeline/transcriber.py``) as it stood when the corpus was built: four
additive harmonics weighted (0.50, 0.20, 0.12, 0.08) plus that ADSR shape.
Basic Pitch's frame activations are timbre-sensitive, so a corpus rendered with
an unrelated voice would end up measuring the synth instead of the pipeline.
The constants are *copied* rather than imported precisely so the two can drift:
the preview voice has since been retuned (wider partial set, per-partial decay,
raised-cosine ramps) and the numbers here deliberately did not follow it.
**Do not re-sync them.** The corpus models the *input* — a person humming into a
phone — while the preview models the *output*; and if this audio moves at all,
every stored baseline silently stops meaning anything.

Physical failure modes
──────────────────────
``RenderOptions`` carries the defects the accuracy plan targets — vibrato,
slow pitch drift, additive noise, leading silence, plucked vs sustained
envelope — because those are the properties of a real hummed phone recording
that a clean synthetic scale never exercises.

Reproducibility
───────────────
Noise comes from a ``default_rng`` seeded off the render inputs, never from an
unseeded default, so ``render()`` is a pure function of its arguments: the same
case always produces bit-identical samples.  That is the only thing that makes
a stored baseline comparable between runs.
"""

import zlib
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

# Matches PREVIEW_SAMPLE_RATE in the pipeline; Basic Pitch resamples to 22 050 Hz
# internally anyway, so rendering higher would only add a resample step.
SAMPLE_RATE = 22_050

# ── Voice model (cloned from the preview voice, now diverged) ─────────────────

# Copied from the pipeline's preview voice on purpose — see module docstring.
# Keep the values, not a live import, and do not update them to match the
# preview's current constants: corpus audio must not move when that voice is
# retuned, or every stored baseline stops meaning anything.
_ATTACK_SEC = 0.015
_DECAY_SEC = 0.040
_RELEASE_FRAC = 0.25  # release is 25 % of the note …
_RELEASE_CAP_SEC = 0.18  # … capped so long notes still end cleanly
_SUSTAIN_LEVEL = 0.80

# Plucked alternative, as used by spike/make_test_clip.py: 10 ms ramp then a
# fast exponential decay.  Worth measuring separately because a decaying tone
# crosses Basic Pitch's frame threshold on the way down, which is a different
# note-off behaviour from a sustained tone that is cut by its release.
_PLUCK_RAMP_SEC = 0.01
_PLUCK_DECAY_RATE = 2.5

# Fixed salt for the per-case noise seed.  zlib.crc32 rather than hash(),
# because PYTHONHASHSEED randomises str hashing per process and the corpus has
# to be reproducible across runs and machines.
_SEED_SALT = 0x4E4F5445  # "NOTE"


# ── Options and ground truth ──────────────────────────────────────────────────


@dataclass(frozen=True)
class RenderOptions:
    """Per-case rendering knobs; the defaults render a clean sustained tone.

    ``vibrato_semitones`` and ``drift_semitones`` are **peak** deviations, so
    vibrato spans ``2 * vibrato_semitones`` peak-to-peak.  Metrics compare
    against a measured extent, so the factor of two matters.
    """

    vibrato_hz: float = 0.0  # vibrato rate; 0 disables
    vibrato_semitones: float = 0.0  # PEAK deviation, semitones
    drift_semitones: float = 0.0  # linear drift applied across each note
    noise_rms: float = 0.0  # additive white noise RMS, absolute (post-normalisation)
    lead_in_sec: float = 0.0  # silence before the first note (defect 1 trigger)
    tail_sec: float = 0.30
    peak: float = 0.90  # normalise the tone bed to this peak before noise
    harmonic_weights: tuple[float, ...] = (0.50, 0.20, 0.12, 0.08)
    sustained: bool = True  # True: ADSR with sustain. False: plucked exp decay.


@dataclass(frozen=True)
class RefNote:
    """One sounding reference note, in both clocks the metrics need.

    ``onset_sec`` includes ``RenderOptions.lead_in_sec`` (it is a real position
    in the rendered file) while ``onset_beat`` starts at 0.0 for the first
    sounding note.  Anchoring the first note to beat 0 is the *correct* pipeline
    behaviour, so ``onset_beat`` is the ground truth the metrics score against —
    in both domains, ``metrics.py`` derives its reference times from it and not
    from ``onset_sec``.  Scoring against ``onset_sec`` would make preserving the
    lead-in the ground truth and turn fixing defect 1 into a regression.

    ``onset_sec`` is therefore descriptive rather than scored: it is what the
    rendered file actually contains, which is what a real-recording sidecar can
    label (see ``real/README.md``) and what ``onset_beat`` is derived from.
    """

    pitch_midi: int
    onset_sec: float  # INCLUDES lead_in_sec
    dur_sec: float
    onset_beat: float  # 0.0 for the first sounding note — lead-in excluded
    dur_beats: float


# ── Rendering ─────────────────────────────────────────────────────────────────


def _midi_to_hz(pitch_midi: int) -> float:
    return 440.0 * 2.0 ** ((pitch_midi - 69) / 12.0)


def _noise_seed(
    notes: Sequence[tuple[int | None, float]],
    tempo_bpm: int,
    options: RenderOptions,
) -> int:
    """Deterministic seed derived from the render inputs.

    Different cases get different noise (so a defect cannot be masked by one
    lucky noise instance) while any single case is reproducible forever.
    """
    payload = repr((tuple(notes), tempo_bpm, options)).encode()
    return zlib.crc32(payload) ^ _SEED_SALT


def _envelope(n_samples: int, sr: int, sustained: bool) -> np.ndarray:
    """Amplitude envelope for one note, length ``n_samples``."""
    t = np.arange(n_samples, dtype=np.float64) / sr

    if not sustained:
        return np.minimum(t / _PLUCK_RAMP_SEC, 1.0) * np.exp(-_PLUCK_DECAY_RATE * t)

    # Same construction order the preview voice uses: attack and decay are
    # each clamped to a quarter of the note so short notes degrade to a ramp
    # instead of overrunning the buffer. The ramps here stay linear — the preview's
    # are raised-cosine now, but changing these would move the corpus audio.
    env = np.ones(n_samples, dtype=np.float64)
    atk = min(int(_ATTACK_SEC * sr), n_samples // 4)
    dec = min(int(_DECAY_SEC * sr), n_samples // 4)
    rel = min(int(_RELEASE_FRAC * n_samples), int(_RELEASE_CAP_SEC * sr))

    if atk > 0:
        env[:atk] = np.linspace(0.0, 1.0, atk)
    if dec > 0 and atk + dec <= n_samples:
        env[atk : atk + dec] = np.linspace(1.0, _SUSTAIN_LEVEL, dec)
        if atk + dec < n_samples:
            env[atk + dec :] = _SUSTAIN_LEVEL
    if rel > 0:
        env[-rel:] *= np.linspace(1.0, 0.0, rel)
    return env


def _tone(freq_hz: float, n_samples: int, sr: int, options: RenderOptions) -> np.ndarray:
    """Harmonic stack for one note, with vibrato and drift applied.

    Vibrato is ``vibrato_semitones * sin(2*pi*vibrato_hz*t)`` (peak deviation)
    and drift ramps linearly from 0 to ``drift_semitones`` across the note.
    """
    t = np.arange(n_samples, dtype=np.float64) / sr

    semitone_offset = np.zeros(n_samples, dtype=np.float64)
    if options.vibrato_hz > 0.0 and options.vibrato_semitones != 0.0:
        semitone_offset += options.vibrato_semitones * np.sin(
            2.0 * np.pi * options.vibrato_hz * t
        )
    if options.drift_semitones != 0.0:
        semitone_offset += np.linspace(0.0, options.drift_semitones, n_samples)

    f_inst = freq_hz * 2.0 ** (semitone_offset / 12.0)

    # PHASE INTEGRATION — do NOT "simplify" this to sin(2*pi*f_inst*t).
    # When frequency varies with time, the argument of sin must be the integral
    # of the instantaneous frequency, not f(t)*t.  Writing f(t)*t differentiates
    # to f(t) + t*f'(t), i.e. a chirp whose actual pitch deviation grows with t
    # and comes out at roughly double the intended vibrato depth — the corpus
    # would then be measuring a defect this module invented.  Every harmonic is
    # generated as sin(k*phase) from the same integrated phase so the partials
    # stay phase-locked to the modulated fundamental instead of beating
    # against it.
    phase = 2.0 * np.pi * np.cumsum(f_inst) / sr

    tone = np.zeros(n_samples, dtype=np.float64)
    for harmonic_idx, weight in enumerate(options.harmonic_weights, start=1):
        tone += weight * np.sin(harmonic_idx * phase)
    return tone


def render(
    notes: Sequence[tuple[int | None, float]],
    tempo_bpm: int,
    options: RenderOptions = RenderOptions(),
    sr: int = SAMPLE_RATE,
) -> tuple[np.ndarray, list[RefNote]]:
    """Render ``notes`` to float64 audio plus its ground truth.

    ``notes`` is a sequence of ``(pitch_midi | None, dur_beats)`` laid out
    sequentially with no gap beyond explicit rests; ``None`` is a rest, which
    advances both clocks but yields no ``RefNote``.  (Leading silence belongs in
    ``options.lead_in_sec``, not in a leading rest — a leading rest would push
    the first sounding note off beat 0 and confuse the shift diagnostic.)
    """
    beat_sec = 60.0 / float(tempo_bpm)
    total_beats = sum(float(dur_beats) for _, dur_beats in notes)
    total_sec = options.lead_in_sec + total_beats * beat_sec + options.tail_sec
    total_samples = int(round(total_sec * sr))
    audio = np.zeros(total_samples, dtype=np.float64)

    refs: list[RefNote] = []
    cursor_beat = 0.0
    for pitch_midi, dur_beats in notes:
        dur_beats = float(dur_beats)
        onset_sec = options.lead_in_sec + cursor_beat * beat_sec
        dur_sec = dur_beats * beat_sec

        if pitch_midi is not None:
            # Sample bounds come from the two cursor positions rather than from
            # a rounded duration, so consecutive notes butt up against each
            # other with no one-sample gap or overlap.
            start_samp = int(round(onset_sec * sr))
            end_samp = min(int(round((onset_sec + dur_sec) * sr)), total_samples)
            n_samples = end_samp - start_samp
            if n_samples > 0:
                audio[start_samp:end_samp] += _tone(
                    _midi_to_hz(int(pitch_midi)), n_samples, sr, options
                ) * _envelope(n_samples, sr, options.sustained)
                # Only notes that actually produced samples become ground
                # truth; scoring against an inaudible note would charge the
                # pipeline for a miss it could not avoid.
                refs.append(
                    RefNote(
                        pitch_midi=int(pitch_midi),
                        onset_sec=onset_sec,
                        dur_sec=dur_sec,
                        onset_beat=cursor_beat,
                        dur_beats=dur_beats,
                    )
                )

        cursor_beat += dur_beats

    # Normalise the tone bed *before* noise so noise_rms is an absolute level
    # and the SNR of a case is a property of the case, not of how many
    # harmonics happened to line up.
    peak = float(np.max(np.abs(audio))) if total_samples else 0.0
    if peak > 1e-6:
        audio *= options.peak / peak

    if options.noise_rms > 0.0 and total_samples:
        rng = np.random.default_rng(_noise_seed(notes, tempo_bpm, options))
        # Noise covers the lead-in and tail too: a real room has a floor
        # everywhere, and silent silence would make the lead-in case easier
        # than the recordings it stands in for.
        audio += rng.standard_normal(total_samples) * options.noise_rms

    # 16-bit PCM wraps rather than saturates, so a peak above 1.0 would fold
    # over into broadband junk that no metric could attribute to its real
    # cause.  Scaling the whole buffer keeps the bed-to-noise ratio — the thing
    # the case is actually about — unchanged, so doing it silently is safe.
    peak = float(np.max(np.abs(audio))) if total_samples else 0.0
    if peak > 1.0:
        audio /= peak

    return audio, refs


# ── WAV output ────────────────────────────────────────────────────────────────


def write_wav(path: Path, audio: np.ndarray, sr: int = SAMPLE_RATE) -> None:
    """Write ``audio`` as signed 16-bit PCM WAV, as the pipeline preview does.

    A ``.wav`` input also keeps ``transcribe()`` off its ffmpeg conversion path,
    so the harness measures inference rather than a decoder.
    """
    sf.write(str(path), audio.astype(np.float32), sr, format="WAV", subtype="PCM_16")
