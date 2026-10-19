import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOB_LOST,
  LOST_LINE,
  MAX_AUTO_RESENDS,
  MAX_BACKOFF_MS,
  NEVER_ANSWERED_MS,
  RESEND_LINE,
  awaitingJobs,
  backoffMs,
  classifySendFailure,
  hasTimedWork,
  isLostJob,
  jobOutcome,
  newQueuedSend,
  nextDue,
  pendingCount,
  reconcile,
  recordedAt,
  recover,
  sendKey,
  signOutWarning,
  statusLine,
  takeMeta,
  takeName,
  transition,
  waitLabel,
  type QueuedSend,
} from "./sendQueue.ts";

const take = (id: string, now = 0, extra: { afterFailedSend?: boolean; held?: boolean } = {}): QueuedSend =>
  newQueuedSend({ id, userId: "u", fileUri: `file:///outbox/${id}.m4a`, fileName: `${id}.m4a`, bytes: 120_000, opts: { mode: "melody" }, now, ...extra });

const sent = (id: string, jobId = `job-${id}`, now = 0): QueuedSend =>
  transition(transition(take(id, now), { type: "attempt", now }), { type: "sent", jobId, now });

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
  assert.equal(t.sentAt, 2);
  assert.deepEqual(awaitingJobs([t]).map((x) => x.id), ["a"]);
  t = transition(t, { type: "job_done" });
  assert.equal(t.status, "done");
  assert.equal(statusLine(t), "Ready — tap to open");
  assert.equal(pendingCount([t]), 0);
});

test("write-ahead: a take is queued before it is sent, and the one just sent goes first, whatever its wait", () => {
  const older = { ...take("old", 0, { afterFailedSend: true }), nextAttemptAt: 10 ** 9 };
  const fresh = take("new", 500);
  assert.equal(fresh.status, "waiting");
  assert.equal(fresh.jobId, null);
  assert.equal(pendingCount([fresh]), 1);
  assert.equal(nextDue([older, fresh], 500, { first: "new" })?.id, "new");
  // Without it, the oldest due goes first, as before.
  assert.equal(nextDue([{ ...older, nextAttemptAt: 0 }, fresh], 500)?.id, "old");
  // Asked first but already on its way: nothing jumps a send in progress.
  const sending = transition(older, { type: "attempt", now: 0 });
  assert.equal(nextDue([sending, fresh], 500, { first: "new" }), null);
});

test("a mic take held while the person is asked what it is is never sent until released, with the answer", () => {
  const held = take("h", 0, { held: true });
  assert.equal(held.status, "held");
  assert.equal(nextDue([held], 10 ** 12, { force: true }), null);
  assert.equal(nextDue([held], 10 ** 12, { first: "h" }), null);
  assert.equal(statusLine(held), "Waiting to send");
  assert.equal(pendingCount([held]), 1);
  const released = transition(held, { type: "retry", now: 7, opts: { mode: "melody", separate: true } });
  assert.equal(released.status, "waiting");
  assert.equal(released.opts.separate, true);
  assert.equal(nextDue([released], 7)?.id, "h");
});

test("a held song with nothing to pay for it is kept as the song it was said to be, or goes as a tune once asked", () => {
  const held = take("h", 0, { held: true });
  const parked = transition(held, {
    type: "refused",
    code: "BILLING_SONG_NOT_FREE",
    message: "A song needs Pro or a bought song.",
    opts: { mode: "melody", separate: true },
  });
  assert.equal(parked.status, "refused");
  assert.equal(parked.opts.separate, true);
  assert.equal(pendingCount([parked]), 1);
  // A song bought since: Try again in the Library sends it as a song.
  assert.equal(transition(parked, { type: "retry", now: 3 }).opts.separate, true);
  // "Send as a tune I sang": the answer changes as it is released.
  const tune = transition(parked, { type: "retry", now: 3, opts: { mode: "melody", separate: false } });
  assert.equal(tune.status, "waiting");
  assert.equal(tune.opts.separate, false);
  assert.equal(tune.message, null);
  // A server refusal keeps the options the take was sent with.
  const refused = transition(transition(take("s"), { type: "attempt", now: 0 }), { type: "refused", code: "X", message: "x" });
  assert.deepEqual(refused.opts, { mode: "melody" });
});

test("the audio is kept until the job is done: a sent take still holds it, and sign-out warns about it", () => {
  const t = sent("a");
  assert.equal(pendingCount([t]), 1);
  assert.equal(statusLine(t), "Sent · writing the solfa");
  const done = transition(t, { type: "job_done", savedId: "sheet-9" });
  assert.equal(pendingCount([done]), 0);
  assert.equal(done.savedId, "sheet-9", "filed in the Library: the queue lets it go");
  assert.equal(transition(t, { type: "job_done" }).savedId, null, "an older server that files nothing keeps the Ready row");
});

test("no network puts it back to waiting with a longer wait each time, for as long as it takes; nothing is lost", () => {
  let t = transition(take("a"), { type: "attempt", now: 0 });
  t = transition(t, { type: "network_error", now: 100 });
  assert.equal(t.status, "waiting");
  assert.equal(t.attempts, 1);
  assert.equal(t.nextAttemptAt, 100 + 30_000);
  t = transition(transition(t, { type: "attempt", now: 200 }), { type: "network_error", now: 200 });
  assert.equal(t.nextAttemptAt, 200 + 60_000);
  assert.equal(t.fileUri, "file:///outbox/a.m4a");
  assert.equal(statusLine(t, 200 + 30_000), "Waiting for a connection · next try in 30 s");
  assert.equal(statusLine(t, 200 + 60_000), "Waiting for a connection");
  // Offline for days: never given up on, never counted against the automatic re-sends.
  for (let i = 0; i < 50; i++) t = transition(transition(t, { type: "attempt", now: i }), { type: "network_error", now: i });
  assert.equal(t.status, "waiting");
  assert.equal(t.resends, 0);
  assert.equal(t.nextAttemptAt - 49, MAX_BACKOFF_MS);
});

test("a job the service lost is sent again by itself at once, at most twice, then waits for the person", () => {
  let t = sent("a", "job-1", 0);
  assert.equal(MAX_AUTO_RESENDS, 2);
  for (let n = 1; n <= MAX_AUTO_RESENDS; n++) {
    t = transition(t, { type: "job_failed", message: LOST_LINE, ours: true, now: 1000 });
    assert.equal(t.status, "waiting", `re-send ${n}`);
    assert.equal(t.resends, n);
    assert.equal(t.jobId, null);
    assert.equal(t.nextAttemptAt, 1000, "at once, not on the backoff");
    assert.equal(nextDue([t], 1000)?.id, "a");
    assert.equal(statusLine(t), RESEND_LINE);
    t = transition(transition(t, { type: "attempt", now: 2000 }), { type: "sent", jobId: `job-${n + 1}`, now: 2000 });
    assert.equal(t.status, "sent");
  }
  t = transition(t, { type: "job_failed", message: LOST_LINE, ours: true, now: 3000 });
  assert.equal(t.status, "failed");
  assert.equal(statusLine(t), LOST_LINE);
  assert.equal(pendingCount([t]), 1, "the audio is still kept");
  // By hand it goes again; the automatic re-sends stay spent.
  t = transition(t, { type: "retry", now: 4000 });
  assert.equal(t.status, "waiting");
  assert.equal(t.resends, MAX_AUTO_RESENDS);
});

test("each job a take starts goes under its own Idempotency-Key; a send with no answer goes again under the same", () => {
  let t = take("t7");
  assert.equal(sendKey(t), "t7");
  // No answer: the same key, so a send that reached the server is handed the same job.
  t = transition(transition(t, { type: "attempt", now: 0 }), { type: "network_error", now: 0 });
  assert.equal(sendKey(t), "t7");
  // A 5xx: the same key (the job may exist), sent again on the backoff.
  t = transition(transition(t, { type: "attempt", now: 0 }), { type: "server_error", code: "SERVER_ERROR", message: "x", now: 0 });
  assert.equal(sendKey(t), "t7");
  // The job was lost: the next send is a new job, under a new key.
  t = transition(transition(transition(t, { type: "attempt", now: 0 }), { type: "sent", jobId: "j1", now: 0 }), {
    type: "job_failed",
    message: LOST_LINE,
    ours: true,
    now: 0,
  });
  assert.equal(sendKey(t), "t7.1");
  // A failed recording tried again by hand, and a "Try again" past a long wait: new keys too.
  t = transition(transition(transition(t, { type: "attempt", now: 0 }), { type: "sent", jobId: "j2", now: 0 }), {
    type: "job_failed",
    message: "No notes.",
    ours: false,
    now: 0,
  });
  assert.equal(sendKey(transition(t, { type: "retry", now: 0 })), "t7.2");
  const resent = transition(sent("r", "j", 0), { type: "resend", now: 1 });
  assert.equal(sendKey(resent), "r.1");
});

test("a failure about the recording is not sent again by itself: it waits with the reason", () => {
  const t = transition(sent("a"), { type: "job_failed", message: "No confident notes were detected in the recording.", ours: false, now: 5 });
  assert.equal(t.status, "failed");
  assert.equal(t.resends, 0);
  assert.equal(statusLine(t), "No confident notes were detected in the recording.");
  assert.equal(nextDue([t], 10 ** 12, { force: true }), null);
});

test("a 5xx answer to the upload is sent again by itself up to the cap, then is the server's sentence", () => {
  let t = take("a");
  for (let n = 1; n <= MAX_AUTO_RESENDS; n++) {
    t = transition(transition(t, { type: "attempt", now: 0 }), { type: "server_error", code: "SERVER_ERROR", message: "Something went wrong on our side.", now: 10 });
    assert.equal(t.status, "waiting");
    assert.equal(t.resends, n);
    assert.equal(t.nextAttemptAt, 10 + backoffMs(n), "a 5xx waits its backoff");
  }
  t = transition(transition(t, { type: "attempt", now: 0 }), { type: "server_error", code: "SERVER_ERROR", message: "Something went wrong on our side.", now: 10 });
  assert.equal(t.status, "refused");
  assert.equal(statusLine(t), "Something went wrong on our side.");
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
  let t = sent("a", "j");
  t = transition(t, { type: "job_failed", message: "No clear notes detected.", ours: false, now: 0 });
  assert.equal(t.status, "failed");
  assert.equal(transition(t, { type: "job_done" }), t);
  assert.equal(transition(t, { type: "sent", jobId: "x", now: 0 }), t);
  assert.equal(transition(t, { type: "resend", now: 0 }), t);
  assert.equal(transition(t, { type: "retry", now: 9 }).status, "waiting");
  const w = take("b");
  assert.equal(transition(w, { type: "network_error", now: 0 }), w);
  assert.equal(transition(w, { type: "job_done" }), w);
  assert.equal(transition(w, { type: "job_failed", message: "x", ours: true, now: 0 }), w);
  assert.equal(transition(w, { type: "server_error", code: "X", message: "x", now: 0 }), w);
  const done = transition(sent("c"), { type: "job_done" });
  assert.equal(transition(done, { type: "retry", now: 0 }), done);
});

test("\"Try again\" past a long wait sends the take as a fresh job without spending an automatic re-send", () => {
  const t = transition(sent("a", "job-1", 0), { type: "resend", now: 720_000 });
  assert.equal(t.status, "waiting");
  assert.equal(t.jobId, null);
  assert.equal(t.resends, 0);
  assert.equal(nextDue([t], 720_000)?.id, "a");
});

test("one send at a time, oldest first, and only when due unless forced (app came forward)", () => {
  const a = { ...take("a", 0), nextAttemptAt: 50_000 };
  const b = { ...take("b", 10), nextAttemptAt: 0 };
  assert.equal(nextDue([a, b], 1000)?.id, "b");
  assert.equal(nextDue([a, b], 1000, { force: true })?.id, "a");
  const sending = transition(b, { type: "attempt", now: 1 });
  assert.equal(nextDue([a, sending], 10 ** 9), null);
});

test("recover, at each point the app can be killed", () => {
  // Asked what it is: goes with the answer it was held with.
  assert.equal(recover([take("h", 0, { held: true })])[0]!.status, "waiting");
  // Written ahead, not yet sent: waits, due at once.
  const before = recover([take("w", 5)])[0]!;
  assert.equal(before.status, "waiting");
  assert.equal(nextDue([before], 5)?.id, "w");
  // Mid-upload: waiting again.
  assert.equal(recover([transition(take("s"), { type: "attempt", now: 0 })])[0]!.status, "waiting");
  // Sent, not done: still followed, with its job and its audio.
  const after = recover([sent("x", "job-x", 7)])[0]!;
  assert.equal(after.status, "sent");
  assert.equal(after.jobId, "job-x");
  assert.equal(after.sentAt, 7);
  assert.deepEqual(awaitingJobs([after]).map((i) => i.id), ["x"]);
  // Refused, failed and done stay as they were.
  for (const status of ["refused", "failed", "done"] as const) assert.equal(recover([{ ...take("r"), status }])[0]!.status, status);
});

test("recover fills in an entry written before the automatic re-sends", () => {
  const { resends: _r, sentAt: _s, ...old } = sent("o", "job-o", 0);
  const read = recover([{ ...(old as QueuedSend), createdAt: 42 }])[0]!;
  assert.equal(read.resends, 0);
  assert.equal(read.sentAt, 42);
  const { resends: _r2, sentAt: _s2, ...oldWaiting } = take("p");
  assert.equal(recover([oldWaiting as QueuedSend])[0]!.sentAt, null);
});

test("reconcile: each take's own record wins over a list a kill left behind, and brings back one the list never got", () => {
  const listedSending = transition(take("a", 1), { type: "attempt", now: 1 });
  const recordSent = sent("a", "job-a", 1);
  const recordOnly = take("b", 2);
  const out = reconcile([listedSending], [recordSent, recordOnly], () => true);
  assert.deepEqual(out.map((i) => [i.id, i.status, i.jobId]), [
    ["a", "sent", "job-a"],
    ["b", "waiting", null],
  ]);
});

test("reconcile: a take with no audio left is dropped unless its job is on the server", () => {
  const gone = take("gone", 1);
  const sentNoAudio = sent("s", "job-s", 2);
  const done = transition(sent("d", "job-d", 3), { type: "job_done" });
  const kept = take("k", 4);
  const out = reconcile([gone, sentNoAudio, done, kept], [], (i) => i.id === "k");
  assert.deepEqual(out.map((i) => i.id), ["s", "d", "k"]);
});

test("reconcile: a held take whose list entry never landed comes back waiting, oldest first", () => {
  const out = reconcile([take("late", 9)], [take("held", 3, { held: true })], () => true);
  assert.deepEqual(out.map((i) => [i.id, i.status]), [
    ["held", "waiting"],
    ["late", "waiting"],
  ]);
});

test("signing out warns about recordings not yet transcribed", () => {
  assert.equal(signOutWarning(0), "");
  assert.match(signOutWarning(1), /One recording is still waiting/);
  assert.match(signOutWarning(3), /3 recordings are still waiting/);
});

test("no answer, a timeout, a gateway, busy or signed-out API is the network; another 5xx is ours; any other answer is the server's", () => {
  assert.equal(classifySendFailure("NETWORK_OFFLINE", 0), "network");
  assert.equal(classifySendFailure("NETWORK_TIMEOUT", null), "network");
  assert.equal(classifySendFailure("UNKNOWN", undefined), "network");
  for (const s of [401, 408, 429, 502, 503, 504]) assert.equal(classifySendFailure("SERVER_ERROR", s), "network", String(s));
  assert.equal(classifySendFailure("SERVER_ERROR", 500), "server");
  assert.equal(classifySendFailure("SERVER_ERROR", 507), "server");
  assert.equal(classifySendFailure("BILLING_FREE_TIER_LIMIT", 402), "refused");
  assert.equal(classifySendFailure("INVALID_AUDIO", 422), "refused");
  assert.equal(classifySendFailure("PAYLOAD_TOO_LARGE", 413), "refused");
});

test("the API's and the worker's words for a lost job are ours; the recording's are not", () => {
  // NotifyTranscriptionReadyCommand.LostReason
  assert.ok(isLostJob("The transcription service restarted while working on this, so it was lost. Nothing was charged — please try it again."));
  // GetTranscriptionJobQuery, a poll that finds the worker has forgotten the job
  assert.ok(isLostJob("The transcription service restarted while working on this, so the job was lost. Nothing was charged — please submit it again."));
  // The worker's _LOST_ERROR (journaled job it could not finish across restarts)
  assert.ok(isLostJob("The transcription service had to restart while working on this and could not finish it. Nothing was charged — please submit it again."));
  assert.ok(!isLostJob("No confident notes were detected in the recording. Try singing louder."));
  assert.ok(!isLostJob("That recording could not be transcribed. Try again with a clearer take."));
  assert.ok(!isLostJob("An unexpected error occurred during transcription. Please try recording again."));
  assert.ok(!isLostJob(null));
});

test("the API's code decides a lost job; its words are only the fallback for an older server", () => {
  const now = 10 ** 9;
  // The code, whatever the sentence says.
  assert.deepEqual(jobOutcome({ status: "failed", error: "Anything at all.", errorCode: JOB_LOST }, now, now), {
    type: "job_failed",
    message: LOST_LINE,
    ours: true,
    now,
  });
  assert.equal(isLostJob("Anything at all.", JOB_LOST), true);
  // Another code is not lost, even with the lost words.
  assert.equal(isLostJob("The transcription service restarted while working on this", "SOMETHING_ELSE"), false);
  // No code (an older server): the words.
  assert.equal(isLostJob("The transcription service restarted while working on this, so it was lost.", null), true);
  // A recording failure from a server that sends codes: no code, its own sentence.
  assert.deepEqual(jobOutcome({ status: "failed", error: "No confident notes were detected.", errorCode: null }, now, now), {
    type: "job_failed",
    message: "No confident notes were detected.",
    ours: false,
    now,
  });
});

test("jobOutcome: done, the recording's failure, ours (lost, no reason, never answered), or still on its way", () => {
  const now = 10 ** 9;
  assert.deepEqual(jobOutcome({ status: "done", result: {}, savedId: "s1" }, now, now), { type: "job_done", savedId: "s1" });
  assert.deepEqual(jobOutcome({ status: 2, result: {} }, now, now), { type: "job_done", savedId: null });
  const lost = jobOutcome({ status: "failed", error: "The transcription service restarted while working on this, so it was lost." }, now, now);
  assert.deepEqual(lost, { type: "job_failed", message: LOST_LINE, ours: true, now });
  assert.deepEqual(jobOutcome({ status: 3, error: null }, now, now), { type: "job_failed", message: LOST_LINE, ours: true, now });
  assert.deepEqual(jobOutcome({ status: "failed", error: "  " }, now, now), { type: "job_failed", message: LOST_LINE, ours: true, now });
  assert.deepEqual(jobOutcome({ status: "failed", error: "No confident notes were detected." }, now, now), {
    type: "job_failed",
    message: "No confident notes were detected.",
    ours: false,
    now,
  });
  // Still queued or running: waited for, until it was never answered.
  assert.equal(jobOutcome({ status: "processing" }, now, now + NEVER_ANSWERED_MS - 1), null);
  assert.equal(jobOutcome({ status: "pending" }, now, now + 60_000), null);
  assert.deepEqual(jobOutcome({ status: 1 }, now, now + NEVER_ANSWERED_MS), { type: "job_failed", message: LOST_LINE, ours: true, now: now + NEVER_ANSWERED_MS });
  // Done without a result is not a finish.
  assert.equal(jobOutcome({ status: "done", result: null }, now, now), null);
});

test("the never-answered clock waits past the API's own four-hour hold, so a re-send is charged at most once", () => {
  assert.ok(NEVER_ANSWERED_MS > 4 * 60 * 60_000 + 5 * 60_000);
});

test("the On its way lines (board 13): sending with its progress, sent, waiting with the next try", () => {
  const sending = transition(take("a"), { type: "attempt", now: 0 });
  assert.equal(statusLine(sending, 0, 0.62), "Sending… 62%");
  assert.equal(statusLine(sending, 0), "Sending…");
  assert.equal(statusLine(take("b")), "Waiting to send");
  assert.equal(statusLine(take("h", 0, { held: true })), "Waiting to send");
  assert.deepEqual([5_000, 30_000, 59_000, 60_000, 61_000, 15 * 60_000].map(waitLabel), ["5 s", "30 s", "59 s", "1 min", "2 min", "15 min"]);
});

test("a take is called Recording · Sun 18:42, or by its file; its card says how long, how big and what kind", () => {
  // Sunday 18 October 2026, 18:42 on the phone's clock.
  assert.equal(recordedAt(new Date(2026, 9, 18, 18, 42).getTime()), "Sun 18:42");
  assert.equal(recordedAt(new Date(2026, 9, 19, 7, 5).getTime()), "Mon 07:05");
  assert.equal(takeName({ fileName: "clip-42s.m4a" }), "Recording");
  assert.equal(takeName({ fileName: "Abide with me.mp3" }), "Abide with me.mp3");
  assert.equal(takeMeta({ fileName: "clip-42s.m4a", bytes: 410 * 1024, opts: { mode: "melody" } }), "0:42 recording · 410 KB · hummed");
  assert.equal(takeMeta({ fileName: "clip-125s.m4a", bytes: 2 * 1024 * 1024, opts: { mode: "melody", separate: true } }), "2:05 recording · 2.0 MB · song");
  assert.equal(takeMeta({ fileName: "anthem.wav", bytes: 0, opts: { mode: "choir" } }), "choir");
});

test("recover gives an old entry its send key and its saved sheet", () => {
  const { gen: _g, savedId: _s, ...old } = take("o");
  const read = recover([old as QueuedSend])[0]!;
  assert.equal(read.gen, 0);
  assert.equal(read.savedId, null);
  assert.equal(sendKey(read), "o");
});

test("the runner's timer runs only while a take is to be sent or a sent job is still running", () => {
  const waiting = take("w");
  const sending = transition(take("s"), { type: "attempt", now: 1 });
  const running = sent("r");
  const done = transition(sent("d"), { type: "job_done" });
  const held = take("h", 0, { held: true });
  const refused = transition(transition(take("x"), { type: "attempt", now: 1 }), { type: "refused", code: "BILLING_LIMIT", message: "No more this week." });
  assert.equal(refused.status, "refused");
  assert.equal(hasTimedWork([]), false);
  // Waiting on the person or finished: nothing for a timer to move.
  assert.equal(hasTimedWork([done, held, refused]), false);
  for (const busy of [waiting, sending, running]) assert.equal(hasTimedWork([done, busy]), true, busy.id);
});
