// Bar lines from a Noteworthy Composer score (.nwc, the binary format of NWC 1.5–1.75 that CCEH's files
// use), for the CCEH importer. A MIDI file has exact notes but no bar lines, so where the first bar line
// falls (the pickup) is read from the score that has them. Only what that needs is read: each staff's
// objects in order, the length of every note, chord and rest, and the bar lines. The file is data: its
// bytes are read here and never handed to anything that runs it. Anything this reader does not recognise
// makes it give up (null), and the importer falls back on the rhythm (cceh-melody.mjs inferBarLines).

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
 * Reads a score's staves: [{name, events: [{type: "bar" | "note" | "rest", dur}]}], or null when the file
 * is not a score this reader knows.
 */
export function readNwc(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii = (p, n) => String.fromCharCode(...b.subarray(p, p + n));
  if (ascii(0, HEADER.length) !== HEADER) return null;
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
    if (e.type === "bar") { if (started && cur > 0) { pieces.push(cur); cur = 0; } continue; }
    if (e.type !== "note" && e.type !== "rest") continue;
    started = true;
    cur += e.dur;
  }
  if (cur > 0) pieces.push(cur);
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
