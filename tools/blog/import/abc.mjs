// A focused ABC reader for the Open Hymnal Project's scores (openhymnal.org, "ABC Plus" as abcm2ps
// reads it): the header fields, the project's %OH… metadata comments, and the MELODY voice only —
// the first voice of %%staves (the soprano, S1V1), or the top note of each chord when the treble
// staff is one chordal voice — with its w: lyric lines and the W: verses printed after the score.
//
// It handles what the hymnal uses: K: (major key signatures and modes), M:, L:, Q:, notes with
// octave marks, accidentals (carried through the bar) and lengths, broken rhythm (> <), ties,
// rests (z, x), chords, bar lines, and inline fields. It records what it cannot render instead of
// guessing — triplets, repeats, grace notes, a key or metre change in mid-tune — so the importer can
// keep such a hymn as a draft. Nothing in a score is ever executed; this is plain text parsing.

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const MAJOR_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
// Semitones from a mode's final up to the major tonic of the same key signature.
const MODE_TO_MAJOR = { "": 0, maj: 0, major: 0, ion: 0, ionian: 0, m: 3, min: 3, minor: 3, aeo: 3, aeolian: 3, dor: 10, dorian: 10, phr: 8, phrygian: 8, lyd: 7, lydian: 7, mix: 5, mixolydian: 5, loc: 1, locrian: 1 };
const PC_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const PC_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Decodes a score's bytes: UTF-8 when it is valid UTF-8, else ISO-8859-1 (the hymnal's older files). */
export function decodeAbc(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return new TextDecoder("latin1").decode(bytes); }
}

/**
 * K: field → { tonic: "Eb", mode: "major" | "minor" | other, majorTonic: "Eb", accidentals: {F: 1, …} }.
 * Explicit accidentals after the key (K:D exp ^f) are not used by the hymnal and are refused.
 */
export function parseKeyField(text) {
  const raw = String(text).replace(/%.*/, "").trim();
  const m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)\s*(.*)$/.exec(raw);
  if (!m) throw new Error(`cannot read the key "K: ${raw}"`);
  const tonic = m[1].toUpperCase() + m[2];
  const modeWord = m[3].toLowerCase();
  const rest = m[4].replace(/clef=\S+|treble|bass|alto|tenor|middle=\S+|transpose=\S+|octave=\S+/gi, "").trim();
  if (!(modeWord in MODE_TO_MAJOR) || rest) throw new Error(`cannot read the key "K: ${raw}"`);
  const tonicPc = (LETTER_PC[tonic[0]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  const majorPc = (tonicPc + MODE_TO_MAJOR[modeWord]) % 12;
  // The major key with that signature, spelled as signatures are (F#, Db…).
  const majorTonic = Object.keys(MAJOR_FIFTHS).find((k) => (LETTER_PC[k[0]] + (k[1] === "#" ? 1 : k[1] === "b" ? -1 : 0) + 12) % 12 === majorPc && Math.abs(MAJOR_FIFTHS[k]) <= 6);
  const fifths = MAJOR_FIFTHS[majorTonic];
  const accidentals = {};
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach((l) => { accidentals[l] = 1; });
  if (fifths < 0) SHARP_ORDER.slice().reverse().slice(0, -fifths).forEach((l) => { accidentals[l] = -1; });
  const mode = MODE_TO_MAJOR[modeWord] === 0 ? "major" : MODE_TO_MAJOR[modeWord] === 3 ? "minor" : modeWord;
  return { tonic, mode, majorTonic, fifths, accidentals };
}

/** "3/4" → {beats, unit}; "C" → 4/4; "C|" → 2/2; "none" → null. */
export function parseMeter(text) {
  const t = String(text).replace(/%.*/, "").trim();
  if (!t || /^none$/i.test(t)) return null;
  if (t === "C") return { text: "4/4", beats: 4, unit: 4 };
  if (t === "C|") return { text: "2/2", beats: 2, unit: 2 };
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (!m) throw new Error(`cannot read the metre "M: ${t}"`);
  return { text: `${Number(m[1])}/${Number(m[2])}`, beats: Number(m[1]), unit: Number(m[2]) };
}

/** "1/4" → 1 (in crotchets); "1/8" → .5. */
export function parseUnit(text) {
  const m = /^\s*1\s*\/\s*(\d+)/.exec(String(text));
  if (!m) throw new Error(`cannot read the note length "L: ${text}"`);
  return 4 / Number(m[1]);
}

/** Q: "1/4=100" → crotchets a minute; a bare number is in L: units. */
export function parseTempo(text, unitQuarters = 1) {
  const t = String(text).replace(/"[^"]*"/g, "").trim();
  let m = /(\d+)\s*\/\s*(\d+)\s*=\s*(\d+)/.exec(t);
  if (m) return Math.round(Number(m[3]) * (4 * Number(m[1])) / Number(m[2]));
  m = /^(\d+)$/.exec(t);
  if (m) return Math.round(Number(m[1]) * unitQuarters);
  return null;
}

// ── Music ───────────────────────────────────────────────────────────────────
/** A length suffix ("2", "/", "3/2", "//") → a multiplier; returns [multiplier, characters used]. */
function readLength(s, i) {
  const m = /^(\d*)(\/*)(\d*)/.exec(s.slice(i));
  const [all, num, slashes, den] = m;
  let v = num ? Number(num) : 1;
  if (slashes) v = den ? v / (Number(den) * 2 ** (slashes.length - 1)) : v / 2 ** slashes.length;
  return [v, all.length];
}

/**
 * Reads one line of music for one voice into events, continuing the voice's state (`st`: the key
 * signature, bar accidentals, unit length, pending broken rhythm, bar number). Events:
 *   {type: "note", midi, letter, alter, octave, dur, tie, chord}   (dur in crotchets)
 *   {type: "rest", dur}
 *   {type: "bar", text}            any bar line, with its repeat/ending marks in `text`
 * and the things it will not render go to st.problems.
 */
export function readMusicLine(line, st) {
  const ev = [];
  let i = 0;
  const s = line;
  const problem = (p) => { if (!st.problems.includes(p)) st.problems.push(p); };
  const pushBar = (text) => {
    st.barAcc = {};
    ev.push({ type: "bar", text });
    if (/:/.test(text) || /[|[]\d/.test(text) || /^\[?\d/.test(text)) problem("repeat signs");
  };
  /** Reads a single pitch at i: returns {midi, letter, alter, octave, len} or null. */
  const readPitch = () => {
    const m = /^(\^\^|\^|__|_|=)?([A-Ga-g])([',]*)/.exec(s.slice(i));
    if (!m) return null;
    const [all, accTxt, letterRaw, marks] = m;
    const letter = letterRaw.toUpperCase();
    let octave = letterRaw === letter ? 4 : 5;
    for (const c of marks) octave += c === "'" ? 1 : -1;
    const key = letter + octave;
    let alter;
    if (accTxt) {
      alter = { "^^": 2, "^": 1, "__": -2, "_": -1, "=": 0 }[accTxt];
      st.barAcc[key] = alter;
    } else alter = key in st.barAcc ? st.barAcc[key] : st.key.accidentals[letter] || 0;
    i += all.length;
    const [mult, used] = readLength(s, i);
    i += used;
    return { midi: (octave + 1) * 12 + LETTER_PC[letter] + alter, letter, alter, octave, len: mult };
  };
  const applyBroken = (e) => {
    if (st.broken) { e.dur *= st.broken; st.broken = null; }
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "%") break;
    if (/\s/.test(c) || c === "`" || c === "y" || c === "\\") { i++; continue; }
    if (c === "!" || c === "+") { const j = s.indexOf(c, i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') { const j = s.indexOf('"', i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === "{") { const j = s.indexOf("}", i + 1); problem("grace notes left out"); i = j < 0 ? s.length : j + 1; continue; }
    if (c === "[" && /^\[[A-Za-z]:/.test(s.slice(i))) {
      const j = s.indexOf("]", i);
      const field = s.slice(i + 1, j < 0 ? s.length : j);
      const name = field[0], value = field.slice(2).trim();
      if (name === "Q") { const q = parseTempo(value, st.unit); if (q && !st.tempo) st.tempo = q; }
      else if (name === "K") { const k = parseKeyField(value); if (k.fifths !== st.key.fifths) problem("a key change"); }
      else if (name === "M") { const mm = parseMeter(value); if (!mm || mm.text !== (st.meter && st.meter.text)) problem("a change of metre"); }
      else if (name === "L") st.unit = parseUnit(value);
      i = j < 0 ? s.length : j + 1;
      continue;
    }
    if (c === "(") {
      if (/^\(\d/.test(s.slice(i))) { problem("triplets"); i += 2; continue; }
      i++; continue; // a slur
    }
    // A dotted tie (".-") joins the notes in some verses only (the others sing a syllable on each):
    // the notes stay apart, and a verse that ties them carries its syllable over with "*" or "_".
    if (c === "." && s[i + 1] === "-") { i += 2; continue; }
    if (c === ")" || c === "." || c === "~" || c === "H" || c === "T" || c === "u" || c === "v") { i++; continue; }
    if (c === "-") { // a tie: on the last note
      const last = ev[ev.length - 1];
      if (last && last.type === "note") last.tie = true;
      i++; continue;
    }
    if (c === ">" || c === "<") {
      let n = 0;
      while (s[i] === c) { n++; i++; }
      const last = ev[ev.length - 1];
      const longer = 2 - 1 / 2 ** n, shorter = 1 / 2 ** n;
      if (last && (last.type === "note" || last.type === "rest")) {
        last.dur *= c === ">" ? longer : shorter;
        st.broken = c === ">" ? shorter : longer;
      }
      continue;
    }
    // Bar lines (with repeat marks and numbered endings).
    const bar = /^(:*\|[\]|:]*\d*|\[\|:*|::|\[\d)/.exec(s.slice(i));
    if (bar) { pushBar(bar[0]); i += bar[0].length; continue; }
    if (c === "[") { // a chord: the top note is the melody
      i++;
      const notes = [];
      while (i < s.length && s[i] !== "]") {
        if (s[i] === "!" || s[i] === '"') { const j = s.indexOf(s[i], i + 1); i = j < 0 ? s.length : j + 1; continue; }
        const p = readPitch();
        if (p) { if (s[i] === "-") { p.tie = true; i++; } notes.push(p); continue; }
        i++;
      }
      i++; // ]
      const [mult, used] = readLength(s, i);
      i += used;
      if (!notes.length) continue;
      const top = notes.reduce((a, b) => (b.midi > a.midi ? b : a));
      const e = { type: "note", midi: top.midi, letter: top.letter, alter: top.alter, octave: top.octave, dur: top.len * mult * st.unit, tie: !!top.tie, chord: notes.length > 1 };
      applyBroken(e);
      ev.push(e);
      continue;
    }
    if (c === "z" || c === "x") {
      i++;
      const [mult, used] = readLength(s, i);
      i += used;
      const e = { type: "rest", dur: mult * st.unit };
      applyBroken(e);
      ev.push(e);
      continue;
    }
    if (c === "Z") { problem("multi-bar rests"); i++; readLength(s, i); continue; }
    const p = readPitch();
    if (p) {
      const e = { type: "note", midi: p.midi, letter: p.letter, alter: p.alter, octave: p.octave, dur: p.len * st.unit, tie: false, chord: false };
      applyBroken(e);
      ev.push(e);
      continue;
    }
    problem(`an unread character "${c}"`);
    i++;
  }
  return ev;
}

// ── Lyrics ──────────────────────────────────────────────────────────────────
/**
 * A w: line as tokens, the way abcm2ps aligns them: {text, joins} a syllable (joins = a hyphen
 * follows: the word goes on), {hold} for `_` (the last syllable carries on over this note),
 * {skip} for `*` (no syllable on this note), {bar} for `|` (move on to the next bar). `~` is a
 * space inside one note's text, `\-` a hyphen that does not split the word.
 */
export function lyricTokens(text) {
  const out = [];
  let cur = "";
  const flush = (joins) => { if (cur) { out.push({ text: cur, joins }); cur = ""; return true; } return false; };
  const src = String(text).replace(/\$\d/g, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && src[i + 1] === "-") { cur += "\u2011"; i++; continue; } // a non-breaking hyphen: part of the syllable
    if (/\s/.test(c)) { flush(false); continue; }
    if (c === "-") { if (!flush(true)) out.push({ hold: true }); continue; }
    if (c === "_") { flush(false); out.push({ hold: true }); continue; }
    if (c === "*") { flush(false); out.push({ skip: true }); continue; }
    if (c === "|") { flush(false); out.push({ bar: true }); continue; }
    if (c === "~") { cur += " "; continue; }
    cur += c;
  }
  flush(false);
  return out;
}

// ── The score ───────────────────────────────────────────────────────────────
/**
 * Parses a whole score. Returns
 *   { fields: {T: [...], C: [...], S: [...], …}, meta: {COMPOSER, AUTHOR, …} (the %OH comments),
 *     key, meter, unit, tempo, melodyVoice, segments, words, problems }
 * where `segments` are the melody voice's lines in order, each {events, lyrics: [w: line text…]},
 * and `words` the W: verses printed under the score (lists of lines).
 */
export function parseAbc(text) {
  const lines = String(text).split(/\r?\n/);
  const fields = {}, meta = {};
  let inBody = false, staves = null;
  const voiceOrder = [];
  for (const raw of lines) {
    const mm = /^%OH([A-Z]+)\s?(.*)$/.exec(raw);
    if (mm) { meta[mm[1]] = mm[2].trim(); continue; }
    if (/^%%(staves|score)\s/.test(raw) && !staves) staves = raw.replace(/^%%\w+\s+/, "").replace(/%.*/, "");
    const f = /^([A-Za-z]):\s*(.*)$/.exec(raw);
    if (f && !inBody) {
      (fields[f[1]] = fields[f[1]] || []).push(f[2].trim());
      if (f[1] === "V") voiceOrder.push(f[2].trim().split(/\s+/)[0]);
      if (f[1] === "K") inBody = true;
    }
  }
  const one = (k) => (fields[k] ? fields[k][0] : null);
  if (!one("K")) throw new Error("no K: field");
  const key = parseKeyField(one("K"));
  const meter = one("M") != null ? parseMeter(one("M")) : null;
  const unit = one("L") ? parseUnit(one("L")) : 0.5;
  const melodyVoice = staves ? (/[A-Za-z0-9_]+/.exec(staves) || [null])[0] : voiceOrder[0] || null;

  const st = { key, meter, unit, barAcc: {}, broken: null, problems: [], tempo: one("Q") ? parseTempo(one("Q"), unit) : null };
  const segments = [];
  const words = [];
  let current = voiceOrder.length ? voiceOrder[0] : melodyVoice;
  let lastSegment = null;
  inBody = false;
  for (const raw of lines) {
    if (!inBody) { if (/^K:/.test(raw)) inBody = true; continue; }
    if (/^%/.test(raw) || !raw.trim()) continue;
    const field = /^([A-Za-z]):\s?(.*)$/.exec(raw);
    if (field) {
      const [, name, value] = field;
      if (name === "V") { current = value.trim().split(/\s+/)[0]; lastSegment = null; }
      else if (name === "w") { if (lastSegment) lastSegment.lyrics.push(value); }
      else if (name === "W") words.push(value);
      else if (name === "K") { const k = parseKeyField(value); if (k.fifths !== key.fifths) st.problems.includes("a key change") || st.problems.push("a key change"); }
      else if (name === "M") { const m = parseMeter(value); if (!m || !meter || m.text !== meter.text) st.problems.includes("a change of metre") || st.problems.push("a change of metre"); }
      else if (name === "Q") { if (!st.tempo) st.tempo = parseTempo(value, unit); }
      else if (name === "L") st.unit = parseUnit(value);
      continue;
    }
    let body = raw;
    const v = /^\s*\[V:\s*([^\]\s]+)[^\]]*\]/.exec(body);
    if (v) { current = v[1]; body = body.slice(v[0].length); }
    if (current !== melodyVoice) { lastSegment = null; continue; }
    const seg = { events: readMusicLine(body, st), lyrics: [] };
    segments.push(seg);
    lastSegment = seg;
  }
  return { fields, meta, key, meter, unit: st.unit, tempo: st.tempo, melodyVoice, segments, words: wordsBlocks(words), problems: st.problems };
}

/** W: lines → verses: a blank W: ends a verse; a leading "6." is the verse number. */
function wordsBlocks(lines) {
  const verses = [];
  let cur = [];
  const end = () => { if (cur.length) verses.push(cur); cur = []; };
  for (const l of lines) {
    const t = l.replace(/\$\d/g, "").trim();
    if (!t) { end(); continue; }
    cur.push(t);
  }
  end();
  return verses.map((v) => {
    const m = /^(\d+)\.\s*(.*)$/.exec(v[0]);
    return { number: m ? Number(m[1]) : null, lines: m ? [m[2], ...v.slice(1)] : v };
  });
}

/** A MIDI pitch named for the melody format ("Bb4", "F#4"), from the score's own letter and accidental. */
export function pitchName(e) {
  if (Math.abs(e.alter) <= 1) return e.letter + (e.alter === 1 ? "#" : e.alter === -1 ? "b" : "") + e.octave;
  const pc = ((e.midi % 12) + 12) % 12;
  return (e.alter > 0 ? PC_NAMES_SHARP : PC_NAMES_FLAT)[pc] + (Math.floor(e.midi / 12) - 1);
}
