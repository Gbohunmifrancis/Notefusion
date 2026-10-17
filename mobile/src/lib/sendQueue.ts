/**
 * Record now, send later: the state machine behind a recording that could not be sent. Pure;
 * `outbox.ts` keeps the queue on disk, moves the audio into app storage, and runs it.
 *
 *   waiting ──attempt──▶ sending ──sent──▶ sent ──job_done──▶ done   (open it, then it leaves)
 *      ▲                    │  │                └─job_failed─▶ failed
 *      └──network_error─────┘  └──refused──▶ refused                  (the server's sentence)
 *   failed / refused / waiting ──retry──▶ waiting (now)
 *
 * A network failure is never a refusal: the request got no answer, so the take waits and is tried
 * again on a backoff (30 s doubling to 15 min) or at once when the app comes forward. A refusal
 * (the free three used up, a file the server will not read) keeps the audio too: the person can
 * buy a song or delete it. The server enforces every quota at send time; nothing here guesses.
 */

export type SendStatus = "waiting" | "sending" | "sent" | "done" | "failed" | "refused";

/** The submit options a take carries (`SubmitOptions` in api/endpoints, kept loose to stay pure). */
export interface QueuedOptions {
  mode: "melody" | "poly" | "choir" | "chords";
  key?: string;
  tempo?: number;
  timeSignature?: string;
  separate?: boolean;
  keyboardTranspose?: number;
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
  /** The server's plain sentence for a refusal or a failed job. */
  message: string | null;
  code: string | null;
}

export type SendEvent =
  | { type: "attempt"; now: number }
  | { type: "sent"; jobId: string; now: number }
  | { type: "network_error"; now: number }
  | { type: "refused"; code: string; message: string }
  | { type: "job_done" }
  | { type: "job_failed"; message: string }
  | { type: "retry"; now: number };

export const FIRST_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

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
    status: "waiting",
    attempts,
    nextAttemptAt: x.now + backoffMs(attempts),
    jobId: null,
    message: null,
    code: null,
  };
}

/** The next state; an event that does not apply to the current one changes nothing. */
export function transition(item: QueuedSend, ev: SendEvent): QueuedSend {
  switch (ev.type) {
    case "attempt":
      return item.status === "waiting" ? { ...item, status: "sending" } : item;
    case "sent":
      return item.status === "sending" ? { ...item, status: "sent", jobId: ev.jobId, message: null, code: null } : item;
    case "network_error": {
      if (item.status !== "sending") return item;
      const attempts = item.attempts + 1;
      return { ...item, status: "waiting", attempts, nextAttemptAt: ev.now + backoffMs(attempts) };
    }
    case "refused":
      return item.status === "sending" ? { ...item, status: "refused", code: ev.code, message: ev.message } : item;
    case "job_done":
      return item.status === "sent" ? { ...item, status: "done" } : item;
    case "job_failed":
      return item.status === "sent" ? { ...item, status: "failed", message: ev.message } : item;
    case "retry":
      return item.status === "waiting" || item.status === "failed" || item.status === "refused"
        ? { ...item, status: "waiting", attempts: 0, nextAttemptAt: ev.now, jobId: null, message: null, code: null }
        : item;
  }
}

/**
 * A queue read back from disk: a send the app died during is waiting again (it may have reached the
 * server; a job the API finished without us is still in the push and the server's history).
 */
export function recover(items: readonly QueuedSend[]): QueuedSend[] {
  return items.map((i) => (i.status === "sending" ? { ...i, status: "waiting" as const } : i));
}

/** The next take to send, oldest first: one at a time, a slow uplink is not shared. */
export function nextDue(items: readonly QueuedSend[], now: number, opts: { force?: boolean } = {}): QueuedSend | null {
  if (items.some((i) => i.status === "sending")) return null;
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
 * How a failed send is read. No answer, a timeout, or a gateway that could not reach the API is the
 * network: wait. Any other answer is the server's: show its sentence and keep the file.
 */
export function classifySendFailure(code: string | null | undefined, httpStatus: number | null | undefined): "network" | "refused" {
  // NETWORK_OFFLINE / NETWORK_TIMEOUT from toApiError (reachability.ts NETWORK_CODES); repeated to stay import-free.
  if (code === "NETWORK_OFFLINE" || code === "NETWORK_TIMEOUT") return "network";
  if (!httpStatus) return "network";
  if (httpStatus === 408 || httpStatus === 429 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return "network";
  return "refused";
}

/** The line under a queued take in the library. */
export function statusLine(item: QueuedSend): string {
  switch (item.status) {
    case "waiting":
      return item.attempts > 0 ? "Waiting to send — will try again when you're online" : "Waiting to send";
    case "sending":
      return "Sending…";
    case "sent":
      return "Sent — transcribing";
    case "done":
      return "Ready — tap to open";
    case "failed":
      return item.message ?? "That recording didn't finish. Try again or delete it.";
    case "refused":
      return item.message ?? "It couldn't be sent. Try again later or delete it.";
  }
}

/** The line a sign-out confirmation adds when recordings are still waiting: they go with the account's local data. */
export function signOutWarning(pending: number): string {
  if (pending <= 0) return "";
  return pending === 1
    ? " One recording is still waiting to send — signing out deletes it from this phone."
    : ` ${pending} recordings are still waiting to send — signing out deletes them from this phone.`;
}

/** Takes still holding audio on the phone (everything but a finished one). */
export function pendingCount(items: readonly QueuedSend[]): number {
  return items.filter((i) => i.status !== "done").length;
}
