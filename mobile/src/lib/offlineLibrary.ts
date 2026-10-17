import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import type { SavedTranscription } from "../api/types";
import { dirAt, readText, removeDir, removeFile, writeText } from "./blobStore";
import { isNetworkCode, onReachability } from "./reachability";
import { onSheetEvent } from "./sheetEvents";
import {
  canOpenFromCache,
  emptyIndex,
  evictionPlan,
  indexOwner,
  mergeEdit,
  parseIndex,
  syncPlan,
  usage,
  withOpened,
  withPin,
  withSheet,
  withStale,
  withoutSheets,
  type CacheIndex,
  type Usage,
} from "./sheetCache";
import { logAnalyticsEvent } from "./analytics";

/**
 * The offline library: saved sheets kept on the phone so the Library and a sheet open with no
 * connection (playback, practice, solfa and staff are all local). The rules are in `sheetCache.ts`;
 * this module reads and writes:
 *
 *   documents/offline/sheets/<userId>/<id>.json   each sheet as the API returned it
 *   documents/offline/sheets/<userId>/_list.json  the library list, for the Library and Home
 *   AsyncStorage "nf.offline.index"               the index: sizes, pins, keep-all, the account
 *
 * A copy is written whenever a sheet is opened or saved, or an edit comes back (via
 * `sheetEvents`), and refreshed quietly by `syncOfflineLibrary` when the API answers again. A failed
 * refresh changes nothing on the phone. Signing out deletes it all; a different account signing in
 * finds the index is not theirs and the old copies are deleted before anything is shown.
 */

const INDEX_KEY = "nf.offline.index";
const LIST_FILE = "_list.json";

let userId: string | null = null;
let index: CacheIndex | null = null;
let chain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function sheetsDir(id = userId!) {
  return dirAt("sheets", id);
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** Runs index changes one at a time, so two writes never race each other's read. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function persist(): Promise<void> {
  if (!index) return;
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index)).catch(() => undefined);
  notify();
}

/**
 * Binds the cache to the signed-in account (AuthProvider calls this). A stored index that belongs to
 * another account is deleted with its files, so nobody sees the last person's songs.
 */
export function bindOfflineLibrary(id: string | null): Promise<void> {
  return serial(async () => {
    if (id === userId && index) return;
    userId = id;
    index = null;
    if (!id) {
      notify();
      return;
    }
    const raw = await AsyncStorage.getItem(INDEX_KEY).catch(() => null);
    const owner = indexOwner(raw);
    if (owner && owner !== id) removeDir(dirAt("sheets", owner));
    index = parseIndex(raw, id);
    await persist();
  });
}

/** Sign-out: every copy, the list and the index go. (The send queue and hymn pack clear their own.) */
export function clearOfflineLibrary(): Promise<void> {
  return serial(async () => {
    removeDir(dirAt("sheets"));
    await AsyncStorage.removeItem(INDEX_KEY).catch(() => undefined);
    userId = null;
    index = null;
    notify();
  });
}

function ready(): CacheIndex | null {
  return userId && index ? index : null;
}

/** The library list as last fetched, or null when there is none for this account. */
export async function cachedLibraryList(): Promise<SavedTranscription[] | null> {
  await chain.catch(() => undefined);
  if (!ready()) return null;
  const text = await readText(sheetsDir(), LIST_FILE);
  if (!text) return null;
  try {
    const list = JSON.parse(text) as SavedTranscription[];
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export async function cachedSheet(id: string): Promise<SavedTranscription | null> {
  await chain.catch(() => undefined);
  if (!ready() || !index!.entries[id]) return null;
  const text = await readText(sheetsDir(), `${id}.json`);
  if (!text) return null;
  try {
    return JSON.parse(text) as SavedTranscription;
  } catch {
    return null;
  }
}

/** Writes one sheet's copy and records it; then trims the automatic copies to their room. */
function storeSheet(sheet: SavedTranscription, opts: { opened?: boolean; stale?: boolean } = {}): void {
  if (!ready() || !sheet.notes) return;
  const bytes = writeText(sheetsDir(), `${sheet.id}.json`, JSON.stringify(sheet));
  if (bytes === 0) return;
  let next = withSheet(index!, sheet, bytes, Date.now(), { opened: opts.opened });
  if (opts.stale) next = withStale(next, sheet.id);
  const drop = evictionPlan(next);
  for (const id of drop) removeFile(sheetsDir(), `${id}.json`);
  index = withoutSheets(next, drop);
}

export function rememberSheet(sheet: SavedTranscription, opts: { opened?: boolean } = {}): Promise<void> {
  return serial(async () => {
    storeSheet(sheet, opts);
    await persist();
  });
}

function rememberList(list: readonly SavedTranscription[]): Promise<void> {
  return serial(async () => {
    if (!ready()) return;
    writeText(sheetsDir(), LIST_FILE, JSON.stringify(list));
  });
}

export interface LibraryLoad {
  items: SavedTranscription[];
  /** True when the API could not be reached and these are the phone's copies. */
  offline: boolean;
}

/**
 * The library list: from the API when it answers (and kept for next time, with a quiet refresh of
 * the copies behind it), else the list as last seen. Throws only when there is neither.
 */
export async function loadLibraryList(): Promise<LibraryLoad> {
  try {
    const items = await libraryApi.list();
    void rememberList(items).then(() => scheduleSync(items));
    return { items, offline: false };
  } catch (e) {
    if (!isNetworkCode(toApiError(e).code)) throw e;
    const cached = await cachedLibraryList();
    if (!cached) throw e;
    return { items: cached, offline: true };
  }
}

export interface SheetLoad {
  sheet: SavedTranscription;
  /** True when the API could not be reached and the copy was used. */
  offline: boolean;
}

/**
 * One saved sheet with its notes. An unchanged copy opens at once with no download (on a slow
 * connection that is most of the wait); a changed one is fetched and kept; a failed fetch falls back
 * to the copy. Throws only when there is no copy and the API cannot give one.
 */
export async function loadSheet(row: SavedTranscription): Promise<SheetLoad> {
  await chain.catch(() => undefined);
  const entry = ready()?.entries[row.id];
  if (canOpenFromCache(entry, row)) {
    const copy = await cachedSheet(row.id);
    if (copy) {
      void serial(async () => {
        if (!ready()) return;
        index = withOpened(index!, row.id, Date.now());
        await persist();
      });
      return { sheet: copy, offline: false };
    }
  }
  try {
    const sheet = await libraryApi.get(row.id);
    void rememberSheet(sheet, { opened: true });
    return { sheet, offline: false };
  } catch (e) {
    if (!isNetworkCode(toApiError(e).code)) throw e;
    const copy = await cachedSheet(row.id);
    if (!copy) throw e;
    void logAnalyticsEvent("offline_sheet_opened");
    return { sheet: copy, offline: true };
  }
}

/** "Keep offline" on one sheet. A sheet not copied yet is fetched first, so this needs a connection then. */
export async function setSheetPinned(id: string, pinned: boolean): Promise<void> {
  if (pinned && !ready()?.entries[id]) {
    const sheet = await libraryApi.get(id);
    await rememberSheet(sheet);
  }
  await serial(async () => {
    if (!ready()) return;
    index = withPin(index!, id, pinned);
    if (!pinned) {
      const drop = evictionPlan(index);
      for (const id of drop) removeFile(sheetsDir(), `${id}.json`);
      index = withoutSheets(index, drop);
    }
    await persist();
  });
  void logAnalyticsEvent(pinned ? "sheet_kept_offline" : "sheet_unkept_offline");
}

/** Settings → "Keep all saved sheets offline". Turning it on fetches what is missing in the background. */
export async function setKeepAllOffline(on: boolean): Promise<void> {
  await serial(async () => {
    if (!ready()) return;
    index = { ...index!, keepAll: on };
    if (!on) {
      const drop = evictionPlan(index);
      for (const id of drop) removeFile(sheetsDir(), `${id}.json`);
      index = withoutSheets(index, drop);
    }
    await persist();
  });
  void logAnalyticsEvent("keep_all_offline", { on });
  if (on) void syncOfflineLibrary();
}

/** Settings → "Clear offline copies": everything but the pinned sheets; keep-all goes off. */
export async function clearAutomaticCopies(): Promise<void> {
  await serial(async () => {
    if (!ready()) return;
    const drop = Object.values(index!.entries).filter((e) => !e.pinned).map((e) => e.id);
    for (const id of drop) removeFile(sheetsDir(), `${id}.json`);
    index = { ...withoutSheets(index!, drop), keepAll: false };
    await persist();
  });
  void logAnalyticsEvent("offline_cache_cleared");
}

let syncing: Promise<void> | null = null;
let lastSyncAt = 0;
const SYNC_MIN_GAP_MS = 60_000;

function scheduleSync(list: readonly SavedTranscription[]): void {
  if (Date.now() - lastSyncAt < SYNC_MIN_GAP_MS) return;
  void syncOfflineLibrary(list);
}

/**
 * Brings the copies level with the server: re-reads changed, stale and week-old kept sheets, fills in
 * keep-all, drops sheets deleted elsewhere. One sheet at a time, and it stops at the first network
 * failure — a refresh that fails leaves the copy exactly as it was.
 */
export function syncOfflineLibrary(list?: readonly SavedTranscription[]): Promise<void> {
  if (syncing) return syncing;
  // Cleared by `.finally`, which always runs after this assignment — a body that returns before its
  // first await would otherwise clear the flag first and leave it set for good.
  syncing = (async () => {
    lastSyncAt = Date.now();
    try {
      if (!ready()) return;
      const fresh = list ?? (await libraryApi.list());
      if (!list) await rememberList(fresh);
      const plan = syncPlan(index!, fresh, Date.now());
      if (plan.drop.length) {
        await serial(async () => {
          for (const id of plan.drop) removeFile(sheetsDir(), `${id}.json`);
          index = withoutSheets(index!, plan.drop);
          await persist();
        });
      }
      for (const id of plan.fetch) {
        if (!ready()) return;
        const sheet = await libraryApi.get(id);
        await serial(async () => {
          storeSheet(sheet);
          await persist();
        });
      }
    } catch {
      // Offline again, or the server said no: the copies stand as they were.
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

// Library writes confirmed by the API keep the copies level, including while offline-capable screens
// are not mounted. A whole sheet replaces the copy; an edit without its notes updates the row and
// marks the copy stale so the rest is re-read later.
onSheetEvent((e) => {
  if (e.type === "removed") {
    void (async () => {
      // The kept list too, so an offline Library never offers a sheet that was deleted.
      const list = await cachedLibraryList();
      await serial(async () => {
        if (!ready()) return;
        removeFile(sheetsDir(), `${e.id}.json`);
        if (list) writeText(sheetsDir(), LIST_FILE, JSON.stringify(list.filter((s) => s.id !== e.id)));
        index = withoutSheets(index!, [e.id]);
        await persist();
      });
    })();
    return;
  }
  void (async () => {
    const cached = await cachedSheet(e.sheet.id);
    await serial(async () => {
      if (!ready()) return;
      if (!cached) {
        // A new save is "saved", so it is kept like an opened sheet.
        if (e.sheet.notes) storeSheet(e.sheet, { opened: true });
      } else {
        const { sheet, complete } = mergeEdit(cached, e.sheet);
        storeSheet(sheet, { stale: !complete });
      }
      await persist();
    });
  })();
});

// Back online: refresh quietly.
onReachability((s) => {
  if (s === "online" && Date.now() - lastSyncAt >= SYNC_MIN_GAP_MS) void syncOfflineLibrary();
});

export interface OfflineState {
  usage: Usage;
  keepAll: boolean;
  pinned: ReadonlySet<string>;
  cached: ReadonlySet<string>;
}

function snapshot(): OfflineState {
  const ix = ready() ?? emptyIndex("");
  return {
    usage: usage(ix),
    keepAll: ix.keepAll,
    pinned: new Set(Object.values(ix.entries).filter((e) => e.pinned).map((e) => e.id)),
    cached: new Set(Object.keys(ix.entries)),
  };
}

/** Pins, keep-all and the space used, as React state. */
export function useOfflineLibrary(): OfflineState {
  const [state, setState] = useState<OfflineState>(snapshot);
  useEffect(() => {
    const fn = () => setState(snapshot());
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return state;
}
