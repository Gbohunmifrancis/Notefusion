# `real/` — label format for real recordings

Labelled recordings are loaded by `tests.accuracy.real_loader` and scored by the same
metrics as the synthetic corpus. They are kept in a separate report so real-world
measurements never overwrite the synthetic regression baseline.

Run the real evaluation from `server/` with:

```text
python -m tests.accuracy.report --real
python -m tests.accuracy.report --real --filter humming
```

The command writes `tests/accuracy/real_report.json`. It fails on malformed sidecars,
and reports an empty fixture directory as an error so a typo cannot look like a clean
zero-case evaluation.

## Why real recordings are not optional

The synthetic corpus exists to isolate specific, reproducible failure modes — leading
silence, vibrato, pitch drift, additive noise, plucked vs sustained envelopes — so a fix
in phases 2-4 can be attributed to one cause. It is a **regression instrument, not an
accuracy claim**. It does not model microphone response, room reverb, breath and lip
noise, portamento between notes, mains hum, phone AGC, or a singer who is simply flat.
Absolute numbers ("the pipeline gets N% of notes right") must only ever be quoted from
real recordings.

## Layout

One WAV plus one sidecar per clip, sharing a stem:

```
tests/accuracy/real/
  humming_c_major_01.wav
  humming_c_major_01.truth.json
```

Audio: mono WAV, any sample rate (Basic Pitch resamples internally). Keep clips 3-15 s.

## Sidecar format

`spike/make_test_clip.py` already writes a bare JSON list of
`{pitch_midi, onset_sec, dur_sec}`. The harness additionally needs the key and tempo, so
the list moves under a `notes` key:

```json
{
  "key": "C major",
  "tempo_bpm": 100,
  "notes": [
    { "pitch_midi": 60, "onset_sec": 0.42, "dur_sec": 0.55 },
    { "pitch_midi": 62, "onset_sec": 1.01, "dur_sec": 0.58 },
    { "pitch_midi": 64, "onset_sec": 1.6, "dur_sec": 1.15 }
  ]
}
```

| Field       | Type            | Meaning                                                                                                        |
| ----------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `key`       | string          | Ground-truth key in the pipeline's normalised form: `C major`, `Bb major`, `A minor`, `F# minor`. Sharps `#`, flats `b` (never music21's `B-`), mode lowercase. |
| `tempo_bpm` | int             | The tempo the line was performed against. Required: estimated note positions are in **beats**, so scoring cannot convert domains without it. |
| `notes`     | list            | Sounding notes only, ordered by `onset_sec`. Rests are implied by the gaps.                                      |
| `pitch_midi`| int             | MIDI number, 60 = C4.                                                                                          |
| `onset_sec` | float           | Seconds from the **start of the file**, so it *includes* any leading silence.                                    |
| `dur_sec`   | float           | Sounding duration in seconds.                                                                                  |

A bare-list sidecar written by the spike script is the legacy shape and carries no key or
tempo; wrap it in the object above before using it here.

## Beat conversion the loader must perform

`metrics.py` scores against `synth.RefNote`, which carries both domains, and the loader
must fill them the same way:

```
onset_beat = (onset_sec - onset_sec_of_first_note) * tempo_bpm / 60
dur_beats  = dur_sec * tempo_bpm / 60
```

`onset_sec` keeps the leading silence, `onset_beat` starts at `0.0` for the first sounding
note. That asymmetry is deliberate and matches `synth.RefNote`: anchoring the first note to
beat 0 is the *correct* pipeline behaviour, and a recording with a long lead-in is one of
the failure modes being measured.

Given that triple — `list[RefNote]`, `key`, `tempo_bpm` — the existing metric functions
need no change, which is the whole reason the format is pinned before the loader exists.

## Recording constraints

Stay inside these or a "miss" is a hard pipeline ceiling rather than a model error:

- **Monophonic single line.** The harness calls `transcribe(..., mode="melody")`, whose
  overlap resolver truncates or drops any overlapping note.
- **Pitch at or below MIDI 84 (C6).** Inference caps at 1050 Hz; nothing higher can ever
  be reported.
- **Notes at least ~120 ms.** Melody mode's `minimum_note_length` is 100 ms and anything
  under `MIN_NOTE_SEC` (60 ms) is discarded post-hoc.
- **Do not expect sub-150 ms onset resolution.** Output is quantized to an eighth-note
  grid, which is 300 ms at the 100 BPM fallback tempo.
- **Under 180 s and 20 MiB**, the API's clip limits.

Label onsets from the audio (Audacity, Sonic Visualiser), not from the score a performer
was reading — a real performance drifts, and a score-derived label measures the singer
rather than the pipeline. Millisecond rounding is plenty.

## Privacy

These are recordings of real people. The pipeline deletes uploaded audio after every job
for that reason; do not commit a clip to the repo without the performer's consent.
