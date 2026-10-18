import { test } from "node:test";
import assert from "node:assert/strict";
import { DOH_TIPS, nextTip, tipLabel } from "./dohTips.ts";

test("six tips from the app's own advice, each short enough for the bubble", () => {
  assert.equal(DOH_TIPS.length, 6);
  for (const t of DOH_TIPS) assert.ok(t.length <= 110, t);
  assert.ok(DOH_TIPS.some((t) => t.includes("arm's length")));
});

test("each tap gives the next tip, and the last leads back to the first", () => {
  assert.equal(nextTip(null), 0);
  assert.equal(nextTip(0), 1);
  assert.equal(nextTip(DOH_TIPS.length - 1), 0);
  assert.equal(nextTip(null, 0), 0);
});

test("the bubble's label counts from one", () => {
  assert.equal(tipLabel(1), "Tip 2 of 6");
});
