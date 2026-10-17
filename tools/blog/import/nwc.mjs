// Bar lines from a Noteworthy Composer score (.nwc, the binary format of NWC 1.5–1.75 that CCEH's files
// use), for the CCEH importer. A MIDI file has exact notes but no bar lines, so where the first bar line
// falls (the pickup) is read from the score that has them. Only what that needs is read: each staff's
// objects in order, the length of every note, chord and rest, and the bar lines. The file is data: its
// bytes are read here and never handed to anything that runs it. Anything this reader does not recognise
// makes it give up (null), and the importer falls back on the rhythm (cceh-melody.mjs inferBarLines).

import { inflateSync } from "node:zlib";

const HEADER = "[NoteWorthy ArtWare]";
/** Fixed record sizes (bytes, with the 2-byte type) of the objects a hymn score holds; a chord adds 12 a note. */
const SIZE = { 0: 6, 1: 12, 2: 4, 3: 4, 5: 8, 6: 10, 7: 10, 8: 12, 9: 8, 10: 16, 12: 4, 14: 6 };
const DUR = [4, 2, 1, 0.5, 0.25, 0.125]; // whole … 32nd, in quarter beats

/** A note, chord or rest record's length in quarter beats: its duration code, then its dots. */
function length(b, p) {
  const code = b[p + 2];
  if (code >= DUR.length) return null;
  const flags = b[p + 6];
  const dots = flags & 0x01 ? 2 : flags & 0x04 ? 1 : 0;
  const base = DUR[code];
  return dots === 2 ? base * 1.75 : dots === 1 ? base * 1.5 : base;
}

/**
 * Reads a score's staves: [{at, events: [{type: "bar" | "time" | "note" | "rest", dur}]}] (a 1.70 score's
 * staves also carry their `name`, and its notes `tie` when tied to the next), or null when the file is not a
 * score this reader knows.
 */
export function readNwc(bytes) {
  let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // A compressed score: "[NWZ]\0", then the same file deflated.
  if (String.fromCharCode(...b.subarray(0, 5)) === "[NWZ]") {
    try { b = new Uint8Array(inflateSync(b.subarray(6))); } catch { return null; }
  }
  const ascii = (p, n) => String.fromCharCode(...b.subarray(p, p + n));
  if (ascii(0, HEADER.length) !== HEADER) return null;
  // Two record layouts are read: NWC 1.50's ("[NoteWorthy Composer]\0" then minor 50–69, major 1), which
  // most CCEH scores use, and NWC 1.70's (minor 70). Any other version is not read.
  if (ascii(23, 22) !== "[NoteWorthy Composer]\0" || b[46] !== 1 || b[45] < 50 || b[45] > 70) return null;
  if (b[45] === 70) return readNwc170(b);
  const staves = [];
  // A staff starts with its name and its group ("Standard"), NUL-terminated, 32 bytes of layout, then the
  // number of objects. Find each by its group name and check that its objects read to the end.
  for (let p = 0; p + 40 < b.length; p++) {
    if (ascii(p, 9) !== "Standard\0") continue;
    let q = p + 9 + 32;
    if (q + 2 > b.length) break;
    const count = b[q] + (b[q + 1] << 8);
    q += 2;
    const events = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      const type = b[q] + (b[q + 1] << 8);
      let size = SIZE[type];
      if (size == null) { ok = false; break; }
      if (type === 10) size += 12 * (b[q + 14] + (b[q + 15] << 8));
      if (type === 2) events.push({ type: "bar", style: b[q + 2] });
      else if (type === 5) events.push({ type: "time", num: b[q + 2], den: 2 ** b[q + 4] });
      else if (type === 8 || type === 10 || type === 9) {
        const dur = length(b, q);
        if (dur == null) { ok = false; break; }
        events.push({ type: type === 9 ? "rest" : "note", dur });
      }
      q += size;
      if (q > b.length) { ok = false; break; }
    }
    if (ok) staves.push({ at: p, events });
  }
  return staves.length ? staves : null;
}

// ── NWC 1.70 ──
// Every record has a 2-byte type, then a visibility byte, then its fields: so a note, chord or rest has its
// duration code at +3, its triplet bits at +5 and its dot flags at +7. Fixed record sizes (bytes, with the
// type) by type; a tempo (6) and a text (17) end with a NUL-terminated string after 8 and 6 bytes, and a
// chord (10, 17 bytes) and a rest chord (18, 13 bytes) are followed by their notes, each a record of its own.
const SIZE170 = { 0: 7, 1: 13, 2: 5, 3: 5, 4: 11, 5: 9, 7: 10, 8: 13, 9: 11, 11: 6, 12: 7, 13: 37, 14: 7, 15: 6, 16: 6 };

/**
 * A 1.70 note, chord or rest record's length in quarter beats: its duration code, its dots, a triplet's 2/3;
 * a grace note (a note or chord flagged at +8) takes no time in the bar.
 */
function length170(b, p, grace = false) {
  const code = b[p + 3];
  if (code >= DUR.length) return null;
  if (grace) return 0;
  const flags = b[p + 7];
  const base = DUR[code] * (b[p + 5] & 0x0c ? 2 / 3 : 1);
  return flags & 0x01 ? base * 1.75 : flags & 0x04 ? base * 1.5 : base;
}

/**
 * The staves of an NWC 1.70 score: [{name, events}], read one after another from the staff count to the
 * last byte of the file. Each staff is its name and group (NUL-terminated), 34 bytes of layout (with the
 * number of lyric lines at +30, and those lines after it), then its object count — two more than the
 * records that follow — and the records. Null unless every record is one this reader knows and the last
 * staff ends exactly where the file does.
 */
function readNwc170(b) {
  const u16 = (p) => b[p] | (b[p + 1] << 8);
  const afterNul = (p) => { while (p < b.length && b[p] !== 0) p++; return p < b.length ? p + 1 : -1; };
  // The first staff is found by its group, NWC's "Standard": its name is just before, the staff count before that.
  const g0 = Buffer.from(b.buffer, b.byteOffset, b.length).toString("latin1").indexOf("Standard\0");
  if (g0 < 3) return null;
  let p = g0 - 1;
  while (p > 0 && b[p - 1] !== 0) p--;
  if (p < 2) return null;
  const count = u16(p - 2);
  if (count < 1 || count > 64) return null;

  // One record at q (a chord's notes with it): its end, or -1. Its event, if it has one, goes to `events`.
  const record = (q, events, depth = 0) => {
    if (q + 2 > b.length) return -1;
    const type = u16(q);
    let end;
    if (SIZE170[type] != null) end = q + SIZE170[type];
    else if (type === 6) end = afterNul(q + 8);
    else if (type === 17) end = afterNul(q + 6);
    else if (type === 10 || type === 18) {
      if (depth > 1) return -1;
      const head = type === 10 ? 17 : 13;
      const n = u16(q + head - 2);
      if (q + head > b.length || n < 1 || n > 16) return -1;
      const dur = length170(b, q, type === 10 && !!(b[q + 8] & 0x20));
      if (dur == null) return -1;
      // A rest chord is a rest beside notes on a split stem: it moves on by the shorter of them.
      let shortest = dur, tie = false;
      end = q + head;
      for (let i = 0; i < n && end >= 0; i++) {
        const kid = u16(end);
        if (kid !== 8 && kid !== 10) return -1;
        const inner = [];
        end = record(end, inner, depth + 1);
        if (inner.length) { shortest = Math.min(shortest, inner[0].dur); tie = tie || inner[0].tie; }
      }
      if (end < 0) return -1;
      events.push({ type: "note", dur: type === 18 ? shortest : dur, tie });
      return end;
    } else return -1;
    if (end < 0 || end > b.length) return -1;
    if (type === 2) events.push({ type: "bar", style: b[q + 3] & 0x7f }); // 0x80 marks a system break
    else if (type === 5) {
      const num = u16(q + 3), pow = u16(q + 5);
      if (!num || num > 32 || pow > 5) return -1;
      events.push({ type: "time", num, den: 2 ** pow });
    } else if (type === 8 || type === 9) {
      const dur = length170(b, q, type === 8 && !!(b[q + 8] & 0x20));
      if (dur == null) return -1;
      events.push(type === 9 ? { type: "rest", dur } : { type: "note", dur, tie: !!(b[q + 7] & 0x10) });
    }
    return end;
  };

  const staves = [];
  for (let s = 0; s < count; s++) {
    const nameEnd = afterNul(p);
    const g = nameEnd < 0 ? -1 : afterNul(nameEnd);
    if (g < 0 || g + 34 > b.length) return null;
    const name = String.fromCharCode(...b.subarray(p, nameEnd - 1));
    const lyrics = u16(g + 30);
    if (lyrics > 8) return null;
    let q = g + 34;
    if (lyrics) {
      // Each lyric line is a block (its size, the text's size, then the block); two more bytes follow them all.
      q = g + 36;
      for (let i = 0; i < lyrics && q + 2 <= b.length; i++) q += u16(q) ? 4 + u16(q) : 2;
      q += 4;
    }
    if (q + 2 > b.length) return null;
    const n = u16(q) - 2;
    if (n < 0) return null;
    q += 2;
    const events = [];
    for (let i = 0; i < n; i++) {
      q = record(q, events);
      if (q < 0) return null;
    }
    // A whole rest alone in a bar rests for the whole bar, whatever the time signature, as NWC plays it.
    const timed = events.filter((e) => e.type !== "time");
    let bpb = null;
    for (const e of events) {
      if (e.type === "time") bpb = (e.num * 4) / e.den;
      if (e.type !== "rest" || e.dur !== 4 || !bpb) continue;
      const k = timed.indexOf(e);
      if ((k === 0 || timed[k - 1].type === "bar") && (k === timed.length - 1 || timed[k + 1].type === "bar")) e.dur = bpb;
    }
    staves.push({ at: p, name, events });
    p = q;
  }
  return p === b.length ? staves : null;
}

const round = (x) => Math.round(x * 1e6) / 1e6; // a triplet's thirds add up to a hair off the beat

/**
 * The bars of the score's first staff and its pickup: {pickup, bars: [lengths], irregular: [bar numbers]}.
 * A repeat sign or a double bar may stand inside a bar (a phrase that ends mid-bar, then the next one's
 * pickup); the pieces either side are one bar when together they make no more than a bar. The pickup is
 * the first bar when it is short (0 when it is full); `irregular` lists any later bar, but the last, that
 * is not a whole bar. Null when the staff has no bar line after a note.
 */
export function nwcBars(staves, bpb) {
  const ev = staves && staves[0] ? staves[0].events : null;
  if (!ev) return null;
  const pieces = [];
  let cur = 0, started = false;
  for (const e of ev) {
    if (e.type === "bar") { if (started && cur > 0) { pieces.push(round(cur)); cur = 0; } continue; }
    if (e.type !== "note" && e.type !== "rest") continue;
    started = true;
    cur += e.dur;
  }
  if (cur > 0) pieces.push(round(cur));
  if (pieces.length < 2) return null;
  const bars = [];
  for (const len of pieces) {
    const last = bars.length ? bars[bars.length - 1] : null;
    // Join a piece to a short bar before it when together they make at most a whole bar (never the pickup).
    if (last != null && bars.length > 1 && last < bpb - 1e-9 && last + len <= bpb + 1e-9) bars[bars.length - 1] = last + len;
    else bars.push(len);
  }
  const pickup = bars[0] < bpb - 1e-9 ? bars[0] : 0;
  const irregular = [];
  bars.forEach((len, i) => { if (i > 0 && i < bars.length - 1 && Math.abs(len - bpb) > 1e-9) irregular.push(i + (pickup ? 0 : 1)); });
  if (bars[0] > bpb + 1e-9) irregular.unshift(1);
  return { pickup, bars, irregular };
}

/**
 * A score's time signature and bars, read from the .nwc bytes: {num, den, pickup, bars, irregular,
 * timeChanges}, or null when the file cannot be read or has no time signature.
 */
export function scoreBars(bytes) {
  let staves;
  try { staves = readNwc(bytes); } catch { return null; }
  if (!staves) return null;
  const times = staves[0].events.filter((e) => e.type === "time");
  if (!times.length || !times[0].num || !times[0].den) return null;
  const { num, den } = times[0];
  const bars = nwcBars(staves, (num * 4) / den);
  if (!bars) return null;
  return { num, den, ...bars, timeChanges: times.some((t) => t.num * 4 / t.den !== num * 4 / den) };
}
