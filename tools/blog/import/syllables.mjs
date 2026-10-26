// Sung syllables for hymn words, and lines fitted to a metre: what a words-only hymn needs before it can be laid under
// a tune one syllable to a note (import/watts.mjs).
//
// A word is split by, in order: how our own hymns already sing it (the underlays in content/hymns that a person or a
// source set, the commonest split of each word; never a page set here, which would teach the next run its own
// mistakes), the TeX English hyphenation patterns (the `hyphen` package, ISC), and the word's vowel groups. A line is
// then fitted to the number of syllables its metre gives it: a word read with fewer syllables than its vowels show is
// split further ("a-bide", "ho-ly"), and a line still a syllable over is sung as the old books sang it: a word they
// printed short ("heav'n", "pow'r", "wand'ring", "list'ning", "guard-ian"), then "the" run into a word that begins with
// a vowel ("th'e-ter-nal"). No piece is left without a vowel. A line that cannot be fitted is reported, never forced.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR } from "../lib/site.mjs";

const require = createRequire(import.meta.url);
const { hyphenateSync } = require("hyphen/en-us");

/** A word's letters, lower case, for looking it up ("Heav'n," → "heavn"). */
export function wordKey(word) {
  return String(word).toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
}

/** {key: [piece lengths]} from the underlays of our hymns: the commonest split of each word (never from words this module set). */
export function underlayDictionary(dir = path.join(CONTENT_DIR, "hymns")) {
  const seen = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const h = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (h.setByMetre) continue;
    for (const token of String(h.underlay || "").split(/\s+/)) {
      const pieces = token.replace(/_/g, "").split("-").map(wordKey).filter(Boolean);
      const key = pieces.join("");
      if (!key) continue;
      const shape = pieces.map((p) => p.length).join(",");
      const counts = seen.get(key) || new Map();
      counts.set(shape, (counts.get(shape) || 0) + 1);
      seen.set(key, counts);
    }
  }
  const out = {};
  for (const [key, counts] of seen) out[key] = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  return out;
}

/** How many syllables a word's vowels show (an estimate: the metre has the last word). */
export function vowelSyllables(word) {
  let w = wordKey(word);
  if (!w) return 0;
  w = w.replace(/^y/, "");
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w) && n > 1) n--;                 // silent final e (not "ta-ble")
  for (const m of w.matchAll(/[^aeiouy]e(?=(ly|li|ness|ful|ment|less|ty))/g)) {        // "di-vine-ly", "love-li-ness", "safe-ty"
    if (n > 1 && m.index > 0 && !/[^aeiouy]le$/.test(w.slice(0, m.index + 2))) n--;   // (not "gen-tle-ness")
  }
  if (/[gq]ues?$/.test(w) && n > 1) n--;                                                   // "tongue", "plague"
  if (/[^aeiouytd]ed$/.test(w) && n > 1) n--;                                          // "loved", not "wanted"
  if (/([^aeiouysxzhgc]|th)es$/.test(w) && n > 1) n--;                                 // "comes", "breathes", not "praises"
  if (/^(there|where|here)(fore|in|of|by|on|with|to|upon)$/.test(w)) n--;                 // "there-fore"
  n += hiatus(w);
  if (!/^eye/.test(w)) n += (w.match(/[aeiou]y(?=[aeiou])/g) || []).length;              // "pray-ing", "jour-ney-ing", "roy-al"
  if (/iour/.test(w)) n--;                                                                // "Sav-iour", "be-hav-iour"
  if (/^(un|re|pro)?creat(?!ur)/.test(w)) n++;                                            // "Cre-a-tor", "un-cre-a-ted"
  return Math.max(1, n);
}

/** Vowels sung apart within one vowel group ("glo-ri-ous", "Al-le-lu-ia"): each is a syllable the old books could also run together. */
function hiatus(w) {
  let n = 0;
  for (const m of w.matchAll(/[aeiouy]+/g)) {
    const g = m[0], before = w[m.index - 1] || "";
    const after = w.slice(m.index + g.length, m.index + g.length + 1);
    if (!(/^(ia|io|iu|eo|ua|uo|yi)$|^(iou|ia|io)/.test(g) || (g === "ue" && /[lnt]/.test(after))) || /[ctsxqg]/.test(before)) continue;
    if (g === "eo" && after === "p") continue;                                            // "peo-ple"
    if (g.startsWith("io") && (before === "n" || w.slice(m.index - 2, m.index) === "ll")) continue;  // "com-mu-nion", "mil-lions"
    n++;
  }
  return n;
}

/** The core letters of a token and what stands either side of them ("“Heav'n,”" → ["“", "Heav'n", ",”"]). */
function core(token) {
  const m = /^([^\p{L}]*)(.*?)([^\p{L}]*)$/u.exec(token);
  return [m[1], m[2], m[3]];
}

/** Cut `text` after the given numbers of letters (apostrophes and other marks ride with the letter before). */
function cutAtLetters(text, lengths) {
  const out = [];
  let cur = "", count = 0, k = 0;
  for (const ch of text) {
    const isLetter = /\p{L}/u.test(ch);
    if (isLetter && k < lengths.length - 1 && count === lengths[k]) { out.push(cur); cur = ""; count = 0; k++; }
    cur += ch;
    if (isLetter) count++;
  }
  out.push(cur);
  return out;
}

/** One word's sung pieces, before any metre: our hymns' split, else the hyphenation patterns. */
export function splitWord(token, dict = {}) {
  const [pre, mid, post] = core(token);
  if (!mid) return [token];
  const key = wordKey(mid);
  const known = dict[key];
  let pieces;
  if (known && known.reduce((a, b) => a + b, 0) === key.length) pieces = cutAtLetters(mid, known);
  else pieces = hyphenateSync(mid, { hyphenChar: "\u0001", minWordLength: 3 }).split("\u0001");
  // A piece with no vowel cannot carry a note ("memo-r-i-al"): it joins the piece before it.
  for (let i = pieces.length - 1; i > 0; i--) if (!/[aeiouy]/i.test(pieces[i])) pieces.splice(i - 1, 2, pieces[i - 1] + pieces[i]);
  if (pieces.length > 1 && !/[aeiouy]/i.test(pieces[0])) pieces.splice(0, 2, pieces[0] + pieces[1]);
  pieces[0] = pre + pieces[0];
  pieces[pieces.length - 1] += post;
  return pieces;
}

/** Consonants a syllable can begin with. */
const ONSET = /^([bcdfghjklmnpqrstvwxz]|th|sh|ch|ph|wh|gh|qu|bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|sc|sk|sl|sm|sn|sp|st|sw|tr|tw|wr|thr|shr|str|spr|spl|scr)$/i;

/** A further split of a word read short: at the vowel group that has none ("abide" → "a-bide", "vengeance" → "ven-geance"). */
function splitMore(pieces) {
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i], groups = [...p.matchAll(/[aeiouy]+/gi)];
    if (groups.length < 2) continue;
    // The next syllable takes the longest run of consonants a syllable can start with ("a-broad", "ven-geance").
    const end1 = groups[0].index + groups[0][0].length, second = groups[1].index;
    let cut = second;
    for (let k = end1; k < second; k++) if (ONSET.test(p.slice(k, second))) { cut = k; break; }
    if (cut <= 0 || cut >= p.length) continue;
    return [...pieces.slice(0, i), p.slice(0, cut), p.slice(cut), ...pieces.slice(i + 1)];
  }
  // Two vowels sung apart ("Zi-on", "vi-als", "glo-ri-ous"): cut between them.
  for (let i = 0; i < pieces.length; i++) {
    const m = /(?<![ctsxqg])(i)(?=[aou])|(e)(?=o)|(u)(?=[ao])/i.exec(pieces[i]);
    if (!m || m.index + 1 >= pieces[i].length) continue;
    const cut = m.index + 1, p = pieces[i];
    if (!/\p{L}/u.test(p.slice(0, cut).replace(/[^\p{L}]/gu, "")) || !/\p{L}/u.test(p.slice(cut))) continue;
    return [...pieces.slice(0, i), p.slice(0, cut), p.slice(cut), ...pieces.slice(i + 1)];
  }
  return null;
}

/** Words the old books sang a syllable short, as their spellings show ("heav'n", "pow'r", "wand'ring"). */
const SHORT_SUNG = /^(heaven|heavens|heavenly|given|even|seven|driven|riven|power|powers|flower|flowers|tower|bower|shower|showers|showered|hour|hours|fire|fires|prayer|prayers|every|evening|wandering|glorious|spirit|spirits|towering|flowery|toward|towards|knowest|showest|goest|doest)$/;

/**
 * A word that may be sung a syllable short: one of SHORT_SUNG (or its possessive), an unstressed vowel dropped before
 * -ing or -ous ("lis-t'ning", "gath-'ring", "fol-l'wing", "dan-g'rous"), or two vowels run together in a word of three syllables or more ("mys-te-rious",
 * "guard-ian", "war-rior"; never "tri-umph").
 */
function sungShort(token) {
  const k = wordKey(token);
  return SHORT_SUNG.test(k) || SHORT_SUNG.test(k.replace(/s$/, "")) || /[^aeiou](en|er|on|ow|ey)ing$/.test(k) || /[^aeiou](er|or)ous$/.test(k) || (hiatus(k) > 0 && vowelSyllables(k) >= 3);
}

/**
 * A line as `target` sung syllables: [[word pieces], …], or null when it cannot be done honestly.
 * `dict` is underlayDictionary().
 */
export function fitLine(line, target, dict = {}) {
  const words = String(line).split(/\s+/).filter((w) => /\p{L}/u.test(w));
  // A hyphenated compound ("life-gate", "Holy-Ghost") is two words to sing.
  // An elision printed as a word of its own ("th' eternal") is sung with the word it runs into.
  const tokens = words.flatMap((w) => w.split(/(?<=\p{L})[-‑](?=\p{L})/u))
    .reduce((out, t) => (out.length && /^[^aeiouy]+[’']$/i.test(out[out.length - 1]) ? [...out.slice(0, -1), out[out.length - 1] + t] : [...out, t]), []);
  let split = tokens.map((t) => splitWord(t, dict));
  const total = () => split.reduce((n, p) => n + p.length, 0);
  // "the" run into a word beginning with a vowel: the index of that "the", or -1.
  const elidable = () => split.findIndex((p, j) => p.length === 1 && /^the$/i.test(tokens[j]) && /^[aeio]/i.test(tokens[j + 1] || ""));
  const elide = (k) => { split[k + 1] = [tokens[k].replace(/e$/i, "'") + split[k + 1][0], ...split[k + 1].slice(1)]; split[k] = []; };
  // Short: split the words whose vowels show more syllables than they have, the biggest gap first.
  for (let guard = 0; total() < target && guard < 12; guard++) {
    const order = split.map((p, i) => [i, vowelSyllables(tokens[i]) - p.length]).filter(([, gap]) => gap > 0).sort((a, b) => b[1] - a[1]);
    let done = false;
    for (const [i] of order) { const more = splitMore(split[i]); if (more) { split[i] = more; done = true; break; } }
    if (!done) break;
  }
  // Long: a word the old books sang short, then a word split beyond what its vowels show, then "the" run into a word
  // beginning with a vowel ("th'e-ter-nal", as the old books print it).
  for (let guard = 0; total() > target && guard < 12; guard++) {
    const floor = (k) => Math.max(1, vowelSyllables(tokens[k]) - 1);
    let i = split.findIndex((p, k) => p.length > floor(k) && sungShort(tokens[k]));
    if (i < 0) i = split.findIndex((p, k) => p.length > vowelSyllables(tokens[k]));
    if (i >= 0) {
      const p = split[i];
      split[i] = [...p.slice(0, -2), p[p.length - 2] + p[p.length - 1]];
      continue;
    }
    const k = elidable();
    if (k < 0) break;
    elide(k);
  }
  if (total() !== target) return null;
  // The count is right; now the right words: a word split beyond its vowels gives a syllable to one left short
  // ("heav-ens … abroad" becomes "heavens … a-broad").
  for (let guard = 0; guard < 8; guard++) {
    const under = split.findIndex((p, k) => p.length < vowelSyllables(tokens[k]) && splitMore(p));
    if (under < 0) break;
    let over = split.findIndex((p, k) => p.length > vowelSyllables(tokens[k]));
    if (over < 0) over = split.findIndex((p, k) => k !== under && p.length > Math.max(1, vowelSyllables(tokens[k]) - 1) && sungShort(tokens[k]));
    if (over < 0) {
      const k = elidable();
      if (k < 0) break;
      split[under] = splitMore(split[under]);
      elide(k);
      continue;
    }
    const p = split[over];
    split[over] = [...p.slice(0, -2), p[p.length - 2] + p[p.length - 1]];
    split[under] = splitMore(split[under]);
  }
  // A word left with fewer syllables than its vowels show, unless the old books sang it short, is a misreading.
  if (split.some((p, k) => p.length && p.length < vowelSyllables(tokens[k]) - (sungShort(tokens[k]) ? 1 : 0))) return null;
  return split.filter((p) => p.length);
}

/** Fitted lines as an underlay ("O God, our help in a-ges past,"): one syllable to a note. */
export function underlayOf(fittedLines) {
  return fittedLines.map((line) => line.map((pieces) => pieces.join("-")).join(" ")).join(" ");
}
