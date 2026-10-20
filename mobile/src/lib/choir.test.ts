import { test } from "node:test";
import assert from "node:assert/strict";
import { pitchName, spokenPitch } from "./choir.ts";

test("a pitch is named as a note, and said with 'sharp' rather than '#'", () => {
  assert.equal(pitchName(60), "C4");
  assert.equal(pitchName(61), "C#4");
  assert.equal(spokenPitch(60), "C 4");
  assert.equal(spokenPitch(61), "C sharp 4");
  assert.equal(spokenPitch(69), "A 4");
  assert.equal(spokenPitch(11), "B -1");
});
