// node --test web-site/tests/*.test.mjs
// freeweek.js is a plain browser script that sets window.NfFreeWeek.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {}; // the vm realm has its own Object, so results are spread back into this one to compare
vm.runInNewContext(readFileSync(new URL("../assets/freeweek.js", import.meta.url), "utf8"), { window, Date, String, Math, isNaN });
const { when, next, free, FALLBACK } = window.NfFreeWeek;

/** Runs `fn` with the process in time zone `tz` (Node re-reads TZ when it changes). */
function inZone(tz, fn) {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
}

// Fri 16 Oct 2026, 17:00 UTC.
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

test("without a moment from the API, the rule itself, in UTC and never another zone", () => {
  assert.equal(when(null), FALLBACK);
  assert.equal(when("not a date"), FALLBACK);
  assert.equal(FALLBACK, "Friday 17:00 UTC");
});

test("the next reset is the coming Friday 17:00 UTC, a week on at the moment itself", () => {
  assert.equal(next(new Date("2026-10-14T09:00:00Z")), "2026-10-16T17:00:00.000Z"); // Wednesday
  assert.equal(next(new Date("2026-10-16T16:59:00Z")), "2026-10-16T17:00:00.000Z"); // Friday, a minute before
  assert.equal(next(new Date(RESET)), "2026-10-23T17:00:00.000Z");                  // the moment itself
  assert.equal(next(new Date("2026-10-17T09:00:00Z")), "2026-10-23T17:00:00.000Z"); // Saturday
  assert.equal(next(new Date("2026-12-31T23:00:00Z")), "2027-01-01T17:00:00.000Z"); // across the new year
});

test("a visitor with no account reads the next reset in their own time", () => {
  const now = new Date("2026-10-14T09:00:00Z");
  assert.equal(inZone("Europe/London", () => when(next(now))), "Friday 6pm");
  assert.equal(inZone("America/Los_Angeles", () => when(next(now))), "Friday 10am");
  assert.equal(inZone("Australia/Sydney", () => when(next(now))), "Saturday 4am");
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
