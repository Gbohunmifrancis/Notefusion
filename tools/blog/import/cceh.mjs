// Turns one tune of the Christian Classics Ethereal Hymnary (CCEH) — its page (cceh-page.mjs) and its MIDI
// file (midi.mjs) — into a tune in the format of content/hymns/tunes, and runs the gates on it. CCEH has
// tunes without words, so a CCEH tune is a tune page of its own (/hymns/tunes/<slug>), not a hymn.
//
// Nothing here writes solfa: the tune holds pitches and durations, and the build runs the engine
// (web-site/assets/choir.js) on them, as for every other tune.
//
// Public domain, by OUR rule (lib/content.mjs), not CCEH's (published in the US before 1923):
//   - refused, nothing copied: a © on the page or in the MIDI file, anyone named who died in 1955 or later
//     or is living (a life with no end, "1951-"), anyone on the known list below, a year of 1929 or later;
//   - a draft with the reason: anyone named without a death year (the page's own dates, else the dates our
//     other pages already give the same person — never guessed), no year for the tune;
//   - and the melody gates: a voice of the MIDI file that matches the page's incipit, one time signature,
//     notes on the semiquaver grid, bars that add up, a pickup the rhythm makes clear, a singable range.
import { parseMidi } from "./midi.mjs";
import { parseTunePage } from "./cceh-page.mjs";
import { chooseMelody, incipitDegrees, oxfordDegrees, lineToMelody } from "./cceh-melody.mjs";
import { parseMelody, loadEngine } from "../lib/solfa.mjs";
import { tunePublicDomainProblems, PD_DIED_BEFORE, PD_PUBLISHED_BEFORE } from "../lib/content.mjs";
import { slugify } from "../lib/util.mjs";
import { RANGE } from "./ohp.mjs";

export const SOURCE_NAME = "CCEH";
export const SOURCE_FULL = "Christian Classics Ethereal Hymnary";
export const SOURCE_HOME = "https://www.ccel.org/cceh/index.htm";
export const SOURCE_TERMS = "https://www.ccel.org/cceh/cceh_cpr.htm";
export const SOURCE_LICENCE = "Public domain. The Christian Classics Ethereal Hymnary (ccel.org/cceh) states “This music is in the public domain” and that all its files — sheet music, MIDIs and electronic scores — “are free to use in any manner: download, copy, modify, use, distribute, publish, and perform”.";
export const CONFIDENCE = "imported, unchecked";

export const pageUrl = (folder, number) => `https://www.ccel.org/cceh/${folder}/x${number}.htm`;
export const fileUrl = (folder, href) => `https://www.ccel.org/cceh/${folder}/${href}`;
export const folderOf = (number) => String(Math.floor(Number(number) / 100)).padStart(4, "0");

/**
 * People whose hymn tunes and arrangements are still in copyright under our rule (died in 1955 or later),
 * and who appear in hymnals without dates. A tune or arrangement crediting any of them is never imported,
 * whatever the page says. Name → death year (null: living or died recently).
 */
export const KNOWN_IN_COPYRIGHT = {
  "Ralph Vaughan Williams": 1958, "Jean Sibelius": 1957, "Martin Shaw": 1958, "Healey Willan": 1968,
  "John Ireland": 1962, "Herbert Howells": 1983, "Cyril Vincent Taylor": 1991, "Stuart K. Hine": 1989,
  "Haldor Lillenas": 1959, "Thomas A. Dorsey": 1993, "Albert E. Brumley": 1977, "Harold Darke": 1976,
  "Eric Thiman": 1975, "Leo Sowerby": 1968, "Edward Shippen Barnes": 1958, "Robert G. McCutchan": 1958,
  "Erik Routley": 1982, "Francis Jackson": 2022, "George Dyson": 1964, "William Harris": 1973,
  "Edgar Bainton": 1956, "Geoffrey Beaumont": 1970, "John W. Peterson": 2006, "Ira F. Stanphill": 1993,
  "Carl F. Mueller": 1982, "Katherine K. Davis": 1980, "Paul Manz": 2009,
};

/** Lowercase letters only, for matching names and tune names. */
export const normName = (s) => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/**
 * The listed person a page's name means: the same name, or the same surname with the same first initial
 * ("R. Vaughan Williams", "J. Sibelius"), or the surname alone when it is two words ("Vaughan Williams").
 */
export function knownInCopyright(name) {
  const n = normName(name).split(" ");
  for (const [k, died] of Object.entries(KNOWN_IN_COPYRIGHT)) {
    const kw = normName(k).split(" ");
    const sur = kw[kw.length - 1];
    if (n.join(" ") === kw.join(" ")) return { name: k, died };
    if (n.length > 1 && n[n.length - 1] === sur && n[0][0] === kw[0][0] && (n.length < 3 || kw.length < 3 || n[n.length - 2][0] === kw[kw.length - 2][0])) return { name: k, died };
    if (kw.length > 2 && n.join(" ") === kw.slice(-2).join(" ")) return { name: k, died };
  }
  return null;
}

/**
 * A lookup of people's dates from pages that already give them: the build's own hymns and tunes (hand-made
 * and imported, each from its source) and the CCEH pages that print a life ("John Dowland, 1562-1626").
 * `add(name, {born, died, lived})`, `get(name)`: by the full name, else by surname and first initial when
 * only one person in the table fits. Nothing here is guessed.
 */
export function datesTable() {
  const full = new Map(), short = new Map();
  const key2 = (n) => { const w = normName(n).replace(/\b(rev|dr|sir|st|mrs|mr)\b/g, "").trim().split(" ").filter(Boolean); return w.length > 1 ? `${w[w.length - 1]} ${w[0][0]}` : null; };
  return {
    add(name, d) {
      if (!name || !Number.isInteger(d.died)) return;
      const k = normName(name);
      if (!full.has(k)) full.set(k, { ...d, from: d.from });
      const s = key2(name);
      if (s) { const list = short.get(s) || []; if (!list.some((x) => x.died === d.died)) list.push({ ...d, name }); short.set(s, list); }
    },
    get(name) {
      const f = full.get(normName(name));
      if (f) return f;
      const s = key2(name);
      const list = s && short.get(s);
      return list && list.length === 1 ? list[0] : null;
    },
    get size() { return full.size; },
  };
}

const ROLE = (c) => {
  const r = (c.role || "").toLowerCase();
  if (/^harm/.test(r)) return "Harmony";
  if (/^arr/.test(r)) return /tenor/.test(r) ? "Arranged (tenor lead)" : "Arranged";
  if (/^attr/.test(r)) return "Music, attributed";
  if (/^rec|^coll/.test(r)) return "Collected";
  if (/^adapt|^alt/.test(r)) return "Adapted";
  return "Music";
};
/** Arrangers and harmonisers shape the harmony; the composer, an attributed composer, a collector or a book give the tune. */
const isTuneSource = (c) => !/^(arr|harm|desc)/i.test(c.role || "");

/**
 * Converts one tune. `page` is the page's HTML; `midi` the bytes of the chosen MIDI file (or null);
 * `midiHref` its name on the page. Returns
 *   { number, folder, name, slug, tune, problems: [...], refused: null | reason, parsed, melodyLine, incipit }
 * `problems` keep the tune a draft; `refused` means nothing of it is copied into the repository.
 */
export function convertTune({ page, midi, midiHref, number: numberIn = null, today, dates = datesTable() }) {
  const p = parseTunePage(page);
  const number = p.number || numberIn;
  const folder = folderOf(number);
  const problems = [], notes = [];
  let refused = null;
  const refuse = (why) => { refused = refused || why; };

  // ── Names ──
  const baseName = p.title.replace(/\*+$/, "").trim();
  const name = baseName.toUpperCase();
  const alsoKnownAs = p.otherNames.map((n) => n.replace(/\*+$/, "").trim()).filter((n) => n && normName(n) !== normName(baseName));

  // ── People and years, as the page gives them ──
  const music = [];
  const years = [];
  let midiFile = null;
  if (midi) {
    try { midiFile = parseMidi(midi); } catch (e) { problems.push(`the MIDI file cannot be read (${e.message})`); }
  }
  for (const c of p.credits) {
    if (c.copyright) refuse(`the page marks ${c.name ? `${c.name}'s ${c.role ? "arrangement" : "tune"}` : "an arrangement"} as copyright (“${c.raw}”)`);
    if (c.year) years.push({ year: c.year, source: isTuneSource(c) });
    if (c.book) {
      music.push({ name: c.place ? `${c.book} (${c.place})` : c.book, traditional: true, role: c.year ? `Melody (${c.year})` : "Melody" });
      continue;
    }
    if (!c.name) continue;
    if (c.traditional) {
      music.push({ name: /^traditional$/i.test(c.name) ? "Traditional melody" : c.name, traditional: true, role: c.year ? `Melody (${c.year})` : "Melody" });
      continue;
    }
    const nm = c.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const person = { name: nm };
    const known = knownInCopyright(nm);
    if (known) refuse(`${known.name} died in ${known.died > 2100 ? "recent years" : known.died}, so ${ROLE(c) === "Music" ? "the tune" : "the arrangement"} is still in copyright in Nigeria, the UK and the EU`);
    if (c.living) refuse(`${nm} (born ${c.born}) may be living, so the ${ROLE(c) === "Music" ? "tune" : "arrangement"} is not public domain`);
    if (Number.isInteger(c.died)) { person.born = c.born; person.died = c.died; }
    else {
      const d = dates.get(nm);
      if (d) {
        if (d.born) person.born = d.born;
        person.died = d.died;
        if (d.lived) person.lived = d.lived;
        notes.push(`${nm}'s dates (${d.born ? `${d.born}–` : "died "}${d.died}) are the ones ${d.from || "our other pages"} give${d.from && /pages$/.test(d.from) ? "" : "s"}; CCEH's page gives ${c.year ? `only the year ${c.year}` : "none"}.`);
      }
    }
    if (Number.isInteger(person.died) && person.died >= PD_DIED_BEFORE) refuse(`${nm} died in ${person.died}, so ${ROLE(c) === "Music" ? "the tune" : "the arrangement"} is still in copyright in Nigeria, the UK and the EU`);
    person.role = c.year ? `${ROLE(c)} (${c.year})` : ROLE(c);
    if (/^Arranged|^Harmony/.test(person.role) && c.year && c.year >= PD_PUBLISHED_BEFORE) refuse(`${nm}'s arrangement is dated ${c.year}, after ${PD_PUBLISHED_BEFORE - 1}`);
    music.push(person);
  }
  if (!music.length) problems.push("the page names no composer or source for the tune");
  // The tune was in print by the earliest year the page gives for the tune itself, else for an arrangement of it.
  const tuneYears = years.filter((y) => y.source).map((y) => y.year);
  const anyYears = years.map((y) => y.year);
  const musicPublished = tuneYears.length ? Math.min(...tuneYears) : anyYears.length ? Math.min(...anyYears) : null;
  if (!tuneYears.length && anyYears.length) notes.push(`The page gives no year for the tune itself; it was in print by ${musicPublished}, the year of the arrangement.`);
  if (musicPublished == null) problems.push("the page gives no year for the tune");
  else if (musicPublished >= PD_PUBLISHED_BEFORE && tuneYears.length) refuse(`first published in ${musicPublished}, after ${PD_PUBLISHED_BEFORE - 1}`);
  if (midiFile) {
    // Noteworthy writes the score's copyright line into the MIDI file: "public domain", or a © to respect.
    const meta = (midiFile.copyright || []).join(" ").trim();
    if (meta && !/public domain/i.test(meta)) refuse(`the MIDI file carries a copyright notice (“${meta}”)`);
  }
  for (const pr of tunePublicDomainProblems({ music, musicPublished })) if (!problems.some((q) => pr.includes(q))) problems.push(`not provably public domain: ${pr}`);

  // ── The melody: the voice that matches the incipit ──
  let degrees = incipitDegrees(p.incipit.doremi);
  if (degrees.filter((d) => d !== null).length < 6) degrees = oxfordDegrees(p.incipit.oxford);
  let mel = null, choice = null, parsed = null;
  if (!midi) problems.push("CCEH has no MIDI file for this tune");
  else if (midiFile) {
    choice = chooseMelody(midiFile, degrees);
    if (!choice.line) problems.push(choice.reason);
    else {
      mel = lineToMelody(choice.line, midiFile, { doh: choice.match.doh });
      for (const pr of mel.problems) problems.push(pr.text);
      notes.push(...(mel.notes || []));
      if (choice.line.staff > 0 || choice.line.part === "bottom") notes.push(`The melody is the ${choice.line.part === "bottom" ? "lower" : "upper"} line of the ${choice.line.staff > 0 ? "lower" : "upper"} staff in CCEH's score (${choice.line.staff > 0 ? "a tenor-lead setting" : "not the top voice"}), chosen because it matches the incipit.`);
      if (mel.melody) {
        try { parsed = parseMelody(mel.melody, { time: mel.time, pickup: mel.pickup }); }
        catch (e) { problems.push(`the melody does not parse: ${e.message}`); }
      }
      if (parsed && (mel.lo < RANGE.low || mel.hi > RANGE.high || mel.hi - mel.lo > RANGE.span)) problems.push(`the range (MIDI ${mel.lo}–${mel.hi}) is outside what a congregation sings`);
      if (parsed && !loadEngine().parseKey(mel.key)) problems.push(`the key "${mel.key}" cannot be read`);
    }
  }

  const seen = [...new Set(problems)];
  const bpbCells = mel && mel.bpb ? mel.bpb * 2 : 8;
  const sourceUrl = pageUrl(folder, number);
  const reviewNotes = [
    ...(seen.length ? [`Held back: ${seen.join("; ")}.`] : []),
    `Imported from CCEH tune ${number}${midiHref ? ` (the melody read from ${midiHref}, checked against the page's do-re-mi incipit${choice && choice.match ? `, ${choice.match.distance ? `${choice.match.distance} note${choice.match.distance === 1 ? "" : "s"} off in ${choice.match.compared}` : "note for note"}` : ""})` : ""}; check the notes and the bar lines against a hymn book you trust, then set "reviewed": true.`,
    ...notes,
  ].join(" ");
  const tune = {
    name,
    ...(alsoKnownAs.length ? { alsoKnownAs } : {}),
    music,
    musicPublished,
    ...(p.metre ? { metre: p.metre } : {}),
    key: parsed ? mel.key : null,
    time: parsed ? mel.time : null,
    tempo: parsed ? mel.tempo : null,
    pickup: parsed ? mel.pickup : 0,
    lineBars: bpbCells <= 6 ? 4 : bpbCells <= 12 ? 2 : 1,
    melody: parsed ? mel.melody : null,
    ...(p.incipit.doremi ? { incipit: p.incipit.doremi } : {}),
    reviewed: false,
    confidence: CONFIDENCE,
    draft: seen.length > 0,
    source: SOURCE_NAME,
    sourceUrl,
    ...(midiHref ? { scoreUrl: fileUrl(folder, midiHref) } : {}),
    licence: SOURCE_LICENCE,
    credits: `Melody from the ${SOURCE_FULL} (CCEH), tune ${number}; public domain.`,
    reviewNotes,
    importedFrom: `cceh:${number}`,
  };
  return { number, folder, name, baseName, slug: slugify(baseName), tune, problems: seen, refused, parsed, melodyLine: choice && choice.line, incipit: p.incipit, page: p };
}
