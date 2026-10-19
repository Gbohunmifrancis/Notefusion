import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_AFTER_FAILURES,
  MAX_STREAM_CHARS,
  QUIET_CHECK_MS,
  WATCHDOG_MS,
  isTerminalStatus,
  reconnectDelayMs,
  shouldFallBack,
} from "./streamPolicy.ts";

test("a dropped stream is reopened after 1, 2, 5, 10, then every 30 seconds", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(reconnectDelayMs), [1_000, 2_000, 5_000, 10_000, 30_000, 30_000, 30_000]);
  // Never asked with nothing failed, but answered sensibly.
  assert.equal(reconnectDelayMs(0), 1_000);
});

test("the job is read on a timer only after three streams fail in a row", () => {
  assert.equal(FALLBACK_AFTER_FAILURES, 3);
  assert.equal(shouldFallBack(2), false);
  assert.equal(shouldFallBack(3), true);
  assert.equal(shouldFallBack(9), true);
});

test("the watchdog outlasts two missed pings; the quiet check outlasts the watchdog", () => {
  assert.ok(WATCHDOG_MS > 2 * 20_000);
  assert.ok(QUIET_CHECK_MS > WATCHDOG_MS);
  assert.equal(MAX_STREAM_CHARS, 262_144);
});

test("done and failed are terminal in every spelling; running is not", () => {
  for (const s of ["done", "Done", 2, "failed", "Failed", 3]) assert.equal(isTerminalStatus(s), true, String(s));
  for (const s of ["pending", "processing", "Processing", 0, 1, null, undefined, ""]) assert.equal(isTerminalStatus(s), false, String(s));
});
