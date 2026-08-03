"""NoteFusion Phase 0 spike: audio -> Basic Pitch -> music21 -> staff + solfa (TRD par. 10).

Usage:
    python transcribe.py                      # process everything in recordings/
    python transcribe.py path/to/clip.wav     # process one file

Per clip, writes to output/<name>/:
    transcription.mid   raw Basic Pitch MIDI
    score.musicxml      quantized, key-spelled score (music21)
    score.svg           engraved staff notation (Verovio)
    solfa.txt           movable-do solfa grid with barlines
    result.json         key, tempo, note events, solfa syllables, F1 vs truth if available

A clip named <name>.wav is scored against <name>.truth.json when present
(note-level F1, pitch match + onset within +/-50 ms, the standard AMT metric).
"""

import json
import sys
from pathlib import Path

import numpy as np

SPIKE_DIR = Path(__file__).parent
RECORDINGS = SPIKE_DIR / "recordings"
OUTPUT = SPIKE_DIR / "output"

# Post-processing thresholds (TRD par. 5: confidence filter, ghost-note suppression)
MIN_AMPLITUDE = 0.15
MIN_NOTE_SEC = 0.05

ASCENDING_SYLLABLES = ["d", "de", "r", "re", "m", "f", "fe", "s", "se", "l", "le", "t"]


# ---------------------------------------------------------------- solfa engine
def doh_pitch_class(key) -> int:
    """Movable doh; la-based minor (doh = relative major tonic), mirrors Core/Solfa."""
    tonic_pc = key.tonic.pitchClass
    return tonic_pc if key.mode == "major" else (tonic_pc + 3) % 12


def solfa_syllable(pitch_midi: int, doh_pc: int, reference_doh_midi: int) -> str:
    semitones = (pitch_midi - doh_pc) % 12
    text = ASCENDING_SYLLABLES[semitones]
    octave_shift = int(np.floor((pitch_midi - reference_doh_midi) / 12.0))
    if octave_shift > 0:
        return text + "'" * octave_shift
    if octave_shift < 0:
        return text + "," * -octave_shift  # comma for the octave below (ASCII-safe here)
    return text


def reference_doh(pitches: list[int], doh_pc: int) -> int:
    """The doh octave nearest the melody's median - the unmarked register."""
    median = float(np.median(pitches))
    candidates = [p for p in range(0, 128) if p % 12 == doh_pc]
    return min(candidates, key=lambda p: abs(p - median))


# ---------------------------------------------------------------- pipeline
def transcribe_clip(audio_path: Path) -> dict:
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    import librosa
    from music21 import key as m21key, meter, note as m21note, stream, tempo as m21tempo

    out_dir = OUTPUT / audio_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. AMT model: audio -> note events (pitch, onset, offset, amplitude)
    _, midi_data, note_events = predict(str(audio_path), ICASSP_2022_MODEL_PATH)
    midi_data.write(str(out_dir / "transcription.mid"))

    # 2. Confidence filter + ghost-note suppression (TRD par. 5)
    events = [
        (start, end, int(pitch), float(amp))
        for start, end, pitch, amp, _bends in note_events
        if amp >= MIN_AMPLITUDE and (end - start) >= MIN_NOTE_SEC
    ]
    events.sort(key=lambda e: e[0])
    if not events:
        return {"clip": audio_path.name, "error": "no confident notes detected"}

    # 3. Tempo estimate (librosa beat tracking), beats-from-seconds conversion
    y, sr = librosa.load(str(audio_path), sr=22_050, mono=True)
    tempo_est, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(np.atleast_1d(tempo_est)[0]) or 100.0
    sec_to_beats = bpm / 60.0

    # 4. Build a music21 stream and quantize to an eighth-note grid
    s = stream.Stream()
    s.insert(0, m21tempo.MetronomeMark(number=round(bpm)))
    s.insert(0, meter.TimeSignature("4/4"))
    for start, end, pitch, amp in events:
        n = m21note.Note(pitch)
        n.duration.quarterLength = max((end - start) * sec_to_beats, 0.25)
        n.volume.velocity = int(amp * 127)
        s.insert(start * sec_to_beats, n)
    s.quantize((2,), processOffsets=True, processDurations=True, inPlace=True)

    # 5. Key detection (Krumhansl-Schmuckler via music21) + correct accidental spelling
    detected: m21key.Key = s.analyze("key")
    s.insert(0, m21key.Key(detected.tonic.name, detected.mode))
    score = s.makeMeasures()
    score.makeAccidentals(inPlace=True, overrideStatus=True)

    # 6. Movable-do solfa from the same note list (re-labelling, never re-transcription)
    doh_pc = doh_pitch_class(detected)
    ref_doh = reference_doh([p for _, _, p, _ in events], doh_pc)
    pitch_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    doh_header = f"Doh is {pitch_names[doh_pc]}"

    solfa_bars, syllables = [], []
    for measure in score.getElementsByClass(stream.Measure):
        bar = []
        for n in measure.notes:
            syl = solfa_syllable(n.pitch.midi, doh_pc, ref_doh)
            bar.append(syl)
            syllables.append(syl)
        solfa_bars.append(" ".join(bar) if bar else "-")
    solfa_text = doh_header + "  (" + detected.name + ")\n\n| " + " | ".join(solfa_bars) + " |\n"
    (out_dir / "solfa.txt").write_text(solfa_text, encoding="utf-8")

    # 7. MusicXML + engraved SVG (Verovio - same renderer the app's WebView will use)
    xml_path = out_dir / "score.musicxml"
    score.write("musicxml", fp=str(xml_path))
    try:
        import verovio
        tk = verovio.toolkit()
        tk.loadFile(str(xml_path))
        (out_dir / "score.svg").write_text(tk.renderToSVG(1), encoding="utf-8")
        svg_ok = True
    except Exception as ex:  # engraving failure shouldn't kill the accuracy report
        svg_ok = False
        (out_dir / "verovio_error.txt").write_text(repr(ex), encoding="utf-8")

    # 8. Score against ground truth when available (note-level F1, +/-50 ms onset)
    f1 = None
    truth_path = audio_path.with_suffix("").with_suffix(".truth.json") \
        if audio_path.suffix else None
    truth_file = audio_path.parent / f"{audio_path.stem}.truth.json"
    if truth_file.exists():
        import mir_eval
        truth = json.loads(truth_file.read_text())
        ref_intervals = np.array([[t["onset_sec"], t["onset_sec"] + t["dur_sec"]] for t in truth])
        ref_pitches = np.array([librosa.midi_to_hz(t["pitch_midi"]) for t in truth])
        est_intervals = np.array([[e[0], e[1]] for e in events])
        est_pitches = np.array([librosa.midi_to_hz(e[2]) for e in events])
        precision, recall, f_measure, _ = mir_eval.transcription.precision_recall_f1_overlap(
            ref_intervals, ref_pitches, est_intervals, est_pitches,
            onset_tolerance=0.05, offset_ratio=None)
        f1 = {"precision": round(precision, 3), "recall": round(recall, 3),
              "f1": round(f_measure, 3)}

    result = {
        "clip": audio_path.name,
        "notes_detected": len(events),
        "key": detected.name,
        "key_certainty": round(float(detected.correlationCoefficient), 3),
        "doh": doh_header,
        "tempo_bpm": round(bpm, 1),
        "solfa": syllables,
        "svg_rendered": svg_ok,
        "f1_vs_truth": f1,
        "notes": [
            {"pitch_midi": p, "onset_sec": round(st, 3), "dur_sec": round(en - st, 3),
             "confidence": round(a, 3)}
            for st, en, p, a in events
        ],
    }
    (out_dir / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main() -> None:
    targets = ([Path(a) for a in sys.argv[1:]]
               or sorted(RECORDINGS.glob("*.wav")) + sorted(RECORDINGS.glob("*.mp3")))
    if not targets:
        print("No recordings found. Drop clips into spike/recordings/ or pass paths.")
        return

    rows = []
    for path in targets:
        print(f"-> {path.name}")
        r = transcribe_clip(path)
        rows.append(r)
        if "error" in r:
            print(f"   {r['error']}")
            continue
        f1 = r["f1_vs_truth"]
        f1_text = f"F1={f1['f1']:.2f} (P={f1['precision']:.2f} R={f1['recall']:.2f})" if f1 else "no truth file"
        print(f"   {r['notes_detected']} notes | {r['key']} ({r['key_certainty']:.2f}) | "
              f"{r['doh']} | {r['tempo_bpm']:.0f} bpm | {f1_text}")
        print(f"   solfa: {' '.join(r['solfa'][:16])}{' ...' if len(r['solfa']) > 16 else ''}")

    (OUTPUT / "summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"\nOutputs in {OUTPUT}")


if __name__ == "__main__":
    main()
