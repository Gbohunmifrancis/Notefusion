#!/usr/bin/env node
// Imports the Christian Classics Ethereal Hymnary's tunes into content/hymns/tunes, as tune pages.
//
//   node tools/blog/import/cceh-run.mjs --cache DIR [--date YYYY-MM-DD] [--dry-run]
//
// DIR is the crawl's cache, downloaded beforehand by tools/blog/import/cceh-crawl.py (politely: one request
// at a time, ten seconds apart, as CCEL's robots.txt asks):
//   DIR/idx0000.html … idx0013.html   the tune lists (https://www.ccel.org/cceh/NNNN/index.htm)
//   DIR/pages/xNNNNNN.htm             each tune's page
//   DIR/files/NNNNNNa.mid             the MIDI file the crawl chose for it (cceh-crawl.py choose_midi)
// The files are data: read and parsed here, never run. See docs/BLOG.md, "Importing tunes from the CCEH".
//
// For every tune whose page is cached: convert (import/cceh.mjs), then
//   - copyright on the page or in the file, or anyone named who died in 1955 or later: refused, nothing copied;
//   - no voice of the MIDI file matches the incipit, or no MIDI file: rejected, nothing copied;
//   - the same melody as a tune already on the site (compared by its intervals, so the key does not
//     matter) or as an earlier CCEH tune: a duplicate, ours is kept;
//   - otherwise a tune page, published when every gate passes, else a draft with the reasons.
// Tune files this importer wrote before and no longer produces (for a page that is cached) are removed;
// every other file in content/hymns/tunes is left alone. The run ends with tools/blog/import/cceh-report.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTENT_DIR } from "../lib/site.mjs";
import { parseMelody } from "../lib/solfa.mjs";
import { parseTunePage } from "./cceh-page.mjs";
import { convertTune, datesTable, normName, fileUrl, SOURCE_NAME } from "./cceh.mjs";

const HYMNS_DIR = path.join(CONTENT_DIR, "hymns");
const TUNES_DIR = path.join(HYMNS_DIR, "tunes");
export const REPORT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "cceh-report.json");

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const jsonText = (x) => JSON.stringify(x, null, 2) + "\n";
const sameExceptDate = (a, b) => jsonText({ ...a, updated: null }) === jsonText({ ...b, updated: null });
function loadDir(dir) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) out.set(f.replace(/\.json$/, ""), readJson(path.join(dir, f)));
  return out;
}

/** The tune list, in CCEH's order: [{folder, number, name}] from the cached index pages. */
export function readIndex(cache) {
  const out = [];
  for (const f of fs.readdirSync(cache).filter((f) => /^idx\d{4}\.html$/.test(f)).sort()) {
    const t = fs.readFileSync(path.join(cache, f), "latin1");
    for (const m of t.matchAll(/href="x(\d{6})\.htm">([\s\S]*?)<\/a>/g)) out.push({ folder: f.slice(3, 7), number: m[1], name: m[2].trim() });
  }
  return out;
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/**
 * Whether two melodies are the same tune, whatever their keys: their first 24 notes (or as many as the
 * shorter has, at least 10; repeated notes run together), as pitch classes moved into the key that fits
 * best, differ by at most one note in six — one book's passing note or altered note is the same tune.
 * Returns the number of differing notes, or null when they are different tunes.
 */
export function sameMelody(a, b) {
  const pcs = (notes) => notes.map((n) => n.pitchMidi).filter((p, i, arr) => !i || p !== arr[i - 1]).map((p) => ((p % 12) + 12) % 12);
  const pa = pcs(a), pb = pcs(b);
  const n = Math.min(pa.length, pb.length, 24);
  if (n < 10) return null;
  let d = Infinity;
  for (let t = 0; t < 12; t++) d = Math.min(d, editDistance(pa.slice(0, n), pb.slice(0, n).map((p) => (p + t) % 12)));
  return d <= Math.round(n / 6) ? d : null;
}

/**
 * Dates checked by hand for people CCEH's pages name without them (tools/blog/import/cceh-dates.json):
 * {"John Bacchus Dykes": {"born": 1823, "died": 1876, "source": "where the dates were checked"}}. Every
 * entry needs its source; the report's `undatedPeople` lists who would unlock the most tunes. Optional:
 * "correctName" prints the person as the sources spell them where CCEH misspells the name, and "lived"
 * ("19th century") is printed instead of the years when the sources disagree on who the person was or give no
 * death year, with "died" then the latest year they could have died.
 */
export const DATES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "cceh-dates.json");
export function readCheckedDates(file = DATES_PATH) {
  if (!fs.existsSync(file)) return {};
  const data = readJson(file);
  for (const [name, d] of Object.entries(data)) {
    if (!Number.isInteger(d.died) || typeof d.source !== "string" || !d.source.trim()) throw new Error(`cceh-dates.json: ${name} needs a "died" year and a "source"`);
    for (const f of ["correctName", "lived"]) if (d[f] != null && (typeof d[f] !== "string" || !d[f].trim())) throw new Error(`cceh-dates.json: ${name}: "${f}" is text`);
  }
  return data;
}

/** The people our pages already give dates for (hymns and tunes, from their own sources), CCEH's pages that print a life, and the dates checked by hand. */
export function buildDates({ hymns, tunes, pages, checked = readCheckedDates() }) {
  const dates = datesTable();
  for (const [name, d] of Object.entries(checked)) dates.add(name, { born: d.born, died: d.died, lived: d.lived, correctName: d.correctName, from: d.source });
  for (const [slug, t] of tunes) if (t.source !== SOURCE_NAME) for (const p of t.music || []) if (!p.traditional) dates.add(p.name, { born: p.born, died: p.died, lived: p.lived, from: `our page for the tune ${t.name} (content/hymns/tunes/${slug}.json)` });
  for (const [slug, h] of hymns) for (const p of h.text || []) if (!p.traditional) dates.add(p.name, { born: p.born, died: p.died, lived: p.lived, from: `our page for ${h.title} (content/hymns/${slug}.json)` });
  for (const { number, html } of pages) {
    for (const c of parseTunePage(html).credits) if (c.name && Number.isInteger(c.died)) dates.add(c.name.replace(/\s*\([^)]*\)\s*$/, ""), { born: c.born, died: c.died, from: `CCEH's page for tune ${number}` });
  }
  return dates;
}

export function runImport({ cache, today, dryRun = false, tunesDir = TUNES_DIR, hymnsDir = HYMNS_DIR, reportPath = REPORT_PATH, datesFile = DATES_PATH, log = console.log }) {
  const tunes = loadDir(tunesDir), hymns = loadDir(hymnsDir);
  const index = readIndex(cache);
  const pages = [];
  for (const e of index) {
    const f = path.join(cache, "pages", `x${e.number}.htm`);
    if (fs.existsSync(f)) pages.push({ ...e, html: fs.readFileSync(f, "latin1") });
  }
  const dates = buildDates({ hymns, tunes, pages, checked: readCheckedDates(datesFile) });
  // Files the crawl gave up on (moved or missing at CCEH): the tune is read without them.
  const failedPath = path.join(cache, "failed.json");
  const failed = new Set(fs.existsSync(failedPath) ? Object.keys(JSON.parse(fs.readFileSync(failedPath, "utf8"))) : []);

  // Our tunes with a melody, to find the ones CCEH would only repeat (any source but CCEH itself).
  const ours = [];
  for (const [slug, t] of tunes) {
    if (t.source === SOURCE_NAME) continue;
    let parsed = null;
    if (t.melody) try { parsed = parseMelody(t.melody, { time: t.time, pickup: t.pickup || 0 }); } catch { /* the build reports it */ }
    ours.push({ slug, t, parsed, names: [t.name, ...(t.alsoKnownAs || [])].map(normName) });
  }
  const hymnFor = (tuneSlug) => [...hymns].find(([, h]) => h.tune === tuneSlug)?.[0] || null;

  const report = { source: "Christian Classics Ethereal Hymnary (CCEH)", sourceUrl: "https://www.ccel.org/cceh/index.htm", date: today, rule: "Our public-domain rule (lib/content.mjs): everyone named died before 1955 and the tune was first published before 1929; missing dates make a draft; a © or anyone who died in 1955 or later means not imported.", published: [], drafts: [], duplicates: [], refused: [], rejected: [], sameNameDifferentTune: [], fillCandidates: [], undatedPeople: [], notYetCrawled: 0 };
  const out = new Map();
  const imported = []; // {slug, parsed, number}
  const taken = new Set([...tunes].filter(([, t]) => t.source !== SOURCE_NAME).map(([s]) => s));
  const processed = new Set();
  const undated = new Map();

  for (const e of index) {
    const pg = pages.find((x) => x.number === e.number);
    if (!pg) { report.notYetCrawled++; continue; }
    const p = parseTunePage(pg.html);
    // The MIDI file the crawl chose (cceh-crawl.py choose_midi), and the Noteworthy score of the same arrangement.
    const mid = p.files.find((f) => f.kind === "midi" && fs.existsSync(path.join(cache, "files", f.href))) || p.files.find((f) => f.kind === "midi");
    const midPath = mid ? path.join(cache, "files", mid.href) : null;
    if (mid && !fs.existsSync(midPath) && !failed.has(fileUrl(e.folder, mid.href))) { report.notYetCrawled++; continue; }
    const nwcHref = mid ? mid.href.replace(/\.mid$/i, ".nwc") : null;
    const nwcPath = nwcHref ? path.join(cache, "nwc", nwcHref) : null;
    const wantsNwc = nwcHref && p.files.some((f) => f.href === nwcHref) && !p.credits.some((c) => c.copyright);
    if (wantsNwc && !fs.existsSync(nwcPath) && !failed.has(fileUrl(e.folder, nwcHref))) { report.notYetCrawled++; continue; }
    processed.add(e.number);
    const r = convertTune({
      page: pg.html, number: e.number, dates,
      midi: midPath && fs.existsSync(midPath) ? fs.readFileSync(midPath) : null, midiHref: mid ? mid.href : null,
      nwc: nwcPath && fs.existsSync(nwcPath) ? fs.readFileSync(nwcPath) : null, nwcHref,
    });
    const label = { number: e.number, name: r.baseName, url: r.tune.sourceUrl };
    if (r.refused) { report.refused.push({ ...label, reason: r.refused }); continue; }
    if (!r.parsed) { report.rejected.push({ ...label, reason: r.problems.find((x) => /voice|MIDI|incipit|time signature|grid|parse/.test(x)) || r.problems.join("; ") }); continue; }

    // The same tune as one of ours (by its melody, in any key), or as a CCEH tune already taken.
    const dup = ours.map((o) => ({ o, d: o.parsed ? sameMelody(o.parsed.notes, r.parsed.notes) : null })).find((x) => x.d !== null);
    if (dup) { report.duplicates.push({ ...label, ours: dup.o.slug, oursSource: dup.o.t.source || "NoteFusion", hymn: hymnFor(dup.o.slug), edits: dup.d }); continue; }
    const dupCceh = imported.find((x) => sameMelody(x.parsed.notes, r.parsed.notes) !== null);
    if (dupCceh) { report.duplicates.push({ ...label, ours: dupCceh.slug, oursSource: SOURCE_NAME, edits: sameMelody(dupCceh.parsed.notes, r.parsed.notes) }); continue; }
    // A tune page that names no one for the music cannot be a page of ours, not even a draft: the content
    // gate needs someone credited, and we never invent one.
    if (!r.tune.music?.length) { report.rejected.push({ ...label, reason: "the page names no composer or source for the tune" }); continue; }
    const names = [r.baseName, ...(r.tune.alsoKnownAs || [])].map(normName);
    const sameName = ours.filter((o) => o.names.some((n) => names.includes(n)));
    for (const o of sameName) {
      if (o.parsed) report.sameNameDifferentTune.push({ ...label, ours: o.slug });
      else report.fillCandidates.push({ ...label, ours: o.slug, hymn: hymnFor(o.slug), note: "our tune has no melody yet; this CCEH melody could fill it once its words are fitted" });
    }

    let slug = r.slug;
    if (taken.has(slug)) slug = `${r.slug}-${Number(e.number)}`;
    taken.add(slug);
    const tune = { ...r.tune, updated: today };
    out.set(slug, tune);
    imported.push({ slug, parsed: r.parsed, number: e.number });
    if (tune.draft) report.drafts.push({ slug, number: e.number, reasons: r.problems });
    else report.published.push({ slug, number: e.number });
    // Who is missing a death year, how many tunes they hold back, and how many only for want of dates.
    const deathYear = /^not provably public domain: (.+?): public domain needs a death year/;
    const onlyDates = r.problems.every((pr) => deathYear.test(pr));
    for (const pr of r.problems) {
      const m = deathYear.exec(pr);
      if (!m) continue;
      const u = undated.get(m[1]) || { name: m[1], tunes: 0, onlyForWantOfDates: 0, earliestYear: null };
      u.tunes++;
      if (onlyDates) u.onlyForWantOfDates++;
      const y = r.page.credits.filter((c) => c.name === m[1] && c.year).map((c) => c.year);
      if (y.length) u.earliestYear = Math.min(u.earliestYear ?? Infinity, ...y);
      undated.set(m[1], u);
    }
  }
  report.undatedPeople = [...undated.values()].sort((a, b) => b.onlyForWantOfDates - a.onlyForWantOfDates || b.tunes - a.tunes || a.name.localeCompare(b.name));

  // Write: new and changed files; a file whose only change is the date keeps its old date.
  let written = 0, removed = 0;
  for (const [slug, t] of out) {
    const old = tunes.get(slug);
    let data = t;
    if (old && sameExceptDate(old, data)) data = { ...data, updated: old.updated };
    if (old && jsonText(old) === jsonText(data)) continue;
    written++;
    if (!dryRun) fs.writeFileSync(path.join(tunesDir, slug + ".json"), jsonText(data));
  }
  // Remove what an earlier run imported for a page this run read, and did not produce now.
  for (const [slug, t] of tunes) {
    if (t.source !== SOURCE_NAME || out.has(slug)) continue;
    const n = String(t.importedFrom || "").replace(/^cceh:/, "");
    if (!processed.has(n)) continue;
    if ([...hymns.values()].some((h) => h.tune === slug)) continue; // a hymn uses it now: keep it
    removed++;
    if (!dryRun) fs.rmSync(path.join(tunesDir, slug + ".json"));
  }

  report.counts = Object.fromEntries(["published", "drafts", "duplicates", "refused", "rejected"].map((k) => [k, report[k].length]));
  report.counts.pages = processed.size;
  report.counts.notYetCrawled = report.notYetCrawled;
  report.counts.tunesInIndex = index.length;
  delete report.notYetCrawled;
  if (!dryRun) fs.writeFileSync(reportPath, jsonText(report));
  log(`${processed.size} of ${index.length} CCEH tunes read: ${report.counts.published} published, ${report.counts.drafts} drafts, ${report.counts.duplicates} already on the site, ${report.counts.refused} refused (copyright), ${report.counts.rejected} rejected (no melody we could verify, or no one named for the music); ${report.counts.notYetCrawled} not crawled yet. ${written} files written, ${removed} removed${dryRun ? " (dry run: nothing written)" : ""}.`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const cache = get("--cache");
  if (!cache || !fs.existsSync(cache)) { console.error("Usage: node tools/blog/import/cceh-run.mjs --cache DIR [--date YYYY-MM-DD] [--dry-run]"); process.exit(2); }
  const today = get("--date") || new Date().toISOString().slice(0, 10);
  try { runImport({ cache: path.resolve(cache), today, dryRun: args.includes("--dry-run") }); }
  catch (e) { console.error(`Import failed: ${e.stack || e.message}`); process.exit(1); }
}
