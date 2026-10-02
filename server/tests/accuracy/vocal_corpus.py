"""The vocal corpus: real tunes, sung the way people sing them into a phone.

Each case is one tune in one singing style (``tests.accuracy.vocal_synth.VocalOptions``).
The tunes are chosen for what they exercise — repeated notes, leaps, a long held
note, a legitimate chromatic that must *survive*, a fast run, a low male register and
a high female one — and the styles are the physical defects of real voices: tuning
sitting between two semitones, drift, scoops, portamento, vibrato, syllables, noise.

Scored by ``tests.accuracy.runner.run_vocal`` and reported under
``vocal_report.json`` / ``vocal_baseline.json``, separately from the instrument corpus,
whose baseline fingerprint this must never disturb.
"""

import hashlib
from dataclasses import asdict, dataclass

from tests.accuracy.vocal_synth import VocalOptions

Notes = tuple[tuple[int | None, float], ...]


@dataclass(frozen=True)
class VocalCase:
    name: str
    key: str
    tempo_bpm: int
    notes: Notes
    options: VocalOptions
    tags: tuple[str, ...]


def _seq(*items: tuple[int | None, float]) -> Notes:
    return tuple(items)


# ── Tunes ─────────────────────────────────────────────────────────────────────

# Twinkle, C major, C4 register.  Six repeated-note pairs.
TWINKLE = (
    "C major",
    100,
    _seq(
        (60, 1), (60, 1), (67, 1), (67, 1), (69, 1), (69, 1), (67, 2),
        (65, 1), (65, 1), (64, 1), (64, 1), (62, 1), (62, 1), (60, 2),
    ),
)

# Amazing Grace, F major, low male register (F3 = 53).  Long notes, sixths, a breath.
AMAZING_GRACE = (
    "F major",
    80,
    _seq(
        (60, 1), (65, 2), (69, 0.5), (65, 0.5), (69, 2), (67, 1), (65, 2), (62, 1),
        (60, 2), (None, 1),
        (60, 1), (65, 2), (69, 0.5), (65, 0.5), (69, 2), (67, 1), (72, 3),
    ),
)

# Ode to Joy, D major.  Steady quarters, repeated notes, a dotted figure.
ODE_TO_JOY = (
    "D major",
    112,
    _seq(
        (66, 1), (66, 1), (67, 1), (69, 1), (69, 1), (67, 1), (66, 1), (64, 1),
        (62, 1), (62, 1), (64, 1), (66, 1), (66, 1.5), (64, 0.5), (64, 2),
    ),
)

# Greensleeves opening, A minor with the raised 7th (G#, MIDI 68).  Under la-based
# minor that G# is ``se`` — a chromatic syllable the pipeline must keep.
GREENSLEEVES = (
    "A minor",
    96,
    _seq(
        (57, 1), (60, 2), (62, 1), (64, 1.5), (65, 0.5), (64, 1), (62, 2), (59, 1),
        (55, 1.5), (57, 0.5), (59, 1), (60, 2), (57, 1), (57, 1.5), (56, 0.5), (57, 1),
        (59, 2), (56, 1), (52, 2),
    ),
)

# A hymn-style phrase in E-flat major, the choir key.  Stepwise with one leap.
HYMN_EFLAT = (
    "Eb major",
    84,
    _seq(
        (63, 1), (63, 1), (65, 1), (67, 1), (67, 1.5), (65, 0.5), (63, 2),
        (70, 1), (68, 1), (67, 1), (65, 1), (67, 2), (None, 1), (63, 1), (65, 1), (63, 2),
    ),
)

# Chromatic passing notes in G major: F# is diatonic, the D# and C# are not.  Both
# must survive as chromatic syllables — the fix for ghost accidentals must not be
# "delete every accidental".
CHROMATIC_G = (
    "G major",
    90,
    _seq(
        (67, 1), (69, 1), (71, 1), (72, 1), (73, 1), (74, 2), (None, 0.5),
        (74, 1), (73, 1), (72, 1), (71, 1), (69, 1), (67, 2),
    ),
)

# Octave leaps and a fifth, A major, female register (A4 = 69 up to E5 = 76).
LEAPS_A = (
    "A major",
    92,
    _seq(
        (69, 1), (81, 1), (76, 1), (69, 1), (73, 1), (76, 1), (81, 2),
        (78, 1), (76, 1), (73, 1), (71, 1), (69, 2),
    ),
)

# A fast run in B-flat major: eighths at 132.
FAST_RUN_BFLAT = (
    "Bb major",
    132,
    _seq(
        (58, 0.5), (60, 0.5), (62, 0.5), (63, 0.5), (65, 0.5), (67, 0.5), (69, 0.5), (70, 0.5),
        (69, 0.5), (67, 0.5), (65, 0.5), (63, 0.5), (62, 0.5), (60, 0.5), (58, 1.5),
        (None, 0.5), (62, 0.5), (65, 0.5), (70, 1), (69, 0.5), (67, 0.5), (65, 1),
    ),
)

# Pentatonic call-and-response in C minor, the register where a low hum sits (C3 = 48).
LOW_HUM_CMINOR = (
    "C minor",
    76,
    _seq(
        (48, 1), (51, 1), (53, 1), (55, 2), (53, 1), (51, 1), (48, 2), (None, 1),
        (55, 1), (58, 1), (55, 1), (53, 1.5), (51, 0.5), (48, 3),
    ),
)

TUNES = {
    "twinkle": TWINKLE,
    "amazing_grace": AMAZING_GRACE,
    "ode_to_joy": ODE_TO_JOY,
    "greensleeves": GREENSLEEVES,
    "hymn_eflat": HYMN_EFLAT,
    "chromatic_g": CHROMATIC_G,
    "leaps_a": LEAPS_A,
    "fast_run_bflat": FAST_RUN_BFLAT,
    "low_hum_cminor": LOW_HUM_CMINOR,
}


# ── Singing styles ────────────────────────────────────────────────────────────

STYLES = {
    # A relaxed hum, nearly in tune: the floor every engine should clear.
    "hum_clean": VocalOptions(style="hum", jitter_cents=6.0, glide_sec=0.07),
    # The half-semitone trap: everything sits 40 cents sharp, so frame-wise rounding
    # lands on either neighbour at random.  Scoops onto every phrase start.
    "hum_sharp40": VocalOptions(style="hum", tuning_cents=40.0, scoop_cents=60.0, glide_sec=0.10),
    # A singer who starts slightly flat and sinks a further 45 cents by the end.
    "hum_drift": VocalOptions(style="hum", tuning_cents=-15.0, drift_cents=-45.0, glide_sec=0.09),
    # Open vowel with a developed vibrato, scooped onsets and slow portamento.
    "ah_vibrato": VocalOptions(
        style="ah", vibrato_cents=45.0, vibrato_hz=5.5, scoop_cents=80.0, glide_sec=0.12, tuning_cents=15.0
    ),
    # A trained singer's wide vibrato: ±70 cents at 6.2 Hz.
    "ah_wide_vibrato": VocalOptions(style="ah", vibrato_cents=70.0, vibrato_hz=6.2, glide_sec=0.09, tuning_cents=-25.0),
    # "Da da da": a consonant gap and a dip at every note, slightly flat.
    "da_syllables": VocalOptions(style="da", scoop_cents=40.0, tuning_cents=-30.0),
    # A phone in a kitchen: loud noise floor and breath, hum slightly sharp.
    "hum_noisy": VocalOptions(style="hum", mic_noise_db=-28.0, breath_noise_db=-30.0, tuning_cents=20.0, glide_sec=0.09),
    # Very legato, very sharp: 180 ms glides and a 45-cent offset.
    "hum_slow_glides": VocalOptions(style="hum", glide_sec=0.18, tuning_cents=45.0, scoop_cents=50.0, jitter_cents=10.0),
}

# Which styles each tune is sung in.  Every tune gets the clean hum and the two
# worst offenders (sharp40, ah_vibrato); the rest are spread so each style appears
# on at least three tunes.
_PLAN = {
    "twinkle": ("hum_clean", "hum_sharp40", "ah_vibrato", "da_syllables", "hum_noisy"),
    "amazing_grace": ("hum_clean", "hum_sharp40", "ah_vibrato", "ah_wide_vibrato", "hum_slow_glides"),
    "ode_to_joy": ("hum_clean", "hum_sharp40", "ah_vibrato", "da_syllables", "hum_drift"),
    "greensleeves": ("hum_clean", "hum_sharp40", "ah_vibrato", "ah_wide_vibrato"),
    "hymn_eflat": ("hum_clean", "hum_sharp40", "ah_vibrato", "hum_drift", "da_syllables"),
    "chromatic_g": ("hum_clean", "hum_sharp40", "ah_vibrato", "hum_slow_glides"),
    "leaps_a": ("hum_clean", "hum_sharp40", "ah_vibrato", "ah_wide_vibrato", "hum_noisy"),
    "fast_run_bflat": ("hum_clean", "hum_sharp40", "ah_vibrato", "da_syllables"),
    "low_hum_cminor": ("hum_clean", "hum_sharp40", "ah_vibrato", "hum_noisy", "hum_drift", "hum_slow_glides"),
}

CASES: tuple[VocalCase, ...] = tuple(
    VocalCase(
        name=f"{tune}__{style}",
        key=TUNES[tune][0],
        tempo_bpm=TUNES[tune][1],
        notes=TUNES[tune][2],
        options=STYLES[style],
        tags=("vocal", tune, style, STYLES[style].style),
    )
    for tune, styles in _PLAN.items()
    for style in styles
)


def vocal_corpus_fingerprint(cases: tuple[VocalCase, ...] = CASES) -> str:
    digest = hashlib.sha256()
    for case in cases:
        digest.update(repr((case.name, case.key, case.tempo_bpm, case.notes, asdict(case.options))).encode())
    return digest.hexdigest()[:16]
