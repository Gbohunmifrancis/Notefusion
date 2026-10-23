import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import type { AxiosError } from "axios";
import * as Listen from "../../modules/notefusion-listen";
import { appApi } from "../api/endpoints";
import type { AppEventInput } from "../api/types";
import { tokenStore } from "./tokenStore";
import {
  dropsBatch,
  makeEvent,
  mergeQueue,
  nativeToInput,
  readKept,
  retryDelay,
  withoutSent,
  type Detail,
} from "./appEventsQueue";

/**
 * First-party events from the phone, for the admin console (`POST /api/app/events`): what people do in the app (every
 * Firebase event is mirrored here by lib/analytics, plus screens, sign-in, recording, saving, sharing, paying and the
 * errors they were shown), and what Listen from anywhere's native service did with no JS running (`Listen.drainEvents`).
 * Each event is a name and flat `key=value` details: where it came from, what kind, how many, which error code. Never
 * audio, words, titles, links or anything about the person; the server ties a batch to the signed-in account by its
 * token, as the website's own events are.
 *
 * Nothing is lost on the way: every event is written to the phone before a send is planned (at most 2000, oldest
 * dropped first), carries its own id so a batch sent twice after an unclear failure counts once, and leaves the list
 * only by id once the server has it. A send that fails is tried again after 4 s, 15 s and a minute, then when the app
 * next comes forward or goes to the background; only a batch the server refuses outright (400, 413) is let go.
 * Signed out, events wait and go with the account that signs in; signing out sends what it can (2 s at most) with the
 * token still valid and then forgets the rest, so one account's events never go out under the next.
 */

const KEY = "nf.appEvents";
const BATCH = 50;

let queue: AppEventInput[] | null = null;
let loading: Promise<AppEventInput[]> | null = null;
let flushing: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Failed sends in a row; past the last retry delay nothing is planned until the app moves. */
let failures = 0;
/** Bumped when the list is forgotten (sign-out), so a send already under way neither saves nor sends any more of it. */
let epoch = 0;

/** The kept list, read once: two events logged before the first read share it rather than each writing its own. */
function load(): Promise<AppEventInput[]> {
  if (queue) return Promise.resolve(queue);
  if (!loading) {
    loading = (async () => {
      let kept: AppEventInput[] = [];
      try {
        const raw = await AsyncStorage.getItem(KEY);
        kept = readKept(raw ? (JSON.parse(raw) as unknown) : []);
      } catch {
        // Unreadable: start again. Only counts are lost.
      }
      // Anything logged (or a sign-out's forgetting) while it was read stands.
      queue = queue ?? kept;
      loading = null;
      return queue;
    })();
  }
  return loading;
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(queue ?? []));
  } catch {
    // The next one tries again; losing a few events costs nothing but a count.
  }
}

/** How long after a tap its event is written to the phone: the taps of one moment share one write. */
const SAVE_AFTER_MS = 600;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Writes the kept list once, a moment from now, not inside the tap that logged it. */
function persistSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, SAVE_AFTER_MS);
}

/** A write still waiting, done now (the app is leaving the screen, or a send is about to read the list). */
function persistNow(): Promise<void> {
  if (!saveTimer) return Promise.resolve();
  clearTimeout(saveTimer);
  saveTimer = null;
  return persist();
}

/**
 * Records one event and sends it with the next batch (a few seconds from now). The tap pays only for adding it to the
 * list in memory; the list is written to the phone a moment later, once for every event of that moment, and at once
 * when the app goes to the background. A tap used to wait on writing the whole kept list.
 */
export function logAppEvent(name: string, detail?: Detail): void {
  const event = makeEvent(name, detail);
  const add = () => {
    queue = mergeQueue(queue ?? [], [event]);
    persistSoon();
    // While a failed send waits its turn (or waits for the app to move), a new event does not hurry it.
    if (failures === 0) scheduleFlush();
  };
  if (queue) add();
  else void load().then(add);
}

function scheduleFlush(delayMs = 4_000): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushAppEvents();
  }, delayMs);
}

function sendFailed(): void {
  failures += 1;
  const delay = retryDelay(failures);
  if (delay !== null) scheduleFlush(delay);
}

/** Takes what the native side logged, then sends everything kept, in batches. Never rejects; one at a time. */
export function flushAppEvents(): Promise<void> {
  if (flushing) return flushing;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const started = epoch;
  flushing = (async () => {
    try {
      const native = Listen.drainEvents().map(nativeToInput);
      await load();
      await persistNow();
      if (epoch !== started) return;
      if (native.length) {
        queue = mergeQueue(queue ?? [], native);
        await persist();
      }
      if (!queue?.length || !(await tokenStore.getAccess())) return;
      const build = Number(Application.nativeBuildVersion ?? 0) || 0;
      while (epoch === started && queue && queue.length) {
        const batch = queue.slice(0, BATCH);
        try {
          await appApi.events({ build, events: batch });
        } catch (e) {
          const status = (e as AxiosError)?.response?.status ?? 0;
          if (!dropsBatch(status)) {
            sendFailed();
            return;
          }
          // Refused as it stands (a bad name, too big): sent again it would be refused again.
        }
        if (epoch !== started) return;
        queue = withoutSent(queue ?? [], batch);
        await persist();
      }
      failures = 0;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/**
 * For sign-out: sends what is kept while the token is still good (waiting `waitMs` at most), then forgets the rest,
 * on the phone too, so none of it goes out under whoever signs in next.
 */
export async function flushAndForgetAppEvents(waitMs = 2_000): Promise<void> {
  let waited: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    flushAppEvents(),
    new Promise<void>((resolve) => {
      waited = setTimeout(resolve, waitMs);
    }),
  ]);
  if (waited) clearTimeout(waited);
  await forgetAppEvents();
}

/** Drops everything kept (a session that ended without a sign-out: its token can no longer send them). */
export async function forgetAppEvents(): Promise<void> {
  epoch += 1;
  queue = [];
  failures = 0;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Left on the phone it is overwritten by the next event's save.
  }
}

/** Sends what is kept whenever the app comes forward or goes to the background, while someone is signed in. */
export function useAppEventsFlush(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    failures = 0;
    void flushAppEvents();
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" && next !== "background") return;
      // The app moved: a send that gave up after its retries gets a fresh start.
      failures = 0;
      void flushAppEvents();
    });
    return () => sub.remove();
  }, [signedIn]);
}

/**
 * `app_open` once per launch of the app's screens (not a headless Listen take) and `app_foreground` each time it comes
 * back from the background (not iOS's brief "inactive", which is a pulled-down shade).
 */
export function useAppLifecycleEvents(): void {
  useEffect(() => {
    logAppEvent("app_open");
    let last: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && last === "background") logAppEvent("app_foreground");
      // Leaving the screen, signed in or not: a write still waiting goes now, in case the app is not seen again.
      if (next === "background") void persistNow();
      last = next;
    });
    return () => sub.remove();
  }, []);
}
