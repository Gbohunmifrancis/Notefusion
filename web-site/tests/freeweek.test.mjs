// node --test web-site/tests/*.test.mjs
// freeweek.js is a plain browser script that sets window.NfFreeWeek.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {}; // the vm realm has its own Object, so results are spread back into this one to compare
vm.runInNewContext(readFileSync(new URL("../assets/freeweek.js", import.meta.url), "utf8"), { window, Date, String, Math, isNaN });
const { when, free, FALLBACK } = window.NfFreeWeek;

/** Runs `fn` with the process in time zone `tz` (Node re-reads TZ when it changes). */
function inZone(tz, fn) {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

// Fri 16 Oct 2026, 18:00 West Africa Time.
const RESET = "2026-10-16T17:00:00Z";

test("the reset reads as Friday 6pm in Lagos", () => {
  assert.equal(inZone("Africa/Lagos", () => when(RESET)), "Friday 6pm");
});

test("the reset is shown in the reader's own time", () => {
  assert.equal(inZone("Europe/London", () => when(RESET)), "Friday 6pm"); // BST is UTC+1 too
  assert.equal(inZone("America/New_York", () => when(RESET)), "Friday 1pm");
  assert.equal(inZone("Asia/Kolkata", () => when(RESET)), "Friday 10:30pm");
  assert.equal(inZone("Pacific/Auckland", () => when(RESET)), "Saturday 6am");
});

test("without a moment from the API, the rule itself", () => {
  assert.equal(when(null), FALLBACK);
  assert.equal(when("not a date"), FALLBACK);
  assert.equal(FALLBACK, "Friday 6pm (West Africa Time)");
});

test("this week's free ones come from the weekly fields", () => {
  const sub = {
    trialGenerationsRemaining: 3, trialGenerationsTotal: 4, boughtTranscriptionsRemaining: 1, boughtTranscriptionsTotal: 1,
    freeTranscriptionsRemaining: 2, freeTranscriptionsPerWeek: 3, freeResetsAtUtc: RESET,
  };
  assert.deepEqual({ ...inZone("Africa/Lagos", () => free(sub)) }, { left: 2, total: 3, back: "Friday 6pm" });
});

test("an older API's totals are taken apart into the free ones", () => {
  const sub = { trialGenerationsRemaining: 2, trialGenerationsTotal: 5, boughtTranscriptionsRemaining: 1, boughtTranscriptionsTotal: 2 };
  assert.deepEqual({ ...free(sub) }, { left: 1, total: 3, back: FALLBACK });
  assert.equal(free(null), null);
});
