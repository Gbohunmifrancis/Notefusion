"""Ground-truth corpus for the accuracy harness (Phase 1 — measurement only).

Every case is a clip the pipeline *should* get right: the tonic is stated
unambiguously, every pitch sits inside Basic Pitch's usable range, and no note is
shorter than the pipeline's own duration floors.  That is deliberate — when a
metric drops, the cause is a pipeline defect, not corpus ambiguity.

Four groups:

  Keys         12 major + 6 minor cases from one shared melodic template,
               transposed.  Substrate for the Phase 4 relative-major confusion
               work, so every minor tonic's relative major is also in the corpus.

  Key headroom Two cases the detector currently gets WRONG.  The 18 template cases
               above are all correct today, so on its own the key group can only
               detect that a Phase 4 change broke something — it gives a *fix*
               nothing to demonstrate a gain on.  See KEY_HEADROOM_CASES.

  Diagnostics  One case per known/suspected defect.  The render-defect cases share
               the identical note list and tempo with ``diag_baseline`` and differ
               from it in exactly ONE RenderOptions field, so a regression points at
               one cause.  Never combine two render defects in one case.

  Vibrato      Seven cases along the two axes vibrato actually has — rate and depth —
  breadth      because one point on each is what let three separate vibrato fixes
               measure as wins and then fail off the corpus.  Same phrase and tempo
               as the diagnostics, so ``vibrato_heavy`` is the origin of both axes.
               See VIBRATO_BREADTH_CASES.

  Polyphonic   Two cases with a sounding accompaniment and a melody-only ground truth,
               because "melody line only" is the decided behaviour for polyphonic input
               and every other case in the file is monophonic.  The product's actual
               failing input is a piano recording, so this is the group that measures
               the complaint.  See POLYPHONIC_CASES.

Read each diagnostic case against its OWN recorded baseline, not against
``diag_baseline``.  The control is not the easiest case in the group: on a clean
sustained tone the pipeline reports the first C4 an octave up and emits four +12
harmonic ghosts, giving 15 estimated notes for 11 reference ones and ``notes.f1``
0.462 — while three of the cases it is the control FOR return exactly 11 notes and
outscore it (additive noise 1.000, a plucked envelope 1.000, and even the
overtone-heavy timbre built to provoke octave ghosts 0.909, because noise and a
decaying envelope dither those same ghosts below the amplitude floor).  The control's
job is to hold every RenderOptions field at its default so a defect case differs in
one variable; it is not a claim that the pipeline finds it easy.  ("The synth voice
copies the pipeline's own preview timbre, which puts 0.20 weight on the 2nd partial"
is the mechanism, so the absolute number is a property of this voice — see
real/README.md.)

Defect 2 — tempo estimation re-decoding the original file rather than reusing the
decoded buffer — is OUT OF SCOPE for this corpus and cannot be covered here.  Every
case is a ``.wav``, so ``_ensure_wav_path`` hands the path straight back and
``librosa.load`` at transcriber.py:712 reads a file that still exists.  Reproducing
the defect needs ffmpeg present *and* a container librosa cannot decode (.m4a/.aac),
i.e. a real fixture under ``real/``, not a synthesised one.

Pipeline ceilings the corpus is built to stay clear of (transcriber.py):
  maximum_frequency  1050 Hz ≈ MIDI 84 — every pitch here is ≤ 83.
  minimum_note_length  100 ms in melody mode; MIN_NOTE_SEC 0.06 s — the shortest
                       note in the corpus is 166 ms (see TRIPLET_TEMPO_BPM).
  MIN_NOTES_FOR_KEY  6 — every case has ≥ 11 notes, so key confidence is never
                     capped at KEY_CONFIDENCE_CAP_LOW.

No case uses 100 BPM: that is transcriber.py's hard-coded tempo fallback, so a
reported 100 would be indistinguishable from a failed measurement.  No case uses
117-120 BPM either, for the same reason one step further in — measured over this
corpus, ``librosa.beat.beat_track`` returns exactly 117 BPM for six of the nine
96 BPM clips AND for three of the 88 BPM ones, i.e. that value is its own ~120 BPM
prior rather than the stimulus.  A ground truth sitting on the prior would score as
a perfect tempo measurement for the wrong reason.  (The rest of the reported tempi
are mostly a metrical multiple — 172/161/136 against 88, 49 against 96, 345 against
88 — which is what ``tempo.metrical_factor`` exists to label.)

Beat arithmetic: 0.25 / 0.5 / 1.0 / 2.0 are exact in binary floating point, so
onsets accumulated by summing them are exact.  The only inexact duration is the
triplet 1/3 — see TRIPLET_PHRASE.
"""

import hashlib
import json
from dataclasses import asdict, dataclass

from tests.accuracy.synth import RenderOptions

# ── Shared render settings ────────────────────────────────────────────────────

# Clean reference render.  Every key case uses this, so the key group varies in
# pitch content only.
CLEAN = RenderOptions()


# ── Case type ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Case:
    """One corpus clip plus its ground truth.

    ``key`` is spelled the way ``_normalise_key_name`` emits it AND the way
    ``mir_eval.key`` parses it: capitalised tonic, "b" for flat, lowercase mode
    word.  mir_eval's vocabulary has no "cb"/"fb", so those enharmonics are
    unusable as ground truth even though music21 can produce them.
    """

    name: str  # stable, filename-safe; used as the pytest test id
    key: str  # "C major", "Bb major", "A minor", "F# minor"
    tempo_bpm: int
    notes: tuple[tuple[int | None, float], ...]  # (pitch_midi | None, dur_beats)
    options: RenderOptions
    tags: tuple[str, ...]
    # Extra sounding voices on the same beat clock, in the same format as ``notes``.
    # They make the AUDIO polyphonic without making the GROUND TRUTH polyphonic:
    # ``synth.render`` emits no reference note for them, so a case with an
    # accompaniment scores exactly the melody the pipeline is supposed to return in
    # ``mode="melody"`` and charges every accompaniment note it reports as a false
    # positive.  Empty for every monophonic case, which is why it is defaulted:
    # spelling it out 39 times would be noise.
    accompaniment: tuple[tuple[tuple[int | None, float], ...], ...] = ()


# ── Melodic templates (semitones above the tonic, beats) ──────────────────────

# Ascending scale then a descending tonic triad, 8 beats total.  The full scale
# fixes the mode and the triad lands on the tonic, so Krumhansl-Schmuckler has no
# plausible second choice — that is what makes a wrong key a pipeline defect.
MAJOR_TEMPLATE: tuple[tuple[int, float], ...] = (
    (0, 0.5),
    (2, 0.5),
    (4, 0.5),
    (5, 0.5),
    (7, 0.5),
    (9, 0.5),
    (11, 0.5),
    (12, 0.5),
    (7, 1.0),
    (4, 1.0),
    (0, 2.0),
)

# Natural minor: flat 3rd, 6th and 7th, descending triad on the minor 3rd.
NATURAL_MINOR_TEMPLATE: tuple[tuple[int, float], ...] = (
    (0, 0.5),
    (2, 0.5),
    (3, 0.5),
    (5, 0.5),
    (7, 0.5),
    (8, 0.5),
    (10, 0.5),
    (12, 0.5),
    (7, 1.0),
    (3, 1.0),
    (0, 2.0),
)

# Harmonic minor: raised 7th (11 instead of 10).  Phase 4c wants to use the
# leading tone as positive evidence for minor over the relative major, so the
# corpus has to contain that signal — and the natural-minor cases have to stay,
# because they are the same keys *without* it.
HARMONIC_MINOR_TEMPLATE: tuple[tuple[int, float], ...] = tuple(
    (11, dur) if semitone == 10 else (semitone, dur) for semitone, dur in NATURAL_MINOR_TEMPLATE
)

KEY_TEMPO_BPM = 88  # eighth = 341 ms, well above the 100 ms melody floor


def _transpose(
    template: tuple[tuple[int, float], ...], tonic_midi: int
) -> tuple[tuple[int | None, float], ...]:
    """Lift a semitone template onto a concrete tonic."""
    return tuple((semitone + tonic_midi, dur) for semitone, dur in template)


# ── Key cases ─────────────────────────────────────────────────────────────────

# Tonic MIDI 60-71 covers all 12 pitch classes once and puts the template's top
# note (tonic + 12) at 72-83 — inside the 1050 Hz / MIDI 84 detection ceiling and
# in a register a human could actually sing.
#
# Enharmonic spellings are the ones music21's key analysis actually emits, which
# was measured rather than guessed: pitch class 1 comes back "C# major" (not "Db
# major"), while 3/6/8/10 come back "Eb"/"F#"/"Ab"/"Bb".  Spelling is not a key
# error — mir_eval maps C# and Db to the same semitone, so weighted_score is
# identical either way — but a string-equality "exact" column would read False
# forever on a spelling mismatch, hiding real regressions behind a known one.
MAJOR_TONICS: tuple[tuple[str, str, int], ...] = (
    ("major_c", "C major", 60),
    ("major_c_sharp", "C# major", 61),
    ("major_d", "D major", 62),
    ("major_e_flat", "Eb major", 63),
    ("major_e", "E major", 64),
    ("major_f", "F major", 65),
    ("major_f_sharp", "F# major", 66),
    ("major_g", "G major", 67),
    ("major_a_flat", "Ab major", 68),
    ("major_a", "A major", 69),
    ("major_b_flat", "Bb major", 70),
    ("major_b", "B major", 71),
)

MAJOR_CASES: tuple[Case, ...] = tuple(
    Case(
        name=name,
        key=key,
        tempo_bpm=KEY_TEMPO_BPM,
        notes=_transpose(MAJOR_TEMPLATE, tonic),
        options=CLEAN,
        tags=("key", "major"),
    )
    for name, key, tonic in MAJOR_TONICS
)

# Relative-major pairs, both halves present in the corpus so Phase 4 can measure
# the confusion in both directions:
#   A minor  ↔ C major     E minor  ↔ G major     D minor ↔ F major
#   B minor  ↔ D major     F# minor ↔ A major
# C minor's relative (Eb major) is in the corpus too, but C minor is carried by
# the natural template only — five bidirectional pairs is enough signal.
MINOR_TONICS: tuple[tuple[str, str, int], ...] = (
    ("minor_natural_a", "A minor", 69),
    ("minor_natural_e", "E minor", 64),
    ("minor_natural_d", "D minor", 62),
    ("minor_natural_b", "B minor", 71),
)

MINOR_CASES: tuple[Case, ...] = tuple(
    Case(
        name=name,
        key=key,
        tempo_bpm=KEY_TEMPO_BPM,
        notes=_transpose(NATURAL_MINOR_TEMPLATE, tonic),
        options=CLEAN,
        tags=("key", "minor", "natural_minor"),
    )
    for name, key, tonic in MINOR_TONICS
) + (
    # A minor appears twice on purpose: natural vs harmonic is the one-variable
    # A/B test for "does the leading tone move the key decision?".
    Case(
        name="minor_harmonic_a",
        key="A minor",
        tempo_bpm=KEY_TEMPO_BPM,
        notes=_transpose(HARMONIC_MINOR_TEMPLATE, 69),
        options=CLEAN,
        tags=("key", "minor", "harmonic_minor"),
    ),
    Case(
        name="minor_harmonic_f_sharp",
        key="F# minor",
        tempo_bpm=KEY_TEMPO_BPM,
        notes=_transpose(HARMONIC_MINOR_TEMPLATE, 66),
        options=CLEAN,
        tags=("key", "minor", "harmonic_minor"),
    ),
)


# ── Key headroom cases ────────────────────────────────────────────────────────

# The 18 template cases above are ALL correct today (measured: key.exact 1.000 on
# every one, confidence 0.78-0.88), so defect 3 has no room to improve in the group
# built to measure it — a Phase 4 change there can only regress.  These two cases
# exist to give it room, and both were verified WRONG before being added rather than
# assumed to be hard:
#
#   plagal_fourth_c_major   C major -> F major, confidence 0.852
#   relative_bait_c_major   C major -> A minor, confidence 0.791
#
# Both are unambiguous to a musician — each starts and ends on the tonic and contains
# a B natural, which excludes F major outright and gives A minor no leading tone —
# but each duration-weights a non-tonic degree heavily, which is what AardenEssen's
# profile keys off.  So the corpus rule still holds: these are clips the pipeline
# *should* get right.
#
# They also carry the calibration signal defect 4 is about: the wrong answers come
# back at 0.85 and 0.79 confidence while the lowest confidence on a CORRECT key
# anywhere in the corpus is 0.568, so no threshold separates right from wrong.  That
# is what makes runner.aggregate's key.confidence_separation a real number instead of
# a formality.
KEY_HEADROOM_CASES: tuple[Case, ...] = (
    # Plagal I-IV-I with the 4th sustained: F carries 4 of the 12 beats.
    Case(
        name="plagal_fourth_c_major",
        key="C major",
        tempo_bpm=KEY_TEMPO_BPM,
        notes=(
            (60, 0.5),
            (64, 0.5),
            (67, 1.0),
            (65, 2.0),
            (69, 1.0),
            (72, 1.0),
            (65, 2.0),
            (69, 1.0),
            (67, 1.0),
            (71, 0.5),
            (72, 2.0),
        ),
        options=CLEAN,
        tags=("key", "major", "key_headroom", "defect3"),
    ),
    # Relative-minor bait: A and E are the long notes, the tonic is a passing eighth
    # at the start and a final held C.
    Case(
        name="relative_bait_c_major",
        key="C major",
        tempo_bpm=KEY_TEMPO_BPM,
        notes=(
            (60, 0.5),
            (64, 2.0),
            (69, 2.0),
            (67, 1.0),
            (65, 1.0),
            (64, 1.0),
            (69, 1.0),
            (67, 0.5),
            (62, 0.5),
            (71, 0.5),
            (60, 2.0),
        ),
        options=CLEAN,
        tags=("key", "major", "key_headroom", "defect4c"),
    ),
)


# ── Diagnostic phrase ─────────────────────────────────────────────────────────

# The render-defect cases all use this phrase: a C major scale in quarter notes
# plus a descending triad, 12 beats.  Quarter notes rather than the key group's
# eighths because heavy vibrato needs several cycles inside a single note to be a
# realistic defect (at 96 BPM a quarter is 625 ms ≈ 3.4 cycles at 5.5 Hz).
DIAG_TEMPO_BPM = 96
DIAG_PHRASE: tuple[tuple[int | None, float], ...] = (
    (60, 1.0),
    (62, 1.0),
    (64, 1.0),
    (65, 1.0),
    (67, 1.0),
    (69, 1.0),
    (71, 1.0),
    (72, 1.0),
    (67, 1.0),
    (64, 1.0),
    (60, 2.0),
)

DIAGNOSTIC_CASES: tuple[Case, ...] = (
    # The control.  Without it "one variable different" has no referent: every
    # render-defect case below is DIAG_PHRASE at DIAG_TEMPO_BPM with exactly one
    # RenderOptions field changed from CLEAN.
    Case(
        name="diag_baseline",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=CLEAN,
        tags=("diagnostic", "control"),
    ),
    # Defect 1: leading silence.  onset_sec of the first note is 0.8 but its
    # onset_beat is 0.0 — the pipeline is supposed to anchor the first sounding
    # note to beat 0, not to preserve the silence as rests.
    Case(
        name="lead_in_800ms",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(lead_in_sec=0.8),
        tags=("diagnostic", "lead_in", "defect1"),
    ),
    # Defect 6: heavy vibrato, 1.2 peak semitones at 5.5 Hz.  1.2 rather than 0.8
    # because 0.8 was measured NOT to provoke the defect: at 0.8 the pipeline
    # returned the exactly-correct 11 pitches with zero semitone-neighbour ghosts and
    # outscored the control, so a vibrato-tolerant merge would have had nothing to
    # fuse and Phase 3c would have moved no number.  The excursion is arithmetically
    # past the neighbouring semitone bin either way; what changes at 1.2 is that
    # Basic Pitch actually fires in that bin — measured 30 notes with 22
    # semitone-neighbour ghosts (59, 61, 63, 66, 68, 70, 73).
    #
    # THIS IS WHY PHASE 3c (the semitone-tolerant merge) WAS STRUCK, NOT DEFERRED.
    # Read the ghost list above as the proof: 59 and 61 straddle 60, 61 and 63
    # straddle 62, and so on — Basic Pitch fires at BOTH neighbours of a wobbling
    # pitch (over the 64 pre-merge events its label is -1 on 24 and +1 on 25), so
    # consecutive fragments of ONE note alternate low/high and land TWO semitones
    # apart.  Measured consecutive-pair interval histogram over the 63 adjacencies:
    # {0: 12, 1: 5, 2: 43, 3: 2, 5: 1}.  A +-1 semitone tolerance can touch 5 pairs,
    # 4 of them inside the 80 ms gap window, and 2 of those 5 straddle a genuine note
    # change rather than fragmenting one note.  Simulated end to end, the merge as
    # planned fired ZERO times and left this case bit-identical (30 notes,
    # notes.f1 0.098, solfa.ghost_count 21).
    #
    # Nor is it a threshold-tuning problem.  The shorter fragment is 116.1 ms in all
    # four gap-eligible pairs here — and 116.1 ms is also the shorter fragment of
    # GENUINE legato semitone steps in fast_sixteenths_c_major, because
    # 2560/22050 = 116.0998 ms is a Basic Pitch quantization constant (10 frame hops
    # of 11.61 ms), not a tail of a distribution.  The value a duration cap must
    # admit and the value it must reject are the same number.  The plan's amplitude
    # condition is worse than useless: "shorter is quieter" measures TRUE on 5 of 7
    # genuine semitone steps across the corpus and only 1 of these 4 vibrato pairs,
    # so its sign is inverted.
    #
    # What the measurement says the defect actually IS: mislabelling, not
    # fragmentation.  Basic Pitch's pitch is wrong on 49 of 64 events here while the
    # pyin median already sits within 0.192 semitone of truth (median; max 1.792).
    #
    # THE PYIN RE-LABEL THAT FOLLOWED FROM THAT WAS ALSO STRUCK, AFTER BEING BUILT.
    # It gated on |pyin_median - round(pyin_median)| <= 0.25 — the idea being that a
    # median biased by sitting mid-vibrato-cycle lands BETWEEN semitones while a
    # faithful one lands ON a centre.  On this corpus it measured like a clear win:
    # this case went solfa.degree 0.000 -> 0.818, key F# major -> C major (correct),
    # notes.f1 0.098 -> 0.372, and aggregate degree accuracy +0.026 with nothing else
    # moving.  It was struck anyway, for four measured reasons.
    #
    #  1. The gate cannot see the bias it exists to catch.  Centre distance is a
    #     distance MOD 1, so a bias near a whole semitone lands ON a centre — the
    #     wrong one — and passes.  Corpus-wide, 13 events have |median - truth| >=
    #     0.75 AND centre distance <= 0.25, including the 1.792 outlier above
    #     (median 72.792, centre distance 0.208): the rule fires on it and moves the
    #     label from one semitone wrong to two.  It is safe only where
    #     k(fragment/period) * depth < 0.75, an inequality in vibrato RATE, and this
    #     corpus has exactly one rate.
    #  2. It is a fragmentation REGRESSION, not the fragmentation fix it looked like.
    #     Same-pitch adjacencies do rise 12 -> 30, but 20 of the 30 pairs OVERLAP in
    #     time (gap -0.081 to -0.209 s) and _merge_onsets requires 0.0 <= gap, so it
    #     refuses them: merges performed fall 12 -> 10, post-merge events rise
    #     52 -> 54, final notes 30 -> 32 against 11 real ones.  It splits a correct
    #     three-event bp=72 chain into 71 / 73 / 72, putting a C# in a C major phrase.
    #  3. Simpler rules dominate it on its own corpus.  Correct labels over all 647
    #     events: 582 with the rule off, 612 with the centre gate, 617 with NO gate,
    #     618 with a plain n_voiced >= 7 floor.  n_voiced >= 6 AND pyin_std <= 0.8
    #     scores 36 fixes and 0 made-worse against the gate's 30 and 1.
    #  4. The threshold is not even a quantity.  pyin medians sit on a 0.05 lattice
    #     anchored at frac(hz_to_midi(PYIN_FMIN_HZ)) = 0.892, so reachable centre
    #     distances step 0.2421 -> 0.2921 and every tolerance in that gap is the
    #     identical rule — while editing the unrelated PYIN_FMIN_HZ moves all of them.
    #
    # And the evidence was one case: all 46 candidate events are here, the other 30
    # cases show round(pyin_median) == Basic Pitch's label on all 369 of theirs, and
    # render() is a pure function so "0 labels broken" has no confidence interval to
    # quote.  A uniform +20 cent detune — ordinary intonation, and unrepresentable in
    # RenderOptions — takes the 30 fixes down to 11.
    #
    # A THIRD FIX WAS SCOUTED FROM THAT AND ALSO STRUCK — THIS TIME BEFORE BUILDING.
    # Basic Pitch's labels alternate around the truth rather than scattering: true 60
    # arrives as [61,59,61,59,...], true 67 as [66,68,66,68,...].  So the candidate
    # read only data the pipeline already has: take time-overlapping event pairs
    # exactly 2 semitones apart, require the overlap to be >= 5 Basic Pitch frame hops
    # (round(ov/HOP), HOP = 256/22050 s) and the partner to be unique, then fuse each
    # committed run into one event at the midpoint.  On this corpus it measured better
    # than either predecessor above: 46 labels fixed and 0 broken (582 -> 628 of 647),
    # overlapping straddle pairs here 30 -> 13, corpus final notes 405 -> 388 against
    # 348 real, aggregate degree +0.032.  Struck on fresh renders, for four reasons.
    #
    #  1. The midpoint is only the truth inside a depth window, and 1.2 sits in the
    #     middle of it.  Re-rendering this phrase at 5.5 Hz and sweeping depth, with
    #     the >= 5-hop gate (firings / of those, MISLABELLED):
    #       0.8 silent | 1.0 17/0 | 1.2 39/0 | 1.4 45/0 | 1.6 25/0
    #       1.8 11/SIX | 2.0 7/SEVEN — every firing wrong | 2.4 silent
    #     Past ~1.6 the pair stops being symmetric about the truth: one label IS the
    #     pitch and the other is the excursion, so (67,69) on a true 67 collapses to
    #     68.  The corpus contains exactly one depth.
    #  2. Nothing in the pair separates the two cases.  Both are an overlapping
    #     (p, p+2) with a long overlap, and the WRONG firings' overlaps at 1.8
    #     (94.2-197.4 ms) sit inside the right ones here (58.0-185.8 ms).  Rate breaks
    #     it independently: 4.0 Hz 1 wrong of 43, 7.0 Hz 2 of 69, 9.0 Hz 3 of 62 — and
    #     the >= 5-hop gate that is 46-fixed/0-broken here breaks correct labels at
    #     7.0 and 9.0 Hz.  Gate sweep on this corpus: >= 2 hops 48 fixed/89 broken,
    #     >= 3 47/12, >= 4 46/6, >= 5 46/0, >= 8 42/0.
    #  3. The obvious clip-level repair fails in both directions.  "Stand down if the
    #     clip holds any overlapping pair >= 3 semitones apart" switches the rule OFF
    #     at 1.4 and 1.6 (giving up 45 and 25 correct fixes) and at 7.0 Hz (67), while
    #     4.0 Hz ({2: 52}) and 9.0 Hz ({1: 2, 2: 74}) have clean histograms and break
    #     anyway.  Tuning a second constant on the same one-point evidence.
    #  4. It is unsafe in a mode this corpus cannot reach.  Every reference note here is
    #     monophonic — measured 0 of 38 cases with any simultaneous reference notes when
    #     this was written, and still 0 of 43 now that POLYPHONIC_CASES exists, because
    #     an accompaniment sounds without producing a reference note (see
    #     ``synth.render``).  So the polyphonic cases do NOT retire this reason: they
    #     measure melody extraction from a mixture, not mode="poly".  And
    #     _transcribe_wav runs the same body for mode="poly", where a sus2, add9
    #     or whole-tone dyad IS a fully overlapping 2-semitone pair.  The rule would
    #     collapse two sounding pitches onto one that is not being played.  This is the
    #     one reason the breadth cases below do NOT retire.
    #
    # Reward was capped before any of that: only one case can move, so the ceiling was
    # 1/31 = +0.032 aggregate, and 36 of the 46 fixes are also won by the already-
    # rejected n_voiced >= 7 floor (reason 3 above), leaving 10 unique labels of 647.
    # The harness would have reported a clean pass — semitone_neighbour_ghosts 22 -> 2
    # launders the metric built to detect this very defect, while solfa.ghost_count
    # stays 21 and notes.n_est is in NOT_A_GATE.
    #
    # THREE FIXES, ONE VIBRATO POINT: the shared cause of all three strikes is that
    # 5.5 Hz / 1.2 semitones cannot certify a vibrato rule.  Each candidate died on a
    # constant fitted to this render (gap window, centre distance, overlap hops).  The
    # prerequisite is corpus breadth, not a fourth rule.  That prerequisite is now MET
    # for the rate and depth axes: VIBRATO_BREADTH_CASES below carries vibrato_hz
    # 4.3066 / 5.5570 / 5.7422 / 7.0 and vibrato_semitones 0.8 / 1.8 / 2.0 alongside
    # this case's 1.2, and needed no synth.py change.  Note that k = period/hop matters
    # as much as hz: at 5.5 Hz a fragment spans 15.661 hops, and the measured fragment
    # lengths cluster at exactly {15: 22, 16: 18}, so a rate change moves the phase
    # truncation, not just the rate — which is why that axis is parameterised on k.
    #
    # Reason 4 is the exception, and the earlier draft of this note was wrong about it:
    # a "genuine whole-tone-step case" does NOT cover the poly hazard.  DIAG_PHRASE is a
    # C major scale, so genuine whole-tone steps were already here (60-62, 62-64, 65-67,
    # 67-69, 69-71) and the depth cases now watch them under vibrato — but the hazard is
    # two pitches sounding AT ONCE, and a case's notes are (pitch, dur_beats) laid end
    # to end.  Simultaneity is inexpressible in this format at any interval, so reason 4
    # stays open behind a synth.py + runner.py change (overlapping render, mode="poly"),
    # not behind another case.
    #
    # THAT LIVE LEAD WAS TAKEN UP AND IS NOW THE FOURTH STRIKE — the first one the
    # breadth cases killed, which is the harness doing its job rather than a new mystery.
    # The plan's defect 6 is right that the discarded pitch bends carry information:
    # predict()'s note_events return them, and reading them lets _merge_onsets compare a
    # continuous f0 instead of a rounded pitch, which is the one objection the earlier
    # semitone-tolerant attempt could not answer.  Measured over the nine vibrato/drift
    # cases the separation is real: consecutive fragments of one reference note sit a
    # median 0.395 semitones apart in f0 against 2.074 for genuine steps, and a 0.5
    # tolerance fuses 11 more fragment pairs than exact-pitch equality while fusing 4
    # FEWER genuine ones — better on both axes, with semitone_steps_c_major,
    # fast_sixteenths_c_major, diag_baseline and vibrato_depth_0_8 bit-identical.
    #
    # On the full corpus it bought one accidental.  solfa.chromatic_ghosts 3.579 ->
    # 3.553 across 38 cases, while solfa.ghost_count went 5.737 -> 5.842 — past the 0.02
    # tolerance, so it fails the gate it was built to pass.  Four cases move at all:
    # drift_1_semitone -1 accidental, vibrato_rate_k15 unchanged, vibrato_heavy +2
    # ghosts, vibrato_rate_k155 f1 -0.073 and +3 ghosts.  BOTH LOSERS ARE BREADTH CASES
    # THE TOLERANCE WAS NOT FITTED ON.  Same death as the first three: a constant fitted
    # to a subset of the vibrato space.  Live behind settings.f0_merge, default OFF; off
    # is an exact revert, because with no bends an Event's f0 IS its pitch.
    #
    # Two claims in the earlier draft of this paragraph were wrong, and both would have
    # biased a fourth attempt:
    #  1. "(bends.mean - 1) / 3" — there is no one-bin offset to undo.  get_pitch_bends
    #     subtracts pb_shift, and the contour bin of MIDI pitch p is 12*3*log2(
    #     midi_to_hz(p)/27.5) = 3p - 63 exactly, an integer, so freq_idx never rounds and
    #     the array is already centred on the note's own pitch.  Subtracting 1 would have
    #     put every f0 a third of a semitone flat.  Pinned by
    #     test_the_bins_are_already_centred_on_the_notated_pitch.
    #  2. "36 better / 0 worse" as a NOTATED pitch.  The zero-offset formula the
    #     derivation supports scores 135 events better and 164 worse (MAE 1.781 -> 1.761),
    #     because on the drift and vibrato cases the bend faithfully tracks sharpness that
    #     notation is supposed to round away — drift_1_semitone gets WORSE, 0.405 ->
    #     0.759.  So the bends are a better merge DISCRIMINATOR and a worse pitch; Event
    #     keeps pitch an int and the merge keeps the louder fragment's pitch wholesale.
    #
    # The structural finding is the part worth reusing: reason 2 of the second strike
    # above was right, and more so than it knew.  This stage cannot reach the fragments.
    # With no candidate window at all, 51 of 128 f0-agreeing adjacent pairs at merge time
    # overlap (p25 -92.9 ms, p10 -246.1 ms) and only 74 satisfy _merge_onsets' 0.0 <= gap.
    # A wobble Basic Pitch reports at both neighbours simultaneously interleaves, so the
    # fragments never abut.
    #
    # THE FIFTH ATTEMPT WON, AND IT WAS NOT A MERGE FIX.  The recommendation this comment
    # used to carry — widen WHERE the f0 evidence is applied, an overlap allowance or the
    # melody overlap resolver — was measured and is wrong twice over.  Probes: bends are
    # present on essentially every overlapping event (49 of 49 on vibrato_heavy), so
    # drop_overlapping_pitch_bends was never the obstacle; and the step-6 population is
    # almost never semitone-adjacent (6 candidates across nine vibrato cases, and 0 of 56
    # f0-agreeing overlapping pairs a semitone apart), so at that stage "f0 agrees"
    # degenerates to "pitch is identical" and relocating the test buys nothing either.
    #
    # Laying the final notes against the reference showed why: within one reference note
    # the estimate is a run at ONE wrong pitch (ref 69 -> 70,70,70,70,72), not an
    # alternation.  The wobble parks on the semitone neighbour, so this is a PITCH error
    # and the accidental merely follows from it — there is no fragment pair to fuse.  The
    # fix is upstream at stage 3: settings.pyin_semitone rounds pyin's median and takes it
    # as the pitch.  solfa.degree_accuracy 0.831 -> 0.917, solfa.chromatic_ghosts 3.579 ->
    # 1.868, key.exact 0.763 -> 0.868, and every guard case bit-identical.  Five strikes
    # against the merge stage; the sixth attempt should not be a merge attempt.

    Case(
        name="vibrato_heavy",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=5.5, vibrato_semitones=1.2),
        tags=("diagnostic", "vibrato", "defect6"),
    ),
    # The graded middle ground for the same merge: a slow 1.0-semitone ramp across
    # every note instead of a fast oscillation.  Measured 20 notes with 8
    # semitone-neighbour ghosts, i.e. between the control and vibrato_heavy, so a
    # merge that is too eager and one that is too timid move this case in opposite
    # directions.
    Case(
        name="drift_1_semitone",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(drift_semitones=1.0),
        tags=("diagnostic", "drift"),
    ),
    # Additive noise.  0.03 absolute RMS against a 0.90-peak tone bed is roughly
    # 20 dB SNR — audibly noisy, still trivially transcribable by ear, so a drop
    # here is pipeline fragility rather than an impossible clip.
    Case(
        name="noise_moderate",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(noise_rms=0.03),
        tags=("diagnostic", "noise"),
    ),
    # Quiet performance: peak 0.08 instead of 0.90, about -21 dB.  Note that
    # transcriber.py's amplitude floors are Basic Pitch frame *activations*, not
    # audio loudness, so this mostly tests whether the model still fires at all.
    # This case may legitimately raise LowConfidenceError; the runner records
    # that as ok=False + error rather than treating it as a crash, and near-
    # silence more often returns confident-looking garbage than raises.
    Case(
        name="quiet_low_amplitude",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(peak=0.08),
        tags=("diagnostic", "quiet", "low_confidence"),
    ),
    # Overtone-heavy timbre: energy pushed into partials 2-4 so the 2nd harmonic
    # rivals the fundamental.  Not speculative — spike/output/summary.json,
    # clip "01_c_major_scale.wav", contains a measured instance of the resulting
    # octave ghost: MIDI 74 at onset 0.592 s (dur 0.139 s, conf 0.357) landing
    # 12 ms before the real MIDI 62 at 0.604 s, which surfaced in that run's
    # solfa as adjacent "r" and "r," syllables (also 79-before-67 at 2.393 s and
    # 83-before-71 at 4.786 s).  Ghosts are short and low-confidence, so they are
    # what the amplitude floor and the melody overlap resolver exist to remove.
    Case(
        name="overtone_heavy",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(harmonic_weights=(0.30, 0.45, 0.35, 0.25)),
        tags=("diagnostic", "overtone", "octave_ghost"),
    ),
    # Plucked envelope instead of sustained: a fast exponential decay crosses Basic
    # Pitch's frame threshold on the way down, which is a different note-off
    # behaviour from a sustained tone cut by its release.  Here because
    # ``RenderOptions.sustained`` was otherwise dead and real/README.md claims the
    # corpus isolates it.
    Case(
        name="pluck_envelope",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(sustained=False),
        tags=("diagnostic", "pluck"),
    ),
)


# ── Vibrato breadth: the rate and depth axes ──────────────────────────────────

# Why a sweep and not one more defect case.  Three vibrato fixes have been built or
# scouted against ``vibrato_heavy`` ALONE and all three died on a constant fitted to
# its single rate/depth point — an 80 ms gap window, a 0.25 centre distance, a 5-frame
# overlap.  Read the vibrato_heavy comment for the post-mortems; these cases exist so
# a fourth attempt is falsifiable inside the harness instead of in a throwaway script.
# Every one of them is DIAG_PHRASE at DIAG_TEMPO_BPM, so vibrato_heavy is the origin
# of both axes and each case moves along exactly one of them.
#
# The rate axis is chosen by k = vibrato period / Basic Pitch frame hop, NOT by round
# frequencies.  HOP = 256/22050 s = 11.609977 ms, so k = 86.1328 / vibrato_hz.  An
# integer k fits a whole number of frames in a vibrato cycle, so the phase truncation
# of a fragment is zero; a half-integer k maximises it.  That truncation is the bias
# term which made the pyin re-label look safe here and provably is not elsewhere
# (measured for a perfect tracker: 0.092 semitone at 5.5 Hz, 0.517 at 2.5 Hz), and
# vibrato_heavy's 5.5 Hz sits at k = 15.661 — near neither extreme, by accident.
#
#   vibrato_rate_k15   5.7422 Hz  k = 15.000  no truncation
#   vibrato_rate_k155  5.5570 Hz  k = 15.500  maximal truncation, adjacent in RATE to
#                                             k15 (3.3 % apart) and far from it in
#                                             BIAS — the pair is the whole point
#   vibrato_rate_k20   4.3066 Hz  k = 20.000  no truncation, wider cycle
#   vibrato_rate_7hz   7.0000 Hz  k = 12.305  unremarkable k, a rate people sing
#
# All four keep >= 2.69 vibrato cycles inside a 625 ms quarter note (3.59 / 3.47 /
# 2.69 / 4.38 against vibrato_heavy's 3.44), which is the property DIAG_PHRASE's
# quarter notes were chosen for; a slower rate would test the note length instead.
#
# The depth axis brackets the window in which "the midpoint of a time-overlapping
# 2-semitone pair is the true pitch" is true AT ALL.  Measured on this phrase at
# 5.5 Hz through the real pipeline — firings of that rule, and how many of them
# mislabelled: 0.8 silent, 1.0 17/0, 1.2 39/0, 1.4 45/0, 1.6 25/0, 1.8 11/SIX,
# 2.0 7/SEVEN, 2.4 silent.  One point inside a window cannot show you the window.
#
#   vibrato_depth_0_8  Below the floor.  Measured: the pipeline returns the exactly
#                      correct 11 pitches with zero semitone-neighbour ghosts, better
#                      than the clean control.  A vibrato rule must be SILENT here,
#                      not merely harmless — a fix that moves this case is reaching
#                      for notes that were already right.
#   vibrato_depth_1_8  The mixed population, and the hardest case in the corpus: right
#                      and wrong straddles in ONE clip, so no clip-level guard can
#                      switch a rule off wholesale.  Interval histogram over
#                      overlapping pairs {1: 3, 2: 14, 3: 20, 4: 2} — the only case
#                      here where 2 semitones is not the mode.
#   vibrato_depth_2_0  Above the ceiling.  The pair stops being symmetric about the
#                      truth: one label IS the pitch and the other is the excursion,
#                      so (67, 69) on a true 67 averages to 68.  Histogram
#                      {2: 9, 3: 6, 4: 31}.
#
# These also give DIAG_PHRASE's genuine whole-tone steps (60-62, 62-64, 65-67, 67-69,
# 69-71) their first watcher under vibrato — semitone_steps_c_major has zero
# 2-semitone adjacencies and no vibrato, as its own comment below admits.
#
# Cost: seven more full ONNX + pyin runs per harness run, and seven cases the pipeline
# currently fails, so the aggregate means drop when they land.  That drop is the
# measurement the one-point corpus was hiding, not a regression — the same argument
# KEY_HEADROOM_CASES was added under.  Per-case rows are where the protection lives.
VIBRATO_BREADTH_CASES: tuple[Case, ...] = (
    Case(
        name="vibrato_rate_k15",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=5.7422, vibrato_semitones=1.2),
        tags=("vibrato", "rate", "breadth"),
    ),
    Case(
        name="vibrato_rate_k155",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=5.5570, vibrato_semitones=1.2),
        tags=("vibrato", "rate", "breadth"),
    ),
    Case(
        name="vibrato_rate_k20",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=4.3066, vibrato_semitones=1.2),
        tags=("vibrato", "rate", "breadth"),
    ),
    Case(
        name="vibrato_rate_7hz",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=7.0, vibrato_semitones=1.2),
        tags=("vibrato", "rate", "breadth"),
    ),
    Case(
        name="vibrato_depth_0_8",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=5.5, vibrato_semitones=0.8),
        tags=("vibrato", "depth", "breadth"),
    ),
    Case(
        name="vibrato_depth_1_8",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=5.5, vibrato_semitones=1.8),
        tags=("vibrato", "depth", "breadth"),
    ),
    Case(
        name="vibrato_depth_2_0",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=RenderOptions(vibrato_hz=5.5, vibrato_semitones=2.0),
        tags=("vibrato", "depth", "breadth"),
    ),
)


# ── Rhythm and interval cases ─────────────────────────────────────────────────

# !!! DO NOT DELETE THIS CASE !!!
# Every step below is a real, deliberate semitone: mi-fa (64-65) and ti-doh (71-72),
# each a full beat (625 ms at 96 BPM), alternating so a pitch-merge has maximum
# opportunity to misfire.  It is a clean instrument in one specific sense: Basic
# Pitch labels all 24 of its pre-merge events correctly and pyin agrees to within
# 0.092 semitone, so any wrong pitch in the output is the pipeline's fault and not
# the model's hearing.
#
# BUT IT IS NOT THE GUARD IT WAS WRITTEN TO BE, and the comment that used to stand
# here said it was.  The claim was: "if a change makes this case's note count
# collapse from 12 towards 6, the merge is over-eager."  Measured against a merge
# deliberately built to over-fire, the count does not move at all.  Two reasons,
# both structural:
#   - Basic Pitch emits ~2 fragments per note (24 events for these 12 notes), so
#     fusing a real mi->fa consumes one fragment and the duplicate body fragment
#     keeps the note alive in the output.
#   - The melody overlap resolver (transcriber.py, stage 6) truncates the
#     over-extended survivor back to its original end, erasing the timing evidence.
# A wrong cross-note merge on ref notes 6->7 was confirmed to fire while the final
# note count AND pitch sequence stayed byte-identical to baseline.  A gate that
# cannot see the damage it exists to catch is worse than no gate, because it reads
# as a pass.
#
# Two further blind spots, in case a pitch-merge is ever revived:
#   - Its shortest note is 625 ms and it has zero vibrato, so it never visits the
#     short-and-wobbling region any merge condition would actually permit.  The case
#     that DOES break is fast_sixteenths_c_major, whose genuine legato steps have a
#     116.1 ms shorter fragment — gate on its notes.recall, not on this case.
#   - It contains ZERO 2-semitone adjacencies (interval histogram
#     {0: 12, 1: 6, 3: 1, 4: 1, 5: 1, 6: 1, 8: 1}), so it is blind to any tolerance
#     wider than 1 semitone.  DIAG_PHRASE's genuine whole-tone steps (60-62, 62-64,
#     65-67, 67-69, 69-71) have nothing watching them.
# The right instrument is a unit test on the merge's own decisions over hand-built
# events.  Keep this case — it earns its place on interval accuracy — but do not
# trust it to catch an over-eager merge.
#
# The leading C major arpeggio is only there to pin the key: {C,E,F,G,B} on its
# own is thin evidence, and an ambiguous key would muddy the case's real purpose.
SEMITONE_TEMPO_BPM = 96
SEMITONE_STEP_PHRASE: tuple[tuple[int | None, float], ...] = (
    (60, 0.5),
    (64, 0.5),
    (67, 0.5),
    (72, 0.5),
    (64, 1.0),  # mi
    (65, 1.0),  # fa
    (64, 1.0),  # mi
    (65, 1.0),  # fa
    (71, 1.0),  # ti
    (72, 1.0),  # doh
    (71, 1.0),  # ti
    (72, 1.0),  # doh
)

# Defect 5: eighth-note triplets.  1/3 beat at 96 BPM is 208.3 ms — comfortably
# above the 100 ms melody floor, so any failure is about the grid, not duration.
# transcriber.py quantizes with s.quantize((2,)), an eighth-note grid, which
# cannot represent 1/3 at all: this case exists to measure how much damage that
# does before Phase 5 widens the grid.
#
# 1/3 is the one inexact duration in the corpus, so this is the one case whose
# accumulated onsets are not exact.  Measured: running sums of 1/3 wobble by up
# to ~4e-16 beats (the 7th triplet starts at 1.9999999999999998, not 2.0) and by
# luck of rounding the 13th note lands back on exactly 4.0.  Sixteen orders of
# magnitude below the 0.5-beat grid, so no metric can see it — but it does mean
# beat positions in this case must never be compared with ==.
TRIPLET_TEMPO_BPM = 96
_TRIPLET = 1 / 3
TRIPLET_PHRASE: tuple[tuple[int | None, float], ...] = tuple(
    (pitch, _TRIPLET) for pitch in (60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65)
) + ((60, 2.0),)

# Fast passage: sixteenths.  0.25 beat at 88 BPM is 170.5 ms per note, so it
# clears the 100 ms minimum_note_length and the 0.06 s MIN_NOTE_SEC with room to
# spare — otherwise the case would be measuring a deliberate design threshold
# instead of a defect.  The eighth grid still cannot represent a sixteenth, so
# expect pitch content to survive and timing to be crushed; that is exactly what
# the beats-domain shift-invariant onset metric is for.
FAST_TEMPO_BPM = 88
FAST_PHRASE: tuple[tuple[int | None, float], ...] = tuple(
    (pitch, 0.25) for pitch in (60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62)
) + ((60, 1.5),)

RHYTHM_CASES: tuple[Case, ...] = (
    Case(
        name="semitone_steps_c_major",
        key="C major",
        tempo_bpm=SEMITONE_TEMPO_BPM,
        notes=SEMITONE_STEP_PHRASE,
        options=CLEAN,
        tags=("interval", "semitone", "defect3c_guard"),
    ),
    Case(
        name="triplets_eighth_c_major",
        key="C major",
        tempo_bpm=TRIPLET_TEMPO_BPM,
        notes=TRIPLET_PHRASE,
        options=CLEAN,
        tags=("rhythm", "triplet", "defect5"),
    ),
    Case(
        name="fast_sixteenths_c_major",
        key="C major",
        tempo_bpm=FAST_TEMPO_BPM,
        notes=FAST_PHRASE,
        options=CLEAN,
        tags=("rhythm", "fast", "sixteenth"),
    ),
)


# ── Polyphonic headroom: the texture the product's actual failing input has ────

# Every case above is monophonic, so "melody line only" — the decided behaviour for
# polyphonic input — was 0% measured, and the complaint that started the accuracy work
# was a Fur Elise piano recording.  A rule cannot be gated on a corpus that cannot
# express the input it is for, which is why these two exist.
#
# Both are ``DIAG_PHRASE`` at ``DIAG_TEMPO_BPM`` with an accompaniment added and every
# ``RenderOptions`` field left at CLEAN, so ``diag_baseline`` is their exact monophonic
# control and the accompaniment is the single variable — the same discipline the render
# defect cases use.  And both accompany with the SAME harmony, so the pair differs in
# texture only: one sustains the chord, the other breaks it into eighths.
#
# The reference notes stay the eleven melody notes.  An accompaniment note the pipeline
# reports is therefore a false positive by construction, which is exactly the charge a
# melody-extraction case has to be able to make — see ``synth.render``.
#
# Why the accompaniment tops out at G3 (55) while the melody bottoms at C4 (60): the two
# hands must not share a pitch, or "the pipeline returned 60" would be unattributable and
# a precision score would stop meaning anything.  The fourth of clear air also makes a
# correct answer REACHABLE — take the top line — so these remain clips the pipeline
# should get right, per the corpus rule at the top of this file.  They are still hard:
# Basic Pitch fires on the accompaniment, and the f0 contour ``_contour_segments`` reads
# is a mixture rather than one voice.
#
# Both were verified WRONG before being added rather than assumed to be hard, and the
# measurement is sharper than "polyphony is hard" — it names one mechanism:
#
#   poly_block_chords   notes.f1 0.000, n_est 11 against n_ref 11, tempo 96 EXACT,
#                       beats.f1 1.000.  Eleven segments in the right places with every
#                       pitch 12 to 24 semitones low: [36, 50, 45, 46, 55, 50, 47, 48,
#                       55, 52, 36] for a reference of [60, 62, 64, 65, 67, 69, 71, 72,
#                       67, 64, 60].  So segmentation and tempo are unharmed and the
#                       pipeline is transcribing the LEFT HAND — pyin returns the
#                       lowest strong voice of a mixture, and nothing downstream asks
#                       which voice that was.
#   poly_alberti_bass   notes.f1 0.000, n_est 20, est_tempo 183 (~2x, the eighth-note
#                       left hand), beats.f1 0.710, solfa.ghost_count 9.  The broken
#                       chord also drags the GRID, which the block chords do not.
#
# ``solfa.degree_accuracy`` is 0.727 and 0.636 rather than 0.000 only because the
# accompaniment is diatonic in the same key, so wrong-voice pitches still often land on
# a right-looking degree.  Read notes.f1 here, not the solfa columns — that gap between
# them is itself the warning that degree accuracy alone cannot see this defect.
#
# I - IV - I - V - I - I, one chord per two beats, six chords across the phrase's 12.
_PROGRESSION: tuple[tuple[int, int, int], ...] = (
    (48, 52, 55),  # C3 E3 G3
    (41, 45, 48),  # F2 A2 C3
    (48, 52, 55),
    (43, 47, 50),  # G2 B2 D3
    (48, 52, 55),
    (48, 52, 55),
)

# Block chords: one voice per chord tone, each held its full two beats.  Three notes
# sounding under the melody at once — the thickest texture in the corpus.
BLOCK_CHORD_VOICES: tuple[tuple[tuple[int | None, float], ...], ...] = tuple(
    tuple((chord[voice], 2.0) for chord in _PROGRESSION) for voice in range(3)
)

# Alberti bass: low-high-mid-high eighths, the figure Fur Elise's left hand actually
# plays.  One voice, so the audio is only ever two notes thick — thinner than the block
# chords and the harder case anyway, because it puts 24 competing onsets against the
# melody's 11 and gives the contour a second line that never holds still.
ALBERTI_VOICES: tuple[tuple[tuple[int | None, float], ...], ...] = (
    tuple((chord[i], 0.5) for chord in _PROGRESSION for i in (0, 2, 1, 2)),
)

POLYPHONIC_CASES: tuple[Case, ...] = (
    Case(
        name="poly_block_chords_c_major",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=CLEAN,
        tags=("polyphonic", "melody_line", "block_chords"),
        accompaniment=BLOCK_CHORD_VOICES,
    ),
    Case(
        name="poly_alberti_bass_c_major",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE,
        options=CLEAN,
        tags=("polyphonic", "melody_line", "alberti"),
        accompaniment=ALBERTI_VOICES,
    ),
)


# ── Close voicing: the accompaniment in the melody's own register ──────────────
#
# Both cases above are already at 1.000 on every metric, which left the polyphonic work
# with nothing to gate on — a fix cannot be measured against a saturated case.  This pair
# supplies the headroom, and it is the case the research doc's W4 names as the thing that
# must be authored before the contour-head tracker is built.
#
# ``NARROW_ARCH_PHRASE`` is 12 beats so it lines up with ``_PROGRESSION``'s six two-beat
# chords, and ``close_voicing_control_c_major`` renders it with no accompaniment at all.
# That control is what makes the accompaniment the single variable, exactly as
# ``diag_baseline`` does for the two cases above; it scores 1.000 on everything, so the
# melody itself is not the difficulty.
#
# TWO HYPOTHESES DIED GETTING HERE, both by measurement, and both are recorded because
# the wrong ones are easy to repeat:
#
#   "The case must keep the melody floor from firing."  ``_melody_floor_hz`` gates on
#   median ``skyline - pyin`` over 6.0 semitones, so the obvious design was an
#   accompaniment close enough for the register test to miss.  It cannot be built: the
#   floor fired at +12.3 to +24.1 on every close voicing tried, because pyin on a
#   MIXTURE returns a periodicity far below any sounding voice rather than the lowest
#   sounding voice.  The disagreement figure is not a function of the voicing gap at all.
#
#   "Closeness itself is the defect."  Also false.  ``DIAG_PHRASE`` under these very
#   shells scores 1.000, and a two-voice shell at the ORIGINAL low register (41..52)
#   scores 0.870 — worse than the close one — because F2's third harmonic lands on C4 and
#   is read as a melody note.  Closeness is only half of it.
#
# What survives is the INTERACTION, and each control isolates one half of it:
#
#   melody 60..67 + shells 52..59   notes.f1 0.500   <- close_voicing_c_major
#   melody 60..67 + no accompaniment      1.000      <- close_voicing_control_c_major
#   melody 60..67 + shells 41..52         0.923      same melody, accompaniment dropped
#   melody 60..72 + shells 52..59         1.000      same shells, melody widened
#
# So the defect needs a melody whose ENTIRE range sits within a semitone or two of the
# accompaniment's top voice.  Widen the melody or drop the accompaniment and it goes away.
#
# THE MECHANISM, named rather than guessed: the floor fires and computes midi 60, which is
# CORRECT — the accompaniment tops out at B3 (59).  Re-running pyin from ``fmin`` = 60 then
# removes the mixture's strongest component from pyin's search band while leaving its
# energy in the signal, so pyin finds no periodicity it is allowed to report and declares
# the clip unvoiced.  ``_segment_contour`` returns 4 notes from 336 f0 frames, covering
# 2.5 s of 7.5 s, and every surviving event carries ``voiced_prob`` 0.011-0.023.  Read that
# number: this is not a wrong pitch, it is NO pitch.  Every pitch the case does report is
# right (est [60, 62, 60, 60], none of them an accompaniment pitch), so precision is
# perfect and recall is what collapses — the opposite signature to the two cases above,
# which reported the wrong VOICE.
#
# Which is why this is W4's prerequisite specifically: the ``contour`` head has neither an
# ``fmin`` band nor a voiced/unvoiced decision, so it is the one tracker that cannot fail
# this way.  ``MELODY_FLOOR_MARGIN_SEMITONES`` is the other lever — 2.0 is what puts
# ``fmin`` one semitone above B3 — but moving it trades this case against the two above.
#
# Attribution is exact: the shells use 52, 53, 55, 57, 59 and the melody uses
# 60, 62, 64, 65, 67, so no reported pitch is ambiguous about which hand produced it.  The
# third chord tone is always a melody pitch (C4 60, D4 62) at this voicing, which is why
# these are two-note shells rather than triads — a triad here would break attribution.
#
# The clip is one the pipeline SHOULD get right, per the rule at the top of this file: two
# accompaniment voices at ``_ACCOMPANIMENT_GAIN`` sum to 0.90 against the melody's 1.00, so
# the melody is louder than the whole accompaniment put together, not merely the loudest
# single voice.  "Take the loudest line" would answer it.  EXPECTED TO SCORE BADLY all the
# same, like the vibrato cases: it is a regression gate, so what matters is that 0.500 does
# not get worse until something is built to move it.
#
# A fifth-wide arch, up and down twice.  Narrow on purpose — every other melody in this
# corpus spans an octave or more, which is precisely why none of them could show this.
NARROW_ARCH_PHRASE: tuple[tuple[int | None, float], ...] = (
    (60, 1), (62, 1), (64, 1), (65, 1), (67, 1), (65, 1),
    (64, 1), (62, 1), (60, 1), (64, 1), (62, 1), (60, 1),
)

# ``_PROGRESSION``'s six chords as two-note shells raised into 52..59 — the highest
# voicing available before the third chord tone collides with the melody.
_CLOSE_SHELLS: tuple[tuple[int, int], ...] = (
    (52, 55),  # C: E3 G3
    (53, 57),  # F: F3 A3
    (52, 55),
    (55, 59),  # G: G3 B3
    (52, 55),
    (52, 55),
)

CLOSE_SHELL_VOICES: tuple[tuple[tuple[int | None, float], ...], ...] = tuple(
    tuple((chord[voice], 2.0) for chord in _CLOSE_SHELLS) for voice in range(2)
)

CLOSE_VOICING_CASES: tuple[Case, ...] = (
    Case(
        name="close_voicing_control_c_major",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=NARROW_ARCH_PHRASE,
        options=CLEAN,
        tags=("monophonic", "control", "narrow_range"),
    ),
    Case(
        name="close_voicing_c_major",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=NARROW_ARCH_PHRASE,
        options=CLEAN,
        tags=("polyphonic", "melody_line", "close_voicing", "narrow_range"),
        accompaniment=CLOSE_SHELL_VOICES,
    ),
)


# ── Long clip: the multi-minute regime the short cases cannot reach ───────────
# Every other case in this corpus renders to between 3.71 and 8.82 seconds, so without this
# one the long-clip regime was 0% measured while ``max_clip_seconds`` accepted 180.
#
# **The name is now historical and deliberately not corrected.**  When this case was added,
# ``pyin_max_seconds`` was 60 and 67.8 s put it over the cap: above the cap ``_pyin_track``
# returns empty arrays, which takes out ``pyin_refine`` AND ``pyin_semitone`` together, and
# the latter is by its own docstring "what fixes the ghost accidentals at their source".
# Forcing that skip on all 38 short cases measured the size of it — solfa.chromatic_ghosts
# 1.526 -> 3.526, key.exact 0.895 -> 0.789, sixteen gated metrics failing — a cliff rather
# than a graceful loss of coverage, and the best available explanation for a
# spurious-accidental report arriving from real recordings while this corpus looked clean.
# The cap is now 180 (see ``config.pyin_resolution`` for what paid for that), so this clip
# is refined like any other and there is no cliff inside the accepted range.  Renaming it
# would change ``corpus_fingerprint`` and discard the per-case baseline history for the one
# case that history is most interesting for; the name stays until something else forces a
# re-fingerprint.
#
# What it still measures, which is why it stays: 99 notes and 67.8 s of continuous vibrato
# is the only place the corpus exercises long-horizon behaviour at all — key estimation with
# enough evidence to outvote its own ghosts, tempo over 108 beats, and refinement over 527
# events rather than ~60.  It is also the guard on the lifted cap: if the cap regresses to a
# value under 67.8 s, or the coarse pyin grid is lost, this case is where it shows.
#
# Three deliberate choices:
#
#   It carries VIBRATO, and the same 5.5 Hz / 1.2 semitones as ``vibrato_heavy``.  A clean
#   long case would gate nothing: ``pyin_semitone`` is a no-op by construction wherever
#   pyin and Basic Pitch agree, so losing it costs a clean clip nothing and the case would
#   pass whether the cap were 60 s or 6 s.  The defect has to be present for its fix — or
#   the absence of its fix — to be visible.
#
#   It is ``DIAG_PHRASE`` REPEATED, not new material, so this case and ``vibrato_heavy``
#   differ in exactly one variable — length.  The delta between the pair is length's effect
#   and nothing else, which is what makes it readable as a diagnostic rather than just
#   another failing case.
#
#   Nine repeats, not eight.  The original reason was that eight lands at 60.3 s, three
#   tenths over the then-60 s cap, so a rounding change or a ``tail_sec`` edit would silently
#   drop it under and the case would stop testing the thing it existed for.  That margin no
#   longer guards a cap, but nine repeats are kept because they are what the baseline was
#   measured on and 67.8 s is the length the long-horizon claims above are made about.
#
# STILL EXPECTED TO SCORE BADLY, like ``vibrato_heavy`` and for the same underlying reason:
# it is a regression gate, so what matters is that the recorded numbers do not get worse, not
# that they are good.  Read it next to ``vibrato_heavy`` — the pair is now much closer than
# it was (``notes.f1`` 0.596 against 0.516, ``solfa.degree_accuracy`` 0.988 against 1.000),
# which is what lifting the cap was meant to achieve.  A gap reopening means refinement
# stopped reaching long clips.
LONG_CLIP_CASES: tuple[Case, ...] = (
    Case(
        name="long_clip_over_pyin_cap",
        key="C major",
        tempo_bpm=DIAG_TEMPO_BPM,
        notes=DIAG_PHRASE * 9,
        options=RenderOptions(vibrato_hz=5.5, vibrato_semitones=1.2),
        tags=("long", "pyin_cap", "regime", "vibrato"),
    ),
)


# ── The corpus ────────────────────────────────────────────────────────────────

CASES: tuple[Case, ...] = (
    MAJOR_CASES
    + MINOR_CASES
    + KEY_HEADROOM_CASES
    + DIAGNOSTIC_CASES
    + VIBRATO_BREADTH_CASES
    + RHYTHM_CASES
    + POLYPHONIC_CASES
    + CLOSE_VOICING_CASES
    + LONG_CLIP_CASES
)


def corpus_fingerprint(cases: tuple[Case, ...] = CASES) -> str:
    """Stable hash of the case definitions (notes, key, tempo, render options).

    Lives here rather than in ``report.py`` because both writers and readers need it:
    ``report.py`` stamps it into the JSON and the regression gate checks it, and a
    baseline recorded against different audio silently diffs against current numbers
    otherwise — the case is still *present* in baseline.json, so the gate's
    "absent from baseline" skip never fires.

    Short (16 hex chars) because it only has to catch "this baseline was recorded
    against a different corpus", not resist tampering.

    ``accompaniment`` is included only when a case HAS one.  Emitting it
    unconditionally — even as an empty list — would change the fingerprint of all 40
    monophonic cases whose audio is bit-identical, and the gate would then declare
    every stored number incomparable on a change that moved no sample.  Same reason
    the accompaniment gain is a module constant in ``synth`` rather than a
    ``RenderOptions`` field, since ``asdict(case.options)`` is hashed here verbatim.
    """
    payload = json.dumps(
        [
            {
                "name": case.name,
                "key": case.key,
                "tempo_bpm": case.tempo_bpm,
                "notes": [list(note) for note in case.notes],
                "options": asdict(case.options),
                "tags": list(case.tags),
                **(
                    {"accompaniment": [[list(n) for n in v] for v in case.accompaniment]}
                    if case.accompaniment
                    else {}
                ),
            }
            for case in cases
        ],
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
