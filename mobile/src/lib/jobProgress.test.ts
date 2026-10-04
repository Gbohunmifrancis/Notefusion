import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_AFTER_FAILED_POLLS,
  RETRY_AFTER_MS,
  STALLED_AFTER_MS,
  canRetry,
  isOffline,
  isStalled,
  markProgress,
  normalizeStage,
  percentLabel,
  stageLabel,
} from "./jobProgress.ts";

test("stage labels are plain words; the queue says how many are ahead", () => {
  assert.equal(stageLabel("uploading"), "Uploading your recording");
  assert.equal(stageLabel("queued"), "Waiting in line");
  assert.equal(stageLabel("queued", 0), "Waiting in line");
  assert.equal(stageLabel("queued", null), "Waiting in line");
  assert.equal(stageLabel("queued", 3), "Waiting in line · 3 ahead");
  assert.equal(stageLabel("fetching"), "Fetching audio");
  assert.equal(stageLabel("separating"), "Isolating the voice");
  assert.equal(stageLabel("transcribing"), "Writing the solfa");
  assert.equal(stageLabel(null), "Working on it");
});

test("unknown stages read as transcribing; no stage follows the status", () => {
  assert.equal(normalizeStage("queued", "pending"), "queued");
  assert.equal(normalizeStage("separating", "processing"), "separating");
  assert.equal(normalizeStage("polishing", "processing"), "transcribing");
  assert.equal(normalizeStage("Fetching", "processing"), "transcribing");
  assert.equal(normalizeStage(null, "pending"), "queued");
  assert.equal(normalizeStage(undefined, "processing"), "transcribing");
  assert.equal(normalizeStage("", "processing"), "transcribing");
  assert.equal(normalizeStage(null, "done"), null);
  assert.equal(normalizeStage(null, "idle"), null);
});

test("percentage is whole, clamped and never NaN", () => {
  assert.equal(percentLabel(0), "0%");
  assert.equal(percentLabel(0.4249), "42%");
  assert.equal(percentLabel(1), "100%");
  assert.equal(percentLabel(1.7), "100%");
  assert.equal(percentLabel(-0.2), "0%");
  assert.equal(percentLabel(NaN), "0%");
});

test("the stall clock restarts on any movement and only on movement", () => {
  const t0 = 1_000_000;
  const a = markProgress(null, "queued", 0, t0);
  assert.deepEqual(a, { stage: "queued", progress: 0, changedAt: t0 });

  // Same reading: same mark, so the clock keeps running.
  const b = markProgress(a, "queued", 0, t0 + 60_000);
  assert.equal(b, a);
  assert.equal(isStalled(b, t0 + STALLED_AFTER_MS - 1), false);
  assert.equal(isStalled(b, t0 + STALLED_AFTER_MS), true);

  // Progress moved: new mark, not stalled any more.
  const c = markProgress(b, "queued", 0.01, t0 + STALLED_AFTER_MS + 5_000);
  assert.equal(c.changedAt, t0 + STALLED_AFTER_MS + 5_000);
  assert.equal(isStalled(c, t0 + STALLED_AFTER_MS + 6_000), false);

  // Stage moved with the same progress figure: also counts.
  const d = markProgress(c, "transcribing", 0.01, t0 + 200_000);
  assert.notEqual(d, c);
  assert.equal(d.stage, "transcribing");

  assert.equal(isStalled(null, t0), false);
});

test("try again is offered after twelve minutes without a finish", () => {
  const start = 5_000;
  assert.equal(canRetry(start, start + RETRY_AFTER_MS - 1), false);
  assert.equal(canRetry(start, start + RETRY_AFTER_MS), true);
  assert.equal(canRetry(null, start + RETRY_AFTER_MS * 2), false);
});

test("an upload that has sent every byte and hears nothing back counts as stalled", () => {
  const t0 = 2_000_000;
  let mark = markProgress(null, "uploading", 0, t0);
  // Bytes leaving the phone restart the clock each time the figure moves.
  mark = markProgress(mark, "uploading", 0.5, t0 + 10_000);
  mark = markProgress(mark, "uploading", 1, t0 + 20_000);
  assert.equal(mark.changedAt, t0 + 20_000);
  assert.equal(isStalled(mark, t0 + 20_000 + STALLED_AFTER_MS - 1), false);
  // The same 100% again is not movement: the server has not answered.
  assert.equal(markProgress(mark, "uploading", 1, t0 + 60_000), mark);
  assert.equal(isStalled(mark, t0 + 20_000 + STALLED_AFTER_MS), true);
  // The server's answer is a new stage at the worker's own figure, so the clock restarts.
  const answered = markProgress(null, "queued", 0, t0 + 200_000);
  assert.equal(isStalled(answered, t0 + 200_000 + 1_000), false);
});

test("offline after three failed polls in a row", () => {
  assert.equal(OFFLINE_AFTER_FAILED_POLLS, 3);
  assert.equal(isOffline(0), false);
  assert.equal(isOffline(2), false);
  assert.equal(isOffline(3), true);
  assert.equal(isOffline(7), true);
});
