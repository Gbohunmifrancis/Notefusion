import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_GOOD_DBFS,
  LEVEL_QUIET_DBFS,
  LEVEL_WORD_HOLD_MS,
  levelText,
  levelWordFor,
  nextLevelLine,
} from "./recordLevel.ts";

test("a reading is good from the good line up, a little soft down to the quiet line, and wordless below it", () => {
  assert.equal(levelWordFor(-6), "good");
  assert.equal(levelWordFor(LEVEL_GOOD_DBFS), "good");
  assert.equal(levelWordFor(LEVEL_GOOD_DBFS - 0.1), "soft");
  assert.equal(levelWordFor(LEVEL_QUIET_DBFS), "soft");
  // Too quiet is the banner's to say, not the line's.
  assert.equal(levelWordFor(LEVEL_QUIET_DBFS - 0.1), null);
  assert.equal(levelWordFor(-160), null);
});

test("the first reading of a take sets the line at once", () => {
  assert.deepEqual(nextLevelLine(null, -10, 5000), { word: "good", since: 5000 });
  assert.deepEqual(nextLevelLine(null, -25, 5000), { word: "soft", since: 5000 });
});

test("the line changes at most once a second", () => {
  const good = nextLevelLine(null, -10, 0);
  // A soft syllable 150 ms later does not move it.
  assert.equal(nextLevelLine(good, -25, 150), good);
  assert.equal(nextLevelLine(good, -25, LEVEL_WORD_HOLD_MS - 1), good);
  // A second on, it does.
  const soft = nextLevelLine(good, -25, LEVEL_WORD_HOLD_MS);
  assert.deepEqual(soft, { word: "soft", since: LEVEL_WORD_HOLD_MS });
  // And then holds again for its own second.
  assert.equal(nextLevelLine(soft, -10, LEVEL_WORD_HOLD_MS + 400), soft);
});

test("the same word keeps the same line, so nothing re-renders", () => {
  const good = nextLevelLine(null, -10, 0);
  assert.equal(nextLevelLine(good, -5, 3000), good);
});

test("going quiet takes the word away once the line may change, leaving the banner to speak", () => {
  const good = nextLevelLine(null, -10, 0);
  assert.deepEqual(nextLevelLine(good, -45, 2000), { word: null, since: 2000 });
});

test("the words beside the trace", () => {
  assert.equal(levelText("good"), "Level: good");
  assert.equal(levelText("soft"), "Level: a little soft");
});
