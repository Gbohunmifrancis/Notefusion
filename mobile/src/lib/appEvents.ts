import { useEffect } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import type { AxiosError } from "axios";
import * as Listen from "../../modules/notefusion-listen";
import { appApi } from "../api/endpoints";
import type { AppEventInput } from "../api/types";
import { tokenStore } from "./tokenStore";
import { formatDetail, mergeQueue, nativeToInput, type Detail } from "./appEventsQueue";

/**
 * First-party events from the phone, for the admin console (`POST /api/app/events`, read back by
 * `GET /api/admin/analytics/listen`). Today that is Listen from anywhere: what the native service did with no JS running
 * (taps, takes, reminders, how a take ended; `Listen.drainEvents`) and what Settings changed. Each event is a name and
 * flat `key=value` details: where it came from, how long, why it ended. Never audio, words or anything about the person;
 * the server ties a batch to the signed-in account by its token, as the website's own events are.
 *
 * Kept on the phone until sent (at most 300, oldest dropped first), and sent when the app comes forward, after a take is
 * handed over, and a few seconds after a setting changes. Nothing is sent signed out.
 */

const KEY = "nf.appEvents";
const BATCH = 50;

let queue: AppEventInput[] | null = null;
let flushing: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function load(): Promise<AppEventInput[]> {
  if (queue) return queue;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    queue = Array.isArray(parsed) ? (parsed as AppEventInput[]) : [];
  } catch {
    queue = [];
  }
  return queue;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue ?? []));
  } catch {
    // The next one tries again; losing a few events costs nothing but a count.
  }
}

/** Records one event now and sends it with the next batch (a few seconds from now). */
export function logAppEvent(name: string, detail?: Detail): void {
  const event: AppEventInput = { name, detail: formatDetail(detail), occurredAt: new Date().toISOString() };
  void load().then(async (q) => {
    queue = mergeQueue(q, [event]);
    await persist();
    scheduleFlush();
  });
}

function scheduleFlush(delayMs = 4_000): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushAppEvents();
  }, delayMs);
}

/** Takes what the native side logged, then sends everything kept, in batches. Never rejects; one at a time. */
export function flushAppEvents(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      const native = Listen.drainEvents().map(nativeToInput);
      let q = await load();
      if (native.length) {
        q = queue = mergeQueue(q, native);
        await persist();
      }
      if (!q.length || !(await tokenStore.getAccess())) return;
      const build = Number(Application.nativeBuildVersion ?? 0) || 0;
      while (queue && queue.length) {
        const batch = queue.slice(0, BATCH);
        try {
          await appApi.events({ build, events: batch });
        } catch (e) {
          const status = (e as AxiosError)?.response?.status ?? 0;
          // A refusal of the batch itself (bad names, too old) will be refused again: dropped. Anything else waits.
          if (status < 400 || status >= 500 || status === 401 || status === 408 || status === 429) return;
        }
        queue = queue.slice(batch.length);
        await persist();
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Sends what is kept whenever the app comes forward, while someone is signed in. */
export function useAppEventsFlush(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    void flushAppEvents();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void flushAppEvents();
    });
    return () => sub.remove();
  }, [signedIn]);
}
