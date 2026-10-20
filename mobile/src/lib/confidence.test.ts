import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIDENCE, confidenceA11y, confidenceLevel, confidenceNote, doubtfulBeats, isDoubtfulNote } from "./confidence.ts";

test("a note under the check line is doubtful; the line itself is not", () => {
  assert.equal(isDoubtfulNote(0.49), true);
  assert.equal(isDoubtfulNote(0), true);
  assert.equal(isDoubtfulNote(CONFIDENCE.hard), false);
  assert.equal(isDoubtfulNote(0.9), false);
});

test("the stave rings each doubtful onset once, in order", () => {
  const notes = [
    { startBeat: 3, conf: 0.3 },
    { startBeat: 0, conf: 0.9 },
    { startBeat: 1.5, conf: 0.2 },
    { startBeat: 3, conf: 0.1 },
    { startBeat: 4.3333333, conf: 0.4 },
    { startBeat: 6, conf: 0.5 },
  ];
  assert.deepEqual(doubtfulBeats(notes), [1.5, 3, 4.333]);
  assert.deepEqual(doubtfulBeats([]), []);
});

test("a clear sheet says nothing", () => {
  assert.equal(confidenceNote(0.9, true), null);
  assert.equal(confidenceNote(CONFIDENCE.clear, false), null);
  assert.equal(confidenceLevel(0.9), "clear");
});

test("a middling sheet points at the highlighted notes when the sheet has some", () => {
  assert.equal(confidenceNote(0.52, true), "Check the highlighted notes.");
  assert.equal(confidenceNote(0.52, false), "Some notes may need a check.");
});

test("a low sheet says it was hard to hear, and nothing is ever a percentage", () => {
  const low = confidenceNote(0.3, true);
  assert.match(low ?? "", /hard to hear/);
  for (const conf of [0.1, 0.3, 0.52, 0.6, Number.NaN]) {
    assert.doesNotMatch(confidenceNote(conf, true) ?? "", /\d|%/);
    assert.doesNotMatch(confidenceA11y(conf), /\d|%/);
  }
  assert.equal(confidenceLevel(Number.NaN), "hard");
});
