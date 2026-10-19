// The printable solfa: one A4 PDF per hymn (/hymns/<slug>/<slug>-tonic-solfa.pdf) and per tune page
// (/hymns/tunes/<slug>/<slug>-tonic-solfa.pdf). It prints exactly what the page's "The solfa line by line"
// section shows — the same lines and bars (view.lines, the engine's grid), the same syllables, the words sung
// in each bar (grid-html barWords) — then the other verses, the credits and a footer with the page's address.
// Nothing here names a syllable: the solfa is the engine's, laid out on paper.
//
// The fonts are the site's own, embedded and subset (pdf-lib + fontkit, pinned in package.json): JetBrains
// Mono for the solfa, Geist for the words, Source Serif 4 for the title. All three are under the SIL Open
// Font Licence (tools/blog/pdf-assets/fonts/*-OFL.*), which allows embedding. pdf-assets/mark.png is the
// brand mark (web-site/assets/mark.png) cropped and filled with the site's mark colours (--page-mark).
//
// The PDFs are built with the site (build.mjs) but never committed: see writeSite.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, PDFName, PDFString, PDFDict, PDFArray, PDFRawStream, PDFRef, rgb, decodePDFRawStream } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { ORIGIN } from "./site.mjs";
import { barWords } from "./grid-html.mjs";
import { QUARTER_MARK } from "./solfa.mjs";

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pdf-assets");
const FONT_FILES = { serif: "SourceSerif4-Semibold.ttf", sans: "Geist-Regular.ttf", sansBold: "Geist-SemiBold.ttf", mono: "JetBrainsMono-Medium.ttf" };

/** The PDF next to a page: /hymns/amazing-grace → /hymns/amazing-grace/amazing-grace-tonic-solfa.pdf. */
export function pdfPath(pagePath) {
  return `${pagePath}/${pagePath.split("/").pop()}-tonic-solfa.pdf`;
}

/** Above this a PDF is too heavy to send to a choir on a phone; check.mjs fails the build. */
export const PDF_MAX_BYTES = 80 * 1024;
/** Most hymns fit one page; a long one takes two, and nothing takes more. */
export const PDF_MAX_PAGES = 2;

/**
 * fontkit, parsing each font file once for the whole build and laying each string out once (pdf-lib asks for
 * both again in every document, and the layout is most of the build's time). A subset is still made per
 * document, so each PDF carries only the glyphs it uses; pdf-lib only reads the glyph runs.
 */
const parsed = new Map();
const cachedFontkit = {
  create(bytes, name) {
    if (!parsed.has(bytes)) {
      const font = fontkit.create(bytes, name);
      const runs = new Map(), layout = font.layout.bind(font);
      font.layout = (text, features) => {
        const k = JSON.stringify([text, features || null]);
        if (!runs.has(k)) runs.set(k, layout(text, features));
        return runs.get(k);
      };
      parsed.set(bytes, font);
    }
    return parsed.get(bytes);
  },
};

let assetBytes = null;
function assets() {
  if (!assetBytes) {
    assetBytes = { fonts: {}, mark: fs.readFileSync(path.join(ASSETS, "mark.png")) };
    for (const [k, f] of Object.entries(FONT_FILES)) assetBytes.fonts[k] = fs.readFileSync(path.join(ASSETS, "fonts", f));
  }
  return assetBytes;
}

// ── Layout (points; A4 portrait) ────────────────────────────────────────────
const PAGE = [595.28, 841.89];
const M = 54; // left and right margins
const TOP = 790; // the first baseline area starts under this
const FLOOR = 70; // nothing but the footer below this
const W = PAGE[0] - 2 * M;
const C = {
  ink: rgb(17 / 255, 24 / 255, 39 / 255),
  text: rgb(38 / 255, 50 / 255, 65 / 255),
  muted: rgb(91 / 255, 102 / 255, 118 / 255),
  accent: rgb(29 / 255, 78 / 255, 216 / 255),
  rule: rgb(212 / 255, 217 / 255, 224 / 255),
};
const SOLFA = 11.5, WORDS = 9, OCTAVE = 0.78;

/** Characters the site's text uses that the fonts draw as another: a non-breaking hyphen or space. */
const PRINTABLE = { "‑": "-", " ": " ", " ": " " };
export const printable = (text) => String(text).replace(/[‑  ]/g, (c) => PRINTABLE[c]);

// Measured once for the whole build: text widths (fontkit lays out every string it measures, which is slow)
// and the characters each font has.
const widths = new Map();
const charsets = new Map();

/**
 * The PDF for a hymn (`kind` "hymn": h.view with words) or a tune page (`kind` "tune": t.view, no words).
 * `item` carries what the page shows: { kind, title, view, verses?, subhead, credits, path, updated, subject,
 * keywords } (hymnPdfItem, tunePdfItem). Returns the bytes (a Uint8Array). Deterministic: the same content
 * gives the same file.
 */
export async function buildSolfaPdf(item) {
  const { fonts: fontBytes, mark } = assets();
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(cachedFontkit);
  const F = {}, keyOf = new Map();
  // No ligatures or contextual alternates: every character is its own glyph, so the text copies out as written.
  const features = { liga: false, clig: false, dlig: false, calt: false };
  for (const [k, b] of Object.entries(fontBytes)) { F[k] = await doc.embedFont(b, { subset: true, features }); keyOf.set(F[k], k); }
  const markImg = await doc.embedPng(mark);
  const v = item.view;
  const words = item.kind === "hymn";
  const url = ORIGIN + item.path;
  const pretty = url.replace(/^https:\/\//, "");

  // Every character must be in its font: a missing glyph would print as a box.
  const check = (font, text) => {
    const key = keyOf.get(font);
    if (!charsets.has(key)) charsets.set(key, new Set(font.getCharacterSet()));
    for (const ch of text) if (!/\s/.test(ch) && !charsets.get(key).has(ch.codePointAt(0))) throw new Error(`${item.path}: the PDF's ${FONT_FILES[key]} has no "${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`);
  };
  const width = (font, size, text) => {
    const k = keyOf.get(font) + "|" + text;
    if (!widths.has(k)) widths.set(k, font.widthOfTextAtSize(text, 1));
    return widths.get(k) * size;
  };

  const pages = [];
  let page, y;
  const draw = (font, size, text, x, yy, color) => {
    if (!text) return;
    check(font, text);
    page.drawText(text, { x, y: yy, size, font, color });
  };
  const newPage = () => {
    page = doc.addPage(PAGE);
    pages.push(page);
    y = TOP;
    if (pages.length > 1) {
      draw(F.sansBold, 9, printable(`${item.title} (continued)`), M, y - 9, C.muted);
      y -= 26;
    }
  };
  const rule = (yy) => page.drawLine({ start: { x: M, y: yy }, end: { x: M + W, y: yy }, thickness: 0.6, color: C.rule });
  /** Word-wraps `text` to `max` points. */
  const wrap = (font, size, text, max) => {
    const out = [];
    let line = "";
    for (const word of printable(text).split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && width(font, size, next) > max) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  // The credits close the last page; measured first, so the verses leave room for them.
  const CREDIT = 8.5, CREDIT_LEAD = 11.5;
  const credits = wrap(F.sans, CREDIT, item.credits, W);
  const creditsHeight = credits.length * CREDIT_LEAD + 22;

  newPage();
  // Title, then "Doh is G · 3/4" and the tune.
  for (const line of wrap(F.serif, 24, item.title, W)) { draw(F.serif, 24, line, M, y - 24, C.ink); y -= 30; }
  y -= 4;
  const head = `${v.header} · ${v.time}`;
  draw(F.sansBold, 12.5, head, M, y - 12, C.accent);
  if (item.subhead) draw(F.sans, 10, printable(item.subhead), M + width(F.sansBold, 12.5, head) + 14, y - 12, C.muted);
  y -= 24;
  rule(y);
  y -= 22;

  // The solfa, line by line: each bar is its solfa as the page writes it ("| d - - - m d ", the line's last bar
  // closed with " |") with the words sung in it under it. A line wider than the page wraps at a bar line, as
  // the page does on a phone.
  const runsOf = (bar, last) => {
    // Styled runs: { text, small, dy, accent }. The octave mark is drawn small and low (,) or high ('), and the
    // quarter-beat mark of a split cell in the accent colour, as the page draws them (grid-html syllableHtml).
    const runs = [];
    const push = (r) => {
      const prev = runs[runs.length - 1];
      if (prev && !prev.small && !prev.accent && !r.small && !r.accent) prev.text += r.text; else runs.push({ ...r });
    };
    const syllable = (s) => {
      for (const [i, one] of String(s).split("+").entries()) {
        if (i) push({ text: "+" });
        const m = /^(.*?)([,']+)$/.exec(one);
        if (!m || !m[1] || m[1] === "-" || m[1] === "_") push({ text: one });
        else { push({ text: m[1] }); push({ text: m[2], small: true, dy: m[2].startsWith(",") ? -2.2 : 3.6 }); }
      }
    };
    push({ text: "| " });
    bar.forEach((c, i) => {
      if (i) push({ text: " " });
      if (c.parts) { syllable(c.parts[0].solfa); push({ text: QUARTER_MARK, accent: true }); syllable(c.parts[1].solfa); } else syllable(c.solfa);
    });
    push({ text: last ? " |" : " " });
    return runs;
  };
  const rowHeight = words ? 31 : 22;
  for (const line of v.lines) {
    // A line a little too wide for the page is set a little smaller (down to 85%), so it stays one line as the
    // hymn book prints it; a line wider still wraps.
    const measure = (k) => line.map((bar, i) => {
      const runs = runsOf(bar, i === line.length - 1).map((r) => ({ ...r, size: (r.small ? SOLFA * OCTAVE : SOLFA) * k }));
      const solfaW = runs.reduce((s, r) => s + width(F.mono, r.size, r.text), 0);
      const w = words ? printable(barWords(bar)) : "";
      const cw = width(F.mono, SOLFA * k, "0");
      const wordsW = w ? 1.2 * cw + width(F.sans, WORDS * k, w) + cw : 0;
      return { runs, words: w, wordsAt: 1.2 * cw, wordSize: WORDS * k, width: Math.max(solfaW, wordsW) };
    });
    let bars = measure(1);
    const total = bars.reduce((s, b) => s + b.width, 0);
    if (total > W) bars = measure(Math.max(0.85, W / total));
    const rows = [];
    for (const b of bars) {
      const row = rows[rows.length - 1];
      if (row && row.width + b.width <= W) { row.bars.push(b); row.width += b.width; } else rows.push({ bars: [b], width: b.width });
    }
    for (const row of rows) {
      if (y - rowHeight < FLOOR) newPage();
      const base = y - SOLFA;
      let x = M;
      // The solfa of the whole row first, then its words, so the text reads (and copies) a line at a time.
      for (const b of row.bars) {
        let rx = x;
        for (const r of b.runs) { draw(F.mono, r.size, r.text, rx, base + (r.dy || 0), r.accent ? C.accent : C.ink); rx += width(F.mono, r.size, r.text); }
        x += b.width;
      }
      if (words) {
        x = M;
        for (const b of row.bars) { draw(F.sans, b.wordSize, b.words, x + b.wordsAt, base - 12.5, C.muted); x += b.width; }
      }
      y -= rowHeight;
    }
    y -= 5;
  }

  // The other verses, in columns (three when the lines are short, else two), balanced, numbered in the margin
  // as a hymn book prints them. They go on to a second page if they must; verses that would need a third page
  // are left to the hymn's page, and the PDF says where.
  const rest = words ? (item.verses || []).slice(1) : [];
  if (rest.length) {
    const SIZE = 9.5, LEAD = 12.4, NUM = 14, GAP = 20;
    const longest = Math.max(...rest.flatMap((vv) => vv.lines.map((l) => width(F.sans, SIZE, printable(l)))));
    const cols = longest + NUM <= (W - 2 * GAP) / 3 ? 3 : 2;
    const colW = (W - (cols - 1) * GAP) / cols;
    const blocks = rest.map((vv, i) => {
      const lines = vv.lines.flatMap((l) => wrap(F.sans, SIZE, l, colW - NUM - 8).map((t, k) => ({ text: t, indent: k ? 8 : 0 })));
      const note = vv.note ? wrap(F.sans, 8, vv.note, colW - NUM) : [];
      return { number: vv.label ? null : String(i + 2), label: vv.label || null, lines, note, height: (vv.label ? 13 : 0) + lines.length * LEAD + note.length * 10.5 + 9 };
    });
    const floor = FLOOR + creditsHeight;
    if (y - 40 - blocks[0].height < floor) newPage();
    y -= 4;
    rule(y + 4);
    y -= 12;
    draw(F.serif, 13, "The other verses", M, y - 13, C.ink);
    y -= 24;
    let i = 0;
    while (i < blocks.length) {
      const room = y - floor;
      // How many of the next verses fit in this page's columns, then the fairest way to split them.
      let n = 0, col = 0;
      const filled = new Array(cols).fill(0);
      for (let j = i; j < blocks.length; j++) {
        while (col < cols && filled[col] + blocks[j].height > room) col++;
        if (col === cols) break;
        filled[col] += blocks[j].height; n++;
      }
      if (n) {
        const hs = blocks.slice(i, i + n).map((b) => b.height);
        const split = balance(hs, cols, room);
        let k = i, tallest = 0;
        split.forEach((count, c) => {
          let yy = y;
          const x = M + c * (colW + GAP);
          for (const b of blocks.slice(k, k + count)) {
            if (b.label) { draw(F.sansBold, 8.5, printable(b.label), x + NUM, yy - 8.5, C.accent); yy -= 13; }
            b.lines.forEach((l, li) => {
              if (li === 0 && b.number) draw(F.sansBold, 9, b.number, x, yy - SIZE, C.accent);
              draw(F.sans, SIZE, l.text, x + NUM + l.indent, yy - SIZE, C.text);
              yy -= LEAD;
            });
            for (const t of b.note) { draw(F.sans, 8, t, x + NUM, yy - 8, C.muted); yy -= 10.5; }
            yy -= 9;
          }
          tallest = Math.max(tallest, y - yy);
          k += count;
        });
        y -= tallest;
        i += n;
      }
      if (i >= blocks.length || pages.length >= PDF_MAX_PAGES) break;
      newPage();
    }
    if (i < blocks.length) {
      const first = i + 2, last = rest.length + 1;
      draw(F.sans, CREDIT, `${first === last ? `Verse ${first} is` : `Verses ${first} to ${last} are`} on the hymn’s page, ${pretty}`, M, y - 4, C.accent);
      y -= 18;
    }
  }

  // Credits: who wrote it, where it came from, and that it is free to use.
  if (y - creditsHeight < FLOOR) newPage();
  y -= 4;
  rule(y);
  y -= 15;
  for (const c of credits) { draw(F.sans, CREDIT, c, M, y, C.muted); y -= CREDIT_LEAD; }

  // The footer on every page: the wordmark, and the page's address as a link.
  const tail = " — hear it and sing along";
  for (const [n, p] of pages.entries()) {
    page = p;
    page.drawLine({ start: { x: M, y: 50 }, end: { x: M + W, y: 50 }, thickness: 0.6, color: C.rule });
    page.drawImage(markImg, { x: M, y: 28, width: 11, height: 11 * 96 / 73 });
    draw(F.sansBold, 10.5, "NoteFusion", M + 15, 31, C.ink);
    const size = 8.5, wTail = width(F.sans, size, tail), wUrl = width(F.sans, size, pretty);
    const x0 = M + W - wTail - wUrl;
    draw(F.sans, size, pretty, x0, 32, C.accent);
    draw(F.sans, size, tail, x0 + wUrl, 32, C.muted);
    const link = doc.context.register(doc.context.obj({
      Type: "Annot", Subtype: "Link", Rect: [x0, 28, x0 + wUrl, 42], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    }));
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    if (pages.length > 1) draw(F.sans, size, `Page ${n + 1} of ${pages.length}`, M + 96, 32, C.muted);
  }
  if (pages.length > PDF_MAX_PAGES) throw new Error(`${item.path}: the PDF needs ${pages.length} pages (at most ${PDF_MAX_PAGES})`);

  const date = new Date(item.updated + "T00:00:00Z");
  doc.setTitle(`${printable(item.title)} in Tonic Solfa`, { showInWindowTitleBar: true });
  doc.setSubject(printable(item.subject));
  // pdf-lib joins keywords with spaces; one comma-separated string keeps each phrase whole.
  doc.setKeywords([[...new Set(item.keywords.map(printable))].join(", ")]);
  doc.setAuthor("NoteFusion");
  doc.setCreator("NoteFusion (notefusion.studio)");
  doc.setProducer("NoteFusion");
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  doc.setLanguage("en-GB");
  return doc.save({ objectsPerTick: Infinity });
}

/**
 * Splits heights (in order) into `cols` consecutive groups, each at most `room` tall, making the tallest as
 * short as it can be. Returns the count in each column.
 */
export function balance(heights, cols, room) {
  const sum = (a, b) => heights.slice(a, b).reduce((s, h) => s + h, 0);
  let best = null;
  const from = (start, col, counts) => {
    if (col === cols - 1) {
      if (sum(start, heights.length) > room) return;
      const all = [...counts, heights.length - start];
      let at = 0;
      const tallest = Math.max(...all.map((c) => { const t = sum(at, at + c); at += c; return t; }));
      if (!best || tallest < best.tallest - 1e-9) best = { tallest, all };
      return;
    }
    for (let c = 0; start + c <= heights.length && sum(start, start + c) <= room; c++) from(start + c, col + 1, [...counts, c]);
  };
  from(0, 0, []);
  return best ? best.all : [heights.length, ...new Array(cols - 1).fill(0)];
}

/** What the PDF of a prepared hymn (render-hymns prepareHymn) prints. */
export function hymnPdfItem(h, { name, writers }) {
  const v = h.view;
  return {
    kind: "hymn", title: name, view: v, verses: h.verses, path: `/hymns/${h.slug}`, updated: h.updated,
    subhead: `Tune: ${h.tuneData.name}`,
    credits: `${v.credit.text} Public domain: free to print, copy and sing. Solfa written by NoteFusion’s engine from the hymn’s notes.`,
    subject: `${name}: the Tonic Solfa (${v.header}, ${v.time}) with the words under each bar, and every verse. Free to print, from NoteFusion.`,
    keywords: [name, `${name} tonic solfa`, `${name} solfa`, "tonic solfa", "sol-fa", "hymn", "hymn sheet", "pdf", v.header.toLowerCase(), h.tuneData.name, ...writers],
  };
}

/** What the PDF of a prepared tune page (render-tunes prepareTune) prints. */
export function tunePdfItem(t, { makers }) {
  const v = t.view, form = t.form || "hymn tune";
  return {
    kind: "tune", title: `${v.title} (${form})`, view: v, path: v.url, updated: t.updated,
    subhead: t.metre && t.metre !== "Irregular" ? `Metre: ${t.metre.replace(/ (?=\d)/g, ".")}` : "",
    credits: `${v.credit.text} Public domain: free to print, copy and play. Solfa written by NoteFusion’s engine from the tune’s notes.`,
    subject: `${v.title}, the ${form}: the Tonic Solfa (${v.header}, ${v.time}). Free to print, from NoteFusion.`,
    keywords: [v.title, t.name, `${v.title} tonic solfa`, form, "tonic solfa", "sol-fa", "pdf", v.header.toLowerCase(), ...makers],
  };
}

// ── Reading a PDF back (tests and check.mjs) ────────────────────────────────
/**
 * The text a PDF shows, page by page: each page's lines (text drawn on one baseline, within a few points,
 * joined in drawing order). Reads the fonts' ToUnicode maps, so it works on the subset fonts this file embeds.
 */
export async function pdfText(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const streamText = (s) => Buffer.from(s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents()).toString("latin1");
  return doc.getPages().map((p) => {
    const res = p.node.Resources();
    const fontsDict = res && res.lookup(PDFName.of("Font"), PDFDict);
    const maps = new Map();
    if (fontsDict) for (const [key, ref] of fontsDict.entries()) {
      const font = ctx.lookup(ref, PDFDict);
      const tu = font.get(PDFName.of("ToUnicode"));
      const map = new Map();
      if (tu) {
        const cmap = streamText(ctx.lookup(tu));
        for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
          for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(m[1].toLowerCase(), Buffer.from(m[2], "hex").swap16().toString("utf16le"));
        }
      }
      maps.set(key.asString(), map);
    }
    const contents = p.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents instanceof PDFRef ? ctx.lookup(contents) : contents];
    const ops = streams.map(streamText).join("\n");
    const lines = [];
    let font = null, last = null;
    for (const m of ops.matchAll(/(\/[^\s/]+)\s+[\d.]+\s+Tf|[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+Tm|<([0-9a-fA-F]*)>\s*Tj/g)) {
      if (m[1]) font = m[1];
      else if (m[2] !== undefined) {
        const yy = Number(m[2]);
        if (last === null || Math.abs(yy - last) > 5) lines.push("");
        last = yy;
      } else {
        const map = maps.get(font) || new Map();
        let s = "";
        for (let i = 0; i < m[3].length; i += 4) s += map.get(m[3].slice(i, i + 4).toLowerCase()) ?? "�";
        if (!lines.length) lines.push("");
        lines[lines.length - 1] += s;
      }
    }
    return lines;
  });
}

/** The document's title, subject, keywords, author and page count, as a PDF reader shows them. */
export async function pdfInfo(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { title: doc.getTitle(), subject: doc.getSubject(), keywords: doc.getKeywords(), author: doc.getAuthor(), pages: doc.getPageCount() };
}
