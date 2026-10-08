import { test } from "node:test";
import assert from "node:assert/strict";
import { solfaOpening } from "./solfaOpening.ts";

const note = (startBeat: number, solfa: string, octaveMark = "") => ({
  pitchMidi: 60,
  startBeat,
  durBeats: 1,
  degree: 0,
  solfa,
  octaveMark,
  conf: 1,
});

test("the first bar, then the start of the next after a bar line", () => {
  const notes = [note(0, "d"), note(1, "r"), note(2, "m"), note(3, "f"), note(4, "s"), note(5, "l"), note(6, "s")];
  assert.deepEqual(solfaOpening(notes, "4/4"), { first: "d r m f", rest: "s l s" });
});

test("bars follow the time signature and octave marks stay on the syllable", () => {
  const notes = [note(0, "s", ","), note(1, "d"), note(2, "m"), note(3, "d")];
  assert.deepEqual(solfaOpening(notes, "3/4"), { first: "s, d m", rest: "d" });
});

test("no notes, no opening", () => {
  assert.equal(solfaOpening(null, "4/4"), null);
  assert.equal(solfaOpening([], "4/4"), null);
});
