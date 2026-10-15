// node --test web-site/tests/*.test.mjs
// confidence.js is a plain browser script that sets window.NfConfidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/confidence.js", import.meta.url), "utf8"), { window });
const { note, THRESHOLDS } = window.NfConfidence;

test("a clear sheet gets no note", () => {
  assert.equal(note(0.91, false), null);
  assert.equal(note(THRESHOLDS.clear, false), null);
});

test("a middling sheet asks for a check, pointing at highlights only when there are any", () => {
  assert.equal(note(0.52, false), "Some notes may need a check.");
  assert.equal(note(0.52, true), "Check the highlighted notes.");
});

test("a low sheet says the recording was hard to hear, never a percentage", () => {
  const text = note(0.31, false);
  assert.match(text, /hard to hear/);
  assert.doesNotMatch(text, /\d/);
  assert.equal(note(undefined, false), text); // no confidence reads as low, not as clear
});
