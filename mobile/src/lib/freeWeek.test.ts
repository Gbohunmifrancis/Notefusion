import { test } from "node:test";
import assert from "node:assert/strict";
import { FREE_RESET_FALLBACK, freeResetLabel, freeWeek } from "./freeWeek.ts";

/** Runs `fn` with the process in time zone `tz` (Node re-reads TZ when it changes). */
function inZone<T>(tz: string, fn: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

// Fri 16 Oct 2026, 18:00 West Africa Time.
const RESET = "2026-10-16T17:00:00Z";

test("the reset reads as Friday 6pm in Lagos", () => {
  assert.equal(inZone("Africa/Lagos", () => freeResetLabel(RESET)), "Friday 6pm");
});

test("the reset is shown in the phone's own time", () => {
  assert.equal(inZone("America/New_York", () => freeResetLabel(RESET)), "Friday 1pm");
  assert.equal(inZone("Asia/Kolkata", () => freeResetLabel(RESET)), "Friday 10:30pm");
  assert.equal(inZone("Pacific/Auckland", () => freeResetLabel(RESET)), "Saturday 6am");
});

test("without a moment from the API, the rule itself", () => {
  assert.equal(freeResetLabel(null), FREE_RESET_FALLBACK);
  assert.equal(freeResetLabel("nonsense"), FREE_RESET_FALLBACK);
});

test("this week's free ones come from the weekly fields, bought ones apart", () => {
  const week = inZone("Africa/Lagos", () =>
    freeWeek({
      trialGenerationsRemaining: 3,
      trialGenerationsTotal: 4,
      boughtTranscriptionsRemaining: 1,
      boughtTranscriptionsTotal: 1,
      freeTranscriptionsRemaining: 2,
      freeTranscriptionsPerWeek: 3,
      freeResetsAtUtc: RESET,
    }),
  );
  assert.deepEqual(week, { left: 2, total: 3, back: "Friday 6pm" });
});

test("an older API's totals are taken apart into the free ones", () => {
  assert.deepEqual(
    freeWeek({ trialGenerationsRemaining: 2, trialGenerationsTotal: 5, boughtTranscriptionsRemaining: 1, boughtTranscriptionsTotal: 2 }),
    { left: 1, total: 3, back: FREE_RESET_FALLBACK },
  );
  assert.equal(freeWeek(null), null);
});
