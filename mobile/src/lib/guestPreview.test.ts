import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GUEST_MAX_SECONDS,
  guestRecordingLine,
  guestTakeFull,
  previewRefusal,
  previewTitle,
  readPendingPreview,
} from "./guestPreview.ts";

test("a guest's take stops by itself at thirty seconds, the API's preview length", () => {
  assert.equal(GUEST_MAX_SECONDS, 30);
  assert.equal(guestTakeFull(29), false);
  assert.equal(guestTakeFull(30), true);
  assert.equal(guestTakeFull(31), true, "a tick that lands late still stops it");
});

test("the line under the clock counts down the last ten seconds", () => {
  assert.equal(guestRecordingLine(0), "Recording · keep going to the end of the phrase");
  assert.equal(guestRecordingLine(19), "Recording · keep going to the end of the phrase");
  assert.equal(guestRecordingLine(20), "Stopping in 10s · the free preview is 30 seconds");
  assert.equal(guestRecordingLine(29), "Stopping in 1s · the free preview is 30 seconds");
  assert.equal(guestRecordingLine(31), "Stopping in 0s · the free preview is 30 seconds");
});

test("a refused send is read as the website reads it", () => {
  assert.equal(previewRefusal(403, "PREVIEW_LIMIT_REACHED"), "used", "the one preview is spent");
  assert.equal(previewRefusal(undefined, "PREVIEW_LIMIT_REACHED"), "used");
  assert.equal(previewRefusal(undefined, "NETWORK_OFFLINE"), "kept", "no answer: the take is kept");
  assert.equal(previewRefusal(0, "NETWORK_TIMEOUT"), "kept");
  assert.equal(previewRefusal(408, null), "kept");
  assert.equal(previewRefusal(429, "RATE_LIMITED"), "kept", "too many at once");
  assert.equal(previewRefusal(500, "SERVER_ERROR"), "kept");
  assert.equal(previewRefusal(503, "TRANS_SERVICE_BUSY"), "kept");
  assert.equal(previewRefusal(422, "TRANS_INVALID_AUDIO"), "said", "sending the same take again would not help");
  assert.equal(previewRefusal(400, "TRANS_INVALID_TIME_SIGNATURE"), "said");
  assert.equal(previewRefusal(413, null), "said");
});

test("a stored preview is read back, with its sheet once there is one", () => {
  const result = { notes: [], key: "G major" };
  const stored = { jobId: "job-1", recordedAt: 1_760_000_000_000, fileName: "clip-12s.m4a", result };
  assert.deepEqual(readPendingPreview(JSON.stringify(stored)), stored);
  assert.deepEqual(readPendingPreview(JSON.stringify({ ...stored, result: null })), { ...stored, result: null });
  assert.equal(readPendingPreview(JSON.stringify({ ...stored, result: { key: "G major" } }))?.result, null, "no notes: not a sheet");
  assert.equal(readPendingPreview(JSON.stringify({ ...stored, fileName: 4 }))?.fileName, "");
});

test("an unreadable stored preview is none", () => {
  assert.equal(readPendingPreview(null), null);
  assert.equal(readPendingPreview(""), null);
  assert.equal(readPendingPreview("{"), null);
  assert.equal(readPendingPreview("null"), null);
  assert.equal(readPendingPreview(JSON.stringify({ recordedAt: 1 })), null, "no job");
  assert.equal(readPendingPreview(JSON.stringify({ jobId: " ", recordedAt: 1 })), null);
  assert.equal(readPendingPreview(JSON.stringify({ jobId: "j", recordedAt: "yesterday" })), null);
});

test("the kept sheet is named as the Library names a take", () => {
  assert.equal(previewTitle("clip-12s.m4a", "Sun 17:10"), "Recording · Sun 17:10");
  assert.equal(previewTitle("", "Sun 17:10"), "Recording · Sun 17:10");
  assert.equal(previewTitle("Abide with me.mp3", "Sun 17:10"), "Abide with me");
  assert.equal(previewTitle(".m4a", "Sun 17:10"), ".m4a", "a name that is all ending is kept");
  assert.equal(previewTitle("x".repeat(130) + ".wav", "Sun 17:10").length, 120, "the API keeps 120 characters");
});
