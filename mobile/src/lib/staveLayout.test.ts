import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedStaveHeight, MIN_STAVE_HEIGHT, skeletonStaffTops, STAFF_LINE_GAP, systemsFor } from "./staveLayout.ts";

test("four bars to a system, a system at least", () => {
  assert.equal(systemsFor(0), 1);
  assert.equal(systemsFor(4), 1);
  assert.equal(systemsFor(5), 2);
  assert.equal(systemsFor(8), 2);
  assert.equal(systemsFor(9), 3);
});

test("the card opens at the height its bars will need, never under one system's floor", () => {
  assert.equal(expectedStaveHeight(8), 260);
  assert.equal(expectedStaveHeight(12), 390);
  assert.equal(expectedStaveHeight(3), MIN_STAVE_HEIGHT);
  assert.equal(expectedStaveHeight(0), MIN_STAVE_HEIGHT);
});

test("each system's skeleton lines sit inside the expected height", () => {
  for (const bars of [1, 4, 8, 13, 32]) {
    const tops = skeletonStaffTops(bars);
    assert.equal(tops.length, systemsFor(bars));
    const last = tops[tops.length - 1]!;
    assert.ok(last + 4 * STAFF_LINE_GAP < expectedStaveHeight(bars), String(bars));
  }
  assert.deepEqual(skeletonStaffTops(8), [44, 174]);
});
