// server/app/data/hymn_index.json: every hymn we hold, as the transcription worker's hymn matcher
// (server/app/pipeline/hymn_match.py) reads it. A sung take whose tune matches an entry is offered the
// hymnbook version — exact notes, rhythm, bar lines, pickup and time signature, in the key that was sung.
//
// The index is generated from content/ (published hymns only, never a draft), committed, and checked
// by `node check.mjs` like the pages: a hymn added to content/ is matched once the build is re-run. Each
// entry is one of two kinds:
//   "score"    a published hymn with its whole melody (one verse, with any refrain): the matcher may offer
//              its notes, and the clients swap the sheet to them.
//   "incipit"  recognition only: an opening phrase with a title and a link, for a library that grows beyond
//              the scores we may publish (content/hymns/incipits/*.json). A match names the tune and links to
//              it; it never offers a hymnbook version.
// A famous piece that is not a hymn (content/pieces/*.json: classical themes, folk, children's songs, carols,
// anthems, all public domain) is a "score" entry with `category: "piece"`: matched and offered like a hymn, so
// a photo of its sheet music or a hummed take is named and its published notes put right what was misread;
// the clients call it the published version rather than the hymnbook's.
// Every entry carries where it came from (`source`), its licence and the credit line its page shows.
import fs from "node:fs";
import path from "node:path";
import { ORIGIN, REPO_ROOT, CONTENT_DIR } from "./site.mjs";
import { parsePitch } from "./solfa.mjs";
import { creditLine, OHP } from "./render-hymns.mjs";
import { tuneMatcherEntry } from "./render-tunes.mjs";

export const HYMN_INDEX_PATH = path.join(REPO_ROOT, "server", "app", "data", "hymn_index.json");
export const INCIPITS_DIR = path.join(CONTENT_DIR, "hymns", "incipits");
export const PIECES_DIR = path.join(CONTENT_DIR, "pieces");

const round = (x) => Math.round(x * 1000) / 1000;

/** A published hymn as a "score" entry. `h` has been through prepareHymn (it needs h.view's credit). */
function scoreEntry(h) {
  const t = h.tuneData;
  const fromOhp = h.source === OHP.name || t.source === OHP.name;
  return {
    kind: "score",
    slug: h.slug,
    title: h.title,
    tune: t.name,
    url: `${ORIGIN}/hymns/${h.slug}`,
    source: h.source || t.source || "NoteFusion",
    licence: h.licence || t.licence || "Public domain.",
    credit: creditLine(h).text,
    // Hand-encoded hymns were checked against other public sources; the matcher prefers them when two
    // entries share a tune.
    checked: !fromOhp,
    key: t.key,
    time: String(t.time),
    pickup: t.pickup || 0,
    tempo: t.tempo,
    // [MIDI pitch, start beat, length in beats]: quarter-note beats, a pickup at the end of the first bar
    // (lib/solfa parseMelody), so every bar line falls where the clients draw one.
    notes: t.parsed.notes.map((n) => [n.pitchMidi, round(n.startBeat), round(n.durBeats)]),
    lyrics: h.underlay || "",
  };
}

/**
 * Recognition-only entries from content/hymns/incipits/*.json: {title, url, source, licence, credit,
 * incipit: "G4:1 B4:2 …"} (PITCH:BEATS tokens, no bar lines; the opening phrase only).
 */
export function loadIncipits(dir = INCIPITS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const file = path.join(dir, f);
    const x = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const k of ["title", "url", "source", "licence", "credit", "incipit"]) {
      if (typeof x[k] !== "string" || !x[k].trim()) throw new Error(`hymns/incipits/${f}: "${k}" is required`);
    }
    if (!/^https?:\/\/\S+$/.test(x.url)) throw new Error(`hymns/incipits/${f}: "url" must be a web address`);
    let t = 0;
    const notes = x.incipit.trim().split(/\s+/).map((tok) => {
      const m = /^([^:]+):(\d*\.?\d+)$/.exec(tok);
      if (!m) throw new Error(`hymns/incipits/${f}: cannot read "${tok}" (write PITCH:BEATS, e.g. G4:1)`);
      const n = [parsePitch(m[1]), round(t), round(Number(m[2]))];
      t += Number(m[2]);
      return n;
    });
    if (notes.length < 8) throw new Error(`hymns/incipits/${f}: an incipit needs at least 8 notes to be recognised safely`);
    return { kind: "incipit", slug: f.replace(/\.json$/, ""), title: x.title, tune: x.tune || "", url: x.url, source: x.source, licence: x.licence, credit: x.credit, notes };
  });
}

const KEY_TEXT = /^[A-G](#|b)? (major|minor)$/;
const TIME_TEXT = /^\d+\/\d+$/;

/**
 * The famous pieces in content/pieces/*.json: {title, composer, origin, category, url, source, licence, key, time,
 * pickup, tempo, notes: "E5:0.5 D#5:0.5 r:1 …"} (PITCH:BEATS in quarter-note beats, r for a rest), as "score"
 * entries with `category: "piece"`. A pickup puts the first note at the end of the first bar, as a hymn's does.
 */
export function loadPieces(dir = PIECES_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const x = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const k of ["title", "composer", "origin", "category", "source", "licence", "key", "time", "notes"]) {
      if (typeof x[k] !== "string" || !x[k].trim()) throw new Error(`pieces/${f}: "${k}" is required`);
    }
    if (x.url && !/^https:\/\/\S+$/.test(x.url)) throw new Error(`pieces/${f}: "url" must be a web address`);
    if (!KEY_TEXT.test(x.key)) throw new Error(`pieces/${f}: "key" must read like "G major" or "F# minor"`);
    if (!TIME_TEXT.test(x.time)) throw new Error(`pieces/${f}: "time" must read like "3/4"`);
    const [num, den] = x.time.split("/").map(Number);
    const pickup = Number(x.pickup || 0);
    const bar = (num * 4) / den;
    if (!(pickup >= 0 && pickup < bar)) throw new Error(`pieces/${f}: "pickup" must be under a bar`);
    let t = pickup ? bar - pickup : 0;
    const notes = [];
    for (const tok of x.notes.trim().split(/\s+/)) {
      const m = /^([^:]+):(\d*\.?\d+)$/.exec(tok);
      if (!m) throw new Error(`pieces/${f}: cannot read "${tok}" (write PITCH:BEATS, e.g. G4:1, or r:1 for a rest)`);
      const beats = Number(m[2]);
      if (m[1] !== "r") notes.push([parsePitch(m[1]), round(t), round(beats)]);
      t += beats;
    }
    if (notes.length < 12) throw new Error(`pieces/${f}: a piece needs at least 12 notes to be recognised safely`);
    const credit = x.composer.startsWith("Traditional")
      ? `${x.title}, ${x.composer.replace(/^Traditional/, "a traditional melody")} (${x.origin}).`
      : `${x.title} by ${x.composer}.`;
    return {
      kind: "score", category: "piece", slug: `piece-${f.replace(/\.json$/, "")}`, title: x.title, tune: "",
      url: x.url || "", source: x.source, licence: x.licence, credit, checked: false, key: x.key, time: x.time,
      pickup, tempo: Number(x.tempo) || 100, notes, lyrics: "",
    };
  });
}

/** The index as committed: one entry a line, sorted by slug, so a change to one hymn is a one-line diff. */
export function hymnIndexJson(hymns, incipits = loadIncipits(), tunes = [], pieces = loadPieces()) {
  const entries = [...hymns.filter((h) => !h.draft && !h.setByMetre).map(scoreEntry), ...tunes.map(tuneMatcherEntry), ...incipits, ...pieces].sort((a, b) => a.slug.localeCompare(b.slug));
  const slugs = new Set();
  for (const e of entries) {
    if (slugs.has(e.slug)) throw new Error(`hymn index: two entries are called "${e.slug}"`);
    slugs.add(e.slug);
  }
  return `{"version": 1, "generatedBy": "tools/blog/build.mjs from content/hymns (published hymns and tune pages only) and content/pieces; do not edit by hand",\n"entries": [\n${entries.map((e) => JSON.stringify(e)).join(",\n")}\n]}\n`;
}
