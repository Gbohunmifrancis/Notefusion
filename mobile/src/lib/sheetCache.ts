/**
 * The offline library's bookkeeping, pure: which saved sheets are kept on the phone, which go when
 * the automatic copies outgrow their room, and which need fetching again once the API answers.
 * `offlineLibrary.ts` does the reading and writing; everything that decides is here and tested.
 *
 * A sheet is kept two ways. Every sheet opened or saved is copied automatically, and those copies
 * share `AUTO_CACHE_CAP_BYTES`, oldest-opened going first. A sheet the person pinned ("Keep
 * offline"), or every sheet while "Keep all saved sheets offline" is on, is never evicted.
 *
 * A sheet from the owner's own upload may keep the song's backing beside it (an MP3 of about a megabyte for three
 * minutes, boards o-backing O3/5). A kept sheet's backing is kept with it, exempt like the sheet; the automatic copies'
 * backings share a small room of their own, `AUTO_BACKING_CAP_BYTES` (the last few songs played), so they never
 * crowd out the sheets themselves.
 *
 * The index belongs to one account. Read back under another account id it is empty, and the files
 * it named are the caller's to delete: a phone handed to someone else must not show the last
 * person's songs.
 */
import type { SavedTranscription } from "../api/types";

export interface CacheEntry {
  id: string;
  title: string;
  /** Size of the stored copy. */
  bytes: number;
  /** When the copy was written (ms). */
  cachedAt: number;
  /** When it was last opened or saved (ms): eviction goes by this. */
  openedAt: number;
  /** "Keep offline": never evicted. */
  pinned: boolean;
  /** The list row the copy was taken against (`rowSignature`). A different row means it changed. */
  signature: string;
  /** An edit came back without the whole sheet: the copy still opens, and is re-read when online. */
  stale?: boolean;
  /** The sheet has a backing the server keeps for it (the owner's own upload, separated): it may be kept beside it. */
  hasBacking?: boolean;
  /** Size of the song's backing kept beside the copy (`<id>.backing.mp3`); absent when there is none on the phone. */
  backingBytes?: number;
}

export interface CacheIndex {
  v: 1;
  userId: string;
  entries: Record<string, CacheEntry>;
  /** Settings → "Keep all saved sheets offline". */
  keepAll: boolean;
}

/** Room for automatic copies. A sheet is 10–80 KB, so this is a few hundred; pins are on top. */
export const AUTO_CACHE_CAP_BYTES = 8 * 1024 * 1024;

/**
 * Room for the backings of automatic copies: about four three-minute songs. A kept sheet's backing is on top, as the
 * sheet is.
 */
export const AUTO_BACKING_CAP_BYTES = 4 * 1024 * 1024;

/** A kept copy older than this is re-read on the next sync even when its row looks the same. */
export const KEPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function emptyIndex(userId: string): CacheIndex {
  return { v: 1, userId, entries: {}, keepAll: false };
}

/** The stored index, or an empty one when it is unreadable or another account's. */
export function parseIndex(raw: string | null | undefined, userId: string): CacheIndex {
  if (!raw) return emptyIndex(userId);
  try {
    const x = JSON.parse(raw) as Partial<CacheIndex>;
    if (x?.v !== 1 || x.userId !== userId || typeof x.entries !== "object" || x.entries === null) return emptyIndex(userId);
    return { v: 1, userId, entries: { ...x.entries }, keepAll: !!x.keepAll };
  } catch {
    return emptyIndex(userId);
  }
}

/** The account a stored index belongs to, or null when there is none to read. */
export function indexOwner(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as Partial<CacheIndex>;
    return typeof x?.userId === "string" ? x.userId : null;
  } catch {
    return null;
  }
}

/**
 * What a list row says about a sheet. The list carries no "updated" time, but every edit the app
 * makes shows in one of these (a transpose moves the key and the opening notes; a correction moves
 * the opening notes or the solfa under them), so a changed signature means a changed sheet.
 */
export function rowSignature(item: SavedTranscription): string {
  const preview = (item.preview ?? []).map((n) => `${n.pitchMidi}@${n.startBeat}:${n.durBeats}`).join(",");
  return JSON.stringify([
    item.title,
    item.key,
    item.tempoBpm,
    item.timeSignature,
    item.folder ?? null,
    item.lyrics ?? "",
    item.shareToken ?? null,
    !!item.sharedWithChoir,
    item.hymn?.slug ?? null,
    preview,
  ]);
}

export function isKept(entry: CacheEntry, index: CacheIndex): boolean {
  return entry.pinned || index.keepAll;
}

export interface Usage {
  bytes: number;
  sheets: number;
  pinned: number;
}

/** Everything on the phone counts, the backings with their sheets. */
export function usage(index: CacheIndex): Usage {
  const all = Object.values(index.entries);
  return {
    bytes: all.reduce((s, e) => s + e.bytes + (e.backingBytes ?? 0), 0),
    sheets: all.length,
    pinned: all.filter((e) => e.pinned).length,
  };
}

/**
 * The automatic copies to delete so the rest fit in `cap`: least recently opened first. Kept
 * sheets are neither evicted nor counted.
 */
export function evictionPlan(index: CacheIndex, cap = AUTO_CACHE_CAP_BYTES): string[] {
  if (index.keepAll) return [];
  const auto = Object.values(index.entries).filter((e) => !e.pinned);
  let total = auto.reduce((s, e) => s + e.bytes, 0);
  const drop: string[] = [];
  for (const e of [...auto].sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id))) {
    if (total <= cap) break;
    drop.push(e.id);
    total -= e.bytes;
  }
  return drop;
}

/** The index with this sheet's copy recorded (written or refreshed). */
export function withSheet(
  index: CacheIndex,
  sheet: SavedTranscription,
  bytes: number,
  now: number,
  opts: { opened?: boolean } = {},
): CacheIndex {
  const prev = index.entries[sheet.id];
  const entry: CacheEntry = {
    id: sheet.id,
    title: sheet.title,
    bytes,
    cachedAt: now,
    openedAt: opts.opened || !prev ? now : prev.openedAt,
    pinned: prev?.pinned ?? false,
    signature: rowSignature(sheet),
  };
  if (sheet.hasBacking && !sheet.fromLink) entry.hasBacking = true;
  // The backing beside it stays while the sheet still has one (a refreshed copy does not take it away).
  if (prev?.backingBytes && sheet.hasBacking !== false) entry.backingBytes = prev.backingBytes;
  return { ...index, entries: { ...index.entries, [sheet.id]: entry } };
}

/**
 * The automatic copies whose backings go so the rest fit in `cap`: least recently opened first. A kept sheet's
 * backing is neither evicted nor counted; the sheet itself stays either way.
 */
export function backingEvictionPlan(index: CacheIndex, cap = AUTO_BACKING_CAP_BYTES): string[] {
  if (index.keepAll) return [];
  const auto = Object.values(index.entries).filter((e) => !e.pinned && (e.backingBytes ?? 0) > 0);
  let total = auto.reduce((s, e) => s + (e.backingBytes ?? 0), 0);
  const drop: string[] = [];
  for (const e of [...auto].sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id))) {
    if (total <= cap) break;
    drop.push(e.id);
    total -= e.backingBytes ?? 0;
  }
  return drop;
}

/** The index with a backing recorded beside a copy already there (a backing without its sheet is not kept). */
export function withBacking(index: CacheIndex, id: string, bytes: number): CacheIndex {
  const e = index.entries[id];
  if (!e || bytes <= 0) return index;
  return { ...index, entries: { ...index.entries, [id]: { ...e, backingBytes: bytes } } };
}

/** The index with these sheets' backings gone (their copies stay). */
export function withoutBackings(index: CacheIndex, ids: readonly string[]): CacheIndex {
  let entries: Record<string, CacheEntry> | null = null;
  for (const id of ids) {
    const e = index.entries[id];
    if (!e || e.backingBytes === undefined) continue;
    entries ??= { ...index.entries };
    const { backingBytes: _gone, ...rest } = e;
    entries[id] = rest;
  }
  return entries ? { ...index, entries } : index;
}

/**
 * Whether a copy should have its backing fetched now, with no Play to ask for it: only a kept sheet ("Keep offline",
 * or keep-all) from the owner's own upload that has one and has none on the phone yet, and never on Data saver
 * (there the backing comes down at the first Play, and is kept then).
 */
export function wantsBackingCopy(entry: CacheEntry | undefined, index: CacheIndex, dataSaver: boolean): boolean {
  if (!entry || dataSaver || !isKept(entry, index) || !entry.hasBacking) return false;
  return !((entry.backingBytes ?? 0) > 0);
}

export function withoutSheets(index: CacheIndex, ids: readonly string[]): CacheIndex {
  if (ids.length === 0) return index;
  const entries = { ...index.entries };
  for (const id of ids) delete entries[id];
  return { ...index, entries };
}

/** Pins or unpins a sheet already copied; a sheet not copied yet is the caller's to fetch first. */
export function withPin(index: CacheIndex, id: string, pinned: boolean): CacheIndex {
  const e = index.entries[id];
  if (!e || e.pinned === pinned) return index;
  return { ...index, entries: { ...index.entries, [id]: { ...e, pinned } } };
}

/** Opened again from its copy: only the eviction clock moves, nothing is rewritten. */
export function withOpened(index: CacheIndex, id: string, now: number): CacheIndex {
  const e = index.entries[id];
  if (!e) return index;
  return { ...index, entries: { ...index.entries, [id]: { ...e, openedAt: now } } };
}

export function withStale(index: CacheIndex, id: string): CacheIndex {
  const e = index.entries[id];
  if (!e || e.stale) return index;
  return { ...index, entries: { ...index.entries, [id]: { ...e, stale: true } } };
}

/**
 * Whether opening this sheet can skip the network: there is a copy, nothing marked it stale, and
 * (when the fresh list row is known) it was taken against that same row. Saves a download on every
 * open of an unchanged sheet, which on a slow connection is most of the wait.
 */
export function canOpenFromCache(entry: CacheEntry | undefined, row?: SavedTranscription): boolean {
  if (!entry || entry.stale) return false;
  return !row || rowSignature(row) === entry.signature;
}

export interface SyncPlan {
  /** Sheets to re-read: changed, stale, old kept copies, and (keeping all) the ones never copied. */
  fetch: string[];
  /** Copies of sheets the fresh list no longer has: deleted on another device. */
  drop: string[];
}

/**
 * What to do with a fresh library list. Only ever called with a list the API actually returned,
 * so a sheet missing from it is gone on the server, never a failed request.
 */
export function syncPlan(index: CacheIndex, list: readonly SavedTranscription[], now: number): SyncPlan {
  const listed = new Map(list.map((s) => [s.id, s]));
  const drop = Object.keys(index.entries).filter((id) => !listed.has(id));
  const fetch: { id: string; kept: boolean; openedAt: number }[] = [];
  for (const row of list) {
    const e = index.entries[row.id];
    if (!e) {
      if (index.keepAll) fetch.push({ id: row.id, kept: true, openedAt: 0 });
      continue;
    }
    const kept = isKept(e, index);
    if (e.stale || e.signature !== rowSignature(row) || (kept && now - e.cachedAt > KEPT_MAX_AGE_MS)) {
      fetch.push({ id: row.id, kept, openedAt: e.openedAt });
    }
  }
  // Kept sheets first (the person asked for those), then the most recently opened.
  fetch.sort((a, b) => Number(b.kept) - Number(a.kept) || b.openedAt - a.openedAt || a.id.localeCompare(b.id));
  return { fetch: fetch.map((f) => f.id), drop };
}

/**
 * A sheet as an edit route returned it. With its notes it is the whole sheet; without them only the
 * row's fields are new, and the caller marks the copy stale so the rest is re-read when online.
 */
export function mergeEdit(cached: SavedTranscription, edit: SavedTranscription): { sheet: SavedTranscription; complete: boolean } {
  if (edit.notes) return { sheet: edit, complete: true };
  const row: Partial<SavedTranscription> = {
    title: edit.title,
    key: edit.key,
    tempoBpm: edit.tempoBpm,
    timeSignature: edit.timeSignature,
    folder: edit.folder ?? null,
    shareToken: edit.shareToken ?? null,
    sharedWithChoir: edit.sharedWithChoir,
    preview: edit.preview ?? cached.preview,
  };
  if (typeof edit.lyrics === "string") row.lyrics = edit.lyrics;
  return { sheet: { ...cached, ...row }, complete: false };
}
