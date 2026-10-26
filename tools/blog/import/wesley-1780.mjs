// John Wesley's A Collection of Hymns for the Use of the People Called Methodists (1780), as import/words-books.mjs
// reads it (--book wesley): hymns 1–539 of the Christian Classics Ethereal Library's text of the 1876 edition, which
// keeps them "substantially in the form published by John Wesley in 1780", and who wrote each.
//
// --src is a directory of its own holding the library's hymn pages as downloaded (jwg0001.html … jwg0539.html, from
// https://ccel.org/ccel/wesley/hymn/files/) and the Internet Archive's OCR text of the 1877 printing's "Index to the
// Hymns" (index-*.txt; collectionofhymn0000wesl_t0b4, methohymn00wesl and peoplca00wesl). The library's text names no
// writers; the index does: no name after a first line means Charles Wesley, "W." a hymn first printed in a book the two
// brothers published together (which of them wrote it the book cannot say), and any other writer by name. The OCR is
// rough, so an index line counts only when its first words are the hymn's own (as the library prints it, by number),
// and a hymn's writer only when the scans agree (see wesleyWriters).
import fs from "node:fs";
import path from "node:path";

export const CORE = 539;

const NAMES = /^(GOD|LORD|JESUS|JESU|CHRIST|SAVIOUR|SPIRIT|FATHER|JEHOVAH|JAH|ELOHIM|HOLY|ONE|ETERNAL|SHEPHERD|LAMB|KING|ISRAEL|ZION)$/;

/** The hymn pages in `dir`: [{number, label, verses: [[lines]]}], the first word's capitals as a word. */
export function parseWesley(dir) {
  const hymns = [];
  for (const f of fs.readdirSync(dir).filter((f) => /^jwg\d+\.html$/.test(f)).sort()) {
    const html = fs.readFileSync(path.join(dir, f), "utf8");
    const number = Number(/<TITLE>Hymn (\d+)/i.exec(html)?.[1]);
    if (!number || number > CORE) continue;
    const label = (/<H3>([^<]*)/i.exec(html)?.[1] || "").trim();
    const body = html.replace(/[\s\S]*?<\/H3>/i, "");
    const verses = body.split(/<P>/i).slice(1)
      .map((p) => p.replace(/<\/?(BODY|HTML)>/gi, "").split(/<BR>/i)
        .map((l) => l.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/^\s*\d+\s+/, "").trim())
        .filter(Boolean))
      .filter((v) => v.length);
    // "THY faithfulness, Lord" → "Thy faithfulness, Lord", "O COME" → "O come": the book sets each hymn's opening words,
    // the divine names ("JEHOVAH") and a word it stresses in capitals; written as words here, a name with its
    // capital, any other word in lower case unless it starts the line ("I'LL" → "I'll").
    for (const v of verses) v.forEach((l, i) => {
      v[i] = l.replace(/\b(\p{Lu})(\p{Lu}+)\b/gu, (w, a, b, at) => {
        if (w === "AM") return w;   // "the great I AM", as hymn books still print it
        if (/['’]/.test(l[at - 1] || "")) return w.toLowerCase();
        return NAMES.test(w) || at === 0 ? a + b.toLowerCase() : w.toLowerCase();
      });
    });
    hymns.push({ number, label, heading: [], verses });
  }
  return hymns.sort((a, b) => a.number - b.number);
}

/** An index mark, as the OCR reads it, as a writer's key; null for what cannot be read or placed. */
function mark(text) {
  const t = String(text).replace(/[^A-Za-z ,.]/g, "").replace(/\s+/g, " ").trim();
  if (!t) return "C";
  const tight = t.replace(/ /g, "");
  if (/^([IJHTWV]?[WV][.,s\-oe]*|W[.,]?W?|[IJ]W|IT|TV|JV|IV|VV|TT|IF|TF|II)\.?,?$/i.test(tight)) return "W";   // "W."
  if (/^(Dr\.? ?)?Wat[tl]s[.,]?$/i.test(t)) return "Watts";
  if (/^J\.? ?Wesley[.,]?$/i.test(t)) return "John Wesley";
  if (/^S\.? ?Wesley,? ?Sen/i.test(t)) return "Samuel Wesley";
  if (/^S\.? ?Wesley,? ?Jun/i.test(t)) return "Samuel Wesley Jr.";
  return null;
}

/**
 * Who wrote each hymn, by number: "C" (Charles Wesley), "W" (the brothers together) or a writer's name. A hymn is
 * decided when every scan that names a writer names the same one (a scan that shows no name may have lost a "W." to
 * the OCR, so a name wins over it), or, with no name anywhere, when two scans show none or one shows its dots running
 * plainly to the number. The rest are left undecided, and the importer leaves those hymns out.
 */
export function wesleyWriters(hymns, scans) {
  const firstLine = new Map(hymns.map((h) => [h.number, h.verses[0]?.[0] || ""]));
  const key = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
  const votes = new Map();
  for (const text of scans) {
    const all = text.split("\n");
    const start = all.findIndex((l) => /INDEX\s+TO\s+THE\s+HY|FIRST LINE,\s*AUTHOR/i.test(l));
    if (start < 0) continue;
    for (let raw of all.slice(start, start + 4000)) {
      raw = raw.replace(/[|“”‘’«»"]/g, " ").replace(/\s+/g, " ").trim();
      const m = /^(.*?)\s*(\d{1,4})\s*$/.exec(raw);
      if (!m) continue;
      const n = Number(m[2]), body = m[1], first = firstLine.get(n);
      if (!first || key(body).slice(0, 8) !== key(first).slice(0, 8)) continue;   // not this hymn's line
      // The mark: what is left once the hymn's own first words are taken off the front, or what follows a run of dots.
      const words = new Set(first.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean));
      const toks = body.split(/\s+/);
      let i = 0;
      while (i < toks.length && (words.has(toks[i].toLowerCase().replace(/[^a-z']/g, "")) || !/[a-z]/i.test(toks[i]))) i++;
      const rest = toks.slice(i).join(" ").replace(/^[\s.,·*•]+/, "");
      const dots = /(?:[.,·*•]\s*){2,}(.*)$/.exec(body);
      const w = /(?:[.,·*•]\s*){2,}$/.test(body) ? "C!" : mark(rest) || (dots ? mark(dots[1]) : null);
      if (w) votes.set(n, [...(votes.get(n) || []), w]);
    }
  }
  const decided = new Map();
  for (const [n, v] of votes) {
    const named = v.filter((x) => x !== "C" && x !== "C!");
    if (named.length) { if (named.every((x) => x === named[0])) decided.set(n, named[0]); }
    else if (v.length >= 2 || v.includes("C!")) decided.set(n, "C");
  }
  return decided;
}

const PEOPLE = {
  C: [{ name: "Charles Wesley", born: 1707, died: 1788, role: "Words" }],
  W: [{ name: "Charles Wesley", born: 1707, died: 1788, role: "Words" }, { name: "John Wesley", born: 1703, died: 1791, role: "Words" }],
  Watts: [{ name: "Isaac Watts", born: 1674, died: 1748, role: "Words" }],
  "John Wesley": [{ name: "John Wesley", born: 1703, died: 1791, role: "Words" }],
  "Samuel Wesley": [{ name: "Samuel Wesley", born: 1662, died: 1735, role: "Words" }],
  "Samuel Wesley Jr.": [{ name: "Samuel Wesley Jr.", born: 1691, died: 1739, role: "Words" }],
};

/** The book read from `dir`: its hymns, each with `writer` when the index decides it. */
export function loadWesley(dir) {
  const hymns = parseWesley(dir);
  const scans = fs.readdirSync(dir).filter((f) => /^index-.*\.txt$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  const writers = wesleyWriters(hymns, scans);
  return hymns.map((h) => ({ ...h, writer: writers.get(h.number) || null }));
}

/** Whom the page credits ({people}), or why the hymn is left out. */
export function creditWesley(h) {
  if (!h.writer) return { why: "the index's scans do not say plainly who wrote it" };
  return { people: PEOPLE[h.writer] };
}

/** The first paragraph of the page's About. */
export function aboutWesley(h) {
  const where = `A Collection of Hymns for the Use of the People Called Methodists (1780), hymn ${h.number}`;
  if (h.writer === "C") return `Charles Wesley wrote these words. His brother John printed them in ${where}.`;
  if (h.writer === "W") return `John Wesley printed these words in ${where}. They first appeared in a book he and his brother Charles published together, and the Collection's own index cannot say which of the two wrote them.`;
  return `${PEOPLE[h.writer][0].name} wrote these words. John Wesley printed them in ${where}.`;
}
