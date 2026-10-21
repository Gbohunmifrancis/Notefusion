import { test } from "node:test";
import assert from "node:assert/strict";
import type { SavedTranscription } from "../api/types";
import {
  AUTO_BACKING_CAP_BYTES,
  AUTO_CACHE_CAP_BYTES,
  KEPT_MAX_AGE_MS,
  backingEvictionPlan,
  canOpenFromCache,
  emptyIndex,
  evictionPlan,
  indexOwner,
  mergeEdit,
  parseIndex,
  rowSignature,
  syncPlan,
  usage,
  wantsBackingCopy,
  withBacking,
  withOpened,
  withPin,
  withSheet,
  withStale,
  withoutBackings,
  withoutSheets,
  type CacheIndex,
} from "./sheetCache.ts";

const sheet = (id: string, over: Partial<SavedTranscription> = {}): SavedTranscription => ({
  id,
  title: `Sheet ${id}`,
  key: "G major",
  tempoBpm: 90,
  timeSignature: "4/4",
  overallConfidence: 0.9,
  createdAtUtc: "2026-10-01T00:00:00Z",
  preview: [{ pitchMidi: 67, startBeat: 0, durBeats: 1, degree: 1, solfa: "d", octaveMark: "", conf: 1 }],
  ...over,
});

const MB = 1024 * 1024;

test("an index read back under another account is empty: a handed-on phone shows nobody's songs", () => {
  const ix = withSheet(emptyIndex("u1"), sheet("a"), 1000, 1);
  const raw = JSON.stringify(ix);
  assert.equal(Object.keys(parseIndex(raw, "u1").entries).length, 1);
  assert.deepEqual(parseIndex(raw, "u2").entries, {});
  assert.equal(indexOwner(raw), "u1");
  assert.deepEqual(parseIndex("not json", "u1"), emptyIndex("u1"));
  assert.deepEqual(parseIndex(null, "u1"), emptyIndex("u1"));
});

test("automatic copies past the cap go least recently opened first; pinned sheets never go and never count", () => {
  let ix: CacheIndex = emptyIndex("u");
  ix = withSheet(ix, sheet("old"), 3 * MB, 1, { opened: true });
  ix = withSheet(ix, sheet("mid"), 3 * MB, 2, { opened: true });
  ix = withSheet(ix, sheet("pinned"), 6 * MB, 0, { opened: true });
  ix = withPin(ix, "pinned", true);
  ix = withSheet(ix, sheet("new"), 3 * MB, 3, { opened: true });
  // 9 MB of automatic copies against an 8 MB cap: only the oldest has to go.
  assert.deepEqual(evictionPlan(ix, AUTO_CACHE_CAP_BYTES), ["old"]);
  assert.deepEqual(evictionPlan(ix, 4 * MB), ["old", "mid"]);
  // "Keep all saved sheets offline" exempts everything.
  assert.deepEqual(evictionPlan({ ...ix, keepAll: true }, 1), []);
  assert.deepEqual(usage(ix), { bytes: 15 * MB, sheets: 4, pinned: 1 });
});

test("refreshing a copy keeps when it was last opened unless it was opened again, and keeps its pin", () => {
  let ix = withSheet(emptyIndex("u"), sheet("a"), 10, 100, { opened: true });
  ix = withPin(ix, "a", true);
  ix = withSheet(ix, sheet("a", { title: "Renamed" }), 12, 500);
  assert.equal(ix.entries.a!.openedAt, 100);
  assert.equal(ix.entries.a!.cachedAt, 500);
  assert.equal(ix.entries.a!.pinned, true);
  assert.equal(ix.entries.a!.title, "Renamed");
  ix = withSheet(ix, sheet("a"), 12, 900, { opened: true });
  assert.equal(ix.entries.a!.openedAt, 900);
  // Opened from its copy: only the eviction clock moves.
  const touched = withOpened(ix, "a", 1200);
  assert.equal(touched.entries.a!.openedAt, 1200);
  assert.equal(touched.entries.a!.cachedAt, ix.entries.a!.cachedAt);
  assert.equal(withOpened(ix, "missing", 5), ix);
  assert.deepEqual(Object.keys(withoutSheets(ix, ["a"]).entries), []);
});

test("an unchanged row opens from the copy; a changed or stale one is fetched", () => {
  const row = sheet("a");
  const ix = withSheet(emptyIndex("u"), row, 10, 1);
  assert.equal(canOpenFromCache(ix.entries.a, row), true);
  assert.equal(canOpenFromCache(ix.entries.a), true);
  assert.equal(canOpenFromCache(ix.entries.a, sheet("a", { key: "A major" })), false);
  assert.equal(canOpenFromCache(withStale(ix, "a").entries.a, row), false);
  assert.equal(canOpenFromCache(undefined, row), false);
});

test("a sync re-reads changed, stale and week-old kept copies, drops deleted ones, and fills in keep-all", () => {
  const now = 10 * KEPT_MAX_AGE_MS;
  let ix = emptyIndex("u");
  ix = withSheet(ix, sheet("same"), 10, now - 1000, { opened: true });
  ix = withSheet(ix, sheet("renamed"), 10, now - 1000, { opened: true });
  ix = withSheet(ix, sheet("edited"), 10, now - 1000);
  ix = withStale(ix, "edited");
  ix = withSheet(ix, sheet("oldpin"), 10, now - KEPT_MAX_AGE_MS - 1);
  ix = withPin(ix, "oldpin", true);
  ix = withSheet(ix, sheet("oldauto"), 10, now - KEPT_MAX_AGE_MS - 1);
  ix = withSheet(ix, sheet("gone"), 10, now - 1000);
  const list = [sheet("same"), sheet("renamed", { title: "New name" }), sheet("edited"), sheet("oldpin"), sheet("oldauto"), sheet("never")];
  const plan = syncPlan(ix, list, now);
  assert.deepEqual(plan.drop, ["gone"]);
  // The pinned one first; an old automatic copy whose row is unchanged is left alone.
  assert.deepEqual(plan.fetch, ["oldpin", "edited", "renamed"]);
  // Keeping everything: the sheet never opened is fetched too.
  assert.ok(syncPlan({ ...ix, keepAll: true }, list, now).fetch.includes("never"));
});

test("an edit that came back whole replaces the copy; one without its notes only updates the row", () => {
  const cached = sheet("a", { notes: [], musicXml: "<x/>", lyrics: "old" });
  const whole = mergeEdit(cached, sheet("a", { notes: [], musicXml: "<y/>", title: "T" }));
  assert.equal(whole.complete, true);
  assert.equal(whole.sheet.musicXml, "<y/>");
  const partial = mergeEdit(cached, sheet("a", { notes: null, title: "Renamed", lyrics: "new" }));
  assert.equal(partial.complete, false);
  assert.equal(partial.sheet.title, "Renamed");
  assert.equal(partial.sheet.lyrics, "new");
  assert.equal(partial.sheet.musicXml, "<x/>");
});

test("the row signature moves with every edit the app makes", () => {
  const base = sheet("a");
  const sig = rowSignature(base);
  for (const over of [{ title: "x" }, { key: "A major" }, { tempoBpm: 100 }, { folder: "Easter" }, { lyrics: "words" }, { preview: [] }]) {
    assert.notEqual(rowSignature(sheet("a", over as Partial<SavedTranscription>)), sig, JSON.stringify(over));
  }
  assert.equal(rowSignature(sheet("a")), sig);
});

test("a song's backing: kept sheets keep theirs, automatic copies share their own small room, oldest opened first", () => {
  let ix: CacheIndex = emptyIndex("u");
  const song = (id: string) => sheet(id, { hasBacking: true });
  ix = withSheet(ix, song("old"), 50_000, 1, { opened: true });
  ix = withSheet(ix, song("mid"), 50_000, 2, { opened: true });
  ix = withSheet(ix, song("kept"), 50_000, 0, { opened: true });
  ix = withPin(ix, "kept", true);
  ix = withSheet(ix, song("new"), 50_000, 3, { opened: true });
  // A backing is only recorded beside a copy that is there.
  assert.equal(withBacking(ix, "missing", MB), ix);
  for (const id of ["old", "mid", "kept", "new"]) ix = withBacking(ix, id, 1.5 * MB);
  // 4.5 MB of automatic backings against 4 MB: the oldest opened goes; the kept sheet's is not counted.
  assert.deepEqual(backingEvictionPlan(ix, AUTO_BACKING_CAP_BYTES), ["old"]);
  assert.deepEqual(backingEvictionPlan(ix, 1 * MB), ["old", "mid", "new"]);
  assert.deepEqual(backingEvictionPlan({ ...ix, keepAll: true }, 1), []);
  // Backings do not crowd out sheets: the sheets' own cap reads only the sheets.
  assert.deepEqual(evictionPlan(ix, AUTO_CACHE_CAP_BYTES), []);
  // Everything on the phone shows in the space used.
  assert.equal(usage(ix).bytes, 4 * 50_000 + 6 * MB);
  // A backing evicted leaves its sheet.
  const trimmed = withoutBackings(ix, ["old"]);
  assert.equal(trimmed.entries.old!.backingBytes, undefined);
  assert.equal(trimmed.entries.old!.bytes, 50_000);
  assert.equal(withoutBackings(trimmed, ["old"]), trimmed);
});

test("a refreshed copy keeps its backing while the sheet still has one, and a link's sheet never has one to fetch", () => {
  let ix: CacheIndex = emptyIndex("u");
  ix = withSheet(ix, sheet("a", { hasBacking: true }), 1000, 1, { opened: true });
  assert.equal(ix.entries.a!.hasBacking, true);
  ix = withBacking(ix, "a", MB);
  ix = withSheet(ix, sheet("a", { hasBacking: true, key: "F major" }), 1000, 2);
  assert.equal(ix.entries.a!.backingBytes, MB);
  // An older server says nothing: the file stays.
  ix = withSheet(ix, sheet("a"), 1000, 3);
  assert.equal(ix.entries.a!.backingBytes, MB);
  // The server says it has none now: the record goes (the caller deletes the file).
  ix = withSheet(ix, sheet("a", { hasBacking: false }), 1000, 4);
  assert.equal(ix.entries.a!.backingBytes, undefined);
  const link = withSheet(emptyIndex("u"), sheet("l", { hasBacking: true, fromLink: true }), 1000, 1);
  assert.equal(link.entries.l!.hasBacking, undefined);
});

test("a kept sheet's backing is fetched with it, except on Data saver, for a link, or once it is there", () => {
  let ix: CacheIndex = emptyIndex("u");
  ix = withSheet(ix, sheet("song", { hasBacking: true }), 1000, 1);
  ix = withSheet(ix, sheet("hummed"), 1000, 1);
  ix = withSheet(ix, sheet("link", { hasBacking: true, fromLink: true }), 1000, 1);
  // Automatic copies wait for a Play.
  assert.equal(wantsBackingCopy(ix.entries.song, ix, false), false);
  ix = withPin(withPin(withPin(ix, "song", true), "hummed", true), "link", true);
  assert.equal(wantsBackingCopy(ix.entries.song, ix, false), true);
  assert.equal(wantsBackingCopy(ix.entries.song, ix, true), false, "data saver: at the first Play");
  assert.equal(wantsBackingCopy(ix.entries.hummed, ix, false), false);
  assert.equal(wantsBackingCopy(ix.entries.link, ix, false), false);
  assert.equal(wantsBackingCopy(withBacking(ix, "song", MB).entries.song, ix, false), false);
  // Keep-all keeps it too.
  const all = { ...withPin(ix, "song", false), keepAll: true };
  assert.equal(wantsBackingCopy(all.entries.song, all, false), true);
  assert.equal(wantsBackingCopy(undefined, all, false), false);
});
