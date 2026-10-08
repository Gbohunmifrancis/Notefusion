import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FAILURE_QUIET_MS,
  INITIAL_RATING_STATE,
  SNOOZE_MS,
  parseRatingState,
  shouldAskForRating,
} from "./ratingPolicy.ts";

const NOW = 1_800_000_000_000;
const ready = { ...INITIAL_RATING_STATE, saves: 3 };

test("asks on the third saved sheet, not before", () => {
  assert.equal(shouldAskForRating({ ...ready, saves: 2 }, NOW), false);
  assert.equal(shouldAskForRating(ready, NOW), true);
});

test("never again once rated", () => {
  assert.equal(shouldAskForRating({ ...ready, done: true }, NOW), false);
});

test("not now waits ninety days", () => {
  const snoozed = { ...ready, snoozedUntil: NOW + SNOOZE_MS };
  assert.equal(shouldAskForRating(snoozed, NOW + SNOOZE_MS - 1), false);
  assert.equal(shouldAskForRating(snoozed, NOW + SNOOZE_MS), true);
});

test("never straight after a failed job", () => {
  const failed = { ...ready, lastFailureAt: NOW };
  assert.equal(shouldAskForRating(failed, NOW + 1000), false);
  assert.equal(shouldAskForRating(failed, NOW + FAILURE_QUIET_MS), true);
});

test("a corrupted store reads as a fresh start", () => {
  assert.deepEqual(parseRatingState("{oops"), INITIAL_RATING_STATE);
  assert.deepEqual(parseRatingState(null), INITIAL_RATING_STATE);
  assert.equal(parseRatingState('{"saves":4,"done":true}').saves, 4);
});
