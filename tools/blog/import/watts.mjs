#!/usr/bin/env node
// Imports Isaac Watts' Hymns and Spiritual Songs (1707), or with --book psalms his Psalms of David Imitated (1719), into
// content/hymns as words pages, each set to a tune we hold in the hymn's metre, as words-only hymn books were sung.
//
//   node tools/blog/import/watts.mjs --src FILE [--book hymns|psalms] [--date YYYY-MM-DD] [--publish] [--dry-run]
//
// FILE is the book's plain text, downloaded beforehand into a directory of its own (Project Gutenberg eBook #13341, an
// 1818 London printing of the hymns; #13166, the psalms). It is data: read and parsed here, never run. Watts died in
// 1748, so the words are in the public domain; the pages name the book, not the transcription.
//
// For every hymn or psalm part (the doxologies and indexes at the end are left out):
//   - its metre is read off its lines: Common (8.6.8.6), Long (8.8.8.8) or Short (6.6.8.6), four-line verses only;
//     another metre, or lines that cannot be sung to the metre, and it is reported, nothing written;
//   - a hymn already on the site (its first line, or a title or other title of ours) is left alone;
//   - otherwise a page set to one of TUNES[metre], a tune sung one syllable to a note, picked by the page's slug so the
//     same hymn keeps its tune from run to run. Pages are drafts unless --publish, for a person to read first.
// Pages this importer wrote before and no longer produces are removed; no other file is touched.
// The run ends with the book's report: tools/blog/import/watts-report.json (hymns), watts-psalms-report.json (psalms).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTENT_DIR } from "../lib/site.mjs";
import { slugify } from "../lib/util.mjs";
import { parseMelody } from "../lib/solfa.mjs";
import { titleCase, normalizeTitle } from "./ohp.mjs";
import { fitLine, underlayDictionary, underlayOf } from "./syllables.mjs";

const HYMNS_DIR = path.join(CONTENT_DIR, "hymns");
const TUNES_DIR = path.join(HYMNS_DIR, "tunes");
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The two books: where their pages come from, what they are called, and their report. */
export const BOOKS = {
  hymns: { id: "watts-1707", year: 1707, title: "Hymns and Spiritual Songs", printing: "an 1818 London printing", report: path.join(HERE, "watts-report.json") },
  psalms: { id: "watts-1719", year: 1719, title: "The Psalms of David Imitated in the Language of the New Testament", printing: "an 1818 London printing", report: path.join(HERE, "watts-psalms-report.json") },
};
export const REPORT_PATH = BOOKS.hymns.report;
export const IMPORTED_FROM = BOOKS.hymns.id;

export const METRES = {
  CM: { name: "Common Metre", short: "C.M.", lines: [8, 6, 8, 6] },
  LM: { name: "Long Metre", short: "L.M.", lines: [8, 8, 8, 8] },
  SM: { name: "Short Metre", short: "S.M.", lines: [6, 6, 8, 6] },
};

/** Well-known tunes of each metre that sing one syllable to a note (checked against their melodies at every run). */
export const TUNES = {
  CM: ["st-anne", "winchester-old", "st-peter", "st-agnes", "st-flavian", "caithness", "york"],
  LM: ["old-hundredth", "winchester-new", "melcombe", "uxbridge"],
  SM: ["franconia", "boylston", "southwell", "aylesbury", "st-bride"],
};

const WATTS = { name: "Isaac Watts", born: 1674, died: 1748 };
const BOOK_NAMES = { 1: "Book I, collected from the Scriptures", 2: "Book II, composed on divine subjects", 3: "Book III, prepared for the Lord's Supper" };

/** The doh a key's signature gives: the tonic of a major key, the relative major of a minor one (la-based). */
const RELATIVE_MAJOR = { A: "C", E: "G", B: "D", "F#": "A", "C#": "E", "G#": "B", "D#": "F#", D: "F", G: "Bb", C: "Eb", F: "Ab", Bb: "Db", Eb: "Gb" };
export function dohOf(key) {
  const [tonic, mode] = String(key).split(" ");
  return mode === "minor" ? RELATIVE_MAJOR[tonic] : tonic;
}

/** The book's hymns: [{book, number, heading, verses: [[lines]]}], or its psalm parts: [{psalm, part, heading, verses}]. */
export function parseWatts(text, book = "hymns") {
  // The transcription types a dash as "--"; an underlay reads every "-" as a syllable break.
  const lines = String(text).replace(/\r/g, "").replace(/[ \t]*--[ \t]*/g, " — ").split("\n");
  const hymns = [];
  let cur = null, stanza = null, inHeading = false;
  const close = () => { if (stanza && stanza.length) cur.verses.push(stanza); stanza = null; };
  for (const raw of lines) {
    const line = raw.trim();
    const head = /^Hymn (\d+):(\d+)\.\s*(.*)$/.exec(line);
    // "Psalm 15:1. C. M.", "Psalm 5." (one part): what follows the number is the metre and the part, not a heading.
    // (In the hymns, "Psalm 147. 19 20." under a heading is the scripture the hymn is drawn from.)
    const psalm = book === "psalms" && /^Psalm (\d+)(?::(\d+))?\.(?:\s|$)/.exec(line);
    if (head || psalm) {
      if (cur) { close(); hymns.push(cur); }
      cur = head
        ? { book: Number(head[1]), number: Number(head[2]), heading: head[3] ? [head[3]] : [], verses: [] }
        : { psalm: Number(psalm[1]), part: psalm[2] ? Number(psalm[2]) : null, heading: [], verses: [] };
      inHeading = true;
      continue;
    }
    if (/^(Doxolog(y|ies)\.|\*\*\* END|Book \d+\.)/.test(line)) { if (cur) { close(); hymns.push(cur); cur = null; } continue; }
    if (!cur) continue;
    if (!line) { if (inHeading && cur.heading.length) inHeading = false; close(); continue; }
    if (/^\[\d+\]\s/.test(line)) continue;                                            // a footnote's text
    // "1 Blest is…", "1. My Shepherd…"; never "13. 16 17.", nor a scripture reference in a heading ("2 Cor. 12. 7 9 10.").
    const start = /^\[?(\d+)\.?\s+(\D.*)$/.exec(line);
    const reference = inHeading && /^\d+\s+\p{Lu}\p{Ll}*\.?\s+\d/u.test(line);
    if (start && !reference) { inHeading = false; close(); stanza = [start[2]]; continue; }
    if (inHeading) { cur.heading.push(line); continue; }
    if (stanza) stanza.push(line);
  }
  if (cur) { close(); hymns.push(cur); }
  // Watts' brackets mark verses that may be left out; the words are the same either way.
  // The transcription marks italics as _word_; an underlay reads "_" as a held note.
  // A footnote mark ("find [1]") is not sung.
  for (const h of hymns) h.verses = h.verses.map((v) => v.map((l) => l.replace(/\s*\[\d+\]/g, "").replace(/[[\]_]/g, "").trim()).filter(Boolean));
  return hymns;
}

/** The metre the hymn's lines sing best, if every verse has four lines and nearly every line fits it. */
export function metreOf(verses, dict) {
  if (!verses.length || verses.some((v) => v.length !== 4)) return { metre: null, why: "verses that are not four lines" };
  let best = null;
  for (const [id, m] of Object.entries(METRES)) {
    let fits = 0;
    for (const v of verses) v.forEach((l, i) => { if (fitLine(l, m.lines[i], dict)) fits++; });
    if (!best || fits > best.fits) best = { id, fits };
  }
  const total = verses.length * 4;
  if (best.fits / total < 0.8) return { metre: null, why: `no metre fits: at best ${best.fits} of ${total} lines as ${METRES[best.id].name}` };
  return { metre: best.id };
}

/** The first verse laid under a tune of the metre, one syllable to a note, or null. */
export function underlayFor(verse, metre, dict) {
  const fitted = verse.map((l, i) => fitLine(l, METRES[metre].lines[i], dict));
  return fitted.every(Boolean) ? underlayOf(fitted) : null;
}

/** A tune for the page, the same every run: picked from the metre's list by the slug. */
export function pickTune(slug, metre) {
  const list = TUNES[metre];
  const n = crypto.createHash("sha256").update(slug).digest().readUInt32BE(0);
  return list[n % list.length];
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const jsonText = (x) => JSON.stringify(x, null, 2) + "\n";
const firstWords = (s, n = 6) => normalizeTitle(s).split(" ").slice(0, n).join(" ");

export function runImport({ src, today, book = "hymns", publish = false, dryRun = false, hymnsDir = HYMNS_DIR, tunesDir = TUNES_DIR, reportPath = BOOKS[book].report, log = console.log }) {
  const B = BOOKS[book];
  const hymns = parseWatts(fs.readFileSync(src, "utf8"), book);
  const dict = underlayDictionary(hymnsDir);

  // The tunes, checked: published, a doh we can name, one note per syllable of the metre.
  const tunes = {};
  for (const [metre, list] of Object.entries(TUNES)) for (const slug of list) {
    const t = readJson(path.join(tunesDir, `${slug}.json`));
    const notes = parseMelody(t.melody, { time: t.time, pickup: t.pickup || 0 }).notes.length;
    const want = METRES[metre].lines.reduce((a, b) => a + b, 0);
    if (t.draft || !dohOf(t.key) || notes !== want) throw new Error(`${slug} cannot carry ${METRES[metre].name} one syllable to a note`);
    tunes[slug] = t;
  }

  // What we have: every hymn's first line, title and other titles; the files this importer wrote.
  const ours = new Map(), mine = new Set();
  for (const f of fs.readdirSync(hymnsDir).filter((f) => f.endsWith(".json"))) {
    const h = readJson(path.join(hymnsDir, f));
    const slug = f.replace(/\.json$/, "");
    if (h.importedFrom?.startsWith(`${B.id}:`)) { mine.add(slug); continue; }
    for (const t of [h.title, ...(h.alsoKnownAs || []), h.verses?.[0]?.lines?.[0]].filter(Boolean)) ours.set(firstWords(t), slug);
  }

  const report = { source: `Isaac Watts, ${B.title} (${B.year}), from ${B.printing}`, date: today, written: [], alreadyOurs: [], skipped: [], counts: {} };
  const keep = new Set();
  for (const h of hymns) {
    const ref = h.psalm ? `Psalm ${h.psalm}${h.part ? `:${h.part}` : ""}` : `${h.book}:${h.number}`;
    const first = h.verses[0]?.[0];
    if (!first) { report.skipped.push({ ref, why: "no verses" }); continue; }
    const have = ours.get(firstWords(first));
    if (have) { report.alreadyOurs.push({ ref, first, page: have }); continue; }
    const { metre, why } = metreOf(h.verses, dict);
    if (!metre) { report.skipped.push({ ref, first, why }); continue; }
    const underlay = underlayFor(h.verses[0], metre, dict);
    if (!underlay) { report.skipped.push({ ref, first, why: `its first verse cannot be sung as ${METRES[metre].name}` }); continue; }

    const title = titleCase(first.replace(/[\s,;:.!?—-]+$/u, ""));
    let slug = slugify(title);
    if (fs.existsSync(path.join(hymnsDir, `${slug}.json`)) && !mine.has(slug)) slug = `${slug}-watts${h.psalm ? "-psalm" : ""}`;
    if (keep.has(slug) || (fs.existsSync(path.join(hymnsDir, `${slug}.json`)) && !mine.has(slug))) { report.skipped.push({ ref, first, why: `the page ${slug} is taken` }); continue; }
    const tune = pickTune(slug, metre), t = tunes[tune];
    const doh = dohOf(t.key);
    const m = METRES[metre];
    let description = `${title} in Tonic Solfa to ${t.name}, doh is ${doh}: the solfa with the words, staff notation, ${h.verses.length} verses and a piano.`;
    if (description.length > 160) description = `${title}: Tonic Solfa to ${t.name} (doh is ${doh}), staff notation and ${h.verses.length} verses.`;
    if (description.length > 160) { report.skipped.push({ ref, first, why: "title too long for a description" }); continue; }
    const heading = h.heading.join(" ").replace(/\s+/g, " ").trim();
    const page = {
      title,
      tune,
      text: [{ ...WATTS, role: `Words (${B.year})` }],
      textPublished: B.year,
      description,
      about: [
        h.psalm
          ? `Isaac Watts wrote these words for The Psalms of David Imitated in the Language of the New Testament (1719): Psalm ${h.psalm}${h.part ? `, part ${h.part}` : ""}${heading ? `, headed “${heading.replace(/[.\s]+$/, "")}”` : ""}.`
          : `Isaac Watts wrote these words for his Hymns and Spiritual Songs (1707), ${BOOK_NAMES[h.book] || `Book ${h.book}`}, hymn ${h.number}${heading ? `, headed “${heading.replace(/[.\s]+$/, "")}”` : ""}.`,
        `Watts' ${h.psalm ? "psalms" : "hymns"} were printed without tunes and sung to any tune of their metre, ${m.name} (${m.lines.join(".")}). This page sets the words to ${t.name}; any other ${m.name} tune fits them as well.`,
      ],
      underlay,
      verses: h.verses.map((lines) => ({ lines })),
      metre: m.lines.join(" "),
      source: `Isaac Watts, ${h.psalm ? "The Psalms of David Imitated" : B.title} (${B.year})`,
      licence: "Public domain: Isaac Watts died in 1748.",
      credits: `Words by Isaac Watts (1674–1748), public domain; set to ${t.name} by NoteFusion, as words-only hymn books were sung.`,
      updated: today,
      reviewed: false,
      draft: !publish,
      setByMetre: true,
      importedFrom: `${B.id}:${ref}`,
    };
    keep.add(slug);
    report.written.push({ ref, slug, metre, tune });
    const file = path.join(hymnsDir, `${slug}.json`);
    if (!dryRun) {
      const old = fs.existsSync(file) ? readJson(file) : null;
      if (!old || jsonText({ ...old, updated: null }) !== jsonText({ ...page, updated: null })) fs.writeFileSync(file, jsonText(page));
    }
  }
  const removed = [...mine].filter((s) => !keep.has(s));
  if (!dryRun) for (const s of removed) fs.rmSync(path.join(hymnsDir, `${s}.json`));
  report.counts = { hymns: hymns.length, written: report.written.length, alreadyOurs: report.alreadyOurs.length, skipped: report.skipped.length, removed: removed.length };
  if (!dryRun) fs.writeFileSync(reportPath, jsonText(report));
  log(`Watts, ${B.title}: ${hymns.length} ${book === "psalms" ? "psalm parts" : "hymns"}; ${report.written.length} pages${publish ? "" : " (drafts)"}, ${report.alreadyOurs.length} already ours, ${report.skipped.length} skipped, ${removed.length} removed.`);
  return report;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const src = arg("--src");
  const book = arg("--book") || "hymns";
  if (!src || !BOOKS[book]) { console.error("usage: node tools/blog/import/watts.mjs --src FILE [--book hymns|psalms] [--date YYYY-MM-DD] [--publish] [--dry-run]"); process.exit(2); }
  const today = arg("--date") || new Date().toISOString().slice(0, 10);
  runImport({ src, today, book, publish: args.includes("--publish"), dryRun: args.includes("--dry-run") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
