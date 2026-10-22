/**
 * Record now, send later — and never lose a take: the state machine behind every recording on its way
 * to the server. Pure; `outbox.ts` keeps the queue on disk, moves the audio into app storage, and runs it.
 *
 *   held ─retry─▶ waiting ──attempt──▶ sending ──sent──▶ sent ──job_done──▶ done        (audio deleted)
 *     │             ▲  ▲                 │  │  │           │
 *     │             │  └─network_error───┘  │  │           ├─job_failed (ours, < 2 re-sends)─▶ waiting (at once)
 *     │             └──server_error (< 2)───┘  │           └─job_failed (the recording's) ──▶ failed
 *     └─refused─▶ refused ◀────refused─────────┘                                (the server's sentence)
 *   held / waiting / failed / refused ──retry──▶ waiting (now)        sent ──resend──▶ waiting (now)
 *
 * Every take is written here before it is sent (write-ahead): a mic take is `held` from the moment it
 * stops until the person says what it is, a file the moment it is chosen. The audio stays on the phone
 * until its job is done, so a job the server loses can be sent again.
 *
 * A network failure is never a refusal: the request got no answer, so the take waits and is tried again
 * on a backoff (30 s doubling to 15 min, for as long as the phone is offline) or at once when the app
 * comes forward. Every send carries an Idempotency-Key (`sendKey`): the take's own id, so a send that reached
 * the server but lost its answer is handed the same job, never a second one or a second charge. What was our
 * fault — a job the service lost (`errorCode: "JOB_LOST"`) or never answered, or a 5xx answer to the upload —
 * is sent again by itself, at most `MAX_AUTO_RESENDS` times per take: a lost job at once, a 5xx on the
 * backoff. A lost job is never charged (the API charges a job only when it finishes), so that costs nothing.
 * A failure about the recording itself, or a refusal (the free three used up, a file the server will not
 * read), keeps the audio and waits for the person: Try again or Delete. The server enforces every quota at
 * send time; nothing here guesses.
 */

export type SendStatus = "held" | "waiting" | "sending" | "sent" | "done" | "failed" | "refused";

/** The submit options a take carries (`SubmitOptions` in api/endpoints, kept loose to stay pure). */
export interface QueuedOptions {
  mode: "melody" | "poly" | "choir" | "chords";
  key?: string;
  tempo?: number;
  timeSignature?: string;
  separate?: boolean;
  keyboardTranspose?: number;
  /** Listen from anywhere's melody takes: no voice in it means read it as chords (mirrors `SubmitOptions`). */
  noVoiceAsChords?: boolean;
}

export interface QueuedSend {
  /** Local id; the server's job id is `jobId`, once sent. */
  id: string;
  /** The account that recorded it: another account never sends it. */
  userId: string;
  /** The audio, in the app's own storage (never the OS cache, which can be cleared under us). */
  fileUri: string;
  fileName: string;
  bytes: number;
  opts: QueuedOptions;
  createdAt: number;
  status: SendStatus;
  /** Failed network attempts since it was queued or retried by hand. */
  attempts: number;
  /** When the automatic sender may try again. */
  nextAttemptAt: number;
  jobId: string | null;
  /**
   * The server's plain sentence for a refusal or a failed job; on a take waiting to be sent again after
   * our failure, the line that says so.
   */
  message: string | null;
  code: string | null;
  /** Automatic re-sends spent on our failures (a 5xx, a lost or unanswered job); at most `MAX_AUTO_RESENDS`. */
  resends: number;
  /** When its current job was sent: the clock behind `NEVER_ANSWERED_MS`. */
  sentAt: number | null;
  /**
   * Jobs this take has left behind (a lost or failed one, or a "Try again" past a long wait): each new job is
   * sent under a new Idempotency-Key (`sendKey`), since the old key would be handed the old job back.
   */
  gen: number;
  /** The library sheet its finished job was filed as; null until done, and from a server that does not file. */
  savedId: string | null;
}

export type SendEvent =
  | { type: "attempt"; now: number }
  | { type: "sent"; jobId: string; now: number }
  | { type: "network_error"; now: number }
  /** The upload got an answer that blames the server (a 5xx that is not a gateway's). */
  | { type: "server_error"; code: string; message: string; now: number }
  /** The server's refusal; a held take kept back instead carries the answer it was given (`opts`), for Try again. */
  | { type: "refused"; code: string; message: string; opts?: QueuedOptions }
  | { type: "job_done"; savedId?: string | null }
  /** `ours`: the service lost the job or never answered (`jobOutcome`); otherwise it is about the recording. */
  | { type: "job_failed"; message: string; ours: boolean; now: number }
  /** By hand ("Try again", "Send now"), or a held take released once the person answered (with its options). */
  | { type: "retry"; now: number; opts?: QueuedOptions }
  /** By hand, past a job that is taking too long: a fresh job for the same take. */
  | { type: "resend"; now: number };

export const FIRST_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

/** Automatic re-sends per take for our failures (board 13: up to twice); the person can always try again by hand. */
export const MAX_AUTO_RESENDS = 2;

/** The API's stable code for a job the transcription service lost or never answered (`TranscriptionJob.LostCode`). */
export const JOB_LOST = "JOB_LOST";

/**
 * A sent job the API still reports as queued or running this long after it was sent was never answered.
 * The API's sweep closes such a job uncharged at `TrialUsage.HeldFor` (4 h, checked every 5 min) and a
 * result that arrives after that is free, so a re-send after 4.5 h is charged at most once.
 */
export const NEVER_ANSWERED_MS = 4.5 * 60 * 60_000;

/** The line under a take that is being sent again after our failure. */
export const RESEND_LINE = "Sending it again — it didn't finish on our side";
/** A lost or unanswered job past the automatic re-sends. */
export const LOST_LINE = "That recording was lost on our side. Try again — it costs nothing.";
/** The audio is no longer on the phone: nothing can be sent. */
export const AUDIO_GONE_LINE = "This recording is no longer on this phone. Delete it and record it again.";

/** Wait after the n-th failed attempt in a row: 30 s, 1, 2, 4, 8 min, then 15 min. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, FIRST_BACKOFF_MS * 2 ** (attempts - 1));
}

export function newQueuedSend(x: {
  id: string;
  userId: string;
  fileUri: string;
  fileName: string;
  bytes: number;
  opts: QueuedOptions;
  now: number;
  /** Why it was queued: a send that already failed for want of a network starts one attempt in. */
  afterFailedSend?: boolean;
  /** A mic take written ahead while the person is still asked what it is: not sent until released. */
  held?: boolean;
}): QueuedSend {
  const attempts = x.afterFailedSend ? 1 : 0;
  return {
    id: x.id,
    userId: x.userId,
    fileUri: x.fileUri,
    fileName: x.fileName,
    bytes: x.bytes,
    opts: x.opts,
    createdAt: x.now,
    status: x.held ? "held" : "waiting",
    attempts,
    nextAttemptAt: x.now + backoffMs(attempts),
    jobId: null,
    message: null,
    code: null,
    resends: 0,
    sentAt: null,
    gen: 0,
    savedId: null,
  };
}

/**
 * The Idempotency-Key a send of this take carries: its own id while it has started no job, then one per job it
 * left behind. Re-sending after no answer is the same key (the server hands the same job back); a job lost or
 * failed is a new key (a fresh job).
 */
export function sendKey(item: QueuedSend): string {
  return item.gen > 0 ? `${item.id}.${item.gen}` : item.id;
}

/**
 * Our failure: back to waiting for another automatic send — a lost job at once, a 5xx after the backoff — or,
 * the re-sends spent, left for the person with the audio kept.
 */
function ourFailure(
  item: QueuedSend,
  now: number,
  gaveUp: "failed" | "refused",
  message: string,
  code: string | null,
  atOnce: boolean,
): QueuedSend {
  if (item.resends >= MAX_AUTO_RESENDS) return { ...item, status: gaveUp, message, code, sentAt: null };
  const resends = item.resends + 1;
  return {
    ...item,
    status: "waiting",
    resends,
    nextAttemptAt: atOnce ? now : now + backoffMs(resends),
    jobId: null,
    sentAt: null,
    message: RESEND_LINE,
    code: null,
  };
}

/** The next state; an event that does not apply to the current one changes nothing. */
export function transition(item: QueuedSend, ev: SendEvent): QueuedSend {
  switch (ev.type) {
    case "attempt":
      return item.status === "waiting" ? { ...item, status: "sending" } : item;
    case "sent":
      return item.status === "sending"
        ? { ...item, status: "sent", jobId: ev.jobId, sentAt: ev.now, attempts: 0, message: null, code: null }
        : item;
    case "network_error": {
      if (item.status !== "sending") return item;
      const attempts = item.attempts + 1;
      return { ...item, status: "waiting", attempts, nextAttemptAt: ev.now + backoffMs(attempts) };
    }
    case "server_error":
      return item.status === "sending" ? ourFailure(item, ev.now, "refused", ev.message, ev.code, false) : item;
    case "refused":
      return item.status === "sending" || item.status === "held"
        ? { ...item, status: "refused", code: ev.code, message: ev.message, opts: ev.opts ?? item.opts }
        : item;
    case "job_done":
      return item.status === "sent" ? { ...item, status: "done", message: null, code: null, savedId: ev.savedId ?? null } : item;
    case "job_failed": {
      if (item.status !== "sent") return item;
      // The job is behind it either way: the next send is a new job, under a new key.
      const next = { ...item, gen: item.gen + 1 };
      return ev.ours
        ? ourFailure(next, ev.now, "failed", ev.message, null, true)
        : { ...next, status: "failed", message: ev.message, sentAt: null };
    }
    case "retry":
      return item.status === "held" || item.status === "waiting" || item.status === "failed" || item.status === "refused"
        ? {
            ...item,
            opts: ev.opts ?? item.opts,
            status: "waiting",
            attempts: 0,
            nextAttemptAt: ev.now,
            jobId: null,
            sentAt: null,
            message: null,
            code: null,
          }
        : item;
    case "resend":
      return item.status === "sent"
        ? { ...item, status: "waiting", attempts: 0, nextAttemptAt: ev.now, jobId: null, sentAt: null, gen: item.gen + 1 }
        : item;
  }
}

/**
 * A queue read back from disk. A send the app died during is waiting again (it may have reached the
 * server: its Idempotency-Key hands it the same job). A take the person was still being asked about is
 * sent with the answer it was held with (the one they gave last time). Entries written before a field
 * existed get it.
 */
export function recover(items: readonly QueuedSend[]): QueuedSend[] {
  return items.map((i) => {
    const filled: QueuedSend = {
      ...i,
      resends: i.resends ?? 0,
      sentAt: i.sentAt ?? (i.status === "sent" ? i.createdAt : null),
      gen: i.gen ?? 0,
      savedId: i.savedId ?? null,
    };
    return filled.status === "sending" || filled.status === "held" ? { ...filled, status: "waiting" as const } : filled;
  });
}

/**
 * The queue at launch, from the list kept in AsyncStorage and each take's own record kept beside its audio
 * (written before the take is moved there and on every change, so it is never behind the list). The record
 * wins; one missing from the list (the app died before the list was written) is back. A take that has no
 * audio left and was never sent has nothing to send and is dropped; a sent or finished one stays, since its
 * job is on the server. Then `recover`. Records keep the list's order, oldest first.
 */
export function reconcile(
  listed: readonly QueuedSend[],
  records: readonly QueuedSend[],
  hasAudio: (item: QueuedSend) => boolean,
): QueuedSend[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const merged: QueuedSend[] = listed.map((l) => byId.get(l.id) ?? l);
  const known = new Set(merged.map((m) => m.id));
  for (const r of records) if (!known.has(r.id)) merged.push(r);
  const kept = merged.filter((i) => i.status === "done" || !!i.jobId || hasAudio(i));
  return recover(kept.sort((a, b) => a.createdAt - b.createdAt));
}

/** The next take to send: the one asked for first (`first`), then the oldest due. One at a time, a slow uplink is not shared. */
export function nextDue(
  items: readonly QueuedSend[],
  now: number,
  opts: { force?: boolean; first?: string } = {},
): QueuedSend | null {
  if (items.some((i) => i.status === "sending")) return null;
  const first = opts.first ? items.find((i) => i.id === opts.first && i.status === "waiting") : undefined;
  if (first) return first;
  const due = items
    .filter((i) => i.status === "waiting" && (opts.force || i.nextAttemptAt <= now))
    .sort((a, b) => a.createdAt - b.createdAt);
  return due[0] ?? null;
}

/** Sent takes whose job the queue still follows. */
export function awaitingJobs(items: readonly QueuedSend[]): QueuedSend[] {
  return items.filter((i) => i.status === "sent" && i.jobId);
}

/**
 * Whether the queue has anything its timer could move on: a take to send (now or after its backoff), one being
 * sent, or a sent one whose job has not ended. Held, refused and failed takes wait for the person, and finished
 * ones for nothing: with only those, the runner sets no timer at all.
 */
export function hasTimedWork(items: readonly QueuedSend[]): boolean {
  return items.some((i) => i.status === "waiting" || i.status === "sending" || (i.status === "sent" && !!i.jobId));
}

/**
 * How a failed send is read. No answer, a timeout, a gateway that could not reach the API, a busy or
 * throttled API, or an expired session (the take goes once the person is signed in again) is the network:
 * wait, for as long as it takes. Another 5xx is the server's fault: sent again, a few times. Any other
 * answer is the server's verdict: show its sentence and keep the file.
 */
export function classifySendFailure(
  code: string | null | undefined,
  httpStatus: number | null | undefined,
): "network" | "server" | "refused" {
  // NETWORK_OFFLINE / NETWORK_TIMEOUT from toApiError (reachability.ts NETWORK_CODES); repeated to stay import-free.
  if (code === "NETWORK_OFFLINE" || code === "NETWORK_TIMEOUT") return "network";
  if (!httpStatus) return "network";
  if ([401, 408, 429, 502, 503, 504].includes(httpStatus)) return "network";
  if (httpStatus >= 500) return "server";
  return "refused";
}

/**
 * The fallback for a server older than `errorCode`: its words for a lost job. All three sentences share this
 * phrase (the API's `LostReason`, its poll's lost-job sentence, and the worker's own `_LOST_ERROR`).
 */
const LOST_JOB = /restart(?:ed)? while working on this/i;

/** A job the service lost: the API's code, or (an older server) its sentence. */
export function isLostJob(error: string | null | undefined, errorCode?: string | null): boolean {
  if (errorCode) return errorCode === JOB_LOST;
  return LOST_JOB.test(error ?? "");
}

/** A job envelope as `GET /api/transcriptions/jobs/{id}` returns it (status by name or number). */
export interface JobReading {
  status: unknown;
  error?: string | null;
  errorCode?: string | null;
  result?: unknown;
  savedId?: string | null;
}

/**
 * What a read of a sent take's job means, or null while it is still on its way. A job the service lost
 * (`errorCode: "JOB_LOST"`), or a failure with no reason at all (an older server's deadline), is ours;
 * anything else with a reason is the recording's. Still queued or running `NEVER_ANSWERED_MS` after it was
 * sent is never answered: ours.
 */
export function jobOutcome(job: JobReading, sentAt: number | null, now: number): SendEvent | null {
  const status = String(job.status).toLowerCase();
  if ((status === "done" || status === "2") && job.result) return { type: "job_done", savedId: job.savedId ?? null };
  if (status === "failed" || status === "3") {
    const error = (job.error ?? "").trim();
    if (isLostJob(error, job.errorCode) || (!error && !job.errorCode)) {
      return { type: "job_failed", message: LOST_LINE, ours: true, now };
    }
    return { type: "job_failed", message: error || LOST_LINE, ours: false, now };
  }
  if (sentAt !== null && now - sentAt >= NEVER_ANSWERED_MS) return { type: "job_failed", message: LOST_LINE, ours: true, now };
  return null;
}

/** "30 s", "1 min", "15 min": how long until the next automatic try. */
export function waitLabel(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.ceil(s / 60)} min`;
}

/**
 * The line under a take in the Library's "On its way" (board 13): "Sending… 62%", "Sent · writing the solfa",
 * "Waiting for a connection · next try in 30 s"; a refusal or a failure is the server's sentence.
 */
export function statusLine(item: QueuedSend, now: number = Date.now(), progress?: number | null): string {
  switch (item.status) {
    case "held":
      return "Waiting to send";
    case "waiting": {
      if (item.message) return item.message;
      if (item.attempts === 0) return "Waiting to send";
      const wait = item.nextAttemptAt - now;
      return wait > 0 ? `Waiting for a connection · next try in ${waitLabel(wait)}` : "Waiting for a connection";
    }
    case "sending":
      return typeof progress === "number" ? `Sending… ${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` : "Sending…";
    case "sent":
      return "Sent · writing the solfa";
    case "done":
      return "Ready — tap to open";
    case "failed":
      return item.message ?? "That recording didn't finish. Try again or delete it.";
    case "refused":
      return item.message ?? "It couldn't be sent. Try again later or delete it.";
  }
}

/** "Sun 18:42": when a take was recorded, on the phone's clock. */
export function recordedAt(createdAt: number): string {
  const d = new Date(createdAt);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** What a take is called in a list: "Recording" for one from the microphone, else the file's name. */
export function takeName(item: Pick<QueuedSend, "fileName">): string {
  return item.fileName.startsWith("clip-") ? "Recording" : item.fileName;
}

/** "410 KB" (repeated from hymnPack.formatBytes to stay import-free). */
function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

/**
 * The small line under the "Kept on this phone" card: "0:42 recording · 410 KB · hummed". The length is a mic
 * take's own (its file is named `clip-42s.m4a`); a file from the phone has none to show.
 */
export function takeMeta(item: Pick<QueuedSend, "fileName" | "bytes" | "opts">): string {
  const secs = /^clip-(\d+)s\./.exec(item.fileName)?.[1];
  const length = secs ? `${Math.floor(Number(secs) / 60)}:${String(Number(secs) % 60).padStart(2, "0")} recording` : null;
  const kind = item.opts.separate
    ? "song"
    : { melody: "hummed", poly: "polyphonic", choir: "choir", chords: "chords" }[item.opts.mode];
  return [length, item.bytes > 0 ? sizeLabel(item.bytes) : null, kind].filter(Boolean).join(" · ");
}

/**
 * The line a sign-out confirmation adds when recordings are not transcribed yet: they go with the account's
 * local data, and one sent but not finished could not be sent again if its job were lost.
 */
export function signOutWarning(pending: number): string {
  if (pending <= 0) return "";
  return pending === 1
    ? " One recording is still waiting to be sent or transcribed — signing out deletes it from this phone."
    : ` ${pending} recordings are still waiting to be sent or transcribed — signing out deletes them from this phone.`;
}

/** Takes still holding audio on the phone (everything but a finished one). */
export function pendingCount(items: readonly QueuedSend[]): number {
  return items.filter((i) => i.status !== "done").length;
}
