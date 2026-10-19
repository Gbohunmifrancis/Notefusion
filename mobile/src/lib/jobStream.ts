import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import type { AxiosError } from "axios";
import { baseURL, streamHeaders } from "../api/client";
import { transcriptionsApi } from "../api/endpoints";
import type { TranscriptionJob } from "../api/types";
import { jobFallbackPollMs } from "./dataPolicy";
import { dataSaverOn } from "./dataSaver";
import { reportReachable } from "./reachability";
import { SseParser, type SseEvent } from "./sse";
import {
  MAX_STREAM_CHARS,
  QUIET_CHECK_MS,
  WATCHDOG_MS,
  isTerminalStatus,
  reconnectDelayMs,
  shouldFallBack,
} from "./streamPolicy";

/**
 * A running job, told rather than asked. The API streams what the job is doing
 * (`GET /api/transcriptions/jobs/{id}/events`): `ready` once the phone is listening — the job is then read
 * once over HTTP for where it stands — `job` with each change of stage, place in line or progress, and
 * `ended` when it is over, after which the outcome is read once (the API answers it from its own copy). A
 * ping every 20 s keeps the connection honest. This replaced reading the job every 2.5 s and a SignalR
 * socket held open for the whole session: the radio now wakes for what changed, and not at all in between.
 *
 * Only while the app is in front. In the background the stream is closed and the server, finding nobody
 * listening when the job ends, sends the push; a stream that did hear `ended` means no push (they are
 * looking at it), as a poll that saw the job done used to. Coming forward opens it again and reads the job.
 *
 * Several screens may follow one job (the record screen's take and the send queue): they share one stream.
 * A stream that keeps failing is reopened on a backoff (`streamPolicy.ts`), and after three in a row the job
 * is also read on a timer (`jobFallbackPollMs`) until one holds. A server without the stream (404 while the
 * job itself reads fine) is read on that timer only.
 */

export interface JobWatcher {
  /** A reading of the job: an HTTP answer (with its result once it has ended), or a `job` event (no result yet). */
  onJob(job: TranscriptionJob): void;
  /** An HTTP read of the job failed (no answer, a 5xx, a 404): what a failed poll used to be. */
  onReadFailed?(error: unknown): void;
  /** Whether the stream could be reached: false for each attempt that got no answer, true once one is listening. */
  onLink?(up: boolean): void;
}

type Timer = ReturnType<typeof setTimeout>;

interface Watch {
  jobId: string;
  watchers: Set<JobWatcher>;
  /** The last reading, handed to a screen that starts following the job part-way. */
  last: TranscriptionJob | null;
  xhr: XMLHttpRequest | null;
  parser: SseParser;
  /** How much of the stream's `responseText` has been fed to the parser. */
  seen: number;
  /** The current stream said `ready`. */
  listening: boolean;
  /** The current stream said `ended`: its outcome is being read, and the stream is not reopened. */
  endSeen: boolean;
  /** Streams that failed in a row. */
  failures: number;
  /** The server has no stream for this job (an older API): it is read on the timer only. */
  noStream: boolean;
  /** A terminal reading was handed out: the watch is over. */
  ended: boolean;
  reading: boolean;
  readAgain: boolean;
  reconnectTimer: Timer | null;
  watchdogTimer: Timer | null;
  quietTimer: Timer | null;
  fallbackTimer: Timer | null;
}

const watches = new Map<string, Watch>();
const endedListeners = new Set<(jobId: string) => void>();
let appStateSub: NativeEventSubscription | null = null;

/**
 * Follows a job until it ends or `stop` is called (the last screen to stop closes the stream). Readings arrive
 * through `watcher.onJob`; the last one is handed over at once to a screen joining part-way.
 */
export function watchJob(jobId: string, watcher: JobWatcher): () => void {
  let w = watches.get(jobId);
  if (!w) {
    w = newWatch(jobId);
    watches.set(jobId, w);
    w.watchers.add(watcher);
    listenToAppState();
    if (AppState.currentState === "active") resume(w);
  } else {
    w.watchers.add(watcher);
    const last = w.last;
    const joined = w;
    if (last) setTimeout(() => joined.watchers.has(watcher) && watcher.onJob(last), 0);
  }
  const watch = w;
  return () => {
    if (!watch.watchers.delete(watcher) || watch.watchers.size > 0) return;
    if (watches.get(watch.jobId) === watch) close(watch);
  };
}

/** Every job a watch saw end (the send queue settles its takes from it). */
export function onJobEnded(fn: (jobId: string) => void): () => void {
  endedListeners.add(fn);
  return () => {
    endedListeners.delete(fn);
  };
}

/** Whether a screen is following this job live, so the send queue need not read it too. */
export function isJobWatched(jobId: string): boolean {
  return watches.has(jobId);
}

function newWatch(jobId: string): Watch {
  return {
    jobId,
    watchers: new Set(),
    last: null,
    xhr: null,
    parser: new SseParser(),
    seen: 0,
    listening: false,
    endSeen: false,
    failures: 0,
    noStream: false,
    ended: false,
    reading: false,
    readAgain: false,
    reconnectTimer: null,
    watchdogTimer: null,
    quietTimer: null,
    fallbackTimer: null,
  };
}

const isLive = (w: Watch) => !w.ended && watches.get(w.jobId) === w;
const inFront = () => AppState.currentState === "active";

function listenToAppState(): void {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
    for (const w of [...watches.values()]) {
      if (next === "active") resume(w);
      else pause(w);
    }
  });
}

function stopListeningToAppState(): void {
  if (watches.size > 0 || !appStateSub) return;
  appStateSub.remove();
  appStateSub = null;
}

/** Coming forward (or starting): listen again, and read the job once listening. */
function resume(w: Watch): void {
  if (!isLive(w)) return;
  if (w.noStream) {
    startFallback(w); // reads at once, then on the timer
  } else {
    void open(w);
  }
}

/** Going behind: nothing is open and nothing is timed; the server pushes the end. */
function pause(w: Watch): void {
  closeStream(w);
  clearTimers(w);
}

function clearTimers(w: Watch): void {
  for (const key of ["reconnectTimer", "watchdogTimer", "quietTimer", "fallbackTimer"] as const) {
    const t = w[key];
    if (t) clearTimeout(t);
    w[key] = null;
  }
}

/** The last screen stopped following it: closed, not ended. */
function close(w: Watch): void {
  closeStream(w);
  clearTimers(w);
  watches.delete(w.jobId);
  stopListeningToAppState();
}

/** A terminal reading went out: the watch is over, and anyone keeping count is told. */
function end(w: Watch): void {
  w.ended = true;
  closeStream(w);
  clearTimers(w);
  if (watches.get(w.jobId) === w) watches.delete(w.jobId);
  stopListeningToAppState();
  for (const fn of [...endedListeners]) fn(w.jobId);
}

function closeStream(w: Watch): void {
  const xhr = w.xhr;
  w.xhr = null;
  w.listening = false;
  if (w.watchdogTimer) clearTimeout(w.watchdogTimer);
  w.watchdogTimer = null;
  if (!xhr) return;
  xhr.onreadystatechange = null;
  xhr.onprogress = null;
  try {
    xhr.abort();
  } catch {
    // Already finished.
  }
}

async function open(w: Watch): Promise<void> {
  closeStream(w);
  if (w.reconnectTimer) clearTimeout(w.reconnectTimer);
  w.reconnectTimer = null;
  if (!isLive(w) || !inFront()) return;
  let headers: Record<string, string>;
  try {
    headers = await streamHeaders();
  } catch {
    headers = {};
  }
  // Closed, paused or already reopened while the headers were read.
  if (!isLive(w) || !inFront() || w.xhr || w.reconnectTimer) return;

  const xhr = new XMLHttpRequest();
  w.xhr = xhr;
  w.parser = new SseParser();
  w.seen = 0;
  w.endSeen = false;
  xhr.open("GET", `${baseURL}/api/transcriptions/jobs/${encodeURIComponent(w.jobId)}/events`);
  for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
  xhr.setRequestHeader("Accept", "text/event-stream");
  xhr.setRequestHeader("Cache-Control", "no-cache");

  const consume = () => {
    if (w.xhr !== xhr || xhr.readyState < 3 || xhr.status !== 200) return;
    const text = xhr.responseText ?? "";
    if (text.length <= w.seen) return;
    const chunk = text.slice(w.seen);
    w.seen = text.length;
    armWatchdog(w, xhr);
    for (const ev of w.parser.feed(chunk)) {
      if (w.xhr !== xhr) return; // the event closed this stream (`ended`)
      handle(w, ev);
    }
    // XMLHttpRequest keeps everything it was sent; a long-lived stream is opened afresh before that grows.
    if (w.xhr === xhr && w.seen > MAX_STREAM_CHARS) void open(w);
  };
  // Both set, so React Native delivers the body as it arrives rather than at the end.
  xhr.onprogress = consume;
  xhr.onreadystatechange = () => {
    consume();
    if (xhr.readyState === 4) finished(w, xhr);
  };
  armWatchdog(w, xhr);
  xhr.send();
}

function handle(w: Watch, ev: SseEvent): void {
  switch (ev.event) {
    case "ready":
      w.listening = true;
      w.failures = 0;
      reportReachable(true);
      tellLink(w, true);
      stopFallback(w);
      void read(w);
      return;
    case "job": {
      let job: TranscriptionJob | null = null;
      try {
        job = JSON.parse(ev.data) as TranscriptionJob;
      } catch {
        return;
      }
      if (!job || typeof job !== "object") return;
      // A reading that says it is over carries no result: read the outcome as `ended` would.
      if (isTerminalStatus(job.status)) {
        heardEnd(w);
        return;
      }
      armQuiet(w);
      deliver(w, { ...job, jobId: job.jobId ?? w.jobId });
      return;
    }
    case "ended":
      heardEnd(w);
      return;
  }
}

/** The server said it is over: the outcome is read, and the stream is let go (the server closes it too). */
function heardEnd(w: Watch): void {
  closeStream(w);
  w.endSeen = true;
  void read(w);
}

function finished(w: Watch, xhr: XMLHttpRequest): void {
  if (w.xhr !== xhr) return; // closed here on purpose
  w.xhr = null;
  w.listening = false;
  if (w.watchdogTimer) clearTimeout(w.watchdogTimer);
  w.watchdogTimer = null;
  if (!isLive(w) || !inFront() || w.endSeen) return;
  const status = xhr.status;
  if (status === 200) {
    // A stream that was listening and was closed by the server (it limits each to ten minutes): open it again.
    if (xhr.responseText && xhr.responseText.length > 0) {
      w.failures = 0;
      void open(w);
    } else {
      failed(w);
    }
    return;
  }
  if (status === 401) {
    // The access token ran out. The HTTP read goes through the API client, which refreshes it; then reopen.
    void read(w);
    failed(w);
    return;
  }
  if (status === 404) {
    // Not this account's job, or a server without the stream. The read says which: a job that reads fine is
    // followed on the timer; one that does not is the watcher's to judge (`onReadFailed`).
    w.noStream = true;
    startFallback(w); // reads at once, then on the timer
    return;
  }
  if (status === 0) {
    reportReachable(false);
    tellLink(w, false);
  }
  failed(w);
}

/** One more stream failed in a row: reopened on the backoff, and read on a timer once three have. */
function failed(w: Watch): void {
  w.failures += 1;
  if (shouldFallBack(w.failures)) startFallback(w);
  if (w.reconnectTimer) clearTimeout(w.reconnectTimer);
  w.reconnectTimer = setTimeout(() => {
    w.reconnectTimer = null;
    if (isLive(w) && inFront()) void open(w);
  }, reconnectDelayMs(w.failures));
}

function armWatchdog(w: Watch, xhr: XMLHttpRequest): void {
  if (w.watchdogTimer) clearTimeout(w.watchdogTimer);
  w.watchdogTimer = setTimeout(() => {
    w.watchdogTimer = null;
    if (w.xhr !== xhr) return;
    // Silence past two missed pings: the connection is gone without saying so.
    closeStream(w);
    if (isLive(w) && inFront()) failed(w);
  }, WATCHDOG_MS);
}

function armQuiet(w: Watch): void {
  if (w.quietTimer) clearTimeout(w.quietTimer);
  w.quietTimer = setTimeout(() => {
    w.quietTimer = null;
    // Nothing heard about a running job for a while: read it once, in case its end was missed.
    if (isLive(w) && inFront()) void read(w);
  }, QUIET_CHECK_MS);
}

function startFallback(w: Watch): void {
  if (w.fallbackTimer || !isLive(w) || !inFront()) return;
  void read(w);
  const loop = () => {
    w.fallbackTimer = setTimeout(async () => {
      w.fallbackTimer = null;
      if (!isLive(w) || !inFront() || (!w.noStream && !shouldFallBack(w.failures))) return;
      await read(w);
      if (isLive(w) && inFront() && !w.fallbackTimer) loop();
    }, jobFallbackPollMs(dataSaverOn()));
  };
  loop();
}

function stopFallback(w: Watch): void {
  if (w.fallbackTimer) clearTimeout(w.fallbackTimer);
  w.fallbackTimer = null;
}

/** Reads the job over HTTP once; a read asked for while one is running runs once more after it. */
async function read(w: Watch): Promise<void> {
  if (w.reading) {
    w.readAgain = true;
    return;
  }
  w.reading = true;
  try {
    do {
      w.readAgain = false;
      let job: TranscriptionJob;
      try {
        job = await transcriptionsApi.getJob(w.jobId);
      } catch (e) {
        if (!isLive(w)) return;
        for (const x of [...w.watchers]) x.onReadFailed?.(e);
        // An end heard but not yet read: ask again once the network allows (the stream says `ended` at once).
        if (w.endSeen && (e as AxiosError)?.response?.status !== 404) {
          w.endSeen = false;
          failed(w);
        }
        continue;
      }
      if (!isLive(w)) return;
      tellLink(w, true);
      armQuiet(w);
      deliver(w, job);
      if (!isLive(w)) return;
      // `ended` was heard but the job reads as running (the two crossed, or the API closed a job the worker still
      // has): listen again on the backoff, never at once, so a stream that keeps saying `ended` cannot spin.
      if (w.endSeen) {
        w.endSeen = false;
        if (!w.noStream && inFront()) failed(w);
      }
    } while (w.readAgain && isLive(w));
  } finally {
    w.reading = false;
  }
}

function deliver(w: Watch, job: TranscriptionJob): void {
  w.last = job;
  for (const x of [...w.watchers]) x.onJob(job);
  if (isTerminalStatus(job.status) && isLive(w)) end(w);
}

function tellLink(w: Watch, up: boolean): void {
  for (const x of [...w.watchers]) x.onLink?.(up);
}
