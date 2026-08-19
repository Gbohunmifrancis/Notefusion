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
import tempfile
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np

from app.config import settings
from app.pipeline import solfa

# ── Audio preview synthesis ───────────────────────────────────────────────────

# Sample rate for the synthesised WAV preview returned alongside the result.
# 22 050 Hz gives CD-quality for speech/melody with half the data of 44 100 Hz.
PREVIEW_SAMPLE_RATE = 22_050

# Synthesis voice: fundamental + harmonics mix (piano-like timbre).
# Weights sum to < 1.0 so headroom is preserved before normalisation.
_HARMONIC_WEIGHTS = (0.50, 0.20, 0.12, 0.08)  # 1st, 2nd, 3rd, 4th harmonic

# ADSR parameters (seconds). Short attack / longer release sounds more natural
# than a rectangular envelope when notes are hummed or played on a soft instrument.
_ATTACK_SEC = 0.015
_DECAY_SEC = 0.040
_RELEASE_FRAC = 0.25  # release is 25 % of note duration, capped at 0.18 s
_SUSTAIN_LEVEL = 0.80  # sustain amplitude relative to peak (after decay)

# ── Post-processing thresholds ────────────────────────────────────────────────

# Hard lower bounds; adaptive logic may raise these further per-clip.
MIN_AMPLITUDE_MELODY = 0.15  # v1 was 0.20 — allow softer recordings to pass
MIN_AMPLITUDE_POLY = 0.12  # v1 was 0.15

# Adaptive threshold: ADAPTIVE_FACTOR × p75(clip amplitudes), floored at the
# constant above.  Prevents a fixed value from silencing quiet performances.
ADAPTIVE_FACTOR = 0.25

# Events shorter than this are almost always artefacts (breath noise, finger
# scrapes, string squeak).
MIN_NOTE_SEC = 0.06

# Onset merging: consecutive same-pitch events separated by a gap smaller than
# the mode-specific constant are fused into a single event.
MERGE_GAP_MELODY = 0.08  # ~1 sixteenth note at 120 BPM
MERGE_GAP_POLY = 0.05  # tighter for polyphonic — avoid swallowing trills

# Key detection: fewer than this many note events and no pitch profile is
# reliable; cap the reported confidence so the mobile shows the prompt.
MIN_NOTES_FOR_KEY = 6
KEY_CONFIDENCE_CAP_LOW = 0.45

# pyin pitch refinement (defect 6).  fmin is roughly C2, below any sung
# fundamental; fmax matches the maximum_frequency handed to Basic Pitch so the
# two stages cannot disagree about what counts as a plausible fundamental.
PYIN_FMIN_HZ = 65.0
PYIN_FMAX_HZ = 1050.0

# An event needs at least this many voiced pyin frames before its contour is
# trusted.  pyin's default hop is 512 samples (23 ms at 22.05 kHz), so three
# frames is ~70 ms — just under MIN_NOTE_SEC, which means a note long enough to
# survive the duration filter normally clears this too, and only a genuinely
# unvoiced span falls short.
PYIN_MIN_VOICED_FRAMES = 3

# Median voiced probability an event must reach before its pitch is corrected.
# A floor against noise rather than a discriminator: measured over the accuracy
# corpus, real notes sit at 0.69-0.76 under heavy vibrato and 0.95-0.98 when
# clean, so nothing real is anywhere near this.
PYIN_MIN_VOICED_PROB = 0.5

# How far from a whole number of octaves the pyin/Basic Pitch disagreement may
# sit and still be read as an octave error.  Measured over the corpus, real
# octave errors land within 0.01 semitones of exactly 12, so this is generous;
# it stays under 2 so a genuinely wrong pitch a whole tone from the octave (a
# +14 ghost does occur) is left alone rather than snapped.
PYIN_OCTAVE_TOLERANCE = 1.5

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
    Each note is rendered as a sum of four harmonics with amplitudes defined by
    ``_HARMONIC_WEIGHTS``.  An ADSR envelope is applied:
      • Attack  : linear ramp-up over ``_ATTACK_SEC`` seconds.
      • Decay   : linear drop to the sustain level over ``_DECAY_SEC`` seconds.
      • Sustain : held at ``_SUSTAIN_LEVEL`` × peak for the body of the note.
      • Release : linear fade-out over the final ``_RELEASE_FRAC`` of the note
                  (capped at 0.18 s so long notes still end cleanly).

    The confidence score of each note is used as a per-note velocity scaler so
    low-confidence notes are softer than high-confidence ones.

    The final mix is normalised to 0.9 × peak and encoded as signed 16-bit PCM
    WAV (no dependencies beyond numpy + soundfile).

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

    beat_sec = 60.0 / max(float(tempo_bpm), 20.0)  # seconds per beat

    # Total length = end of the last note + short tail so the release doesn't clip
    max_end_sec = max(n.start_beat * beat_sec + n.dur_beats * beat_sec for n in notes)
    tail_sec = 0.25
    total_samples = int((max_end_sec + tail_sec) * sr)
    audio = np.zeros(total_samples, dtype=np.float64)

    for n in notes:
        freq = 440.0 * 2.0 ** ((n.pitch_midi - 69) / 12.0)
        start_samp = int(n.start_beat * beat_sec * sr)
        dur_samp = max(int(n.dur_beats * beat_sec * sr), int(0.04 * sr))
        end_samp = min(start_samp + dur_samp, total_samples)
        actual = end_samp - start_samp
        if actual <= 0:
            continue

        t = np.arange(actual, dtype=np.float64) / sr

        # Additive synthesis: sum of harmonics
        tone = np.zeros(actual, dtype=np.float64)
        for harmonic_idx, weight in enumerate(_HARMONIC_WEIGHTS, start=1):
            tone += weight * np.sin(2.0 * np.pi * freq * harmonic_idx * t)

        # ADSR envelope
        env = np.ones(actual, dtype=np.float64)
        atk = min(int(_ATTACK_SEC * sr), actual // 4)
        dec = min(int(_DECAY_SEC * sr), actual // 4)
        rel = min(int(_RELEASE_FRAC * actual), int(0.18 * sr))

        if atk > 0:
            env[:atk] = np.linspace(0.0, 1.0, atk)
        if dec > 0 and atk + dec <= actual:
            env[atk : atk + dec] = np.linspace(1.0, _SUSTAIN_LEVEL, dec)
            if atk + dec < actual:
                env[atk + dec :] = _SUSTAIN_LEVEL
        if rel > 0:
            env[-rel:] *= np.linspace(1.0, 0.0, rel)

        # Velocity from confidence (range 0.4 – 1.0 so even low-conf notes audible)
        velocity = 0.4 + 0.6 * float(n.conf)
        audio[start_samp:end_samp] += tone * env * velocity

    # Normalise to 0.9 × full scale
    peak = np.max(np.abs(audio))
    if peak > 1e-6:
        audio = audio / peak * 0.90

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
    (winner_pc, winner_mode), winner_score = ranked[0]
    runner_up_score = ranked[1][1]
    # Divided by the number of voters so the margin means the same thing whether all
    # five profiles ran or only three did.
    margin = (winner_score - runner_up_score) / voted

    winner = _key_from_identity(winner_pc, winner_mode)
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


# ── Event post-processing helpers ─────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class Event:
    """One detected note event, in the seconds domain, between inference and music21.

    Frozen because every stage below rebuilds rather than mutates — the 4-tuple this
    replaced could not be mutated either, and keeping that invariant means one stage
    cannot quietly change an event another stage has already read.  Derive a modified
    copy with ``dataclasses.replace``.

    Carries exactly the four values Basic Pitch reports and the pipeline consumes.  It
    is a class rather than the tuple it replaced because five stages read these fields
    by name where they used to index positionally, not because it holds anything new.
    """

    start: float
    end: float
    pitch: int
    amp: float


def _adaptive_amplitude_floor(events: list[Event], base: float) -> float:
    """Return max(base, ADAPTIVE_FACTOR × p75(amplitudes)).

    Using the clip's own amplitude distribution prevents a fixed threshold
    from silencing quiet hummed or played recordings while still suppressing
    noise bursts that exceed the absolute base level.
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
    """Fuse consecutive same-pitch events separated by less than *gap_sec*.

    Basic Pitch often splits a single sustained note or a clearly-intended
    short repeated note (e.g. a triplet figure) into several fragments.
    Merging them reduces ghost syllables in the solfa output and improves
    overall confidence scores.

    The merged event inherits the amplitude of the louder fragment and spans
    from the earliest start to the latest end.  Multiple passes are made until
    no further merges are possible (handles chains of three or more).

    The pitch test is exact equality, deliberately and permanently.  A
    semitone-tolerant variant (plan phase 3c, to fuse vibrato that crosses a
    semitone boundary) was measured on the corpus and struck: see the
    vibrato_heavy comment in tests/accuracy/corpus.py for the geometry.  In
    short, Basic Pitch fires at *both* neighbours of a wobbling pitch, so
    consecutive fragments of one note are two semitones apart, not one — 43 of
    63 adjacencies against 5 — and the shorter fragment measures 116.1 ms
    (2560/22050, a quantization constant) on genuine legato semitone steps in
    fast_sixteenths_c_major just as it does on vibrato fragments, so no
    duration cap separates them.  Do not reintroduce a tolerance here without
    reading that comment first.
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
                if curr.pitch == nxt.pitch and 0.0 <= gap < gap_sec:
                    # Merge: span from curr.start to nxt.end, keeping the louder
                    # fragment's amplitude.  Both have the same pitch by the test
                    # above, so taking the louder half wholesale is equivalent to
                    # the old max(c_amp, n_amp) on the fields that existed then.
                    loud = curr if curr.amp >= nxt.amp else nxt
                    result.append(replace(loud, start=curr.start, end=nxt.end))
                    i += 2
                    changed = True
                    continue
            result.append(curr)
            i += 1
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


# ── pyin pitch refinement (defect 6) ──────────────────────────────────────────


def _pyin_contour(wav_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(frame times, f0 as MIDI with NaN where unvoiced, voiced probability).

    Basic Pitch decides *where* notes are and pyin decides *what pitch* they are:
    a frame-level f0 tracker has no note segmentation of its own, so it cannot
    replace inference, but it is a far better pitch estimator inside boundaries
    that already exist.  That division of labour is the whole point of this stage.

    Returns three empty arrays when the clip is unreadable, too long to refine
    within the queue's latency budget, or produced no voiced frames at all — which
    every caller reads as "no refinement available".
    """
    import librosa

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, sr = librosa.load(str(wav_path), sr=22_050, mono=True)
            duration = len(y) / float(sr) if sr else 0.0
            # Checked after the decode and before pyin because the decode is the
            # cheap half: pyin is ~0.22x realtime and this is a single-worker queue.
            if duration > settings.pyin_max_seconds:
                print(
                    f"[notefusion] clip is {duration:.0f}s, over the "
                    f"{settings.pyin_max_seconds:.0f}s pyin budget; skipping refinement",
                    flush=True,
                )
                return np.empty(0), np.empty(0), np.empty(0)
            f0, _voiced_flag, voiced_prob = librosa.pyin(
                y, fmin=PYIN_FMIN_HZ, fmax=PYIN_FMAX_HZ, sr=sr
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


def _refine_pitches(events: list[Event], wav_path: Path) -> list[Event]:
    """Correct octave errors against a pyin f0 contour.

    Basic Pitch locks onto the second harmonic often enough to matter: measured on
    the clean synthetic control case, 9 of 15 detected events were a whole octave
    above the note that produced them — including notes whose fundamental was never
    reported at all.  That is why the *clean* case scored worse than the noisy one,
    since additive noise breaks the fundamental/overtone ambiguity.  pyin's median
    over the same span was within 0.01 semitones of the truth on every one of them.

    Only whole-octave disagreements are acted on.  Replacing the pitch outright
    whenever pyin disagrees would be a much larger change with much more to go
    wrong: a fragment shorter than one vibrato cycle has a median biased toward
    wherever in the cycle it happens to sit, so on that evidence pyin is *not*
    reliable to the semitone per fragment — but a bias of at most a semitone or so
    cannot manufacture or hide a twelve-semitone gap, which is what makes the octave
    decision safe where a general one is not.

    Runs before ``_merge_onsets`` on purpose: two fragments of one note that were
    split apart only because Basic Pitch put them an octave apart become the same
    pitch here, and the existing exact-pitch merge then fuses them with no tolerance
    of its own and therefore no risk to genuine semitone steps.
    """
    times, midi, voiced_prob = _pyin_contour(wav_path)
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

        octaves = round((median_midi - evt.pitch) / 12.0)
        if octaves == 0 or confidence < PYIN_MIN_VOICED_PROB:
            refined.append(evt)
            continue

        offset = median_midi - evt.pitch - 12.0 * octaves
        candidate = evt.pitch + 12 * octaves
        if abs(offset) > PYIN_OCTAVE_TOLERANCE or not 0 <= candidate <= 127:
            refined.append(evt)
            continue

        refined.append(replace(evt, pitch=candidate))
        corrected += 1

    if corrected:
        print(
            f"[notefusion] pyin corrected the octave of {corrected}/{len(events)} events",
            flush=True,
        )
    return refined


import warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)


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


def transcribe(
    audio_path: Path,
    mode: str = "melody",
    key_override: str | None = None,
    tempo_override: int | None = None,
    progress=lambda fraction: None,
) -> TranscriptionResult:
    """Decode once, then transcribe the decoded WAV.

    The decoded file has to outlive inference.  Tempo and beat tracking read the
    same audio Basic Pitch was given, and librosa has no backend for a .m4a on a
    slim container — pointing it at the original upload is exactly how a clip
    ends up reported at the 100 BPM fallback.  So the whole pipeline runs inside
    this ``finally`` and the temporary WAV is deleted once, here.

    A ``.wav`` input is handed back untouched by ``_ensure_wav_path`` and is
    therefore never deleted here; the caller owns it (``JobQueue._run`` unlinks
    the upload for privacy, TRD par. 9).
    """
    target_path, is_temp_wav = _ensure_wav_path(audio_path)
    try:
        return _transcribe_wav(target_path, mode, key_override, tempo_override, progress)
    finally:
        if is_temp_wav:
            target_path.unlink(missing_ok=True)


# ── Tempo and beat phase ──────────────────────────────────────────────────────

# Beat tracking is only trusted inside this range: librosa returns NaN on very
# short or near-silent clips and values well outside it on unusual material.
_MIN_BPM = 20.0
_MAX_BPM = 400.0
_DEFAULT_BPM = 100.0


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


def _estimate_tempo_and_beats(
    wav_path: Path, events: list[Event], tempo_override: int | None
) -> tuple[float, np.ndarray]:
    """(BPM, detected beat times in seconds) for the decoded WAV.

    A user tap-in override always wins for the BPM (TRD par. 5), but beat
    tracking still runs — seeded with that BPM — because the override says how
    fast the piece is, not where its downbeats sit.  Beat times come back empty
    when tracking fails, which ``_beat_origin`` reads as "no phase information".
    """
    import librosa

    override_bpm = float(tempo_override) if tempo_override else 0.0

    beat_times = np.empty(0)
    tracked_bpm = 0.0
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, sr = librosa.load(str(wav_path), sr=22_050, mono=True)
        seed = {"start_bpm": override_bpm} if override_bpm else {}
        raw_est, beats = librosa.beat.beat_track(y=y, sr=sr, units="time", **seed)
        raw_bpm = float(np.atleast_1d(raw_est)[0])
        if np.isfinite(raw_bpm) and _MIN_BPM <= raw_bpm <= _MAX_BPM:
            tracked_bpm = raw_bpm
        candidates = np.asarray(beats, dtype=float).ravel()
        beat_times = candidates[np.isfinite(candidates)]
    except Exception as exc:
        print(f"[notefusion] librosa beat_track failed ({exc}); falling back to onsets/default", flush=True)

    if override_bpm:
        return override_bpm, beat_times

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


def _transcribe_wav(
    wav_path: Path,
    mode: str,
    key_override: str | None,
    tempo_override: int | None,
    progress,
) -> TranscriptionResult:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    from music21 import key as m21key
    from music21 import meter, stream
    from music21 import note as m21note
    from music21 import tempo as m21tempo
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    progress(0.05)

    # ── 1. AMT inference ──────────────────────────────────────────────────────
    # Thresholds are tuned by mode:
    #   melody  — lower onset_threshold to catch faint sung/hummed attacks
    #   poly    — higher thresholds reduce false simultaneous harmonics
    #
    # minimum_note_length is set in milliseconds:
    #   100 ms for melody: shorter fragments add post-processing noise for
    #     solfa use cases without providing reliable pitch information.
    #   80 ms for poly: slightly shorter to preserve fast arpeggios.
    #
    # maximum_frequency capped at 1050 Hz (~C6):
    #   Frequencies above this are rarely the fundamental of a sung or played
    #   note in typical NoteFusion use cases; they are almost always overtones
    #   of a lower pitch or microphone self-noise.
    onset_thresh = 0.35 if mode == "melody" else 0.45
    frame_thresh = 0.25 if mode == "melody" else 0.30
    min_note_ms = 100 if mode == "melody" else 80
    max_freq_hz = 1050.0

    _, midi_data, note_events = predict(
        str(wav_path),
        ICASSP_2022_MODEL_PATH,
        onset_threshold=onset_thresh,
        frame_threshold=frame_thresh,
        minimum_note_length=min_note_ms,
        maximum_frequency=max_freq_hz,
    )

    progress(0.45)

    # ── 2. Initial duration filter ────────────────────────────────────────────
    # Discard events shorter than MIN_NOTE_SEC before computing the adaptive
    # amplitude floor so that very short noise bursts (which tend to be high-
    # amplitude) do not inflate p75 and raise the floor above real notes.
    raw_events: list[Event] = sorted(
        [
            Event(start, end, int(pitch), float(amp))
            for start, end, pitch, amp, _bends in note_events
            if (end - start) >= MIN_NOTE_SEC
        ],
        key=lambda e: e.start,
    )

    # ── 3. Adaptive amplitude floor ───────────────────────────────────────────
    min_amp_base = MIN_AMPLITUDE_MELODY if mode == "melody" else MIN_AMPLITUDE_POLY
    amp_floor = _adaptive_amplitude_floor(raw_events, min_amp_base)
    events = [e for e in raw_events if e.amp >= amp_floor]

    # ── 3b. pyin pitch refinement ─────────────────────────────────────────────
    # After the amplitude floor so pyin is not spent on events about to be dropped,
    # and before merging so an octave correction can let two fragments of one note
    # fuse on the existing exact-pitch test.
    if settings.pyin_refine and events:
        events = _refine_pitches(events, wav_path)
    progress(0.50)

    # ── 4. Onset merging ──────────────────────────────────────────────────────
    # Merge before voice-cleaning so the melody overlap resolver sees clean
    # sustained notes rather than fragmented triplet artefacts.
    merge_gap = MERGE_GAP_MELODY if mode == "melody" else MERGE_GAP_POLY
    events = _merge_onsets(events, gap_sec=merge_gap)

    # ── 5. Polyphonic deduplication ───────────────────────────────────────────
    # Remove exact pitch + onset duplicates that survive merging.
    events = _dedup_simultaneous(events)

    # ── 6. Melody mode: remove polyphonic overlap artefacts ───────────────────
    if mode == "melody" and events:
        cleaned: list[Event] = []
        for evt in events:
            if not cleaned:
                cleaned.append(evt)
                continue

            prev = cleaned[-1]

            if evt.start < prev.end:  # overlap detected
                onset_close = (evt.start - prev.start) < 0.12
                if evt.amp > prev.amp and onset_close:
                    # Current note is louder and nearly co-incident → replace
                    cleaned[-1] = evt
                else:
                    # Truncate previous to the boundary of the new one
                    if (evt.start - prev.start) >= 0.04:
                        cleaned[-1] = replace(prev, end=evt.start)
                        cleaned.append(evt)
                    # else: previous becomes too short → drop it, keep current
                    else:
                        cleaned[-1] = evt
            else:
                cleaned.append(evt)

        # Drop any note that was truncated below the absolute minimum duration
        events = [e for e in cleaned if (e.end - e.start) >= 0.04]

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
    bpm, beat_times = _estimate_tempo_and_beats(wav_path, events, tempo_override)
    sec_to_beats = bpm / 60.0
    beat_origin = _beat_origin(beat_times, events[0].start, bpm) if settings.beat_align else 0.0
    progress(0.65)

    # ── 8. music21 stream, quantized to the configured grid ───────────────────
    s = stream.Stream()
    s.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
    s.insert(0, meter.TimeSignature("4/4"))
    for evt in events:
        n = m21note.Note(evt.pitch)
        # Clamp to a sixteenth minimum so tiny surviving fragments still have a
        # well-formed duration in the score.  0.25 is one step of the default
        # grid, so this floor and the quantizer agree.
        n.duration.quarterLength = max((evt.end - evt.start) * sec_to_beats, 0.25)
        n.editorial.confidence = evt.amp
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
    score = s.makeMeasures()
    score.makeAccidentals(inPlace=True, overrideStatus=True)
    progress(0.80)

    # ── 10. Solfa mapping ─────────────────────────────────────────────────────
    # Derived from the same note list — re-labelling, never re-transcription.
    doh_pc = solfa.doh_pitch_class(detected.tonic.pitchClass, detected.mode)
    ref_doh = solfa.reference_doh([e.pitch for e in events], doh_pc)

    notes: list[TranscribedNote] = []
    bars: list[str] = []

    for measure in score.getElementsByClass(stream.Measure):
        bar_syllables: list[str] = []
        for n in measure.notes:
            syl, mark, degree = solfa.syllable(n.pitch.midi, doh_pc, ref_doh)
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

    # 4 bars per solfa line — fits a phone screen without horizontal scrolling.
    solfa_lines: list[str] = [solfa.doh_header(doh_pc)]
    for i in range(0, len(bars), 4):
        solfa_lines.append("| " + " | ".join(bars[i : i + 4]) + " |")

    # ── 11. Normalise key name for C#'s KeyParser ─────────────────────────────
    # music21 returns names like "B- major" or "a minor"; C#'s KeyParser expects
    # "Bb major" / "A minor".  _normalise_key_name does both transformations.
    normalised_key = _normalise_key_name(detected.name)

    # ── 12. MusicXML + MIDI (base64) ─────────────────────────────────────────
    musicxml = GeneralObjectExporter(score).parse().decode("utf-8")
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
        time_signature="4/4",
        musicxml=musicxml,
        midi_base64=midi_base64,
        notes=notes,
        solfa_lines=solfa_lines,
        overall_confidence=round(float(np.mean([n.conf for n in notes])), 3),
        audio_preview_base64=audio_preview_b64,
    )


class LowConfidenceError(Exception):
    """Raised when the clip yields nothing usable.

    Surfaced honestly to the user instead of returning garbage notation
    (PRD reliability NFR).  The message is propagated through the job queue,
    through the C# JobResponse.Error field (fixed in v2 of the contracts),
    and displayed verbatim on the mobile ResultScreen.
    """
