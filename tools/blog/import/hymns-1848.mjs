#!/usr/bin/env node
// Imports A Book of Hymns for Public and Private Devotion (Samuel Longfellow and Samuel Johnson, Boston 1848; the
// fifteenth edition of 1866, with its supplement) into content/hymns as words pages, each set to a tune we hold in
// the metre the book prints over the hymn, as words-only hymn books were sung (the same way as import/watts.mjs).
//
//   node tools/blog/import/hymns-1848.mjs --src FILE [--date YYYY-MM-DD] [--publish] [--dry-run]
//
// FILE is the book's plain text, downloaded beforehand into a directory of its own (Project Gutenberg eBook #33180).
// It is data: read and parsed here, never run.
//
// For every hymn:
//   - its author must be one of AUTHORS (a name the book gives that we can name in full with their dates), or the
//     book's "Anonymous" or a collection it took the hymn from; another author (a surname we cannot place, or a
//     translation whose translator is not named) and it is reported, nothing written;
//   - its metre is the book's label read with the verse's length ("8 & 7s" in eight lines is 8.7.8.7 D); a metre we
//     hold no tune for, or lines that cannot be sung to it, and it is reported;
//   - a hymn already on the site (its first line, or a title or other title of ours) is left alone;
//   - otherwise a page set to one of METRES[pattern].tunes, picked by the page's slug so it keeps its tune.
// The words were in print by 1848 (hymns 1–479) or by 1866 (the supplement, 480–600): the pages say "in print by",
// never a made-up first publication. Pages this importer wrote before and no longer produces are removed; no other
// file is touched. The run ends with tools/blog/import/hymns-1848-report.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTENT_DIR } from "../lib/site.mjs";
import { slugify } from "../lib/util.mjs";
import { parseMelody } from "../lib/solfa.mjs";
import { titleCase, normalizeTitle } from "./ohp.mjs";
import { fitLine, underlayDictionary, underlayOf } from "./syllables.mjs";
import { TUNES as WATTS_TUNES, dohOf } from "./watts.mjs";

const HYMNS_DIR = path.join(CONTENT_DIR, "hymns");
const TUNES_DIR = path.join(HYMNS_DIR, "tunes");
export const REPORT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "hymns-1848-report.json");
export const IMPORTED_FROM = "hymns-1848";
const BOOK = "A Book of Hymns for Public and Private Devotion";
const SUPPLEMENT_FROM = 480;

/**
 * The metres we can set, by their syllables per line, each with tunes that sing one syllable to a note (checked
 * against their melodies at every run). Common, Long and Short Metre share Watts' tunes.
 */
export const METRES = {
  "8 6 8 6": { name: "Common Metre", tunes: WATTS_TUNES.CM },
  "8 6 8 6 8 6 8 6": { name: "Common Metre Double", tunes: ["materna", "all-saints-new"] },
  "8 8 8 8": { name: "Long Metre", tunes: WATTS_TUNES.LM },
  "8 8 8 8 8 8": { name: "Long Metre, six lines (8.8.8.8.8.8)", tunes: ["melita", "selena"] },
  "6 6 8 6": { name: "Short Metre", tunes: WATTS_TUNES.SM },
  "7 7 7 7": { name: "Sevens (7.7.7.7)", tunes: ["innocents", "heinlein", "vienna", "pleyels-hymn", "st-bees"] },
  "7 7 7 7 7 7": { name: "Sevens, six lines (7.7.7.7.7.7)", tunes: ["ratisbon-werner", "spanish-hymn"] },
  "7 7 7 7 7 7 7 7": { name: "Sevens Double (7.7.7.7 D)", tunes: ["hollingside", "martyn", "messiah-herald", "watchman"] },
  "8 7 8 7": { name: "Eights and Sevens (8.7.8.7)", tunes: ["stuttgart", "galilee-jude", "all-for-jesus", "omni-die", "st-oswald"] },
  "8 7 8 7 8 7 8 7": { name: "Eights and Sevens Double (8.7.8.7 D)", tunes: ["rustington", "lux-eoi"] },
  "8 7 8 7 8 7": { name: "Eights and Sevens, six lines (8.7.8.7.8.7)", tunes: ["mannheim"] },
  "8 7 8 7 4 7": { name: "8.7.8.7.4.7", tunes: ["coronae", "st-austin", "st-raphael"] },
  "7 6 7 6 7 6 7 6": { name: "Sevens and Sixes Double (7.6.7.6 D)", tunes: ["aurelia", "ewing", "greenland", "angels-story"] },
  "10 10 10 10": { name: "Tens (10.10.10.10)", tunes: ["eventide", "ellers", "langran", "song-twenty-two", "penitentia"] },
  "10 10 10 10 10 10": { name: "Tens, six lines (10.10.10.10.10.10)", tunes: ["yorkshire"] },
  "11 10 11 10": { name: "Elevens and Tens (11.10.11.10)", tunes: ["perfect-love", "wesley-mason", "henley"] },
  "6 6 4 6 6 6 4": { name: "Sixes and Fours (6.6.4.6.6.6.4)", tunes: ["dort", "malvern-gwyllt"] },
  "6 6 6 6 8 8": { name: "Hallelujah Metre (6.6.6.6.8.8)", tunes: ["darwall", "st-john-parish-choir"] },
};

/** The syllables per line the book's metre label gives a verse of `lines` lines, or null ("P. M." gives none). */
export function patternFor(label, lines) {
  const full = String(label).replace(/\s+/g, " ").trim();
  const l = /^[CLSH]\.\s?M\.?$/.test(full) ? full.replace(/\.?\s?M\.?$/, "") : full.replace(/\s*M\.?$/, "").replace(/\.$/, "");
  const repeat = (base) => (lines % base.length === 0 ? Array.from({ length: lines }, (_, i) => base[i % base.length]) : null);
  const exact = (base) => (lines === base.length ? base : null);
  if (l === "C") return repeat([8, 6, 8, 6]);
  if (l === "L") return repeat([8, 8, 8, 8]);
  if (l === "S") return repeat([6, 6, 8, 6]);
  if (/^H$/.test(l)) return exact([6, 6, 6, 6, 8, 8]);
  if (/^6 & 4s$/.test(l)) return exact([6, 6, 4, 6, 6, 6, 4]);
  if (/^8, 7,? & 4s$/.test(l)) return exact([8, 7, 8, 7, 4, 7]);
  let m = /^(\d+)s$/.exec(l);                                   // "7s", "10s": every line the same
  if (m) return [4, 6, 8].includes(lines) ? Array(lines).fill(Number(m[1])) : null;
  m = /^(\d+) & (\d+)s$/.exec(l);                                  // "8 & 7s", "7 & 6s", "11 & 10s": alternating
  if (m) return lines % 2 === 0 && lines >= 4 ? Array.from({ length: lines }, (_, i) => Number(m[i % 2 + 1])) : null;
  return null;
}

/**
 * Authors the book names whom we can name in full: the book's spelling → {name, born, died}. Spellings and dates
 * match the people already on our pages. Left out on purpose: surnames that could be more than one writer, and
 * writers whose hymns here are mostly translations (Luther, Goethe, Neale, John Wesley, Hedge, Madame Guyon), whose
 * translator the book does not name.
 */
export const AUTHORS = {
  "Montgomery": ["James Montgomery", 1771, 1854],
  "Gaskell": ["William Gaskell", 1805, 1884],
  "Doddridge": ["Philip Doddridge", 1702, 1751],
  "C. Wesley": ["Charles Wesley", 1707, 1788],
  "Bowring": ["John Bowring", 1792, 1872],
  "Whittier": ["John Greenleaf Whittier", 1807, 1892],
  "Bulfinch": ["Stephen Greenleaf Bulfinch", 1809, 1870],
  "Heber": ["Reginald Heber", 1783, 1826],
  "Watts": ["Isaac Watts", 1674, 1748],
  "Mrs. Hemans": ["Felicia Hemans", 1793, 1835],
  "Moore": ["Thomas Moore", 1779, 1852],
  "Jones Very": ["Jones Very", 1813, 1880],
  "Sarah F. Adams": ["Sarah Flower Adams", 1805, 1848],
  "Emily Taylor": ["Emily Taylor", 1795, 1872],
  "Sterling": ["John Sterling", 1806, 1844],
  "Pierpont": ["John Pierpont", 1785, 1866],
  "Newton": ["John Newton", 1725, 1807],
  "Johns": ["John Johns", 1801, 1847],
  "Norton": ["Andrews Norton", 1786, 1853],
  "Mrs. Miles": ["Sarah Elizabeth Miles", 1807, 1877],
  "Milman": ["Henry Hart Milman", 1791, 1868],
  "Keble": ["John Keble", 1792, 1866],
  "H. Ware": ["Henry Ware Jr.", 1794, 1843],
  "H. Ware, Jr.": ["Henry Ware Jr.", 1794, 1843],
  "Furness": ["William Henry Furness", 1802, 1896],
  "Cowper": ["William Cowper", 1731, 1800],
  "Barton": ["Bernard Barton", 1784, 1849],
  "Mrs. Barbauld": ["Anna Laetitia Barbauld", 1743, 1825],
  "Barbauld": ["Anna Laetitia Barbauld", 1743, 1825],
  "E. H. Chapin": ["Edwin Hubbell Chapin", 1814, 1880],
  "Drummond": ["William Drummond of Hawthornden", 1585, 1649],
  "Conder": ["Josiah Conder", 1789, 1855],
  "Bryant": ["William Cullen Bryant", 1794, 1878],
  "Alford": ["Henry Alford", 1810, 1871],
  "A. C. Coxe": ["Arthur Cleveland Coxe", 1818, 1896],
  "W. H. Burleigh": ["William Henry Burleigh", 1812, 1871],
  "Patrick": ["John Patrick", 1632, 1695],
  "Mrs. Sigourney": ["Lydia Sigourney", 1791, 1865],
  "Mrs. Howitt": ["Mary Howitt", 1799, 1888],
  "Mrs. Gilman": ["Caroline Gilman", 1794, 1888],
  "Mrs. Follen": ["Eliza Lee Cabot Follen", 1787, 1860],
  "Merrick": ["James Merrick", 1720, 1769],
  "J. Weiss": ["John Weiss", 1818, 1879],
  "J. H. Perkins": ["James Handasyd Perkins", 1810, 1849],
  "H. Martineau": ["Harriet Martineau", 1802, 1876],
  "H. M. Williams": ["Helen Maria Williams", 1759, 1827],
  "Wotton": ["Henry Wotton", 1568, 1639],
  "W. Scott": ["Walter Scott", 1771, 1832],
  "R. W. Emerson": ["Ralph Waldo Emerson", 1803, 1882],
  "R. C. Trench": ["Richard Chenevix Trench", 1807, 1886],
  "J. R. Lowell": ["James Russell Lowell", 1819, 1891],
  "E. H. Sears": ["Edmund Hamilton Sears", 1810, 1876],
  "E. B. Barrett": ["Elizabeth Barrett Browning", 1806, 1861],
  "H. K. White": ["Henry Kirke White", 1785, 1806],
  "Edmeston": ["James Edmeston", 1791, 1867],
  "Mrs. Steele": ["Anne Steele", 1717, 1778],
  "T. Parker": ["Theodore Parker", 1810, 1860],
  "Smart": ["Christopher Smart", 1722, 1771],
  "Sandys": ["George Sandys", 1578, 1644],
  "W. Roscoe": ["William Roscoe", 1753, 1831],
  "W. J. Fox": ["William Johnson Fox", 1786, 1864],
  "W. Croswell": ["William Croswell", 1804, 1851],
  "Croswell": ["William Croswell", 1804, 1851],
  "Mrs. Southey": ["Caroline Bowles Southey", 1786, 1854],
  "Mrs. Osgood": ["Frances Sargent Osgood", 1811, 1850],
  "Marriott": ["John Marriott", 1780, 1825],
  "L. E. Landon": ["Letitia Elizabeth Landon", 1802, 1838],
  "Jane Taylor": ["Jane Taylor", 1783, 1824],
  "J. F. Clarke": ["James Freeman Clarke", 1810, 1888],
  "Hogg": ["James Hogg", 1770, 1835],
  "Hart": ["Joseph Hart", 1712, 1768],
  "Grant": ["Robert Grant", 1779, 1838],
  "Dr. Tuckerman": ["Joseph Tuckerman", 1778, 1840],
  "Dale": ["Thomas Dale", 1797, 1870],
  "Browne": ["Simon Browne", 1680, 1732],
  "Frothingham": ["Nathaniel Langdon Frothingham", 1793, 1870],
  "Flint": ["James Flint", 1779, 1855],
  "S. S. Cutting": ["Sewall Sylvester Cutting", 1813, 1882],
  "J. G. Adams": ["John Greenleaf Adams", 1810, 1887],
  "M. B. Lamar": ["Mirabeau B. Lamar", 1798, 1859],
};

/** Sources the book gives instead of an author: the words are anonymous, and the page says where the book had them. */
const COLLECTIONS = /^(Anonymous|Briggs' Coll|Breviary|Moravian|Wesleyan|Methodist|Episcopal Coll|German|Sp\. of (the )?Psalms|Martineau's Coll|Flint's Coll|Disciples' H\. B|Chr\. Psalmist|Beard's Coll|Ancient Hymns|W\. Boston Coll|Univ\. Coll|Springfield Coll|Pratt's Coll|Orig\. Hymns|N\. Y\. Coll|Fox's Hymns|Dublin Coll|Christian Hymns|Chr\. Register|Bath Coll)$/;
/** …except a hymn the book has from a Latin breviary or from German: translated, by a translator it does not name. */
const TRANSLATED = /^(Breviary|German|Ancient Hymns)$/;

/** The book's hymns: [{number, label, author, altered, heading, verses: [[lines]]}]. */
export function parseBook(text) {
  const lines = String(text).replace(/\r/g, "").replace(/[ \t]*--[ \t]*/g, " — ").split("\n");
  const hymns = [];
  let cur = null, stanza = null;
  const close = () => { if (stanza && stanza.length) cur.verses.push(stanza); stanza = null; };
  const end = () => { if (cur) { close(); hymns.push(cur); cur = null; } };
  for (const raw of lines) {
    if (/^\*\*\* END/.test(raw)) { end(); break; }
    // "23.                               L. M.                     Frothingham."
    const head = /^(\d+)\.\s{3,}(\S.*?)(?:\s{2,}(\*?)(\S.*?))?\s*$/.exec(raw);
    if (head && /\b(M|\d+s)\.?$/.test(head[2]) && !/^\s/.test(raw)) {
      end();
      cur = { number: Number(head[1]), label: head[2].trim(), altered: head[3] === "*", author: (head[4] || "").replace(/\.$/, "").trim(), heading: [], verses: [] };
      continue;
    }
    if (!cur) continue;
    if (/^\s*SUPPLEMENT\.\s*$/.test(raw)) { end(); continue; }
    const line = raw.trim();
    if (!line) { close(); continue; }
    const start = /^\s{1,3}(\d+)\s+(\S.*)$/.exec(raw);
    if (start) { close(); stanza = [start[2].trim()]; continue; }
    if (stanza) stanza.push(line);
    else if (!cur.verses.length) cur.heading.push(line);
  }
  end();
  // The transcription marks italics as _word_; an underlay reads "_" as a held note.
  for (const h of hymns) h.verses = h.verses.map((v) => v.map((l) => l.replace(/_/g, "").trim()).filter(Boolean));
  return hymns;
}

/** Who wrote the words, as the page credits them, or why we cannot say. */
export function authorOf(h) {
  if (!h.author) return { why: "the book names no author" };
  if (TRANSLATED.test(h.author)) return { why: `a translation (from ${h.author}) whose translator the book does not name` };
  if (COLLECTIONS.test(h.author)) return { person: { name: "Anonymous", traditional: true, role: "Words" }, from: h.author === "Anonymous" ? null : h.author };
  const known = AUTHORS[h.author];
  if (!known) return { why: `an author we cannot name in full: “${h.author}”` };
  const [name, born, died] = known;
  return { person: { name, born, died, role: "Words" } };
}

/** The first verse under the pattern, one syllable to a note, if every verse is the pattern's length and nearly every line fits it. */
export function fitHymn(verses, pattern, dict) {
  if (!verses.length || verses.some((v) => v.length !== pattern.length)) return { why: "verses of different lengths" };
  let fits = 0;
  for (const v of verses) v.forEach((l, i) => { if (fitLine(l, pattern[i], dict)) fits++; });
  const total = verses.length * pattern.length;
  if (fits / total < 0.8) return { why: `only ${fits} of ${total} lines sing as ${pattern.join(".")}` };
  const first = verses[0].map((l, i) => fitLine(l, pattern[i], dict));
  if (!first.every(Boolean)) return { why: `its first verse cannot be sung as ${pattern.join(".")}` };
  return { underlay: underlayOf(first) };
}

/** A tune for the page, the same every run: picked from the metre's list by the slug. */
export function pickTune(slug, pattern) {
  const list = METRES[pattern].tunes;
  const n = crypto.createHash("sha256").update(slug).digest().readUInt32BE(0);
  return list[n % list.length];
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const jsonText = (x) => JSON.stringify(x, null, 2) + "\n";
const firstWords = (s, n = 6) => normalizeTitle(s).split(" ").slice(0, n).join(" ");
const sentence = (s) => s.replace(/[.\s]+$/, "");

export function runImport({ src, today, publish = false, dryRun = false, hymnsDir = HYMNS_DIR, tunesDir = TUNES_DIR, reportPath = REPORT_PATH, log = console.log }) {
  const hymns = parseBook(fs.readFileSync(src, "utf8"));
  const dict = underlayDictionary(hymnsDir);

  // The tunes, checked: published, a doh we can name, one note per syllable of the metre.
  const tunes = {};
  for (const [pattern, m] of Object.entries(METRES)) for (const slug of m.tunes) {
    const t = readJson(path.join(tunesDir, `${slug}.json`));
    const notes = parseMelody(t.melody, { time: t.time, pickup: t.pickup || 0 }).notes.length;
    const want = pattern.split(" ").map(Number).reduce((a, b) => a + b, 0);
    if (t.draft || !dohOf(t.key) || notes !== want) throw new Error(`${slug} cannot carry ${m.name} one syllable to a note`);
    tunes[slug] = t;
  }

  // What we have: every hymn's first line, title and other titles; the files this importer wrote.
  const ours = new Map(), mine = new Set();
  for (const f of fs.readdirSync(hymnsDir).filter((f) => f.endsWith(".json"))) {
    const h = readJson(path.join(hymnsDir, f));
    const slug = f.replace(/\.json$/, "");
    if (h.importedFrom?.startsWith(`${IMPORTED_FROM}:`)) { mine.add(slug); continue; }
    for (const t of [h.title, ...(h.alsoKnownAs || []), h.verses?.[0]?.lines?.[0]].filter(Boolean)) ours.set(firstWords(t), slug);
  }

  const report = { source: `${BOOK} (Samuel Longfellow and Samuel Johnson, 1848), fifteenth edition, 1866`, date: today, written: [], alreadyOurs: [], skipped: [], counts: {} };
  const keep = new Set();
  for (const h of hymns) {
    const ref = String(h.number);
    const first = h.verses[0]?.[0];
    if (!first) { report.skipped.push({ ref, why: "no verses" }); continue; }
    const have = ours.get(firstWords(first));
    if (have) { report.alreadyOurs.push({ ref, first, page: have }); continue; }
    const { person, from, why: whoWhy } = authorOf(h);
    if (!person) { report.skipped.push({ ref, first, why: whoWhy }); continue; }
    const pattern = patternFor(h.label, h.verses[0].length)?.join(" ");
    if (!pattern || !METRES[pattern]) { report.skipped.push({ ref, first, why: `no tune we hold for “${h.label}” in ${h.verses[0].length}-line verses` }); continue; }
    const { underlay, why } = fitHymn(h.verses, pattern.split(" ").map(Number), dict);
    if (!underlay) { report.skipped.push({ ref, first, why }); continue; }

    const title = titleCase(first.replace(/[\s,;:.!?—-]+$/u, ""));
    const slug = slugify(title);
    if (keep.has(slug) || (fs.existsSync(path.join(hymnsDir, `${slug}.json`)) && !mine.has(slug))) { report.skipped.push({ ref, first, why: `the page ${slug} is taken` }); continue; }
    const tune = pickTune(slug, pattern), t = tunes[tune];
    const doh = dohOf(t.key);
    const m = METRES[pattern];
    let description = `${title} in Tonic Solfa to ${t.name}, doh is ${doh}: the solfa with the words, staff notation, ${h.verses.length} verses and a piano.`;
    if (description.length > 160) description = `${title}: Tonic Solfa to ${t.name} (doh is ${doh}), staff notation and ${h.verses.length} verses.`;
    if (description.length > 160) { report.skipped.push({ ref, first, why: "title too long for a description" }); continue; }
    const year = h.number >= SUPPLEMENT_FROM ? 1866 : 1848;
    const where = h.number >= SUPPLEMENT_FROM ? `the supplement of the 1866 edition of ${BOOK}` : `${BOOK}`;
    const heading = sentence(h.heading.join(" ").replace(/\s+/g, " ").trim());
    const who = person.traditional
      ? `These words were printed without an author's name in ${where}, compiled by Samuel Longfellow and Samuel Johnson (Boston, ${year === 1848 ? "1848" : "1866"}), as hymn ${h.number}${heading ? `, “${heading}”` : ""}${from ? `, where the book credits them to ${from.replace(/ Coll$/, " Collection")}` : ""}.`
      : `${person.name} wrote these words. They were printed in ${where}, compiled by Samuel Longfellow and Samuel Johnson (Boston, ${year === 1848 ? "1848" : "1866"}), as hymn ${h.number}${heading ? `, “${heading}”` : ""}.`;
    const page = {
      title,
      tune,
      text: [person],
      textPublished: year,
      textPublishedBy: true,
      description,
      about: [
        who + (h.altered ? " The compilers changed some of the words, and this is their version." : ""),
        `The book printed the words without tunes, marked ${m.name} (${pattern.split(" ").join(".")}), to be sung to any tune of that metre. This page sets them to ${t.name}; any other ${m.name} tune fits them as well.`,
      ],
      underlay,
      verses: h.verses.map((lines) => ({ lines })),
      metre: pattern,
      source: `${BOOK} (1848)`,
      licence: person.traditional ? `Public domain: anonymous words in print by ${year}.` : `Public domain: ${person.name} died in ${person.died}.`,
      credits: `Words ${person.traditional ? "anonymous" : `by ${person.name} (${person.born}–${person.died})`}, public domain, as printed in ${BOOK} (${year}); set to ${t.name} by NoteFusion, as words-only hymn books were sung.`,
      updated: today,
      reviewed: false,
      draft: !publish,
      setByMetre: true,
      importedFrom: `${IMPORTED_FROM}:${ref}`,
    };
    keep.add(slug);
    report.written.push({ ref, slug, metre: pattern, tune, author: person.name });
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
  log(`${BOOK}: ${hymns.length} hymns; ${report.written.length} pages${publish ? "" : " (drafts)"}, ${report.alreadyOurs.length} already ours, ${report.skipped.length} skipped, ${removed.length} removed.`);
  return report;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const src = arg("--src");
  if (!src) { console.error("usage: node tools/blog/import/hymns-1848.mjs --src FILE [--date YYYY-MM-DD] [--publish] [--dry-run]"); process.exit(2); }
  const today = arg("--date") || new Date().toISOString().slice(0, 10);
  runImport({ src, today, publish: args.includes("--publish"), dryRun: args.includes("--dry-run") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
