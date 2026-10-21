"""A sung / hummed voice for the accuracy harness — labelled notes → voice-like WAV.

``synth.render`` models an instrument: every note starts exactly on pitch, holds it,
and stops.  A human voice does none of that, and the defects that make hummed phone
recordings hard are precisely the ones that voice does *not* share with an instrument:

  portamento   consecutive notes are joined by a continuous glide of 50-150 ms, so the
               f0 contour visits every pitch between them;
  scoops       a note sung after a breath starts flat and slides up onto pitch;
  vibrato      5-7 Hz, fading in after the note settles, up to ±0.5 semitone;
  tuning       the singer's reference is not A=440 — the whole clip sits some tens of
               cents sharp or flat of equal temperament, and may drift across it;
  jitter       micro-intonation wanders around the target by ~10 cents;
  pitching     an untrained singer lands each note off its target by its own amount:
               on the Vocadito corpus of real solo singing, 40% of annotated notes sit
               more than 25 cents from the nearest semitone even after the clip's own
               tuning offset is removed;
  timbre       a hum is almost a sine (closed mouth, nasal), a vowel has formants,
               a syllable has a consonant gap and an amplitude dip at each onset;
  breath       noise between phrases and a slow, soft attack rather than a strike.

Every one of those is a frame-level pitch excursion that a frame-wise decoder turns
into an extra (chromatic) note, which is the user-visible complaint this corpus exists
to measure.  Measurement only: nothing here imports ``app/``.

Reproducible by construction: all randomness is drawn from a ``default_rng`` seeded off
the render inputs, so the same case always produces the same samples.
"""

import zlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import numpy as np
from scipy import signal

from tests.accuracy.synth import SAMPLE_RATE, RefNote

_SEED_SALT = 0x564F4943  # "VOIC"


@dataclass(frozen=True)
class VocalOptions:
    """How the voice sings the line.  Defaults are a relaxed, fairly accurate hum."""

    style: str = "hum"  # "hum" (closed mouth), "ah" (open vowel), "da" (syllables)
    tuning_cents: float = 0.0  # whole-clip offset from A=440
    drift_cents: float = 0.0  # linear drift across the clip (negative = goes flat)
    jitter_cents: float = 8.0  # random-walk micro-intonation, RMS
    # Per-note pitching error, RMS: each note is sung off its target by its own fixed amount,
    # drawn once per note and clipped at +/-note_detune_clip_cents. 0 draws nothing, so every
    # case rendered before this field existed is sample-for-sample unchanged.
    note_detune_cents: float = 0.0
    vibrato_hz: float = 5.5
    vibrato_cents: float = 0.0  # peak deviation once fully developed
    vibrato_onset_sec: float = 0.3  # vibrato fades in over this after each onset
    glide_sec: float = 0.08  # portamento duration between legato notes
    scoop_cents: float = 0.0  # notes after a breath start this far BELOW pitch
    scoop_sec: float = 0.08
    attack_sec: float = 0.04
    release_sec: float = 0.06
    rearticulation_dip: float = 0.45  # amplitude at a re-articulated note boundary
    breath_noise_db: float = -42.0  # noise level in rests, relative to peak
    mic_noise_db: float = -50.0  # broadband floor everywhere
    lead_in_sec: float = 0.5
    tail_sec: float = 0.4
    peak: float = 0.85
    # The two below stay out of repr, which seeds the randomness: every case rendered before
    # they existed keeps its samples, and a case that differs from another only in them draws
    # the same noise, jitter and detune, so the pair isolates that one defect.
    #
    # How far one note may land off its target.  60 keeps the corpus's amateurs plausible;
    # a wider clip is the singer who misses by most of a semitone.
    note_detune_clip_cents: float = field(default=60.0, repr=False)
    # A note sung on from the one before (no breath) starts at full level instead of ramping
    # in from silence, so only the pitch glide marks the boundary, as in real legato.  Off,
    # every note gets the attack ramp, an amplitude valley at each note change that hands
    # the segmenter a boundary no legato line has.  A repeated pitch keeps its dip.
    legato: bool = field(default=False, repr=False)


# Formant resonances (Hz, bandwidth Hz) and source spectral slope per style.  The hum
# is a nasal murmur: a strong low resonance, very little above 1 kHz and a source that
# is close to a sine.  "ah" is a full open vowel.  "da" is "ah" with a consonant gap and
# an amplitude dip at every syllable.
_STYLES = {
    "hum": {"formants": ((250.0, 90.0),), "rolloff": 1.9, "lowpass_hz": 1400.0},
    "ah": {"formants": ((700.0, 110.0), (1150.0, 120.0), (2600.0, 160.0)), "rolloff": 1.0, "lowpass_hz": 6000.0},
    "da": {"formants": ((700.0, 110.0), (1150.0, 120.0), (2600.0, 160.0)), "rolloff": 1.0, "lowpass_hz": 6000.0},
}
_N_HARMONICS = 24
_CONSONANT_GAP_SEC = 0.035


def _seed(notes, tempo_bpm, options) -> int:
    return zlib.crc32(repr((tuple(notes), tempo_bpm, options)).encode()) ^ _SEED_SALT


def _midi_to_hz(m: np.ndarray | float) -> np.ndarray | float:
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=np.float64) - 69.0) / 12.0)


def _raised_cosine(n: int) -> np.ndarray:
    """0 → 1 over n samples, smooth at both ends."""
    if n <= 0:
        return np.empty(0)
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / max(n - 1, 1))


def _lowpass_walk(rng: np.random.Generator, n: int, sr: int, rms: float, cutoff_hz: float = 3.0) -> np.ndarray:
    """Slow random wander with the requested RMS: micro-intonation."""
    if rms <= 0.0 or n == 0:
        return np.zeros(n)
    white = rng.standard_normal(n)
    b, a = signal.butter(2, cutoff_hz / (0.5 * sr))
    walk = signal.lfilter(b, a, white)
    walk -= walk.mean()
    scale = float(np.sqrt(np.mean(walk**2)))
    return walk * (rms / scale) if scale > 0 else walk


def _formant_filter(x: np.ndarray, sr: int, style: dict) -> np.ndarray:
    y = np.zeros_like(x)
    for centre, bw in style["formants"]:
        r = np.exp(-np.pi * bw / sr)
        theta = 2.0 * np.pi * centre / sr
        a = [1.0, -2.0 * r * np.cos(theta), r * r]
        b = [1.0 - r]
        y += signal.lfilter(b, a, x)
    b, a = signal.butter(2, style["lowpass_hz"] / (0.5 * sr))
    return signal.lfilter(b, a, y)


def render(
    notes: Sequence[tuple[int | None, float]],
    tempo_bpm: int,
    options: VocalOptions = VocalOptions(),
    sr: int = SAMPLE_RATE,
    clock: Callable[[float], float] | None = None,
) -> tuple[np.ndarray, list[RefNote]]:
    """Render ``notes`` as a voice, returning float64 audio and the ground truth.

    ``notes`` is ``(pitch_midi | None, dur_beats)`` laid end to end; ``None`` is a rest
    (a breath).  Consecutive sounding notes are sung legato — joined by a glide — in
    "hum" and "ah"; in "da" each one is re-articulated with a consonant gap and an
    amplitude dip, which is how the repeated-note problem is posed.

    ``clock`` is where beat ``b`` of the line falls, in seconds from the start of the
    render: a band that speeds up or slows down (``tests.accuracy.song_clock``).  Without
    it every beat is ``60 / tempo_bpm`` long after ``options.lead_in_sec``, and the
    samples are what they always were.
    """
    style = _STYLES[options.style]
    rng = np.random.default_rng(_seed(notes, tempo_bpm, options))
    beat_sec = 60.0 / float(tempo_bpm)
    if clock is None:
        def clock(b: float) -> float:
            return options.lead_in_sec + b * beat_sec
    total_beats = sum(float(d) for _, d in notes)
    total_sec = clock(total_beats) + options.tail_sec
    n_total = int(round(total_sec * sr))

    # ── 1. Score → per-sample target pitch, voicing and ground truth ─────────
    target = np.full(n_total, np.nan)  # MIDI, NaN while unvoiced
    envelope = np.zeros(n_total)
    refs: list[RefNote] = []
    onsets: list[tuple[int, int, bool]] = []  # (start, end, after_breath)

    cursor = 0.0
    previous_voiced = False
    for pitch, dur_beats in notes:
        dur_beats = float(dur_beats)
        start = int(round(clock(cursor) * sr))
        end = min(int(round(clock(cursor + dur_beats) * sr)), n_total)
        cursor += dur_beats
        if pitch is None or end <= start:
            previous_voiced = False
            continue
        detune = 0.0
        if options.note_detune_cents > 0.0:
            clip = options.note_detune_clip_cents
            detune = float(np.clip(rng.normal(0.0, options.note_detune_cents), -clip, clip))
        target[start:end] = float(pitch) + detune / 100.0
        onsets.append((start, end, not previous_voiced))
        refs.append(
            RefNote(
                pitch_midi=int(pitch),
                onset_sec=start / sr,
                dur_sec=(end - start) / sr,
                onset_beat=cursor - dur_beats,
                dur_beats=dur_beats,
            )
        )
        previous_voiced = True

    # ── 2. Shape the pitch contour the way a voice does ───────────────────────
    contour = target.copy()
    glide = int(options.glide_sec * sr)
    for i in range(1, len(onsets)):
        start, _end, after_breath = onsets[i]
        if after_breath or glide <= 1:
            continue
        prev_pitch = target[start - 1]
        this_pitch = target[start]
        half = glide // 2
        lo, hi = max(onsets[i - 1][0], start - half), min(onsets[i][1], start + half)
        ramp = _raised_cosine(hi - lo)
        contour[lo:hi] = prev_pitch + (this_pitch - prev_pitch) * ramp

    articulate = options.style == "da"
    for i, (start, end, after_breath) in enumerate(onsets):
        n = end - start
        t = np.arange(n) / sr
        seg = contour[start:end]
        if (after_breath or articulate) and options.scoop_cents > 0.0:
            seg = seg - (options.scoop_cents / 100.0) * np.exp(-t / max(options.scoop_sec / 3.0, 1e-3))
        if options.vibrato_cents > 0.0:
            depth = np.minimum(t / max(options.vibrato_onset_sec, 1e-3), 1.0)
            phase0 = rng.uniform(0.0, 2.0 * np.pi)
            seg = seg + (options.vibrato_cents / 100.0) * depth * np.sin(2.0 * np.pi * options.vibrato_hz * t + phase0)
        contour[start:end] = seg

        # Amplitude: a breathy attack, a slight tremolo, a release.  Syllables get a
        # dip (and a consonant gap) at each onset even inside a phrase.
        env = np.ones(n)
        atk = min(int(options.attack_sec * sr), n // 3)
        rel = min(int(options.release_sec * sr), n // 3)
        joined = options.legato and not after_breath
        if atk > 0 and not joined:
            env[:atk] = _raised_cosine(atk)
        if rel > 0 and (articulate or _is_last(onsets, start)):
            env[-rel:] *= _raised_cosine(rel)[::-1]
        # A syllable re-articulates every note with a consonant gap and a dip.  A hum or
        # a vowel sung legato re-articulates only a REPEATED pitch — the singer has to,
        # or the two notes would be one — and does it with a softer dip and no gap.
        repeated = not after_breath and target[start - 1] == target[start]
        if joined:
            # The targets carry each note's own detune, so with detune on a repeat never
            # matches above and the attack ramp is what re-articulates it.  Legato has no
            # ramp, so it compares the notes meant.
            repeated = refs[i].pitch_midi == refs[i - 1].pitch_midi
        if articulate and not after_breath:
            gap = min(int(_CONSONANT_GAP_SEC * sr), n // 4)
            env[:gap] = 0.0
            dip = min(int(0.05 * sr), n // 3)
            env[gap : gap + dip] *= options.rearticulation_dip + (1.0 - options.rearticulation_dip) * _raised_cosine(dip)
            contour[start : start + gap] = np.nan
        elif repeated:
            dip = min(int(0.06 * sr), n // 3)
            env[:dip] *= options.rearticulation_dip + (1.0 - options.rearticulation_dip) * _raised_cosine(dip)
        env *= 1.0 + 0.03 * np.sin(2.0 * np.pi * 3.1 * t + rng.uniform(0, 6.28))
        envelope[start:end] = env

    voiced = ~np.isnan(contour)
    offset = np.full(n_total, options.tuning_cents / 100.0)
    offset += np.linspace(0.0, options.drift_cents / 100.0, n_total)
    offset += _lowpass_walk(rng, n_total, sr, options.jitter_cents / 100.0)
    midi = np.where(voiced, contour + offset, np.nan)

    # ── 3. Source-filter synthesis ────────────────────────────────────────────
    f0 = np.where(voiced, _midi_to_hz(np.nan_to_num(midi, nan=60.0)), 0.0)
    phase = 2.0 * np.pi * np.cumsum(f0) / sr
    source = np.zeros(n_total)
    nyquist = 0.5 * sr
    f0_max = float(np.nanmax(f0)) if voiced.any() else 1.0
    for k in range(1, _N_HARMONICS + 1):
        if k * f0_max >= nyquist:
            break
        source += np.sin(k * phase) / k ** style["rolloff"]
    source *= envelope
    audio = _formant_filter(source, sr, style)

    peak = float(np.max(np.abs(audio))) if n_total else 0.0
    if peak > 1e-9:
        audio *= options.peak / peak

    # ── 4. Breath and room ────────────────────────────────────────────────────
    breath = rng.standard_normal(n_total)
    b, a = signal.butter(2, [300.0 / nyquist, 3000.0 / nyquist], btype="band")
    breath = signal.lfilter(b, a, breath)
    breath *= (1.0 - envelope) * options.peak * 10.0 ** (options.breath_noise_db / 20.0)
    audio += breath
    audio += rng.standard_normal(n_total) * options.peak * 10.0 ** (options.mic_noise_db / 20.0)

    peak = float(np.max(np.abs(audio))) if n_total else 0.0
    if peak > 1.0:
        audio /= peak
    return audio, refs


def _is_last(onsets: list[tuple[int, int, bool]], start: int) -> bool:
    """True when the note starting at ``start`` ends a phrase (next note follows a breath)."""
    for i, (s, _e, _b) in enumerate(onsets):
        if s == start:
            return i + 1 >= len(onsets) or onsets[i + 1][2]
    return True
