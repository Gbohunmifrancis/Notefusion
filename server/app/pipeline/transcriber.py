"""The transcription pipeline: audio file -> structured result (TRD par. 2.3, par. 5).

Ported from the validated Phase 0 spike (spike/transcribe.py). Pure function of the
input file + options; no state, no persistence - the caller deletes the audio.
"""

import base64
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.pipeline import solfa

# Post-processing thresholds (TRD par. 5: confidence filter, ghost-note suppression)
MIN_AMPLITUDE_MELODY = 0.20
MIN_AMPLITUDE_POLY = 0.15
MIN_NOTE_SEC = 0.06


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


def _parse_key_override(text: str | None):
    """Parse a user/ML key string into a music21 Key.

    Accepts a note letter A-G, optional stackable accidentals (# / ♯ / b / ♭, which
    cancel), and an optional mode word (major/maj, or minor/min/m). Mirrors the C#
    ``KeyParser`` so the override path never diverges from the client's own labels
    (a wrong parse silently mislabels the whole piece — TRD par. 4.1).
    """
    from music21 import key as m21key

    if not text or not text.strip():
        raise ValueError("Empty key override.")
    raw = text.strip()

    # Mode suffix: longest first so 'min'/'maj' aren't misread as a bare 'm'.
    lowered = raw.lower()
    mode, body = "major", raw
    for suffix, resolved in (("minor", "minor"), ("major", "major"),
                             ("min", "minor"), ("maj", "major"), ("m", "minor")):
        if lowered.endswith(suffix) and len(raw) > len(suffix):
            mode, body = resolved, raw[: len(raw) - len(suffix)]
            break
    body = body.strip()

    letter = body[:1].upper()
    if letter not in "ABCDEFG":
        raise ValueError(f"Unparseable key override: {text!r}")

    accidental = 0
    for ch in body[1:]:
        if ch in "#♯":      # '#' or '♯'
            accidental += 1
        elif ch in "b♭":    # 'b' or '♭'
            accidental -= 1
        else:
            raise ValueError(f"Unparseable key override: {text!r}")

    tonic = letter + ("#" * accidental if accidental >= 0 else "-" * -accidental)
    return m21key.Key(tonic, mode)


def transcribe(audio_path: Path, mode: str = "melody",
               key_override: str | None = None,
               tempo_override: int | None = None,
               progress=lambda fraction: None) -> TranscriptionResult:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    import librosa
    from music21 import key as m21key, meter, note as m21note, stream, tempo as m21tempo
    from music21.musicxml.m21ToXml import GeneralObjectExporter

    progress(0.1)

    # 1. AMT model: tuned parameters for singing / instrumental accuracy
    onset_thresh = 0.35 if mode == "melody" else 0.45
    frame_thresh = 0.25 if mode == "melody" else 0.30
    min_note_len = 80 if mode == "melody" else 60

    _, midi_data, note_events = predict(
        str(audio_path),
        ICASSP_2022_MODEL_PATH,
        onset_threshold=onset_thresh,
        frame_threshold=frame_thresh,
        minimum_note_length=min_note_len,
        maximum_frequency=1200.0,  # Cap at ~D6 to filter high-frequency noise
    )
    progress(0.5)

    # 2. Confidence filter + ghost-note suppression
    min_amp = MIN_AMPLITUDE_MELODY if mode == "melody" else MIN_AMPLITUDE_POLY
    events = sorted(
        [
            (start, end, int(pitch), float(amp))
            for start, end, pitch, amp, _bends in note_events
            if amp >= min_amp and (end - start) >= MIN_NOTE_SEC
        ],
        key=lambda e: e[0],
    )

    # In melody mode, clean up overlapping note artifacts to ensure a clean single voice line
    if mode == "melody" and events:
        cleaned_events = []
        for evt in events:
            if not cleaned_events:
                cleaned_events.append(evt)
            else:
                prev_start, prev_end, prev_pitch, prev_amp = cleaned_events[-1]
                curr_start, curr_end, curr_pitch, curr_amp = evt
                if curr_start < prev_end:
                    if curr_amp > prev_amp and (curr_start - prev_start) < 0.12:
                        cleaned_events[-1] = evt
                    elif curr_start < prev_end:
                        cleaned_events[-1] = (prev_start, curr_start, prev_pitch, prev_amp)
                        cleaned_events.append(evt)
                else:
                    cleaned_events.append(evt)
        events = [e for e in cleaned_events if (e[1] - e[0]) >= 0.04]

    if not events:
        raise LowConfidenceError("No confident notes detected in the recording. Try singing or playing closer to the microphone.")

    # 3. Tempo: user tap-in override wins (TRD par. 5), else librosa beat tracking
    if tempo_override:
        bpm = float(tempo_override)
    else:
        y, sr = librosa.load(str(audio_path), sr=22_050, mono=True)
        tempo_est, _ = librosa.beat.beat_track(y=y, sr=sr)
        bpm = float(np.atleast_1d(tempo_est)[0]) or 100.0
    sec_to_beats = bpm / 60.0
    progress(0.65)

    # 4. music21 stream, quantized to an eighth-note grid
    s = stream.Stream()
    s.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
    s.insert(0, meter.TimeSignature("4/4"))
    for start, end, pitch, amp in events:
        n = m21note.Note(pitch)
        n.duration.quarterLength = max((end - start) * sec_to_beats, 0.25)
        n.editorial.confidence = amp
        s.insert(start * sec_to_beats, n)
    s.quantize((2,), processOffsets=True, processDurations=True, inPlace=True)

    # 5. Key: manual override always wins (TRD par. 4.1), else Krumhansl-Schmuckler
    if key_override:
        detected = _parse_key_override(key_override)
        key_confidence = 1.0
    else:
        detected = s.analyze("key")
        cc = float(detected.correlationCoefficient)
        # A degenerate stream can yield NaN; clamp to a defensible [0, 1].
        key_confidence = 0.0 if np.isnan(cc) else max(0.0, min(1.0, cc))
    s.insert(0, m21key.Key(detected.tonic.name, detected.mode))
    score = s.makeMeasures()
    score.makeAccidentals(inPlace=True, overrideStatus=True)
    progress(0.8)

    # 6. Solfa: derived from the same note list (re-labelling, never re-transcription)
    doh_pc = solfa.doh_pitch_class(detected.tonic.pitchClass, detected.mode)
    ref_doh = solfa.reference_doh([p for _, _, p, _ in events], doh_pc)

    notes: list[TranscribedNote] = []
    solfa_lines: list[str] = [solfa.doh_header(doh_pc)]
    bars: list[str] = []
    for measure in score.getElementsByClass(stream.Measure):
        bar_syllables = []
        for n in measure.notes:
            syl, mark, degree = solfa.syllable(n.pitch.midi, doh_pc, ref_doh)
            bar_syllables.append(syl + mark)
            notes.append(TranscribedNote(
                pitch_midi=n.pitch.midi,
                start_beat=float(measure.offset + n.offset),
                dur_beats=float(n.duration.quarterLength),
                degree=degree,
                solfa=syl,
                octave_mark=mark,
                conf=round(float(getattr(n.editorial, "confidence", 1.0)), 3),
            ))
        bars.append(" ".join(bar_syllables) if bar_syllables else "-")
    # 4 bars per solfa line - readable on a phone screen
    for i in range(0, len(bars), 4):
        solfa_lines.append("| " + " | ".join(bars[i:i + 4]) + " |")

    if not notes:
        # Everything survived the amplitude filter but nothing survived quantization
        raise LowConfidenceError("No notes survived quantization; recording too noisy.")

    # 7. MusicXML + MIDI (base64) for the client's Verovio view, playback, and export
    musicxml = GeneralObjectExporter(score).parse().decode("utf-8")
    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as tmp:
        midi_path = Path(tmp.name)
    try:
        midi_data.write(str(midi_path))
        midi_base64 = base64.b64encode(midi_path.read_bytes()).decode("ascii")
    finally:
        midi_path.unlink(missing_ok=True)
    progress(0.95)

    return TranscriptionResult(
        key=detected.name,
        key_confidence=round(key_confidence, 3),
        tempo=round(bpm),
        time_signature="4/4",
        musicxml=musicxml,
        midi_base64=midi_base64,
        notes=notes,
        solfa_lines=solfa_lines,
        overall_confidence=round(float(np.mean([n.conf for n in notes])), 3),
    )


class LowConfidenceError(Exception):
    """Raised when the clip yields nothing usable - surfaced honestly to the user
    instead of returning garbage (PRD reliability NFR)."""
