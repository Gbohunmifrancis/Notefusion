// Turns one Open Hymnal Project score (parsed by abc.mjs) into a hymn and a tune in the format of
// content/hymns, and runs the quality gates on it. Nothing here writes solfa: the hymn holds pitches,
// durations and the first verse's syllables, and the build runs the engine (web-site/assets/choir.js)
// on them, exactly as for a hymn typed in by hand.
//
// Gates (any failure keeps the hymn a draft, with the reasons in reviewNotes):
//   - the melody parses: a metre, no triplets, repeats, key or metre changes, bars that add up,
//     notes on the quarter-beat grid;
//   - the first verse has one syllable (or a held "_") per note, with no words lost on tied notes;
//   - a singable range (G3 to A5, at most a twelfth);
//   - key and metre present;
//   - public domain, strictly (lib/content.mjs publicDomainProblems), from the score's own metadata:
//     the %OH… dates and the publication years in its C: lines — nothing is looked up or guessed.
// A score whose licence is not plain public domain, or that names someone who died in 1955 or later
// (or is alive), is not imported at all: its words and music are not copied into this repository.
import { parseAbc, pitchName, lyricTokens } from "./abc.mjs";
import { loadEngine, parseMelody } from "../lib/solfa.mjs";
import { publicDomainProblems, PD_DIED_BEFORE } from "../lib/content.mjs";
import { slugify } from "../lib/util.mjs";

export const SOURCE_NAME = "Open Hymnal Project";
export const SOURCE_HOME = "http://openhymnal.org/";
export const SOURCE_EDITOR = "Brian J. Dumont";
export const SOURCE_LICENCE = "Public domain. The Open Hymnal Project marks this hymn “copyright: public domain” (words, music and setting), and places its own editing, indexes and data files in the public domain.";
export const SOURCE_CREDIT = `Melody and words from the ${SOURCE_NAME} (openhymnal.org), edited by ${SOURCE_EDITOR}; public domain.`;

/** The hymn's page at the Open Hymnal Project (words, score, audio and the ABC source), from the file's base name. */
export const sourceUrl = (base) => `http://openhymnal.org/Lyrics/${encodeURIComponent(base).replace(/%2C/g, ",")}.html`;
export const abcUrl = (base) => `http://openhymnal.org/Abc/${encodeURIComponent(base).replace(/%2C/g, ",")}.abc`;

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "the", "to", "with", "unto", "upon"]);
/** "Come Thou Fount Of Every Blessing" → "Come Thou Fount of Every Blessing" (hymn-book title case). */
export function titleCase(t) {
  return String(t).trim().split(/\s+/).map((w, i) => {
    const lower = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lower.replace(/[^a-z']/g, ""))) return lower;
    return w.replace(/^([^\p{L}\p{N}]*)(\p{L})/u, (_, a, c) => a + c.toUpperCase());
  }).join(" ");
}

/** Lowercase letters only, Saviour/Savior folded: for matching titles and first lines. */
export function normalizeTitle(t) {
  return String(t).toLowerCase().replace(/saviour/g, "savior").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The score's first-verse underlay ("To God be the glor-y, great things He has done;") re-spelt as our
 * own printed verse has it ("… great things He hath done!"), keeping the score's syllables and held
 * notes: word for word, a word with the same letters is split where the score splits it, and a
 * one-syllable word may differ ("has"/"hath"). Throws, saying where, when the words do not line up.
 */
export function retextUnderlay(underlay, ourText) {
  const theirs = underlay.trim().split(/\s+/);
  let ours = String(ourText).trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  // A word the score prints as two ("life gate") may be hyphenated in ours ("life-gate").
  if (ours.length < theirs.length) ours = ours.flatMap((w) => w.split(/(?<=\p{L})-(?=\p{L})/u));
  if (theirs.length !== ours.length) throw new Error(`${ours.length} words against the score's ${theirs.length}`);
  const letters = (w) => w.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").replace(/our/g, "or");
  return theirs.map((word, i) => {
    const pieces = word.split("-").map((p) => { const m = /^(.*?)(_*)$/.exec(p); return { text: m[1], holds: m[2] }; });
    const mine = ours[i].replace(/_/g, "").replace(/-/g, "‑");
    if (letters(mine) !== letters(pieces.map((p) => p.text).join(""))) {
      if (pieces.length === 1 && letters(mine)) return mine + pieces[0].holds;
      throw new Error(`“${ours[i]}” where the score has “${pieces.map((p) => p.text).join("")}”`);
    }
    // Split our spelling at the same letter counts.
    const out = [];
    let k = 0, cur = "", count = 0;
    for (const ch of mine) {
      const isLetter = /[a-z0-9]/.test(letters(ch));
      if (isLetter && k < pieces.length - 1 && count === letters(pieces[k].text).length) { out.push(cur + pieces[k].holds); cur = ""; count = 0; k++; }
      cur += ch;
      if (isLetter) count += letters(ch).length;
    }
    out.push(cur + pieces[k].holds);
    return out.join("-");
  }).join(" ");
}

// ── People ──────────────────────────────────────────────────────────────────
const TRADITIONAL = /^(from\b|traditional|anonymous|unknown|ancient|medieval|mediaeval|plainsong|(proper )?sarum|gregorian|genevan|psalm\b|liturgy|english|german|french|latin|welsh|dutch|american|irish|scottish|swedish|norwegian|danish|finnish|spanish|italian|bohemian|hebrew|greek|silesian|polish|czech|russian|negro|african|basque|catalan|cornish|manx|flemish)/i;
const ORDINAL = { 1: "st", 2: "nd", 3: "rd" };

/** "Last, First Middle" → "First Middle Last". */
function displayName(n) {
  const m = /^([^,]+),\s*(.+)$/.exec(n.trim());
  return m ? `${m[2].trim()} ${m[1].trim()}` : n.trim();
}

/**
 * One %OHCOMPOSER / %OHAUTHOR / %OHTRANSLATOR value as people. Dates are read only as the score
 * gives them: "(1838-1918)", "(?-1604)", "(5th Century)", "1863-1938"; a living person "(1951-)"
 * has no death year. An anonymous or traditional source ("from Klug's Geistliche Lieder, 1533",
 * "Welsh", "unknown") is {traditional: true}. "none" → [].
 */
export function parsePeople(value) {
  const v = String(value || "").trim();
  if (!v || /^none$/i.test(v)) return [];
  return v.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    // "(1838-1918)", "(c. 540-604)", "(circa 1710-1786)", "(1181/1182-1226)", "(?-1604)", "(1858-?)", "(1951-)"
    let m = /^(.*?)\s*\((?:circa|ca?\.)?\s*(\d{1,4}(?:\/\d{1,4})?|\?)?\s*-\s*(\d{1,4}|\?)?\s*\)\s*$/i.exec(part);
    if (!m) m = /^(.*?),\s*(\d{3,4})\s*-\s*(\d{3,4})\s*$/.exec(part);
    if (m) {
      const born = m[2] && m[2] !== "?" ? Number(m[2].split("/")[0]) : undefined;
      const died = m[3] && m[3] !== "?" ? Number(m[3]) : undefined;
      // "(1951-)" is a living writer; "(1858-?)" only an unknown death year.
      return { name: displayName(m[1]), ...(born ? { born } : {}), ...(died ? { died } : {}), ...(born && !m[3] ? { living: true } : {}) };
    }
    const c = /^(.*?)\s*\((\d{1,2})(?:st|nd|rd|th)\s+century\)\s*$/i.exec(part);
    if (c) {
      const n = Number(c[2]);
      return { name: displayName(c[1]), died: n * 100, lived: `${n}${ORDINAL[n % 10] && Math.floor(n / 10) !== 1 ? ORDINAL[n % 10] : "th"} century` };
    }
    // A floruit, "(circa 1400)": the source dates the writer to a year long before 1955; the death
    // year kept for the public-domain test is that year plus a century, which no one outlives.
    const fl = /^(.*?)\s*\((?:circa|ca?\.)\s*(\d{3,4})\)\s*$/i.exec(part);
    if (fl) return { name: displayName(fl[1]), died: Number(fl[2]) + 100, lived: `fl. c. ${fl[2]}` };
    if (TRADITIONAL.test(part)) {
      const name = /^(unknown|anonymous)$/i.test(part) ? "Anonymous" : /^(from|psalm|liturgy|genevan|ancient|medieval|mediaeval|plainsong|gregorian|traditional)\b/i.test(part) ? part[0].toUpperCase() + part.slice(1) : `Traditional ${part}`;
      return { name, traditional: true };
    }
    return { name: displayName(part) };
  });
}

// ── Years ───────────────────────────────────────────────────────────────────
/** The first year a clause gives ("…, 1779.", "c.1636"), else its century as the century's last year. */
export function firstYear(clause) {
  if (!clause) return null;
  const text = clause.replace(/\(\s*\d{3,4}\s*-\s*\d{0,4}\s*\)/g, "");
  // A book the tune or words are taken "from" is their publication: "…traditional German circa 1400
  // from Etlich Christlich Lider, Wittenberg, 1524" was published in 1524.
  const book = /\bfrom\b[^.;]*?(?<!\d)(1[0-9]{3})(?!\d)/i.exec(text);
  if (book && /circa|century/i.test(text.slice(0, book.index))) return Number(book[1]);
  const y = /(?<!\d)(1[0-9]{3}|[4-9][0-9]{2})(?!\d)/.exec(text);
  const c = /(\d{1,2})(?:st|nd|rd|th)\s+century/i.exec(text);
  if (y && (!c || y.index < c.index)) return Number(y[1]);
  return c ? Number(c[1]) * 100 : null;
}

/**
 * The words, translation, music and setting clauses of the score's C: lines (which run on across
 * lines), e.g. "Words: John Newton, 1779. Music: 'New Britain' James P. Carrell…, 1831. Setting: …".
 */
export function creditClauses(cLines) {
  const text = cLines.filter((l) => !/copyright|freely|rights reserved|This score is a part/i.test(l)).join(" ").replace(/\s+/g, " ");
  const marks = [];
  const find = (name, re) => { const m = re.exec(text); if (m) marks.push({ name, at: m.index, len: m[0].length }); };
  find("words", /Words(?: and Music)?:/i);
  find("translation", /(?:English\s+)?Translat(?:ed|ion)\b(?: by)?:?/i);
  find("music", /Music(?: and Setting)?:?\s*(?=['"`A-Za-z])/);
  find("setting", /(?<!and )Setting:/i);
  marks.sort((a, b) => a.at - b.at);
  const out = {};
  marks.forEach((m, i) => { out[m.name] = text.slice(m.at + m.len, i + 1 < marks.length ? marks[i + 1].at : text.length).trim(); });
  if (/Words and Music:/i.test(text) && !out.music) out.music = out.words;
  if (/Music and Setting/i.test(text) && !out.setting) out.setting = out.music;
  return out;
}

/** The tune's name from the music clause: the first quoted name ('New Britain' or "Nicaea"). */
function tuneNameFrom(clause, base) {
  const m = /^[^'"`]{0,40}['"`]([^'"`]+)['"`]/.exec(clause || "");
  if (m) return m[1].trim();
  const parts = base.split("-");
  return parts.length > 1 && !/^untitled$/i.test(parts[1]) ? parts[1].replace(/_/g, " ") : null;
}

// ── Verses ──────────────────────────────────────────────────────────────────
/** Syllables (each with `joins`) → words: [{text, syllables}]. */
function toWords(syls) {
  const words = [];
  let cur = null;
  for (const s of syls) {
    if (!cur) { cur = { text: "", syllables: 0 }; words.push(cur); }
    cur.text += s.text;
    cur.syllables++;
    if (!s.joins) cur = null;
  }
  // A typed hyphen at a word's end before a space ("full,\- He", "saved\- grace") is a dash, printed
  // as one and run on into the next word ("saved—grace"). The odd compound split this way
  // ("life\- imparting") reads the same.
  const out = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    const text = w.text.replace(/\u203f/g, " ");
    // (A capital after the dash starts a new line of the verse: the words stay apart there.)
    if (prev && prev.joinNext && !/^\p{Lu}/u.test(text)) { prev.text += text; prev.syllables += w.syllables; prev.joinNext = /\u2011$/u.test(text); continue; }
    out.push({ text, syllables: w.syllables, joinNext: /\u2011$/u.test(text) });
  }
  return out.map((w) => ({ text: w.text.replace(/[,;:]?\u2011+(?=\p{L}|$)/gu, "—").replace(/\u2011/g, "-"), syllables: w.syllables }));
}

/**
 * Words → poetic lines. With the metre ("8 6 8 6"), a line ends where its syllables add up; if the
 * counts do not fall on word ends the lines are guessed at punctuation before a capital letter.
 * Returns {lines, byMetre}.
 */
export function toLines(words, metre) {
  const counts = (metre || []).filter((n) => n > 0);
  const total = words.reduce((a, w) => a + w.syllables, 0);
  if (counts.length && counts.reduce((a, b) => a + b, 0) === total) {
    const lines = [];
    let k = 0, cur = [], n = 0, ok = true;
    for (const w of words) {
      cur.push(w.text); n += w.syllables;
      if (n === counts[k]) { lines.push(cur.join(" ")); cur = []; n = 0; k++; }
      else if (n > counts[k]) { ok = false; break; }
    }
    if (ok && !cur.length) return { lines, byMetre: true };
  }
  const lines = [];
  let cur = [], n = 0;
  words.forEach((w, i) => {
    cur.push(w.text); n += w.syllables;
    const next = words[i + 1];
    const end = !next || (/[,;:.!?]["’”')]*$/.test(w.text) && /^["‘“(]*[A-Z]/.test(next.text) && n >= 4) || (/[;:.!?]["’”')]*$/.test(w.text) && n >= 6)
      || (n >= 6 && /^["‘“(]*[A-Z]/.test(next.text) && !CAPITALISED.test(next.text.replace(/[^A-Za-z']/g, "")));
    if (end) { lines.push(cur.join(" ")); cur = []; n = 0; }
  });
  return { lines, byMetre: false };
}

/** Words a hymn capitalises in mid-line: names and words for God. A line may still start with one. */
const CAPITALISED = /^(I|O|God|God's|Lord|Lord's|Jesus|Jesus'|Christ|Christ's|Spirit|Ghost|Father|Son|Savior|Saviour|Lamb|King|Name|Word|He|His|Him|Thy|Thee|Thou|Thine|Who|Whom|Whose|Holy|Heaven|Heav'n|Zion|Israel|Bethlehem|Jerusalem|Calvary|Emmanuel|Immanuel|Redeemer|Shepherd|Friend|Master|Creator|Trinity|Church|Gospel|Cross|Hallelujah|Alleluia|Amen|Mary|David|Jordan|Satan|Christmas|Easter|Galilee|Nazareth)$/;

/** The metre's syllable counts, when it is all numbers ("8 6 8 6"); else null. */
function metreCounts(text) {
  if (!text || !/^\s*\d+(\s+\d+)*\s*$/.test(text)) return null;
  return text.trim().split(/\s+/).map(Number);
}

// ── The conversion ──────────────────────────────────────────────────────────
const MINOR_OF = { C: "A", G: "E", D: "B", A: "F#", E: "C#", B: "G#", "F#": "D#", F: "D", Bb: "G", Eb: "C", Ab: "F", Db: "Bb", Gb: "Eb", Cb: "Ab" };
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOf = (name) => (PC[name[0]] + (name[1] === "#" ? 1 : name[1] === "b" ? -1 : 0) + 12) % 12;
const fmtBeats = (x) => String(Math.round(x * 1000) / 1000).replace(/^0\./, ".");

/** Range limits for a melody a congregation sings: G3 to A5, at most a twelfth from top to bottom. */
export const RANGE = { low: 55, high: 81, span: 19 };

/**
 * Converts one score. Returns
 *   { base, title, slug, tune: {...tune JSON}, hymn: {...hymn JSON}, problems: [...], copyright: null | reason,
 *     notes: [...], firstLine }
 * `problems` are the failed gates (a draft); `copyright` is set when the hymn must not be imported at all.
 */
export function convertScore(text, { base, today }) {
  const N = loadEngine();
  const problems = [], notes = [];
  const abc = parseAbc(text);
  const f = abc.fields, meta = abc.meta;

  // ── Titles and credits ──
  const titles = (f.T || []).map((t) => t.replace(/%.*/, "").trim()).filter(Boolean);
  const title = titleCase(titles[0].replace(/^Bonus [^:]*:\s*/i, ""));
  const alsoKnownAs = titles.slice(1).flatMap((t) => { const m = /^\(also known as (.+)\)$/i.exec(t); return m ? m[1].split(/\s+or\s+/).map((x) => titleCase(x.trim())) : []; });
  const clauses = creditClauses(f.C || []);
  const copyrightLines = (f.C || []).filter((l) => /copyright/i.test(l)).join(" ").replace(/\s+/g, " ").trim();
  let copyright = null;
  const lic = copyrightLines.replace(/^.*?copyright:/i, "copyright:").replace(/This score is a part.*$/, "").trim();
  // Plain public domain; or words and music public domain with only the harmony (the "setting", not
  // used here: the melody is the tune itself) under someone's copyright or another licence.
  const plain = /^copyright:\s*public domain\b/i.test(lic) && !/copyright\s+(©|\(c\)|\d{4}|\uFFFD)/i.test(lic);
  const settingOnly = /^copyright:\s*(words and music|music (?:&|and) lyrics),?\s*public domain\.\s*setting:/i.test(lic);
  if (settingOnly) notes.push("The source's harmony (its setting) is under its own licence; only the melody and the words, which it marks public domain, are used here.");
  if (!plain && !settingOnly) copyright = `the source's licence is not plain public domain (“${lic}”)`;

  const authors = parsePeople(meta.AUTHOR).map((p) => ({ ...p, role: "Words" }));
  const translators = /^(composite)$/i.test(meta.TRANSLATOR || "") ? [{ name: "Several translators (composite)", role: "Translated" }] : parsePeople(meta.TRANSLATOR).map((p) => ({ ...p, role: "Translated" }));
  const composers = parsePeople(meta.COMPOSER).map((p) => ({ ...p, role: "Music" }));
  const musicYear = firstYear(clauses.music), settingYear = firstYear(clauses.setting);
  // The score's S: notes sometimes say where its words were found ("Translation found in The Lutheran
  // Hymnary, 1913", "Words same source" as a music source of 1904): the words were in print by then.
  const sNotes = (f.S || []).join(" ");
  const foundYear = (re) => { const m = re.exec(sNotes); return m ? firstYear(m[0]) : null; };
  const sameSource = /\b(words|text)\b[^.]{0,40}\b(same source|found there)/i.test(sNotes) ? foundYear(/source:[^.]*?\b1\d{3}\b/i) : null;
  const translationFound = foundYear(/translation\b[^.]{0,20}\b(found in|from|source:?)[^.]*?\b1\d{3}\b/i);
  const wordsFound = foundYear(/\b(words|lyrics|text)( source)?:?\s*(from|found in)?\s*[^.]*?\b1\d{3}\b/i);
  let wordsYear = firstYear(clauses.words), translationYear = firstYear(clauses.translation);
  if (!translationYear && translators.length && (translationFound || sameSource)) {
    translationYear = translationFound || sameSource;
    notes.push(`The score's notes give the translation as in print by ${translationYear}.`);
  }
  if (!wordsYear && !translators.length && (wordsFound || sameSource)) {
    wordsYear = sameSource || wordsFound;
    notes.push(`The score's notes give the words as in print by ${wordsYear}.`);
  }
  if (!authors.length) problems.push("the score names no author for the words");
  if (!composers.length) problems.push("the score names no composer or source for the tune");
  authors.forEach((p) => { if (wordsYear && !p.traditional) p.role = `Words (${wordsYear})`; });
  translators.forEach((p) => { if (translationYear) p.role = `Translated (${translationYear})`; });
  composers.forEach((p) => { if (musicYear && !p.traditional) p.role = `Music (${musicYear})`; });
  for (const p of composers) if (p.traditional) p.role = musicYear ? `Melody (${musicYear})` : "Melody";
  for (const p of authors) if (p.traditional) p.role = wordsYear ? `Words (${wordsYear})` : "Words";
  const textPeople = [...authors, ...translators];
  // The words on the page are the translation when there is one: their first publication is the later of the two
  // (an anonymous original needs no year of its own).
  const originalAnonymous = authors.length && authors.every((p) => p.traditional);
  let textPublished = null;
  if (translators.length) {
    if (translationYear && (wordsYear || originalAnonymous)) textPublished = Math.max(translationYear, wordsYear || 0);
  } else textPublished = wordsYear;
  if (!wordsYear && !(translators.length && originalAnonymous)) problems.push("the score gives no year for the words");
  if (translators.length && !translationYear) problems.push("the score gives no year for the translation");
  // The tune was in print by the year of the setting the hymnal copied, when the music clause has no year of its own.
  const musicPublished = musicYear || settingYear || null;
  if (!musicYear && settingYear) notes.push(`The score gives no year for the tune; it was in print by ${settingYear}, the year of the setting the Open Hymnal copied.`);
  if (!musicPublished) problems.push("the score gives no year for the tune");
  // Known copyright (a living writer, a death in 1955 or later): not imported at all.
  for (const p of [...textPeople, ...composers]) {
    if (p.traditional) continue;
    if (p.living) copyright = copyright || `${p.name} (born ${p.born}) is living, so the hymn is not public domain`;
    else if (p.died >= PD_DIED_BEFORE) copyright = copyright || `${p.name} died in ${p.died}, so the hymn is still in copyright in Nigeria, the UK and the EU`;
  }
  if (textPublished >= 1929 || musicPublished >= 1929) copyright = copyright || `first published in ${Math.max(textPublished || 0, musicPublished || 0)}, after 1928`;
  const pd = publicDomainProblems({ text: textPeople, music: composers, textPublished, musicPublished });
  for (const p of pd) if (!problems.some((q) => p.includes(q))) problems.push(`not provably public domain: ${p}`);

  // ── The melody ──
  const meter = abc.meter;
  if (!meter) problems.push("the score has no time signature (a chant or free rhythm), which the solfa grid cannot bar");
  for (const p of abc.problems) {
    if (p === "grace notes left out") notes.push("The score's grace notes are left out of the melody.");
    else problems.push(`the score has ${p}, which the importer does not render`);
  }
  const bpb = meter ? meter.beats * 4 / meter.unit : 4;
  const time = meter ? meter.text : null;

  // Notes in order with their segment and bar; ties and continuations as written.
  const slots = []; // every sounding note (tie continuations too), as lyrics align to them
  const bars = [[]];
  abc.segments.forEach((seg, si) => {
    for (const e of seg.events) {
      if (e.type === "bar") { if (bars[bars.length - 1].length) bars.push([]); continue; }
      const item = { ...e, seg: si, bar: bars.length - 1 };
      bars[bars.length - 1].push(item);
      if (e.type === "note") slots.push(item);
    }
  });
  if (!bars[bars.length - 1].length) bars.pop();
  if (!slots.length) problems.push("no melody notes in the score");

  // Leading rests make a pickup.
  while (bars.length && bars[0].length && bars[0][0].type === "rest") bars[0].shift();
  // Bars: a bar split by a line or a double bar (a phrase ending, then the next phrase's pickup) is joined back into one.
  const sum = (b) => b.reduce((a, e) => a + e.dur, 0);
  const merged = [];
  let acc = null;
  bars.forEach((b, i) => {
    const s = sum(b);
    if (i === 0 && s < bpb - 1e-9) { merged.push(b); return; }
    if (acc) {
      acc = acc.concat(b);
      if (Math.abs(sum(acc) - bpb) < 1e-9) { merged.push(acc); acc = null; }
      else if (sum(acc) > bpb + 1e-9) { problems.push(`bar ${merged.length + 1} does not add up to ${bpb} beats`); merged.push(acc); acc = null; }
      return;
    }
    if (Math.abs(s - bpb) < 1e-9) merged.push(b);
    else if (s < bpb) acc = b;
    else { problems.push(`bar ${merged.length + 1} has ${fmtBeats(s)} beats, more than ${bpb}`); merged.push(b); }
  });
  if (acc) merged.push(acc);
  const pickup = merged.length && sum(merged[0]) < bpb - 1e-9 ? sum(merged[0]) : 0;
  // The last bar: a full bar less the pickup, or a full bar. Rests after the last note are only
  // padding — dropped, or added to fill the bar out — and nothing in the grid or the staff shows them.
  if (merged.length > 1) {
    const end = merged[merged.length - 1];
    while (end.length > 1 && end[end.length - 1].type === "rest") end.pop();
    const want = pickup ? bpb - pickup : bpb, s = sum(end);
    if (s < want - 1e-9) end.push({ type: "rest", dur: want - s });
    else if (s > want + 1e-9 && s < bpb - 1e-9) end.push({ type: "rest", dur: bpb - s });
  }
  for (const it of slots) if (Math.abs(it.dur * 4 - Math.round(it.dur * 4)) > 1e-9) { problems.push("a note shorter than a semiquaver or off the quarter-beat grid"); break; }

  // ── Lyrics: each w: line aligned to its segment's notes, as abcm2ps lays them out ──
  const segNotes = abc.segments.map((_, si) => slots.filter((s) => s.seg === si));
  const nVerses = Math.max(0, ...abc.segments.map((s) => s.lyrics.length));
  const segKind = abc.segments.map((s, si) => (!segNotes[si].length ? "empty" : s.lyrics.length === nVerses ? "verse" : s.lyrics.length === 1 ? "shared" : s.lyrics.length === 0 ? "none" : "uneven"));
  if (!nVerses) problems.push("the score has no words under the melody");
  if (segKind.includes("uneven")) problems.push("some lines of music carry words for only some of the verses");
  if (segKind.includes("none")) problems.push("a line of music has no words under it");
  /** Verse v's syllable for every slot: {text, joins} | null. */
  const verseSyllables = (v) => {
    const out = new Map();
    abc.segments.forEach((seg, si) => {
      const kind = segKind[si];
      const line = kind === "verse" ? seg.lyrics[v] : kind === "shared" ? seg.lyrics[0] : null;
      if (line == null) return;
      const ns = segNotes[si];
      let k = 0, first = true;
      for (const tok of lyricTokens(line)) {
        if (tok.bar) { const b = k > 0 ? ns[k - 1].bar : -1; while (k < ns.length && ns[k].bar === b) k++; continue; }
        if (k >= ns.length) { if (tok.text) problems.push(`verse ${v + 1} has more syllables than notes in line ${si + 1}`); break; }
        if (tok.text) {
          let t = tok.text;
          if (first && kind === "verse") t = t.replace(/^\d+[.,]\s*/, "");
          first = false;
          if (t) out.set(ns[k], { text: t, joins: tok.joins });
        }
        k++;
      }
      // Notes left over at the end of a line with no syllable (and not held over by a tie): the first
      // verse is short of words there, which a held "_" would hide.
      if (v === 0) {
        const left = ns.slice(k).filter((n, i) => { const prev = ns[k + i - 1]; return !(prev && prev.tie && prev.midi === n.midi); });
        if (left.length) problems.push(`the first verse has fewer syllables than notes in line ${si + 1}`);
      }
    });
    return out;
  };

  // Tie continuations merge into one note (as parseMelody merges them); a syllable on one would be lost.
  const isContinuation = new Set();
  for (let i = 1; i < slots.length; i++) {
    const a = slots[i - 1], b = slots[i];
    if (a.tie && a.midi === b.midi) isContinuation.add(b);
  }
  const v1 = verseSyllables(0);
  const syllables = []; // per merged note
  for (const s of slots) {
    if (isContinuation.has(s)) { if (v1.get(s)) problems.push("a syllable of the first verse falls on a tied note"); continue; }
    syllables.push(v1.get(s) || null);
  }
  // The underlay, in the hymn format: hyphens join a word's syllables, "_" carries one over a note.
  const clean = (t) => t.replace(/\s+/g, "\u203f").replace(/-/g, "\u2011").replace(/_/g, "");
  const words = [];
  let word = null, prevJoins = false;
  for (const s of syllables) {
    if (!s) {
      if (!word) { problems.push("the first note has no word under it"); continue; }
      word[word.length - 1].holds++;
      continue;
    }
    if (!word || !prevJoins) { word = []; words.push(word); }
    word.push({ text: clean(s.text), holds: 0 });
    prevJoins = s.joins;
  }
  const underlay = words.map((w) => w.map((s) => s.text + "_".repeat(s.holds)).join("-")).join(" ");

  // ── Verses, from every w: line and the W: verses after the score ──
  const metre = metreCounts(meta.METRICAL);
  let estimated = false;
  const sharedSuffix = segKind.lastIndexOf("verse") < segKind.indexOf("shared") && segKind.indexOf("shared") >= 0 && segKind.slice(segKind.indexOf("shared")).every((k) => k !== "verse");
  const verseWords = (v) => {
    const syl = verseSyllables(v);
    const own = [], shared = [];
    for (const s of slots) { const x = syl.get(s); if (!x) continue; (sharedSuffix && segKind[s.seg] === "shared" ? shared : own).push(x); }
    return { own: toWords(own), shared: toWords(shared) };
  };
  const verses = [];
  for (let v = 0; v < nVerses; v++) {
    const { own, shared } = verseWords(v);
    if (sharedSuffix && shared.length) {
      // The metre usually counts the refrain's lines too: split verse and refrain together, then cut
      // at the verse's last word when that falls on a line end; otherwise split each on its own.
      const both = toLines([...own, ...shared], metre);
      let n = 0, cut = -1;
      both.lines.forEach((l, i) => { n += l.split(/\s+/).length; if (n === own.length) cut = i + 1; });
      let ownLines, refLines;
      if (both.byMetre && cut > 0) { ownLines = both.lines.slice(0, cut); refLines = both.lines.slice(cut); }
      else {
        const a = toLines(own, metre), b = toLines(shared, null);
        ownLines = a.lines; refLines = b.lines;
        if (!a.byMetre) estimated = true;
      }
      if (ownLines.length) verses.push({ lines: ownLines });
      if (v === 0) verses.push({ label: "Refrain", lines: refLines });
    } else {
      const r = toLines(own, metre);
      if (!r.byMetre) estimated = true;
      if (r.lines.length) verses.push({ lines: r.lines });
    }
  }
  for (const w of abc.words) verses.push({ lines: w.lines });
  if (verses.some((v) => v.lines.some((l) => /\d|insert|\[|\]/i.test(l)))) problems.push("the words contain verse numbers or editor's notes");
  if (estimated) notes.push("Line breaks in the words are worked out from the syllables and punctuation; check them against a hymn book.");
  if (abc.words.length) notes.push(`The last ${abc.words.length === 1 ? "verse is" : `${abc.words.length} verses are`} printed after the score in the source, not under the notes.`);

  // ── Key, tempo, range ──
  const key = abc.key;
  const sounding = slots.filter((s) => !isContinuation.has(s));
  let keyText = null;
  if (key.mode === "major") keyText = `${key.tonic} major`;
  else if (key.mode === "minor") keyText = `${key.tonic} minor`;
  else { keyText = `${key.majorTonic} major`; notes.push(`The score is in the ${key.mode} mode; the doh is the key signature's.`); }
  if (key.mode === "major" && sounding.length) {
    const finalPc = ((sounding[sounding.length - 1].midi % 12) + 12) % 12;
    if (finalPc !== pcOf(key.tonic) && finalPc === pcOf(MINOR_OF[key.tonic] || "C")) keyText = `${MINOR_OF[key.tonic]} minor`;
    else if (finalPc !== pcOf(key.tonic)) notes.push(`The tune ends on ${pitchName(sounding[sounding.length - 1]).replace(/\d+$/, "")}, not on the key note: it may be modal.`);
  }
  if (!N.parseKey(keyText)) problems.push(`the key "${keyText}" cannot be read`);
  const tempo = Math.max(48, Math.min(132, abc.tempo || 96));
  const lo = Math.min(...sounding.map((s) => s.midi)), hi = Math.max(...sounding.map((s) => s.midi));
  if (sounding.length && (lo < RANGE.low || hi > RANGE.high || hi - lo > RANGE.span)) problems.push(`the range (MIDI ${lo}–${hi}) is outside what a congregation sings`);

  // ── The melody string, checked by the build's own parser ──
  let melody = null, parsed = null;
  if (meter && slots.length) {
    melody = merged.map((b) => b.map((e) => (e.type === "rest" ? `r:${fmtBeats(e.dur)}` : `${pitchName(e)}:${fmtBeats(e.dur)}${e.tie ? "~" : ""}`)).join(" ")).join(" | ");
    try { parsed = parseMelody(melody, { time, pickup }); }
    catch (e) { problems.push(`the melody does not parse: ${e.message}`); }
  }
  if (parsed) {
    const n = N.syllabify(underlay).length;
    if (n !== parsed.notes.length) problems.push(`the first verse has ${n} syllables (counting each “_”) for ${parsed.notes.length} notes`);
  }

  const seen = [...new Set(problems)];
  problems.length = 0;
  problems.push(...seen);
  const bpbCells = bpb * 2;
  const lineBars = bpbCells <= 6 ? 4 : bpbCells <= 12 ? 2 : 1;
  const tuneName = (tuneNameFrom(clauses.music, base) || title).toUpperCase();
  const topics = (meta.TOPICS || "").match(/\{[^}]+\}/g)?.map((t) => t.slice(1, -1).replace(/\s*\[[^\]]*\]\s*$/, "").trim()).filter(Boolean) || [];
  const category = meta.CATEGORY ? titleCase(meta.CATEGORY.toLowerCase()).replace(/^Lord's/, "Lord’s") : null;
  const source = (f.S || []).join(" ").replace(/\s+/g, " ").replace(/^Music source:\s*/i, "").trim();
  const slug = slugify(title);

  const people = (ps) => ps.map((p) => ({ name: p.name, ...(p.traditional ? { traditional: true } : {}), ...(p.born ? { born: p.born } : {}), ...(p.died != null ? { died: p.died } : {}), ...(p.lived ? { lived: p.lived } : {}), role: p.role }));
  const confidence = problems.length ? "imported, unchecked: held back as a draft" : "imported, unchecked: every automatic check passed";
  const reviewNotes = [
    ...(problems.length ? [`Held back: ${problems.join("; ")}.`] : []),
    "Imported from the Open Hymnal Project's ABC score; check the notes and the words against a hymn book you trust, then set \"reviewed\": true.",
    ...notes,
    ...(source ? [`The Open Hymnal's own source: ${source}`] : []),
  ].join(" ");

  const tune = {
    name: tuneName,
    music: people(composers),
    musicPublished,
    key: melody ? keyText : null,
    time: melody ? time : null,
    tempo: melody ? tempo : null,
    pickup,
    lineBars,
    melody: problems.some((p) => /melody does not parse|bar \d|semiquaver|no time signature|triplets|repeat|key change|metre/.test(p)) ? null : melody,
    reviewed: false,
    confidence,
    source: SOURCE_NAME,
    sourceUrl: sourceUrl(base),
    licence: SOURCE_LICENCE,
    reviewNotes,
  };
  const firstLine = verses[0] ? verses[0].lines[0] : "";
  const hymn = {
    title,
    ...(alsoKnownAs.length ? { alsoKnownAs } : {}),
    tune: null, // set by the importer once the tune's slug is settled
    text: people(textPeople),
    textPublished,
    description: describe(title, verses.length),
    about: about({ authors, translators, composers, wordsYear, translationYear, musicYear, tuneName }),
    underlay,
    verses: verses.length ? verses : [{ lines: [title] }],
    ...(category ? { category } : {}),
    ...(topics.length ? { topics } : {}),
    ...(meta.METRICAL ? { metre: meta.METRICAL.trim() } : {}),
    source: SOURCE_NAME,
    sourceUrl: sourceUrl(base),
    licence: SOURCE_LICENCE,
    credits: SOURCE_CREDIT,
    updated: today,
    reviewed: false,
    draft: problems.length > 0,
  };
  // Every name the score gives the tune ('Stockbridge' or 'Did You Think To Pray'), and the file name's.
  const tuneAliases = [...new Set([...(clauses.music || "").matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]).concat(base.split("-").slice(1).map((x) => x.replace(/_/g, " "))).map(normalizeTitle).filter((x) => x && x !== "untitled"))];
  return { base, title, slug, tune, hymn, problems, copyright, notes, firstLine, parsed, tuneAliases };
}

function describe(title, nVerses) {
  const all = nVerses > 1 ? `all ${nVerses} verses` : "the words";
  const options = [
    `${title} in Tonic Solfa: the solfa line by line with the words, staff notation, ${all}, and a piano to sing along with.`,
    `${title} in Tonic Solfa: the solfa with the words, staff notation, ${all} and a piano.`,
    `${title} in Tonic Solfa, with staff notation and ${all}.`,
    `${title} in Tonic Solfa.`,
  ];
  return options.find((d) => d.length <= 155) || options[options.length - 1].slice(0, 155);
}

const names = (ps) => ps.map((p) => p.name).join(" and ");
function about({ authors, translators, composers, wordsYear, translationYear, musicYear, tuneName }) {
  const parts = [];
  const words = authors.filter((p) => !p.traditional);
  if (words.length) parts.push(`The words are by ${names(words)}${wordsYear ? `, first published in ${wordsYear}` : ""}.`);
  else if (authors.length) parts.push(`The words are anonymous${wordsYear ? `, in print by ${wordsYear}` : ""}.`);
  const tr = translators.filter((p) => !p.traditional && !/composite/i.test(p.name));
  if (tr.length) parts.push(`The English translation is by ${names(tr)}${translationYear ? ` (${translationYear})` : ""}.`);
  const comp = composers.filter((p) => !p.traditional);
  const trad = composers.filter((p) => p.traditional);
  if (comp.length) parts.push(`The tune, ${tuneName}, is by ${names(comp)}${musicYear ? ` (${musicYear})` : ""}.`);
  else if (trad.length) parts.push(`The tune, ${tuneName}, is ${trad.map((p) => p.name.replace(/^Traditional \((.*)\)$/, "a traditional $1 melody").replace(/^From /, "from ")).join(" and ")}.`);
  parts.push("This version of the melody and the words comes from the Open Hymnal Project.");
  return [parts.join(" ")];
}
