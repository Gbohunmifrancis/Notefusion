import { test } from "node:test";
import assert from "node:assert/strict";
import { openingBars, solfaOpening } from "./solfaOpening.ts";

const note = (startBeat: number, solfa: string, octaveMark = "", durBeats = 1) => ({
  pitchMidi: 60,
  startBeat,
  durBeats,
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

test("the opening bar by bar, a dash for each further beat held", () => {
  const notes = [
    note(0, "s", ","), note(1, "d"), note(2, "d"), note(3, "r"),
    note(4, "m", "", 2), note(6, "r"), note(7, "d"), note(8, "t", ","),
  ];
  assert.equal(openingBars(notes, "4/4", 7), "s, d d r │ m – r d");
  assert.equal(openingBars(notes, "4/4"), "s, d d r │ m – r d │ t,");
});

test("a pickup is its own bar, and the meter places the bar lines", () => {
  // Amazing Grace in 3/4 with a one-beat pickup: s, │ d – m d │ …
  const pickup = [note(2, "s", ","), note(3, "d", "", 2), note(5, "m", "", 0.5), note(5.5, "d", "", 0.5)];
  assert.equal(openingBars(pickup, "3/4"), "s, │ d – m d");
});

test("a held note stops at its bar line, and compound time counts dotted beats", () => {
  assert.equal(openingBars([note(2, "d", "", 4), note(6, "r")], "4/4"), "d – │ r");
  assert.equal(openingBars([note(0, "d", "", 3), note(3, "m", "", 1.5)], "6/8"), "d – │ m");
  assert.equal(openingBars([], "4/4"), null);
});
