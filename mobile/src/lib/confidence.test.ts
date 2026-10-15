import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIDENCE, confidenceA11y, confidenceLevel, confidenceNote } from "./confidence.ts";

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
