import { test } from "node:test";
import assert from "node:assert/strict";
import { DATA_SAVER_PROFILE, STANDARD_PROFILE, estimatedBytes, recordingProfile } from "./recordingPreset.ts";
import { jobPollMs, loadsImages, outboxTickMs } from "./dataPolicy.ts";
import { transposeChord, transposeKeyName, transposeLocally } from "./localTranspose.ts";

test("data saver records the same AAC the worker reads (22.05 kHz mono) at a quarter of the bit rate", () => {
  const saver = recordingProfile(true);
  const standard = recordingProfile(false);
  assert.equal(saver, DATA_SAVER_PROFILE);
  assert.equal(standard, STANDARD_PROFILE);
  // The worker resamples every upload to 22,050 Hz mono; nothing above that is ever used.
  for (const p of [saver, standard]) {
    assert.equal(p.sampleRate, 22050);
    assert.equal(p.numberOfChannels, 1);
  }
  assert.equal(saver.bitRate, 32_000);
  assert.equal(standard.bitRate, 128_000);
  // 30 s: about 120 KB against about 480 KB.
  assert.ok(estimatedBytes(30, saver) < 130_000);
  assert.ok(estimatedBytes(30, standard) > 450_000);
});

test("data saver polls half as often, checks the queue each minute and skips pictures", () => {
  assert.equal(jobPollMs(false), 2_500);
  assert.equal(jobPollMs(true), 5_000);
  assert.equal(outboxTickMs(false), 30_000);
  assert.equal(outboxTickMs(true), 60_000);
  assert.equal(loadsImages(true), false);
  assert.equal(loadsImages(false), true);
});

test("offline transpose: keys spelled as their signatures, chords respelled, every note moved", () => {
  assert.equal(transposeKeyName("Eb major", 2), "F major");
  assert.equal(transposeKeyName("Eb major", 7), "Bb major");
  assert.equal(transposeKeyName("G major", -1), "Gb major");
  assert.equal(transposeKeyName("D minor", 2), "E minor");
  assert.equal(transposeKeyName("A minor", -2), "G minor");
  assert.equal(transposeKeyName("not a key", 3), "not a key");
  const chord = { startBeat: 0, durBeats: 4, root: 2, quality: "min7" as const, bass: 0, symbol: "Dm7/C", solfa: "r" };
  assert.deepEqual(transposeChord(chord, 1, "Eb major"), { ...chord, root: 3, bass: 1, symbol: "Ebm7/Db" });
  const note = (p: number) => ({ pitchMidi: p, startBeat: 0, durBeats: 1, degree: 1, solfa: "d", octaveMark: "", conf: 1 });
  const moved = transposeLocally({ key: "C major", notes: [note(60)], parts: { alto: { notes: [note(55)], solfaLines: [] } }, chords: null }, 3);
  assert.equal(moved.key, "Eb major");
  assert.equal(moved.notes[0]!.pitchMidi, 63);
  assert.equal(moved.parts!.alto!.notes[0]!.pitchMidi, 58);
  assert.equal(moved.chords, null);
});
