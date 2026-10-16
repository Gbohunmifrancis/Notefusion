#!/usr/bin/env node
// Imports the Open Hymnal Project's public-domain hymns into content/hymns.
//
//   node tools/blog/import/run.mjs --src DIR [--date YYYY-MM-DD] [--dry-run]
//
// DIR holds the hymnal's ABC scores (http://openhymnal.org/Abc/<name>.abc, or the files of its
// "All ABC (source) files" zip), downloaded beforehand into a directory of their own. The scores are
// data: they are read as text and parsed here, never run. See docs/BLOG.md, "Importing from the
// Open Hymnal Project".
//
// For every score: convert (import/ohp.mjs), then
//   - a licence that is not plain public domain, or a writer who is living or died in 1955 or later:
//     not imported (listed in the report, nothing copied);
//   - the same hymn already on the site (title, other title or first line): ours is kept; when ours
//     is a words-only draft, its melody is filled in from the score;
//   - otherwise a new hymn and tune, published when every gate passes, else a draft with the reasons.
// Hymns the importer wrote before and no longer produces are removed; hand-written files never are.
// The run ends with tools/blog/import/ohp-report.json.
import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR } from "../lib/site.mjs";
import { slugify } from "../lib/util.mjs";
import { decodeAbc } from "./abc.mjs";
import { convertScore, normalizeTitle, retextUnderlay, SOURCE_NAME } from "./ohp.mjs";

const HYMNS_DIR = path.join(CONTENT_DIR, "hymns");
const TUNES_DIR = path.join(HYMNS_DIR, "tunes");
export const REPORT_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), "ohp-report.json");

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const jsonText = (x) => JSON.stringify(x, null, 2) + "\n";
const sameExceptDate = (a, b) => jsonText({ ...a, updated: null }) === jsonText({ ...b, updated: null });

function loadDir(dir) {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) out.set(f.replace(/\.json$/, ""), readJson(path.join(dir, f)));
  return out;
}

/** The first line of a hymn's words, normalised, as a matching key. */
const firstLineKey = (h) => (h.verses && h.verses[0] ? normalizeTitle(h.verses[0].lines[0]).split(" ").slice(0, 6).join(" ") : "");

export function runImport({ src, today, dryRun = false, hymnsDir = HYMNS_DIR, tunesDir = TUNES_DIR, log = console.log }) {
  const hymns = loadDir(hymnsDir), tunes = loadDir(tunesDir);
  const hand = [...hymns].filter(([, h]) => !h.importedFrom);
  const handKeys = new Map();
  for (const [slug, h] of hand) for (const k of [normalizeTitle(h.title), ...(h.alsoKnownAs || []).map(normalizeTitle), firstLineKey(h)]) if (k) handKeys.set(k, slug);
  const handTunes = new Set([...tunes].filter(([s, t]) => t.source !== SOURCE_NAME || hand.some(([, h]) => h.tune === s)).map(([s]) => s));

  const report = { source: SOURCE_NAME, date: today, published: [], drafts: [], filled: [], alreadyOnSite: [], notImported: [], unreadable: [] };
  const outHymns = new Map(), outTunes = new Map();
  const usedSlugs = new Set(hand.map(([s]) => s));
  const files = fs.readdirSync(src).filter((f) => f.toLowerCase().endsWith(".abc")).sort();

  for (const f of files) {
    const base = f.replace(/\.abc$/i, "");
    let r;
    try { r = convertScore(decodeAbc(fs.readFileSync(path.join(src, f))), { base, today }); }
    catch (e) { report.unreadable.push({ score: base, reason: e.message }); continue; }
    if (r.copyright) { report.notImported.push({ score: base, title: r.title, reason: r.copyright }); continue; }

    const keys = [normalizeTitle(r.title), ...(r.hymn.alsoKnownAs || []).map(normalizeTitle), firstLineKey(r.hymn)];
    const dupSlug = keys.map((k) => handKeys.get(k)).find(Boolean);
    if (dupSlug) {
      const ours = outHymns.get(dupSlug) || hymns.get(dupSlug);
      const ourTune = outTunes.get(ours.tune) || tunes.get(ours.tune);
      const wordsOnly = ourTune && (!ourTune.melody || ourTune.source === SOURCE_NAME);
      if (!wordsOnly || r.problems.length || !r.tune.melody) {
        report.alreadyOnSite.push({ score: base, slug: dupSlug, ...(wordsOnly ? { reason: `ours has no melody, but the score did not pass: ${r.problems.join("; ")}` } : {}) });
        continue;
      }
      // Fill our words-only draft with the score's melody, the words under the notes re-spelt as our verse prints them.
      const tune = { ...ourTune, key: r.tune.key, time: r.tune.time, tempo: r.tune.tempo, pickup: r.tune.pickup, lineBars: r.tune.lineBars, melody: r.tune.melody, reviewed: false, confidence: r.tune.confidence, source: SOURCE_NAME, sourceUrl: r.tune.sourceUrl, licence: r.tune.licence };
      const hymn = { ...ours };
      const ourWords = [ours.verses[0], ...(ours.verses[1] && /refrain|chorus/i.test(ours.verses[1].label || "") ? [ours.verses[1]] : [])].flatMap((v) => v.lines).join(" ");
      let held = null;
      try { hymn.underlay = retextUnderlay(r.hymn.underlay, ourWords); }
      catch (e) { held = e.message; hymn.underlay = r.hymn.underlay; }
      hymn.draft = !!held;
      hymn.updated = today;
      tune.reviewNotes = [
        held ? `Held back: the Open Hymnal's first verse does not match the verse printed on this page (${held}); fit the underlay to our words, then publish.` : "",
        `Melody filled in from the Open Hymnal Project's ABC score (${base}); the words under the notes are this page's first verse, fitted to the score's syllables.`,
        r.tune.reviewNotes,
      ].filter(Boolean).join(" ");
      outTunes.set(ours.tune, tune);
      outHymns.set(dupSlug, hymn);
      report.filled.push({ score: base, slug: dupSlug, ...(held ? { draft: held } : {}) });
      continue;
    }

    // A new hymn. Its slug is the title's; a second hymn of the same title adds its tune's name.
    let slug = r.slug;
    if (usedSlugs.has(slug)) slug = `${r.slug}-${slugify(r.tune.name)}`;
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${r.slug}-${n}`;
    usedSlugs.add(slug);
    // Its tune: the same tune file when the melody is note for note the same, else one of its own.
    const tuneBase = slugify(r.tune.name) || slug;
    const same = (t) => t && t.melody && r.tune.melody && t.melody === r.tune.melody && t.key === r.tune.key && t.time === r.tune.time && (t.pickup || 0) === r.tune.pickup;
    let tuneSlug = tuneBase;
    const existing = outTunes.get(tuneBase) || (handTunes.has(tuneBase) ? tunes.get(tuneBase) : null);
    if (existing && !same(existing)) tuneSlug = `${tuneBase}-${slug}`;
    if (!existing || !same(existing)) outTunes.set(tuneSlug, { ...r.tune });
    const hymn = { ...r.hymn, tune: tuneSlug, importedFrom: base };
    if (hymn.draft) hymn.reviewNotes = `Held back: ${r.problems.join("; ")}.`;
    outHymns.set(slug, hymn);
    (hymn.draft ? report.drafts : report.published).push(hymn.draft ? { slug, score: base, reasons: r.problems } : { slug, score: base });
  }

  // Write: new and changed files; a file whose only change is the date keeps its old date.
  let written = 0;
  const write = (dir, slug, data, old) => {
    if (old && sameExceptDate(old, data)) data = { ...data, updated: old.updated };
    if (old && jsonText(old) === jsonText(data)) return;
    written++;
    if (!dryRun) fs.writeFileSync(path.join(dir, slug + ".json"), jsonText(data));
  };
  for (const [slug, t] of outTunes) write(tunesDir, slug, t, tunes.get(slug));
  for (const [slug, h] of outHymns) write(hymnsDir, slug, h, hymns.get(slug));
  // Remove what an earlier run imported and this one did not produce.
  let removed = 0;
  for (const [slug, h] of hymns) if (h.importedFrom && !outHymns.has(slug)) { removed++; if (!dryRun) fs.rmSync(path.join(hymnsDir, slug + ".json")); }
  const usedTunes = new Set([...hand.map(([, h]) => h.tune), ...[...outHymns.values()].map((h) => h.tune)]);
  for (const [slug, t] of tunes) if (t.source === SOURCE_NAME && !handTunes.has(slug) && !usedTunes.has(slug)) { removed++; if (!dryRun) fs.rmSync(path.join(tunesDir, slug + ".json")); }

  report.counts = Object.fromEntries(["published", "drafts", "filled", "alreadyOnSite", "notImported", "unreadable"].map((k) => [k, report[k].length]));
  report.counts.scores = files.length;
  if (!dryRun) fs.writeFileSync(REPORT_PATH, jsonText(report));
  log(`${files.length} scores: ${report.counts.published} published, ${report.counts.drafts} drafts, ${report.counts.filled} filled in, ${report.counts.alreadyOnSite} already on the site, ${report.counts.notImported} not imported (copyright), ${report.counts.unreadable} unreadable. ${written} files written, ${removed} removed${dryRun ? " (dry run: nothing written)" : ""}.`);
  return report;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const src = get("--src");
  if (!src || !fs.existsSync(src)) { console.error("Usage: node tools/blog/import/run.mjs --src DIR [--date YYYY-MM-DD] [--dry-run]"); process.exit(2); }
  const today = get("--date") || new Date().toISOString().slice(0, 10);
  try { runImport({ src: path.resolve(src), today, dryRun: args.includes("--dry-run") }); }
  catch (e) { console.error(`Import failed: ${e.stack || e.message}`); process.exit(1); }
}
