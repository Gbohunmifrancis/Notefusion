import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PACK_FORMAT,
  WEEK_MS,
  autoCheckDue,
  carols,
  formatBytes,
  hymnSheet,
  keyAndTime,
  needsDownload,
  openingLine,
  parseMeta,
  parsePack,
  searchHymns,
  type PackHymn,
} from "./hymnPack.ts";
import { deriveSolfa } from "./solfa.ts";

const hymn = (slug: string, title: string, over: Partial<PackHymn> = {}): PackHymn => ({
  slug,
  kind: "hymn",
  title,
  firstLine: "",
  tune: "",
  key: "C major",
  time: "4/4",
  tempo: 90,
  pickup: 0,
  credit: "Public domain.",
  url: `https://notefusion.studio/hymns/${slug}`,
  notes: [[60, 0, 1]],
  words: "",
  verses: [],
  ...over,
});

const ag = hymn("amazing-grace", "Amazing Grace", {
  firstLine: "Amazing grace! how sweet the sound",
  tune: "NEW BRITAIN",
  key: "G major",
  time: "3/4",
  tempo: 72,
  pickup: 1,
  notes: [[62, 2, 1], [67, 3, 2], [71, 5, 0.5], [67, 5.5, 0.5]],
  words: "A-maz-ing grace! how sweet",
  verses: [{ lines: ["Amazing grace! how sweet the sound"] }],
});
const pack = [ag, hymn("abide-with-me", "Abide with Me", { firstLine: "Abide with me; fast falls the eventide", tune: "EVENTIDE" }), hymn("tis-so-sweet", "‘Tis So Sweet to Trust in Jesus", { tune: "TRUST IN JESUS" }), hymn("tune-new-britain", "New Britain", { kind: "tune", tune: "NEW BRITAIN" })];

test("the version check: a different version is newer, a format this build cannot read waits for an update", () => {
  const meta = { format: PACK_FORMAT, version: "abc", count: 377, bytes: 700_000 };
  assert.equal(needsDownload(null, meta), true);
  assert.equal(needsDownload("abc", meta), false);
  assert.equal(needsDownload("old", meta), true);
  assert.equal(needsDownload("old", { ...meta, format: PACK_FORMAT + 1 }), false);
});

test("the weekly check: only with a pack, once a week, never on data saver", () => {
  const now = 100 * WEEK_MS;
  assert.equal(autoCheckDue({ installed: true, lastCheckedAt: now - WEEK_MS, now, dataSaver: false }), true);
  assert.equal(autoCheckDue({ installed: true, lastCheckedAt: now - WEEK_MS + 1, now, dataSaver: false }), false);
  assert.equal(autoCheckDue({ installed: true, lastCheckedAt: null, now, dataSaver: false }), true);
  assert.equal(autoCheckDue({ installed: true, lastCheckedAt: 0, now, dataSaver: true }), false);
  assert.equal(autoCheckDue({ installed: false, lastCheckedAt: 0, now, dataSaver: false }), false);
});

test("parsing: a good pack, a future format, junk", () => {
  const good = parsePack(JSON.stringify({ format: 1, version: "v1", count: 1, hymns: [ag, { slug: "broken" }] }));
  assert.equal(good?.version, "v1");
  assert.equal(good?.hymns.length, 1, "an unreadable entry is skipped, not fatal");
  assert.equal(parsePack(JSON.stringify({ format: 2, version: "v", hymns: [ag] })), null);
  assert.equal(parsePack("<html>"), null);
  assert.deepEqual(parseMeta('{"format":1,"version":"v","count":3,"bytes":42}'), { format: 1, version: "v", count: 3, bytes: 42 });
  assert.equal(parseMeta("{}"), null);
});

test("search: title start, then title, first line, tune; accents and quote marks do not matter", () => {
  assert.deepEqual(searchHymns(pack, "").map((h) => h.slug), ["abide-with-me", "amazing-grace", "tune-new-britain", "tis-so-sweet"]);
  assert.deepEqual(searchHymns(pack, "britain").map((h) => h.slug), ["tune-new-britain", "amazing-grace"]);
  assert.deepEqual(searchHymns(pack, "tis so").map((h) => h.slug), ["tis-so-sweet"]);
  assert.deepEqual(searchHymns(pack, "eventide").map((h) => h.slug), ["abide-with-me"]);
  assert.deepEqual(searchHymns(pack, "sweet sound").map((h) => h.slug), ["amazing-grace"]);
  assert.deepEqual(searchHymns(pack, "nothing like this"), []);
});

test("a hymn opens as a sheet the solfa engine reads as the hymnbook does", () => {
  const sheet = hymnSheet(ag);
  assert.equal(sheet.key, "G major");
  assert.equal(sheet.timeSignature, "3/4");
  assert.equal(sheet.tempo, 72);
  assert.equal(sheet.lyrics, "A-maz-ing grace! how sweet");
  assert.deepEqual(sheet.hymn, { slug: "amazing-grace", title: "Amazing Grace", url: ag.url, credit: "Public domain." });
  const derived = deriveSolfa(sheet.notes, sheet.key, sheet.timeSignature);
  assert.deepEqual(derived.notes.map((n) => n.solfa + n.octaveMark), ["s,", "d", "m", "d"]);
  assert.match(derived.solfaLines[0]!, /^Doh is G/);
  assert.equal(hymnSheet(hymn("x", "X", { tempo: 0 })).tempo, 90);
});

const xmas = { occasions: ["Christmas"] };
const silent = hymn("silent-night", "Silent Night", {
  ...xmas, firstLine: "Silent night, holy night,", tune: "STILLE NACHT", key: "Bb major", time: "6/8",
  notes: [[65, 0, 1.5], [67, 1.5, 0.5], [65, 2, 1], [62, 3, 3], [65, 6, 1.5], [67, 7.5, 0.5], [65, 8, 1], [62, 9, 3], [72, 12, 2]],
});
const joy = hymn("joy-to-the-world", "Joy to the World", {
  ...xmas, key: "D major", time: "2/4",
  notes: [[74, 0, 1], [73, 1, 0.75], [71, 1.75, 0.25], [69, 2, 1.5], [67, 3.5, 0.5], [66, 4, 1], [64, 5, 1], [62, 6, 1.5]],
});
const hark = hymn("hark-the-herald-angels-sing", "Hark! The Herald Angels Sing", {
  ...xmas, key: "F major", notes: [[60, 0, 1], [65, 1, 1], [65, 2, 1.5], [64, 3.5, 0.5], [65, 4, 1], [69, 5, 1], [69, 6, 1], [67, 7, 1]],
});
const gentle = hymn("gentle-mary-laid-her-child", "Gentle Mary Laid Her Child", xmas);
const advent = hymn("o-come-o-come-emmanuel", "O Come, O Come, Emmanuel", { occasions: ["Advent"] });
const shelf = [gentle, advent, hark, ag, joy, silent, hymn("broken", "Broken", { occasions: "Christmas" as unknown as string[] })];

test("the Christmas shelf: only the carols tagged Christmas, the best known first, the rest by title", () => {
  assert.deepEqual(carols(shelf).map((h) => h.slug), ["silent-night", "joy-to-the-world", "hark-the-herald-angels-sing", "gentle-mary-laid-her-child"]);
  assert.deepEqual(carols([ag, advent]), []);
});

test("each carol card opens with its first notes in solfa, as the engine labels them, and its key and time", () => {
  const label = (h: PackHymn) => openingLine(deriveSolfa(hymnSheet(h).notes, h.key, h.time).notes);
  assert.equal(label(silent), "s l s m s l s m");
  assert.equal(label(joy), "d' t l s f m r d");
  assert.equal(label(hark), "s, d d t, d m m r");
  assert.equal(keyAndTime(silent), "Bb · 6/8");
  assert.equal(keyAndTime({ key: "E minor", time: "3/4" }), "Em · 3/4");
});

test("search finds a carol by its occasion: 'christmas', 'carol' or 'carols'", () => {
  const names = (q: string) => searchHymns(shelf, q).map((h) => h.slug);
  assert.deepEqual(names("carol"), ["gentle-mary-laid-her-child", "hark-the-herald-angels-sing", "joy-to-the-world", "silent-night"]);
  assert.deepEqual(names("christmas"), names("carols"));
  assert.deepEqual(names("advent"), ["o-come-o-come-emmanuel"]);
  // a title still outranks an occasion
  assert.deepEqual(names("silent")[0], "silent-night");
});

test("sizes read as people say them", () => {
  assert.equal(formatBytes(700_414), "684 KB");
  assert.equal(formatBytes(3_250_000), "3.1 MB");
  assert.equal(formatBytes(500), "500 B");
});
