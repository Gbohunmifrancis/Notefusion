"""Ground-truth corpus for the accuracy harness (Phase 1 — measurement only).

Every case is a clip the pipeline *should* get right: the tonic is stated
unambiguously, every pitch sits inside Basic Pitch's usable range, and no note is
shorter than the pipeline's own duration floors.  That is deliberate — when a
metric drops, the cause is a pipeline defect, not corpus ambiguity.

Three groups:

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
    # That is a re-label in _refine_pitches, and it needs its own scouting — the
    # 1.792 outlier is exactly the unbounded-bias case that function's docstring
    # declines by design.  Do not fold it into the merge.
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


# ── The corpus ────────────────────────────────────────────────────────────────

CASES: tuple[Case, ...] = (
    MAJOR_CASES + MINOR_CASES + KEY_HEADROOM_CASES + DIAGNOSTIC_CASES + RHYTHM_CASES
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
            }
            for case in cases
        ],
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]
