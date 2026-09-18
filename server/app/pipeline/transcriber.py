"""The transcription pipeline: audio file -> structured result (TRD par. 2.3, par. 5).

Ported from the validated Phase 0 spike (spike/transcribe.py). Pure function of the
input file + options; no state, no persistence — the caller deletes the audio.

Speed & accuracy improvements over v1
──────────────────────────────────────
  Onset merging          Adjacent same-pitch notes closer than MERGE_GAP_SEC are fused,
                         eliminating split-triplet / re-triggered ghost notes that hurt
                         precision on all three spike test clips.

  Adaptive amplitude     The amplitude floor is derived from the clip's own p75 amplitude
                         rather than a fixed constant, so soft or distant recordings
                         are not entirely filtered out while clip-level noise is.

  Key-confidence guard   Fewer than MIN_NOTES_FOR_KEY pitched events is too little data
                         for any pitch profile; the confidence score is capped
                         at KEY_CONFIDENCE_CAP_LOW so the mobile shows the editable-key
                         prompt (PRD mitigation for short-clip key detection weakness).

  NaN-safe tempo         librosa.beat.beat_track returns NaN on very short or near-silent
                         clips; the value is now validated and clamped to 100 BPM.

  Flat-key normalisation music21 uses "B-" internally; all returned key strings are
                         normalised to the "b" convention ("Bb major", "Eb minor") so
                         C#'s KeyParser never encounters a bare "-" character in the
                         tonic body (which previously caused 422s on re-key endpoints).

  Faster Basic Pitch     minimum_note_length raised to 100 ms for melody mode — shorter
                         fragments add post-processing noise for solfa use cases without
                         carrying extra pitch information.
"""

import base64
import threading
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

from app.config import settings
from app.pipeline import solfa
from app.pipeline import solfa_render

# ── Audio preview synthesis ───────────────────────────────────────────────────

# Sample rate for the synthesised WAV preview returned alongside the result.
# 22 050 Hz gives CD-quality for speech/melody with half the data of 44 100 Hz.
PREVIEW_SAMPLE_RATE = 22_050

# Synthesis voice: a softly-struck piano.
#
# The previous voice was eight partials at ~1/k² damped by exp(-k·t/1.6). Measured,
# that is a sine wave: a C4 had five audible partials at the strike and *two* by
# t=2 s, a spectral centroid of 290 Hz on a 262 Hz note, and a C2 whose entire
# spectrum sat at 72 Hz. The per-partial decay being linear in k is what did it —
# partial 8 starts 48 dB down and the tone collapses onto its fundamental inside
# 100 ms. So: many more partials, damped sub-linearly, with the two things that
# actually make a piano recognisable — a hammer transient and unison beating.

# Hammer contact point as a fraction of the speaking length. A real piano's is near
# 1/7 to 1/8; it puts a node on the 7th-8th partial, which the ear hears as the
# absence of a sour minor seventh rather than as a missing partial.
_STRIKE_POS = 1.0 / 7.6

# Body spectrum: |sin(k·pi·x)| / k^rolloff. Below 1 is buzzy, above 1.4 is dull.
# Real pianos are flatter in the bass and steeper in the treble — the hammer is wide
# relative to a short treble string and narrow relative to a long bass one — so the
# exponent tilts with register instead of being one number for the whole compass.
_BODY_ROLLOFF_C4 = 1.05
_ROLLOFF_TILT = 1.0 / 120.0  # per semitone above C4
_ROLLOFF_MIN = 0.85
_ROLLOFF_MAX = 1.45

# The number that decides "soft piano" rather than "bright piano": a gently played
# note has very little above ~2.5 kHz, and one pole at 5.2 kHz did not come close.
# Measured on a C4, partial 20 sat about 19 dB below the fundamental where a softly
# struck piano is 40-plus down — the pole was so far above the partials it was meant
# to tame that it barely touched the upper lobes of |sin(k·pi·x)|.
#
# Applied squared — two poles at this corner rather than one — because what needed
# to change was the steepness of the skirt, not the passband. Measured on a rendered
# C4, two poles here put partial 20 at -43 dB while moving k=1 by 0.06 dB, so the
# body of the spectrum is where it was and only the harsh top comes off. Two poles at
# 2.6 kHz were tried first and overshot to -52 dB, which is duller than a piano.
# Still a tilt and not a brick wall: a hard cut is what left the old treble with five
# partials and a bass whose spectrum stopped dead.
_BRIGHT_CEILING_HZ = 3800.0

# Generation ceiling, and the level below which a partial is inaudible anyway.
_MAX_PARTIALS = 48
_PARTIAL_FLOOR_DB = -60.0

# Upper partials of a real string sit slightly sharp of exact multiples. Stretching
# partial k by (1 + B·k²) with this B is squarely in the range measured on real
# pianos, and at 48 partials the stretch is large enough that it must be modelled
# rather than ignored.
_INHARMONICITY = 1.1e-4

# The hammer: a second, much brighter partial stack that is gone in ~15 ms. This is
# what a strike *is* — broadband energy at contact, immediately gone, leaving the
# string ringing. Without it a note simply appears, which is much of why the old
# preview did not read as struck.
_STRIKE_GAIN = 0.22
_STRIKE_ROLLOFF = 0.35
_STRIKE_TAU_SEC = 0.014
_STRIKE_SPAN_SEC = 10 * _STRIKE_TAU_SEC  # past here the term is below -87 dB

# Per-partial damping: partial k's time constant is tau0/(1 + k·k^exp), so the tone
# darkens as it rings — but far more slowly than the old exp(-k·t/1.6).
_DAMP_K = 0.14
_DAMP_EXP = 1.15

# Envelope (seconds). A piano is percussive: it never holds a level, it decays from
# the strike onward. The voice before last sustained at 0.80 × peak for the whole
# body of every note, which is an *organ*. There is no sustain level here; the body
# is a pair of exponentials and only the attack and the damper release are shaped.
_ATTACK_SEC = 0.005  # hammer strike; raised-cosine, so short but not a click

# How long the damper takes to land *after* note-off. This is a ring-out past the
# notated end, not a fade inside it — the distinction is the whole of it. At 80 ms
# ending *at* the notated end, every note measured 40 to 43 dB down by the time the
# next onset arrived, so nothing carried across a note boundary and the melody read
# as a sequencer rather than as an instrument. A piano rings into the next note, and
# that overlap is most of what makes it sound like a piano.
#
# Ceiling on this: it doubles as the buffer's end padding, and
# ``test_tempo_sets_the_timescale`` asserts a 240 BPM render is under 0.6x a 120 BPM
# one. On its 4-beat fixture a tempo-independent tail T gives (1 + T) < 0.6·(2 + T),
# so T < 0.5 s. 0.35 leaves 0.574 against that 0.6. Do not raise it to "ring more"
# without redoing the arithmetic.
_RELEASE_SEC = 0.350

# Body decay time constant, seconds, at middle C. Scaled per note by
# _string_decay_sec: bass strings are longer, heavier and less damped, so they ring
# far longer than treble ones, and a single global constant makes the low register
# sound clipped and the high register sound like a bell.
_STRING_DECAY_SEC_C4 = 2.4
_STRING_DECAY_MIN_SEC = 0.55
_STRING_DECAY_MAX_SEC = 4.0

# Piano notes fall fast at first and then much more slowly — the two polarisations
# of string motion decay at different rates and the crossover is plainly audible.
# Modelled as a mixture of two exponentials rather than one.
_TAIL_MIX = 0.22
_TAIL_FACTOR = 3.2

# Unison detuning, in cents: tuners leave a couple of cents between the two or three
# strings of a note deliberately, and the slow beating that results is what the ear
# reads as warmth.
#
# Modelled as (1 + depth·cos) rather than as a literal sum of three equal strings.
# That sum is sin(2·pi·f·t)·(1 + 2·cos(2·pi·d·t)), and (1 + 2·cos) passes through
# *zero* at 2·pi/3 on its way to -1 — so every partial periodically vanishes
# outright. Measured, that reads as 49 dB of "beating" and it is a dropout, not a
# shimmer: the C4 fundamental fell 16 dB below its own third partial at t=1.1 s.
# Depth is the swing itself, and 0.6 was still far too much of one: 1.6 down to 0.4
# is a 12 dB swing on every partial from the fourth up, which the ear reads as an
# out-of-tune wobble rather than as warmth. 0.25 is 1.25 down to 0.75, a swing of
# 4.4 dB. Easy to under-read from a rendered clip — the partials each beat at their
# own k·detune rate, so a summed envelope averages the whole thing away and shows
# barely 1 dB. Measure per partial (see ``test_unison_beating_never_nulls_a_partial``,
# which does).
#
# The depth ramps in over the first several partials, which is both Weinreich's
# measured result on coupled piano strings — a unison phase-locks at the fundamental
# and decouples higher up, so the shimmer is a partial-band effect — and what stops
# the energy-dominant fundamental from swinging the whole spectrum as it beats.
_DETUNE_CENTS = 2.0
_UNISON_DEPTH = 0.25
_UNISON_KNEE = 8.0
_UNISON_MIN_MIDI = 52  # below this the strings are wound and single or paired

# Every note is normalised to this, so its level does not depend on its spectrum.
_PEAK_TARGET = 0.95

# ── Post-processing thresholds ────────────────────────────────────────────────

# Hard lower bounds; adaptive logic may raise these further per-clip.
MIN_AMPLITUDE_MELODY = 0.15  # v1 was 0.20 — allow softer recordings to pass
MIN_AMPLITUDE_POLY = 0.12  # v1 was 0.15

# Adaptive threshold: ADAPTIVE_FACTOR × p75(clip amplitudes), floored at the
# constant above.  Scales the cut with how confident the model is on this clip.
#
# 0.25 was structurally unable to do its job, and the harness had already recorded the
# proof without anyone reading it.  Basic Pitch's amplitude is a posterior in [0,1], so
# 0.25 × p75 has a hard CEILING of 0.25 — and per-case conf.* (conf IS the event
# amplitude, see the assignment to editorial.confidence) shows the ghost population
# clustered at 0.252-0.268 against real notes at 0.585-0.792, with conf.auc a perfect
# 1.000 on 20 of 38 cases.  Amplitude separates ghosts from notes flawlessly on those
# clips and the floor sat one thousandth BELOW the entire ghost cluster, so the stage
# that exists to remove them could never fire.  diag_baseline — the clean control —
# emitted 15 notes for 11 references.
#
# Swept 0.25 / 0.40 / 0.50 / 0.60 over the corpus.  At 0.40: notes.precision 0.783 ->
# 0.839, notes.f1 0.832 -> 0.863, notes.f1_with_offset 0.707 -> 0.798, solfa.ghost_count
# 5.711 -> 4.947, beats.precision 0.801 -> 0.858, tempo.abs_error 24.000 -> 21.263
# (fewer spurious onsets, so the tempo chooser sees the real grid), and
# solfa.anchor_matches_reference 0.974 -> 1.000.  EIGHTEEN cases go to exactly zero
# ghosts, including diag_baseline 4 -> 0, plagal_fourth 4 -> 0 and lead_in_800ms 3 -> 0.
# notes.recall holds at 0.935 and all twelve already-perfect cases stay bit-identical
# 1.000, guards included.
#
# 0.40 rather than the middle of the plateau: 0.40 and 0.50 are identical on every
# metric, 0.60 breaks vibrato_rate_k15 (recall 1.000 -> 0.909), and deleting a real note
# is worse than leaving a ghost — so take the low end of the plateau, furthest from the
# edge that loses notes.
#
# What this does NOT fix, so it is not mistaken for a solfa win later:
# solfa.degree_accuracy is unchanged at 0.917 and chromatic_ghosts at 1.868, because
# both are computed over MATCHED notes and this removes unmatched ones.  It is a
# precision and timing fix — what the user sees as spurious extra notes on the staff.
# conf.auc drops 0.868 -> 0.551 for the same reason: the discarded events were the ones
# amplitude was correctly identifying, so the statistic loses the population it was
# scoring.  That is the metric measuring its own success, not a regression.
ADAPTIVE_FACTOR = 0.40

# Events shorter than this are almost always artefacts (breath noise, finger
# scrapes, string squeak).
MIN_NOTE_SEC = 0.06

# Onset merging: consecutive same-pitch events separated by a gap smaller than
# the mode-specific constant are fused into a single event.
MERGE_GAP_MELODY = 0.08  # ~1 sixteenth note at 120 BPM
MERGE_GAP_POLY = 0.05  # tighter for polyphonic — avoid swallowing trills

# Melody overlap resolution: two *overlapping* events this close in pitch, sharing
# this much of the shorter one's span, are one wobbling note that inference split
# rather than two notes.
#
# This is the population every earlier vibrato fix was structurally unable to reach.
# All of them lived in ``_merge_onsets``, whose ``0.0 <= gap`` test only sees events
# that abut; the fragments of a wobbling note *interleave*, because Basic Pitch fires
# at both neighbours of the wobble simultaneously.  The melody resolver is the one
# stage that already looks at overlapping pairs — and it had no pitch test at all,
# comparing only amplitude and onset proximity, so it kept a semitone-off sliver as a
# note of its own.  Every such sliver is chromatic against the key by definition, so
# it prints an accidental: this is the whole of the "accidentals where not needed"
# complaint, and ``solfa.chromatic_ghosts`` is where it shows up.
#
# Pitch alone is not enough, and that is why there are two constants.  A genuine
# legato semitone step also overlaps — the events bleed into each other at the
# boundary — so a pitch-only rule fused real steps and cost one note each on
# major_e_flat, minor_natural_d, overtone_heavy, pluck_envelope,
# triplets_eighth_c_major and fast_sixteenths_c_major (recall 0.935 -> 0.889).
# What separates the two populations is *how much* they overlap, measured as a
# fraction of the shorter event:
#
#   genuine steps   n=6   min 0.021  median 0.100  max 0.100
#   wobble pairs    n=38  min 0.091  median 0.800  max 1.000
#
# 0.20 sits in the middle of the gap — twice the largest genuine step, a third of the
# lowest wobble pair above them — and fuses 37 of 38 wobble pairs while leaving all 6
# genuine steps alone.  A step bleeds at its edge; a sliver sits *inside* its note.
WOBBLE_SEMITONES = 1
WOBBLE_MIN_OVERLAP_FRACTION = 0.20

# A real note's Basic Pitch event can bleed a few milliseconds into the next note.
# Treating that boundary blur as polyphony would force the melody selector to drop one
# of two genuine steps.  Forty milliseconds is already the minimum duration accepted by
# ``_resolve_melody_overlaps``, so an overlap no longer than this cannot contain a second
# independently notatable event and is safe to keep in one path.
MELODY_PATH_OVERLAP_SEC = 0.04

# Basic Pitch reports per-note pitch bends in units of 1/3 semitone, already centred
# on the note's own pitch (``get_pitch_bends`` subtracts ``pb_shift``, and the contour
# bin of MIDI pitch p is exactly 3p - 63, so there is no rounding offset to undo).
CONTOUR_BINS_PER_SEMITONE = 3.0

# How far apart two events' f0 may sit and still be fused by ``_merge_onsets``.
#
# This is the constant the struck "vibrato-tolerant merge" needed and did not have.
# That attempt compared *rounded* pitches, where fragments of one wobbling note are
# two semitones apart because Basic Pitch fires at both neighbours — so no tolerance
# under two could reach them, and a tolerance of two swallows real steps.  Reading the
# bends collapses that: measured over the nine vibrato/drift cases, consecutive
# fragments of one reference note sit a median 0.395 semitones apart in f0 against
# 2.074 for genuine steps.
#
# 0.5 is where the corpus put it.  Against today's exact-pitch rule it fuses 11 more
# fragment pairs and 4 *fewer* genuine ones — better on both axes — and the whole
# movement is inside the vibrato cases: semitone_steps_c_major, fast_sixteenths_c_major,
# diag_baseline and vibrato_depth_0_8 are bit-identical.  Going to 0.75 buys 9 more
# fragment merges but starts fusing genuine steps in vibrato_rate_k20 and
# vibrato_depth_2_0, and 1.0 is the knee where genuine damage triples.
#
# Any value below 1.0 also leaves bend-free events behaving exactly as before, since
# two distinct integer pitches differ by at least 1 — which is why the ~40 helper tests
# that build Events without bends need no changes and still pin the old semantics.
#
# All of which held, and bought almost nothing: on the full corpus the rule fires as
# calibrated (drift_1_semitone gains 11 merges) and moves solfa.chromatic_ghosts by one
# accidental in 38 cases, while solfa.ghost_count gets 0.105 *worse* — past the 0.02
# regression tolerance.  Four cases move at all, and the two that lose (vibrato_rate_k155
# f1 -0.073 and +3 ghosts, vibrato_heavy +2 ghosts) are outside the nine this constant was
# fitted on.  So 0.5 is the right answer to the question the nine cases asked and the
# question was too narrow; ``settings.f0_merge`` is off by default because of it.
F0_MERGE_SEMITONES = 0.5

# Contour-aware gap fusion is intentionally stricter than onset merging.  A gap longer
# than this is treated as a possible rest or re-articulation, not a posterior dropout.
CONTOUR_GAP_MAX_SEC = 0.18
CONTOUR_GAP_TOLERANCE = 0.75
CONTOUR_GAP_ONSET_VETO = 0.70

# Key detection: fewer than this many note events and no pitch profile is
# reliable; cap the reported confidence so the mobile shows the prompt.
MIN_NOTES_FOR_KEY = 6
KEY_CONFIDENCE_CAP_LOW = 0.45

# pyin pitch refinement (defect 6).  fmin is roughly C2, below any sung
# fundamental; fmax matches the maximum_frequency handed to Basic Pitch so the
# two stages cannot disagree about what counts as a plausible fundamental.
PYIN_FMIN_HZ = 65.0
PYIN_FMAX_HZ = 1050.0

# ── Melody floor: which voice the contour path tracks ─────────────────────────
# pyin is monophonic by construction, so on a mixture it returns ONE voice — and with
# fmin at C2 the voice it returns is the lowest strong one.  That is why the two wrong-hand
# polyphonic corpus cases transcribe the left hand: segmentation and tempo come out exactly
# right (poly_block_chords measured beats.f1 1.000 and tempo 96 exact) and every pitch is 12
# to 24 semitones low.  Nothing downstream asks which voice pyin chose, so nothing downstream
# can repair it; the register has to be decided BEFORE pyin runs.  (The third polyphonic case,
# ``close_voicing_c_major``, fails the opposite way — the floor lands correctly and pyin then
# reports nothing at all.  Deciding the register is necessary there too and not sufficient;
# see MELODY_FLOOR_MARGIN_SEMITONES for why, and ``Posteriorgram.melody_track`` for what the
# floor hands the register to instead of pyin once it has fired.)
#
# Basic Pitch is the evidence, because it is polyphonic and it provably already has the
# melody — measured 11 of 11 reference notes covered by an exact-pitch event on both
# polyphonic cases.  Its naive skyline is NOT the melody (18.8% and 20.1% of frames: the
# highest active pitch is usually a +12/+19 harmonic ghost of the melody itself), which is
# what MELODY_FLOOR_TAU exists to reject.
#
# A FIXED raise is not available: the oracle value that solves poly_alberti_bass outright
# (230 Hz) sits above the melodies of the transposed major_*/minor_* cases, which start as
# low as 62 Hz below it.  So the floor is estimated per clip, and applied only when gated.
#
# Fraction of the loudest event sounding at the same instant that a lower-pitched one must
# reach to count toward the skyline.  Measured over 267 overlapping +12/+19 pairs across the
# corpus: on monophonic clips the ghost/parent ratio has a median of 0.39-0.49 by case and a
# ceiling of **0.520** on overtone_heavy, the case built for that content.  So 0.50 sits just
# above the bulk of the distribution and just below its tail — it rejects most ghost frames
# and lets a handful through, and the median in the gate below is what absorbs those.  The
# two mechanisms are a pair; neither alone covers the range.
#
# 0.50 is also the widest setting: sweeping 0.50/0.60/0.70/0.80 leaves the monophonic
# maximum at +1.11 throughout — it is set by vibrato, not by ghosts — while the polyphonic
# minimum FALLS from +23.91 to +18.91, because a higher tau starts discarding real
# accompaniment voices.  The chasm narrows from 22.80 to 17.80 semitones for nothing.
MELODY_FLOOR_TAU = 0.50
# Frames within this many semitones of the strong skyline's median count as "the melody's
# own register".  The floor is the MINIMUM of the skyline restricted to those frames, and
# the restriction is the whole trick: the unrestricted minimum dips to the accompaniment
# (measured 46 and 53 against a left hand topping out at 55) and is therefore useless,
# while a 10th-percentile cuts real low notes on plagal_fourth and semitone_steps, whose
# melodies visit their lowest note only briefly.  At width 10 the estimate is at or below
# the melody's own lowest note on all 43 cases.
MELODY_FLOOR_REGISTER_WIDTH = 10.0
# Dropped below the estimate so the floor does not sit exactly ON the melody's lowest note.
# 2 is not a safety margin and widening it is not conservative — measured over the window
# the accompaniment leaves (55 < floor <= 60, i.e. margins 2..6), poly_alberti_bass scores
# f1 1.000 at 2 and then DEGRADES to 0.909 at 5 and 0.870 at 6, because every extra
# semitone hands pyin more of the left hand to fall back onto.  Margins 3 and 4 push
# poly_block_chords' second pyin pass to zero voiced frames, so it falls through to the
# inference path and returns 16 events with 5 ghosts at tempo 137 — a worse answer than the
# 2 correct notes margin 2 yields, on every column except key.
#
# Starving pyin is therefore the failure mode of every margin, and ``close_voicing_c_major``
# shows it does not need a widened margin to happen.  There the accompaniment's top voice is
# B3 (59) under a melody spanning 60..67, so the estimate lands on 60 and the margin cannot
# subtract: the floor is already at the melody's lowest note and one semitone above the whole
# left hand — the best placement available.  Raising ``fmin`` to 262 Hz still removes the
# mixture's strongest component from pyin's search band while leaving its energy in the
# signal, and pyin reports 4 events out of 336 f0 frames at voiced_prob 0.011-0.023
# (notes.f1 0.500, 12 reference notes against 4 estimated).  Precision stays perfect and
# recall collapses — the opposite signature to the two poly cases, which reported the wrong
# VOICE rather than no voice.  No margin fixes that; only a pitch tracker that does not
# depend on an ``fmin`` band can — which is what ``Posteriorgram.melody_track`` now is, and
# the case reaches notes.f1 1.000 through it.  The margin sweep above stands as measured:
# it was a sweep of the wrong knob, not a mismeasured one.
MELODY_FLOOR_MARGIN_SEMITONES = 2.0
# The gate.  Fires when the strong skyline sits at least this far above pyin's contour —
# two independent engines disagreeing about which register the music is in, the same
# consensus argument _blend_confidence runs on pitch.  Measured per-frame median
# difference: **[-0.09, +1.11] over the 40 monophonic cases, +23.91, +24.11 and +24.11 on
# the three polyphonic ones**.  A tritone sits ~5x above the monophonic maximum and ~4x below
# the polyphonic minimum, so this is a chasm rather than a fitted threshold, and the 40 clean
# cases keep byte-identical behaviour because the gate never fires on them.
#
# Reading a MEDIAN over frames rather than a maximum is what makes this robust to harmonic
# ghosts, and it is load-bearing rather than incidental: MELODY_FLOOR_TAU does not reject
# every ghost (overtone_heavy's reach 0.520 against a tau of 0.50), so on any clip with
# strong overtones some frames genuinely do have the ghost on top.  They are a minority, and
# a median ignores a minority.  overtone_heavy measures -0.09 for that reason, not because
# its ghosts were filtered out.
#
# 6 semitones is a tritone — ~5x above the monophonic maximum and ~4x below the polyphonic
# minimum.  Anywhere in roughly [2, 18] would classify all 43 cases identically; the value
# is placed at the midpoint of that range in the log domain rather than fitted to it.
MELODY_FLOOR_DISAGREEMENT_SEMITONES = 6.0

# How many distinct notated pitches an ABOVE-FLOOR contour must carry before it is believed.
#
# Raising pyin's floor tells it where to look; it does not make the melody trackable.  On
# poly_block_chords pyin comes back with 82 of 336 frames voiced and every one of them at
# midi 60 — one pitch, for the whole clip.  A contour that never changes pitch cannot encode
# a melody, so 2 is a definition rather than a threshold, and the corpus leaves it a wide
# berth: the nearest non-degenerate case carries 7 distinct pitches (semitone_steps_c_major)
# and the other gated case carries 10.  Nothing measured sits between 1 and 7.
#
# pyin's own confidence cannot do this job, which is worth recording because it is the
# obvious thing to reach for: the two gated cases report median voiced_prob 0.010 and 0.048,
# both far under PYIN_MIN_VOICED_PROB, while monophonic vibrato_depth_2_0 sits at 0.323 and
# is transcribed perfectly.  A raised fmin depresses voiced_prob whatever the outcome.  That
# is also why the floor, not a confidence threshold, is what selects ``melody_track``.
#
# This applies to the above-floor contour ONLY — ``melody_track``'s, or the second pyin pass
# where the posteriorgram capture failed.  A constant contour from pyin's FIRST pass is a clip
# of one sustained note, which is a legitimate transcription; a constant above-floor one means
# the melody was not found in the register the floor pointed at.  No corpus case reaches this
# check any more, ``poly_block_chords`` included: ``melody_track`` returns 11 distinct-pitched
# notes where the second pyin pass returned one pitch.  It stays because the failure it
# describes is a property of a mixture rather than of pyin, and the capture-failure fallback
# still runs the pass that produced it.
MELODY_FLOOR_MIN_DISTINCT_PITCHES = 2

# An event needs at least this many voiced pyin frames before its contour is
# trusted.  pyin's default hop is 512 samples (23 ms at 22.05 kHz), so three
# frames is ~70 ms — just under MIN_NOTE_SEC, which means a note long enough to
# survive the duration filter normally clears this too, and only a genuinely
# unvoiced span falls short.
PYIN_MIN_VOICED_FRAMES = 3

# Median voiced probability an event must reach before its pitch is corrected.
# Intended as a floor against noise rather than a discriminator, on the grounds that
# real notes sit at 0.69-0.76 under heavy vibrato and 0.95-0.98 when clean.  That
# second claim was "so nothing real is anywhere near this", and DEEP vibrato falsifies
# it: on vibrato_depth_1_8 and vibrato_depth_2_0 real notes sit at a median 0.33 and
# 0.28, and this floor refuses 50 of 56 and 55 of 56 of their events.  The mechanism is
# not noise — +-1.8-2.0 semitones at 5.5 Hz sweeps ~4 semitones inside pyin's ~93 ms
# analysis window, so the signal is not periodic at a single f0 and it is pyin's
# PERIODICITY estimate that collapses.  The floor reads "the pitch is moving fast" as
# "this might not be a note".
#
# Lowering it anyway was measured over the full corpus at 0.25 / 0.20 / 0.15, and 0.5
# stays because the headline metric says so.  At the best of those (0.20):
# solfa.degree_accuracy 0.917 -> 0.915.  Everything underneath it improves —
# notes.recall 0.935 -> 0.964, notes.f1 0.832 -> 0.846, solfa.chromatic_ghosts 1.868 ->
# 1.737, notes.semitone_neighbour_ghosts 2.105 -> 1.921, solfa.octave_error_rate 0.008
# -> 0.002, key.exact 0.868 -> 0.895 (vibrato_depth_2_0's key comes right and no case's
# key breaks) — and the four cases this floor exists for (noise_moderate,
# quiet_low_amplitude, overtone_heavy, pluck_envelope) are bit-identical 1.000 at every
# value, because the rule only fires where pyin and Basic Pitch disagree and on those
# cases they agree.  So the floor is not, in fact, what protects them.
#
# What it costs is why it is not worth it.  Exactly two cases move, in opposite
# directions and by almost the same amount: vibrato_depth_2_0 0.333 -> 0.875 and
# vibrato_depth_1_8 0.600 -> 0.000.  The second is a wrong-key artefact — that case's
# key is wrong at every floor, so its degrees are measured against the wrong tonic and
# 0.600 was coincidental partial credit — but trading one deep-vibrato case for another
# is not a fix, it is a coin flip, and it also drags conf.auc 0.868 -> 0.835 because
# accepting low-probability corrections that turn out correct pulls conf.mean_correct
# down (0.674 -> 0.655) while conf.mean_wrong sits still.
#
# The offline sweep over per-event rows had predicted +260 net fixes here and was
# wrong: it covered 12 of 38 cases and none of the noise cases, and it mispredicted
# both moving cases' baselines.  Trust the corpus, not the rows.  The real defect these
# two cases share is the KEY, not the floor.
PYIN_MIN_VOICED_PROB = 0.5

# How far from a whole number of octaves the pyin/Basic Pitch disagreement may
# sit and still be read as an octave error.  Measured over the corpus, real
# octave errors land within 0.01 semitones of exactly 12, so this is generous;
# it stays under 2 so a genuinely wrong pitch a whole tone from the octave (a
# +14 ghost does occur) is left alone rather than snapped.
PYIN_OCTAVE_TOLERANCE = 1.5

# ── Contour-first segmentation (settings.contour_first) ───────────────────────
# Notes read straight off the pyin f0 contour, with Basic Pitch not consulted about
# where they start or stop.  See ``settings.contour_first`` for why that is sound for a
# monophonic line and for the three rules that were measured; these are the constants of
# the one that won.
#
# pyin's hop is 512 samples at 22.05 kHz, so one frame is 23.2 ms.  Every constant below
# is quoted in frames because that is the unit the rule actually operates in.

# Median pre-smooth, in frames.  9 frames is 209 ms, which is ~1.15 cycles of the 5.5 Hz
# vibrato the corpus uses — a median over about one full period of an oscillation returns
# its centre, and a median (unlike a mean) leaves a step edge where it is.  Swept 1/5/9:
# 1 and 5 leave the deep cases at f1 0.167/0.080, 9 lifts them to 0.500 and holds all
# nine clean cases at 1.000, so the smoother is doing work no tolerance change could.
# Swept upward as well, 11 through 21, on the theory that a wider median would remove the
# wobble the deep cases still lose to; it does the reverse, and the numbers are under
# ``CONTOUR_PERSIST_FRAMES``.  9 is the measured optimum in both directions.
CONTOUR_SMOOTH_FRAMES = 9

# How far the contour may sit from the current note's centre before that frame counts as
# out of band.  0.75 is three quarters of the smallest interval notation can express, so a
# genuine semitone step clears it while intonation error and residual wobble do not.
CONTOUR_BAND_SEMITONES = 0.75

# Consecutive out-of-band frames required before the note is declared over.  THIS is the
# rule, and its value is geometry rather than calibration: for x = A sin(2 pi f t) the run
# spent outside +-tol is (pi - 2 arcsin(tol / A)) / (2 pi) of a period, so at
# CONTOUR_BAND_SEMITONES over the corpus's 5.5 Hz / 7.8-frame cycle the deepest case in it
# (A = 2.0) is outside for 2.9 consecutive frames and A = 1.8 for 2.8.  4 rejects both with
# a margin, and rejects a wobble at that band and rate up to roughly A = 2.2.
#
# NOT to any depth, though the raw-sine geometry says it should be: the out-run tends to half
# a period as A grows, which is 3.91 frames at 5.5 Hz and still under 4.  The geometry is
# describing the wrong signal — the band test runs on the SMOOTHED contour, and the
# CONTOUR_SMOOTH_FRAMES median passes about 42% of the vibrato amplitude at 5.5 Hz rather
# than removing it (a 9-frame window spans 1.15 periods, so its samples cover phase unevenly
# and the median tracks an attenuated copy instead of the centre).  42% of A = 1.8 is 0.76,
# which is already over the 0.75 band, so at these depths the frames really are out of band
# and only persistence is holding the note together.  Measured: A = 2.0 gives one segment,
# A = 2.5 gives three, A = 4.0 gives nine.
#
# That pointed the remaining vibrato loss at the smoother rather than at this number, since
# the same measurement puts the pass-through at 29% for width 21, which should have brought
# A = 2.0 back inside the band outright.  It does not, and the prediction is wrong: swept over
# 9/11/13/15/17/21 the deep targets get WORSE and their note counts RISE with width
# (vibrato_depth_1_8 n_est 17 -> 21 -> 27 -> 26 -> 23 -> 29; vibrato_depth_2_0 19 -> 25 -> 30
# -> 30 -> 28 -> 30), which is the opposite sign to attenuating the wobble.  A window spanning
# several periods does not average one out — it covers phase unevenly enough to track a slower,
# larger excursion that clears the band for longer than 4 frames, so widening buys residual
# amplitude and spends it on persistence.  It also costs the guards, and short notes are the
# binding constraint exactly as predicted: 7 of 7 hold at 1.000 for widths 9 and 11 and only 3
# of 7 from 13 up, with long_clip_over_pyin_cap 1.000 -> 0.743 (n_est 99 -> 127) at 21.  9 is
# retained.  11 is the only other guard-neutral point and is not a win either: it is worth
# vibrato_rate_k20 0.667 -> 0.957 but vibrato_depth_2_0 0.400 -> 0.167, moving the 3-target mean
# only 0.498 -> 0.541.  So the two deep cases are not a smoother-width problem, and the split
# this note used to propose next — a wide contour for the band comparison, the 9-frame one for
# boundary placement — has since been measured and is REFUTED; see the estimator table under
# ``CONTOUR_RESEED_LOOKAHEAD_FRAMES``.  Ceiling pinned by
# test_depth_invariance_has_a_measured_ceiling_and_this_is_where_it_is.
#
# 3 was measured and is below the geometric minimum, exactly as predicted: mean f1
# 0.920 -> 0.730, and it breaks cases the deep ones do not (vibrato_heavy 1.000 -> 0.114).
# The cut is placed at the FIRST out-of-band frame, not where the count completes, so
# persistence costs no onset accuracy — misplacing the onset by the window width is what
# made the change-point rule unusable.
CONTOUR_PERSIST_FRAMES = 4

# Shortest run that becomes a note.  5 frames is 116 ms, matching the 100 ms
# ``minimum_note_length`` melody mode already hands Basic Pitch rather than introducing a
# second, looser opinion about how short a note can be.
CONTOUR_MIN_SEGMENT_FRAMES = 5

# How far past a completed out-of-band run to look for the contour coming BACK to the note's
# old centre before believing the cut.  This is the lead left standing under
# ``CONTOUR_FUSE_GAP_SEC``: on a cut, ``accepted`` is reseeded from the excursion's own frames,
# so a deep wobble leaves the running centre on the wobble's peak and the opposite swing is
# then a whole peak-to-peak away — outside the band again, cutting again.  A ratchet, and one
# that explains why a wider pre-smoother makes these cases worse instead of better.  A wobble
# comes back; a note change does not, so asking is what tells them apart.
#
# 2 is the measured ceiling and NOT the one predicted.  The prediction was 4, reasoned from
# ``CONTOUR_MIN_SEGMENT_FRAMES``: a genuine next note occupies at least 5 frames, so a window
# of 4 should not be able to see one return to the old pitch.  Swept 0-6, that is false — 3 and
# 4 already cost ``fast_sixteenths_c_major`` 1.000 -> 0.929 (n_est 15 -> 13) and 5 adds
# ``triplets_eighth_c_major`` 1.000 -> 0.917.  The reason is the pre-smoother: the band test
# runs on a 9-frame median, which blurs a boundary across several frames, so the contour of a
# genuinely short note transits back through the old centre well inside its own duration.  The
# emitted-length floor does not bound the window; the fastest real notes in the corpus do.
#
#   width           0      1      2      3      4      5      6
#   3 deep targets  0.498  0.517  0.613  0.613  0.567  0.567  0.650
#   13 guards       0.986  0.986  0.986  0.981  0.981  0.974  0.915
#
# So 2 is the widest guard-neutral value, and it is worth ``vibrato_rate_k20`` 0.667 -> 0.957
# (n_est 16 -> 12) and ``vibrato_depth_1_8`` 0.429 -> 0.538 (17 -> 15) for
# ``vibrato_depth_2_0`` 0.400 -> 0.345 (19 -> 18) — two of the three targets, with every guard
# and ``solfa.degree_accuracy`` bit-identical.  Note what that buys against the alternative
# already rejected under ``CONTOUR_FUSE_GAP_SEC``: a 0.80 fuse tolerance also lifted k20 to
# 0.957, but paid ``vibrato_rate_7hz`` 1.000 -> 0.952 and dropped degree_accuracy off 1.000.
# This reaches the same number and holds both.
#
# The deepest case wants a window this cannot give it.  6 is the best setting for
# ``vibrato_depth_2_0`` (0.522) and ``vibrato_depth_1_8`` (0.609) and is unusable: it takes
# ``long_clip_over_pyin_cap`` 1.000 -> 0.466 (n_est 99 -> 90) and ``vibrato_heavy`` to 0.857.
# That is the same shape the fuse sweep hit — one wobble at different rates, where every window
# wide enough to hold the deep swing together also joins notes that are merely adjacent.
#
# ── the centre ESTIMATOR, measured: the ratchet is real and is still not the lever ──────────
# Every constant above is a scalar (band, persistence, smoother width, fuse tolerance, this
# lookahead).  None of them touches the statistic the band is measured against, so that was
# measured separately, changing the estimator and nothing else.  First, the mechanism, from
# instrumenting each cut on ``vibrato_depth_2_0`` (11 reference notes, 27 frames each):
#
#   frame  seg_frames   centre    local     bias   excursion
#      25          21   59.892   62.692   -2.800      +3.000   <- genuine boundary, 60 -> 62
#      43          18   62.692   61.892   +0.800      -0.800   <- spurious
#      70          18   64.892   63.892   +1.000      -1.200   <- spurious
#      97          18   65.792   64.892   +0.900      -1.100   <- spurious
#
# The cuts alternate at 18 and 9 frames, a ratchet whose period is exactly one note, and the
# spurious ones share one shape: the segment's centre sits 0.8-1.6 SEMITONES above the true
# local centre, so the note's own trough falls out of band.  The bias is seeded at the previous
# cut, where ``accepted`` is refilled from the excursion's frames — the upward transition plus
# the peak that tripped persistence.  What makes it survive 18 frames instead of averaging out
# is feedback: the band is centred on the estimate, so only frames that CONFIRM a high centre
# are admitted to it.  A biased centre is self-confirming.
#
# That diagnosis is correct and it is still not worth acting on, because four independent ways
# to remove the bias all land in the same place.  Final segment counts, full chain (segment,
# fuse, re-articulate), against 11 reference notes on the three deep targets:
#
#                          A current   B centred   C warmup   D trailing   E all-frames
#   vibrato_depth_2_0             18           2         16           16             16
#   vibrato_depth_1_8             15           2         14           13             14
#   vibrato_rate_k20              12           1         11           12             12
#   guards paid                    —         all         2            2              3
#
#   A  current: median over the in-band frames only.
#   B  a median over [k-H, k+H] of the smoothed contour, H = 4/8/12 — the "wide contour for the
#      band comparison" this file used to name as the one remaining idea.  It is refuted in
#      PRINCIPLE, not merely unhelpful: an estimator centred on k tracks whatever the contour
#      does, a sustained step included, so ``abs(smoothed[k] - centre)`` never stays outside the
#      band and nothing is ever cut.  Every case collapses to 1-3 segments, ``diag_baseline`` and
#      ``major_c`` included.  Do not propose it again.
#   C  accept unconditionally until the centre has one period of evidence: buys the deep cases 2
#      and costs ``triplets_eighth_c_major`` 13 -> 8 and ``fast_sixteenths_c_major`` 15 -> 9, the
#      binding constraint being that 12 frames is longer than a sixteenth at 88 bpm.
#   D  causal median over the last period only: ``drift_1_semitone`` 11 -> 9, ``vibrato_rate_7hz``
#      11 -> 10.
#   E  median over EVERY frame since the segment started, in band or not — the direct fix for the
#      feedback above, and the best-motivated of the four.  It removes the bias and buys the same
#      2 notes: ``long_clip_over_pyin_cap`` 99 -> 108, ``vibrato_heavy`` 11 -> 12,
#      ``vibrato_rate_7hz`` 11 -> 10.
#
# Four estimators with different failure modes agreeing on 16 is the result worth keeping: with
# the bias removed entirely the deepest case still emits 16 notes for 11, so ~5 of its cuts were
# never about the centre.  They are genuine band violations — at 2.0 semitones PEAK the swing is
# 4.0 peak-to-peak, and a band has to be under a semitone to see a semitone step.  Under 1 and
# over 2 at once is not a value this constant or any of the others can hold, so what is left for
# the deep cases is an ADAPTIVE band, widened only on evidence of periodic modulation, which
# needs a periodicity feature rather than another threshold.  Note before spending anything on
# it that 2.0 semitones peak is already past real singing (operatic vibrato is ±0.5-1.0) and
# that this case is documented as being above the measured ceiling on purpose.
#
# **Basic Pitch's onset head is not that feature.**  It is the one signal the four estimators
# above do not exhaust — not a band, not derived from pitch, independently trained, already
# captured by ``Posteriorgram`` and already frame-aligned — so W2 proposed gating cuts on it.
# Measured over 241 cuts on the 3 target and 12 guard cases, scored by Mann-Whitney AUC (the
# statistic ``CONF_WEIGHT_AMP`` is ranked with, so 0.5 is chance):
#
#     variant                       auc  gen_min  gen_p10  spur_max  spur_med
#     A  onset_evidence           0.803    0.119    0.554     0.925     0.609
#     B  strict local max ±2      0.630    0.000    0.000     0.660     0.553
#     C  prominence over 1 period 0.756   -0.001    0.238     0.612     0.248
#     genuine n=229  spurious n=12
#
# B is the rule W2 specifies and it is the worst of the three: 56 of 229 genuine cuts have no
# strict local maximum within ±2 frames at all.  At the lowest threshold that removes even ONE
# spurious cut the genuine casualties are already A 10, B 56, C 13.
#
# The mechanism is why no variant can be tuned out of it: the onset head is excited by the same
# physical cause as the defect.  A ±2.0 semitone swing crosses semitone bins ~11 times a second,
# and ``onset_evidence`` maxes over ±1 bin precisely so vibrato still fires at its neighbours, so
# the head fires MID-NOTE exactly where the spurious cuts are (spurious median 0.609).  Meanwhile
# the corpus's weakest genuine boundaries are descending legato leaps, where nothing is re-struck:
# ``long_clip_over_pyin_cap``'s 72->67 join scores 0.119-0.213 across its nine repeats,
# ``vibrato_heavy`` 0.121, ``vibrato_rate_k15`` 0.326.  The ordering is inverted where it matters,
# so the guards break before the targets move at EVERY threshold: at t=0.416 ``vibrato_depth_2_0``
# is still 18 notes for 11 while ``long_clip_over_pyin_cap`` has gone 99 -> 22,
# ``drift_1_semitone`` 11 -> 6 and ``vibrato_rate_k20`` 12 -> 6.
#
# Two corrections to W2 fell out of measuring it, both recorded at ``settings.onset_gate``: the
# plan aims its contour half at ``_split_rearticulations``, which cuts only on an RMS valley at
# one pitch and refuses any split whose halves do not both notate as the segment's own pitch, so
# it cannot produce the shredding the plan predicts it would stop — these cuts are made upstream
# in ``_contour_segments``.  And the inference half is one ``predict`` kwarg, not a re-decode.
CONTOUR_RESEED_LOOKAHEAD_FRAMES = 2

# Two adjacent segments whose pitches round to the same integer are one note that the
# persistence rule cut at a wobble that happened to be long enough.  Fusing them is an
# exact-integer test with no tolerance, so unlike ``WOBBLE_SEMITONES`` it cannot swallow a
# genuine step — but it does swallow two genuinely REPEATED notes at one pitch, which is
# what ``_split_rearticulations`` below exists to put back.
#
# The rounding is a real weakness and replacing it was measured twice; both are failures, so
# it stays.  Rounding fails whenever two fragments of one note straddle a rounding boundary,
# which is exactly what the deep-vibrato cases do — ``vibrato_depth_2_0`` cuts a note into
# centres 62.69 and 61.89, only 0.8 apart but rounding to 63 and 62, so they survive as two
# notes.  Aligning every segment to the reference note it overlaps showed 12 such boundaries
# inside one reference note against 475 between two different ones, and none of the 475 is
# under a semitone, which looks like a clean separation and is not one:
#
#   * Fusing at ``< 1.0`` semitone instead of on ``round()`` costs notes.f1 0.954 -> 0.920 and
#     solfa.degree_accuracy 1.000 -> 0.965.  A genuine semitone step measures 1.000 only where
#     pyin's 0.2-semitone grid happens to align, as it does in ``major_c``; in the transposed
#     keys it lands just under, so a threshold AT the semitone sits on top of the boundary it
#     must not reach and 11 of the ``major_*`` cases each lose a real note.
#   * Swept below it (0.75/0.80/0.85/0.90) the 18-case key guard family holds at 1.000
#     throughout, so the cascade is avoidable — but no value is a win.  0.80 is the best of
#     them and buys ``vibrato_rate_k20`` 0.667 -> 0.957 at the price of ``vibrato_rate_7hz``
#     1.000 -> 0.952: the two are one shape at different rates, and every threshold that
#     catches one clips the other.  solfa.degree_accuracy falls from its perfect 1.000 at
#     every threshold tried, which for this product is the wrong side of the trade.
#
# The two deep-depth cases are inert at every threshold (n_est 19 -> 18 -> 17 against a
# reference 11) because their spurious boundaries span 0.600 to 1.600 semitones, i.e. straight
# through the range where the two classes overlap.  So they are not a fusion problem at all,
# and the remaining lead is upstream: ``_contour_segments`` reseeds ``accepted`` from the
# frames of the EXCURSION when it cuts, so a large wobble leaves the running centre on the
# wobble's peak, which puts the opposite swing ~0.8 semitone away and cuts again — a ratchet
# that also explains why a wider pre-smoother makes these cases worse rather than better (see
# ``CONTOUR_PERSIST_FRAMES``).  Both follow-ups that lead named have since been measured: the
# lookahead that declines such a cut is ``CONTOUR_RESEED_LOOKAHEAD_FRAMES``, and the estimator
# change that removes the bias outright is the table under it.  The ratchet is confirmed and
# closing it leaves the deep cases at 16 notes for 11 — so a bigger fuse tolerance is still not
# the answer, and neither is the centre.
CONTOUR_FUSE_GAP_SEC = 0.10

# ── Re-articulation (``_split_rearticulations``) ──────────────────────────────
# The persistence rule segments on pitch, so a repeated note is invisible to it: there is
# no pitch event at the boundary to see, and the fuse above then joins the two halves on
# purpose.  Measured cost before this stage existed, on long_clip_over_pyin_cap, whose
# phrase ends on 60 and whose next repetition starts on 60:
#
#   99 reference notes, 91 estimated, notes.f1 0.242.  Each of the 8 phrase joins fused
#   into one 1.834 s note, every later note shifted by one index, and the error accumulated
#   to +5.0 s by the end of the clip.  The pitch SEQUENCE was exactly right throughout,
#   which is why solfa.degree_accuracy read 1.000 on the notes that did match — the whole
#   defect was "where does the second one start".  Repeated notes are everywhere in real
#   music, so this was never a corpus artifact.
#
# Pitch says WHAT a note is; re-articulation says WHERE the next one starts, and that cue
# is amplitude.  ``librosa.onset.onset_strength`` was measured first and is REJECTED: it
# responds to frequency modulation, so vibrato_heavy went 11 -> 36 segments at every delta
# tried, which is the over-segmentation the persistence rule exists to prevent.  An RMS
# valley does not see vibrato at all.

# How far the RMS must dip below the smaller flanking peak to count as a note boundary.
# -6 dB: the amplitude halves between the two notes.  Not fitted — 0.40 through 0.85 give
# byte-identical segment counts on all 19 guard cases AND on all four repeat cases except
# repeated sixteenths, so the constant is picked for what a real articulation gap looks
# like rather than for the corpus.  Deliberately on the conservative side of that flat
# region: the corpus's sustains are synthetically flat, and a legato real note ripples.
CONTOUR_REARTICULATION_FRAC = 0.50

# Half-width, in frames, of the neighbourhood a dip must be the minimum of.  RMS at a
# 23.2 ms hop is noisy enough that comparing a frame against its two immediate neighbours
# accepts any single-frame wobble as a "valley"; +-3 frames is 70 ms either side, shorter
# than any notatable note and long enough to reject frame noise.
CONTOUR_VALLEY_WIDTH_FRAMES = 3

# Confidence blend: Basic Pitch's note amplitude, corrected by its onset posterior.
#
#   conf = (W_AMP * amp + W_ONSET * onset_post) / (W_AMP + W_ONSET)
#
# ── the blend this replaced, and why the terms it used are gone ──────────────
# The previous form scaled a pyin/Basic-Pitch agreement term by voiced_prob:
#
#   conf = (W_AMP * amp + (W_AGREE_MAX * voiced_prob) * agreement)
#          / (W_AMP    + (W_AGREE_MAX * voiced_prob))
#
# That was the right choice given the terms available when it was swept — amp and
# agreement were the only two, agreement is below chance as an additive signal
# (voiced-only auc 0.463), and making voiced_prob a reliability scaler rescued it.  The
# posterior capture added a third term, and re-measuring all of them on the five corpus
# cases that produce BOTH a correct and a wrong note — the only cases conf.auc can see —
# ranked them per-case:
#
#   amp 0.765   onset 0.629   frame_cover 0.454   agreement 0.448   voiced_prob 0.357
#
# Three of the four are at or below chance.  Both are STRICTLY dominated, improving auc
# and separation together when removed, so this is not a trade:
#
#   shipped 2-term (amp + agree*vprob)   auc 0.614  sep 0.012
#   4-term (+ onset + frame)             auc 0.611  sep 0.092
#   3-term, frame dropped                auc 0.731  sep 0.101
#   2-term, agreement dropped too        auc 0.843  sep 0.173
#
# The frame term cannot be rescued by redefinition: mean-over-span, mean-over-first-8-
# frames, max-over-span and fraction-above-frame-threshold score 0.451, 0.292, 0.365 and
# 0.454.  It is dropped rather than reweighted.  Do not re-add a frame-posterior
# confidence term without new evidence — the sustained-vibrato cases are why it fails, and
# they need fixing upstream (see _split_rearticulations).
#
# ── why 2 : 1.5 ─────────────────────────────────────────────────────────────
# auc across the onset weight is a broad plateau, which is what makes the pick defensible
# on 5 cases rather than fitted to them — a 6x range of weights all clear the gate:
#
#   w_onset   0.0    0.25   0.5    0.75   1.0    1.5    2.0    3.0    5.0
#   auc       0.765  0.881  0.888  0.891  0.888  0.876  0.859  0.843  0.790
#   sep       0.051  0.073  0.091  0.106  0.118  0.138  0.152  0.173  0.196
#   bad_high  0.920  0.920  0.960  0.960  0.920  0.640  0.640  0.600  0.480
#   ok_high   1.000  1.000  1.000  1.000  0.976  0.976  0.952  0.929  0.905
#
# 1.5 rather than the 0.75 auc peak because bad_high — the fraction of WRONG notes the
# client colours "High confidence" at >= 0.75 — collapses 0.960 -> 0.640 there while auc
# gives up 0.015 and ok_high gives up 0.024.  Below 1.5 the blend is no better than bare
# amplitude on that column; above it, auc and ok_high both fall for little more gain.
#
# Not decided on bad_low, the fraction of wrong notes falling under the 0.5 cut that
# actually drives the client's review list: it is 0.000 for EVERY candidate above,
# including both shipped blends.  No weighting flags a wrong note for review, because
# every term is a posterior in the 0.6-1.0 range and a weighted mean of them cannot reach
# 0.5.  That is a defect in the scale rather than the ranking, and fixing it means moving
# the client's cut or calibrating conf against the corpus — not choosing other weights.
CONF_WEIGHT_AMP = 2.0
CONF_WEIGHT_ONSET = 1.5

# music21 flat letter → "b" convention expected by C#'s KeyParser.
_M21_FLAT_MAP: dict[str, str] = {
    "A-": "Ab",
    "B-": "Bb",
    "C-": "Cb",
    "D-": "Db",
    "E-": "Eb",
    "F-": "Fb",
    "G-": "Gb",
}


# ── Audio preview synthesis ───────────────────────────────────────────────────


def _smooth_ramp(n: int, start: float, end: float) -> "np.ndarray":
    """A raised-cosine ramp from *start* to *end* over *n* samples.

    Slope is zero at both ends, unlike ``np.linspace``, so an envelope built from
    these has no corner anywhere for the ear to hear as a click.
    """
    return start + (end - start) * (
        0.5 - 0.5 * np.cos(np.pi * np.linspace(0.0, 1.0, n))
    )


def _string_decay_sec(pitch_midi: int) -> float:
    """Body decay time constant for a note, in seconds.

    Doubles every two octaves *down* from middle C, so C4 rings for
    ``_STRING_DECAY_SEC_C4``, C6 for a quarter as long and C2 for four times as long,
    clamped to a sane band. A real piano's bass strings are longer, heavier and less
    damped than its treble ones; using one constant for the whole compass makes low
    notes sound cut off and high notes sound like a struck bell.
    """
    scaled = _STRING_DECAY_SEC_C4 * 2.0 ** ((60 - pitch_midi) / 24.0)
    return float(min(max(scaled, _STRING_DECAY_MIN_SEC), _STRING_DECAY_MAX_SEC))


def _body_rolloff(pitch_midi: int) -> float:
    """Spectral roll-off exponent for a note's register.

    Flatter in the bass, steeper in the treble: the hammer is wide relative to a
    short treble string and narrow relative to a long bass one, so bass notes carry
    audible energy much further up the partial series than treble ones do. Mirrors
    ``bodyRolloff`` in ``mobile/src/lib/synth.ts``.
    """
    tilted = _BODY_ROLLOFF_C4 + (pitch_midi - 60) * _ROLLOFF_TILT
    return float(min(max(tilted, _ROLLOFF_MIN), _ROLLOFF_MAX))


def _synthesize_audio_preview(
    notes: "list[TranscribedNote]",
    tempo_bpm: int,
    sr: int = PREVIEW_SAMPLE_RATE,
) -> str:
    """Synthesise a WAV audio preview of the note sequence and return it as a
    base64 string.

    Only ``numpy`` and ``soundfile`` are required — both are already in the
    production ``requirements.txt`` — so this runs without any system-level
    audio library (FluidSynth, ffmpeg, …).

    Voice model
    ───────────
    A softly-struck piano, built as a struck string rather than as a harmonic stack:

      • Spectrum: up to ``_MAX_PARTIALS`` partials, each weighted by the hammer's
        strike-position node pattern ``|sin(k·pi·x)|``, rolled off by ``k^-rolloff``
        with the exponent tilted by register, and tilted again by a two-pole
        brightness ceiling. Partial k is stretched sharp by ``(1 + B·k²)``.
      • Hammer: a second, brighter partial stack decaying with a 14 ms time
        constant, truncated at ten time constants — the strike transient.
      • Damping: partial k decays with ``tau0/(1 + _DAMP_K·k^_DAMP_EXP)``, so the
        tone darkens as it rings without collapsing onto its fundamental.
      • Double decay: each partial is a mixture of that time constant and one
        ``_TAIL_FACTOR`` times longer — the two polarisations of string motion.
      • Unison: a slow ``(1 + depth·cos)`` amplitude beat per partial, with the
        depth ramping in over the first few partials.
      • Attack : raised-cosine ramp-up over ``_ATTACK_SEC``, so there is no click.
      • Release: raised-cosine fade over ``_RELEASE_SEC`` *past* the notated end —
        the damper landing after note-off, so each note rings on into the next the
        way a real one does. Every note is therefore rendered ``_RELEASE_SEC``
        longer than it is notated, and overlaps are left to the limiter below.

    Each note is then normalised to ``_PEAK_TARGET`` rather than divided by a sum of
    weights: the partial phases do not align, so an analytic ceiling sits far above
    the real peak and using it leaves every note quiet.

    ``mobile/src/lib/synth.ts`` renders the same voice with the same constants, and
    the two must stay in lock-step: the mobile one replaces this preview as soon as
    the user edits a note, so any divergence is audible as the timbre changing
    underfoot. The one deliberate difference is arithmetic, not sound — this side
    uses closed-form ``np.exp``/``np.sin`` over whole arrays, while the mobile side
    advances complex rotations and geometric envelopes sample by sample, because
    vectorised numpy has no per-sample call overhead to avoid and JS does. The two
    agree to within the last ULP.

    The confidence score of each note is used as a per-note velocity scaler so
    low-confidence notes are softer than high-confidence ones.

    Starting phases are derived from each note's pitch and partial index, so they
    are deterministic — identical input always produces identical bytes — while
    still avoiding every partial starting at the same zero crossing. The mix is
    then soft-limited through ``tanh`` rather than divided by its peak, and encoded
    as signed 16-bit PCM WAV.

    Parameters
    ----------
    notes:
        The ``TranscribedNote`` list from the transcription result.  Expected
        fields: ``pitch_midi``, ``start_beat``, ``dur_beats``, ``conf``.
    tempo_bpm:
        Tempo in beats per minute; used to convert beat positions to seconds.
    sr:
        Output sample rate (default: 22 050 Hz).

    Returns
    -------
    str
        Base64-encoded WAV bytes, or ``""`` if *notes* is empty.
    """
    if not notes:
        return ""

    import io

    import soundfile as sf

    # Floored at 30 BPM, matching `beatSecOf` in mobile/src/lib/synth.ts. The two
    # used to floor at 20 and 30 respectively, which put the whole grid in a
    # different place on either side for any clip the tempo estimator read below 30.
    beat_sec = 60.0 / max(float(tempo_bpm), 30.0)  # seconds per beat

    # Total length = end of the last note + the ring-out past it. One constant does
    # both jobs, and deliberately so: the padding exists to hold the release, so any
    # other value either clips the last note's decay or leaves silence after it.
    # Rounded up, matching `Math.ceil` in mobile/src/lib/synth.ts — truncating here
    # made every clip exactly one sample shorter than the mobile render of the same
    # notes, which is inaudible but is still the two tiers disagreeing.
    max_end_sec = max(n.start_beat * beat_sec + n.dur_beats * beat_sec for n in notes)
    tail_samp = int(round(_RELEASE_SEC * sr))
    total_samples = int(np.ceil((max_end_sec + _RELEASE_SEC) * sr))
    audio = np.zeros(total_samples, dtype=np.float64)

    nyquist = 0.5 * sr
    partial_floor = 10.0 ** (_PARTIAL_FLOOR_DB / 20.0)

    for n in notes:
        freq = 440.0 * 2.0 ** ((n.pitch_midi - 69) / 12.0)
        start_samp = int(n.start_beat * beat_sec * sr)
        dur_samp = max(int(n.dur_beats * beat_sec * sr), int(0.04 * sr))
        # The ring-out belongs to the note, so it is rendered and mixed as part of it
        # and lands on top of whatever comes next.
        end_samp = min(start_samp + dur_samp + tail_samp, total_samples)
        actual = end_samp - start_samp
        if actual <= 0:
            continue

        t = np.arange(actual, dtype=np.float64) / sr
        tau0 = _string_decay_sec(n.pitch_midi)
        rolloff = _body_rolloff(n.pitch_midi)
        unison = n.pitch_midi >= _UNISON_MIN_MIDI
        detune_hz = freq * (2.0 ** (_DETUNE_CENTS / 1200.0) - 1.0)

        # Lay the partials out first, so the audibility gate is relative to the
        # loudest of them rather than to an assumed k=1.
        layout: "list[tuple[int, float, float, float]]" = []
        loudest = 0.0
        for k in range(1, _MAX_PARTIALS + 1):
            f_k = freq * k * (1.0 + _INHARMONICITY * k * k)
            if f_k >= nyquist:
                break
            node = abs(np.sin(k * np.pi * _STRIKE_POS))
            # Two-pole brightness tilt: unity well below the ceiling, -6 dB at it,
            # and 12 dB per octave above it rather than 6.
            tilt = 1.0 / (1.0 + (f_k / _BRIGHT_CEILING_HZ) ** 2) ** 2
            body_amp = float(node * tilt) / k**rolloff
            strike_amp = float(_STRIKE_GAIN * node * tilt) / k**_STRIKE_ROLLOFF
            layout.append((k, f_k, body_amp, strike_amp))
            loudest = max(loudest, body_amp + strike_amp)
        floor = loudest * partial_floor

        # The strike is truncated rather than run for the whole note, matching the
        # mobile side sample for sample.
        strike_n = min(actual, int(np.ceil(_STRIKE_SPAN_SEC * sr)))
        t_strike = t[:strike_n]
        strike_env = np.exp(-t_strike / _STRIKE_TAU_SEC)

        # Additive synthesis. Each partial gets its own starting phase and its own
        # decay rate. The phases come from the pitch and the partial index rather
        # than from a random draw, so the same notes always render to the same bytes.
        # Deliberately *not* varied per note: two fragments of the same pitch then
        # stay in phase and reinforce, where a per-note offset would let them cancel
        # — and it is the limiter below, not phase scattering, that handles overlaps.
        tone = np.zeros(actual, dtype=np.float64)
        for k, f_k, body_amp, strike_amp in layout:
            if body_amp + strike_amp < floor:
                continue
            phase = 2.0 * np.pi * (
                (n.pitch_midi * 0.5698402909 + k * 0.6180339887) % 1.0
            )
            wave = np.sin(2.0 * np.pi * f_k * t + phase)

            tau_k = tau0 / (1.0 + _DAMP_K * k**_DAMP_EXP)
            body = body_amp * (
                (1.0 - _TAIL_MIX) * np.exp(-t / tau_k)
                + _TAIL_MIX * np.exp(-t / (tau_k * _TAIL_FACTOR))
            )
            if unison:
                depth = _UNISON_DEPTH * min(1.0, k / _UNISON_KNEE)
                body *= 1.0 + depth * np.cos(2.0 * np.pi * k * detune_hz * t)
            tone += body * wave

            # A 15 ms transient cannot beat, so the strike carries no unison term.
            if strike_amp >= floor:
                tone[:strike_n] += strike_amp * strike_env * wave[:strike_n]

        # Attack and release only: the body decay is per-partial, inside the loop
        # above. The ramps are raised-cosine, not linear — a linear ramp has a corner
        # at each end, and over a 5 ms attack that corner is audible as a click on
        # every single note.
        atk = min(int(_ATTACK_SEC * sr), actual // 4)
        # The fade *is* the tail, so it begins at note-off instead of ending there.
        # The `min` bites only on the last note of a clip, whose tail the buffer may
        # have cut short; fading what is left still lands the clip on zero.
        rel = min(tail_samp, actual)
        if atk > 0:
            tone[:atk] *= _smooth_ramp(atk, 0.0, 1.0)
        if rel > 0:
            tone[-rel:] *= _smooth_ramp(rel, 1.0, 0.0)

        # Normalise per note rather than by a sum of weights: the partial phases do
        # not align, so the analytic ceiling is far above the real peak and using it
        # would leave every note quiet. A real piano is near equal-loudness across
        # its compass anyway, so this is also the right voicing.
        peak = float(np.max(np.abs(tone)))
        if peak > 0.0:
            tone *= _PEAK_TARGET / peak

        # Velocity from confidence. Narrower than the old 0.4-1.0: soft-piano dynamics
        # live in a tighter band, and conf is a noisy number today (see the
        # ADAPTIVE_FACTOR note above — conf.auc is 0.551), so a low value must not be
        # able to render a real note near-inaudible.
        velocity = 0.55 + 0.35 * float(n.conf)
        audio[start_samp:end_samp] += tone * velocity

    # Soft-limit instead of rescaling by the peak. The old code divided the whole
    # mix by its loudest sample, so a single pile-up of overlapping notes — exactly
    # what the ghost-note fragments produce — scaled the *entire* preview down and
    # left everything else close to inaudible. tanh is bounded by 1.0 for any input,
    # so overlaps compress into the headroom they need and every other note keeps
    # the level it was rendered at. A solo note peaks at tanh(1) ≈ 0.76.
    audio = np.tanh(audio)

    # Encode as signed 16-bit PCM WAV via soundfile
    buf = io.BytesIO()
    sf.write(buf, audio.astype(np.float32), sr, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("ascii")


# ── Domain types ──────────────────────────────────────────────────────────────


@dataclass
class TranscribedNote:
    pitch_midi: int
    start_beat: float
    dur_beats: float
    degree: int
    solfa: str
    octave_mark: str
    conf: float


@dataclass
class TranscriptionResult:
    key: str
    key_confidence: float
    tempo: int
    time_signature: str
    musicxml: str
    midi_base64: str
    notes: list[TranscribedNote] = field(default_factory=list)
    solfa_lines: list[str] = field(default_factory=list)
    overall_confidence: float = 0.0
    # Base64-encoded 16-bit PCM WAV synthesised from the note list.
    # Empty string when synthesis is skipped (e.g. no notes survived).
    audio_preview_base64: str = ""
    # False when the pyin stage contributed no evidence to this clip's pitches, which
    # is a materially worse transcription rather than a cosmetic difference: with
    # ``pyin_semitone`` dark, solfa.chromatic_ghosts more than doubles (1.526 -> 3.526
    # on the corpus) and it is the ghost accidentals that grow.  Three causes collapse
    # into it — the clip exceeded ``pyin_max_seconds``, the decode failed, or no frame
    # was voiced — and clients want the same caveat for all three, so the field
    # reports the outcome rather than the reason.  See ``config.pyin_max_seconds``.
    pitch_refined: bool = True
    chromatic_spelling: str = "direction"


# ── Key name helpers ──────────────────────────────────────────────────────────


def _normalise_key_name(name: str) -> str:
    """Convert a music21 key name to the form C#'s KeyParser accepts.

    Two transformations are applied:
      1. Capitalise the tonic letter — music21 returns lowercase tonics for
         minor keys ("a minor", "f# minor") which look odd in the UI and must
         be uppercase for KeyParser ("A minor", "F# minor").
      2. Replace music21's internal flat marker "-" with "b" — music21 uses
         "B- major", "E- minor" etc.; KeyParser (and the mobile) expect "Bb",
         "Eb".  Without this, re-keying a Bb-major transcription from the
         library sent "B- major" to C# and received HTTP 422.

    Examples
    --------
    "B- major" → "Bb major"
    "e- minor" → "Eb minor"
    "a minor"  → "A minor"
    "F# major" → "F# major"  (unchanged)
    """
    parts = name.strip().split(None, 1)
    if not parts:
        # Empty or whitespace-only: return "" rather than echoing the blanks
        # back, mirroring C# KeyParser.Parse, which folds both into the same
        # IsNullOrWhiteSpace branch.
        return ""

    raw_tonic = parts[0]
    mode_str = parts[1].strip().lower() if len(parts) > 1 else ""

    # Rebuild the tonic letter by letter, uppercasing the root and
    # substituting "-" (music21 flat) with "b" (standard notation).
    tonic_letter = raw_tonic[0].upper()
    accidentals = ""
    for ch in raw_tonic[1:]:
        if ch == "-":
            accidentals += "b"
        elif ch in "#♯":
            accidentals += "#"
        else:
            accidentals += ch  # pass through anything unexpected unchanged

    tonic = tonic_letter + accidentals
    return f"{tonic} {mode_str}".strip() if mode_str else tonic


def _parse_key_override(text: str | None):
    """Parse a user/ML key string into a music21 Key.

    Accepts a note letter A–G, optional stackable accidentals (#/♯/b/♭/-,
    which cancel each other), and an optional mode word (major/maj or
    minor/min/m).  Mirrors C#'s KeyParser exactly — including the "-" flat
    marker — so the override path never diverges from the client's labelling
    (a wrong parse silently mislabels the whole piece — TRD par. 4.1).
    """
    from music21 import key as m21key

    if not text or not text.strip():
        raise ValueError("Empty key override.")
    raw = text.strip()

    lowered = raw.lower()
    mode, body = "major", raw
    for suffix, resolved in (
        ("minor", "minor"),
        ("major", "major"),
        ("min", "minor"),
        ("maj", "major"),
        ("m", "minor"),
    ):
        if lowered.endswith(suffix) and len(raw) > len(suffix):
            mode, body = resolved, raw[: len(raw) - len(suffix)]
            break
    body = body.strip()

    letter = body[:1].upper()
    if letter not in "ABCDEFG":
        raise ValueError(f"Unparseable key override: {text!r}")

    accidental = 0
    for ch in body[1:]:
        if ch in "#♯":
            accidental += 1
        elif ch in "b♭-":  # accept music21's "-" here too for round-trips
            accidental -= 1
        else:
            raise ValueError(f"Unparseable key override: {text!r}")

    tonic = letter + ("#" * accidental if accidental >= 0 else "-" * -accidental)
    return m21key.Key(tonic, mode)


# ── Key detection ensemble (defects 3, 4) ─────────────────────────────────────

# The profiles voted over, in no significant order — each is weighted equally.
#
# music21's own documentation gives each of these a *different* known bias, and that
# is the entire mechanism here: averaging estimators whose errors point in different
# directions cancels those errors, while averaging one estimator with itself does
# nothing.  AardenEssen leans on the subdominant, KrumhanslSchmuckler on the
# dominant, TemperleyKostkaPayne toward the relative major in minor keys, and
# SimpleWeights is noisiest on short excerpts.  Those pull four different ways.
#
# Weights are deliberately equal rather than hand-tuned.  Any per-profile weighting
# would have to be fitted on the 38-case synthetic corpus, which would tune the
# constants to this corpus's quirks rather than to key detection — and the measured
# result does not need it.  BellmanBudge is *not* trusted above the others despite
# music21 describing it as the least biased: on a plain C-major stream it agrees
# with AardenEssen on the wrong answer (F major) while three others get it right,
# which is exactly the kind of assumption an equal vote is robust to.
KEY_PROFILE_NAMES = (
    "AardenEssen",
    "BellmanBudge",
    "KrumhanslSchmuckler",
    "SimpleWeights",
    "TemperleyKostkaPayne",
)

# Mean-z lead over the runner-up at which the vote is treated as fully confident.
#
# Calibrated against the mobile's own cut points, which are what this number is *for*:
# theme.ts labels below 0.5 "Low confidence" and ResultScreen counts those in its
# re-record hint, so the property that matters is "every wrong key lands under 0.5".
# That property held on the 31-case corpus and DOES NOT hold now.  Broadening the
# vibrato axis from one point to seven (corpus.py VIBRATO_BREADTH_CASES) took the
# wrong-key count 4 -> 9, and one of the new cases clears the cut: vibrato_rate_k155
# reads C major as E minor at 0.631, so the editable-key prompt stays silent on a
# wrong key.  Measured over the 38-case corpus at this value:
#
#      9 wrong keys    0.023 - 0.631   eight under the cut, k155 the one above
#     29 correct keys  23 at or above 0.75; two under 0.5
#                      (triplets_eighth 0.235, fast_sixteenths 0.420)
#
# Rescaling was evaluated and rejected rather than left open.  Pushing k155 under 0.5
# needs this constant above 0.947, and at 0.95 four currently-correct cases cross the
# cut the other way: drift_1_semitone 0.526 -> 0.415, vibrato_depth_0_8 0.541 -> 0.427,
# semitone_steps 0.618 -> 0.488, lead_in_800ms 0.626 -> 0.494.  Trading one false
# negative for four false prompts is a bad trade on its own, and vibrato_depth_0_8
# makes it indefensible: that case scores notes.f1 1.000 and degree 1.000, so the
# prompt would be asking for a re-record of a clip that transcribed perfectly.
#
# So the constant stays and the defect is recorded upstream of it.  The margin is
# reporting profile agreement honestly; the profiles agree on garbage, because k155's
# note list is 24 events for 11 real ones and the duration-weighted histogram all five
# of them read is vibrato fragments.  key.confidence_auc is still 0.966, so the
# *ranking* is largely intact — it is this absolute cut that was fitted against a
# corpus holding a single vibrato point.  Fix the notes (the vibrato post-mortems in
# corpus.py) and the calibration follows.
#
# A scale constant, not a threshold — no decision is taken on it, so a mis-set value
# costs calibration rather than correctness.
KEY_MARGIN_FULL = 0.75


def _profile_z_scores(profile, s) -> dict[tuple[int, str], float]:
    """One profile's opinion of all 24 keys, standardised to mean 0 / sd 1.

    Raw ``correlationCoefficient`` values are *not* comparable between profiles —
    each has its own scale and spread, so summing them across profiles would weight
    whichever profile happens to report the largest numbers most heavily, which is a
    weighting nobody chose.  Standardising within a profile first makes the sum an
    average of *opinions* rather than an average of magnitudes.

    Keys are ``(tonic pitch class, mode)`` because that is the identity solfa cares
    about; enharmonic spellings of one key must not split the vote.
    """
    solution = profile.getSolution(s)
    candidates = [solution, *(solution.alternateInterpretations or [])]

    scored: list[tuple[tuple[int, str], float]] = []
    for candidate in candidates:
        cc = float(getattr(candidate, "correlationCoefficient", float("nan")))
        if np.isnan(cc):
            continue
        scored.append(((candidate.tonic.pitchClass, candidate.mode), cc))
    if not scored:
        return {}

    values = np.array([cc for _, cc in scored], dtype=float)
    spread = float(values.std())
    if spread <= 0.0:  # a profile with no opinion at all must not dominate the sum
        return {}
    centre = float(values.mean())
    return {ident: (cc - centre) / spread for ident, cc in scored}


# The pitch classes a key's own music lives on, relative to the tonic.
#
# Minor takes the union of natural, harmonic and melodic minor rather than natural minor
# alone.  The raised 6th and 7th belong to the same key, so scoring A minor against natural
# minor would penalise it for its own G# and make the parsimony cue below argue against the
# right answer on every harmonic-minor clip in the corpus.
_MAJOR_SCALE = frozenset({0, 2, 4, 5, 7, 9, 11})
_MINOR_SCALE = frozenset({0, 2, 3, 5, 7, 8, 9, 10, 11})


def _tonal_cues(s):
    """``(final pitch class, duration weight per pitch class, total weight)`` for a stream.

    Both structural cues used by ``_cadence_prefers_runner_up`` read off this single pass.
    Returns ``None`` for a stream with nothing in it — the same "no opinion" answer
    ``_profile_z_scores`` gives, and the tiebreak then declines rather than guessing.
    """
    notes = list(s.flatten().notes)
    if not notes:
        return None

    weights: dict[int, float] = {}
    for n in notes:
        pc = n.pitch.pitchClass
        weights[pc] = weights.get(pc, 0.0) + float(n.duration.quarterLength)

    total = sum(weights.values())
    if total <= 0.0:
        return None
    return notes[-1].pitch.pitchClass, weights, total


def _diatonic_fraction(tonic_pc: int, mode: str, weights: dict[int, float], total: float) -> float:
    """How much of a clip's *duration* falls inside one candidate key's own scale.

    This is precisely a subdominant detector.  Reading a C-major melody as F major turns
    every B natural into an accidental, so the wrong key spends duration outside its own
    scale while the right one spends none: measured on ``plagal_fourth_c_major``, F major
    scores 0.960 against C major's 1.000.
    """
    scale = _MAJOR_SCALE if mode == "major" else _MINOR_SCALE
    inside = sum(w for pc, w in weights.items() if (pc - tonic_pc) % 12 in scale)
    return inside / total


def _is_fifth_or_parallel(a: tuple[int, str], b: tuple[int, str]) -> bool:
    """Are two key identities a fifth apart, or the same tonic in opposite modes?

    Relatives are deliberately excluded.  A relative confusion is *exactly* solfa-neutral —
    la-based minor gives A minor and C major the same doh, so every syllable, degree and
    accidental is identical and only the displayed key string is wrong (``metrics.py``
    ``key_metrics`` carries the measurement).  Overturning one buys no accuracy and widens
    what this tiebreak is allowed to touch, which is the whole risk here.
    """
    interval = (b[0] - a[0]) % 12
    if a[1] == b[1]:
        return interval in (5, 7)
    return interval == 0


def _cadence_prefers_runner_up(s, winner, runner_up, margin: float) -> bool:
    """Should the vote's runner-up be preferred, on structural grounds the profiles ignore?

    The pitch profiles are histograms: they weigh *how much* of each pitch class a clip
    holds and know nothing about where a note sits in the phrase.  That is exactly how
    ``plagal_fourth_c_major`` goes wrong — a sustained 4th carries 4 of its 12 beats, so
    F major out-correlates C major (z 1.989 to 1.560) on a clip that begins and ends on C
    and contains a B natural.  A wrong tonic re-labels every syllable in the clip, and that
    case measures ``solfa.degree_accuracy`` 0.000 on ``notes.f1`` 0.846: the notes are heard
    correctly and mislabelled wholesale.  It is the most expensive failure in the pipeline.

    Four conditions must all hold, and each one is a restriction rather than a tuned score:

    ``margin < KEY_MARGIN_FULL``
        Only where the profiles did not fully decide.  Reuses the existing calibrated
        constant rather than introducing another, and no corpus case sits near it: the
        thin-margin fifth pairs run 0.160-0.564 and the confident ones 0.625-0.827.

    the pair is a fifth or a parallel
        Never a relative (see ``_is_fifth_or_parallel``), and never an unrelated key.

    the runner-up ends on its own tonic and the winner does not
        The cue, and the reason it is the *final* note rather than the first.  Measured over
        the corpus, "starts on doh/mi/soh" excludes only 2 of the 5 wrong answers — the
        tonic triad is closed under precisely the fifth and minor-third slips that cause the
        confusions — while ending on the tonic excludes 4 of 5.  It has to be the tonic
        itself and not the triad: on ``plagal_fourth_c_major`` the final C is a triad member
        of F major too, so the triad form of this cue does not discriminate at all.

    the runner-up is *strictly* more diatonic
        ``_diatonic_fraction`` must be strictly greater, not merely equal, which is what
        blocks the obvious false positive: a melody in C that closes on a half cadence at G
        would otherwise read as G major on the cue above.  Any such clip that contains its
        own 4th scores C higher; one that does not contain it scores the two equal, and a
        tie declines.

    Together these fire on exactly one of the 38 corpus cases — the one they were reasoned
    about — and change nothing on the other 37.  Read that as the control it is rather than
    as a hit rate.  Counted by whichever condition refuses first, the 37 break down as 21
    whose winner already ends on its own tonic, 10 whose runner-up is not a fifth or a
    parallel, 4 where neither reading ends on its tonic, and 2 the margin rail excludes: the
    cue is silent by construction on nearly every clip, not silent by luck.
    """
    if margin >= KEY_MARGIN_FULL or not _is_fifth_or_parallel(winner, runner_up):
        return False

    cues = _tonal_cues(s)
    if cues is None:
        return False
    final_pc, weights, total = cues

    if final_pc != runner_up[0] or final_pc == winner[0]:
        return False
    return _diatonic_fraction(*runner_up, weights, total) > _diatonic_fraction(
        *winner, weights, total
    )


def _key_confidence_from_margin(margin: float, n_events: int) -> float:
    """Turn the winner's lead over the runner-up into a 0-1 confidence.

    The defect this replaces: ``correlationCoefficient`` measures how well the clip
    fits the winning profile, not whether the *runner-up* fits just as well.  It
    therefore sits high on precisely the cases that need a human — measured over the
    corpus at 0.795 mean with no threshold separating right from wrong answers at all
    (the least confident correct answer scored below the most confident wrong one).
    A margin cannot do that: it is low exactly when two keys are hard to tell apart,
    which is the condition the mobile's editable-key prompt exists for.  Measured over
    the corpus the change moves mean(correct) - max(wrong) from -0.021 to +0.340 and
    scores 0.926 AUC over the right x wrong pairs.
    """
    confidence = max(0.0, min(1.0, margin / KEY_MARGIN_FULL))
    if n_events < MIN_NOTES_FOR_KEY:
        # Unchanged short-clip policy: too few pitch classes for any profile to be
        # reliable, whatever the margin says.
        confidence = min(confidence, KEY_CONFIDENCE_CAP_LOW)
    return confidence


def _detect_key(s, n_events: int):
    """(key, confidence) for a stream, by equal vote over KEY_PROFILE_NAMES.

    A close vote between a key and its fifth or its parallel is then re-decided on the
    phrase's own shape rather than its histogram — see ``_cadence_prefers_runner_up``.

    Falls back to music21's single-profile default if the ensemble cannot run.  That
    is not hypothetical: any clip with a *uniform* pitch-class histogram gives every
    profile a zero correlation spread, so all five return nothing and ``voted`` is 0.
    A chromatic run does it exactly — measured on the pinned music21 10.5.0, all five
    profiles decline and the raw coefficient is 0.0, so the fallback emits confidence
    0.0 and the mobile's editable-key prompt fires.  That is the safe direction: the
    fallback is the pre-existing behaviour, so a failure here can only lose the
    improvement, not the transcription.
    """
    from music21.analysis import discrete

    totals: dict[tuple[int, str], float] = {}
    exemplars: dict[tuple[int, str], object] = {}
    voted = 0

    for name in KEY_PROFILE_NAMES:
        profile_cls = getattr(discrete, name, None)
        if profile_cls is None:
            continue
        try:
            z_scores = _profile_z_scores(profile_cls(), s)
        except Exception as exc:  # noqa: BLE001 — one bad profile must not lose the vote
            print(f"[notefusion] key profile {name} failed ({exc}); skipping it", flush=True)
            continue
        if not z_scores:
            continue
        voted += 1
        for ident, z in z_scores.items():
            totals[ident] = totals.get(ident, 0.0) + z

    if voted == 0 or len(totals) < 2:
        detected = s.analyze("key")
        cc = float(detected.correlationCoefficient)
        confidence = 0.0 if np.isnan(cc) else max(0.0, min(1.0, cc))
        if n_events < MIN_NOTES_FOR_KEY:
            confidence = min(confidence, KEY_CONFIDENCE_CAP_LOW)
        return detected, confidence

    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    winner_ident, winner_score = ranked[0]
    runner_up_ident, runner_up_score = ranked[1]
    # Divided by the number of voters so the margin means the same thing whether all
    # five profiles ran or only three did.
    margin = (winner_score - runner_up_score) / voted

    # A histogram cannot see a cadence.  Where the vote was close and the two readings are
    # a fifth or a parallel apart, the phrase's own shape gets to decide — see
    # _cadence_prefers_runner_up for why it is restricted this narrowly.
    if _cadence_prefers_runner_up(s, winner_ident, runner_up_ident, margin):
        winner_ident = runner_up_ident

    # The margin is *not* recomputed or negated after a swap.  It measures how close the two
    # readings were, which is the right uncertainty to report whichever one was picked, and
    # it is the number the mobile's editable-key prompt is calibrated against.
    winner = _key_from_identity(*winner_ident)
    return winner, _key_confidence_from_margin(margin, n_events)


def _key_from_identity(pitch_class: int, mode: str):
    """Build a music21 Key from (pitch class, mode), spelled the way solfa expects.

    Sharp spellings for the pitch classes that have one in common use, flats
    otherwise — the same convention ``_normalise_key_name`` already emits, so the
    wire value is unchanged by this function's existence.
    """
    from music21 import key as m21key

    names = ["C", "C#", "D", "E-", "E", "F", "F#", "G", "A-", "A", "B-", "B"]
    return m21key.Key(names[pitch_class % 12], mode)


# Pitch classes that have a plain letter name.  The seven white keys, and the anchor
# for every spelling decision below.
_NATURAL_NAMES = {0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B"}


def _key_spelling(k) -> dict[int, str]:
    """Pitch class -> note name, spelled the way *k*'s key signature implies.

    music21 spells a pitch built from a bare MIDI integer off a fixed table —
    ``C C# D E- E F F# G G# A B- B`` — which is key-blind, and that is the whole
    defect.  In E major, MIDI 75 is a *diatonic* tone of the key (the signature holds
    F# C# G# D#), so it must print as D# with no accidental sign at all; the fixed
    table calls it E-flat and engraves a flat.  In A-flat major MIDI 68 comes out G#
    where the key says A-, and in F# major MIDI 77 comes out F where the key says E#.

    Three rules, in order:

    1. The seven diatonic degrees take their spelling from the signature itself.
       Start from the naturals, vacate every letter the signature alters, and only then
       file the altered spellings, so E major's D is replaced by D# and B-flat major's B
       by B-.  The two passes are not interchangeable with one — see the comment below.
    2. A minor key adds its raised 7th, because a leading tone is ordinary rather than
       exotic: D minor's pitch class 1 is C#, never D-flat, even though D minor is a
       flat key.  (The raised *6th* needs no rule — melodic minor's is a natural.)
    3. Whatever is left follows the key's own direction: a natural if the pitch class
       has a letter name the signature did not claim (C natural in E major), otherwise
       a sharp in sharp keys and a flat in flat keys.

    Measured over eight scale cases in seven keys, the map takes the printed accidentals
    from 44 to 5, and all 5 that remain are real: three chromatic notes in a C major
    chromatic run, and the raised leading tones of D minor and G minor.

    Two spellings are deliberately the readable answer rather than the theoretical one,
    both in the chromatic remainder where the pitch is right and only the letter is
    arguable.  C-sharp minor's raised 7th is strictly B-sharp and G-sharp minor's is
    F-double-sharp; this returns C and G.  D minor's pitch class 6 comes back G-flat by
    the flat-key rule where a musician would more likely write F-sharp.  A hummed-melody
    score is better off without double sharps, and the alternative is a second table of
    per-degree conventions fitted to no measurement.
    """
    # Vacate every letter the signature claims *before* filing any of them, not letter by
    # letter: in a signature deep enough that an altered pitch lands on another altered
    # letter's natural slot, one loop clobbers the other.  D-flat minor's eight flats
    # alter all seven letters, and its C-flat is filed under pitch class 11 only for
    # B-double-flat's pop of B's slot — also 11 — to delete it again, leaving C-flat
    # spelled as a plain B.
    altered_steps = {altered.step for altered in k.alteredPitches}
    diatonic = {
        pc: name for pc, name in _NATURAL_NAMES.items() if name not in altered_steps
    }
    for altered in k.alteredPitches:
        diatonic[altered.pitchClass] = altered.name

    spelling = dict(diatonic)
    if k.mode == "minor":
        leading = (k.tonic.pitchClass - 1) % 12
        if leading not in spelling:
            # Raising the 7th degree raises its *letter*, which is not always a sharp:
            # D minor's C becomes C#, but C minor's B-flat becomes plain B and B-flat
            # minor's A-flat becomes plain A.
            spelling[leading] = _NATURAL_NAMES.get(leading) or (
                _NATURAL_NAMES[(leading - 1) % 12] + "#"
            )

    sharp = (k.sharps or 0) >= 0
    for pc in range(12):
        if pc in spelling:
            continue
        if pc in _NATURAL_NAMES:
            spelling[pc] = _NATURAL_NAMES[pc]
        else:
            base = (pc - 1) % 12 if sharp else (pc + 1) % 12
            spelling[pc] = _NATURAL_NAMES[base] + ("#" if sharp else "-")
    return spelling


def _respell_to_key(s, k) -> None:
    """Rewrite every note in *s* to its ``_key_spelling`` name, in place.

    This runs after key detection because it cannot run before: the key is analysed
    *from* this stream, so the notes have to exist first.  Only the spelling changes —
    the octave is solved back from the MIDI number, so ``pitch.midi`` is invariant and
    the solfa mapping downstream (which reads ``n.pitch.midi``) cannot move.  That
    invariance is what makes this a pure notation fix; it is swept over all 12 pitch
    classes in all 24 keys by the helper tests.
    """
    from music21 import pitch as m21pitch

    spelling = _key_spelling(k)
    for n in s.recurse().notes:
        midi = n.pitch.midi
        spelled = m21pitch.Pitch(spelling[midi % 12])
        # Solve the octave from the MIDI number rather than computing midi // 12 - 1:
        # an extreme signature can name C- or B#, whose letter sits in the neighbouring
        # octave, and getting that wrong would transpose the note and the syllable.
        spelled.octave = 4
        spelled.octave += (midi - spelled.midi) // 12
        n.pitch = spelled


# ── Event post-processing helpers ─────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Event:
    """One detected note event, in the seconds domain, between inference and music21.

    Frozen because every stage below rebuilds rather than mutates — the 4-tuple this
    replaced could not be mutated either, and keeping that invariant means one stage
    cannot quietly change an event another stage has already read.  Derive a modified
    copy with ``dataclasses.replace``.

    ``pitch`` is the notated pitch and stays an int: measured against the corpus the
    bend-corrected reading is a *worse* notated pitch (135 events closer to the truth,
    164 further), because the sharpness it faithfully tracks on the drift and vibrato
    cases is exactly what notation is supposed to round away.  ``bend_semitones`` is
    therefore not a correction to ``pitch`` but a second, continuous reading of the
    same note, and the only thing that consumes it is ``_merge_onsets`` — which needs
    to know whether two fragments are the same note, a question rounding destroys.

    ``bend_semitones`` defaults to 0.0, which is honest rather than a sentinel: no bend
    information means the best estimate of the fundamental *is* the notated pitch.

    ``pyin_midi`` and ``voiced_prob`` are pyin's reading of the same span — the pitch it
    measured and how reliably it heard anything at all.  ``_refine_pitches`` computes
    both already and used to throw them away after gating on them.  They are carried here
    because they are the pipeline's only pitch evidence *independent* of Basic Pitch;
    ``pitch_refined`` on the result is derived from them, and ``_refine_pitches`` gates on
    them.  ``pyin_midi`` is None when pyin had too few voiced frames in the span to speak,
    or when it did not run at all, which is not the same claim as ``voiced_prob = 0.0``.

    They are deliberately NOT in the confidence blend any more.  On the contour path
    ``pitch`` is derived FROM ``pyin_midi``, so the two are one measurement and an
    agreement term between them degenerates to "how near a whole semitone did the median
    sit" — measured at auc 0.448, i.e. below chance, with ``voiced_prob`` at 0.357.  See
    the CONF_WEIGHT_AMP block.

    ``onset_post`` is how strongly Basic Pitch's onset head fired where this event starts
    (see ``Posteriorgram``).  It defaults to None, which means "not sampled", and that is a
    real state rather than a placeholder: ``Posteriorgram.capture`` returns None on an
    unusable ``model_output``, and every consumer must fall back rather than read a 0.0 as
    evidence of absence.  On the contour path, where Basic Pitch is asked nothing else at
    all, it is the only evidence from a model that path has ever carried.
    """

    start: float
    end: float
    pitch: int
    amp: float
    bend_semitones: float = 0.0
    pyin_midi: float | None = None
    voiced_prob: float = 0.0
    onset_post: float | None = None

    @property
    def f0(self) -> float:
        """Continuous fundamental in MIDI units — ``pitch`` when there are no bends."""
        return self.pitch + self.bend_semitones


def _bend_semitones(bends: object) -> float:
    """Mean pitch bend in semitones, or 0.0 when Basic Pitch reported none.

    The mean rather than the median deliberately.  A fragment shorter than one vibrato
    cycle sits somewhere on the slope, and the median of a monotonic run is just its
    midpoint sample — measured over the vibrato corpus the median reading separates
    fragments from genuine steps strictly worse than the mean (a p10 of 0.000 against
    0.670 on the genuine side, i.e. a floor no threshold can sit under).

    ``bends`` is typed loosely because Basic Pitch documents it as ``Optional[List[int]]``
    and empties it for notes that overlap another (``drop_overlapping_pitch_bends``).
    """
    if not bends:
        return 0.0
    return float(np.mean(np.asarray(bends, dtype=float))) / CONTOUR_BINS_PER_SEMITONE


# ── Basic Pitch's frame-level posteriors ──────────────────────────────────────

# Lowest MIDI pitch Basic Pitch has a column for: A0, the bottom of an 88-key piano.
# ``basic_pitch.note_creation`` calls the same number MIDI_OFFSET and adds it back when it
# turns a bin index into a pitch; this is that constant read in the other direction.
POSTERIOR_MIDI_LOW = 21
POSTERIOR_N_BINS = 88

# Half-width, in frames, of the window an onset is looked for in.  Onsets & Frames labels
# an onset as a ~32 ms window rather than the single true-start frame *because labelling
# the exact frame scored worse* — audio and annotation are never aligned to better than a
# frame or two, so a point query asks for a precision the signal does not have.  32 ms is
# 2.75 frames at ANNOTATIONS_FPS 86; 3 rounds that up, which is the forgiving direction.
ONSET_WINDOW_FRAMES = 3

# Half-width, in semitone bins, of the same lookup.  ``_merge_onsets`` documents that Basic
# Pitch fires at BOTH neighbours of a wobbling pitch — 43 of 63 vibrato adjacencies land two
# semitones apart rather than one — so a query pinned to the notated bin misses the onset of
# any note with vibrato on it.  One bin either side covers that without opening the query up
# to the +12/+19 harmonic ghosts ``_strong_skyline`` has to defend against.
ONSET_PITCH_BINS = 1

# ── Reading a melody off the contour head ─────────────────────────────────────
# Ceiling on the contour head, in MIDI, and the reason it has to be applied by hand.
# ``predict``'s ``maximum_frequency`` zeroes the ``note`` and ``onset`` heads above itself
# and leaves ``contour`` untouched, so the bins the other two heads do not have still carry
# activation here — unconstrained, and therefore garbage.  Measured: an unmasked skyline rule
# reads MIDI 109 (the top bin, 21 + 263/3 = 108.7) as a note on both ``major_c`` and
# ``close_voicing_control_c_major``.  Derived from ``PYIN_FMAX_HZ`` rather than written as
# 84.06 because that constant's own comment already requires the two stages to agree about
# what counts as a plausible fundamental; hard-coding the MIDI value would let them drift.
CONTOUR_CEIL_MIDI = 69.0 + 12.0 * float(np.log2(PYIN_FMAX_HZ / 440.0))

# Absolute activation a contour bin needs before its frame counts as voiced at all.
#
# The contour head has no voiced/unvoiced decision — that is exactly why it is reachable
# where pyin starves — so ``argmax`` returns a bin on a silent frame too, and silence gets
# read as a note.  Not cosmetic: every case measured grew ONE spurious trailing note, and
# ``poly_block_chords_c_major`` reaches notes.f1 1.000 through the inference path, so an
# eleven-correct-plus-one-spurious contour answer scoring 2*11/(11+12) = 0.957 would trade a
# win for a loss.  A relative bar cannot do this job: tau is a fraction of the frame's own
# peak, so on a weak frame the bar drops with it and the artefact survives.
#
# Swept, not fitted, over the three polyphonic cases and six monophonic ones:
#
#   0.15   the artefact survives — quiet_low_amplitude, overtone_heavy,
#          close_voicing_control_c_major and major_c all grow the spurious bottom-bin note
#   0.20   every case EXACT
#   0.30   every case EXACT
#   0.40   every case EXACT
#   0.50   real notes start dying — poly_block_chords returns a wrong list,
#          close_voicing 11 of 12
#   0.60   poly_block_chords 6 notes, poly_alberti_bass 9
#   0.70   close_voicing 5 notes, poly_block_chords 4, noise_moderate 12
#
# 0.30 is the midpoint of the measured plateau, the same placement argument as
# MELODY_FLOOR_DISAGREEMENT_SEMITONES: both edges are known and it sits between them.
CONTOUR_MIN_ACTIVATION = 0.30


@dataclass(frozen=True, slots=True)
class Posteriorgram:
    """Basic Pitch's three per-frame matrices — the two thirds of ``predict`` we threw away.

    ``predict`` returns ``(model_output, midi_data, note_events)`` and this pipeline bound
    that first element to ``_`` from the day it was written, discarding every frame-level
    posterior the ONNX pass had just produced.  Nothing was saved by doing so: the matrices
    are the model's raw output and its own decoder ran on them either way.  Capturing them
    costs one name.

    ``onset`` and ``note`` are (T, 88), one column per piano key from ``POSTERIOR_MIDI_LOW``;
    ``contour`` is (T, 264) at ``CONTOUR_BINS_PER_SEMITONE`` bins per semitone over the same
    compass.  ``times`` is Basic Pitch's own frame->seconds map, taken from
    ``model_frames_to_time`` rather than computed as ``i / ANNOTATIONS_FPS``: the model reads
    overlapping two-second windows and concatenates them, so the naive reading gains one
    window offset (~10.3 ms) per window and is most of a second out by the end of a
    three-minute clip — which is the whole length of a note at 96 BPM.

    Why this class exists.  ``onset`` is a *trained note-onset detector*, and Onsets & Frames
    (Hawthorne et al. 2018, MAPS config-2) measured what a decoder gives up without one.
    Removing only their inference-time rule — that a frame activation may not start a note
    unless the onset detector agrees — costs 18% relative note F1 (82.29 -> 67.44) and 32%
    relative note-with-offset F1 (50.22 -> 34.15), while frame F1 *rises*, 78.30 -> 78.37.
    That inversion is the argument: a frame-only decoder buys coverage with note-level
    correctness, and until this class existed both of this pipeline's decode paths were
    frame-only.  ``_segment_contour``'s docstring says as much out loud — "with Basic Pitch's
    ``onset`` head not asked where they are" — and still does, because the argument did not
    survive measurement: the gate is already inside the vendored decoder, and applying it a
    second time at the segmenter loses accuracy.  What this class does buy is ``contour``,
    which ``melody_track`` reads as the melody on a mixture.

    The matrices are held unthresholded because the consumers want different things from
    them: an onset gate wants a hard local-maximum test, while ``_blend_confidence`` wants a
    continuous number to rank by.  Thresholding on arrival would serve the first and destroy
    the second.

    Only ``onset`` is read today — ``_sample_posteriors`` samples it per event.  ``note`` is
    captured and shape-checked but unread: it arrives in the same dict at no extra cost, and
    dropping it would mean ``capture`` could not verify the three heads agree on T, which is
    the check that stops a basic-pitch change silently mis-indexing.  A
    frame-posterior *confidence* term was built on ``note`` and removed — it measured at or
    below chance in four different formulations, and the CONF_WEIGHT_AMP block records the
    numbers so it is not re-attempted.  ``contour`` is read by ``melody_track``, which is the
    contour path's f0 source on a clip whose melody floor fired.
    """

    onset: np.ndarray
    note: np.ndarray
    contour: np.ndarray
    times: np.ndarray

    @classmethod
    def capture(cls, model_output: dict) -> "Posteriorgram | None":
        """Wrap ``predict``'s first return value, or ``None`` if it is not usable.

        Defensive because ``model_output`` is the one input here this pipeline does not
        own: it is whatever the pinned basic-pitch happens to return, the key names differ
        from the ones its own docstring advertises (that docstring says ``frame``; the code
        reads ``note``), and a shape mismatch between the three heads would silently
        mis-index rather than raise.  Returning ``None`` degrades every consumer back to the
        pre-capture behaviour, which is the honest failure mode for a pure enrichment.
        """
        try:
            from basic_pitch.note_creation import model_frames_to_time

            onset = np.asarray(model_output["onset"], dtype=float)
            note = np.asarray(model_output["note"], dtype=float)
            contour = np.asarray(model_output["contour"], dtype=float)
        except Exception:
            return None
        if onset.ndim != 2 or note.shape != onset.shape or contour.shape[0] != onset.shape[0]:
            return None
        if onset.shape[1] != POSTERIOR_N_BINS or onset.shape[0] < 2:
            return None
        return cls(onset=onset, note=note, contour=contour, times=model_frames_to_time(onset.shape[0]))

    def frame_at(self, t: float) -> int:
        """Index of the frame nearest time *t*, clamped to the matrix.

        ``times`` is monotonic — the per-window offset subtracted at each boundary
        (~10.3 ms) is smaller than the frame hop (~11.6 ms), so the sequence still rises
        across a window seam, by ~1.3 ms — which is what makes a binary search valid here.
        """
        i = int(np.searchsorted(self.times, t))
        if i <= 0:
            return 0
        if i >= self.times.size:
            return int(self.times.size - 1)
        return i if abs(self.times[i] - t) < abs(self.times[i - 1] - t) else i - 1

    def _bin(self, pitch: float) -> int:
        return int(min(max(round(pitch) - POSTERIOR_MIDI_LOW, 0), POSTERIOR_N_BINS - 1))

    def melody_track(
        self, floor_midi: float | None, dst_times: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """An f0 contour read off ``contour``, in MIDI, on the *dst_times* grid.

        The alternative to pyin for the one case pyin cannot do: a melody over a close
        accompaniment.  Raising pyin's ``fmin`` above the accompaniment removes the mixture's
        strongest component from its search band while leaving the energy in the signal, and
        pyin then declares the clip nearly unvoiced rather than following the melody —
        ``close_voicing_c_major`` returns 4 events from 336 frames at voiced_prob
        0.011-0.023.  This head has no ``fmin`` band and no voiced/unvoiced decision, so it
        cannot fail that way.

        The rule is ARGMAX over the bins between the melody floor and ``CONTOUR_CEIL_MIDI``,
        with ``CONTOUR_MIN_ACTIVATION`` deciding voicing.  Two alternatives were measured and
        refuted:

        * The "strong skyline" — highest bin reaching ``MELODY_FLOOR_TAU`` of its frame's
          peak, the rule the melody floor itself uses on the ``note`` head — tracks the
          +12/+19 harmonic ghost here.  ``vibrato_depth_2_0`` reads MIDI 80-94 throughout,
          and both polyphonic cases come back alternating melody and ghost.  tau is a
          fraction of the frame peak, so on a weak frame (that case's median peak is 0.152)
          the bar is low and every ghost clears it.  The ``note`` head is thresholded to
          notes and this one is not, which is the difference.
        * ``argmax`` with the floor mask *removed* tracks the accompaniment exactly —
          ``close_voicing`` reads 52, 53, 55, 57, which is the left hand.  So the melody
          floor is load-bearing for this rule: W4 composes with it rather than replacing it.

        Measured against the reference pitch lists, pyin first:

            close_voicing_c_major        4 notes  ->  12, EXACT
            poly_block_chords_c_major    2 notes  ->  11, EXACT
            poly_alberti_bass_c_major   11 EXACT  ->  11, EXACT

        Resampled by NEAREST FRAME rather than interpolated.  This head runs at ~86 fps
        against pyin's ~45, so ``_contour_segments`` on the native grid would halve the
        meaning of every one of CONTOUR_SMOOTH_FRAMES, CONTOUR_PERSIST_FRAMES and
        CONTOUR_MIN_SEGMENT_FRAMES, all of which are calibrated to pyin's hop.  Nearest-frame
        also refuses to invent a pitch across an unvoiced gap or to smooth a real leap, both
        of which linear interpolation would do.

        This is not a general-purpose replacement for pyin and must not be reached where pyin
        is doing its job.  ``drift_1_semitone`` reads a full semitone sharp here while pyin is
        EXACT, and on the vibrato family argmax is wrong outright (15-17 notes, wrong
        pitches).  Its whole warrant is the mixture case, which is why the caller fires it
        only where the melody floor did.

        The second return is the winning bin's activation, which the caller hands to
        ``_contour_segments`` in pyin's ``voiced_prob`` slot.  That argument only sets each
        segment's reported confidence — the voicing decision is NaN in the first return — but
        the number it reports is an activation rather than a periodicity, which is worth
        knowing when reading ``conf`` on a clip that came through this path.
        """
        bin_midi = (
            POSTERIOR_MIDI_LOW
            + np.arange(self.contour.shape[1], dtype=float) / CONTOUR_BINS_PER_SEMITONE
        )
        usable = self.contour.copy()
        usable[:, bin_midi > CONTOUR_CEIL_MIDI] = 0.0
        if floor_midi is not None:
            usable[:, bin_midi < floor_midi] = 0.0

        best = usable.argmax(axis=1)
        strength = usable[np.arange(usable.shape[0]), best]
        voiced = strength >= CONTOUR_MIN_ACTIVATION
        midi = np.where(voiced, bin_midi[best], np.nan)
        strength = np.where(voiced, strength, 0.0)

        # Nearest source frame for each destination time.  ``times`` is monotonic (see
        # ``frame_at``), so searchsorted is valid; the clip to [1, size-1] keeps the
        # left/right comparison in range at both ends.
        idx = np.clip(np.searchsorted(self.times, dst_times), 1, self.times.size - 1)
        idx = np.where(
            np.abs(dst_times - self.times[idx - 1]) <= np.abs(self.times[idx] - dst_times),
            idx - 1,
            idx,
        )
        return midi[idx], strength[idx]

    def onset_evidence(
        self,
        t: float,
        pitch: float,
        window_frames: int = ONSET_WINDOW_FRAMES,
        pitch_bins: int = ONSET_PITCH_BINS,
    ) -> float:
        """Strongest onset posterior near (*t*, *pitch*), in [0, 1].

        The max over the neighbourhood rather than the value at the centre, for the two
        reasons ``ONSET_WINDOW_FRAMES`` and ``ONSET_PITCH_BINS`` carry: annotation and audio
        are not aligned to the frame, and a note with vibrato on it fires at its neighbours.
        """
        i = self.frame_at(t)
        b = self._bin(pitch)
        lo_t, hi_t = max(0, i - window_frames), min(self.onset.shape[0], i + window_frames + 1)
        lo_b, hi_b = max(0, b - pitch_bins), min(POSTERIOR_N_BINS, b + pitch_bins + 1)
        window = self.onset[lo_t:hi_t, lo_b:hi_b]
        return float(window.max()) if window.size else 0.0


def _adaptive_amplitude_floor(events: list[Event], base: float) -> float:
    """Return max(base, ADAPTIVE_FACTOR × p75(amplitudes)).

    Scaling with the clip's own distribution is what lets one threshold serve both a
    loud and a soft recording, because Basic Pitch's ``amplitude`` is a mean frame
    *posterior*, not audio loudness — so the level this compares against moves with how
    confident the model is, not with how loud the microphone was.

    Note what the ``max`` does and does not do.  The adaptive term can only ever RAISE
    the floor, so it cannot protect a quiet recording; what protects those is ``base``
    being low, plus the posterior/loudness distinction above.  (Measured:
    ``quiet_low_amplitude`` scores ``notes.f1`` 1.000 with its correct notes at a mean
    posterior of 0.734 — as high as any clean case.  Nothing about that clip is quiet
    from this function's point of view.)  An earlier version of this docstring claimed
    the adaptive term was what stopped soft recordings being silenced; with ``max`` that
    was unreachable by construction.
    """
    if not events:
        return base
    amps = np.array([e.amp for e in events], dtype=float)
    p75 = float(np.percentile(amps, 75))
    return max(base, ADAPTIVE_FACTOR * p75)


def _merge_onsets(
    events: list[Event],
    gap_sec: float,
) -> list[Event]:
    """Fuse consecutive events less than *gap_sec* apart whose f0 agree.

    Basic Pitch often splits a single sustained note or a clearly-intended
    short repeated note (e.g. a triplet figure) into several fragments.
    Merging them reduces ghost syllables in the solfa output and improves
    overall confidence scores.

    The merged event inherits the amplitude of the louder fragment and spans
    from the earliest start to the latest end.  Multiple passes are made until
    no further merges are possible (handles chains of three or more).

    The pitch test compares ``f0`` within ``F0_MERGE_SEMITONES`` rather than requiring
    identical rounded pitches, which is the fix for the vibrato fragmentation the
    earlier semitone-tolerant attempt could not reach.  That attempt compared rounded
    pitches and was struck because Basic Pitch fires at *both* neighbours of a wobbling
    pitch, so consecutive fragments of one note are two semitones apart rather than one
    — 43 of 63 adjacencies against 5 — and the shorter fragment measures 116.1 ms
    (2560/22050, a quantization constant) on genuine legato semitone steps just as it
    does on vibrato fragments, so no duration cap separates them.  Both objections are
    about *rounding*, and the bends Basic Pitch already returns are what rounding threw
    away; see ``F0_MERGE_SEMITONES`` for the measured separation and the calibration.

    For events carrying no bend data this is exactly the old exact-equality test, since
    distinct integer pitches differ by at least 1.  That is the shipped configuration:
    ``settings.f0_merge`` is off by default, so every ``bend_semitones`` is 0.0 and this
    reduces to the equality test it replaced.  The tolerance is live code behind a flag
    that measured a wash — see that flag's docstring and the fourth strike recorded in
    tests/accuracy/corpus.py before turning it on or building on it.

    An overlap allowance was measured here and is *not* worth building.  An earlier probe
    concluded it "buys nothing"; that probe only looked at gaps down to -50 ms and was
    wrong about its reason.  With no window at all, at merge time over the nine
    vibrato/drift cases, 51 of the 128 adjacent pairs whose f0 agree overlap in time
    (p25 -92.9 ms, p10 -246.1 ms) and only 74 are reachable by ``0.0 <= gap``.  Sorted by
    start, a wobble Basic Pitch reports at both neighbours *simultaneously* interleaves, so
    most vibrato fragments never become adjacent-and-abutting and this stage structurally
    cannot see them.  It is not free either: the f0-*disagreeing* adjacent pairs overlap
    harder still (34 of 44 on vibrato_heavy, 61 of 73 on vibrato_rate_7hz), so widening the
    gap test hands the f0 test a much larger population it must reject correctly.

    What settles it is that the population it would reach is the wrong population: of 56
    f0-agreeing overlapping pairs, **none** is a semitone apart in pitch, so here "f0
    agrees" already means "pitch is identical" and a wider window fuses only what the
    equality test would have fused anyway.  The vibrato defect turned out not to be a
    fragment pair at all — within one sung note the estimate is a run at one wrong pitch
    rather than an alternation — and it is fixed upstream by ``settings.pyin_semitone``.
    See the fourth-strike record in tests/accuracy/corpus.py for the whole measurement.
    """
    if len(events) < 2:
        return events

    merged = list(events)
    changed = True
    while changed:
        changed = False
        result: list[Event] = []
        i = 0
        while i < len(merged):
            curr = merged[i]
            if i + 1 < len(merged):
                nxt = merged[i + 1]
                gap = nxt.start - curr.end
                if abs(curr.f0 - nxt.f0) <= F0_MERGE_SEMITONES and 0.0 <= gap < gap_sec:
                    # Merge: span from curr.start to nxt.end, keeping the louder
                    # fragment wholesale — its pitch as well as its amplitude.  The
                    # two pitches can now differ, and the louder fragment is the more
                    # confident reading; pooling the f0 and re-rounding was the
                    # alternative and is not supported by the measurement above, which
                    # found the rounded pitch the better notated value.
                    loud = curr if curr.amp >= nxt.amp else nxt
                    result.append(replace(loud, start=curr.start, end=nxt.end))
                    i += 2
                    changed = True
                    continue
            result.append(curr)
            i += 1
        merged = result

    return merged


def _merge_contour_gaps(
    events: list[Event],
    times: np.ndarray,
    midi: np.ndarray,
    voiced_prob: np.ndarray,
    post: "Posteriorgram | None" = None,
) -> list[Event]:
    """Fuse same-pitch fragments across a voiced contour dropout.

    Basic Pitch can briefly lose frame activation in the middle of a sustained sung
    note.  ``_merge_onsets`` intentionally does not bridge those gaps because it only
    handles abutting events.  This helper is deliberately narrower than a time-only
    merge: both events must already have the same notated pitch, the whole gap must be
    voiced, and pyin must stay close to that pitch.  A strong independent onset at the
    second event vetoes the merge so repeated notes are preserved.

    ``times``, ``midi`` and ``voiced_prob`` are the single pyin contour already used by
    pitch refinement.  Passing them in avoids a second expensive pyin invocation.
    """
    if len(events) < 2 or times.size == 0:
        return events
    if not (times.size == midi.size == voiced_prob.size):
        return events

    merged = list(events)
    changed = True
    while changed:
        changed = False
        result: list[Event] = []
        i = 0
        while i < len(merged):
            curr = merged[i]
            if i + 1 >= len(merged):
                result.append(curr)
                i += 1
                continue
            nxt = merged[i + 1]
            gap = nxt.start - curr.end
            if curr.pitch != nxt.pitch or gap <= 0.0 or gap > CONTOUR_GAP_MAX_SEC:
                result.append(curr)
                i += 1
                continue

            inside = (times >= curr.end) & (times <= nxt.start)
            observed = midi[inside]
            probs = voiced_prob[inside]
            valid = ~np.isnan(observed)
            if not valid.all() or np.any(probs[valid] < PYIN_MIN_VOICED_PROB):
                result.append(curr)
                i += 1
                continue
            if np.max(np.abs(observed[valid] - curr.pitch)) > CONTOUR_GAP_TOLERANCE:
                result.append(curr)
                i += 1
                continue
            if post is not None and post.onset_evidence(nxt.start, nxt.pitch) >= CONTOUR_GAP_ONSET_VETO:
                result.append(curr)
                i += 1
                continue

            loud = curr if curr.amp >= nxt.amp else nxt
            result.append(replace(loud, start=curr.start, end=nxt.end))
            i += 2
            changed = True
        merged = result
    return merged


def _dedup_simultaneous(events: list[Event]) -> list[Event]:
    """Remove exact duplicate pitch+onset pairs that survive onset merging.

    In polyphonic mode, Basic Pitch occasionally emits two identical note
    events (same pitch, same start time) from harmonic energy.  Keep only
    the louder one to avoid double-counting a single physical note.
    """
    seen: dict[tuple, float] = {}  # (pitch, start_rounded) → best_amp
    order: list[Event] = []

    for evt in events:
        start, pitch, amp = evt.start, evt.pitch, evt.amp
        key = (pitch, round(start, 3))
        if key not in seen:
            seen[key] = amp
            order.append(evt)
        elif amp > seen[key]:
            # Replace with the louder duplicate; preserve original list order
            seen[key] = amp
            order = [
                evt if (e.pitch == pitch and round(e.start, 3) == round(start, 3)) else e
                for e in order
            ]

    return order


def _resolve_melody_overlaps(events: list[Event]) -> list[Event]:
    """Reduce overlapping events to one voice, fusing the wobble slivers on the way.

    Melody mode promises a single line, so every overlap here is an artefact of
    inference and this decides which reading survives.  Three outcomes: fuse (the two
    are one wobbling note that got split), replace (the newcomer is the real note and
    the incumbent was its leading edge), or truncate (both are real and the boundary
    belongs to the newcomer).

    A module-level function rather than a loop inside ``_transcribe_wav`` because the
    fuse rule's two constants were chosen from a measured distribution, and a threshold
    picked from data needs a test on *its own decisions* — a corpus metric cannot
    distinguish "fused the right pair" from "fused nothing and got lucky".  See
    ``tests/accuracy/test_directional.py``.
    """
    cleaned: list[Event] = []
    for evt in events:
        if not cleaned:
            cleaned.append(evt)
            continue

        prev = cleaned[-1]

        if evt.start < prev.end:  # overlap detected
            shorter = min(prev.end - prev.start, evt.end - evt.start)
            overlap = min(prev.end, evt.end) - evt.start
            if (
                abs(evt.pitch - prev.pitch) <= WOBBLE_SEMITONES
                and shorter > 0.0
                and overlap / shorter >= WOBBLE_MIN_OVERLAP_FRACTION
            ):
                # One wobbling note that inference split across two semitones.
                # Fuse, keeping the LONGER fragment's pitch and spanning both:
                # duration is what separates the note's body from a piece of its
                # wobble, and amplitude demonstrably is not (see _blend_confidence).
                longer = prev if (prev.end - prev.start) >= (evt.end - evt.start) else evt
                cleaned[-1] = replace(
                    longer,
                    start=min(prev.start, evt.start),
                    end=max(prev.end, evt.end),
                )
                continue
            onset_close = (evt.start - prev.start) < 0.12
            if evt.amp > prev.amp and onset_close:
                # Current note is louder and nearly co-incident → replace
                cleaned[-1] = evt
            else:
                # Truncate previous to the boundary of the new one
                if (evt.start - prev.start) >= 0.04:
                    # Only the part of prev after evt is given up.  Truncating a
                    # prev that *contains* evt would also delete prev's sustain
                    # past evt.end, turning one long note into a sliver plus a
                    # hole; keeping the later end is what stops that.
                    cleaned[-1] = replace(prev, end=evt.start)
                    cleaned.append(evt if evt.end >= prev.end else replace(evt, end=prev.end))
                # else: previous becomes too short → drop it, keep current
                else:
                    cleaned[-1] = evt
        else:
            cleaned.append(evt)

    # Drop any note that was truncated below the absolute minimum duration
    return [e for e in cleaned if (e.end - e.start) >= 0.04]


def _select_melody_path(events: list[Event]) -> list[Event]:
    """Choose the strongest sustained single voice from competing melody candidates.

    This is deliberately narrower than ``_resolve_melody_overlaps``.  The resolver repairs
    occasional overlap artefacts in otherwise monophonic input; this helper handles the
    raised-floor fallback, where Basic Pitch has returned several simultaneous readings of
    the melody register after pyin failed to segment it.  In that population, choosing by
    input order lets a quiet octave or harmonic replace the real note simply because it was
    visited last.

    The path score is posterior confidence multiplied by sounding duration.  That rewards
    both evidence axes Basic Pitch supplies without assuming the melody is the highest or
    lowest candidate.  Weighted interval scheduling then maximises that score across the
    whole clip, allowing the small boundary overlap defined above.  A list with no competing
    events is returned unchanged, which keeps ordinary monophonic behaviour out of scope.
    """
    if len(events) < 2:
        return events

    by_start = sorted(events, key=lambda e: (e.start, e.end, e.pitch))
    furthest_end = by_start[0].end
    has_competition = False
    for evt in by_start[1:]:
        if evt.start < furthest_end - MELODY_PATH_OVERLAP_SEC:
            has_competition = True
            break
        furthest_end = max(furthest_end, evt.end)
    if not has_competition:
        return events

    ordered = sorted(events, key=lambda e: (e.end, e.start, e.pitch))
    duration_cap = float(np.median([max(0.0, e.end - e.start) for e in ordered]))
    duration_cap = max(duration_cap, MELODY_PATH_OVERLAP_SEC)
    scores = [0.0] * (len(ordered) + 1)
    choices: list[list[Event]] = [[] for _ in range(len(ordered) + 1)]

    for i, evt in enumerate(ordered, start=1):
        predecessor = i - 2
        while predecessor >= 0:
            if ordered[predecessor].end <= evt.start + MELODY_PATH_OVERLAP_SEC:
                break
            predecessor -= 1

        duration = min(max(0.0, evt.end - evt.start), duration_cap)
        take_score = scores[predecessor + 1] + evt.amp * duration
        if take_score > scores[i - 1]:
            scores[i] = take_score
            choices[i] = [*choices[predecessor + 1], evt]
        else:
            scores[i] = scores[i - 1]
            choices[i] = choices[i - 1]

    return sorted(choices[-1], key=lambda e: (e.start, e.end, e.pitch))


# ── pyin pitch refinement (defect 6) ──────────────────────────────────────────


def _load_audio(audio_path: Path | str, sr: int = 22_050) -> tuple[np.ndarray, int]:
    """Load audio from file into a mono float32 numpy array at target sample rate."""
    import librosa

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        y, file_sr = librosa.load(str(audio_path), sr=sr, mono=True)
    return y.astype(np.float32), sr


def _condition_audio(y: np.ndarray, sr: int = 22_050) -> np.ndarray:
    """Pre-condition audio; pass-through for exact precision parity."""
    return y


def _pyin_contour(
    audio_input: Path | str | np.ndarray, fmin: float = PYIN_FMIN_HZ
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(frame times, f0 as MIDI with NaN where unvoiced, voiced probability).

    Basic Pitch decides *where* notes are and pyin decides *what pitch* they are:
    a frame-level f0 tracker has no note segmentation of its own, so it cannot
    replace inference, but it is a far better pitch estimator inside boundaries
    that already exist.  That division of labour is the whole point of this stage.

    ``fmin`` defaults to the fixed band floor and is raised only by ``_segment_contour``,
    to choose which voice of a mixture pyin tracks.  ``_refine_pitches`` keeps the default
    deliberately: it corrects pitches inside boundaries Basic Pitch already drew, so a
    raised floor there could only turn a correct low note into an octave error.

    Returns three empty arrays when the clip is unreadable, too long to refine
    within the queue's latency budget, or produced no voiced frames at all — which
    every caller reads as "no refinement available".
    """
    import librosa

    try:
        if isinstance(audio_input, (str, Path)):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                y, sr = librosa.load(str(audio_input), sr=22_050, mono=True)
        else:
            y = np.asarray(audio_input, dtype=np.float32)
            sr = 22_050
        duration = len(y) / float(sr) if sr else 0.0
        # Checked after the decode and before pyin because the decode is the
        # cheap half: pyin is ~0.23x realtime and this is a single-worker queue.
        if duration > settings.pyin_max_seconds:
            print(
                f"[notefusion] clip is {duration:.0f}s, over the "
                f"{settings.pyin_max_seconds:.0f}s pyin budget; skipping refinement",
                flush=True,
            )
            return np.empty(0), np.empty(0), np.empty(0)
        # resolution is deliberately coarser than librosa's 0.1 default: it is what
        # buys the cap above, and _refine_pitches rounds this to a semitone anyway.
        # See config.pyin_resolution for the cost/agreement measurement.
        f0, _voiced_flag, voiced_prob = librosa.pyin(
            y,
            fmin=fmin,
            fmax=PYIN_FMAX_HZ,
            sr=sr,
            resolution=settings.pyin_resolution,
        )
    except Exception as exc:
        print(f"[notefusion] librosa pyin failed ({exc}); keeping Basic Pitch pitches", flush=True)
        return np.empty(0), np.empty(0), np.empty(0)

    times = librosa.times_like(f0, sr=sr)
    midi = np.full(f0.shape, np.nan)
    voiced = ~np.isnan(f0)
    if not voiced.any():
        return np.empty(0), np.empty(0), np.empty(0)
    midi[voiced] = librosa.hz_to_midi(f0[voiced])
    return times, midi, voiced_prob


def _median_smooth(x: np.ndarray, width: int) -> np.ndarray:
    """Running median over ``width`` samples, edge-padded so the result is the same length.

    A median and not a mean, and that is the whole reason this stage exists: over about one
    period of an oscillation both return its centre, but a mean turns a step edge into a
    ramp ``width`` samples long while a median leaves the edge exactly where it was.  The
    contour needs the wobble gone and the note boundaries intact, and only one of the two
    filters does both.
    """
    if width <= 1 or x.size == 0:
        return x
    half = width // 2
    padded = np.pad(x, (half, half), mode="edge")
    return np.array([np.median(padded[i : i + width]) for i in range(x.size)])


def _wobble_returns(smoothed: np.ndarray, k: int, centre: float) -> int | None:
    """First frame after ``k`` back inside the band of ``centre``, or ``None`` if there is none.

    Searched over ``CONTOUR_RESEED_LOOKAHEAD_FRAMES`` frames only, and that width is the whole
    safety argument — wide enough and this forgives genuine boundaries rather than wobbles, as
    the sweep recorded on the constant shows it doing to the fast cases.  Returning the index
    rather than a bool lets the caller skip the excursion outright instead of re-counting it
    every ``CONTOUR_PERSIST_FRAMES``, which is what actually breaks the ratchet.
    """
    stop = min(smoothed.size, k + 1 + CONTOUR_RESEED_LOOKAHEAD_FRAMES)
    for j in range(k + 1, stop):
        if abs(float(smoothed[j]) - centre) <= CONTOUR_BAND_SEMITONES:
            return j
    return None


def _contour_segments(
    times: np.ndarray, midi: np.ndarray, voiced_prob: np.ndarray
) -> list[tuple[int, int, float, float]]:
    """Cut the f0 contour into notes.  Returns ``(start_idx, end_idx, midi, voiced_prob)``.

    One note is a voiced run whose pitch stays within ``CONTOUR_BAND_SEMITONES`` of the
    run's own running median — where "stays" is the load-bearing word.  A frame outside the
    band does not end the note; ``CONTOUR_PERSIST_FRAMES`` consecutive frames outside it do.
    That is the difference between a wobble, which leaves the band and comes back inside a
    fraction of a vibrato cycle, and a note change, which leaves and stays.  See
    ``settings.contour_first`` for the two rules this replaced and why neither could work.

    The centre is a median over the frames accepted so far rather than a fixed value, so a
    note that drifts is followed rather than cut — ``drift_1_semitone`` scores 1.000 through
    a full semitone of drift, which a fixed centre could not do.

    ``end_idx`` is exclusive.  Segments shorter than ``CONTOUR_MIN_SEGMENT_FRAMES`` are
    dropped rather than emitted, so the caller never sees a note too short to notate.
    """
    segments: list[tuple[int, int, float, float]] = []
    n_frames = times.size
    i = 0
    while i < n_frames:
        if np.isnan(midi[i]):
            i += 1
            continue
        run_end = i
        while run_end < n_frames and not np.isnan(midi[run_end]):
            run_end += 1

        # Smooth inside the voiced run only.  Smoothing across a voicing gap would drag
        # whatever pyin reported for the silence into the first frames of the note.
        smoothed = _median_smooth(midi[i:run_end], CONTOUR_SMOOTH_FRAMES)

        seg_start = 0           # index into ``smoothed``
        accepted: list[float] = []
        out_run = 0             # consecutive frames outside the band
        out_start = 0           # index of the first of them, which is where the cut goes
        resume = 0              # frames before this belong to a wobble already forgiven
        for k in range(smoothed.size):
            if k < resume:
                continue
            if not accepted:
                accepted.append(float(smoothed[k]))
                continue
            centre = float(np.median(accepted))
            if abs(smoothed[k] - centre) > CONTOUR_BAND_SEMITONES:
                if out_run == 0:
                    out_start = k
                out_run += 1
                if out_run >= CONTOUR_PERSIST_FRAMES:
                    # Persistence says the note is over.  Before believing it, look for the
                    # contour returning to the centre it left: a wobble comes back within a
                    # period and a note change does not.  Skipping to the return frame rather
                    # than merely clearing ``out_run`` is what breaks the ratchet — it leaves
                    # ``accepted`` and therefore the centre untouched by the excursion, and it
                    # stops the same swing being re-counted every CONTOUR_PERSIST_FRAMES.
                    back = _wobble_returns(smoothed, k, centre)
                    if back is not None:
                        resume = back
                        out_run = 0
                        continue
                    if out_start - seg_start >= CONTOUR_MIN_SEGMENT_FRAMES:
                        segments.append(
                            (
                                i + seg_start,
                                i + out_start,
                                centre,
                                float(np.median(voiced_prob[i + seg_start : i + out_start])),
                            )
                        )
                    seg_start = out_start
                    accepted = [float(v) for v in smoothed[out_start : k + 1]]
                    out_run = 0
            else:
                out_run = 0
                accepted.append(float(smoothed[k]))
        if accepted and smoothed.size - seg_start >= CONTOUR_MIN_SEGMENT_FRAMES:
            segments.append(
                (
                    i + seg_start,
                    run_end,
                    float(np.median(accepted)),
                    float(np.median(voiced_prob[i + seg_start : run_end])),
                )
            )
        i = run_end
    return segments


def _fuse_same_pitch(
    segments: list[tuple[int, int, float, float]],
    times: np.ndarray,
    hop_sec: float,
) -> list[tuple[int, int, float, float]]:
    """Join adjacent segments that notate as the same pitch and nearly touch in time.

    A wobble that stayed out of band for longer than ``CONTOUR_PERSIST_FRAMES`` cuts one
    note in two, and both halves keep the same notated pitch — so an exact-integer test
    repairs it with no tolerance of its own and therefore no risk to a genuine step.
    ``_split_rearticulations`` runs after this and puts genuinely repeated notes back.
    """
    fused: list[tuple[int, int, float, float]] = []
    for start_i, end_i, median_midi, vprob in segments:
        if fused and round(median_midi) == round(fused[-1][2]):
            prev_start, prev_end, prev_midi, prev_vprob = fused[-1]
            if times[start_i] - (times[prev_end - 1] + hop_sec) < CONTOUR_FUSE_GAP_SEC:
                prev_frames, frames = prev_end - prev_start, end_i - start_i
                fused[-1] = (
                    prev_start,
                    end_i,
                    (prev_midi * prev_frames + median_midi * frames)
                    / ((prev_frames + frames) or 1),
                    max(prev_vprob, vprob),
                )
                continue
        fused.append((start_i, end_i, median_midi, vprob))
    return fused


def _split_rearticulations(
    segments: list[tuple[int, int, float, float]],
    rms: np.ndarray,
    midi: np.ndarray,
) -> list[tuple[int, int, float, float]]:
    """Cut a segment where the amplitude dips and recovers: a note struck again at one pitch.

    Runs after ``_fuse_same_pitch`` and not before, because the fuse would otherwise simply
    undo it.  That ordering is the division of labour: pitch decides every boundary it can
    see, and amplitude decides the ones it structurally cannot — the same-pitch ones.

    A dip is a boundary when it is the minimum of its own ``CONTOUR_VALLEY_WIDTH_FRAMES``
    neighbourhood and falls below ``CONTOUR_REARTICULATION_FRAC`` of the smaller peak either
    side of it.  Both halves must then still notate as the segment's own pitch, or the split
    is abandoned whole — that guard is what makes this stage safe, and it is not a
    threshold.  A repeated note has the same pitch on both sides of the dip, which is
    precisely why the pitch rule could not see it; a dip that separates two DIFFERENT
    pitches is a boundary the pitch rule already found, a few frames late because the
    median pre-smooth lags, and re-cutting it there only produces a sliver of the next
    note's attack.  Measured: with the guard, all 19 guard cases keep byte-identical
    segment counts while long_clip_over_pyin_cap goes 91 -> 99 of 99.

    Known limitation, measured rather than assumed: repeated SIXTEENTHS at 96 BPM dip only
    ~15 % between strikes, so they still fuse.  Recovering them needs a threshold shallow
    enough (0.85) to be unsafe on real legato audio, so it is deliberately not taken.
    """
    out: list[tuple[int, int, float, float]] = []
    width = CONTOUR_VALLEY_WIDTH_FRAMES
    for segment in segments:
        start_i, end_i, median_midi, vprob = segment
        window = rms[start_i:end_i] if rms.size >= end_i else np.empty(0)
        if window.size < 2 * CONTOUR_MIN_SEGMENT_FRAMES + 1:
            out.append(segment)
            continue

        cuts: list[int] = []
        last = 0
        for k in range(CONTOUR_MIN_SEGMENT_FRAMES, window.size - CONTOUR_MIN_SEGMENT_FRAMES):
            if k - last < CONTOUR_MIN_SEGMENT_FRAMES:
                continue
            neighbourhood = window[max(0, k - width) : k + width + 1]
            if window[k] > neighbourhood.min():
                continue
            flank = min(float(window[last:k].max()), float(window[k:].max()))
            if window[k] >= CONTOUR_REARTICULATION_FRAC * flank:
                continue
            cuts.append(k)
            last = k
        if not cuts:
            out.append(segment)
            continue

        bounds = [0, *cuts, window.size]
        parts = [
            (a, b) for a, b in zip(bounds, bounds[1:]) if b - a >= CONTOUR_MIN_SEGMENT_FRAMES
        ]
        pitches = [float(np.nanmedian(midi[start_i + a : start_i + b])) for a, b in parts]
        if len(parts) < 2 or any(round(p) != round(median_midi) for p in pitches):
            out.append(segment)
            continue

        out.extend(
            (start_i + a, start_i + b, pitch, vprob)
            for (a, b), pitch in zip(parts, pitches)
        )
    return out


def _strong_skyline(
    note_events: Sequence[tuple], times: np.ndarray
) -> np.ndarray:
    """Highest *strong* Basic Pitch pitch at each time in ``times``, NaN where silent.

    "Strong" means within ``MELODY_FLOOR_TAU`` of the loudest event sounding at that
    instant, and that qualifier is the difference between a useful statistic and a useless
    one: an unqualified skyline is a +12/+19 harmonic ghost of the melody most frames, so
    it reports the melody's register about one frame in five.  Amplitude separates the two
    because a ghost is quieter than what it ghosts.
    """
    sky = np.full(times.shape, np.nan)
    if not len(note_events):
        return sky
    starts = np.array([float(e[0]) for e in note_events])
    ends = np.array([float(e[1]) for e in note_events])
    pitches = np.array([float(e[2]) for e in note_events])
    amps = np.array([float(e[3]) for e in note_events])
    for i, t in enumerate(times):
        active = (starts <= t) & (t < ends)
        if not active.any():
            continue
        loud = active & (amps >= MELODY_FLOOR_TAU * amps[active].max())
        if loud.any():
            sky[i] = pitches[loud].max()
    return sky


def _melody_floor_hz(
    note_events: Sequence[tuple], times: np.ndarray, midi: np.ndarray
) -> float | None:
    """The register boundary that excludes the accompaniment, in Hz, or ``None`` to decline.

    Returns a frequency only when Basic Pitch's strong skyline and pyin's contour disagree
    about the register by more than ``MELODY_FLOOR_DISAGREEMENT_SEMITONES`` — i.e. only when
    there is positive evidence that pyin has locked onto a voice below the melody.  On every
    monophonic clip the two engines agree to within about a semitone and this returns
    ``None``, which is what keeps the 40 monophonic corpus cases byte-identical.

    Named an ``fmin`` throughout because that is what it originally was and still is on two
    routes — the posteriorgram-capture fallback in ``_segment_contour`` and the inference
    path's event filter.  On the primary route it is now a mask boundary on the contour head
    instead, which is what retired the failure mode this used to carry: raising pyin's
    ``fmin`` above a close accompaniment removes the mixture's strongest component from its
    search band while leaving the energy in the signal, and pyin then reports almost nothing
    rather than the melody.  See MELODY_FLOOR_MARGIN_SEMITONES for that measurement and
    ``Posteriorgram.melody_track`` for the tracker that does not have the failure, and the
    other MELODY_FLOOR_* constants for the numbers behind each threshold here.
    """
    sky = _strong_skyline(note_events, times)
    both = ~np.isnan(sky) & ~np.isnan(midi)
    if not both.any():
        return None

    disagreement = float(np.median(sky[both] - midi[both]))
    if disagreement < MELODY_FLOOR_DISAGREEMENT_SEMITONES:
        return None

    voiced_sky = sky[~np.isnan(sky)]
    median_register = float(np.median(voiced_sky))
    in_register = voiced_sky[
        np.abs(voiced_sky - median_register) <= MELODY_FLOOR_REGISTER_WIDTH
    ]
    if not in_register.size:
        return None

    floor_midi = float(in_register.min()) - MELODY_FLOOR_MARGIN_SEMITONES
    floor_hz = float(440.0 * 2.0 ** ((floor_midi - 69.0) / 12.0))
    if floor_hz <= PYIN_FMIN_HZ or floor_hz >= PYIN_FMAX_HZ:
        return None

    print(
        f"[notefusion] melody floor: Basic Pitch's skyline sits {disagreement:+.1f} "
        f"semitones above pyin's contour; re-running pyin from midi {floor_midi:.0f} "
        f"({floor_hz:.0f} Hz)",
        flush=True,
    )
    return floor_hz


def _segment_contour(
    wav_path: Path | np.ndarray,
    note_events: Sequence[tuple] = (),
    post: "Posteriorgram | None" = None,
) -> tuple[list[Event], float | None]:
    """Notes read off an f0 contour, with Basic Pitch's ``onset`` head not asked where they are.

    The melody-mode alternative to stages 3-6 of ``_transcribe_wav``: the amplitude floor,
    pyin refinement, onset merging, simultaneous dedup and the melody overlap resolver all
    exist to repair fragmentation that this path does not create, so it replaces all five
    rather than running before them.  ``settings.contour_first`` gates it and carries the
    measurement; ``_contour_segments`` is the rule, then ``_fuse_same_pitch`` repairs a
    wobble that outlasted it and ``_split_rearticulations`` puts repeated notes back.

    Returns ``([], None)`` when pyin declined to produce a contour at all — too long,
    unreadable, or no voiced frame — and the caller falls back to the inference path rather
    than failing the job, because all three of those causes are still reachable.  pyin's first
    pass therefore still gates this path even on a clip whose f0 comes from the posteriorgram:
    its ``times`` are the grid everything downstream is calibrated to.

    ``note_events`` are Basic Pitch's, passed in only so ``_melody_floor_hz`` can decide
    which voice pyin should track; on a mixture the default band makes pyin follow the
    lowest strong one.

    **Which contour gets segmented depends on whether the floor fired.**  Ungated, it is
    pyin's, unchanged.  Gated, it is ``post.melody_track`` — the argmax of Basic Pitch's
    ``contour`` head above the floor, resampled onto pyin's grid.  Re-running pyin from the
    raised floor was the earlier answer and it is strictly worse: the floor is raised
    *because* a strong voice sits below the melody, and taking that voice out of pyin's
    search band while leaving its energy in the signal is what makes pyin declare the clip
    unvoiced.  Measured on the three gated cases, second-pyin-pass then contour-head:
    ``close_voicing`` 4 notes -> 12 EXACT, ``poly_block_chords`` 2 -> 11 EXACT (it reached
    the inference path at all only because 2 fails the distinct-pitch floor),
    ``poly_alberti_bass`` 11 EXACT -> 11 EXACT.  The second pyin pass is gone with it, so
    this costs one argmax over a matrix already in memory and saves a pitch-tracking pass.
    ``post`` being ``None`` — capture failed — falls back to the second pass.

    The gate is the floor and nothing else.  pyin's own confidence cannot stand in for it,
    for the reason ``MELODY_FLOOR_MIN_DISTINCT_PITCHES`` records: a raised ``fmin`` depresses
    ``voiced_prob`` whatever the outcome, and monophonic ``vibrato_depth_2_0`` sits at 0.323
    while being transcribed perfectly — below both gated cases' neighbourhood.  Tying it to
    the floor is also what keeps the 40 monophonic corpus cases byte-identical by
    construction rather than by measurement: the floor fires on 0 of them.  That matters
    because the contour head is *not* a better tracker in general — see ``melody_track`` for
    the cases where it is worse than pyin.

    The second element of the return is that floor in MIDI units, or ``None`` if the gate
    declined, and it is returned **whether or not the contour succeeded**.  A raised floor is
    knowledge about the clip rather than about the contour: Basic Pitch's events above it
    covered 11 of 11 reference pitches on the two wrong-hand polyphonic cases, so when this
    path gives up the caller can still use the floor to keep the inference path off the
    accompaniment.
    Handing back ``[]`` with a floor is therefore a much stronger signal than ``[]`` alone,
    and the two ways to reach it — a contour carrying fewer than
    ``MELODY_FLOOR_MIN_DISTINCT_PITCHES``, and no stable-pitch run in it — are both cases
    where a tracker was pointed at the right register and still failed to follow the line.

    ``amp`` is per-segment RMS against the loudest segment in the clip.  Basic Pitch's
    posterior does not exist on this path and ``_blend_confidence`` weights ``amp``, so the
    honest substitute is a real amplitude measurement rather than a constant or a second
    copy of ``voiced_prob`` — which would make the blend's two independent terms one term.
    """
    import librosa

    times, midi, voiced_prob = _pyin_contour(wav_path)
    if times.size == 0:
        return [], None

    floor_hz = _melody_floor_hz(note_events, times, midi)
    floor_midi = (
        None if floor_hz is None else float(69.0 + 12.0 * np.log2(floor_hz / 440.0))
    )
    if floor_hz is not None:
        if post is not None:
            midi, voiced_prob = post.melody_track(floor_midi, times)
        else:
            times, midi, voiced_prob = _pyin_contour(wav_path, fmin=floor_hz)
            if times.size == 0:
                print(
                    "[notefusion] no periodic signal above the melody floor; "
                    "handing the clip to the inference path",
                    flush=True,
                )
                return [], floor_midi

        distinct = np.unique(np.round(midi[~np.isnan(midi)]))
        if distinct.size < MELODY_FLOOR_MIN_DISTINCT_PITCHES:
            print(
                f"[notefusion] the contour above the melody floor holds {distinct.size} "
                "distinct pitch(es), so it carries no melody; handing the clip to the "
                "inference path",
                flush=True,
            )
            return [], floor_midi

    segments = _contour_segments(times, midi, voiced_prob)
    if not segments:
        print("[notefusion] contour-first found no stable-pitch runs", flush=True)
        return [], floor_midi

    # times is one frame per pyin hop, so the hop is the frame spacing; a segment's last
    # frame still sounds for a whole hop, which is why end is padded by one.
    hop_sec = float(times[1] - times[0]) if times.size > 1 else 0.0

    try:
        if isinstance(wav_path, np.ndarray):
            rms = librosa.feature.rms(y=wav_path, hop_length=512)[0]
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                y, sr = librosa.load(str(wav_path), sr=22_050, mono=True)
            rms = librosa.feature.rms(y=y, hop_length=512)[0]
    except Exception:
        rms = np.empty(0)

    segments = _fuse_same_pitch(segments, times, hop_sec)
    segments = _split_rearticulations(segments, rms, midi)

    amps: list[float] = []
    for start_i, end_i, _m, _vp in segments:
        window = rms[start_i:end_i] if rms.size >= end_i else np.empty(0)
        amps.append(float(np.mean(window)) if window.size else 1.0)
    peak = max(amps) if amps else 0.0
    amps = [a / peak for a in amps] if peak > 0 else [1.0] * len(amps)

    events = [
        Event(
            start=float(times[start_i]),
            end=float(times[end_i - 1]) + hop_sec,
            pitch=int(round(median_midi)),
            amp=amp,
            pyin_midi=median_midi,
            voiced_prob=vp,
        )
        for (start_i, end_i, median_midi, vp), amp in zip(segments, amps)
    ]

    print(
        f"[notefusion] contour-first segmented {len(events)} notes "
        f"from {times.size} f0 frames",
        flush=True,
    )
    return events, floor_midi


def _refine_pitches(
    events: list[Event],
    wav_path: Path | np.ndarray,
    contour: tuple[np.ndarray, np.ndarray, np.ndarray] | None = None,
) -> list[Event]:
    """Correct pitch errors against a pyin f0 contour.

    Basic Pitch locks onto the second harmonic often enough to matter: measured on
    the clean synthetic control case, 9 of 15 detected events were a whole octave
    above the note that produced them — including notes whose fundamental was never
    reported at all.  That is why the *clean* case scored worse than the noisy one,
    since additive noise breaks the fundamental/overtone ambiguity.  pyin's median
    over the same span was within 0.01 semitones of the truth on every one of them.

    How far to trust that median is the ``pyin_semitone`` flag.  Off, only
    whole-octave disagreements are acted on: the objection to a general correction
    was that a fragment shorter than one vibrato cycle has a median biased toward
    wherever in the cycle it happens to sit, so on that evidence pyin looked *not*
    reliable to the semitone per fragment — while a bias of at most a semitone or so
    cannot manufacture or hide a twelve-semitone gap.  On, the median is rounded and
    taken as the pitch, because measurement retired that objection: the rounded
    median moved 45 notes across the corpus, 44 of them to the right pitch, and the
    one it moved wrongly was an accidental that became a diatonic note in an already-
    failing case.  ``pyin_semitone`` is on by default and gates the behavior.

    Every event that pyin could speak about leaves here carrying ``pyin_midi`` and
    ``voiced_prob``, on every branch — including the ones that decline to correct the
    pitch.  "pyin was unsure here" and "pyin disagreed and was overruled" are both
    signal about how much to trust the note, and this is the only place they exist.
    """
    times, midi, voiced_prob = contour if contour is not None else _pyin_contour(wav_path)
    if times.size == 0:
        return events

    refined: list[Event] = []
    corrected = 0
    for evt in events:
        span = (times >= evt.start) & (times <= evt.end) & ~np.isnan(midi)
        if int(span.sum()) < PYIN_MIN_VOICED_FRAMES:
            refined.append(evt)
            continue

        median_midi = float(np.median(midi[span]))
        confidence = float(np.median(voiced_prob[span]))
        measured = replace(evt, pyin_midi=median_midi, voiced_prob=confidence)
        if confidence < PYIN_MIN_VOICED_PROB:
            refined.append(measured)
            continue

        if settings.pyin_semitone:
            candidate = int(round(median_midi))
        else:
            octaves = round((median_midi - evt.pitch) / 12.0)
            offset = median_midi - evt.pitch - 12.0 * octaves
            if octaves == 0 or abs(offset) > PYIN_OCTAVE_TOLERANCE:
                refined.append(measured)
                continue
            candidate = evt.pitch + 12 * octaves

        if candidate == evt.pitch or not 0 <= candidate <= 127:
            refined.append(measured)
            continue

        refined.append(replace(measured, pitch=candidate))
        corrected += 1

    print(
        f"[notefusion] pyin refined {len(events)} notes ({corrected} pitch corrections)",
        flush=True,
    )
    return refined


def _sample_posteriors(events: list[Event], post: "Posteriorgram | None") -> list[Event]:
    """Stamp Basic Pitch's onset posterior onto events from either decode path.

    One stage serving both paths rather than an argument threaded into each, because the
    question it answers — "what did the onset head say where this note claims to start" —
    does not depend on which path proposed the note.  It runs last so it reads final
    boundaries; see the call site.

    A no-op when the capture failed, which leaves ``onset_post`` None and every consumer on
    its pre-capture behaviour.
    """
    if post is None or not events:
        return events
    return [replace(e, onset_post=post.onset_evidence(e.start, e.pitch)) for e in events]


def _blend_confidence(evt: Event) -> float:
    """Per-note confidence in [0, 1], combining amplitude and onset posterior evidence.

    Two terms, each in [0, 1]: Basic Pitch's note amplitude and its onset posterior, mixed
    at the weights the CONF_WEIGHT_AMP block sweeps.

    ``amp``          Basic Pitch's posterior on the inference path, per-segment RMS on the
                     contour path.  Still what the amplitude floor filters on.
    ``onset_post``   How hard Basic Pitch's onset head fired where this note starts.

    This used to be ``evt.amp`` alone, and that stopped working when the amplitude floor
    started firing: ``ADAPTIVE_FACTOR`` 0.25 -> 0.40 deletes exactly the events amplitude was
    correctly identifying as ghosts, so among the notes that survive the floor, amplitude
    ranks right from wrong much less well than it did.  A pyin-agreement term was added to
    fix that and did not: ``contour_first`` is on by default for melody, and on that path
    ``pitch`` is ``round(pyin_midi)`` — one measurement, not two — so agreement degenerates
    into "how near a whole semitone did the median sit" while ``amp`` is RMS loudness, which
    is not evidence about pitch at all.  Measured per-case, agreement lands at auc 0.448 and
    ``voiced_prob`` at 0.357, both at or below chance.

    ``onset_post`` is the term that works, because it is independent of pyin by construction:
    a different model, a different feature front-end, and a different *question* — where a
    note begins, rather than what pitch is sounding.  It alone lifts the two non-vibrato
    discriminating cases from auc 0.800/0.389 to 1.000/1.000.

    The onset term is added rather than multiplied in.  A missed onset is common and
    forgivable on a soft legato re-attack, so a zero there should lower a note's rank, not
    zero it out — which is the difference between ranking and gating, and this function only
    ranks.  Nothing here changes which notes exist or what pitch they carry, which is the
    property that makes an offline weight sweep legitimate: the note set, the matcher's
    pairing and the correct/wrong labels are all fixed no matter what the weights are, so a
    sweep over rows dumped from one corpus run computes the metric exactly rather than
    predicting it.

    **What this cannot fix.**  The three sustained-vibrato cases carry almost the whole
    remaining deficit, and their wrong notes are not ghosts invented from nothing — the
    segmenter cuts one vibrato'd note into a staircase of real pitch excursions, so the onset
    head fires genuinely at each one.  No confidence weighting can rank away a note that is
    physically present in the audio; that is a segmentation defect, not a scoring one.
    """
    amp = float(min(max(evt.amp, 0.0), 1.0))
    if evt.onset_post is None:
        return amp
    onset = float(min(max(evt.onset_post, 0.0), 1.0))
    total = CONF_WEIGHT_AMP + CONF_WEIGHT_ONSET
    blended = (CONF_WEIGHT_AMP * amp + CONF_WEIGHT_ONSET * onset) / total
    return float(min(max(blended, 0.0), 1.0))


import warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)


_BASIC_PITCH_MODEL = None
_BASIC_PITCH_MODEL_LOCK = threading.Lock()


def get_basic_pitch_model():
    """Return one process-local Basic Pitch model, loading it exactly once.

    The ONNX session is thread-safe for inference in the pinned Basic Pitch runtime.
    Keeping the model alive avoids rebuilding/loading it for every request.  The lock
    only protects first use; normal requests never serialize on initialization.
    """
    global _BASIC_PITCH_MODEL
    if _BASIC_PITCH_MODEL is None:
        with _BASIC_PITCH_MODEL_LOCK:
            if _BASIC_PITCH_MODEL is None:
                from basic_pitch import ICASSP_2022_MODEL_PATH
                from basic_pitch.inference import Model

                _BASIC_PITCH_MODEL = Model(ICASSP_2022_MODEL_PATH)
    return _BASIC_PITCH_MODEL


def _inject_apt_path() -> None:
    """Ensure Heroku APT-installed binaries (ffmpeg, etc.) are on PATH at runtime.

    heroku-buildpack-apt only sets PATH during the *build* phase; the web dyno
    starts uvicorn with a clean environment that may not include /app/.apt/usr/bin.
    Calling this once at module import makes shutil.which('ffmpeg') reliable.
    """
    import os

    for apt_dir in ("/app/.apt/usr/bin", "/app/.apt/bin", "/app/.apt/usr/lib"):
        current_path = os.environ.get("PATH", "")
        if apt_dir not in current_path and apt_dir.endswith("bin"):
            os.environ["PATH"] = apt_dir + ":" + current_path
        # Also extend LD_LIBRARY_PATH so shared libs (libavcodec etc.) are found
        current_ld = os.environ.get("LD_LIBRARY_PATH", "")
        if "lib" in apt_dir and apt_dir not in current_ld:
            os.environ["LD_LIBRARY_PATH"] = apt_dir + ":" + current_ld


_inject_apt_path()


def _build_apt_env() -> dict:
    """Build a subprocess env dict with all APT lib subdirs on LD_LIBRARY_PATH.

    heroku-buildpack-apt installs shared libs under /app/.apt/usr/lib but nested
    packages (e.g. libpulse0) put their internal .so files in subdirectories like
    /app/.apt/usr/lib/x86_64-linux-gnu/pulseaudio/.  We walk the tree up to 3
    levels deep so every such path is included — no matter which Ubuntu version
    Heroku uses.
    """
    import os
    env = os.environ.copy()

    # ── PATH: bin dirs ────────────────────────────────────────────────────────
    for apt_bin in ("/app/.apt/usr/bin", "/app/.apt/bin"):
        if apt_bin not in env.get("PATH", ""):
            env["PATH"] = apt_bin + ":" + env.get("PATH", "")

    # ── LD_LIBRARY_PATH: walk /app/.apt/usr/lib up to 3 levels deep ──────────
    apt_lib_root = Path("/app/.apt/usr/lib")
    lib_dirs: list[str] = []
    if apt_lib_root.exists():
        # level 0
        lib_dirs.append(str(apt_lib_root))
        for l1 in apt_lib_root.iterdir():
            if l1.is_dir():
                lib_dirs.append(str(l1))          # level 1 (e.g. x86_64-linux-gnu)
                for l2 in l1.iterdir():
                    if l2.is_dir():
                        lib_dirs.append(str(l2))  # level 2 (e.g. pulseaudio, mesa)

    current_ld = env.get("LD_LIBRARY_PATH", "")
    for d in lib_dirs:
        if d not in current_ld:
            current_ld = d + ":" + current_ld
    env["LD_LIBRARY_PATH"] = current_ld
    return env


def _find_ffmpeg_cmd() -> str:
    import shutil

    for cand in (
        "/app/.apt/usr/bin/ffmpeg",
        "/app/.apt/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ):
        if Path(cand).is_file():
            print(f"[notefusion] ffmpeg found at: {cand}", flush=True)
            return cand

    found = shutil.which("ffmpeg")
    if found:
        print(f"[notefusion] ffmpeg found via PATH: {found}", flush=True)
        return found

    print("[notefusion] WARNING: ffmpeg not found in any known location", flush=True)
    return "ffmpeg"


def _ensure_wav_path(audio_path: Path) -> tuple[Path, bool]:
    """Ensure audio_path is a valid PCM WAV file before AMT inference.

    If audio_path is already a .wav file, returns (audio_path, False).
    If audio_path is .m4a, .aac, .mp3, etc., converts to a temporary 22 050 Hz PCM .wav file
    via ffmpeg (or soundfile/librosa fallback) and returns (tmp_wav_path, True).
    """
    if audio_path.suffix.lower() == ".wav":
        return audio_path, False

    import subprocess
    import tempfile

    tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_wav_path = Path(tmp_wav.name)
    tmp_wav.close()

    ffmpeg_bin = _find_ffmpeg_cmd()
    apt_env = _build_apt_env()
    print(f"[notefusion] Converting {audio_path.name} -> WAV via {ffmpeg_bin}", flush=True)
    try:
        res = subprocess.run(
            [
                ffmpeg_bin,
                "-y",
                "-i",
                str(audio_path),
                "-ar",
                "22050",
                "-ac",
                "1",
                "-f",
                "wav",
                str(tmp_wav_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
            check=False,
            env=apt_env,
        )
        if res.returncode == 0 and tmp_wav_path.stat().st_size > 0:
            print(f"[notefusion] ffmpeg OK -> {tmp_wav_path.stat().st_size} bytes", flush=True)
            return tmp_wav_path, True
        else:
            stderr_snippet = res.stderr.decode(errors="replace")[-600:]
            print(
                f"[notefusion] ffmpeg FAILED rc={res.returncode}:\n{stderr_snippet}",
                flush=True,
            )
    except FileNotFoundError as exc:
        print(f"[notefusion] ffmpeg FileNotFoundError: {exc}", flush=True)
    except Exception as exc:
        print(f"[notefusion] ffmpeg subprocess error: {exc}", flush=True)

    # ── librosa fallback ──────────────────────────────────────────────────────
    print("[notefusion] Trying librosa fallback for WAV conversion", flush=True)
    try:
        import soundfile as sf
        import librosa

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        sf.write(str(tmp_wav_path), y, sr, format="WAV", subtype="PCM_16")
        print(f"[notefusion] librosa fallback OK -> {tmp_wav_path.stat().st_size} bytes", flush=True)
        return tmp_wav_path, True
    except Exception as exc:
        print(f"[notefusion] librosa fallback FAILED: {exc}", flush=True)

    tmp_wav_path.unlink(missing_ok=True)
    print(f"[notefusion] All conversion strategies failed; passing original {audio_path.name} to basic_pitch", flush=True)
    return audio_path, False


def _transcribe_inner(
    audio_path: Path,
    mode: str = "melody",
    key_override: str | None = None,
    tempo_override: int | None = None,
    time_signature: str = "4/4",
    progress=lambda fraction: None,
) -> TranscriptionResult:
    target_path, is_temp_wav = _ensure_wav_path(audio_path)
    try:
        try:
            return _transcribe_wav(
                target_path,
                mode,
                key_override,
                tempo_override,
                time_signature=time_signature,
                progress=progress,
            )
        except TypeError:
            return _transcribe_wav(
                target_path,
                mode,
                key_override,
                tempo_override,
                progress,
            )
    finally:
        if is_temp_wav:
            target_path.unlink(missing_ok=True)

def transcribe(
    audio_path: Path,
    mode: str = "melody",
    key_override: str | None = None,
    tempo_override: int | None = None,
    time_signature: str = "4/4",
    progress=lambda fraction: None,
) -> TranscriptionResult:
    import time
    import librosa
    from app.telemetry import emit_transcription_event
    
    t0 = time.perf_counter()
    error_class = None
    res = None
    duration = 0.0
    
    try:
        try:
            duration = librosa.get_duration(path=str(audio_path))
        except Exception:
            duration = 0.0
            
        res = _transcribe_inner(
            audio_path, mode, key_override, tempo_override, time_signature, progress
        )
        return res
    except Exception as e:
        error_class = e.__class__.__name__
        raise
    finally:
        t_total = time.perf_counter() - t0
        
        if duration < 5:
            bucket = "<5s"
        elif duration <= 30:
            bucket = "5-30s"
        elif duration <= 60:
            bucket = "30-60s"
        else:
            bucket = ">60s"
            
        emit_transcription_event(
            experiment_arm="contour_gap" if settings.contour_gap_merge else "control",
            git_sha=os.environ.get("HEROKU_SLUG_COMMIT", "unknown"),
            model_version="icassp_2022",
            mode=mode,
            clip_duration_bucket=bucket,
            n_est_notes=len(res.notes) if res else 0,
            contour_merge_count=0, # To be precise we'd need to modify _merge_contour_gaps
            merge_gap_buckets={},
            n_candidate_ghosts=0,
            n_candidate_accidentals=0,
            stage_timings_ms={"total": t_total * 1000},
            error_class=error_class
        )



# ── Tempo and beat phase ──────────────────────────────────────────────────────

# Beat tracking is only trusted inside this range: librosa returns NaN on very
# short or near-silent clips and values well outside it on unusual material.
_MIN_BPM = 20.0
_MAX_BPM = 400.0
_DEFAULT_BPM = 100.0

# Choosing a tempo is two questions, and the mistake to avoid is answering them with
# one number.
#
# *Does the beat divide the notes?* is the question that matters, and it is decided on
# evidence: under a commensurate tempo the onsets land on grid positions and
# quantization is a no-op, while under an incommensurate one a run of equal notes gets
# snapped alternately to two different values and is engraved — and heard — as a
# lurch.  That is a yes/no property, so it is used as a filter and not as a score.
#
# *Which metrical level?* — 88 BPM in quarters or 176 in eighths — audio cannot
# settle, so convention does: prefer the answer nearest the tempo a person taps.
#
# Scoring both at once by minimising the grid error does not work, and the failure is
# not subtle.  A fixed onset jitter is a larger fraction of a grid step at a faster
# tempo, so an error measured in steps always favours the slowest candidate (the
# corpus walked down to 48 BPM); converting to seconds inverts it, because a fast
# candidate's grid is dense enough to fit anything (the corpus ran up to 345 BPM).
# Neither unit is scale-free, and both biases are large enough to swamp the real
# signal.  Filter-then-prefer needs no unit that is fair across octaves, because the
# two axes are never compared numerically.
#
# Nor can the metrical level be folded into a fixed band up front, tempting as that
# is: the quantizer's grid is a division of the *beat*, so the level sets how fine the
# grid is in real time.  A run of sixteenths at 88 does not fit an eighth grid at all;
# the same music read as eighths at 176 fits it exactly.
_TEMPO_PREFERENCE_BPM = 100.0

# The range a beat can be *notated* in, which is narrower than the ``_MIN_BPM``..
# ``_MAX_BPM`` range librosa is trusted to report inside: those bound what a tracker
# might plausibly measure, these bound what a tempo mark can plausibly say.  Below and
# above this, convention reads the same music one metrical level in — nobody writes a
# quarter at 340 — and both ends matter here.  The top end is load-bearing: on the
# heavily fragmented vibrato clips the median inter-onset interval is a vibrato
# fragment rather than a note, which seeds candidates in the hundreds, and a grid that
# fine fits almost any onset sequence.  Capping the candidates is what stops that,
# because the filter alone cannot: the fit really is good, it is the reading that is
# absurd.
_MIN_NOTATED_BPM = 40.0
_MAX_NOTATED_BPM = 200.0

# How far, in grid steps, the onsets may sit from the grid and still count as landing
# on it.  A step is what quantization rounds to, so this is really "does rounding move
# these notes to a different slot".
#
# Measured on the corpus's real Basic Pitch onsets, the two readings are cleanly
# separated: the candidates that are the right answer measure 0.090 and 0.144, and every
# wrong one measures 0.209 or more, with nothing in between.  This sits in the middle of
# that empty band rather than at its edge, which is where an earlier 0.15 sat — correct on
# the same evidence, but leaving the noisiest passing case a 4 % margin against onset
# jitter that varies with the material.
#
# It is level-biased and no value of it could not be: a fixed onset jitter is a smaller
# fraction of a step at a slower tempo, so of two readings of one performance the slower
# always measures better here.  That is corrected downstream rather than by moving this
# number — see the re-admission in ``_grid_bpm``, which is where the bias was measured
# changing an answer.
#
# When nothing passes, ``_grid_bpm`` declines and librosa's estimate stands — the same
# answer as before this existed.  That is not a rare path and not a failure: on
# ``fast_sixteenths_c_major`` the detected onsets are ~38 ms from evenly spaced, which is
# 22 % of a 174 ms note and triple Basic Pitch's frame hop, so no tempo makes them
# commensurate and every candidate is correctly refused.
_MAX_GRID_SLIP_STEPS = 0.175

# Survivors are compared on fit rounded to this many seconds, and only then on
# tappability.  Two units, each where it is the right one: the filter above asks "does
# rounding put this note in the right slot", which is a question about steps, and this
# asks "how far does rounding actually move the audio", which is a question about time.
# Using steps here instead looks natural and is wrong — a fixed jitter is a larger
# fraction of a step at a faster tempo, so the same recording measured at 96 BPM scores
# worse than at 48, and the chooser quietly halves the tempo.  In seconds the two are
# indistinguishable, which is the point: they describe the same performance, so the
# preference gets to decide.
#
# A band is needed at all because a candidate that merely scrapes past the filter can
# otherwise win on the preference alone: a run of sixteenths admits both 176 BPM, where
# they are exactly eighths, and librosa's 172.5, where they drift most of a step across
# the phrase, and 172.5 is the marginally more tappable of the two.  10 ms is just under
# Basic Pitch's ~11.6 ms frame hop, so differences this small are below what the onsets
# resolve anyway.
_GRID_FIT_BAND_SEC = 0.010

# What the most common note length might be relative to the beat: a sixteenth, a
# triplet eighth, an eighth, a triplet quarter, the beat itself, or a note spanning
# one and a half, two, three or four beats.  Wider costs nothing directly — every
# candidate still has to land on the grid — but past a factor of four the beat periods
# are ones no listener would tap.
_TEMPO_CANDIDATE_FACTORS = (0.25, 1.0 / 3.0, 0.5, 2.0 / 3.0, 1.0, 1.5, 2.0, 3.0, 4.0)

# Which ratios count as "the same performance, one level in" when re-admitting a candidate
# the step filter rejected.  Doublings and their compounds only: 2, 3 and 4 are the ways one
# beat subdivides into another beat, so a candidate at one of these ratios to an accepted one
# is a re-notation of it.  1.5 and 2/3 are deliberately absent — a dotted relationship
# changes which notes are beats rather than how many beats there are, so admitting one would
# let the chooser invent a metre it has no evidence for.  An empty tuple disables the
# re-admission entirely, which is how it was A/B'd.
_OCTAVE_ADMIT_RATIOS = (2.0, 3.0, 4.0)

# How exactly the ratio must hold.  The candidates are built by multiplying one measured
# median, so partners are exact to floating point when they come from the factor family and
# within a fraction of a percent when one of them came from librosa.  2% is loose enough for
# the latter and far tighter than the 33% gap to the nearest ratio it must not reach.
_OCTAVE_ADMIT_TOLERANCE = 0.02

# ── Grid refinement (``_refine_grid``) ────────────────────────────────────────
# How far the refinement may move the BPM it is handed, as a fraction.  1% cannot reach
# any adjacent metrical level — the nearest is 33% away — so picking the level stays
# ``_grid_bpm``'s job, which is where it is measured.  The band is what stops the search,
# not the objective: distance-to-grid falls monotonically as the tempo rises (at a high
# enough BPM every onset is near *some* grid line), so an unbounded sweep of it runs away.
#
# Wider was measured and buys nothing.  At 3% and 5% the guards are unchanged or a hair
# better while the three over-segmented deep-vibrato cases get worse — their spurious
# onsets are half the sample, so a longer leash only fits them harder.
_GRID_REFINE_BAND = 0.01

# Sweep resolution.  121 points over +-1% is 0.017% per step, or 0.016 BPM at 96 — an
# order of magnitude finer than the 0.31% error this exists to remove, and both counts are
# ODD on purpose so the linspace lands exactly on the values handed in.  That makes the
# incumbent a member of its own search space, so the refinement cannot return a worse grid
# fit than it started with and needs no accept/reject test.
_GRID_REFINE_BPM_STEPS = 121
_GRID_REFINE_PHASE_STEPS = 201

# Fewer onsets than this and the sweep is interpolating rather than fitting: the leverage
# on the slope is the clip's length in beats, and the whole point is to average the frame
# hop's +-11.6 ms out over many of them.  Matches ``_grid_bpm``'s own floor.
_GRID_REFINE_MIN_ONSETS = 4


def _onset_bpm(events: list[Event]) -> float:
    """Rough BPM from the median inter-onset interval; 0.0 when unusable.

    Secondary strategy for when beat tracking gives nothing — it assumes the
    most common note length *is* the beat, which is wrong often enough that it
    only runs after librosa has already failed.
    """
    onsets = np.array([e.start for e in events])
    if len(onsets) < 4:
        return 0.0
    iois = np.diff(onsets)
    usable = iois[iois > 0.05]  # ignore glitches
    if usable.size == 0:
        return 0.0
    median_ioi = float(np.median(usable))
    return 60.0 / median_ioi if median_ioi > 0 else 0.0


def _grid_residual(
    onsets: np.ndarray, bpm: float, divisors: tuple[int, ...]
) -> tuple[float, float]:
    """Distance from the onsets to the grid they will be quantized onto.

    Returns it twice, in grid steps and in seconds, both for whichever of the offered
    divisors fits best — that being what music21's ``quantize`` does with a
    multi-divisor grid, which snaps each note to whichever grid suits it.  Callers want
    both because the two answer different questions: 0.5 steps is the worst a note can
    be placed regardless of tempo, while seconds is the only unit in which the same
    performance scores alike at every metrical level.  See ``_grid_bpm``, which uses
    one to filter and the other to rank.
    """
    beats = (onsets - onsets[0]) * (bpm / 60.0)
    divisor, steps = min(
        (
            (d, float(np.mean(np.abs(beats * d - np.round(beats * d)))))
            for d in divisors
        ),
        key=lambda pair: pair[1],
    )
    return steps, steps * 60.0 / (bpm * divisor)


def _grid_bpm(
    events: list[Event],
    tracked_bpm: float,
    divisors: tuple[int, ...],
    extra_candidates: Sequence[float] = (),
) -> float:
    """The most tappable tempo under which the onsets land on the grid; 0.0 if none.

    The onsets are stronger tempo evidence than librosa's spectral flux on this
    material — Basic Pitch has already segmented the notes, so their starts are known
    rather than inferred from an envelope — but the median inter-onset interval alone
    is not enough, because it says how long the commonest note is and not which
    metrical level it occupies.  So that interval seeds a family of candidates,
    librosa's estimate joins them on equal terms, every candidate has to survive the
    grid filter, and the survivor that fits best and taps most naturally wins.

    Declining (0.0) when nothing survives is deliberate: a clip whose onsets fit no
    simple grid is one this has nothing to say about, and librosa's answer is a better
    guess than the least-bad of a set of rejected ones.

    Scored per case over the corpus, 33 of 39 land on the reference metrical level and the
    six that do not are three separate things, only one of which is this function's:

      * ``vibrato_depth_1_8``, ``vibrato_depth_2_0``, ``vibrato_rate_k20`` — over-segmented,
        so the median interval is a vibrato fragment.  A note-count defect upstream; the
        tempo is downstream of it.
      * ``fast_sixteenths_c_major`` (4x) and ``triplets_eighth_c_major`` (1.5x) — the
        shortest note is not expressible on the half-beat grid ``quantize_divisors`` ships
        with, so the only reading that lands on it is one where that note becomes a half
        beat.  Both score notes.f1 1.000: the notes are right in seconds and it is the tempo
        mark and the note VALUES that are wrong.  The price of ``(2,)``, which is a measured
        decision recorded at ``settings.quantize_divisors``, not a defect here.
      * ``drift_1_semitone`` (1.5x) — the 1.5 reading genuinely fits better (bucket 3 against
        5) because two of its eleven notes are wrong.  Its own notes.f1 is 0.818.

    So there is no further clean level bug on this corpus, and a tiebreak invented to move
    any of the six would be fitted to a defect that lives somewhere else.
    """
    onsets = np.array([e.start for e in events])
    if onsets.size < 4:
        return 0.0
    iois = np.diff(onsets)
    usable = iois[iois > 0.05]  # ignore glitches, as _onset_bpm does
    if usable.size == 0:
        return 0.0

    unit_bpm = 60.0 / float(np.median(usable))
    candidates = {unit_bpm * factor for factor in _TEMPO_CANDIDATE_FACTORS}
    if tracked_bpm > 0.0:
        # librosa's answer and its two neighbouring metrical levels.  Included so a
        # clip whose onsets are too fragmented to give a clean median — heavy vibrato,
        # for instance — can still be carried by the tracker.
        candidates |= {tracked_bpm * factor for factor in (0.5, 1.0, 2.0)}
    for extra in extra_candidates:
        if extra > 0.0:
            candidates |= {extra * factor for factor in (0.5, 1.0, 2.0)}

    in_range = []
    for bpm in candidates:
        if not _MIN_NOTATED_BPM <= bpm <= _MAX_NOTATED_BPM:
            continue
        steps, seconds = _grid_residual(onsets, bpm, divisors)
        in_range.append((bpm, steps, seconds))

    on_grid = [(bpm, sec) for bpm, steps, sec in in_range if steps <= _MAX_GRID_SLIP_STEPS]
    if not on_grid:
        return 0.0

    # The step filter above is level-biased and cannot help being: a fixed onset jitter is
    # a smaller fraction of a step at a slower tempo, so of two readings of the SAME
    # performance the slower one always measures better in steps.  Where that bias decides
    # the outcome, the faster reading is admitted here so the preference gets to choose the
    # notation instead.  The test for "same performance" is the seconds fit, which is the
    # only level-fair unit (see ``_GRID_FIT_BAND_SEC``): an equal seconds fit at an integer
    # ratio is one performance written two ways, and which way to write it is a question
    # about tappability, not about fit.
    #
    # Admitted candidates carry their partner's seconds rather than their own, which is the
    # whole point — they are admitted *because* the two fits are indistinguishable, so
    # letting a 6 ms difference then win the ranking would just reintroduce the bias with
    # the opposite sign.  Measured: without this, ``vibrato_heavy`` reports 48 against a
    # true 96, its correct level having been filtered out at 0.323 steps while the halved
    # one passed at 0.162 — with the two agreeing to the millisecond in seconds.
    accepted = tuple(on_grid)
    for bpm, steps, seconds in in_range:
        if steps <= _MAX_GRID_SLIP_STEPS:
            continue
        for acc_bpm, acc_seconds in accepted:
            ratio = bpm / acc_bpm
            if abs(seconds - acc_seconds) > _GRID_FIT_BAND_SEC:
                continue
            if any(abs(ratio - r) <= _OCTAVE_ADMIT_TOLERANCE * r for r in _OCTAVE_ADMIT_RATIOS):
                on_grid.append((bpm, acc_seconds))
                break

    def rank(pair: tuple[float, float]) -> tuple[int, float]:
        bpm, seconds = pair
        # Ratio, not difference, for the preference: 80 and 125 BPM are equally far
        # from 100.
        return (
            round(seconds / _GRID_FIT_BAND_SEC),
            abs(float(np.log(bpm / _TEMPO_PREFERENCE_BPM))),
        )

    return min(on_grid, key=rank)[0]


def _estimate_tempo_and_beats(
    wav_path: Path | np.ndarray,
    events: list[Event],
    tempo_override: int | None,
    post: "Posteriorgram | None" = None,
    sr: int = 22_050,
) -> tuple[float, np.ndarray]:
    """(BPM, detected beat times in seconds) for the decoded WAV.

    A user tap-in override always wins for the BPM (TRD par. 5), but beat
    tracking still runs — seeded with that BPM — because the override says how
    fast the piece is, not where its downbeats sit.  Beat times come back empty
    when tracking fails, which ``_beat_origin`` reads as "no phase information".

    Absent an override the BPM comes from ``_grid_bpm``, which weighs librosa's
    estimate against the detected onsets instead of taking it on trust; the beat
    *times* still come from librosa either way, since nothing else here knows where
    the downbeats are.  A tempo that loses the vote is only ever off by a metrical
    level, which does not move the phase by more than the window ``_beat_origin``
    already applies.
    """
    import librosa

    override_bpm = float(tempo_override) if tempo_override else 0.0

    beat_times = np.empty(0)
    tracked_bpm = 0.0
    try:
        if isinstance(wav_path, (str, Path)):
            y, sr = _load_audio(wav_path, sr=sr)
        else:
            y = np.asarray(wav_path, dtype=np.float32)

        seed = {"start_bpm": override_bpm} if override_bpm else {}
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            raw_est, beats = librosa.beat.beat_track(y=y, sr=sr, units="time", **seed)
        raw_bpm = float(np.atleast_1d(raw_est)[0])
        if np.isfinite(raw_bpm) and _MIN_BPM <= raw_bpm <= _MAX_BPM:
            tracked_bpm = raw_bpm
        candidates = np.asarray(beats, dtype=float).ravel()
        beat_times = candidates[np.isfinite(candidates)]
    except Exception as exc:
        print(f"[notefusion] librosa beat_track failed ({exc}); falling back to onsets/default", flush=True)

    neural_bpm = 0.0
    if post is not None and post.onset.shape[0] > 10:
        try:
            onset_env = np.sum(post.onset, axis=1)
            hop = int(round(sr * (post.times[1] - post.times[0]))) if post.times.size > 1 else 256
            seed_ne = {"start_bpm": override_bpm} if override_bpm else {}
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                raw_neural, _ = librosa.beat.beat_track(
                    onset_envelope=onset_env, sr=sr, hop_length=hop, **seed_ne
                )
            n_bpm = float(np.atleast_1d(raw_neural)[0])
            if np.isfinite(n_bpm) and _MIN_BPM <= n_bpm <= _MAX_BPM:
                neural_bpm = n_bpm
        except Exception:
            pass

    if override_bpm:
        return override_bpm, beat_times

    if settings.tempo_grid:
        grid_bpm = _grid_bpm(
            events, tracked_bpm, settings.quantize_divisors, extra_candidates=(neural_bpm,)
        )
        if grid_bpm > 0.0:
            return grid_bpm, beat_times

    if tracked_bpm > 0.0:
        return tracked_bpm, beat_times

    onset_bpm = _onset_bpm(events)
    fallback = onset_bpm if _MIN_BPM <= onset_bpm <= _MAX_BPM else _DEFAULT_BPM
    return fallback, beat_times


def _beat_origin(beat_times: np.ndarray, first_onset: float, bpm: float) -> float:
    """The instant, in seconds, that should map to beat 0.

    Basic Pitch reports note times relative to the *file*, so a count-in or any
    leading silence shifts the entire melody off the barline — the largest
    timing defect in the pipeline, because every bar line and every solfa line
    is drawn from these offsets.  The fix is to measure from a detected beat
    instead: the last one at or before the first surviving onset, provided it is
    within half a beat.  Further back than that and the grid is describing some
    other beat, not this onset, so the offset would be a guess dressed up as
    evidence.  With no usable beat at all, anchoring the first note to beat 0 is
    still strictly better than preserving the silence.
    """
    if beat_times.size:
        earlier = beat_times[beat_times <= first_onset]
        if earlier.size:
            candidate = float(earlier[-1])
            if (first_onset - candidate) <= 30.0 / bpm:  # half a beat period
                return candidate
    return first_onset


def _refine_grid(
    onsets: np.ndarray,
    bpm: float,
    beat_origin: float,
    divisors: tuple[int, ...],
    band: float = _GRID_REFINE_BAND,
) -> tuple[float, float]:
    """(BPM, beat origin) re-measured against the grid the notes will actually snap to.

    Both numbers arrive estimated from a *single* sample and both are systematically
    wrong because of it.

    ``_grid_bpm`` takes 60/median(inter-onset interval), and an interval is a difference
    of two onsets that can only fall on frame boundaries — 23.2 ms for the contour path,
    ~11.6 ms for Basic Pitch.  A true 0.625 s beat is 26.94 frames at the coarser hop, so
    the nearest value any single interval can express is 27 frames = 95.70 BPM.  96 is not
    reachable at any threshold; it is a quantization floor, not a tuning miss.  Over a
    62 s clip that 0.31 % error accumulates to a quarter of a beat.

    ``_beat_origin`` nails beat 0 to the first surviving onset whenever no tracked beat
    sits near it, so every other note inherits that one onset's error — and the first
    onset is the least representative in the clip, because a pitch tracker needs voiced
    frames before it commits.  Measured on ``long_clip_over_pyin_cap``: first onset 0.093 s
    late against ~0.02 s for the rest, which reads as every *other* note being 0.185 beats
    early.

    Neither alone crosses the half-step boundary the quantizer rounds on.  Together they
    swept the residue from −0.185 to +0.056 beats across that clip, so some notes rounded
    up and some down, and each crossing cost exactly half a beat.  It was worth 0.485 →
    1.000 of local ``notes.f1`` on a clip whose segmentation was already 99 of 99.

    A clip's whole length is the fix for both: sweep the tempo inside ``band`` and, for
    each candidate, search the origin across one grid step, keeping whichever pair puts
    the onsets closest to the grid.  The slope is then measured over every beat in the
    clip rather than between adjacent pairs, which divides the hop quantization by their
    number instead of paying it in full, and the origin becomes a consensus over all the
    onsets instead of a copy of the first.

    The origin search is centred on the ``beat_origin`` handed in and spans exactly one
    grid step, which is what keeps ``_beat_origin``'s own job intact: quantization only
    sees position *modulo* the step, so one step covers every reachable phase, while the
    integer cell the first note lands in — that is, whether a count-in is preserved as a
    leading rest — is still decided upstream.

    ``band=0.0`` refines the origin alone, for a caller whose BPM is not ours to move.
    """
    if onsets.size < _GRID_REFINE_MIN_ONSETS or bpm <= 0.0:
        return bpm, beat_origin

    steps = _GRID_REFINE_BPM_STEPS if band > 0.0 else 1
    best = (bpm, beat_origin, np.inf)
    for candidate in np.linspace(bpm * (1.0 - band), bpm * (1.0 + band), steps):
        for divisor in divisors:
            # One grid step of origin, in seconds, at this candidate tempo.
            step_sec = 60.0 / (float(candidate) * divisor)
            phases = beat_origin + np.linspace(
                -step_sec / 2.0, step_sec / 2.0, _GRID_REFINE_PHASE_STEPS
            )
            scaled = (onsets[None, :] - phases[:, None]) * (float(candidate) / 60.0) * divisor
            cost = np.mean(np.abs(scaled - np.round(scaled)), axis=1)
            i = int(np.argmin(cost))
            if float(cost[i]) < best[2]:
                best = (float(candidate), float(phases[i]), float(cost[i]))
    return best[0], best[1]


@dataclass(frozen=True)
class DecodingStrategy:
    """Named decoding strategy selecting inference thresholds and stages (W7)."""
    name: str
    onset_thresh: float
    frame_thresh: float
    min_note_ms: int
    min_amp_base: float
    merge_gap: float
    contour_first: bool
    resolve_overlaps: bool

    def melodia_trick(self) -> bool:
        raise NotImplementedError


class MelodyStrategy(DecodingStrategy):
    """Monophonic melody extraction strategy.

    Optimized for vocal, humming, and single-instrument lines:
    lower onset threshold, longer minimum note duration, contour-first decoding,
    and overlap resolution.
    """
    def __init__(self) -> None:
        super().__init__(
            name="melody",
            onset_thresh=0.35,
            frame_thresh=0.25,
            min_note_ms=100,
            min_amp_base=MIN_AMPLITUDE_MELODY,
            merge_gap=MERGE_GAP_MELODY,
            contour_first=True,
            resolve_overlaps=True,
        )

    def melodia_trick(self) -> bool:
        return not settings.onset_gate


class PolyStrategy(DecodingStrategy):
    """Polyphonic transcription strategy.

    Preserves simultaneous notes, fast arpeggios, and multi-voice chords
    with tighter onset merging and no overlap flattening.
    """
    def __init__(self) -> None:
        super().__init__(
            name="poly",
            onset_thresh=0.45,
            frame_thresh=0.30,
            min_note_ms=80,
            min_amp_base=MIN_AMPLITUDE_POLY,
            merge_gap=MERGE_GAP_POLY,
            contour_first=False,
            resolve_overlaps=False,
        )

    def melodia_trick(self) -> bool:
        return True


def get_decoding_strategy(mode: str) -> DecodingStrategy:
    """Factory returning the named decoding strategy for a transcription mode."""
    if mode == "melody":
        return MelodyStrategy()
    return PolyStrategy()


def _transcribe_wav(
    wav_path: Path,
    mode: str,
    key_override: str | None,
    tempo_override: int | None,
    time_signature: str = "4/4",
    progress=lambda fraction: None,
) -> TranscriptionResult:
    from basic_pitch.inference import predict
    from music21 import key as m21key
    from music21 import meter, stream
    from music21 import note as m21note
    from music21 import tempo as m21tempo
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    progress(0.05)

    # ── 1. AMT inference ──────────────────────────────────────────────────────
    # W7: Mode selects a named DecodingStrategy encapsulating thresholds and stages.
    strategy = get_decoding_strategy(mode)
    onset_thresh = strategy.onset_thresh
    frame_thresh = strategy.frame_thresh
    min_note_ms = strategy.min_note_ms
    max_freq_hz = 1050.0
    melodia_trick = strategy.melodia_trick()

    model_output, midi_data, note_events = predict(
        str(wav_path),
        get_basic_pitch_model(),
        onset_threshold=onset_thresh,
        frame_threshold=frame_thresh,
        minimum_note_length=min_note_ms,
        maximum_frequency=max_freq_hz,
        melodia_trick=melodia_trick,
    )

    # The three frame-level posteriors ``predict`` computed on the way to ``note_events``,
    # which this line used to bind to ``_``.  See ``Posteriorgram`` for what they are and why
    # discarding them cost more than anything else in this function; ``None`` here means the
    # capture failed and every consumer falls back to its pre-capture behaviour.
    post = Posteriorgram.capture(model_output)

    # Basic Pitch's list before the melody floor narrows it below.  ``midi_data`` was built
    # from exactly this, so step 12 needs it to re-stamp the tempo without also changing
    # which notes the .mid contains.
    all_note_events = list(note_events)

    # Load and pre-condition audio in-memory to share across contour, pyin, and tempo stages
    y, sr = _load_audio(wav_path, sr=22_050)
    y = _condition_audio(y, sr=sr)

    progress(0.45)

    # ── 2-6. Note events ──────────────────────────────────────────────────────
    # Two ways to turn the audio into a list of Events.  The contour-first path reads them
    # straight off an f0 contour; the inference path repairs Basic Pitch's fragments through
    # five stages.  Either way ``midi_data`` above is kept — it is Basic Pitch's own
    # multi-track MIDI and the only source for the exported .mid, which the contour path
    # does not reproduce.
    contour_events: list[Event] = []
    melody_floor_midi: float | None = None
    if settings.contour_first and strategy.contour_first:
        contour_events, melody_floor_midi = _segment_contour(y, note_events, post)

    if contour_events:
        # A monophonic line's notes are runs of stable pitch bounded by voicing gaps, so
        # the amplitude floor, pyin refinement, onset merge, dedup and overlap resolver —
        # all of which repair fragmentation this path never creates — are skipped wholesale.
        # See settings.contour_first.
        events = contour_events
    else:
        # The contour path gave up.  If it had found a melody floor first, that floor still
        # holds: it says the accompaniment lies below a known pitch, and Basic Pitch's events
        # above it covered 11 of 11 reference pitches on the two wrong-hand polyphonic cases.
        #
        # No corpus case reaches this branch today.  It was built for poly_block_chords, whose
        # second pyin pass returned one distinct pitch over 336 frames, and measured there:
        # notes.f1 0.222 -> 0.583, solfa.degree_accuracy 0.364 -> 0.727, beats.f1 0.815 ->
        # 0.917, ghosts 5 -> 2, tempo 137 -> 96 exact.  ``Posteriorgram.melody_track`` then
        # took that case to 1.000 inside the contour path, so it no longer gives up.  The
        # branch stays because two live routes still end here — a posteriorgram capture
        # failure, which restores the second pyin pass and with it the degeneracy this
        # measured, and a gated clip whose above-floor contour holds no stable-pitch run.
        #
        # The filter cannot fire on an ungated clip, so none of the 40 monophonic cases can
        # reach it.  ``midi_data`` is deliberately left alone: it is Basic Pitch's own
        # multi-track MIDI for the .mid export, and this path is about the notated melody.
        if melody_floor_midi is not None:
            above_floor = [e for e in note_events if float(e[2]) >= melody_floor_midi]
            if above_floor:
                print(
                    f"[notefusion] melody floor midi {melody_floor_midi:.0f}: keeping "
                    f"{len(above_floor)} of {len(note_events)} Basic Pitch events for the "
                    "inference path",
                    flush=True,
                )
                note_events = above_floor

        # ── 2. Initial duration filter ────────────────────────────────────────
        # Discard events shorter than MIN_NOTE_SEC before computing the adaptive
        # amplitude floor so that very short noise bursts (which tend to be high-
        # amplitude) do not inflate p75 and raise the floor above real notes.
        #
        # Dropping the bends here is the exact revert of the f0 merge: with every
        # bend_semitones at 0.0 an Event's f0 is its pitch, so _merge_onsets' tolerance
        # test reduces to the exact-equality test it replaced.  That is why the flag
        # lives at this one line rather than as a branch inside the merge loop.
        read_bends = settings.f0_merge
        raw_events: list[Event] = sorted(
            [
                Event(start, end, int(pitch), float(amp), _bend_semitones(bends) if read_bends else 0.0)
                for start, end, pitch, amp, bends in note_events
                if (end - start) >= MIN_NOTE_SEC
            ],
            key=lambda e: e.start,
        )

        # ── 3. Adaptive amplitude floor ───────────────────────────────────────
        min_amp_base = strategy.min_amp_base
        amp_floor = _adaptive_amplitude_floor(raw_events, min_amp_base)
        events = [e for e in raw_events if e.amp >= amp_floor]

        # ── 3b. pyin pitch refinement ─────────────────────────────────────────
        # After the amplitude floor so pyin is not spent on events about to be dropped,
        # and before merging so an octave correction can let two fragments of one note
        # fuse on the existing exact-pitch test.
        pyin_contour = None
        if (settings.pyin_refine or settings.contour_gap_merge) and events:
            pyin_contour = _pyin_contour(y)
        if settings.pyin_refine and events:
            events = _refine_pitches(events, y, contour=pyin_contour)

        # ── 4. Onset merging ──────────────────────────────────────────────────
        # Merge before voice-cleaning so the melody overlap resolver sees clean
        # sustained notes rather than fragmented triplet artefacts.
        merge_gap = strategy.merge_gap
        events = _merge_onsets(events, gap_sec=merge_gap)
        if settings.contour_gap_merge and pyin_contour is not None:
            events = _merge_contour_gaps(events, *pyin_contour, post=post)

        # ── 5. Polyphonic deduplication ───────────────────────────────────────
        # Remove exact pitch + onset duplicates that survive merging.
        events = _dedup_simultaneous(events)

        # ── 6. Melody mode: remove polyphonic overlap artefacts ───────────────
        if strategy.resolve_overlaps and events:
            if melody_floor_midi is not None:
                events = _select_melody_path(events)
            events = _resolve_melody_overlaps(events)

    # ── 6b. Sample Basic Pitch's onset posterior ──────────────────────────────
    # After both paths converge and after every stage that can move a boundary, because the
    # reading is taken AT the event's start — a merge, a split or an overlap trim would
    # invalidate one taken before it.  Deliberately outside the else: the contour path needs
    # this more than the inference path does, being the one that has never had any Basic
    # Pitch evidence at all.
    events = _sample_posteriors(events, post)

    progress(0.50)

    if not events:
        raise LowConfidenceError(
            "No confident notes were detected in the recording. "
            "Try singing or playing closer to the microphone in a quieter space."
        )

    progress(0.55)

    # ── 7. Tempo and beat phase ───────────────────────────────────────────────
    # Both come from the decoded WAV, which is still on disk because transcribe()
    # owns its lifetime.  bpm converts seconds to beats; beat_origin decides
    # which instant is beat 0 (see _beat_origin — without it, leading silence
    # shifts the whole melody off the barline).
    bpm, beat_times = _estimate_tempo_and_beats(y, events, tempo_override, post=post, sr=sr)
    beat_origin = _beat_origin(beat_times, events[0].start, bpm) if settings.beat_align else 0.0
    if settings.grid_refine:
        # A tap-in override says how fast the piece is (TRD par. 5), so band=0.0 leaves the
        # BPM alone and refines only the phase — which the override says nothing about.
        bpm, beat_origin = _refine_grid(
            np.array([e.start for e in events]),
            bpm,
            beat_origin,
            settings.quantize_divisors,
            band=0.0 if tempo_override is not None else _GRID_REFINE_BAND,
        )
    sec_to_beats = bpm / 60.0
    progress(0.65)

    # ── 8. music21 stream, quantized to the configured grid ───────────────────
    # ``_blend_confidence`` needs an onset posterior to say anything beyond amplitude, and
    # ``Posteriorgram.capture`` returns None on an unusable ``model_output``.  When that
    # happens no event carries the term and the blend already falls back to bare amplitude
    # per note; this flag keeps the fallback explicit at the call site so the two cannot
    # drift apart.
    #
    # It no longer consults ``pyin_midi``.  The blend stopped reading pyin when the
    # agreement term measured below chance, so a clip over ``settings.pyin_max_seconds`` —
    # which skips pyin wholesale — now gets a real confidence from the onset head instead of
    # a uniform "Low confidence" band across the whole recording.  That was the case the
    # previous guard served worst, and it is the long clips, where it read as a pipeline
    # failure rather than a skipped stage.
    has_evidence = any(e.onset_post is not None for e in events)
    s = stream.Stream()
    s.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
    s.insert(0, meter.TimeSignature(time_signature))
    # The meter is a constant, and both routes to detecting it have been measured and
    # STRUCK.  Do not re-attempt either without new evidence; the post-mortem:
    #
    #   Acoustic (librosa.feature.tempogram_ratio, duple {3,9} vs triple {2,5,8,10}).
    #     Anti-correlated on this corpus.  A true 3/4 waltz and a true 6/8 clip both
    #     read DUPLE at the tempo this function actually has (-0.062 and -0.019),
    #     while 12 of the 38 known-4/4 cases read TRIPLE.  No threshold separates
    #     them: the candidates rank 13th of 40.  The statistic's sign flips on a 3 BPM
    #     perturbation of the bpm handed in (waltz TRIPLE at 102, duple at 105, TRIPLE
    #     at 108), so it measures whether bpm sits on a tempogram peak, not meter.
    #     The largest false "triple" is triplets_eighth_c_major — 4/4 with eighth
    #     triplets — which is a permanent musical confound, not a corpus artifact.
    #     Robust to norm and aggregation: all 9 combinations agree in sign.
    #
    #   Symbolic (bar-start coverage + phrase wholeness + long-note contrast over the
    #     quantized events).  On perfect reference notes it picks the right bar length
    #     for the two triple candidates by margins of only 0.167 and 0.100 — and gets
    #     0 of 38 4/4 cases right, picking 2 over 4 by a *wider* 0.712 margin on the
    #     18 cases sharing the major template and 0.267 on the 15 sharing the
    #     diagnostic phrase.  On real output at its own tolerance it declines on 5 of
    #     5 cases: the margins never come into existence.  One tolerance step looser
    #     it answers the 6/8 case DUPLE on a tie-break and calls drift_1_semitone 3/4.
    #     A one-line "modal gap between the longest notes" matches every case it gets
    #     right and declines where it is confidently wrong, so the rule earns none of
    #     its complexity.
    #
    # And the gate that would have scored a detector is a tautology: every corpus case
    # is 4/4 and this value is constant, so an always-4/4 detector and a perfect one
    # both score meter.exact 1.000.  Adding a 3/4 and a 6/8 case lifts the honest
    # headroom to one case (0.025) — below the 1/31 = 0.032 ceiling the struck vibrato
    # fix was rejected on — because the 6/8 clip's tempo comes back 45 against a true
    # 132 (librosa found the BAR rate) and a correct "6/8" there still engraves a bar
    # 2.9x too long while scoring exact=True.  6/8-vs-3/4 is a subdivision question
    # anyway: both are 3 quarter-beats per bar, so no bar-length cue can answer it.
    #
    # The real defect the measurement exposed is upstream and is NOT meter: this
    # function is not told which metrical level ``bpm`` is on.  See
    # tests/accuracy/metrics.py TEMPO_METRICAL_FACTORS.
    for evt in events:
        n = m21note.Note(evt.pitch)
        # Clamp to a sixteenth minimum so tiny surviving fragments still have a
        # well-formed duration in the score.  0.25 is one step of the default
        # grid, so this floor and the quantizer agree.
        n.duration.quarterLength = max((evt.end - evt.start) * sec_to_beats, 0.25)
        n.editorial.confidence = _blend_confidence(evt) if has_evidence else evt.amp
        # max() is defensive: _beat_origin never returns a value after the first
        # onset, so nothing should clamp here.
        s.insert(max(0.0, (evt.start - beat_origin) * sec_to_beats), n)
    s.quantize(settings.quantize_divisors, processOffsets=True, processDurations=True, inPlace=True)

    # ── 9. Key detection ──────────────────────────────────────────────────────
    # Manual override always wins (TRD par. 4.1).
    #
    # Without an override the key comes from an equal vote over five music21 pitch
    # profiles (see KEY_PROFILE_NAMES).  music21's own Stream.analyze("key") is a
    # single profile — AardenEssen — whose documented weakness is reading the
    # subdominant as the tonic, and that is not academic: it calls a plain C-major
    # stream F major.  A wrong tonic re-labels every solfa syllable, which makes this
    # the worst available failure for movable-do.
    #
    # All five profiles are histograms, though, so the ensemble cancels a *disagreement*
    # between profiles and not a blind spot they share.  Duration-weighting a non-tonic
    # degree heavily fools all of them at once, which is what a close vote between a key
    # and its fifth usually is; _cadence_prefers_runner_up settles those on where the
    # phrase ends and how much of it stays inside each candidate's scale.
    #
    # Confidence is the winner's margin over the runner-up, not the winner's own
    # correlation, because only the margin falls when two keys are genuinely hard to
    # separate.  The short-clip cap at KEY_CONFIDENCE_CAP_LOW is unchanged: fewer than
    # MIN_NOTES_FOR_KEY events is too little data for any profile, so the mobile shows
    # the editable-key field regardless (PRD mitigation).
    if key_override:
        detected = _parse_key_override(key_override)
        key_confidence = 1.0
    elif settings.key_ensemble:
        detected, key_confidence = _detect_key(s, len(events))
    else:
        detected = s.analyze("key")
        cc = float(detected.correlationCoefficient)
        key_confidence = 0.0 if np.isnan(cc) else max(0.0, min(1.0, cc))

        if len(events) < MIN_NOTES_FOR_KEY:
            key_confidence = min(key_confidence, KEY_CONFIDENCE_CAP_LOW)

    s.insert(0, m21key.Key(detected.tonic.name, detected.mode))

    # Spell the notes to the key before engraving them.  Both halves matter and both
    # were wrong: the notes were built from bare MIDI integers, so their spelling was
    # key-blind (E major's MIDI 75 printed E-flat instead of the D# in its own
    # signature), and makeAccidentals was then asked to print an accidental on
    # everything.
    #
    # The accidental half needs ``alteredPitches`` passed explicitly.  ``makeAccidentals``
    # does default to ``useKeySignature=True``, but it also defaults to
    # ``searchKeySignatureByContext=False``, and called on the score the signature is
    # inside the measures where that search never looks — so the key was being ignored
    # and every B-flat in B-flat major engraved its own flat.  ``overrideStatus=True``
    # then forced a mark onto notes that had none to display, which is where the printed
    # naturals on plain diatonic notes came from: ``Note(int)`` attaches an *explicit*
    # natural accidental to every white key, and overriding the status published it.
    #
    # Measured on a B-flat major scale: 6 printed accidentals before, 0 after — correct,
    # since a scale in its own key needs none.  A chromatic note still prints, once per
    # measure, and a natural cancelling an earlier accidental in the same measure still
    # prints, which is the part that must not regress.
    _respell_to_key(s, detected)
    score = s.makeMeasures()
    score.makeAccidentals(inPlace=True, alteredPitches=detected.alteredPitches)
    progress(0.80)

    # ── 10. Solfa mapping ─────────────────────────────────────────────────────
    # Derived from the same note list — re-labelling, never re-transcription.
    doh_pc = solfa.doh_pitch_class(detected.tonic.pitchClass, detected.mode)
    ref_doh = solfa.reference_doh([e.pitch for e in events], doh_pc)

    notes: list[TranscribedNote] = []
    bars: list[str] = []

    # Chromatic spelling follows melodic direction, so the whole clip's pitch order has to
    # be settled before any one note is labelled — a note cannot be spelled from itself.
    # The stream is walked twice in the same order (measures in offset order, notes in
    # offset order within each), so ``spelling`` indexes the loop below by position.
    spelling = solfa.ascending_flags(
        [
            n.pitch.midi
            for measure in score.getElementsByClass(stream.Measure)
            for n in measure.notes
        ]
    )
    spelling = [
        solfa.resolve_ascending(flag, settings.chromatic_spelling)
        for flag in spelling
    ]

    position = 0
    for measure in score.getElementsByClass(stream.Measure):
        bar_syllables: list[str] = []
        for n in measure.notes:
            syl, mark, degree = solfa.syllable(
                n.pitch.midi, doh_pc, ref_doh, spelling[position]
            )
            position += 1
            bar_syllables.append(syl + mark)
            notes.append(
                TranscribedNote(
                    pitch_midi=n.pitch.midi,
                    start_beat=float(measure.offset + n.offset),
                    dur_beats=float(n.duration.quarterLength),
                    degree=degree,
                    solfa=syl,
                    octave_mark=mark,
                    conf=round(float(getattr(n.editorial, "confidence", 1.0)), 3),
                )
            )
        bars.append(" ".join(bar_syllables) if bar_syllables else "-")

    if not notes:
        # Every note survived amplitude + duration filtering but was removed by
        # quantization (e.g. an extremely short or unusually-timed clip).
        raise LowConfidenceError(
            "No notes survived quantization — the recording may be too noisy "
            "or too short. Try a cleaner 3–10 second clip."
        )

    # Keep the text view on the same beat grid as the staff view.  ``bars`` remains
    # useful for debugging and backwards-compatible inspection, while the public
    # lines now preserve rests and held beats.
    solfa_lines = solfa_render.render_lines(
        notes,
        solfa.doh_header(doh_pc),
        time_signature=time_signature,
        divisions_per_beat=settings.quantize_divisors[0],
    )

    # ── 11. Normalise key name for C#'s KeyParser ─────────────────────────────
    # music21 returns names like "B- major" or "a minor"; C#'s KeyParser expects
    # "Bb major" / "A minor".  _normalise_key_name does both transformations.
    normalised_key = _normalise_key_name(detected.name)

    # ── 12. MusicXML + MIDI (base64) ─────────────────────────────────────────
    musicxml = GeneralObjectExporter(score).parse().decode("utf-8")
    # Re-render the .mid at the tempo step 7 detected.  ``predict`` builds its MIDI before
    # anything here knows the tempo, so it stamps basic-pitch's ``midi_tempo`` default of
    # 120 on every export regardless — a hymn at 76 imports into a DAW or a notation editor
    # claiming 120, which puts every barline in the wrong place.  Note times are absolute
    # seconds either way, so this changes what the file SAYS about the beat, not when the
    # notes sound.
    #
    # Rebuilt from ``all_note_events``, Basic Pitch's own unfiltered list, because that is
    # what ``midi_data`` was: the melody floor narrows ``note_events`` for the notated
    # melody and the .mid has always deliberately kept the whole texture.  Falling back to
    # ``midi_data`` on failure keeps a wrong tempo rather than losing the export.
    try:
        from basic_pitch.note_creation import note_events_to_midi

        midi_data = note_events_to_midi(list(all_note_events), False, float(round(bpm)))
    except Exception as exc:  # pragma: no cover - export must survive a basic-pitch change
        print(f"[notefusion] midi tempo re-stamp skipped: {exc!r}", flush=True)
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as tmp:
        midi_path = Path(tmp.name)
    try:
        midi_data.write(str(midi_path))
        midi_base64 = base64.b64encode(midi_path.read_bytes()).decode("ascii")
    finally:
        midi_path.unlink(missing_ok=True)

    progress(0.95)

    # ── 13. Audio preview synthesis ───────────────────────────────────────────
    # Pure numpy + soundfile; no system audio libraries required.
    # Runs after MIDI export so it doesn't delay the MIDI write path.
    audio_preview_b64 = _synthesize_audio_preview(notes, round(bpm))
    progress(1.0)

    return TranscriptionResult(
        key=normalised_key,
        key_confidence=round(key_confidence, 3),
        tempo=round(bpm),
        time_signature=time_signature,
        musicxml=musicxml,
        midi_base64=midi_base64,
        notes=notes,
        solfa_lines=solfa_lines,
        overall_confidence=round(float(np.mean([n.conf for n in notes])), 3),
        audio_preview_base64=audio_preview_b64,
        # Read off the events rather than re-testing duration against the cap, so this
        # cannot drift from what _pyin_track actually did: _refine_pitches sets
        # pyin_midi on every event pyin could speak about, on every branch, so an
        # empty contour for any reason leaves all of them None.
        pitch_refined=any(e.pyin_midi is not None for e in events),
        chromatic_spelling=settings.chromatic_spelling,
    )


class LowConfidenceError(Exception):
    """Raised when the clip yields nothing usable.

    Surfaced honestly to the user instead of returning garbage notation
    (PRD reliability NFR).  The message is propagated through the job queue,
    through the C# JobResponse.Error field (fixed in v2 of the contracts),
    and displayed verbatim on the mobile ResultScreen.
    """
