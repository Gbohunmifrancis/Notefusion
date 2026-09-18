"""Direct symbolic score transcriber (MusicXML, MIDI, ABC -> Solfa + Staff).

Converts symbolic sheet music and MIDI directly into Tonic Solfa and staff notation
with zero transcription error, bypassing acoustic ML inference completely.
"""

import base64
import tempfile
from pathlib import Path

import numpy as np
from music21 import converter, key as m21key, meter, note as m21note, stream, tempo as m21tempo
from music21.musicxml.m21ToXml import GeneralObjectExporter

from app.config import settings
from app.pipeline import solfa, solfa_render
from app.pipeline.transcriber import (
    LowConfidenceError,
    TranscribedNote,
    TranscriptionResult,
    _detect_key,
    _normalise_key_name,
    _parse_key_override,
    _respell_to_key,
    _synthesize_audio_preview,
)

ACCEPTED_SCORE_SUFFIXES = {".musicxml", ".xml", ".mxl", ".mid", ".midi", ".abc"}


def _extract_part_notes_and_solfa(
    part_stream: stream.Stream,
    bpm: float,
    ts_str: str,
    detected: m21key.Key,
    doh_pc: int,
) -> tuple[list[TranscribedNote], list[str], stream.Stream]:
    flat = part_stream.flatten()
    score_notes = [n for n in flat.notes if isinstance(n, m21note.Note)]
    if not score_notes:
        return [], [], stream.Stream()

    measures_stream = stream.Stream()
    measures_stream.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
    measures_stream.insert(0, meter.TimeSignature(ts_str))
    measures_stream.insert(0, m21key.Key(detected.tonic.name, detected.mode))

    for n in score_notes:
        new_note = m21note.Note(n.pitch)
        new_note.duration = n.duration
        measures_stream.insert(n.offset, new_note)

    _respell_to_key(measures_stream, detected)
    score_measures = measures_stream.makeMeasures()
    score_measures.makeAccidentals(inPlace=True, alteredPitches=detected.alteredPitches)

    ref_doh = solfa.reference_doh([n.pitch.midi for n in score_notes], doh_pc)
    spelling_flags = solfa.ascending_flags([n.pitch.midi for n in score_notes])
    spelling = [
        solfa.resolve_ascending(f, settings.chromatic_spelling)
        for f in spelling_flags
    ]

    notes: list[TranscribedNote] = []
    position = 0
    for m in score_measures.getElementsByClass(stream.Measure):
        for n in m.notes:
            if not isinstance(n, m21note.Note):
                continue
            flag = spelling[position] if position < len(spelling) else "ascending"
            syl, mark, degree = solfa.syllable(n.pitch.midi, doh_pc, ref_doh, flag)
            position += 1
            notes.append(
                TranscribedNote(
                    pitch_midi=n.pitch.midi,
                    start_beat=float(m.offset + n.offset),
                    dur_beats=float(n.duration.quarterLength),
                    degree=degree,
                    solfa=syl,
                    octave_mark=mark,
                    conf=1.0,
                )
            )

    solfa_lines = solfa_render.render_lines(
        notes,
        solfa.doh_header(doh_pc),
        time_signature=ts_str,
        divisions_per_beat=settings.quantize_divisors[0],
    )
    return notes, solfa_lines, score_measures


def transcribe_score(
    score_path: Path,
    key_override: str | None = None,
    tempo_override: int | None = None,
    time_signature_override: str | None = None,
    part_index: int | None = None,
) -> TranscriptionResult:
    """Parse a symbolic score file and produce tonic sol-fa + staff notation."""
    try:
        if score_path.suffix.lower() in (".xml", ".musicxml"):
            try:
                import defusedxml.ElementTree as defused_et
                defused_et.parse(str(score_path))
            except ImportError:
                pass
            except Exception as xml_exc:
                raise LowConfidenceError(f"Invalid or unsafe XML in score file: {xml_exc}") from xml_exc

        score = converter.parse(str(score_path))
    except LowConfidenceError:
        raise
    except Exception as exc:
        raise LowConfidenceError(f"Could not parse score file: {exc}") from exc

    # Select the primary melodic part (soprano / melody line or requested part index)
    if score.hasPartLikeStreams():
        p_idx = part_index if part_index is not None and 0 <= part_index < len(score.parts) else 0
        melody_part = score.parts[p_idx]
    else:
        melody_part = score

    flat = melody_part.flatten()

    # ── 1. Tempo ─────────────────────────────────────────────────────────────
    bpm = float(tempo_override) if tempo_override else 0.0
    if bpm <= 0.0:
        metronomes = flat.getElementsByClass(m21tempo.MetronomeMark)
        if metronomes:
            first_mm = metronomes[0].getQuarterBPM()
            if first_mm and 20 <= first_mm <= 400:
                bpm = float(first_mm)
    if bpm <= 0.0:
        bpm = 100.0  # sensible default

    # ── 2. Time Signature ────────────────────────────────────────────────────
    ts_str = time_signature_override
    if not ts_str:
        ts_elements = flat.getElementsByClass(meter.TimeSignature)
        if ts_elements:
            ts_str = ts_elements[0].ratioString
        else:
            ts_str = "4/4"

    # ── 3. Notes extraction ──────────────────────────────────────────────────
    score_notes = [n for n in flat.notes if isinstance(n, m21note.Note)]
    if not score_notes:
        raise LowConfidenceError("No pitched notes found in the score file.")

    # ── 4. Key detection / override ──────────────────────────────────────────
    if key_override:
        detected = _parse_key_override(key_override)
        key_confidence = 1.0
    else:
        key_elements = flat.getElementsByClass(m21key.KeySignature)
        if key_elements:
            detected = key_elements[0].asKey()
            key_confidence = 1.0
        elif settings.key_ensemble:
            temp_stream = stream.Stream()
            for n in score_notes:
                temp_stream.insert(n.offset, m21note.Note(n.pitch.midi))
            detected, key_confidence = _detect_key(temp_stream, len(score_notes))
        else:
            detected = flat.analyze("key")
            key_confidence = 0.9

    normalised_key = _normalise_key_name(detected.name)
    doh_pc = solfa.doh_pitch_class(detected.tonic.pitchClass, detected.mode)

    # ── 5. Measures & Solfa Mapping ──────────────────────────────────────────
    notes, solfa_lines, score_measures = _extract_part_notes_and_solfa(
        melody_part, bpm, ts_str, detected, doh_pc
    )

    if not notes:
        raise LowConfidenceError("No notes could be extracted from score.")

    # ── 6. Exports & Preview ─────────────────────────────────────────────────
    musicxml = GeneralObjectExporter(score_measures).parse().decode("utf-8")

    with tempfile.NamedTemporaryFile(suffix=".mid", delete=False) as tmp:
        midi_path = Path(tmp.name)
    try:
        score_measures.write("midi", fp=str(midi_path))
        midi_base64 = base64.b64encode(midi_path.read_bytes()).decode("ascii")
    finally:
        midi_path.unlink(missing_ok=True)

    audio_preview_b64 = _synthesize_audio_preview(notes, round(bpm))

    return TranscriptionResult(
        key=normalised_key,
        key_confidence=round(key_confidence, 3),
        tempo=round(bpm),
        time_signature=ts_str,
        musicxml=musicxml,
        midi_base64=midi_base64,
        notes=notes,
        solfa_lines=solfa_lines,
        overall_confidence=1.0,
        audio_preview_base64=audio_preview_b64,
        pitch_refined=True,
        chromatic_spelling=settings.chromatic_spelling,
    )
