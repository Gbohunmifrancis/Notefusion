import { test } from "node:test";
import assert from "node:assert/strict";
import type { SavedTranscription } from "../api/types";
import {
  AUTO_CACHE_CAP_BYTES,
  KEPT_MAX_AGE_MS,
  canOpenFromCache,
  emptyIndex,
  evictionPlan,
  indexOwner,
  mergeEdit,
  parseIndex,
  rowSignature,
  syncPlan,
  usage,
  withOpened,
  withPin,
  withSheet,
  withStale,
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
