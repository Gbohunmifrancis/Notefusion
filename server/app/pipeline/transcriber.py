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

  Key-confidence guard   Fewer than MIN_NOTES_FOR_KEY pitched events makes
                         Krumhansl-Schmuckler unreliable; the confidence score is capped
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
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

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

# Key detection: fewer than this many note events → Krumhansl-Schmuckler is
# unreliable; cap the reported confidence so the mobile shows the prompt.
MIN_NOTES_FOR_KEY = 6
KEY_CONFIDENCE_CAP_LOW = 0.45

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


# ── Event post-processing helpers ─────────────────────────────────────────────


def _adaptive_amplitude_floor(events: list[tuple], base: float) -> float:
    """Return max(base, ADAPTIVE_FACTOR × p75(amplitudes)).

    Using the clip's own amplitude distribution prevents a fixed threshold
    from silencing quiet hummed or played recordings while still suppressing
    noise bursts that exceed the absolute base level.
    """
    if not events:
        return base
    amps = np.array([e[3] for e in events], dtype=float)
    p75 = float(np.percentile(amps, 75))
    return max(base, ADAPTIVE_FACTOR * p75)


def _merge_onsets(
    events: list[tuple],
    gap_sec: float,
) -> list[tuple]:
    """Fuse consecutive same-pitch events separated by less than *gap_sec*.

    Basic Pitch often splits a single sustained note or a clearly-intended
    short repeated note (e.g. a triplet figure) into several fragments.
    Merging them reduces ghost syllables in the solfa output and improves
    overall confidence scores.

    Input / output: list of (start_sec, end_sec, pitch_midi, amplitude).
    The merged event inherits the amplitude of the louder fragment and spans
    from the earliest start to the latest end.  Multiple passes are made
    until no further merges are possible (handles chains of three or more).
    """
    if len(events) < 2:
        return events

    merged = list(events)
    changed = True
    while changed:
        changed = False
        result: list[tuple] = []
        i = 0
        while i < len(merged):
            curr = merged[i]
            if i + 1 < len(merged):
                nxt = merged[i + 1]
                c_start, c_end, c_pitch, c_amp = curr
                n_start, n_end, n_pitch, n_amp = nxt
                gap = n_start - c_end
                if c_pitch == n_pitch and 0.0 <= gap < gap_sec:
                    # Merge: span from c_start to n_end, amplitude = louder half
                    fused = (c_start, n_end, c_pitch, max(c_amp, n_amp))
                    result.append(fused)
                    i += 2
                    changed = True
                    continue
            result.append(curr)
            i += 1
        merged = result

    return merged


def _dedup_simultaneous(events: list[tuple]) -> list[tuple]:
    """Remove exact duplicate pitch+onset pairs that survive onset merging.

    In polyphonic mode, Basic Pitch occasionally emits two identical note
    events (same pitch, same start time) from harmonic energy.  Keep only
    the louder one to avoid double-counting a single physical note.
    """
    seen: dict[tuple, float] = {}  # (pitch, start_rounded) → best_amp
    order: list[tuple] = []

    for evt in events:
        start, end, pitch, amp = evt
        key = (pitch, round(start, 3))
        if key not in seen:
            seen[key] = amp
            order.append(evt)
        elif amp > seen[key]:
            # Replace with the louder duplicate; preserve original list order
            seen[key] = amp
            order = [
                evt if (e[2] == pitch and round(e[0], 3) == round(start, 3)) else e
                for e in order
            ]

    return order


import warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)


def _find_ffmpeg_cmd() -> str:
    import shutil
    found = shutil.which("ffmpeg")
    if found:
        return found
    for cand in (
        "/app/.apt/usr/bin/ffmpeg",
        "/app/.apt/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
    ):
        if Path(cand).is_file():
            return cand
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
                str(tmp_wav_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if res.returncode == 0 and tmp_wav_path.stat().st_size > 0:
            return tmp_wav_path, True
    except Exception:
        pass

    try:
        import soundfile as sf
        import librosa

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        sf.write(str(tmp_wav_path), y, sr, format="WAV", subtype="PCM_16")
        return tmp_wav_path, True
    except Exception:
        pass

    tmp_wav_path.unlink(missing_ok=True)
    return audio_path, False


def transcribe(
    audio_path: Path,
    mode: str = "melody",
    key_override: str | None = None,
    tempo_override: int | None = None,
    progress=lambda fraction: None,
) -> TranscriptionResult:
    import librosa
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

    target_path, is_temp_wav = _ensure_wav_path(audio_path)
    try:
        _, midi_data, note_events = predict(
            str(target_path),
            ICASSP_2022_MODEL_PATH,
            onset_threshold=onset_thresh,
            frame_threshold=frame_thresh,
            minimum_note_length=min_note_ms,
            maximum_frequency=max_freq_hz,
        )
    finally:
        if is_temp_wav:
            target_path.unlink(missing_ok=True)

    progress(0.45)

    # ── 2. Initial duration filter ────────────────────────────────────────────
    # Discard events shorter than MIN_NOTE_SEC before computing the adaptive
    # amplitude floor so that very short noise bursts (which tend to be high-
    # amplitude) do not inflate p75 and raise the floor above real notes.
    raw_events: list[tuple] = sorted(
        [
            (start, end, int(pitch), float(amp))
            for start, end, pitch, amp, _bends in note_events
            if (end - start) >= MIN_NOTE_SEC
        ],
        key=lambda e: e[0],
    )

    # ── 3. Adaptive amplitude floor ───────────────────────────────────────────
    min_amp_base = MIN_AMPLITUDE_MELODY if mode == "melody" else MIN_AMPLITUDE_POLY
    amp_floor = _adaptive_amplitude_floor(raw_events, min_amp_base)
    events = [e for e in raw_events if e[3] >= amp_floor]

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
        cleaned: list[tuple] = []
        for evt in events:
            if not cleaned:
                cleaned.append(evt)
                continue

            prev_start, prev_end, prev_pitch, prev_amp = cleaned[-1]
            curr_start, curr_end, curr_pitch, curr_amp = evt

            if curr_start < prev_end:  # overlap detected
                onset_close = (curr_start - prev_start) < 0.12
                if curr_amp > prev_amp and onset_close:
                    # Current note is louder and nearly co-incident → replace
                    cleaned[-1] = evt
                else:
                    # Truncate previous to the boundary of the new one
                    truncated = (prev_start, curr_start, prev_pitch, prev_amp)
                    if (curr_start - prev_start) >= 0.04:
                        cleaned[-1] = truncated
                        cleaned.append(evt)
                    # else: previous becomes too short → drop it, keep current
                    else:
                        cleaned[-1] = evt
            else:
                cleaned.append(evt)

        # Drop any note that was truncated below the absolute minimum duration
        events = [e for e in cleaned if (e[1] - e[0]) >= 0.04]

    if not events:
        raise LowConfidenceError(
            "No confident notes were detected in the recording. "
            "Try singing or playing closer to the microphone in a quieter space."
        )

    progress(0.55)

    # ── 7. Tempo estimation ───────────────────────────────────────────────────
    # User tap-in override wins (TRD par. 5); otherwise librosa beat tracking.
    # Validation: librosa returns NaN for very short or near-silent clips, and
    # returns values well outside 20–400 BPM on unusual material; fall back to
    # 100 BPM in any of those cases rather than propagating NaN into music21.
    if tempo_override:
        bpm = float(tempo_override)
    else:
        y, sr = librosa.load(str(audio_path), sr=22_050, mono=True)
        raw_est, _ = librosa.beat.beat_track(y=y, sr=sr)
        raw_bpm = float(np.atleast_1d(raw_est)[0])
        if np.isfinite(raw_bpm) and 20.0 <= raw_bpm <= 400.0:
            bpm = raw_bpm
        else:
            # Attempt a rough onset-based estimate as a secondary strategy
            # before falling back to the safe default.
            onsets = np.array([e[0] for e in events])
            if len(onsets) >= 4:
                iois = np.diff(onsets)  # inter-onset intervals
                median_ioi = float(np.median(iois[iois > 0.05]))  # ignore glitches
                beat_hz = 1.0 / median_ioi if median_ioi > 0 else 0.0
                onset_bpm = beat_hz * 60.0
                bpm = onset_bpm if 20.0 <= onset_bpm <= 400.0 else 100.0
            else:
                bpm = 100.0

    sec_to_beats = bpm / 60.0
    progress(0.65)

    # ── 8. music21 stream, quantized to an eighth-note grid ──────────────────
    s = stream.Stream()
    s.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
    s.insert(0, meter.TimeSignature("4/4"))
    for start, end, pitch, amp in events:
        n = m21note.Note(pitch)
        # Clamp to a quarter note minimum so tiny surviving fragments still
        # have a well-formed duration in the score.
        n.duration.quarterLength = max((end - start) * sec_to_beats, 0.25)
        n.editorial.confidence = amp
        s.insert(start * sec_to_beats, n)
    s.quantize((2,), processOffsets=True, processDurations=True, inPlace=True)

    # ── 9. Key detection ──────────────────────────────────────────────────────
    # Manual override always wins (TRD par. 4.1).
    # Without an override, use Krumhansl-Schmuckler from music21.  Two
    # additional quality controls are applied:
    #
    #   a) NaN guard — a degenerate stream (all-rests after quantization) can
    #      cause correlationCoefficient to be NaN; clamp to 0.
    #
    #   b) Short-clip penalty — fewer than MIN_NOTES_FOR_KEY events gives
    #      Krumhansl-Schmuckler too little data to be reliable.  The confidence
    #      is capped at KEY_CONFIDENCE_CAP_LOW (0.45) so the mobile always
    #      shows the editable-key field in this case (PRD mitigation).
    if key_override:
        detected = _parse_key_override(key_override)
        key_confidence = 1.0
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
    ref_doh = solfa.reference_doh([p for _, _, p, _ in events], doh_pc)

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
