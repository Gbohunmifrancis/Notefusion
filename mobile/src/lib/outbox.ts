import { useEffect, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AxiosError } from "axios";
import { transcriptionsApi, type SubmitOptions } from "../api/endpoints";
import { safeReason, toApiError } from "../api/client";
import { dirAt, keepAudio, removeDir, removeUri } from "./blobStore";
import { probeApi } from "./connectivity";
import { dataSaverOn } from "./dataSaver";
import { outboxTickMs } from "./dataPolicy";
import { onReachability } from "./reachability";
import {
  awaitingJobs,
  classifySendFailure,
  newQueuedSend,
  nextDue,
  pendingCount,
  recover,
  transition,
  type QueuedSend,
  type SendEvent,
} from "./sendQueue";
import { logAnalyticsEvent } from "./analytics";

/**
 * Record now, send later. A take that could not be sent (no connection, or the upload failed for
 * want of one) is moved into the app's own storage and queued here, persisted in AsyncStorage, and
 * shown in the Library as "Waiting to send" with retry and delete. The runner (`useOutboxRunner`,
 * mounted with the signed-in app) sends one at a time: when the app comes forward, when the API is
 * heard from again, and on a timer (30 s, a minute on data saver) under each take's backoff. Once
 * sent it follows the job like any other — the completion push still comes — and a finished one
 * opens from the Library.
 *
 * The server decides every quota at send time; a refusal keeps the audio with the server's plain
 * sentence. Song links are never queued: they need the network to be fetched at all.
 */

const KEY = "nf.outbox";
let items: QueuedSend[] = [];
let userId: string | null = null;
let loaded = false;
const listeners = new Set<(items: QueuedSend[]) => void>();

function audioDir(id = userId!) {
  return dirAt("outbox", id);
}

function save(): void {
  for (const fn of listeners) fn(items);
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => undefined);
}

function update(id: string, ev: SendEvent): QueuedSend | null {
  let changed: QueuedSend | null = null;
  items = items.map((i) => {
    if (i.id !== id) return i;
    changed = transition(i, ev);
    return changed;
  });
  save();
  return changed;
}

/** Loads this account's queue. Another account's takes are deleted: they are not this person's to send. */
export async function bindOutbox(id: string | null): Promise<void> {
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
  items = recover(stored.filter((i) => i.userId === id));
  loaded = true;
  save();
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

/**
 * Keeps a take that could not be sent and queues it. The audio is moved out of the OS cache into
 * app storage. Returns false when it could not be kept (no account, no space), so the caller can
 * keep offering its own retry instead.
 */
export function enqueueTake(take: { fileUri: string; fileName: string; opts: SubmitOptions; afterFailedSend: boolean }): boolean {
  if (!userId || !loaded) return false;
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const ext = take.fileName.includes(".") ? take.fileName.slice(take.fileName.lastIndexOf(".")) : ".m4a";
  const kept = keepAudio(take.fileUri, audioDir(), `${id}${ext}`);
  if (!kept) return false;
  items = [
    ...items,
    newQueuedSend({ id, userId, fileUri: kept.uri, fileName: take.fileName, bytes: kept.bytes, opts: take.opts, now: Date.now(), afterFailedSend: take.afterFailedSend }),
  ];
  save();
  void logAnalyticsEvent("take_queued_offline", { mode: take.opts.mode, kb: Math.round(kept.bytes / 1024) });
  return true;
}

/** "Try again" on a waiting, refused or failed take: sends now if the API can be reached. */
export function retryTake(id: string): void {
  update(id, { type: "retry", now: Date.now() });
  void logAnalyticsEvent("take_retry");
  void pump({ force: true });
}

/** Deletes a take and its audio (cancel, or after a finished one was opened). */
export function removeTake(id: string): void {
  const item = items.find((i) => i.id === id);
  if (item) removeUri(item.fileUri);
  items = items.filter((i) => i.id !== id);
  save();
}

export function outboxItems(): QueuedSend[] {
  return items;
}

/** Takes still holding audio: what sign-out would delete. */
export function outboxPending(): number {
  return pendingCount(items);
}

let pumping: Promise<void> | null = null;

/**
 * Sends what is due, one take at a time, then re-reads the jobs already sent. Probes the API first
 * so an offline phone does not start an upload it cannot finish.
 */
export function pump(opts: { force?: boolean } = {}): Promise<void> {
  if (pumping) return pumping;
  // Cleared by `.finally`, after this assignment (see syncOfflineLibrary).
  pumping = (async () => {
    if (!userId || !loaded || items.length === 0) return;
    const hasWork = nextDue(items, Date.now(), opts) || awaitingJobs(items).length > 0;
    if (!hasWork) return;
    if (!(await probeApi())) return;
    for (;;) {
      const due = nextDue(items, Date.now(), opts);
      if (!due) break;
      const ok = await sendOne(due);
      if (!ok) break; // the network went: the rest wait their turn
    }
    await followJobs();
  })().finally(() => {
    pumping = null;
  });
  return pumping;
}

async function sendOne(take: QueuedSend): Promise<boolean> {
  update(take.id, { type: "attempt", now: Date.now() });
  try {
    const res = await transcriptionsApi.submit(take.fileUri, take.fileName, take.opts as SubmitOptions);
    const jobId = res?.jobId;
    if (!jobId) throw new Error("no job id");
    update(take.id, { type: "sent", jobId, now: Date.now() });
    void logAnalyticsEvent("take_sent_later", { attempts: take.attempts });
    return true;
  } catch (e) {
    const err = toApiError(e);
    const status = (e as AxiosError)?.response?.status ?? 0;
    if (classifySendFailure(err.code, status) === "network") {
      update(take.id, { type: "network_error", now: Date.now() });
      return false;
    }
    update(take.id, { type: "refused", code: err.code, message: err.message });
    void logAnalyticsEvent("take_refused", { code: err.code });
    return true;
  }
}

/** Re-reads sent jobs; the completion push and the Library's row both follow from this. */
async function followJobs(): Promise<void> {
  for (const take of awaitingJobs(items)) {
    try {
      const job = await transcriptionsApi.getJob(take.jobId!);
      const status = String(job.status).toLowerCase();
      if ((status === "done" || status === "2") && job.result) update(take.id, { type: "job_done" });
      else if (status === "failed" || status === "3") {
        update(take.id, { type: "job_failed", message: safeReason(job.error, "That recording didn't finish. Try again or delete it.") });
      }
    } catch (e) {
      const status = (e as AxiosError)?.response?.status;
      // Lost in a restart: the server closed it uncharged, so sending again is free.
      if (status === 404) update(take.id, { type: "job_failed", message: "That recording was lost on our side. Try again — it costs nothing." });
      else return; // offline again
    }
  }
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
