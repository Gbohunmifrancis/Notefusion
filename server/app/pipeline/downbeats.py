"""Where a song's bar lines go, read from its band.

A sung line says little about where its bars start: the held-note rule
(``transcriber._meter_and_pickup``) was tuned on hymns sung alone, and on the studio songs
(``python -m tests.accuracy.report --songs``) it put the first note in the right place of its
bar on 43% of the real takes and 60% of their notes in the right bar.  A band says it plainly:
the kick and the bass land on the downbeat (and on beat three of four), and the chords change
there.  ``read`` measures, at every half beat of the sheet's grid, how much the instrumental
marks that instant as a downbeat:

* ``low``   the onset strength below 180 Hz (kick, bass) within 70 ms of it;
* ``chord`` how far the harmony of the beat after it is from the beat before (the chords
            module's drum-free semitone spectrum, folded above C2);
* ``bass``  the same for the bass register (C1-B3).

Each is z-scored over the sung span and the three are summed.  ``BandAccents.score`` is the
mean of that sum at the bar lines a meter and offset draw; a three-beat bar wins over four
when its downbeats stand out more.  Kick and bass on beats one and three leave 4/4 half a bar
in doubt, and so does a bar whose chords change mid-way; a song's music starts on a downbeat
(its intro is whole bars), so ``start`` - where the instrumental begins, when the clip begins
where the song does - settles that (``START_WEIGHT``).

Measured on the dev songs of ``tests.accuracy.studio_songs`` with the meter and the offset
counted right only when the bar lines fall on the band's own downbeats: the singer's rule
16 of 30, the band alone 24 of 35, the band with its start 33 of 35 (and the meter 35 of 35).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# How far before the first note the band is read, in beats: an intro's last bar or two.
LEAD_BEATS = 8.0
# The window, either side of an instant, its low-band onset is looked for in (seconds).
ONSET_WINDOW_SEC = 0.07
# Below this the band's best bar lines stand out too little from the rest (summed z-scores) to
# overrule the singer: a voice and a pad, a song with no rhythm section.
MIN_SALIENCE = 1.0
# ...and this many standard errors above chance, over the bars heard: a few bars of noise can
# put one offset's mean over ``MIN_SALIENCE``.  Hiss and a held pad measured 0.9-2.9; the dev
# songs' bands 2.5-7.4, all but two over 3.
MIN_STANDARD_ERRORS = 3.0
# What a bar line where the music starts is worth, in the same units: enough to settle half a
# bar the band leaves in doubt, not enough to overrule the downbeats of every bar.
START_WEIGHT = 1.0
# What the singer's held-note accents (z-scored over the offsets) add: a tie-break only.
VOICE_WEIGHT = 0.2
# The instrumental has begun once its level reaches this share of its loud passages.
START_LEVEL = 0.1


@dataclass(frozen=True)
class BandAccents:
    """The band's downbeat salience at each half beat of the sheet's grid (``halves``, beats
    from beat 0), and where its music starts in the same beats (None when the clip starts inside
    the song, or the start cannot be read)."""

    halves: np.ndarray
    salience: np.ndarray
    start: float | None

    def _bar_lines(self, beats: int, offset: float) -> np.ndarray:
        p = (self.halves + offset) % beats
        return (np.abs(p) < 1e-6) | (np.abs(p - beats) < 1e-6)

    def score(self, beats: int, offset: float) -> float:
        """The mean salience at the bar lines ``offset`` draws: ``start + offset`` is each note's
        place on a grid whose bars start at 0, as ``transcriber._bar_phase`` has it."""
        on = self._bar_lines(beats, offset)
        return float(self.salience[on].mean()) if on.any() else 0.0

    def scores(self, beats: int) -> dict[float, float]:
        return {k / 2.0: self.score(beats, k / 2.0) for k in range(2 * beats)}

    def starts_bar(self, beats: int, offset: float) -> bool:
        """The music starts on a bar line this offset draws (within a quarter of a beat)."""
        if self.start is None:
            return False
        p = (self.start + offset) % beats
        return min(p, beats - p) <= 0.25

    def clear(self) -> bool:
        """The band marks its downbeats plainly enough to place the bars by: its best bar lines'
        mean salience is ``MIN_SALIENCE`` or more, and that many standard errors above chance."""
        spread = float(self.salience.std())
        if spread <= 1e-9:
            return False
        best = max(((beats, offset) for beats in (3, 4) for offset in self.scores(beats)),
                   key=lambda m: self.score(*m))
        mean = self.score(*best)
        bars = int(self._bar_lines(*best).sum())
        return mean >= MIN_SALIENCE and mean * np.sqrt(bars) / spread >= MIN_STANDARD_ERRORS


def _z(x: np.ndarray, mask: np.ndarray) -> np.ndarray:
    ref = x[mask] if mask.any() else x
    sd = float(ref.std())
    return (x - float(ref.mean())) / sd if sd > 1e-9 else np.zeros_like(x)


def _novelty(frames: np.ndarray, frame_t: np.ndarray, times: np.ndarray, span: float) -> np.ndarray:
    """1 - cosine between the mean of ``frames`` (bins, n) over the ``span`` before each time and
    the ``span`` after it."""
    cum = np.concatenate([np.zeros((frames.shape[0], 1)), np.cumsum(frames, axis=1)], axis=1)

    def mean(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        i, j = np.searchsorted(frame_t, a), np.searchsorted(frame_t, b)
        n = np.maximum(j - i, 1)
        m = (cum[:, j] - cum[:, i]) / n
        norm = np.linalg.norm(m, axis=0)
        return np.divide(m, norm, out=np.zeros_like(m), where=norm > 1e-12)

    before, after = mean(times - span, times), mean(times, times + span)
    return 1.0 - np.sum(before * after, axis=0)


def read(y: np.ndarray, sr: int, origin_sec: float, bpm: float, first_beat: float, last_beat: float,
         song_start: bool = True) -> BandAccents | None:
    """The band's accents on the sheet's grid: beat ``b`` is at ``origin_sec + b * 60 / bpm`` in
    ``y`` (the instrumental, mono).  None when the clip is too short to say anything."""
    import librosa

    from app.pipeline import chords

    if bpm <= 0.0 or y.size == 0:
        return None
    spb = 60.0 / bpm
    duration = len(y) / float(sr)
    halves = np.arange(np.floor(first_beat - LEAD_BEATS) * 2.0, np.ceil(last_beat) * 2.0 + 1.0) / 2.0
    times = origin_sec + halves * spb
    keep = (times >= 0.0) & (times < duration)
    halves, times = halves[keep], times[keep]
    if halves.size < 16:
        return None

    hop = 256
    mel = librosa.feature.melspectrogram(y=y, sr=sr, hop_length=hop, n_mels=12, fmax=180.0)
    low = librosa.onset.onset_strength(S=librosa.power_to_db(mel), sr=sr, hop_length=hop)
    low_t = np.arange(low.size) * hop / float(sr)
    window = int(round(ONSET_WINDOW_SEC * sr / hop))
    centre = np.clip(np.searchsorted(low_t, times), 0, low.size - 1)
    peak = np.array([low[max(0, c - window): c + window + 1].max() for c in centre])

    spec = chords._semitone_spectrogram(y, sr)
    spec_t = np.arange(spec.shape[1]) * chords._HOP / float(sr)
    pcs = (np.arange(spec.shape[0]) + chords._MIDI_LO) % 12
    upper, bass = np.zeros((12, spec.shape[1])), np.zeros((12, spec.shape[1]))
    for pc in range(12):
        upper[pc] = spec[(pcs == pc) & (np.arange(spec.shape[0]) >= 12)].sum(axis=0)
        bass[pc] = spec[(pcs == pc) & (np.arange(spec.shape[0]) < 36)].sum(axis=0)

    sung = (halves >= first_beat - LEAD_BEATS / 2.0) & (halves <= last_beat)
    salience = (_z(peak, sung) + _z(_novelty(upper, spec_t, times, spb), sung)
                + _z(_novelty(bass, spec_t, times, spb), sung))

    start = None
    if song_start:
        rms = librosa.feature.rms(y=y, hop_length=512)[0]
        loud = float(np.percentile(rms, 95)) if rms.size else 0.0
        on = np.flatnonzero(rms > START_LEVEL * loud) if loud > 0.0 else np.empty(0, int)
        if on.size:
            start = (on[0] * 512 / float(sr) - origin_sec) / spb
    return BandAccents(halves, salience, start)
