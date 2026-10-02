"""Monophonic voice → notes: the melody engine for hummed and sung recordings.

Basic Pitch is a polyphonic *instrument* model.  Its decoder thresholds an onset and a
frame posterior per semitone bin, so every scoop, portamento and vibrato swing that
crosses a bin boundary becomes a new note — and a note between two scale degrees is a
chromatic note, which is where the spurious accidentals come from.  Every system built
for the voice (Tony / pYIN-Notes, SiPTH, CANTE, CREPE-Notes, Dubler) does the same thing
instead, and so does this module:

  1. **f0 contour**, not note posteriors — pyin, with a loudness gate for voicing.
  2. **Tuning-offset estimation** before any rounding.  A singer's reference is not
     A=440; a line sung 40 cents sharp rounds to either neighbour at random, frame
     by frame, and that alone manufactures accidentals.  The offset is the circular
     mean of each frame's deviation from the equal-tempered grid (Dressler & Streich
     2007; Lerch 2006).
  3. **Hysteresis segmentation** on the pitch-time curve (Molina et al. 2015, SiPTH):
     a note is a run of frames within ±DELTA of its own running pitch, and it ends
     only when the contour has sat *outside* that band for long enough — area under
     the excess, not a single frame.  Vibrato comes back inside the band before the
     area accumulates; a note change does not.  Frames where the pitch is still moving
     (a glide) are transitional and start no note of their own.
  4. **Per-note pitch = median of the note's stable frames**, never the frame-wise
     rounding of anything.
  5. **Clean-up**: transition slivers between two notes are split between them, short
     fragments are absorbed by the note they belong to, repeated pitches are split only
     on a re-articulation cue (an amplitude dip or a consonant gap), notes under the
     floor are dropped.
  6. **Key-aware rounding** of the genuinely ambiguous notes only: a note whose tuned
     pitch sits within SNAP_AMBIGUOUS of the half-way point between two semitones is
     given to the diatonic neighbour of the clip's own key.  A note clearly on a
     chromatic pitch stays chromatic — a sung ``se`` or ``fe`` is real music.

Pure numpy/scipy/librosa; no model download, nothing new in the image.  Stateless.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

# ── Tracking ──────────────────────────────────────────────────────────────────

SAMPLE_RATE = 22_050
HOP = 512  # 23.2 ms at 22 050 Hz; every duration constant below is in seconds
FRAME = 2048
FMIN_HZ = 60.0  # just under B1 — below any sung fundamental
FMAX_HZ = 1100.0  # just over C6
# Frames quieter than this, relative to the clip's loud frames, are unvoiced whatever
# pyin says: breath and room noise between phrases should not carry pitch.
VOICING_FLOOR_DB = -38.0
# pyin's dropouts inside one note are bridged if no longer than this.
BRIDGE_GAP_SEC = 0.05
MEDIAN_FRAMES = 5

# ── Tuning ────────────────────────────────────────────────────────────────────

# Concentration of the deviation histogram below which there is no consistent
# offset to subtract (the singer wandered rather than sat sharp or flat).
TUNING_MIN_CONCENTRATION = 0.35
TUNING_MIN_NOTES = 4

# ── Segmentation ──────────────────────────────────────────────────────────────

DELTA_SEMITONES = 0.5  # half-width of a note's band around its own pitch
# Area (semitone-seconds) the contour must spend outside the band before a note ends.
# Measured on the averaged contour (see DRIVE_FRAMES), where a semitone step is a ramp:
# it clears this about three frames after leaving the band, a whole tone in two, and a
# vibrato never reaches it before swinging back inside.
AREA_THRESHOLD = 0.02
# Pitch moving faster than this (semitones per second) is a glide, not a note.  A
# semitone over 80 ms is 12.5 st/s; vibrato peaks are slower at the turn and faster at
# the zero crossing, which is why slope is only ever read together with the band.
SLOPE_MAX_ST_PER_SEC = 14.0
MIN_STABLE_FRAMES = 2  # out-of-band stable frames needed before a cut is believed
# The segmentation decision is driven by the contour averaged over about one vibrato
# period (5-7 Hz is 140-200 ms), which takes even a ±2 semitone vibrato back inside the
# band.  Pitch is still read off the median contour; this only decides where notes end.
DRIVE_FRAMES = 7
LOOKAHEAD_FRAMES = DRIVE_FRAMES // 2 + 1
# A note has to be heard: pyin's voiced probability on breath and room noise is near
# zero, and a pitched note that quiet and that unvoiced is noise that happened to be
# periodic for a moment.
NOISE_MAX_VOICED_PROB = 0.12
NOISE_MAX_AMP = 0.25
MIN_NOTE_SEC = 0.10  # Tony and SiPTH both prune at 100 ms
# The running centre of a note is the median of its most recent accepted frames.  The
# window is long — well over a second — so that a semitone step, which arrives as a
# slow ramp on the averaged contour, cannot drag the centre along with it and go
# unnoticed; it is finite so that a long note that drifts is still followed.
CENTRE_FRAMES = 60
FRAGMENT_SEMITONES = 1.5  # a short segment this close to a neighbour is a piece of it
FRAGMENT_EDGE_SEMITONES = 2.5  # ...and at the edge of a phrase (an attack or a release), this close
# pyin is a harmonic-pattern matcher and, on a tone whose fundamental is weak, locks an
# octave low with full confidence.  A note whose odd harmonics carry less than this
# fraction of its even harmonics' energy has no fundamental at the pitch claimed: the
# even harmonics ARE the harmonic series of the octave above.
OCTAVE_ODD_EVEN_MAX = 0.12
JOIN_GAP_SEC = 0.06  # same-pitch segments closer than this are one note unless re-struck
REARTICULATION_FRAC = 0.62  # an RMS valley below this fraction of its flanks is a re-strike
# ...and clearly deeper than the span's ordinary wobble: a vowel sung with vibrato
# through a formant has an amplitude ripple at the vibrato rate, and that is not a
# re-strike however deep it goes.  A cut must be this fraction of the typical valley.
TREMOLO_REL = 0.85
VALLEY_WIDTH_FRAMES = 3

# ── Key-aware rounding ────────────────────────────────────────────────────────

SNAP_AMBIGUOUS = 0.32  # |residual| above this (i.e. within 18 cents of the midpoint) is ambiguous
SNAP_MIN_NOTES = 5
SNAP_MIN_KEY_MARGIN = 0.05  # correlation lead the key needs before it is allowed to vote

# Krumhansl-Kessler key profiles.
_KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_MAJOR_SET = frozenset({0, 2, 4, 5, 7, 9, 11})


@dataclass(frozen=True)
class Contour:
    times: np.ndarray  # seconds, one per frame
    midi: np.ndarray  # fractional MIDI, NaN where unvoiced
    voiced_prob: np.ndarray
    rms: np.ndarray  # same frames, linear, over the analysis window
    rms_fast: np.ndarray  # same frames, over one hop only — resolves a re-articulation dip
    stable: np.ndarray | None = None  # per frame: pitch not gliding (set by ``smooth``)


@dataclass(frozen=True)
class VocalNote:
    start: float
    end: float
    midi: float  # tuned, fractional
    pitch: int  # notated
    amp: float  # mean RMS, relative to the loudest note
    voiced_prob: float


@dataclass(frozen=True)
class Analysis:
    notes: list[VocalNote]
    tuning_cents: float
    contour: Contour  # tuned contour, for diagnostics


# ── 1. Contour ────────────────────────────────────────────────────────────────


def condition(y: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """DC removal, a high-pass under the lowest voice, peak normalisation."""
    from scipy import signal

    y = np.asarray(y, dtype=np.float64)
    if y.size == 0:
        return y.astype(np.float32)
    y = y - float(np.mean(y))
    sos = signal.butter(4, 50.0 / (0.5 * sr), btype="high", output="sos")
    y = signal.sosfilt(sos, y)
    peak = float(np.max(np.abs(y)))
    if peak > 1e-6:
        y = y * (0.9 / peak)
    return y.astype(np.float32)


def track(y: np.ndarray, sr: int = SAMPLE_RATE) -> Contour:
    """pyin f0 contour with a loudness-gated voicing decision and frame RMS."""
    import librosa

    y = np.asarray(y, dtype=np.float32)
    f0, _flag, vprob = librosa.pyin(
        y, fmin=FMIN_HZ, fmax=FMAX_HZ, sr=sr, frame_length=FRAME, hop_length=HOP, resolution=0.1
    )
    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]
    rms_fast = librosa.feature.rms(y=y, frame_length=HOP, hop_length=HOP)[0]
    n = min(f0.size, rms.size, rms_fast.size)
    f0, vprob, rms, rms_fast = f0[:n], vprob[:n], rms[:n], rms_fast[:n]
    times = librosa.frames_to_time(np.arange(n), sr=sr, hop_length=HOP)

    midi = np.full(n, np.nan)
    voiced = ~np.isnan(f0)
    midi[voiced] = librosa.hz_to_midi(f0[voiced])

    loud = float(np.percentile(rms[voiced], 95)) if voiced.any() else 0.0
    if loud > 0.0:
        quiet = rms < loud * 10.0 ** (VOICING_FLOOR_DB / 20.0)
        midi[quiet] = np.nan
    return Contour(times=times, midi=midi, voiced_prob=np.nan_to_num(vprob), rms=rms, rms_fast=rms_fast)


def _hop_sec(c: Contour) -> float:
    return float(c.times[1] - c.times[0]) if c.times.size > 1 else HOP / SAMPLE_RATE


def _voiced_runs(midi: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) index pairs of voiced runs, end exclusive."""
    runs: list[tuple[int, int]] = []
    voiced = ~np.isnan(midi)
    i = 0
    while i < midi.size:
        if not voiced[i]:
            i += 1
            continue
        j = i
        while j < midi.size and voiced[j]:
            j += 1
        runs.append((i, j))
        i = j
    return runs


def smooth(c: Contour) -> Contour:
    """Bridge short dropouts, then median-filter each voiced run."""
    midi = c.midi.copy()
    hop = _hop_sec(c)
    runs = _voiced_runs(midi)
    for (_, a_end), (b_start, _) in zip(runs, runs[1:]):
        if (b_start - a_end) * hop <= BRIDGE_GAP_SEC:
            lo, hi = midi[a_end - 1], midi[b_start]
            # A dropout inside a note, not a leap: bridge only when the two sides agree.
            if abs(hi - lo) <= 2.0 * DELTA_SEMITONES:
                midi[a_end:b_start] = np.linspace(lo, hi, b_start - a_end + 2)[1:-1]
    stable = np.zeros(midi.size, dtype=bool)
    for start, end in _voiced_runs(midi):
        if end - start >= MEDIAN_FRAMES:
            midi[start:end] = _running_median(midi[start:end], MEDIAN_FRAMES)
        # Gliding or not is judged on the contour averaged twice over a vibrato period:
        # that leaves ~2% of a vibrato and all of a glide, so the two cannot be confused.
        drive = _moving_average(_moving_average(midi[start:end], DRIVE_FRAMES), DRIVE_FRAMES)
        stable[start:end] = np.abs(_slope(drive, hop)) <= SLOPE_MAX_ST_PER_SEC
    return Contour(
        times=c.times, midi=midi, voiced_prob=c.voiced_prob, rms=c.rms, rms_fast=c.rms_fast, stable=stable
    )


def _running_median(x: np.ndarray, width: int) -> np.ndarray:
    half = width // 2
    padded = np.pad(x, (half, half), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, width)
    return np.median(windows, axis=1)


# ── 2. Tuning ─────────────────────────────────────────────────────────────────


def tuning_offset_cents(midis: Sequence[float], weights: Sequence[float]) -> float:
    """The clip's offset from equal temperament, in cents, in (-50, 50].

    Circular mean of each note's deviation from the nearest semitone, weighted by the
    note's duration, so a long note counts for more than a scooped grace.  Notes rather
    than frames on purpose: a vibrato wider than about ±0.6 semitone wraps around the
    semitone circle and its frames average to the *opposite* offset (Bessel's J0 goes
    negative), while the note's median is vibrato-free.  Returns 0 when the deviations
    are spread around the circle — no single offset describes the clip, and subtracting
    a meaningless one would move every note by a random amount.
    """
    if len(midis) < TUNING_MIN_NOTES:
        return 0.0
    midis = np.asarray(midis, dtype=float)
    deviation = midis - np.round(midis)  # [-0.5, 0.5] semitones
    weight = np.asarray(weights, dtype=float)
    if float(weight.sum()) <= 0.0:
        weight = np.ones_like(deviation)
    angle = 2.0 * np.pi * deviation
    vector = complex(float(np.sum(weight * np.cos(angle))), float(np.sum(weight * np.sin(angle))))
    total = float(weight.sum())
    concentration = abs(vector) / total
    if concentration < TUNING_MIN_CONCENTRATION:
        return 0.0
    return float(np.degrees(np.angle(vector)) / 360.0 * 100.0)


def retune(c: Contour, cents: float) -> Contour:
    return Contour(
        times=c.times,
        midi=c.midi - cents / 100.0,
        voiced_prob=c.voiced_prob,
        rms=c.rms,
        rms_fast=c.rms_fast,
        stable=c.stable,
    )


# ── 3. Hysteresis segmentation ────────────────────────────────────────────────


def _slope(midi: np.ndarray, hop: float) -> np.ndarray:
    """Central-difference pitch slope in semitones per second, NaN at run edges."""
    out = np.full(midi.size, np.nan)
    if midi.size >= 3:
        out[1:-1] = (midi[2:] - midi[:-2]) / (2.0 * hop)
    if midi.size >= 2:
        out[0] = (midi[1] - midi[0]) / hop
        out[-1] = (midi[-1] - midi[-2]) / hop
    return out


def segment_run(midi: np.ndarray, hop: float, stable: np.ndarray | None = None) -> list[tuple[int, int]]:
    """Cut one voiced run (no NaN) into note spans ``(start, end)``, end exclusive.

    Hysteresis on the pitch-time curve.  The running pitch ``centre`` is the median of
    the frames accepted into the current note.  A frame inside the band joins the note.
    A frame outside it is held: if the curve comes back inside, the held frames were a
    wobble and join too; if instead the held *stable* frames accumulate enough excess
    area, the note ends where the holding began and the held frames start the next one.
    A frame whose pitch is still moving is a glide — it is held but never counted, so a
    portamento cannot end a note by itself; the arrival does.
    """
    n = midi.size
    if n == 0:
        return []
    drive = _moving_average(midi, DRIVE_FRAMES)
    if stable is None:
        twice = _moving_average(drive, DRIVE_FRAMES)
        stable = np.abs(_slope(twice, hop)) <= SLOPE_MAX_ST_PER_SEC

    spans: list[tuple[int, int]] = []
    start = 0
    accepted: list[float] = []
    held_from: int | None = None
    held_stable = 0
    area = 0.0
    centre = float(drive[0])

    for k in range(n):
        value = float(drive[k])
        if not accepted:
            # A note has no centre until it has a stable frame; glide frames at the
            # start of a run are the attack of whatever note follows them.
            if stable[k] or k == n - 1:
                accepted.append(value)
                centre = value
            continue
        if abs(value - centre) <= DELTA_SEMITONES:
            if held_from is not None:
                accepted.extend(float(v) for v, s in zip(drive[held_from:k], stable[held_from:k]) if s)
                held_from = None
                held_stable = 0
                area = 0.0
            accepted.append(value)
            centre = float(np.median(accepted[-CENTRE_FRAMES:]))
            continue

        # Outside the band.
        if held_from is None:
            held_from = k
        if stable[k]:
            held_stable += 1
            area += (abs(value - centre) - DELTA_SEMITONES) * hop
        if held_stable >= MIN_STABLE_FRAMES and area >= AREA_THRESHOLD:
            # The new note's centre is seeded from just AHEAD of the decision, not from
            # the held frames: the averaged contour is still ramping when the area test
            # fires, and a centre read mid-ramp is out of band of the frames that follow,
            # which cut again and leave a sliver at every step.  The contour is offline,
            # so half a window ahead is simply available — and there the average has
            # settled on the new note, vibrato and all.
            ahead = drive[k + 1 : k + 1 + LOOKAHEAD_FRAMES]
            pool = [float(v) for v in ahead if abs(float(v) - value) <= 2.0 * DELTA_SEMITONES]
            accepted = pool or [value]
            new_centre = float(np.median(accepted))
            # The boundary is where the pitch crossed halfway between the two notes:
            # the glide belongs half to the note it leaves and half to the one it reaches.
            cut = _crossing(drive, held_from, k, (centre + new_centre) / 2.0, new_centre > centre)
            spans.append((start, cut))
            start = cut
            centre = new_centre
            held_from = None
            held_stable = 0
            area = 0.0

    spans.append((start, n))
    return [(a, b) for a, b in spans if b > a]


def _moving_average(x: np.ndarray, width: int) -> np.ndarray:
    if width <= 1 or x.size < width:
        return x.copy()
    half = width // 2
    padded = np.pad(x, (half, width - 1 - half), mode="edge")
    return np.convolve(padded, np.ones(width) / width, mode="valid")


def _crossing(drive: np.ndarray, lo: int, hi: int, level: float, rising: bool) -> int:
    """First frame in ``[lo, hi]`` at which ``drive`` has crossed ``level``."""
    for j in range(lo, hi + 1):
        if (drive[j] >= level) if rising else (drive[j] <= level):
            return max(j, lo)
    return lo


def segment(c: Contour) -> list[tuple[int, int]]:
    """Note spans over the whole contour, as frame index pairs."""
    hop = _hop_sec(c)
    spans: list[tuple[int, int]] = []
    for run_start, run_end in _voiced_runs(c.midi):
        stable = None if c.stable is None else c.stable[run_start:run_end]
        for a, b in segment_run(c.midi[run_start:run_end], hop, stable):
            spans.append((run_start + a, run_start + b))
    return spans


# ── 4-5. Pitch per note and clean-up ─────────────────────────────────────────


def _span_pitch(c: Contour, a: int, b: int) -> tuple[float, int]:
    """(median pitch over the span's stable frames, number of stable frames)."""
    hop = _hop_sec(c)
    seg = c.midi[a:b]
    if c.stable is not None:
        stable = c.stable[a:b].copy()
    else:
        stable = np.abs(_slope(seg, hop)) <= SLOPE_MAX_ST_PER_SEC
    if b - a > 4:
        stable[0] = stable[-1] = False  # edges are transitions more often than not
    n_stable = int(stable.sum())
    if b - a >= DRIVE_FRAMES + 2:
        # Long enough to hold a vibrato cycle: the pitch is the median of the contour
        # averaged over one, read away from the edges, which is what the ear hears as
        # the note.  Frame medians of a wide vibrato scatter by a quarter tone or more.
        averaged = _moving_average(seg, DRIVE_FRAMES)
        trim = DRIVE_FRAMES // 2
        return float(np.median(averaged[trim:-trim])), n_stable
    core = seg[stable]
    if core.size == 0:
        core = seg
    # Two passes: the frames within a band of the first median are the note itself,
    # and glide frames the slope test let through are outside it.
    first = float(np.median(core))
    inner = core[np.abs(core - first) <= DELTA_SEMITONES]
    return float(np.median(inner)) if inner.size else first, n_stable


def _valleys(window: np.ndarray) -> list[tuple[int, float]]:
    """Local RMS minima in ``window`` with their depth as a fraction of the flanking peaks."""
    valleys: list[tuple[int, float]] = []
    for k in range(1, window.size - 1):
        neighbourhood = window[max(0, k - VALLEY_WIDTH_FRAMES) : k + VALLEY_WIDTH_FRAMES + 1]
        if window[k] != neighbourhood.min():
            continue
        if valleys and k - valleys[-1][0] <= VALLEY_WIDTH_FRAMES:
            continue
        left = window[max(0, k - 2 * VALLEY_WIDTH_FRAMES) : k]
        right = window[k + 1 : k + 2 * VALLEY_WIDTH_FRAMES + 1]
        flank = min(float(left.max()), float(right.max())) if left.size and right.size else 0.0
        valleys.append((k, float(window[k]) / flank if flank > 0 else 1.0))
    return valleys


def _typical_valley(valleys: list[tuple[int, float]]) -> float:
    """The span's ordinary amplitude ripple — a vowel sung with vibrato through a formant
    dips at the vibrato rate, and a re-strike has to be clearly deeper than that."""
    return float(np.median([ratio for _, ratio in valleys])) if len(valleys) >= 3 else 1.0


def _is_restrike(ratio: float, typical: float) -> bool:
    return ratio < REARTICULATION_FRAC and ratio <= TREMOLO_REL * typical


def _has_rearticulation(c: Contour, a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """Is there an amplitude dip or a voicing gap between two adjacent spans?"""
    hop = _hop_sec(c)
    if b_start > a_end and (b_start - a_end) * hop > BRIDGE_GAP_SEC * 0.5:
        return True  # an unvoiced gap: a consonant or a breath
    window = c.rms_fast[a_start:b_end]
    valleys = _valleys(window)
    typical = _typical_valley(valleys)
    junction = a_end - a_start
    near = [ratio for k, ratio in valleys if abs(k - junction) <= VALLEY_WIDTH_FRAMES]
    return bool(near) and _is_restrike(min(near), typical)


def _split_on_valleys(c: Contour, a: int, b: int) -> list[tuple[int, int]]:
    """Cut a span at RMS valleys deep enough to be re-struck notes of the same pitch."""
    hop = _hop_sec(c)
    min_frames = max(int(round(MIN_NOTE_SEC / hop)), 2)
    window = c.rms_fast[a:b]
    if window.size < 2 * min_frames + 1:
        return [(a, b)]
    valleys = _valleys(window)
    typical = _typical_valley(valleys)

    cuts: list[int] = []
    last = 0
    for k, ratio in valleys:
        if k < min_frames or k > window.size - min_frames or k - last < min_frames:
            continue
        if _is_restrike(ratio, typical):
            cuts.append(k)
            last = k
    bounds = [0, *cuts, window.size]
    parts = [(a + lo, a + hi) for lo, hi in zip(bounds, bounds[1:]) if hi - lo >= min_frames]
    if len(parts) < 2:
        return [(a, b)]
    pitch, _ = _span_pitch(c, a, b)
    # Compared as distances, never by rounding: a note sung 50 cents sharp rounds
    # either way from one half to the next.
    if any(abs(_span_pitch(c, lo, hi)[0] - pitch) > DELTA_SEMITONES for lo, hi in parts):
        return [(a, b)]
    return parts


def clean(c: Contour, spans: list[tuple[int, int]]) -> list[tuple[int, int, float]]:
    """Resolve transitions and fragments; returns ``(start, end, midi)`` per note."""
    hop = _hop_sec(c)
    min_frames = max(int(round(MIN_NOTE_SEC / hop)), 2)
    notes = [(a, b, *_span_pitch(c, a, b)) for a, b in spans]  # (a, b, midi, n_stable)

    # 5a. Transition slivers: a short span whose pitch lies strictly between its two
    # neighbours is the glide from one to the other.  Split it between them.
    changed = True
    while changed and len(notes) >= 3:
        changed = False
        for i in range(1, len(notes) - 1):
            a, b, m, n_stable = notes[i]
            pa, pb, pm, _ = notes[i - 1]
            na, nb, nm, _ = notes[i + 1]
            short = (b - a) * hop < 1.5 * MIN_NOTE_SEC
            adjacent = (a - pb) * hop <= JOIN_GAP_SEC and (na - b) * hop <= JOIN_GAP_SEC
            # Strictly interior: a sliver AT a neighbour's pitch is a fragment of that
            # neighbour (5b), not a glide, and treating it as one cascades along a run.
            margin = 0.35
            between = min(pm, nm) + margin <= m <= max(pm, nm) - margin
            if short and adjacent and between:
                mid = a + (b - a) // 2
                notes[i - 1] = (pa, mid, pm, notes[i - 1][3])
                notes[i + 1] = (mid, nb, nm, notes[i + 1][3])
                del notes[i]
                changed = True
                break

    # 5b. Fragments: a short span is a piece of the neighbour it is nearest in pitch,
    # if it is near enough; otherwise it is dropped only when it is far too short to be
    # a note at all.
    changed = True
    while changed:
        changed = False
        for i, (a, b, m, n_stable) in enumerate(notes):
            if (b - a) > min_frames:
                continue
            candidates = []
            if i > 0 and (a - notes[i - 1][1]) * hop <= JOIN_GAP_SEC:
                candidates.append((abs(m - notes[i - 1][2]), i - 1))
            if i + 1 < len(notes) and (notes[i + 1][0] - b) * hop <= JOIN_GAP_SEC:
                candidates.append((abs(m - notes[i + 1][2]), i + 1))
            candidates.sort()
            tolerance = FRAGMENT_SEMITONES if len(candidates) == 2 else FRAGMENT_EDGE_SEMITONES
            if candidates and candidates[0][0] <= tolerance:
                j = candidates[0][1]
                ja, jb, _, _ = notes[j]
                lo, hi = min(a, ja), max(b, jb)
                notes[j] = (lo, hi, *_span_pitch(c, lo, hi))
                del notes[i]
                changed = True
                break
            if (b - a) * hop < MIN_NOTE_SEC * 0.5:
                del notes[i]
                changed = True
                break

    # 5c. Same notated pitch, no re-articulation between them: one note.
    joined: list[tuple[int, int, float, int]] = []
    for a, b, m, n_stable in notes:
        if joined:
            pa, pb, pm, _ = joined[-1]
            if (
                abs(pm - m) <= DELTA_SEMITONES
                and (a - pb) * hop <= JOIN_GAP_SEC
                and not _has_rearticulation(c, pa, pb, a, b)
            ):
                joined[-1] = (pa, b, *_span_pitch(c, pa, b))
                continue
        joined.append((a, b, m, n_stable))

    # 5d. One span, one pitch, several strikes: split at the amplitude valleys.
    out: list[tuple[int, int, float]] = []
    for a, b, m, _ in joined:
        parts = _split_on_valleys(c, a, b)
        if len(parts) == 1:
            out.append((a, b, m))
        else:
            out.extend((lo, hi, _span_pitch(c, lo, hi)[0]) for lo, hi in parts)
    return [(a, b, m) for a, b, m in out if (b - a) * hop >= MIN_NOTE_SEC * 0.75]


def fix_octaves(y: np.ndarray, sr: int, c: Contour, spans: list[tuple[int, int, float]]) -> list[tuple[int, int, float]]:
    """Raise a note an octave when the audio holds no energy at the pitch pyin claimed."""
    if not spans or y.size < FRAME:
        return spans
    import librosa

    mag = np.abs(librosa.stft(np.asarray(y, dtype=np.float32), n_fft=FRAME, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=FRAME)
    out: list[tuple[int, int, float]] = []
    for a, b, m in spans:
        hi = min(b, mag.shape[1])
        if hi - a < 2:
            out.append((a, b, m))
            continue
        spectrum = mag[:, a:hi].mean(axis=1)
        f0 = 440.0 * 2.0 ** ((m - 69.0) / 12.0)
        odd = even = 0.0
        for k in range(1, 7):
            f = k * f0
            if f >= freqs[-1]:
                break
            # Peak within ±3% of the harmonic, so vibrato and the semitone rounding of
            # ``m`` do not land between bins.
            lo_i = int(np.searchsorted(freqs, f * 0.97))
            hi_i = int(np.searchsorted(freqs, f * 1.03)) + 1
            peak = float(spectrum[lo_i:hi_i].max()) if hi_i > lo_i else 0.0
            if k % 2:
                odd += peak
            else:
                even += peak
        if even > 0.0 and odd < OCTAVE_ODD_EVEN_MAX * even and m + 12.0 <= 108.0:
            out.append((a, b, m + 12.0))
        else:
            out.append((a, b, m))
    return out


# ── 6. Key-aware rounding ─────────────────────────────────────────────────────


def diatonic_set(midis: Sequence[float], durations: Sequence[float]) -> tuple[frozenset[int], float] | None:
    """The pitch classes of the clip's most likely key, and how clearly it won.

    Krumhansl-Kessler correlation over a duration-weighted pitch-class histogram of the
    plainly rounded pitches.  Major and minor are both scored; a minor winner's set is
    its relative major's scale plus the raised leading note, which is the one accidental
    minor-key melodies routinely carry.  Returns None when there is no clear winner.
    """
    if len(midis) < SNAP_MIN_NOTES:
        return None
    histogram = np.zeros(12)
    for m, d in zip(midis, durations):
        histogram[int(round(m)) % 12] += max(float(d), 1e-3)
    if histogram.sum() <= 0.0 or np.count_nonzero(histogram) < 3:
        return None
    scores: list[tuple[float, int, str]] = []
    for tonic in range(12):
        rolled = np.roll(histogram, -tonic)
        for mode, profile in (("major", _KK_MAJOR), ("minor", _KK_MINOR)):
            r = np.corrcoef(rolled, profile)[0, 1]
            scores.append((float(np.nan_to_num(r)), tonic, mode))
    scores.sort(reverse=True)
    (best, tonic, mode), (runner_up, _, _) = scores[0], scores[1]
    if best - runner_up < SNAP_MIN_KEY_MARGIN:
        return None
    if mode == "major":
        return frozenset((tonic + s) % 12 for s in _MAJOR_SET), best - runner_up
    doh = (tonic + 3) % 12
    members = {(doh + s) % 12 for s in _MAJOR_SET}
    members.add((tonic + 11) % 12)  # raised 7th of the minor
    return frozenset(members), best - runner_up


def notate(midis: Sequence[float], durations: Sequence[float]) -> list[int]:
    """Integer pitches for tuned fractional ones, resolving ambiguous notes by key."""
    plain = [int(round(m)) for m in midis]
    key = diatonic_set(midis, durations)
    if key is None:
        return plain
    members, _margin = key
    out: list[int] = []
    for m, p in zip(midis, plain):
        residual = m - p
        if abs(residual) < SNAP_AMBIGUOUS:
            out.append(p)
            continue
        lo, hi = int(np.floor(m)), int(np.ceil(m))
        lo_in, hi_in = lo % 12 in members, hi % 12 in members
        if lo_in != hi_in:
            out.append(lo if lo_in else hi)
        else:
            out.append(p)
    return out


# ── Entry point ───────────────────────────────────────────────────────────────


def analyse(y: np.ndarray, sr: int = SAMPLE_RATE, contour: Contour | None = None) -> Analysis:
    """Notes from a monophonic voice recording.

    ``contour`` lets a caller hand in an f0 track of its own (the transcriber does so
    when it has decided a mixture's melody lives above an accompaniment); otherwise pyin
    is run on the conditioned audio.
    """
    raw = contour if contour is not None else track(condition(y, sr), sr)
    c = smooth(raw)
    # Segmentation is tuning-free — every band is relative to the note's own pitch — so
    # the offset is read off the notes it finds, which are vibrato-free medians.
    spans = clean(c, segment(c))
    if contour is None:
        spans = fix_octaves(y, sr, c, spans)
    hop = _hop_sec(c)
    durations = [(b - a) * hop for a, b, _ in spans]
    tuned_cents = tuning_offset_cents([m for _, _, m in spans], durations)
    c = retune(c, tuned_cents)
    spans = [(a, b, m - tuned_cents / 100.0) for a, b, m in spans]
    midis = [m for _, _, m in spans]
    pitches = notate(midis, durations)

    amps = [float(np.mean(c.rms[a:b])) if b > a else 0.0 for a, b, _ in spans]
    loudest = max(amps) if amps else 0.0
    vprobs = [float(np.median(c.voiced_prob[a:b])) if b > a else 0.0 for a, b, _ in spans]
    keep = [
        not (vp < NOISE_MAX_VOICED_PROB and loudest > 0 and amp / loudest < NOISE_MAX_AMP)
        for vp, amp in zip(vprobs, amps)
    ]
    spans = [x for x, k in zip(spans, keep) if k]
    pitches = [x for x, k in zip(pitches, keep) if k]
    amps = [x for x, k in zip(amps, keep) if k]
    vprobs = [x for x, k in zip(vprobs, keep) if k]
    loudest = max(amps) if amps else 0.0
    notes = [
        VocalNote(
            start=float(c.times[a]),
            end=float(c.times[b - 1]) + hop,
            midi=m,
            pitch=p,
            amp=(amp / loudest) if loudest > 0 else 1.0,
            voiced_prob=vp,
        )
        for (a, b, m), p, amp, vp in zip(spans, pitches, amps, vprobs)
    ]
    return Analysis(notes=notes, tuning_cents=tuned_cents, contour=c)
