import { test } from "node:test";
import assert from "node:assert/strict";
import { LINK_JOB_KEEP_MS, linkJobRow as row, linkJobState, readLinkJob, type LinkJob, type LinkJobReading } from "./linkJob.ts";
import { formatClock } from "./clipRange.ts";
import { normalizeStage, stageLabel } from "./jobProgress.ts";

/** As the Library hands them in. */
const linkJobRow = (kept: LinkJob, job: LinkJobReading | null) =>
  row(kept, job, {
    stage: (stage, status, queuePosition) => stageLabel(status ? normalizeStage(stage, status) : null, queuePosition),
    clock: formatClock,
  });

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

test("the song it was sent for is kept with it, and anything unreadable is left out", () => {
  const withSong = readLinkJob(kept({ song: { title: "Way Maker", artist: "Sinach", thumbnailUrl: "https://i.ytimg.com/a.jpg" } }), NOW, "u1");
  assert.deepEqual(withSong?.song, { title: "Way Maker", artist: "Sinach", thumbnailUrl: "https://i.ytimg.com/a.jpg" });
  assert.equal(readLinkJob(kept({ song: { title: 3 } }), NOW, "u1")?.song, undefined);
  assert.equal(readLinkJob(kept(), NOW, "u1")?.song, undefined);
});

test("a job's status reads the same in every spelling", () => {
  assert.equal(linkJobState(2), "done");
  assert.equal(linkJobState("Done"), "done");
  assert.equal(linkJobState(3), "failed");
  assert.equal(linkJobState("failed"), "failed");
  assert.equal(linkJobState(1), "running");
  assert.equal(linkJobState("pending"), "running");
});

test("On its way names the song and says the stage in the job's own words, with the section picked", () => {
  const job = readLinkJob(kept({ song: { title: "Way Maker", artist: "Sinach", thumbnailUrl: null } }), NOW, "u1")!;
  const separating = linkJobRow(job, { status: 1, stage: "separating", progress: 0.46 });
  assert.equal(separating.title, "Way Maker · Sinach");
  assert.equal(separating.line, "Isolating the voice · 0:30–1:30");
  assert.equal(separating.state, "running");
  assert.equal(separating.progress, 0.46);
  assert.equal(linkJobRow(job, { status: "pending", stage: "queued", queuePosition: 2 }).line, "Waiting in line · 2 ahead · 0:30–1:30");
  assert.equal(linkJobRow(job, { status: 1, stage: "transcribing", source: { title: "Way Maker (Live)", artist: "Sinach", startSeconds: 60, endSeconds: 120 } }).line, "Writing the solfa · 1:00–2:00");
});

test("before the song is known it is a song from a link; done it is ready to open", () => {
  const job = readLinkJob(kept({ opts: { mode: "melody" } }), NOW, "u1")!;
  assert.equal(linkJobRow(job, null).title, "Song from a link");
  assert.equal(linkJobRow(job, null).line, "Working on it");
  const done = linkJobRow(job, { status: 2, source: { title: "Way Maker", artist: "Sinach", thumbnailUrl: "https://i.ytimg.com/b.jpg" } });
  assert.equal(done.title, "Way Maker · Sinach");
  assert.equal(done.line, "Ready — tap to open");
  assert.equal(done.state, "done");
  assert.equal(done.thumbnailUrl, "https://i.ytimg.com/b.jpg");
  assert.equal(linkJobRow(job, { status: 3 }).line, "Couldn't be written");
});
