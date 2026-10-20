import { test } from "node:test";
import assert from "node:assert/strict";
import { midiBase64, midiBytes, vlq, type MidiSheet } from "./midi.ts";

const sheet = (over: Partial<MidiSheet> = {}): MidiSheet => ({
  tempoBpm: 120,
  timeSignature: "3/4",
  fifths: 2,
  minor: false,
  tracks: [{ name: "Tune", notes: [{ pitchMidi: 60, startBeat: 0, durBeats: 1 }] }],
  ...over,
});

const hex = (bytes: Uint8Array | number[]) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

test("lengths are written as MIDI's variable-length numbers", () => {
  assert.deepEqual(vlq(0), [0]);
  assert.deepEqual(vlq(127), [0x7f]);
  assert.deepEqual(vlq(128), [0x81, 0x00]);
  assert.deepEqual(vlq(480), [0x83, 0x60]);
});

test("the file is format 1: a conductor track, then a track per voice, 480 ticks a beat", () => {
  const b = midiBytes(sheet());
  assert.equal(hex(b.slice(0, 14)), "4d 54 68 64 00 00 00 06 00 01 00 02 01 e0");
});

test("the conductor track carries the tempo, meter and key on screen", () => {
  const b = hex(midiBytes(sheet()));
  assert.ok(b.includes("ff 51 03 07 a1 20"), "120 BPM is 500000 µs a beat");
  assert.ok(b.includes("ff 58 04 03 02 18 08"), "3/4");
  assert.ok(b.includes("ff 59 02 02 00"), "D major: two sharps");
  const minor = hex(midiBytes(sheet({ fifths: -3, minor: true, timeSignature: "6/8", tempoBpm: 60 })));
  assert.ok(minor.includes("ff 59 02 fd 01"), "C minor: three flats, minor");
  assert.ok(minor.includes("ff 58 04 06 03 18 08"), "6/8");
  assert.ok(minor.includes("ff 51 03 0f 42 40"), "60 BPM");
});

test("a meter MIDI cannot write is 4/4", () => {
  assert.ok(hex(midiBytes(sheet({ timeSignature: "5/3" }))).includes("ff 58 04 04 02 18 08"));
});

test("each note is an on and an off at its beats, the off first when a pitch is re-struck", () => {
  const b = hex(
    midiBytes(
      sheet({
        tracks: [
          {
            name: "Tune",
            notes: [
              { pitchMidi: 62, startBeat: 0, durBeats: 1 },
              { pitchMidi: 62, startBeat: 1, durBeats: 0.5 },
            ],
          },
        ],
      }),
    ),
  );
  // name, piano on channel 0, D on, D off a beat later, D on at once, off half a beat on, end.
  assert.ok(
    b.endsWith("ff 03 04 54 75 6e 65 00 c0 00 00 90 3e 50 83 60 80 3e 40 00 90 3e 50 81 70 80 3e 40 00 ff 2f 00"),
    b,
  );
});

test("voices go on their own channels, and pitches stay in MIDI's range", () => {
  const b = hex(
    midiBytes(
      sheet({
        tracks: [
          { name: "Soprano", notes: [{ pitchMidi: 72, startBeat: 0, durBeats: 1 }] },
          { name: "Bass", notes: [{ pitchMidi: -3, startBeat: 0, durBeats: 1 }] },
        ],
      }),
    ),
  );
  assert.ok(b.includes("c1 00 00 91 00 50"), "the bass on channel 1, its pitch clamped to 0");
  assert.equal(hex(midiBytes(sheet()).slice(10, 12)), "00 02");
});

test("base64 is the same bytes", () => {
  const s = sheet();
  assert.deepEqual(Uint8Array.from(Buffer.from(midiBase64(s), "base64")), midiBytes(s));
  const odd = sheet({ tracks: [{ name: "T", notes: [] }] });
  assert.deepEqual(Uint8Array.from(Buffer.from(midiBase64(odd), "base64")), midiBytes(odd));
});
