import { useEffect, useState } from "react";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { siteUrls } from "./env";
import { dirAt, readText, removeDir, writeText } from "./blobStore";
import { dataSaverOn } from "./dataSaver";
import { autoCheckDue, needsDownload, parseMeta, parsePack, type HymnPack, type PackMeta } from "./hymnPack";
import { logAnalyticsEvent } from "./analytics";

/**
 * The hymn pack on the phone: downloaded on request (Hymns screen) from the website, kept under
 * documents/offline/hymns/, and read from there with no connection. Public-domain content, the same
 * for every account, so it survives sign-out. A weekly check reads pack-version.json (~130 bytes)
 * and downloads only when the content changed — never on data saver unless asked.
 */

const STATE_KEY = "nf.hymnPack";
const FILE = "pack.json";

export interface PackState {
  /** The installed pack's version, or null when none is downloaded. */
  version: string | null;
  bytes: number;
  count: number;
  /** When the website was last asked for a newer version (ms). */
  lastCheckedAt: number | null;
}

const EMPTY: PackState = { version: null, bytes: 0, count: 0, lastCheckedAt: null };
let state: PackState = EMPTY;
let pack: HymnPack | null = null;
let loaded: Promise<void> | null = null;
const listeners = new Set<(s: PackState) => void>();

function dir() {
  return dirAt("hymns");
}

function setState(next: PackState): void {
  state = next;
  for (const fn of listeners) fn(state);
  AsyncStorage.setItem(STATE_KEY, JSON.stringify(state)).catch(() => undefined);
}

export function loadPackState(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STATE_KEY);
        if (raw) state = { ...EMPTY, ...(JSON.parse(raw) as Partial<PackState>) };
      } catch {
        state = EMPTY;
      }
      for (const fn of listeners) fn(state);
    })();
  }
  return loaded;
}

export function packState(): PackState {
  return state;
}

/** The installed pack, read from the phone (once per session). Null when none is installed. */
export async function installedPack(): Promise<HymnPack | null> {
  await loadPackState();
  if (pack) return pack;
  if (!state.version) return null;
  const text = await readText(dir(), FILE);
  pack = text ? parsePack(text) : null;
  if (!pack) setState({ ...EMPTY, lastCheckedAt: state.lastCheckedAt });
  return pack;
}

/** What the website has now: version and size (for "Download hymns — 684 KB"). Null when unreachable. */
export async function remotePackMeta(): Promise<PackMeta | null> {
  try {
    const res = await axios.get<string>(siteUrls.hymnPackVersion, { timeout: 15_000, responseType: "text", transformResponse: (d) => d });
    await loadPackState();
    setState({ ...state, lastCheckedAt: Date.now() });
    return parseMeta(typeof res.data === "string" ? res.data : JSON.stringify(res.data));
  } catch {
    return null;
  }
}

/**
 * Downloads the pack, reporting 0..1. The phone's copy is replaced only once the new one has arrived
 * whole and parses; a dropped download leaves the old one in place.
 */
export async function downloadPack(onProgress?: (fraction: number) => void, expectedBytes?: number): Promise<HymnPack> {
  const res = await axios.get<string>(siteUrls.hymnPack, {
    timeout: 180_000,
    responseType: "text",
    transformResponse: (d) => d,
    onDownloadProgress: (e) => {
      // Gzip on the wire: the total is the unpacked size we were told, when the header has none.
      const total = e.total && e.total >= e.loaded ? e.total : expectedBytes ?? 0;
      if (total > 0) onProgress?.(Math.min(0.99, e.loaded / total));
    },
  });
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  const next = parsePack(text);
  if (!next) throw new Error("The hymn pack could not be read. Please try again.");
  const bytes = writeText(dir(), FILE, text);
  if (bytes === 0) throw new Error("There isn't room on this phone for the hymns.");
  pack = next;
  setState({ version: next.version, bytes, count: next.count, lastCheckedAt: Date.now() });
  onProgress?.(1);
  void logAnalyticsEvent("hymn_pack_downloaded", { kb: Math.round(bytes / 1024), count: next.count });
  return next;
}

/** Deletes the pack (Settings). */
export async function removePack(): Promise<void> {
  removeDir(dir());
  pack = null;
  setState({ ...EMPTY });
  void logAnalyticsEvent("hymn_pack_removed");
}

/**
 * The weekly look for a newer pack, without being asked: only with a pack installed, only off data
 * saver. Returns true when a newer pack was downloaded.
 */
export async function autoRefreshPack(): Promise<boolean> {
  await loadPackState();
  if (!autoCheckDue({ installed: !!state.version, lastCheckedAt: state.lastCheckedAt, now: Date.now(), dataSaver: dataSaverOn() })) return false;
  const meta = await remotePackMeta();
  if (!meta || !needsDownload(state.version, meta)) return false;
  try {
    await downloadPack(undefined, meta.bytes);
    return true;
  } catch {
    return false;
  }
}

export function usePackState(): PackState {
  const [s, set] = useState<PackState>(state);
  useEffect(() => {
    listeners.add(set);
    void loadPackState().then(() => set(state));
    return () => {
      listeners.delete(set);
    };
  }, []);
  return s;
}
