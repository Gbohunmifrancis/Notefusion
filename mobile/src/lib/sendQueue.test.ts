import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BACKOFF_MS,
  awaitingJobs,
  backoffMs,
  classifySendFailure,
  newQueuedSend,
  nextDue,
  pendingCount,
  recover,
  signOutWarning,
  statusLine,
  transition,
  type QueuedSend,
} from "./sendQueue.ts";

const take = (id: string, now = 0, extra: { afterFailedSend?: boolean } = {}): QueuedSend =>
  newQueuedSend({ id, userId: "u", fileUri: `file:///outbox/${id}.m4a`, fileName: `${id}.m4a`, bytes: 120_000, opts: { mode: "melody" }, now, ...extra });

test("a take queued because the send failed waits one backoff; one recorded offline is due at once", () => {
  assert.equal(take("a", 1000).nextAttemptAt, 1000);
  const failed = take("b", 1000, { afterFailedSend: true });
  assert.equal(failed.attempts, 1);
  assert.equal(failed.nextAttemptAt, 1000 + 30_000);
});

test("backoff doubles from 30 s and stops at 15 minutes", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(backoffMs), [30_000, 60_000, 120_000, 240_000, 480_000]);
  assert.equal(backoffMs(6), MAX_BACKOFF_MS);
  assert.equal(backoffMs(20), MAX_BACKOFF_MS);
  assert.equal(backoffMs(0), 0);
});

test("the happy path: waiting → sending → sent → done", () => {
  let t = take("a");
  t = transition(t, { type: "attempt", now: 1 });
  assert.equal(t.status, "sending");
  t = transition(t, { type: "sent", jobId: "job-1", now: 2 });
  assert.equal(t.status, "sent");
  assert.equal(t.jobId, "job-1");
  assert.deepEqual(awaitingJobs([t]).map((x) => x.id), ["a"]);
  t = transition(t, { type: "job_done" });
  assert.equal(t.status, "done");
  assert.equal(statusLine(t), "Ready — tap to open");
  assert.equal(pendingCount([t]), 0);
});

test("no network puts it back to waiting with a longer wait each time; nothing is lost", () => {
  let t = transition(take("a"), { type: "attempt", now: 0 });
  t = transition(t, { type: "network_error", now: 100 });
  assert.equal(t.status, "waiting");
  assert.equal(t.attempts, 1);
  assert.equal(t.nextAttemptAt, 100 + 30_000);
  t = transition(transition(t, { type: "attempt", now: 200 }), { type: "network_error", now: 200 });
  assert.equal(t.nextAttemptAt, 200 + 60_000);
  assert.equal(t.fileUri, "file:///outbox/a.m4a");
  assert.match(statusLine(t), /Waiting to send/);
});

test("a refusal keeps the file and the server's sentence; retry by hand sends it again now", () => {
  let t = transition(take("a"), { type: "attempt", now: 0 });
  t = transition(t, { type: "refused", code: "BILLING_FREE_TIER_LIMIT", message: "You've used your 3 free transcriptions." });
  assert.equal(t.status, "refused");
  assert.equal(statusLine(t), "You've used your 3 free transcriptions.");
  assert.equal(pendingCount([t]), 1);
  // The automatic sender leaves a refused take alone.
  assert.equal(nextDue([t], 10 ** 12), null);
  t = transition(t, { type: "retry", now: 5000 });
  assert.equal(t.status, "waiting");
  assert.equal(t.message, null);
  assert.equal(t.nextAttemptAt, 5000);
  assert.equal(nextDue([t], 5000)?.id, "a");
});

test("a failed job can be retried; events that do not apply change nothing", () => {
  let t = transition(transition(take("a"), { type: "attempt", now: 0 }), { type: "sent", jobId: "j", now: 0 });
  t = transition(t, { type: "job_failed", message: "No clear notes detected." });
  assert.equal(t.status, "failed");
  assert.equal(transition(t, { type: "job_done" }), t);
  assert.equal(transition(t, { type: "sent", jobId: "x", now: 0 }), t);
  assert.equal(transition(t, { type: "retry", now: 9 }).status, "waiting");
  const w = take("b");
  assert.equal(transition(w, { type: "network_error", now: 0 }), w);
  assert.equal(transition(w, { type: "job_done" }), w);
});

test("one send at a time, oldest first, and only when due unless forced (app came forward)", () => {
  const a = { ...take("a", 0), nextAttemptAt: 50_000 };
  const b = { ...take("b", 10), nextAttemptAt: 0 };
  assert.equal(nextDue([a, b], 1000)?.id, "b");
  assert.equal(nextDue([a, b], 1000, { force: true })?.id, "a");
  const sending = transition(b, { type: "attempt", now: 1 });
  assert.equal(nextDue([a, sending], 10 ** 9), null);
});

test("a send the app died during is waiting again on the next launch", () => {
  const sending = transition(take("a"), { type: "attempt", now: 0 });
  assert.equal(recover([sending])[0]!.status, "waiting");
});

test("signing out warns about recordings still waiting", () => {
  assert.equal(signOutWarning(0), "");
  assert.match(signOutWarning(1), /One recording is still waiting/);
  assert.match(signOutWarning(3), /3 recordings are still waiting/);
});

test("no answer, a timeout or a gateway error is the network; any other answer is the server's", () => {
  assert.equal(classifySendFailure("NETWORK_OFFLINE", 0), "network");
  assert.equal(classifySendFailure("NETWORK_TIMEOUT", null), "network");
  assert.equal(classifySendFailure("UNKNOWN", undefined), "network");
  for (const s of [408, 429, 502, 503, 504]) assert.equal(classifySendFailure("SERVER_ERROR", s), "network", String(s));
  assert.equal(classifySendFailure("BILLING_FREE_TIER_LIMIT", 402), "refused");
  assert.equal(classifySendFailure("INVALID_AUDIO", 422), "refused");
  assert.equal(classifySendFailure("SERVER_ERROR", 500), "refused");
});
