import { useEffect, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AxiosError } from "axios";
import { transcriptionsApi, type SubmitOptions } from "../api/endpoints";
import { safeReason, toApiError } from "../api/client";
import { dirAt, fileExists, fileSize, keepAudio, listDir, readText, removeDir, removeFile, removeUri, uriIn, writeText } from "./blobStore";
import { probeApi } from "./connectivity";
import { dataSaverOn } from "./dataSaver";
import { outboxTickMs } from "./dataPolicy";
import { isOffline, onReachability } from "./reachability";
import {
  AUDIO_GONE_LINE,
  LOST_LINE,
  awaitingJobs,
  classifySendFailure,
  jobOutcome,
  newQueuedSend,
  nextDue,
  pendingCount,
  reconcile,
  sendKey,
  transition,
  type JobReading,
  type QueuedOptions,
  type QueuedSend,
  type SendEvent,
} from "./sendQueue";
import { logAnalyticsEvent } from "./analytics";

/**
 * Every take, on its way to the server. The moment a take is to be sent — a mic take as it stops, a file
 * as it is chosen; never a song link, which needs the network to be fetched at all — its audio is moved out
 * of the OS cache into the app's own storage beside a record of it, and it joins this queue (persisted in
 * AsyncStorage); only then is it uploaded, by the same runner whether the phone is online or not. The
 * record screen follows its take here (`useTakeSend`); the Library shows the rest as "Waiting to send" with
 * retry and delete. The audio is kept until the take's job is done, so a job the server loses is sent again.
 *
 * The runner (`useOutboxRunner`, mounted with the signed-in app) sends one at a time: a take just recorded
 * at once (`sendTakeNow`), the rest when the app comes forward, when the API is heard from again, and on a
 * timer (30 s, a minute on data saver) under each take's backoff. Once sent it follows the job like any
 * other — the completion push still comes — and a finished one opens from the Library.
 *
 * Each take's record (`<id>.json`, beside its audio) is written synchronously before the audio is moved
 * there and on every change, so a take survives the app being killed at any step, even between two writes
 * of the AsyncStorage list (`reconcile`). The server decides every quota at send time; a refusal keeps the
 * audio with the server's plain sentence.
 */

const KEY = "nf.outbox";
let items: QueuedSend[] = [];
let userId: string | null = null;
let loaded = false;
const listeners = new Set<(items: QueuedSend[]) => void>();
const changeListeners = new Set<(before: QueuedSend, after: QueuedSend, ev: SendEvent) => void>();
const progressListeners = new Set<(id: string, fraction: number) => void>();
/** The upload of the take being sent, 0..1; gone once its send has an answer. In memory only. */
const progress = new Map<string, number>();

function audioDir(id = userId!) {
  return dirAt("outbox", id);
}

const recordName = (id: string) => `${id}.json`;

/** The take's own record, beside its audio. False when it could not be written (no room). */
function writeRecord(item: QueuedSend): boolean {
  return writeText(audioDir(item.userId), recordName(item.id), JSON.stringify(item)) > 0;
}

function removeTakeFiles(item: QueuedSend): void {
  removeFile(audioDir(item.userId), recordName(item.id));
  removeUri(item.fileUri);
}

function save(): void {
  for (const fn of listeners) fn(items);
  // Nothing bound (signed out, or still loading): the stored queue is never overwritten with an empty one.
  if (!loaded || !userId) return;
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => undefined);
}

function update(id: string, ev: SendEvent): QueuedSend | null {
  const before = items.find((i) => i.id === id);
  if (!before) return null;
  const after = transition(before, ev);
  if (after === before) return before;
  items = items.map((i) => (i.id === id ? after : i));
  if (before.status === "sending" && after.status !== "sending") progress.delete(id);
  if (after.status === "done") {
    // The transcription is in: the audio has no further use. The record goes first, so a kill in between
    // leaves a sent take that is followed again on the next launch, never one sent twice.
    removeFile(audioDir(after.userId), recordName(after.id));
    save();
    removeUri(after.fileUri);
  } else {
    writeRecord(after);
    save();
  }
  for (const fn of changeListeners) fn(before, after, ev);
  return after;
}

async function readRecords(id: string): Promise<QueuedSend[]> {
  const dir = audioDir(id);
  const out: QueuedSend[] = [];
  for (const name of listDir(dir).files.filter((n) => n.endsWith(".json"))) {
    try {
      const raw = await readText(dir, name);
      const rec = raw ? (JSON.parse(raw) as QueuedSend) : null;
      if (rec && rec.id && rec.userId === id && rec.fileUri) out.push(rec);
    } catch {
      // Half-written: the list's copy stands.
    }
  }
  return out;
}

/** Loads this account's queue. Another account's takes are deleted: they are not this person's to send. */
export async function bindOutbox(id: string | null): Promise<void> {
  // Already this account's: re-reading would release a take held while its question is open.
  if (id && id === userId && loaded) return;
  userId = id;
  loaded = false;
  if (!id) {
    items = [];
    for (const fn of listeners) fn(items);
    return;
  }
  let stored: QueuedSend[] = [];
  try {
    const raw = await AsyncStorage.getItem(KEY);
    stored = raw ? (JSON.parse(raw) as QueuedSend[]) : [];
    if (!Array.isArray(stored)) stored = [];
  } catch {
    stored = [];
  }
  for (const other of stored.filter((i) => i.userId !== id)) removeUri(other.fileUri);
  for (const dir of listDir(dirAt("outbox")).dirs.filter((d) => d !== id)) removeDir(dirAt("outbox", dir));
  const records = await readRecords(id);
  if (userId !== id) return; // another account was bound meanwhile
  items = reconcile(
    stored.filter((i) => i.userId === id),
    records,
    (i) => fileExists(i.fileUri),
  );
  loaded = true;
  save();
  // A take written ahead before the app was killed goes now, not at the runner's next tick.
  void pump({ force: true });
}

/** Sign-out: the queued recordings are deleted with the account's other local data. */
export async function clearOutbox(): Promise<void> {
  removeDir(dirAt("outbox"));
  items = [];
  userId = null;
  loaded = false;
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
  for (const fn of listeners) fn(items);
}

/** The extension the kept audio is stored under: the file's own when it is a plain one. */
function extOf(fileName: string): string {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext : ".m4a";
}

/**
 * Write-ahead: keeps a take and queues it, before anything is sent. Its record is written first, then the
 * audio is moved out of the OS cache into app storage beside it. `held` keeps a mic take back while the
 * person is still asked what it is (`releaseTake`); `afterFailedSend` queues one whose send already failed
 * for want of a network (one backoff in). Returns the take's id, or null when it could not be kept (no
 * account, no space), so the caller can send it directly instead.
 */
export function enqueueTake(take: {
  fileUri: string;
  fileName: string;
  opts: SubmitOptions;
  afterFailedSend?: boolean;
  held?: boolean;
}): string | null {
  if (!userId || !loaded) return null;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const dir = audioDir();
  const name = `${id}${extOf(take.fileName)}`;
  const entry = newQueuedSend({
    id,
    userId,
    fileUri: uriIn(dir, name),
    fileName: take.fileName,
    bytes: fileSize(take.fileUri),
    opts: take.opts,
    now: Date.now(),
    afterFailedSend: take.afterFailedSend,
    held: take.held,
  });
  if (!writeRecord(entry)) return null;
  const kept = keepAudio(take.fileUri, dir, name);
  if (!kept) {
    removeFile(dir, recordName(id));
    return null;
  }
  const item = { ...entry, fileUri: kept.uri, bytes: kept.bytes };
  writeRecord(item);
  items = [...items, item];
  save();
  return id;
}

/**
 * Makes a take ready to send now, without sending it (the caller follows it with `sendTakeNow`): a held take
 * once the person has said what it is (with the options that answer gives), or a refused or failed one again.
 */
export function releaseTake(id: string, opts?: SubmitOptions): boolean {
  return update(id, { type: "retry", now: Date.now(), opts: opts as QueuedOptions | undefined })?.status === "waiting";
}

/**
 * A held take that cannot go as the person answered (a song with nothing to pay for it): kept with the reason
 * and that answer, so Try again sends it as they asked once it can go — or Delete.
 */
export function parkTake(id: string, code: string, message: string, opts: SubmitOptions): void {
  update(id, { type: "refused", code, message, opts: opts as QueuedOptions });
}

/** "Try again" on a waiting, refused or failed take: sends now if the API can be reached. */
export function retryTake(id: string): void {
  update(id, { type: "retry", now: Date.now() });
  void logAnalyticsEvent("take_retry");
  void pump({ force: true, first: id });
}

/** "Try again" past a job that is taking too long: the same take as a fresh job (the old one still finishes). */
export function resendTake(id: string): boolean {
  return update(id, { type: "resend", now: Date.now() })?.status === "waiting";
}

/** Deletes a take and its audio (cancel, or after a finished one was opened). */
export function removeTake(id: string): void {
  const item = items.find((i) => i.id === id);
  if (item) removeTakeFiles(item);
  items = items.filter((i) => i.id !== id);
  save();
}

/** A result opened from its job (the record screen, a push, the Library): that take is finished with. */
export function takeOpened(jobId: string): void {
  const item = items.find((i) => i.jobId === jobId && (i.status === "sent" || i.status === "done"));
  if (item) removeTake(item.id);
}

export function outboxItems(): QueuedSend[] {
  return items;
}

export function takeById(id: string): QueuedSend | null {
  return items.find((i) => i.id === id) ?? null;
}

/** Takes still holding audio: what sign-out would delete. */
export function outboxPending(): number {
  return pendingCount(items);
}

/** Every change to a take, as it happens (the record screen follows its own). */
export function onTakeChange(fn: (before: QueuedSend, after: QueuedSend, ev: SendEvent) => void): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

/** The upload of the take being sent, 0..1. */
export function onSendProgress(fn: (id: string, fraction: number) => void): () => void {
  progressListeners.add(fn);
  return () => {
    progressListeners.delete(fn);
  };
}

type PumpOpts = { force?: boolean; first?: string };
let pumping: Promise<void> | null = null;
let again: PumpOpts | null = null;

/**
 * Sends what is due, one take at a time (`first` ahead of the rest), then re-reads the jobs already sent.
 * Probes the API first so an offline phone does not start an upload it cannot finish; for a take the person
 * has just sent or tapped, only when the API was last heard to be out of reach. A call while one is running
 * runs once more after it, so a take queued meanwhile is not left for the timer.
 */
export function pump(opts: PumpOpts = {}): Promise<void> {
  if (pumping) {
    again = { force: Boolean(again?.force || opts.force), first: opts.first ?? again?.first };
    return pumping.then(() => {
      if (!again) return pumping ?? undefined;
      const next = again;
      again = null;
      return pump(next);
    });
  }
  // Cleared by `.finally`, after this assignment (see syncOfflineLibrary).
  pumping = (async () => {
    if (!userId || !loaded || items.length === 0) return;
    const hasWork = nextDue(items, Date.now(), opts) || awaitingJobs(items).length > 0;
    if (!hasWork) return;
    if ((!opts.first || isOffline()) && !(await probeApi())) return;
    for (;;) {
      const due = nextDue(items, Date.now(), opts);
      if (!due) break;
      const ok = await sendOne(due);
      if (!ok) break; // the network (or the server) went: the rest wait their turn
    }
    await followJobs();
  })().finally(() => {
    pumping = null;
  });
  return pumping;
}

/** Sends this take now, ahead of the rest; resolves with the take once its own send has an answer. */
export function sendTakeNow(id: string): Promise<QueuedSend | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      off();
      resolve(takeById(id));
    };
    const off = onTakeChange((before, after) => {
      if (after.id === id && before.status === "sending" && after.status !== "sending") finish();
    });
    void pump({ first: id }).finally(finish);
  });
}

async function sendOne(take: QueuedSend): Promise<boolean> {
  update(take.id, { type: "attempt", now: Date.now() });
  if (!fileExists(take.fileUri)) {
    update(take.id, { type: "refused", code: "AUDIO_GONE", message: AUDIO_GONE_LINE });
    return true;
  }
  try {
    const res = await transcriptionsApi.submit(take.fileUri, take.fileName, take.opts as SubmitOptions, {
      onUploadProgress: (fraction) => {
        progress.set(take.id, fraction);
        for (const fn of progressListeners) fn(take.id, fraction);
      },
      idempotencyKey: sendKey(take),
    });
    const jobId = res?.jobId;
    if (!jobId) throw new Error("no job id");
    update(take.id, { type: "sent", jobId, now: Date.now() });
    if (take.attempts > 0 || take.resends > 0) void logAnalyticsEvent("take_sent_later", { attempts: take.attempts, resends: take.resends });
    return true;
  } catch (e) {
    const err = toApiError(e);
    const status = (e as AxiosError)?.response?.status ?? 0;
    const kind = classifySendFailure(err.code, status);
    if (kind === "network") {
      update(take.id, { type: "network_error", now: Date.now() });
      return false;
    }
    if (kind === "server") {
      update(take.id, { type: "server_error", code: err.code, message: err.message, now: Date.now() });
      void logAnalyticsEvent("take_server_error", { status });
      return false;
    }
    update(take.id, { type: "refused", code: err.code, message: err.message });
    void logAnalyticsEvent("take_refused", { code: err.code });
    return true;
  }
}

/**
 * Applies a read of a sent take's job — here, or the record screen's own poll: finished (and, filed in the
 * Library by the server, it leaves the queue), failed on the recording, or lost or never answered on our side
 * (sent again by itself, at once: `jobOutcome`).
 */
export function settleTake(id: string, job: JobReading): QueuedSend | null {
  const take = takeById(id);
  if (!take || take.status !== "sent") return take;
  const ev = jobOutcome(job, take.sentAt, Date.now());
  if (!ev) return take;
  if (ev.type === "job_failed") {
    void logAnalyticsEvent(ev.ours ? "take_job_lost" : "take_job_failed", { resends: take.resends });
    if (!ev.ours) ev.message = safeReason(ev.message, "That recording didn't finish. Try again or delete it.");
  }
  return afterJob(id, update(id, ev));
}

/** A job's end, applied: a finished take filed as a sheet is done with; one being sent again goes now. */
function afterJob(id: string, after: QueuedSend | null): QueuedSend | null {
  if (after?.status === "done" && after.savedId) removeTake(id);
  else if (after?.status === "waiting") void pump({ first: id });
  return after;
}

/** Re-reads sent jobs; the completion push and the Library's row both follow from this. */
async function followJobs(): Promise<void> {
  for (const take of awaitingJobs(items)) {
    try {
      settleTake(take.id, await transcriptionsApi.getJob(take.jobId!));
    } catch (e) {
      const status = (e as AxiosError)?.response?.status;
      // A job the API does not know: lost. Sending again is free.
      if (status === 404) afterJob(take.id, update(take.id, { type: "job_failed", message: LOST_LINE, ours: true, now: Date.now() }));
      else return; // offline again
    }
  }
}

/** Each take's upload progress while it is being sent, as React state (the Library's "Sending… 62%"). */
export function useSendProgress(): ReadonlyMap<string, number> {
  const [state, setState] = useState<ReadonlyMap<string, number>>(() => new Map(progress));
  useEffect(() => {
    const sync = () => setState(new Map(progress));
    const offProgress = onSendProgress(sync);
    const offChange = onTakeChange(sync);
    return () => {
      offProgress();
      offChange();
    };
  }, []);
  return state;
}

/** The queue as React state. */
export function useOutbox(): QueuedSend[] {
  const [state, setState] = useState<QueuedSend[]>(items);
  useEffect(() => {
    setState(items);
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

/**
 * Runs the queue while the signed-in app is open: at once, whenever the app comes forward (every
 * waiting take is tried, whatever its backoff), when the API is heard from again, and on a timer.
 */
export function useOutboxRunner(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void pump({ force: true });
    const appSub = AppState.addEventListener("change", (s) => {
      if (s === "active") void pump({ force: true });
    });
    const offReach = onReachability((s) => {
      if (s === "online") void pump();
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      timer = setTimeout(() => {
        if (AppState.currentState === "active") void pump();
        tick();
      }, outboxTickMs(dataSaverOn()));
    };
    tick();
    return () => {
      appSub.remove();
      offReach();
      if (timer) clearTimeout(timer);
    };
  }, [active]);
}
