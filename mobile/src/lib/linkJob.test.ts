import { test } from "node:test";
import assert from "node:assert/strict";
import { LINK_JOB_KEEP_MS, readLinkJob } from "./linkJob.ts";

const NOW = 1_800_000_000_000;
const kept = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    jobId: "job-1",
    url: "https://youtu.be/dQw4w9WgXcQ",
    userId: "u1",
    sentAt: NOW - 60_000,
    opts: { mode: "melody", timeSignature: "3/4", startSeconds: 30, endSeconds: 90 },
    ...over,
  });

test("a link job sent a minute ago by this account is taken up, with what it was sent with", () => {
  const job = readLinkJob(kept(), NOW, "u1");
  assert.equal(job?.jobId, "job-1");
  assert.equal(job?.url, "https://youtu.be/dQw4w9WgXcQ");
  assert.deepEqual(job?.opts, { mode: "melody", timeSignature: "3/4", keyboardTranspose: undefined, startSeconds: 30, endSeconds: 90 });
});

test("another account's job, an old one or an unreadable one is not taken up", () => {
  assert.equal(readLinkJob(kept(), NOW, "u2"), null);
  assert.equal(readLinkJob(kept({ sentAt: NOW - LINK_JOB_KEEP_MS }), NOW, "u1"), null);
  assert.equal(readLinkJob(kept({ sentAt: NOW + 1000 }), NOW, "u1"), null, "a clock that went back");
  assert.equal(readLinkJob(kept({ jobId: "" }), NOW, "u1"), null);
  assert.equal(readLinkJob("{not json", NOW, "u1"), null);
  assert.equal(readLinkJob(null, NOW, "u1"), null);
});

test("options that are not what the screen sends are left out", () => {
  const job = readLinkJob(kept({ opts: { mode: "choir", timeSignature: 4, startSeconds: "30" } }), NOW, "u1");
  assert.deepEqual(job?.opts, { mode: "melody", timeSignature: undefined, keyboardTranspose: undefined, startSeconds: undefined, endSeconds: undefined });
});
