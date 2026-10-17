// node --test web-site/tests/*.test.mjs
// practice.js is "Learn my part": which part, how loud the others are, which bars loop, and what a take
// of those bars is marked against. The mobile copy (mobile/src/lib/practice.ts) has the same tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/practice.js", import.meta.url), "utf8"), { window });
const P = window.NfPractice;
// Objects made in the vm context have its Object prototype: compare them as plain data.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
const n = (pitchMidi, startBeat, durBeats) => ({ pitchMidi, startBeat, durBeats, solfa: "d", octaveMark: "" });

test("the parts on offer are the tune and the parts the sheet has, in S A T B order", () => {
  same(P.partsOf(null), ["soprano"]);
  same(P.partsOf({ bass: { notes: [n(48, 0, 1)] }, alto: { notes: [n(60, 0, 1)] }, tenor: { notes: [] } }), ["soprano", "alto", "bass"]);
});

test("the remembered part is chosen when the sheet has it, else the tune", () => {
  assert.equal(P.choosePart(["soprano", "alto", "tenor", "bass"], "tenor"), "tenor");
  assert.equal(P.choosePart(["soprano", "alto"], "tenor"), "soprano");
  assert.equal(P.choosePart(["soprano"], null), "soprano");
});

test("balance: yours loud and the others at a quarter; alone silences them; equal plays all alike", () => {
  const names = ["soprano", "alto", "tenor", "bass"];
  same(P.levels(names, "alto", "balance"), { soprano: 0.25, alto: 1, tenor: 0.25, bass: 0.25 });
  same(P.levels(names, "alto", "alone"), { soprano: 0, alto: 1, tenor: 0, bass: 0 });
  same(P.levels(names, "alto", "equal"), { soprano: 1, alto: 1, tenor: 1, bass: 1 });
});

test("the loop starts on the whole of a short tune, or the first four bars of a long one", () => {
  same(P.defaultRange(6), { from: 1, to: 6 });
  same(P.defaultRange(8), { from: 1, to: 8 });
  same(P.defaultRange(16), { from: 1, to: 4 });
  same(P.defaultRange(0), { from: 1, to: 1 });
});

test("two taps choose the bars, in either order; the first tap loops that bar alone", () => {
  const first = P.tapBar(null, 5);
  same(first, { range: { from: 5, to: 5 }, pending: 5 });
  same(P.tapBar(first.pending, 2), { range: { from: 2, to: 5 }, pending: null });
  same(P.tapBar(3, 7), { range: { from: 3, to: 7 }, pending: null });
});

test("slicing bars keeps the notes that start in them, from beat 0, and cuts one held past the end", () => {
  // 3/4: bar 2 is beats 3..6, bar 3 is 6..9.
  const notes = [n(60, 0, 3), n(62, 3, 1), n(0, 4, 1), n(64, 5, 2), n(65, 7, 2), n(67, 9, 3)];
  const s = P.sliceBars(notes, 2, 3, "3/4");
  same(s.index, [1, 3, 4]); // the rest (pitch 0) is not a note to sing
  same(s.notes.map((x) => [x.startBeat, x.durBeats]), [[0, 1], [2, 2], [4, 2]]);
  assert.equal(s.beats, 6);
  // A note held over the last bar-line is judged only up to it.
  const held = P.sliceBars([n(60, 2, 4)], 1, 1, "3/4");
  same(held.notes.map((x) => x.durBeats), [1]);
});

test("a target is the slice stretched by the slow-down at the sheet's tempo", () => {
  const s = P.sliceBars([n(60, 4, 1), n(62, 5, 2)], 2, 2, "4/4");
  same(P.gradeTarget(s, 90, 0.5, 2.5), {
    notes: [{ pitchMidi: 60, startBeat: 0, durBeats: 2 }, { pitchMidi: 62, startBeat: 2, durBeats: 4 }],
    tempoBpm: 90, leadInSec: 2.5,
  });
  // At full speed it is the slice as written; the tempo is held to what the worker accepts.
  same(P.gradeTarget(s, 12, 1, 0).tempoBpm, 30);
  same(P.gradeTarget(s, 90, 1, 0).notes[1], { pitchMidi: 62, startBeat: 1, durBeats: 2 });
});

test("a take's length and the worker's two-minute cap", () => {
  const s = P.sliceBars([n(60, 0, 4)], 1, 4, "4/4"); // 16 beats
  assert.equal(P.sliceSeconds(s, 120, 1), 8);
  assert.equal(P.sliceSeconds(s, 120, 0.5), 16);
  assert.equal(P.tooLong(s, 120, 0.5, 4), false);
  const long = P.sliceBars([n(60, 0, 4)], 1, 40, "4/4"); // 160 beats: 80 s at 120, 160 s at half speed
  assert.equal(P.tooLong(long, 120, 1, 4), false);
  assert.equal(P.tooLong(long, 120, 0.5, 4), true);
});

test("marks come back on the part's own notes", () => {
  const notes = [n(60, 0, 1), n(62, 4, 1), n(64, 5, 1)];
  const s = P.sliceBars(notes, 2, 2, "4/4");
  const marks = P.marksByNote({ notes: [{ index: 0, status: "hit", cents: 4 }, { index: 1, status: "missed", cents: null }] }, s);
  same(marks, { 1: { status: "hit", cents: 4 }, 2: { status: "missed", cents: null } });
});

test("the bar strip lists every bar with the notes that start in it", () => {
  const strip = P.bars([n(60, 0, 2), n(62, 2, 2), n(0, 4, 4), n(64, 8, 4)], "4/4", 3);
  same(strip.map((b) => [b.bar, b.notes.map((x) => x.i)]), [[1, [0, 1]], [2, []], [3, [3]]]);
});
