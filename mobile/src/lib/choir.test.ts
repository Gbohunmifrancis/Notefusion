import { test } from "node:test";
import assert from "node:assert/strict";
import { pitchName, shiftKeyName, spokenPitch } from "./choir.ts";

test("a pitch is named as a note, and said with 'sharp' rather than '#'", () => {
  assert.equal(pitchName(60), "C4");
  assert.equal(pitchName(61), "C#4");
  assert.equal(spokenPitch(60), "C 4");
  assert.equal(spokenPitch(61), "C sharp 4");
  assert.equal(spokenPitch(69), "A 4");
  assert.equal(spokenPitch(11), "B -1");
});

test("Transpose names the new key as its signature spells it, as MusicalKey.cs and the web do", () => {
  assert.equal(shiftKeyName("C major", 3), "Eb major");
  assert.equal(shiftKeyName("C major", -2), "Bb major");
  assert.equal(shiftKeyName("G major", 1), "Ab major");
  assert.equal(shiftKeyName("C major", 1), "Db major");
  assert.equal(shiftKeyName("G major", -1), "F# major");
  assert.equal(shiftKeyName("A minor", -1), "G# minor");
  assert.equal(shiftKeyName("A minor", 1), "Bb minor");
  assert.equal(shiftKeyName("C minor", 3), "Eb minor");
  assert.equal(shiftKeyName("Bb major", 2), "C major");
  assert.equal(shiftKeyName("not a key", 2), "not a key");
});
