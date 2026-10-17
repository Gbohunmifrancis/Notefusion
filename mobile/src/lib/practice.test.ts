import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bars,
  choosePart,
  defaultRange,
  gradeTarget,
  levels,
  marksByNote,
  partsOf,
  practiceTempo,
  sliceBars,
  sliceSeconds,
  speedsFor,
  tapBar,
  tooLong,
} from "./practice.ts";
import type { NoteEvent } from "../api/types";

// The same cases as web-site/tests/practice.test.mjs: the two copies must agree.
const n = (pitchMidi: number, startBeat: number, durBeats: number): NoteEvent =>
  ({ pitchMidi, startBeat, durBeats, degree: 1, solfa: "d", octaveMark: "", conf: 1 });

test("the parts on offer are the tune and the parts the sheet has, in S A T B order", () => {
  assert.deepEqual(partsOf(null), ["soprano"]);
  assert.deepEqual(
    partsOf({ bass: { notes: [n(48, 0, 1)], solfaLines: [] }, alto: { notes: [n(60, 0, 1)], solfaLines: [] }, tenor: { notes: [], solfaLines: [] } }),
    ["soprano", "alto", "bass"],
  );
});

test("the remembered part is chosen when the sheet has it, else the tune", () => {
  assert.equal(choosePart(["soprano", "alto", "tenor", "bass"], "tenor"), "tenor");
  assert.equal(choosePart(["soprano", "alto"], "tenor"), "soprano");
  assert.equal(choosePart(["soprano"], null), "soprano");
});

test("balance: yours loud and the others at a quarter; alone silences them; equal plays all alike", () => {
  const names = ["soprano", "alto", "tenor", "bass"] as const;
  assert.deepEqual(levels(names, "alto", "balance"), { soprano: 0.25, alto: 1, tenor: 0.25, bass: 0.25 });
  assert.deepEqual(levels(names, "alto", "alone"), { soprano: 0, alto: 1, tenor: 0, bass: 0 });
  assert.deepEqual(levels(names, "alto", "equal"), { soprano: 1, alto: 1, tenor: 1, bass: 1 });
});

test("the loop starts on the whole of a short tune, or the first four bars of a long one", () => {
  assert.deepEqual(defaultRange(6), { from: 1, to: 6 });
  assert.deepEqual(defaultRange(8), { from: 1, to: 8 });
  assert.deepEqual(defaultRange(16), { from: 1, to: 4 });
  assert.deepEqual(defaultRange(0), { from: 1, to: 1 });
});

test("two taps choose the bars, in either order; the first tap loops that bar alone", () => {
  const first = tapBar(null, 5);
  assert.deepEqual(first, { range: { from: 5, to: 5 }, pending: 5 });
  assert.deepEqual(tapBar(first.pending, 2), { range: { from: 2, to: 5 }, pending: null });
  assert.deepEqual(tapBar(3, 7), { range: { from: 3, to: 7 }, pending: null });
});

test("slicing bars keeps the notes that start in them, from beat 0, and cuts one held past the end", () => {
  const notes = [n(60, 0, 3), n(62, 3, 1), n(0, 4, 1), n(64, 5, 2), n(65, 7, 2), n(67, 9, 3)];
  const s = sliceBars(notes, 2, 3, "3/4");
  assert.deepEqual(s.index, [1, 3, 4]);
  assert.deepEqual(s.notes.map((x) => [x.startBeat, x.durBeats]), [[0, 1], [2, 2], [4, 2]]);
  assert.equal(s.beats, 6);
  assert.deepEqual(sliceBars([n(60, 2, 4)], 1, 1, "3/4").notes.map((x) => x.durBeats), [1]);
});

test("a target is the slice stretched by the slow-down at the sheet's tempo", () => {
  const s = sliceBars([n(60, 4, 1), n(62, 5, 2)], 2, 2, "4/4");
  assert.deepEqual(gradeTarget(s, 90, 0.5, 2.5), {
    notes: [{ pitchMidi: 60, startBeat: 0, durBeats: 2 }, { pitchMidi: 62, startBeat: 2, durBeats: 4 }],
    tempoBpm: 90,
    leadInSec: 2.5,
  });
  assert.equal(gradeTarget(s, 12, 1, 0).tempoBpm, 30);
  assert.deepEqual(gradeTarget(s, 90, 1, 0).notes[1], { pitchMidi: 62, startBeat: 1, durBeats: 2 });
});

test("a take's length and the worker's two-minute cap", () => {
  const s = sliceBars([n(60, 0, 4)], 1, 4, "4/4");
  assert.equal(sliceSeconds(s, 120, 1), 8);
  assert.equal(sliceSeconds(s, 120, 0.5), 16);
  assert.equal(tooLong(s, 120, 0.5, 4), false);
  const long = sliceBars([n(60, 0, 4)], 1, 40, "4/4");
  assert.equal(tooLong(long, 120, 1, 4), false);
  assert.equal(tooLong(long, 120, 0.5, 4), true);
});

test("marks come back on the part's own notes", () => {
  const s = sliceBars([n(60, 0, 1), n(62, 4, 1), n(64, 5, 1)], 2, 2, "4/4");
  const marks = marksByNote(
    { notes: [{ index: 0, targetMidi: 62, sungMidi: 62, status: "hit", cents: 4 }, { index: 1, targetMidi: 64, sungMidi: null, status: "missed", cents: null }] },
    s,
  );
  assert.deepEqual(marks, { 1: { status: "hit", cents: 4 }, 2: { status: "missed", cents: null } });
});

test("the bar strip lists every bar with the notes that start in it", () => {
  const strip = bars([n(60, 0, 2), n(62, 2, 2), n(0, 4, 4), n(64, 8, 4)], "4/4", 3);
  assert.deepEqual(strip.map((b) => [b.bar, b.notes.map((x) => x.i)]), [[1, [0, 1]], [2, []], [3, [3]]]);
});

test("a slowed practice is the synth at a slower tempo, never under its 30 BPM floor", () => {
  // Slowing the synthesised piano is playing the notes slower: the same pitch, no time-stretch.
  assert.equal(practiceTempo(96, 0.75), 72);
  assert.equal(practiceTempo(20, 1), 30);
  assert.deepEqual(speedsFor(96), [0.5, 0.75, 1]);
  assert.deepEqual(speedsFor(50), [0.75, 1]);
  assert.deepEqual(speedsFor(30), [1]);
});
