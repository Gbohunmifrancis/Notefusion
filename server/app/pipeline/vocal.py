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
  6. **Scale-fit notation.**  The tuning offset and the scale are found together: every
     offset across one semitone and every major scale is tried, and the pair that puts
     the sung notes closest to scale tones (duration-weighted, robust to the odd real
     accidental) wins.  Each note is then written as the nearest scale tone unless it
     is held within SCALE_KEEP_CHROMATIC of a chromatic pitch — a sung ``se`` or ``fe`` is
     real music, a note 35 cents off its scale tone is an untrained voice.  Measured on
     Vocadito (40 real solo singers), notes sit a median 25-30 cents off their own
     semitone even after the clip's offset is removed, so rounding each note on its own
     wrote a wrong neighbour into roughly one note in four, and the offset estimate that
     preceded rounding gave up (returned 0) on 34 of the 40 clips.

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
RANGE_MARGIN_SEMITONES = 7.0  # the fine pass searches the coarse register plus this either side
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
# A long take sags (or climbs) as it goes, and one offset for the whole clip then writes its
# end a semitone off its start: four verses hummed while drifting 120 cents flat came back
# with a third of their syllables wrong and the doh a semitone low on 7 of 9 tunes.  The drift
# is read off windows of DRIFT_WINDOW_NOTES notes (``_drift_trend``) and taken out from the
# first note on — the singer's key is the one they started in — on a clip long enough to show
# one (DRIFT_MIN_NOTES), at no more than DRIFT_MAX_ST_PER_MIN (a steeper reading is cut to
# it), and only when the scale then fits the notes DRIFT_MIN_GAIN better.  Real clips wander
# rather than drift: no clean Vocadito clip passes, and with no cap noisy copies of three of
# them read 2-8 semitones a minute out of the noise and two lost their doh.
DRIFT_MIN_NOTES = 24
DRIFT_WINDOW_NOTES = 8
DRIFT_STEP_NOTES = 4
DRIFT_MAX_ST_PER_MIN = 1.0
DRIFT_MIN_GAIN = 0.20

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
SLIVER_NEIGHBOUR_FRAC = 0.6  # a transition sliver is at most this fraction of its shorter neighbour
FRAGMENT_SEMITONES = 1.5  # a short segment this close to a neighbour is a piece of it
FRAGMENT_EDGE_SEMITONES = 2.5  # ...and at the edge of a phrase (an attack or a release), this close
# pyin is a harmonic-pattern matcher and, on a tone whose fundamental is weak, locks an
# octave low with full confidence.  A note whose odd harmonics carry less than this
# fraction of its even harmonics' energy has no fundamental at the pitch claimed: the
# even harmonics ARE the harmonic series of the octave above.
OCTAVE_ODD_EVEN_MAX = 0.12
JOIN_GAP_SEC = 0.06  # same-pitch segments closer than this are one note unless re-struck
REARTICULATION_FRAC = 0.62  # an RMS valley below this fraction of its flanks is a re-strike
# A shallower valley is still a re-strike when the level comes back as a clear new attack
# (spectral flux at ONSET_CUE_STRONG_FLUX times the clip's typical voiced frame).  A hum
# re-struck on the same pitch dips only briefly, and a 23 ms frame straddling the dip reads
# it at two thirds of the flanks rather than half; the attack that follows is unmistakable.
# Measured: the amateur Twinkle's two merged note pairs come back (12 -> 14 notes) and no
# vibrato case gains a note, since a vibrato's amplitude ripple carries no attack.
REARTICULATION_SOFT_FRAC = 0.80
# ...and clearly deeper than the span's ordinary wobble: a vowel sung with vibrato
# through a formant has an amplitude ripple at the vibrato rate, and that is not a
# re-strike however deep it goes.  A cut must be this fraction of the typical valley.
TREMOLO_REL = 0.85
VALLEY_WIDTH_FRAMES = 3
# ...and a dip alone is not enough: a held note under reverb, or one through a vocal stem
# the separation model thinned out, dips in level as its echoes and partials beat, with
# no new attack.  A cut needs an onset where the level comes back — spectral flux at
# this multiple of the clip's typical voiced frame — or a voicing drop (pyin's voiced
# probability at this fraction of the note's either side), which is the glottal stop or
# consonant of a sung re-strike.  Measured on every cut the dip test made: sung corpus
# 95 of 95 true cuts keep a cue (flux 2.1 and up) and neither false one does; synthetic
# songs' reverberant lead 47 of 49 true kept, 45 of 47 false dropped; through the vocal
# stem 20 of 32 true kept, 63 of 75 false dropped.
ONSET_CUE_FLUX = 2.0
ONSET_CUE_STRONG_FLUX = 4.0
ONSET_CUE_VOICING = 0.3
# ...and the ripple test (TREMOLO_REL) gives way to an attack no vibrato makes: spectral flux at
# this multiple of the clip's typical voiced frame, or pyin hearing no voice at all at the dip
# (a stop's silence).  A chant re-strikes one pitch every sixteenth, so its "ordinary" dip is a
# re-strike's own and none could be cut: 101 of the Afrobeats set's 303 merged repeats.  Read off
# every cut that would newly pass, right against wrong: flux 15 and up on the Afrobeats set's and
# 12 and up on the studio hymn songs' right ones (median), 6.5 and 4.6 on the wrong ones.
# Measured (with RESTRIKE_CLEAR_VOICING): Afrobeats notes.f1 0.712 -> 0.733 (recall +0.03,
# precision up too); studio songs, hymn, sung and instrument corpora and Vocadito level or a
# hair up.  Dropping the guard instead (reading the ripple off attack-free dips only) cost the
# studio hymn songs 0.02 and Vocadito's doh.
RESTRIKE_CLEAR_FLUX = 12.0
# The attack must come with the voice dipping too (pyin's voiced probability at the dip at this
# fraction of the note's either side), as a consonant makes it: a drum leaking into a separated
# stem strikes as sharply on every beat while the held note goes on, and cut the end of
# belmont's first phrase into three.  Kept 63 of the Afrobeats set's 72 right cuts and 46 of the
# hymn songs' 51, against 9 of 13 and 17 of 43 wrong ones.
RESTRIKE_CLEAR_VOICING = 0.6
# A song's singer slides onto a note: a scoop or an approach from a step below, held long
# enough on the way to be segmented as a note of its own.  In a song's separated vocal
# (``analyse(song=True)``) a span that starts a syllable — after a breath or a re-strike — and
# runs on, with no re-strike, up into a note at least SCOOP_MIN_RATIO times as long and at most
# SCOOP_MAX_STEP above it, is that note's attack, if it is no longer than SCOOP_MAX_SEC
# (``absorb_scoops``).  The approach is not written: the annotators of the Children's Song
# Dataset, the studio takes of ``tests.accuracy.studio_songs``, wrote the note it reaches.
# Swept on that corpus's dev half (notes.f1 with the band's doh, 0.717 without the rule):
# 0.25-0.45 s at ratio 2 gave 0.748-0.760, ratio 1.2-1.5 at 0.35 s 0.774-0.780, ratio 3 0.742.
# 1.5 is kept over 1.2, which measured alike, so that two halves of a slurred note stay two.
# Only from below: a step down into a longer note is as often a written dotted figure (s. f m,
# the short note re-sung on a voiced consonant the engine cannot hear); from below alone
# measured the same on the dev half (0.774).
SCOOP_MAX_SEC = 0.35
SCOOP_MIN_RATIO = 1.5
SCOOP_MAX_STEP = 2.5

# ── Key-aware rounding ────────────────────────────────────────────────────────

SNAP_AMBIGUOUS = 0.32  # |residual| above this (i.e. within 18 cents of the midpoint) is ambiguous
# Scale-fit notation (step 6).  A note within this many semitones of a chromatic pitch is
# kept on it; anything further is written as its nearest scale tone.  0.25 measured best of
# 0.15-0.30 on the sung corpus's amateur cases (intended notes known) and on Vocadito.
SCALE_KEEP_CHROMATIC = 0.25
# ...and a note near a chromatic pitch must also be heard as one to keep it.  Untrained singers
# sit a median 20 cents off their notes and four in ten land further off than the keep band,
# so nearness alone wrote accidentals that said nothing: on Vocadito they were as frequent on
# the 14 tunes with no accidental (10.0% of notes) as on the 3 with real ones (10.3%), and one
# in three matched what both annotators heard.  A chromatic stays only when the note is held —
# SCALE_KEEP_MIN_SEC long, SCALE_KEEP_MIN_STABILITY of its frames inside its own band (a scoop
# or a glide the segmenter kept is neither) — and when it stays inside the keep band for every
# tuning offset that fits the scale within SCALE_KEEP_OFFSET_SLACK of the chosen one's cost: an
# offset the notes cannot pin down must not decide which side of the band a note falls.  With
# that evidence asked for, Vocadito's diatonic tunes carry 4.5% accidentals, the chromatic ones
# 5.4%, and more than half match both annotators; the sung corpus keeps 18 of its 24 real ones.
SCALE_KEEP_MIN_SEC = 0.15
SCALE_KEEP_MIN_STABILITY = 0.7
SCALE_KEEP_OFFSET_SLACK = 0.02
# ...but a held, steady note sitting this close to a chromatic pitch at every such offset is
# one however short: a keyboard's or a trained voice's quick passing fe, which the length test
# alone wrote as the note it passes to.  Untrained singers' short notes are rarely this close,
# so the measured numbers above are the same with it as without it (0.05-0.08).
SCALE_KEEP_IN_TUNE = 0.08
# Each note's squared distance to the scale is capped here (semitones), so one real
# accidental costs a bounded amount and cannot drag the offset or the scale with it.
SCALE_FIT_CAP = 0.5
SCALE_FIT_STEP = 0.01  # offset grid, semitones (1 cent)
SCALE_FIT_MIN_NOTES = 5
# Two scales whose costs are this close fit the notes equally (a pentatonic tune lies in
# three major scales at once); the tonal profile then picks between them.
SCALE_FIT_TIE = 1e-6
# Roots whose fit cost is within this fraction of the best are a tie the tonal profile
# settles.  The two scales a near-tie is between differ in one degree (ti against ta, fa
# against fe), and a near-tie means the singer put that degree between the two, where no
# distance can say which was meant; the profile of the whole tune can.  Measured offline
# on the decoder's own note lists: 0.02 moves the sung corpus's doh from 56 to 58 of 61
# (the chromatic passing-note tune, whose C and C# cost G and D major the same) and
# Vocadito's from 27 to 28 of 32; 0.05 and wider hand real singers' tunes to the profile
# too often and lose clips (26 of 32 at 0.05, 23 at 0.10).
SCALE_FIT_TIE_RATIO = 0.02
# How decisive a fit is before it is believed outright: the runner-up root's cost lead,
# as a fraction of the best cost, at which ``ScaleFit.confidence`` reaches 1.  Vocadito's
# wrong dohs mostly sit under 0.035 in a quiet room (all of them on the clean recording, 15
# of 22 over five quiet copies, the rest under 0.10), but under babble, reverb and the phone
# chains they reach 0.20, and the sung corpus re-seeded with detuned, drifting and
# quarter-tone-off singers (132 cases) puts six of its seven decisive wrong dohs under
# 0.26.  At 0.10 those seven were reported at full confidence; at 0.25, with the caps in
# ``ScaleFit.confidence``, one is.
SCALE_FIT_SURE_MARGIN = 0.25
# The sheet's headline confidence weighs its notes by the doh's on the scale it was always
# shown on (``ScaleFit.headline_confidence``): the cost lead over this, with no caps.  The
# capped confidence ranks right dohs over wrong ones far better, but it sits lower on right
# ones too (Vocadito mean 0.65 -> 0.41), which would move a fifth of the sheets users see into
# a lower band; that waits on calibrating it (and on a client that asks about an unsure doh).
SCALE_FIT_HEADLINE_MARGIN = 0.10
# ...and for a tie settled on the tonal profile, the correlation lead that counts as sure.
SCALE_FIT_SURE_TONAL_MARGIN = 0.25
# Readings whose cost is within this fraction of the best are ones the doh could as well
# be; with k of them the doh's confidence is at most 1/k.  Measured on Vocadito over five
# recording conditions: 18 of the 22 wrong dohs had another reading this close (the true
# doh, on 16), against 67 of the 148 right ones.
SCALE_FIT_CROWD_RATIO = 0.05
# A fitted offset beyond this is a singer near a quarter-tone off, whose notes read nearly
# as well in the scale a semitone over: when the two tie the key signature chooses, not the
# audio, and a little more scatter would have made them tie, so the doh is at best an even
# chance either way.
SCALE_FIT_TWIN_OFFSET = 0.4
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
    # Spectral-flux onset strength over the clip's median voiced frame (set by ``track``);
    # None for a contour handed in from elsewhere, which then cuts on the dip alone.
    onset: np.ndarray | None = None


@dataclass(frozen=True)
class VocalNote:
    start: float
    end: float
    midi: float  # tuned, fractional
    pitch: int  # notated
    amp: float  # mean RMS, relative to the loudest note
    voiced_prob: float
    # Fraction of the note's voiced frames within DELTA_SEMITONES of its pitch: 1.0 for a
    # held tone, lower for a note the voice slid through or wobbled across.
    stability: float = 1.0


@dataclass(frozen=True)
class ScaleFit:
    """What ``fit_scale_detail`` found, and how sure it is."""

    offset: float  # tuning offset, semitones
    root: int  # pitch class of the major scale the notes are written in
    # The runner-up root's cost over the winner's, as a fraction of the winner's cost.
    # 0.0 when two roots fit exactly alike (a pentatonic tune) and the profile decided.
    cost_margin: float
    # Among roots the cost could not separate, the winner's tonal-profile lead over the
    # next; 1.0 when the cost alone decided.
    tonal_margin: float
    # Distinct readings within SCALE_FIT_CROWD_RATIO of the best cost, the winner's included
    # (a quarter-tone singer's twins count once, and so do roots tied exactly).
    readings: int = 1
    # The other roots within SCALE_FIT_CROWD_RATIO, nearest first: the dohs a user is
    # offered when this one is unsure.  Unlike ``readings`` a root tied exactly with the
    # winner counts (a pentatonic tune's notes read alike in it, only the doh moves), and a
    # twin of the winner does not (it is the same doh written a semitone over).  Of a pair
    # of twins the simpler key signature is offered.
    alternatives: tuple[int, ...] = ()

    @property
    def confidence(self) -> float:
        """How sure the doh is, in [0, 1].

        A decisive cost margin is sure on its own.  A tie is as sure as the profile lead
        that settled it, scaled under what a decisive cost earns: the profile reads a
        histogram and cannot see which degree the tune avoided.  Either way the doh is at
        best one of the readings the cost barely separates — so a tie the profile settled
        against the cost's own choice is at most an even chance — and so is the doh of a
        singer near a quarter-tone off (``SCALE_FIT_TWIN_OFFSET``).
        """
        by_cost = min(1.0, self.cost_margin / SCALE_FIT_SURE_MARGIN)
        if self.cost_margin > SCALE_FIT_TIE_RATIO:
            sure = by_cost
        else:
            by_profile = 0.8 * min(1.0, max(0.0, self.tonal_margin) / SCALE_FIT_SURE_TONAL_MARGIN)
            sure = max(by_cost, by_profile)
        sure = min(sure, 1.0 / max(1, self.readings))
        if abs(self.offset) > SCALE_FIT_TWIN_OFFSET:
            sure = min(sure, 0.5)
        return sure

    @property
    def headline_confidence(self) -> float:
        """The doh confidence the sheet's headline figure is weighed by: ``confidence`` as it
        read before the caps, the cost lead over ``SCALE_FIT_HEADLINE_MARGIN``."""
        by_cost = min(1.0, self.cost_margin / SCALE_FIT_HEADLINE_MARGIN)
        if self.cost_margin > SCALE_FIT_TIE_RATIO:
            return by_cost
        return max(by_cost, 0.8 * min(1.0, max(0.0, self.tonal_margin) / SCALE_FIT_SURE_TONAL_MARGIN))


@dataclass(frozen=True)
class Analysis:
    notes: list[VocalNote]
    tuning_cents: float
    contour: Contour  # tuned contour, for diagnostics
    # Pitch class of the major scale the notes were written in, or None when the clip had
    # too few notes for a fit and fell back to per-note rounding.
    scale_root: int | None = None
    scale_fit: ScaleFit | None = None
    # The steady drift taken out before the fit, from the first note on (``write_in_scale``);
    # ``tuning_cents`` is the offset at that first note.
    drift_cents_per_min: float = 0.0


@dataclass(frozen=True)
class Written:
    """Notes written in the scale that fits them (``write_in_scale``)."""

    fit: ScaleFit
    drift: float  # semitones per second taken out before the fit; 0.0 when the take held its pitch
    midis: list[float]  # tuned: the fit's offset and the drift removed
    pitches: list[int]


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
    # Two passes.  pyin's Viterbi costs frames x states^2, and states is the search
    # band in bins: 60-1100 Hz at 10-cent bins is ~1000 states.  A coarse pass at
    # 50-cent bins finds the register the voice actually uses, and the fine pass then
    # searches only that register (plus a margin for leaps and scoops), which is a
    # fraction of the states and several times faster for the same answer.
    coarse, _flag, _vp = librosa.pyin(
        y, fmin=FMIN_HZ, fmax=FMAX_HZ, sr=sr, frame_length=FRAME, hop_length=HOP, resolution=0.5
    )
    heard = coarse[~np.isnan(coarse)]
    fmin, fmax = FMIN_HZ, FMAX_HZ
    if heard.size >= 8:
        lo, hi = np.percentile(heard, [5, 95])
        fmin = max(FMIN_HZ, float(lo) / 2.0 ** (RANGE_MARGIN_SEMITONES / 12.0))
        fmax = min(FMAX_HZ, float(hi) * 2.0 ** (RANGE_MARGIN_SEMITONES / 12.0))
    f0, _flag, vprob = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, frame_length=FRAME, hop_length=HOP, resolution=0.1
    )
    rms = librosa.feature.rms(y=y, frame_length=FRAME, hop_length=HOP)[0]
    rms_fast = librosa.feature.rms(y=y, frame_length=HOP, hop_length=HOP)[0]
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    n = min(f0.size, rms.size, rms_fast.size, onset.size)
    f0, vprob, rms, rms_fast, onset = f0[:n], vprob[:n], rms[:n], rms_fast[:n], onset[:n]
    times = librosa.frames_to_time(np.arange(n), sr=sr, hop_length=HOP)

    midi = np.full(n, np.nan)
    voiced = ~np.isnan(f0)
    midi[voiced] = librosa.hz_to_midi(f0[voiced])

    loud = float(np.percentile(rms[voiced], 95)) if voiced.any() else 0.0
    if loud > 0.0:
        quiet = rms < loud * 10.0 ** (VOICING_FLOOR_DB / 20.0)
        midi[quiet] = np.nan
    typical = float(np.median(onset[~np.isnan(midi)])) if np.any(~np.isnan(midi)) else 0.0
    return Contour(
        times=times, midi=midi, voiced_prob=np.nan_to_num(vprob), rms=rms, rms_fast=rms_fast,
        onset=onset / typical if typical > 0.0 else None,
    )


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
        times=c.times, midi=midi, voiced_prob=c.voiced_prob, rms=c.rms, rms_fast=c.rms_fast, stable=stable,
        onset=c.onset,
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


def retune(c: Contour, cents: float | np.ndarray) -> Contour:
    """``c`` with ``cents`` taken off: one offset, or one per frame for a drifting take."""
    return Contour(
        times=c.times,
        midi=c.midi - cents / 100.0,
        voiced_prob=c.voiced_prob,
        rms=c.rms,
        rms_fast=c.rms_fast,
        stable=c.stable,
        onset=c.onset,
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


def _nan_moving_average(x: np.ndarray, width: int) -> np.ndarray:
    """``_moving_average`` that skips unvoiced (NaN) frames instead of spreading them."""
    voiced = ~np.isnan(x)
    if voiced.all():
        return _moving_average(x, width)
    total = _moving_average(np.where(voiced, x, 0.0), width)
    count = _moving_average(voiced.astype(float), width)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, total / np.maximum(count, 1e-12), np.nan)


def _span_pitch(c: Contour, a: int, b: int) -> tuple[float, int]:
    """(median pitch over the span's stable frames, number of stable frames).

    A span can hold unvoiced frames: clean-up joins two pieces of one note across a gap
    of up to ``JOIN_GAP_SEC`` while ``smooth`` only bridges dropouts up to
    ``BRIDGE_GAP_SEC``. Those frames carry no pitch and are left out of every median; a
    NaN here used to reach ``notate`` and fail the whole transcription.
    """
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
        averaged = _nan_moving_average(seg, DRIVE_FRAMES)
        trim = DRIVE_FRAMES // 2
        inner = averaged[trim:-trim]
        inner = inner[~np.isnan(inner)]
        if inner.size:
            return float(np.median(inner)), n_stable
    voiced = ~np.isnan(seg)
    core = seg[stable & voiced]
    if core.size == 0:
        core = seg[voiced]
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


def _is_restrike(ratio: float, typical: float, strong_attack: bool = False, clear_attack: bool = False) -> bool:
    if ratio > TREMOLO_REL * typical and not clear_attack:
        return False
    return ratio < REARTICULATION_FRAC or (strong_attack and ratio < REARTICULATION_SOFT_FRAC)


def _clear_attack(c: Contour, k: int, a: int, b: int) -> bool:
    """A re-strike no vibrato or leaking drum could fake: no voice at all at the dip, or a sharp
    attack with the voice dipping into it."""
    if c.onset is None:
        return False
    w = VALLEY_WIDTH_FRAMES
    dip = float(np.min(c.voiced_prob[max(a, k - w) : min(b, k + w + 1)], initial=1.0))
    if dip <= 0.0:
        return True
    if _attack_flux(c, k, a, b) < RESTRIKE_CLEAR_FLUX:
        return False
    sides = np.concatenate((c.voiced_prob[max(a, k - 4 * w) : max(a, k - w - 1)],
                            c.voiced_prob[min(b, k + w + 2) : min(b, k + 4 * w + 1)]))
    return sides.size > 0 and dip <= RESTRIKE_CLEAR_VOICING * float(np.median(sides))


def _attack_flux(c: Contour, k: int, a: int, b: int) -> float:
    """Spectral-flux onset strength just after frame ``k``, over the clip's typical frame."""
    if c.onset is None:
        return 0.0
    return float(np.max(c.onset[max(a, k - 1) : min(b, k + VALLEY_WIDTH_FRAMES + 1)], initial=0.0))


def _onset_cue(c: Contour, k: int, a: int, b: int) -> bool:
    """Is the level dip at frame ``k`` (inside the span ``[a, b)``) a new attack?"""
    if c.onset is None:
        return True
    if _attack_flux(c, k, a, b) >= ONSET_CUE_FLUX:
        return True
    w = VALLEY_WIDTH_FRAMES
    sides = np.concatenate((c.voiced_prob[max(a, k - 4 * w) : max(a, k - w - 1)],
                            c.voiced_prob[min(b, k + w + 2) : min(b, k + 4 * w + 1)]))
    if sides.size == 0:
        return False
    dip = float(np.min(c.voiced_prob[max(a, k - w) : min(b, k + w + 1)]))
    return dip <= ONSET_CUE_VOICING * float(np.median(sides))


def _has_rearticulation(c: Contour, a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """Is there an amplitude dip or a voicing gap between two adjacent spans?"""
    hop = _hop_sec(c)
    if b_start > a_end and (b_start - a_end) * hop > BRIDGE_GAP_SEC * 0.5:
        return True  # an unvoiced gap: a consonant or a breath
    window = c.rms_fast[a_start:b_end]
    valleys = _valleys(window)
    typical = _typical_valley(valleys)
    junction = a_end - a_start
    near = [(ratio, k) for k, ratio in valleys if abs(k - junction) <= VALLEY_WIDTH_FRAMES]
    if not near:
        return False
    ratio, k = min(near)
    strong = _attack_flux(c, a_start + k, a_start, b_end) >= ONSET_CUE_STRONG_FLUX
    clear = _clear_attack(c, a_start + k, a_start, b_end)
    return _is_restrike(ratio, typical, strong, clear) and _onset_cue(c, a_start + k, a_start, b_end)


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
        strong = _attack_flux(c, a + k, a, b) >= ONSET_CUE_STRONG_FLUX
        if _is_restrike(ratio, typical, strong, _clear_attack(c, a + k, a, b)) and _onset_cue(c, a + k, a, b):
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
            # A glide is far shorter than the notes it joins; a passing note in a run of
            # equal short notes is as long as its neighbours and is music.
            short = (b - a) * hop < 1.5 * MIN_NOTE_SEC and (b - a) < SLIVER_NEIGHBOUR_FRAC * min(pb - pa, nb - na)
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


def absorb_scoops(c: Contour, spans: list[tuple[int, int, float]]) -> list[tuple[int, int, float]]:
    """Fold a singer's slide up onto a note into the note: see ``SCOOP_MAX_SEC``.

    The span joined takes the note's pitch and starts where the slide did, so the note is
    written where the singer began it.  A span preceded by a note it runs on from is not a
    syllable's attack (a melisma's or a run's inner note) and is left alone.
    """
    hop = _hop_sec(c)
    out = list(spans)
    i = 0
    while i + 1 < len(out):
        a, b, m = out[i]
        na, nb, nm = out[i + 1]
        dur = (b - a) * hop
        attack = i == 0 or (a - out[i - 1][1]) * hop > JOIN_GAP_SEC or _has_rearticulation(
            c, out[i - 1][0], out[i - 1][1], a, b)
        if (attack and dur <= SCOOP_MAX_SEC and (nb - na) * hop >= SCOOP_MIN_RATIO * dur
                and 0.5 <= nm - m <= SCOOP_MAX_STEP and (na - b) * hop <= JOIN_GAP_SEC
                and not _has_rearticulation(c, a, b, na, nb)):
            out[i] = (a, nb, nm)
            del out[i + 1]
            continue
        i += 1
    return out


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
            hi_i = min(hi_i, spectrum.size)
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


_MAJOR_OFFSETS = np.array(sorted(_MAJOR_SET))
# Accidentals in each major key's signature (the simpler of the two spellings at F#/Gb).
_KEY_SIGNATURE_ACCIDENTALS = [0, 5, 2, 3, 4, 1, 6, 1, 4, 3, 2, 5]
# _SCALE_MEMBER[root, pc]: is pitch class pc in the major scale on root?
_SCALE_MEMBER = np.zeros((12, 12), dtype=bool)
for _root in range(12):
    _SCALE_MEMBER[_root, (_root + _MAJOR_OFFSETS) % 12] = True


def fit_scale(midis: Sequence[float], weights: Sequence[float]) -> tuple[float, int] | None:
    """(tuning offset in semitones, major-scale root) that best fit the sung notes.

    See ``fit_scale_detail``; this is its answer without the margins.
    """
    fit = fit_scale_detail(midis, weights)
    return None if fit is None else (fit.offset, fit.root)


def _tonality(histogram: np.ndarray, root: int) -> float:
    """Krumhansl-Kessler major-profile correlation of a pitch-class histogram at ``root``."""
    r = np.corrcoef(np.roll(histogram, -root), _KK_MAJOR)[0, 1]
    return float(np.nan_to_num(r, nan=-1.0))


def fit_scale_detail(midis: Sequence[float], weights: Sequence[float]) -> ScaleFit | None:
    """The tuning offset and major-scale root that best fit the sung notes, with margins.

    Minimises the duration-weighted, capped squared distance from each note to the nearest
    tone of the scale, over every offset in [-0.5, 0.5) at ``SCALE_FIT_STEP`` and every
    major scale.  Minor keys need no family of their own: a natural-minor tune lies in its
    relative major's scale, which is also where movable-do puts its doh.  (Adding the
    harmonic minors as candidates was measured and made things worse — 24 scales give an
    imprecise singer enough freedom to fit the wrong one.)

    Fitting the offset and the scale together is what lets the offset be found at all on
    real singing: the deviations of untrained voices from the nearest semitone are spread
    so wide that a circular mean of them carries almost no information, while the
    seven-of-twelve pattern of a scale pins the offset down.

    Roots the cost cannot separate — exactly, when the notes never touch the degrees that
    tell two scales apart, or within ``SCALE_FIT_TIE_RATIO``, when the singer put that
    degree between the two — are settled on the tonal profile of the rounded notes, as
    ``diatonic_set`` did before this, once each quarter-tone singer's two readings among
    them have been settled on the simpler key signature.

    Returns None for fewer than ``SCALE_FIT_MIN_NOTES`` notes.
    """
    m = np.asarray(midis, dtype=float)
    w = np.asarray(weights, dtype=float)
    keep = ~np.isnan(m)
    m, w = m[keep], w[keep]
    if m.size < SCALE_FIT_MIN_NOTES:
        return None
    if float(w.sum()) <= 0.0:
        w = np.ones_like(m)
    best_cost, best_theta = root_costs(m, w)
    order = sorted(range(12), key=lambda r: float(best_cost[r]))
    low = float(best_cost[order[0]])
    import os as _os  # TEMP probe
    if _os.environ.get("NF_PROBE_FIT"):
        print(f"[fitprobe] per_weight={low / float(w.sum()):.5f} runner={float(best_cost[order[1]]) / float(w.sum()):.5f} n={m.size}", flush=True)
    tied = [r for r in order if float(best_cost[r]) <= low * (1.0 + SCALE_FIT_TIE_RATIO) + SCALE_FIT_TIE]

    def twins(a: int, b: int) -> bool:
        # One reading written twice: the same notes a semitone over, at the wrap of the
        # offset range (a singer a quarter-tone off either semitone).  The root a semitone up
        # reads them a semitone lower, so it is the one at the low end of the range; the two
        # the other way round are a different reading, a whole tone from this one.
        if (a - b) % 12 == 1:
            upper, lower = a, b
        elif (b - a) % 12 == 1:
            upper, lower = b, a
        else:
            return False
        return float(best_theta[lower]) - float(best_theta[upper]) >= 0.9

    def margin_over(root: int) -> float:
        rivals = [float(best_cost[r]) for r in order if r != root and not twins(r, root)]
        runner_up = rivals[0] if rivals else np.inf
        if low > 0.0:
            return runner_up / low - 1.0
        return 0.0 if runner_up <= SCALE_FIT_TIE else 1.0

    # The readings the cost barely tells apart.  Twins are one reading, and so are roots the
    # cost cannot tell apart at all (a pentatonic tune's three scales): the profile settles
    # those, and its own margin says how surely.
    readings: list[int] = []
    for r in order:
        if float(best_cost[r]) > low * (1.0 + SCALE_FIT_CROWD_RATIO) + SCALE_FIT_TIE:
            break
        if not any(twins(q, r) or abs(float(best_cost[q] - best_cost[r])) <= SCALE_FIT_TIE for q in readings):
            readings.append(r)

    def alternatives_to(root: int) -> tuple[int, ...]:
        offered: list[int] = []
        for r in order:
            if float(best_cost[r]) > low * (1.0 + SCALE_FIT_CROWD_RATIO) + SCALE_FIT_TIE:
                break
            if r == root or twins(r, root):
                continue
            twin = next((i for i, q in enumerate(offered) if twins(q, r)), None)
            if twin is None:
                offered.append(r)
            elif _KEY_SIGNATURE_ACCIDENTALS[r] < _KEY_SIGNATURE_ACCIDENTALS[offered[twin]]:
                offered[twin] = r
        return tuple(offered)

    # Nothing in the audio separates twins, so the key signature does — the reading in the
    # simpler key, which is where choir music is written (G over A-flat, B-flat over B) —
    # and it does so before the profile is asked: the profile reads each twin's histogram
    # rounded a semitone apart, so the two score differently for no reason in the notes.
    # (No two roots a semitone apart have the same signature, so this always decides.)
    tied = [
        r
        for r in tied
        if not any(
            twins(q, r) and _KEY_SIGNATURE_ACCIDENTALS[q] < _KEY_SIGNATURE_ACCIDENTALS[r] for q in tied
        )
    ]
    if len(tied) == 1:
        root = tied[0]
        return ScaleFit(float(best_theta[root]), root, margin_over(root), 1.0, len(readings), alternatives_to(root))

    def tonality(root: int) -> float:
        histogram = np.zeros(12)
        for value, weight in zip(np.round(m - best_theta[root]).astype(int), w):
            histogram[value % 12] += weight
        return _tonality(histogram, root)

    scored = sorted(
        ((round(tonality(r), 3), -_KEY_SIGNATURE_ACCIDENTALS[r], -i, r) for i, r in enumerate(tied)),
        reverse=True,
    )
    root = scored[0][3]
    tonal_margin = scored[0][0] - scored[1][0]
    return ScaleFit(float(best_theta[root]), root, margin_over(root), tonal_margin, len(readings),
                    alternatives_to(root))


def snap_to_scale(
    midis: Sequence[float],
    root: int,
    keep: float = SCALE_KEEP_CHROMATIC,
    *,
    durations: Sequence[float] | None = None,
    stabilities: Sequence[float] | None = None,
    slack: tuple[float, float] = (0.0, 0.0),
    minor: bool = False,
) -> list[int]:
    """Integer pitches for tuned fractional ones, written in the major scale on ``root``.

    A note whose nearest semitone is in the scale is that semitone.  One whose nearest
    semitone is chromatic keeps it only when it sits within ``keep`` of it at every tuning
    offset in ``slack`` — (low, high) semitones about the offset the notes were tuned by —
    and, where ``durations`` and ``stabilities`` are given, lasts ``SCALE_KEEP_MIN_SEC`` (or
    sits within ``SCALE_KEEP_IN_TUNE`` of it throughout the slack) and holds
    ``SCALE_KEEP_MIN_STABILITY``; otherwise it is the nearer of its two neighbours that is a
    scale tone.  A passing or neighbour tone (``_chromatic_step``) needs no length: a run's
    fe or a blues grace is short by nature, and as a scale tone it would repeat the note
    beside it.

    ``minor`` (the tune reads as the relative minor, ``_minor_mode``) excuses se from the
    slack: a minor tune's raised seventh is expected, not an accident, so held and within
    ``keep`` is enough.  Making it a scale tone outright measured worse — Vocadito's natural
    minor tunes have a sharp soh now and then, and it came back as se (accidentals 4.3% ->
    5.3% of notes), while Greensleeves' sung se stays either way.

    Without the evidence arguments this is the plain keep test.
    """
    low, high = slack
    out: list[int] = []
    for i, value in enumerate(midis):
        n = int(round(value))
        if _SCALE_MEMBER[root, n % 12]:
            out.append(n)
            continue
        in_tune = abs(value - low - n) <= SCALE_KEEP_IN_TUNE and abs(value - high - n) <= SCALE_KEEP_IN_TUNE
        # A passing or neighbour tone (s fe f, l se l, a run's de) is a semitone from the notes
        # either side of it: its shape stands in for length, which such a note never has, and
        # as a scale tone it would only repeat the note beside it.  It must still be steady
        # and inside the band at every offset that fits.
        long_enough = durations is None or in_tune or durations[i] >= SCALE_KEEP_MIN_SEC or _chromatic_step(midis, i, n)
        held = long_enough and (stabilities is None or stabilities[i] >= SCALE_KEEP_MIN_STABILITY)
        if minor and (n - root) % 12 == 8:
            near = abs(value - n) <= keep
        else:
            # At an offset ``delta`` from the chosen one the note reads ``value - delta``; its
            # distance to ``n`` is largest at one end of the slack.
            near = abs(value - low - n) <= keep and abs(value - high - n) <= keep
        if held and near:
            out.append(n)
            continue
        neighbours = [p for p in (n - 1, n + 1) if _SCALE_MEMBER[root, p % 12]]
        out.append(min(neighbours, key=lambda p: abs(value - p)) if neighbours else n)
    return out


def _chromatic_step(midis: Sequence[float], i: int, n: int) -> bool:
    """Is note ``i`` (heard as semitone ``n``) a passing tone — a semitone from each neighbour,
    moving the same way — or a neighbour tone that leaves a note by a semitone and returns?"""
    if i == 0 or i + 1 >= len(midis):
        return False
    before, after = int(round(midis[i - 1])), int(round(midis[i + 1]))
    if before == after:
        return abs(before - n) == 1
    return {before, after} == {n - 1, n + 1}


def _scale_costs(midis: np.ndarray, weights: np.ndarray, offset: float) -> np.ndarray:
    """The fit's cost of the notes in every major scale, by root, at one tuning offset: each
    note's squared distance to the scale's nearest tone, capped at ``SCALE_FIT_CAP``, weighted."""
    x = midis - offset
    candidates = np.floor(x).astype(int)[:, None] + np.arange(-1, 3)[None, :]  # (n, 4)
    distance = np.abs(x[:, None] - candidates)
    member = _SCALE_MEMBER[:, candidates % 12]  # (12, n, 4)
    nearest = np.where(member, distance[None], np.inf).min(axis=2)  # (12, n)
    return (weights[None] * np.minimum(nearest * nearest, SCALE_FIT_CAP * SCALE_FIT_CAP)).sum(axis=1)


def _scale_cost(midis: np.ndarray, weights: np.ndarray, fit: ScaleFit) -> float:
    return float(_scale_costs(midis, weights, fit.offset)[fit.root])


def root_costs(midis: Sequence[float], weights: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    """(cost, offset) per major-scale root: how well the notes fit each scale at its best offset.

    What ``fit_scale_detail`` minimises, kept for every root rather than reduced to a winner,
    for a caller that has the root from somewhere else — a key the user typed, the chords of
    a song's backing — and has to know whether the voice agrees with it.  Unvoiced (NaN)
    notes are left out.
    """
    m = np.asarray(midis, dtype=float)
    w = np.asarray(weights, dtype=float)
    keep = ~np.isnan(m)
    m, w = m[keep], w[keep]
    if float(w.sum()) <= 0.0:
        w = np.ones_like(m)
    best_cost = np.full(12, np.inf)
    best_theta = np.zeros(12)
    # Both ends of the offset range are searched: at exactly half a semitone the same notes
    # read as one scale half a semitone flat or the next scale up half a semitone sharp, and
    # a grid holding only one end would hand that singer to whichever end it kept.
    for theta in np.arange(-0.5, 0.5 + SCALE_FIT_STEP / 2.0, SCALE_FIT_STEP):
        costs = _scale_costs(m, w, theta)
        better = costs < best_cost - SCALE_FIT_TIE
        best_cost = np.where(better, costs, best_cost)
        best_theta = np.where(better, theta, best_theta)
    return best_cost, best_theta


def _offset_slack(midis: np.ndarray, weights: np.ndarray, root: int, offset: float) -> tuple[float, float]:
    """How far the offset can move either way, with the root held, before the scale fits the
    notes ``SCALE_KEEP_OFFSET_SLACK`` worse: (low, high) semitones about ``offset``."""
    steps = int(round(0.5 / SCALE_FIT_STEP))
    deltas = np.arange(-steps, steps + 1) * SCALE_FIT_STEP
    costs = np.array([_scale_costs(midis, weights, offset + d)[root] for d in deltas])
    within = costs <= costs[steps] * (1.0 + SCALE_KEEP_OFFSET_SLACK) + SCALE_FIT_TIE
    lo = hi = steps
    while lo > 0 and within[lo - 1]:
        lo -= 1
    while hi + 1 < deltas.size and within[hi + 1]:
        hi += 1
    return float(deltas[lo]), float(deltas[hi])


def _minor_mode(tuned: np.ndarray, weights: np.ndarray, root: int) -> bool:
    """Does the tune's profile read as the relative minor (la-based) rather than the major?"""
    histogram = np.zeros(12)
    np.add.at(histogram, np.round(tuned).astype(int) % 12, weights)
    minor = np.corrcoef(np.roll(histogram, -((root + 9) % 12)), _KK_MINOR)[0, 1]
    return bool(np.nan_to_num(minor, nan=-1.0) > _tonality(histogram, root))


def _drift_trend(midis: np.ndarray, weights: np.ndarray, starts: np.ndarray) -> float:
    """The take's steady drift in semitones per second: one line through the offsets that
    windows of ``DRIFT_WINDOW_NOTES`` notes fit on their own, unwrapped across the semitone."""
    centres: list[float] = []
    offsets: list[float] = []
    for s in range(0, midis.size - DRIFT_WINDOW_NOTES + 1, DRIFT_STEP_NOTES):
        fit = fit_scale_detail(midis[s : s + DRIFT_WINDOW_NOTES], weights[s : s + DRIFT_WINDOW_NOTES])
        if fit is not None:
            centres.append(float(np.mean(starts[s : s + DRIFT_WINDOW_NOTES])))
            offsets.append(fit.offset)
    if len(offsets) < 2:
        return 0.0
    unwrapped = np.unwrap(2.0 * np.pi * np.asarray(offsets)) / (2.0 * np.pi)
    return float(np.polyfit(centres, unwrapped, 1)[0])


def _write(
    midis: np.ndarray,
    weights: np.ndarray,
    root: int,
    offset: float,
    stabilities: Sequence[float] | None,
    minor: bool | None,
) -> list[int]:
    """``snap_to_scale`` with the evidence for each accidental: the note's duration (its
    weight) and stability, how far the offset can move at almost no cost, and the tune's mode
    — read off its profile when the caller does not know it."""
    tuned = midis - offset
    return snap_to_scale(
        tuned.tolist(), root, durations=weights.tolist(), stabilities=stabilities,
        slack=_offset_slack(midis, weights, root, offset),
        minor=_minor_mode(tuned, weights, root) if minor is None else minor,
    )


def write_in_scale(
    midis: Sequence[float],
    durations: Sequence[float],
    starts: Sequence[float],
    stabilities: Sequence[float] | None = None,
) -> Written | None:
    """Fit the scale to sung, untuned note pitches and write every note in it.

    The offset and the scale come from ``fit_scale_detail``, on the notes with any steady
    drift taken out first (see DRIFT_MIN_NOTES); each note is then written by
    ``snap_to_scale`` with the evidence for its accidentals — its duration, its stability
    where the caller measured it, the offset's slack and the tune's mode.  ``Written.midis``
    plus ``fit.offset`` is each note's sung pitch with the drift removed.  None when there are
    too few notes for a fit.  The pitches are medians of voiced frames, so never NaN.
    """
    m = np.asarray(midis, dtype=float)
    w = np.asarray(durations, dtype=float)
    t = np.asarray(starts, dtype=float)
    fit = fit_scale_detail(m, w)
    if fit is None:
        return None
    drift = 0.0
    if m.size >= DRIFT_MIN_NOTES:
        cap = DRIFT_MAX_ST_PER_MIN / 60.0
        trend = float(np.clip(_drift_trend(m, w, t), -cap, cap))
        if trend:
            level = m - trend * (t - t.min())
            refit = fit_scale_detail(level, w)
            if _scale_cost(level, w, refit) < (1.0 - DRIFT_MIN_GAIN) * _scale_cost(m, w, fit):
                m, fit, drift = level, refit, trend
    pitches = _write(m, w, fit.root, fit.offset, stabilities, None)
    return Written(fit=fit, drift=drift, midis=(m - fit.offset).tolist(), pitches=pitches)



def write_in_root(
    midis_untuned: Sequence[float],
    durations: Sequence[float],
    stabilities: Sequence[float] | None,
    root: int,
    minor: bool | None = None,
) -> tuple[float, list[int]]:
    """(tuning offset, pitches): the notes written in the major scale on ``root``.

    For a root decided outside the fit.  The offset is fitted again with the root held,
    because the offset the fit found belongs to the scale it chose: a singer a quarter-tone
    off fits one scale near +0.5 and its semitone twin near -0.5, and snapping into the twin
    at the first scale's offset would move every note.  Each note is then written on the
    evidence ``write_in_scale`` weighs, with ``minor`` from whatever decided the root (the
    mode of the user's key, of the chords) when it says one.  The pitches are never NaN.
    """
    m = np.asarray(midis_untuned, dtype=float)
    w = np.asarray(durations, dtype=float)
    _costs, offsets = root_costs(m, w)
    offset = float(offsets[root])
    return offset, _write(m, w, root, offset, stabilities, minor)


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


def analyse(y: np.ndarray, sr: int = SAMPLE_RATE, contour: Contour | None = None, song: bool = False) -> Analysis:
    """Notes from a monophonic voice recording.

    ``contour`` lets a caller hand in an f0 track of its own (the transcriber does so
    when it has decided a mixture's melody lives above an accompaniment); otherwise pyin
    is run on the conditioned audio.  ``song`` says the voice is a song's, separated from
    its band, whose singer's slides onto notes are folded into them (``absorb_scoops``).
    """
    raw = contour if contour is not None else track(condition(y, sr), sr)
    c = smooth(raw)
    # Segmentation is tuning-free — every band is relative to the note's own pitch — so
    # the offset is read off the notes it finds, which are vibrato-free medians.
    spans = clean(c, segment(c))
    if contour is None:
        spans = fix_octaves(y, sr, c, spans)
    if song:
        spans = absorb_scoops(c, spans)
    hop = _hop_sec(c)

    # Noise goes before the scale fit: a span too quiet and too unvoiced to be written must not
    # vote on the scale the others are written in.  Fitted on every span, breath and room noise
    # moved the doh of two Vocadito clips (18 and 19) that the kept notes alone fit right.
    amps = [float(np.mean(c.rms[a:b])) if b > a else 0.0 for a, b, _ in spans]
    loudest = max(amps) if amps else 0.0
    vprobs = [float(np.median(c.voiced_prob[a:b])) if b > a else 0.0 for a, b, _ in spans]
    keep = [
        not (vp < NOISE_MAX_VOICED_PROB and loudest > 0 and amp / loudest < NOISE_MAX_AMP)
        for vp, amp in zip(vprobs, amps)
    ]
    spans = [x for x, k in zip(spans, keep) if k]
    amps = [x for x, k in zip(amps, keep) if k]
    vprobs = [x for x, k in zip(vprobs, keep) if k]
    loudest = max(amps) if amps else 0.0
    # Read before tuning: the band is relative to the note's own pitch either way.
    stabilities = [_stability(c.midi[a:b], m) for a, b, m in spans]
    durations = [(b - a) * hop for a, b, _ in spans]
    midis = [m for _, _, m in spans]

    written = write_in_scale(midis, durations, [float(c.times[a]) for a, _, _ in spans], stabilities)
    if written is not None:
        fit, drift = written.fit, written.drift
        tuned_cents = fit.offset * 100.0
        midis, pitches = written.midis, written.pitches
    else:
        fit, drift = None, 0.0
        tuned_cents = tuning_offset_cents(midis, durations)
        midis = [m - tuned_cents / 100.0 for m in midis]
        pitches = notate(midis, durations)
    first = min((float(c.times[a]) for a, _, _ in spans), default=0.0)  # write_in_scale's anchor
    c = retune(c, tuned_cents + 100.0 * drift * (c.times - first))
    spans = [(a, b, m) for (a, b, _), m in zip(spans, midis)]
    notes = [
        VocalNote(
            start=float(c.times[a]),
            end=float(c.times[b - 1]) + hop,
            midi=m,
            pitch=p,
            amp=(amp / loudest) if loudest > 0 else 1.0,
            voiced_prob=vp,
            stability=stability,
        )
        for (a, b, m), p, amp, vp, stability in zip(spans, pitches, amps, vprobs, stabilities)
    ]
    return Analysis(
        notes=notes, tuning_cents=tuned_cents, contour=c,
        scale_root=None if fit is None else fit.root, scale_fit=fit,
        drift_cents_per_min=drift * 6000.0,
    )


def _stability(frames: np.ndarray, midi: float) -> float:
    """Fraction of a span's voiced frames within DELTA_SEMITONES of the note's pitch."""
    voiced = frames[~np.isnan(frames)]
    if voiced.size == 0:
        return 0.0
    return float(np.mean(np.abs(voiced - midi) <= DELTA_SEMITONES))
