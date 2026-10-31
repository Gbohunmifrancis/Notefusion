// The app's offline hymn pack (web-site/hymns/pack.json + pack-version.json): every published hymn and
// tune page, the melody exactly as the hymn page and the worker's index hold it, a version that moves only
// when the content does, and a size small enough to download on mobile data.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildSite } from "../build.mjs";
import { SITE_DIR } from "../lib/site.mjs";
import { loadAll } from "../lib/content.mjs";
import { hymnPackFiles, packErrors, PACK_PATH, PACK_VERSION_PATH, PACK_FORMAT } from "../lib/hymn-pack.mjs";

const { files, hymnIndex, summary } = buildSite();
const packText = files.get(PACK_PATH);
const versionText = files.get(PACK_VERSION_PATH);
// Words set by metre to a tune we hold (import/watts.mjs) are pages, but not in the pack.
const setByMetre = loadAll().hymns.filter((h) => h.setByMetre).length;
const pack = JSON.parse(packText);
const meta = JSON.parse(versionText);
const index = JSON.parse(hymnIndex);

test("the build writes the pack and its version file, and the committed copies are current", () => {
  assert.ok(packText && versionText);
  assert.equal(fs.readFileSync(path.join(SITE_DIR, PACK_PATH), "utf8"), packText);
  assert.equal(fs.readFileSync(path.join(SITE_DIR, PACK_VERSION_PATH), "utf8"), versionText);
  assert.deepEqual(packErrors(packText, versionText), []);
});

test("every published hymn and tune page is in it, and nothing else", () => {
  assert.equal(pack.format, PACK_FORMAT);
  assert.equal(pack.hymnCount, summary.hymns - setByMetre);
  assert.equal(pack.count, summary.hymns - setByMetre + summary.tunes);
  // The pack is the Hymns screen's: famous pieces that are not hymns are recognised, never listed there.
  const scoreSlugs = new Set(index.entries.filter((e) => e.kind === "score" && e.category !== "piece").map((e) => e.slug));
  assert.deepEqual(new Set(pack.hymns.map((h) => h.slug)), scoreSlugs);
});

test("an entry carries the melody exactly as the worker's index does, with the words and the credit", () => {
  const byIndex = new Map(index.entries.map((e) => [e.slug, e]));
  for (const h of pack.hymns) {
    const e = byIndex.get(h.slug);
    assert.deepEqual(h.notes, e.notes, h.slug);
    assert.equal(h.key, e.key, h.slug);
    assert.equal(h.time, e.time, h.slug);
    assert.equal(h.pickup, e.pickup, h.slug);
    assert.equal(h.credit, e.credit, h.slug);
    assert.equal(h.words, e.lyrics, h.slug);
  }
  const ag = pack.hymns.find((h) => h.slug === "amazing-grace");
  assert.equal(ag.kind, "hymn");
  assert.match(ag.firstLine, /^Amazing grace/i);
  assert.ok(ag.verses.length >= 4 && ag.verses.every((v) => v.lines.length > 0));
  const tune = pack.hymns.find((h) => h.kind === "tune");
  assert.equal(tune.words, "");
  assert.deepEqual(tune.verses, []);
});

test("the version file names the pack's version and its exact size; the version follows the content", () => {
  assert.equal(meta.version, pack.version);
  assert.equal(meta.bytes, Buffer.byteLength(packText, "utf8"));
  assert.match(meta.url, /^https:\/\/notefusion\.studio\/hymns\/pack\.json$/);
  // Deterministic: the same content gives the same version.
  assert.equal(buildSite().files.get(PACK_VERSION_PATH), versionText);
  // A one-word change gives a new one.
  const hymns = [{ slug: "x", title: "X", draft: false, verses: [{ lines: ["One"] }], underlay: "One", view: { credit: { text: "c" } }, tuneData: { name: "T", key: "C major", time: "4/4", tempo: 90, pickup: 0, parsed: { notes: [{ pitchMidi: 60, startBeat: 0, durBeats: 1 }] } } }];
  const a = JSON.parse(hymnPackFiles(hymns).version).version;
  hymns[0].verses[0].lines[0] = "Two";
  assert.notEqual(JSON.parse(hymnPackFiles(hymns).version).version, a);
});

test("small enough for mobile data: under 2 MB as written", () => {
  assert.ok(meta.bytes < 2 * 1024 * 1024, `${meta.bytes} bytes`);
});

test("packErrors catches a version file that disagrees with the pack", () => {
  const wrong = JSON.stringify({ ...meta, bytes: meta.bytes + 1 });
  assert.match(packErrors(packText, wrong).join("\n"), /bytes/);
});

test("the carols and the Halloween songs carry their occasions, for the app's season shelves", () => {
  const carols = pack.hymns.filter((h) => h.occasions?.includes("Christmas")).map((h) => h.slug).sort();
  assert.deepEqual(carols, [
    "angels-from-the-realms-of-glory", "angels-we-have-heard-on-high", "away-in-a-manger", "christians-awake-salute-the-happy-morn",
    "far-far-away-on-judeas-plains",
    "gentle-mary-laid-her-child", "good-king-wenceslas", "hark-the-herald-angels-sing", "i-heard-the-bells-on-christmas-day",
    "it-came-upon-a-midnight-clear", "joy-to-the-world", "o-come-all-ye-faithful", "o-little-town-of-bethlehem",
    "of-the-fathers-love-begotten-divinum-mysterium-isorythmic", "once-in-royal-davids-city", "see-amid-the-winters-snow",
    "silent-night", "the-first-noel", "to-shepherds-as-they-watched-by-night", "while-shepherds-watched-their-flocks",
  ]);
  assert.ok(pack.hymns.every((h) => h.occasions === undefined || h.occasions.length > 0));
  // The Halloween shelf: hymns and tune pages alike carry the occasion, the All Saints tunes with "All Saints" too.
  const halloween = pack.hymns.filter((h) => h.occasions?.includes("Halloween"));
  for (const slug of ["tune-in-the-hall-of-the-mountain-king", "tune-toccata-in-d-minor", "tune-chopins-funeral-march", "tune-funeral-march-of-a-marionette", "tune-danse-macabre", "the-hearse-song", "tune-dies-irae", "for-all-the-saints"]) assert.ok(halloween.some((h) => h.slug === slug), slug);
  assert.deepEqual(pack.hymns.filter((h) => h.kind === "tune" && h.occasions?.includes("All Saints")).map((h) => h.slug).sort(), ["tune-all-saints-darmstadt", "tune-all-saints-new"]);
  const broken = JSON.stringify({ ...pack, hymns: [{ ...pack.hymns[0], occasions: [] }, ...pack.hymns.slice(1)] });
  assert.match(packErrors(broken, versionText).join("\n"), /unreadable occasions/);
});
