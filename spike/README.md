# Phase 0 spike — transcription accuracy validation

Answers the TRD's go/no-go question: **is Basic Pitch + music21 + Verovio good enough on
real phone recordings?** (TRD §10 phase 0, PRD §11 week 1–2.)

## Setup (done once)

```bash
py -3.12 -m venv .venv        # Basic Pitch does NOT support Python 3.13+
.venv\Scripts\pip install --no-deps basic-pitch==0.4.0
.venv\Scripts\pip install onnxruntime librosa "resampy>=0.4.2,<0.4.3" pretty_midi scikit-learn scipy typing-extensions mir_eval music21 verovio soundfile
```

> Why `--no-deps`: basic-pitch 0.4.0 pins `tensorflow<2.15.1`, which has no Windows
> wheels for Python 3.12. Its code auto-detects ONNX Runtime as the inference backend,
> so we install the real runtime deps manually. ONNX is also the backend the Android
> offline mode (v1.x) will use, so accuracy numbers here transfer.

## Run

```bash
.venv\Scripts\python make_test_clip.py     # synthetic clips with known ground truth
.venv\Scripts\python transcribe.py         # everything in recordings/
.venv\Scripts\python transcribe.py path\to\clip.wav
```

Outputs per clip in `output/<name>/`: `transcription.mid`, `score.musicxml`,
`score.svg` (staff, Verovio), `solfa.txt` (movable-do grid), `result.json`.
Clips with a `<name>.truth.json` sidecar get note-level F1 (±50 ms onset, the standard
AMT metric via mir_eval).

## The real validation set (the one that matters commercially)

Record ~20 clips **on real phones in real target environments** and drop them in
`recordings/` (TRD §7):

- solo keyboard in a live room (close mic + across the room)
- sung/hummed melody (male + female voice)
- choir rehearsal snippet
- keyboard + congregation background noise
- quiet room reference takes

Grade each output 1–5 on: (a) pitch accuracy, (b) rhythm readability,
(c) key/doh correctness, (d) is the solfa usable by a choir director as-is?

## Go/no-go targets (PRD §5.4)

- ≥ 90% note-level F1 on clean monophonic
- ≥ 75% on clean piano polyphony
- Key detection right (or one-tap-fixable relative major/minor) on most clips
