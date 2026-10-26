// The worker's hymn index (server/app/data/hymn_index.json): built from the published hymns only, every
// entry credited, and each score entry's notes exactly the tune the hymn page shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAll } from "../lib/content.mjs";
import { prepareHymn } from "../lib/render-hymns.mjs";
import { hymnIndexJson, loadIncipits, HYMN_INDEX_PATH } from "../lib/hymn-index.mjs";
import { buildSite } from "../build.mjs";

const { hymns, allHymns } = loadAll();
hymns.forEach(prepareHymn);
const built = buildSite().hymnIndex;
const index = JSON.parse(built);

test("the committed index is what the build writes (the CI staleness check covers it too)", () => {
  assert.equal(fs.readFileSync(HYMN_INDEX_PATH, "utf8"), built);
});

test("every published hymn is a score entry, and no draft is", () => {
  const slugs = new Set(index.entries.map((e) => e.slug));
  // Words set by metre to a tune we hold (import/watts.mjs) are pages, never recognised as a hymn.
  const scored = hymns.filter((h) => !h.setByMetre);
  for (const h of scored) assert.ok(slugs.has(h.slug), h.slug);
  for (const h of allHymns.filter((x) => x.draft || x.setByMetre)) assert.ok(!slugs.has(h.slug), `${h.slug} is in the index`);
  assert.equal(index.entries.filter((e) => e.kind === "score" && !e.slug.startsWith("tune-")).length, scored.length);
});

test("every entry says where it came from, under what licence, with the credit line its page shows", () => {
  for (const e of index.entries) {
    for (const k of ["slug", "title", "url", "source", "licence", "credit"]) assert.ok(typeof e[k] === "string" && e[k].trim(), `${e.slug}: ${k}`);
    assert.match(e.url, /^https:\/\/notefusion\.studio\/hymns\//);
  }
  const ag = index.entries.find((e) => e.slug === "amazing-grace");
  assert.equal(ag.credit, hymns.find((h) => h.slug === "amazing-grace").view.credit.text);
});

test("a score entry carries the tune exactly: notes, key, time, pickup and the first verse's words", () => {
  const ag = index.entries.find((e) => e.slug === "amazing-grace");
  assert.equal(ag.key, "G major");
  assert.equal(ag.time, "3/4");
  assert.equal(ag.pickup, 1);
  // D4 on beat 2 (the pickup at the end of the first bar), then G4 held two beats on the bar line.
  assert.deepEqual(ag.notes.slice(0, 3), [[62, 2, 1], [67, 3, 2], [71, 5, 0.5]]);
  assert.match(ag.lyrics, /^A-maz-ing/);
  for (const e of index.entries.filter((x) => x.kind === "score" && !x.slug.startsWith("tune-"))) {
    const h = hymns.find((x) => x.slug === e.slug);
    assert.equal(e.notes.length, h.tuneData.parsed.notes.length, e.slug);
  }
});

test("published tune pages (tunes without words) are score entries too, credited to their source, never drafts", () => {
  const tunes = index.entries.filter((e) => e.slug.startsWith("tune-"));
  assert.ok(tunes.length > 0, "the imported tunes reach the worker's index");
  for (const e of tunes) {
    assert.equal(e.kind, "score");
    assert.match(e.url, /^https:\/\/notefusion\.studio\/hymns\/tunes\//);
    assert.equal(e.lyrics, "");
    assert.ok(e.notes.length >= 8, e.slug);
  }
  const dir = path.join(import.meta.dirname, "..", "..", "..", "content", "hymns", "tunes");
  const drafts = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .filter((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).draft === true)
    .map((f) => "tune-" + f.replace(/\.json$/, ""));
  const slugs = new Set(tunes.map((e) => e.slug));
  assert.ok(drafts.length > 0);
  for (const d of drafts) assert.ok(!slugs.has(d), `draft ${d} is in the index`);
});

test("recognition-only incipits load from their own folder and need a source, a link and eight notes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-incipits-"));
  try {
    const entry = { title: "Some Tune", url: "https://example.org/some-tune", source: "Example Hymnary", licence: "Index data, CC0", credit: "Incipit from Example Hymnary.", incipit: "C4:1 D4:1 E4:1 F4:1 G4:2 A4:1 G4:1 E4:2" };
    fs.writeFileSync(path.join(dir, "some-tune.json"), JSON.stringify(entry));
    const [e] = loadIncipits(dir);
    assert.equal(e.kind, "incipit");
    assert.deepEqual(e.notes.slice(0, 2), [[60, 0, 1], [62, 1, 1]]);
    assert.ok(!("key" in e) && !("lyrics" in e), "an incipit never carries a score");
    fs.writeFileSync(path.join(dir, "short.json"), JSON.stringify({ ...entry, incipit: "C4:1 D4:1 E4:1" }));
    assert.throws(() => loadIncipits(dir), /at least 8 notes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
