// Every solfa syllable on the blog and hymn pages comes from NoteFusion's own engine: the web
// mirror web-site/assets/choir.js (lock-step with src/NoteFusion.Core/Solfa), run unchanged in a
// VM exactly as web-site/tests/choir.test.mjs runs it. Nothing here names a syllable itself — this
// file parses pitches, lays the engine's cells out in lines, and spells letter names.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { SITE_DIR } from "./site.mjs";

export const ENGINE_PATH = path.join(SITE_DIR, "assets", "choir.js");

let engine = null;
/** window.NfChoir from choir.js. */
export function loadEngine() {
  if (!engine) {
    const window = {};
    vm.runInNewContext(fs.readFileSync(ENGINE_PATH, "utf8"), { window });
    engine = window.NfChoir;
  }
  return engine;
}

// ── Pitches ─────────────────────────────────────────────────────────────────
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#4" / "Bb3" / "C5" → MIDI number (C4 = 60). */
export function parsePitch(name) {
  const m = /^([A-Ga-g])(#|b|♯|♭)?(-?\d)$/.exec(String(name).trim());
  if (!m) throw new Error(`not a pitch: "${name}" (write it like G4, F#4 or Bb3)`);
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + LETTER_PC[m[1].toUpperCase()] + acc;
}

/** The key's tonic letter and accidental as written ("Bb major" → B, -1). */
function tonicSpelling(keyText) {
  const m = /^\s*([A-Ga-g])\s*(#|b|♯|♭)?/.exec(String(keyText));
  if (!m) throw new Error(`not a key: "${keyText}"`);
  return { letter: m[1].toUpperCase(), acc: m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0 };
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];

/** The seven notes of the key, spelled by letter: [{letter, alter, pc}] from the tonic up. */
export function keyScale(keyText) {
  const key = loadEngine().parseKey(keyText);
  if (!key) throw new Error(`not a key: "${keyText}"`);
  const t = tonicSpelling(keyText);
  const start = LETTERS.indexOf(t.letter);
  const steps = key.mode === "minor" ? MINOR_STEPS : MAJOR_STEPS;
  return steps.map((step, i) => {
    const letter = LETTERS[(start + i) % 7];
    const pc = (key.tonicPitchClass + step) % 12;
    let alter = (pc - LETTER_PC[letter] + 12) % 12;
    if (alter > 6) alter -= 12;
    return { letter, alter, pc };
  });
}

/** Key signature as MusicXML fifths, from the doh (a minor key shares its relative major's). */
const DOH_FIFTHS = { 0: 0, 1: -5, 2: 2, 3: -3, 4: 4, 5: -1, 6: 6, 7: 1, 8: -4, 9: 3, 10: -2, 11: 5 };
export function keyFifths(keyText) {
  const key = loadEngine().parseKey(keyText);
  const doh = key.mode === "major" ? key.tonicPitchClass : (key.tonicPitchClass + 3) % 12;
  return DOH_FIFTHS[doh];
}

/**
 * Spells a MIDI pitch in a key: a scale note as the key spells it; any other note as a scale note
 * raised (sharp keys, and a minor key's leading note) or lowered (flat keys).
 */
export function spellPitch(midi, keyText) {
  const pc = ((midi % 12) + 12) % 12;
  const scale = keyScale(keyText);
  const hit = scale.find((n) => n.pc === pc);
  let letter, alter;
  if (hit) ({ letter, alter } = hit);
  else {
    const raised = scale.find((n) => (n.pc + 1) % 12 === pc), lowered = scale.find((n) => (n.pc + 11) % 12 === pc);
    const leadingNote = (scale[0].pc + 11) % 12 === pc;
    const useRaised = raised && (leadingNote || keyFifths(keyText) >= 0 || !lowered);
    ({ letter, alter } = useRaised ? { letter: raised.letter, alter: raised.alter + 1 } : { letter: lowered.letter, alter: lowered.alter - 1 });
  }
  // The octave belongs to the letter: Cb5 sounds as B4, B#3 as C4.
  const octave = Math.floor((midi - alter) / 12) - 1;
  return { letter, alter, octave };
}
export function pitchLabel(midi, keyText) {
  const s = spellPitch(midi, keyText);
  return s.letter + (s.alter === 1 ? "♯" : s.alter === -1 ? "♭" : s.alter === 2 ? "𝄪" : s.alter === -2 ? "𝄫" : "");
}

// ── Melodies ────────────────────────────────────────────────────────────────
/**
 * Parses a melody written as `PITCH:BEATS` tokens with `|` between bars, e.g.
 * "D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1". Beats are quarter notes; `r:1` is a rest; a trailing `~`
 * ties a note into the next one of the same pitch. Durations are whole quarter beats (a semiquaver
 * is .25, a dotted quaver .75): the grid shows a half-beat cell that holds two quarter-beat notes as
 * a split cell (see engineGrid). A pickup (`pickup` beats) is placed at the end of the first grid
 * bar, so every bar line falls where the engine draws one.
 */
export function parseMelody(text, { time, pickup = 0 }) {
  const N = loadEngine();
  const bpb = N.beatsPerBar(time);
  const bars = String(text).split("|").map((b) => b.trim()).filter((b, i, all) => b.length || (i > 0 && i < all.length - 1));
  if (!bars.length) throw new Error("the melody is empty");
  const events = [];
  bars.forEach((bar, bi) => {
    const tokens = bar.split(/\s+/).filter(Boolean);
    let sum = 0;
    for (const tok of tokens) {
      const m = /^([^:]+):(\d*\.?\d+)(~?)$/.exec(tok);
      if (!m) throw new Error(`bar ${bi + 1}: cannot read "${tok}" (write PITCH:BEATS, e.g. G4:1 or r:1)`);
      const dur = Number(m[2]);
      if (!(dur > 0) || Math.abs(dur * 4 - Math.round(dur * 4)) > 1e-9) throw new Error(`bar ${bi + 1}: "${tok}" is not a whole number of quarter beats (semiquavers)`);
      const rest = m[1].toLowerCase() === "r";
      events.push({ pitchMidi: rest ? null : parsePitch(m[1]), dur, tie: m[3] === "~", bar: bi });
      sum += dur;
    }
    const first = bi === 0, last = bi === bars.length - 1;
    const want = first && pickup ? pickup : bpb;
    if (first && pickup) { if (Math.abs(sum - pickup) > 1e-9) throw new Error(`the pickup bar has ${sum} beats, not ${pickup}`); }
    else if (last && bars.length > 1) {
      const lastWant = pickup ? bpb - pickup : bpb;
      if (Math.abs(sum - lastWant) > 1e-9 && Math.abs(sum - bpb) > 1e-9) throw new Error(`the last bar has ${sum} beats; it should have ${lastWant}${pickup ? " (a full bar less the pickup)" : ""}`);
    } else if (Math.abs(sum - want) > 1e-9) throw new Error(`bar ${bi + 1} has ${sum} beats, not ${want}`);
  });
  const offset = pickup ? bpb - pickup : 0;
  const notes = [];
  let t = offset, tieOpen = false;
  for (const e of events) {
    if (e.pitchMidi === null) { tieOpen = false; t += e.dur; continue; }
    const prev = notes[notes.length - 1];
    if (tieOpen && prev && prev.pitchMidi === e.pitchMidi && Math.abs(prev.startBeat + prev.durBeats - t) < 1e-9) prev.durBeats += e.dur;
    else notes.push({ pitchMidi: e.pitchMidi, startBeat: t, durBeats: e.dur });
    tieOpen = e.tie; t += e.dur;
  }
  return { notes, offset, endBeat: t, bpb, pickup, time };
}

/** Semitones that move the doh of `fromKey` to the doh of `toKey`, by the nearer way. */
export function transposeInterval(fromKey, toKey) {
  const N = loadEngine();
  const a = N.parseKey(fromKey), b = N.parseKey(toKey);
  if (!a || !b) throw new Error(`cannot transpose ${fromKey} → ${toKey}`);
  const doh = (k) => (k.mode === "major" ? k.tonicPitchClass : (k.tonicPitchClass + 3) % 12);
  let d = (doh(b) - doh(a) + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

// ── The engine's grid, laid out ─────────────────────────────────────────────
/** True when every note starts and ends on the half-beat grid (no semiquavers, no dotted quavers). */
export function onHalfBeatGrid(notes) {
  const half = (x) => Math.abs(x * 2 - Math.round(x * 2)) < 1e-9;
  return notes.every((n) => half(n.startBeat) && half(n.durBeats));
}

/**
 * The quarter-beat character between the two halves of a split cell. It is the tonic solfa
 * quarter-beat mark (`d .,r` in a hymn book), here inside one half-beat cell: "-,r" is the last
 * quarter of a dotted quaver, then a semiquaver. It never touches an octave mark's comma, which
 * always follows a syllable letter (s,) and is drawn small and low on the page (see gridHtml).
 */
export const QUARTER_MARK = ",";

/**
 * The hymn grid at quarter-beat resolution, for a tune with semiquavers or dotted quavers that the
 * engine's half-beat hymnRows cannot hold. The syllables are the engine's (`labelled` comes from
 * its `label`, the words from its `lyricsUnderNotes`); only the cells are laid out here, in the
 * engine's half-beat cells: a cell whose second quarter starts a note (or a rest) is split into its
 * two quarters, {solfa: "d,r", parts: [{solfa: "d"…}, {solfa: "r"…}]}; every other cell is exactly
 * what hymnRows writes. For a tune on the half-beat grid it returns hymnRows' own cells (tested).
 */
export function quarterBars(labelled, underlay, time) {
  const N = loadEngine();
  const bpb = N.beatsPerBar(time);
  const nBars = N.barCount(labelled, time);
  const under = Array.from(N.lyricsUnderNotes(labelled, underlay || ""));
  const slotsPerBar = Math.round(bpb * 4);
  const slots = [];
  for (let k = 0; k < nBars * slotsPerBar; k++) {
    const start = k * 0.25, end = start + 0.25;
    const starts = labelled.map((n, i) => ({ n, i })).filter(({ n }) => Math.abs(n.startBeat - start) < 1e-9);
    const active = labelled.some((n) => n.startBeat < end - 1e-9 && n.startBeat + Math.max(0, n.durBeats) > start + 1e-9);
    if (starts.length) slots.push({ solfa: starts.map(({ n }) => n.solfa + n.octaveMark).join("+"), lyric: starts.map(({ i }) => under[i] || "").filter(Boolean).join(" "), beat: start, note: true });
    else slots.push({ solfa: active ? "-" : "_", lyric: "", beat: start, note: false });
  }
  const bars = [];
  for (let b = 0; b < nBars; b++) {
    const cells = [];
    for (let c = 0; c < bpb * 2; c++) {
      const a = slots[b * slotsPerBar + c * 2], z = slots[b * slotsPerBar + c * 2 + 1];
      const plainSecond = a.solfa === "_" ? "_" : "-";
      const strip = ({ solfa, lyric, beat }) => ({ solfa, lyric, beat });
      if (z.note || z.solfa !== plainSecond) cells.push({ solfa: a.solfa + QUARTER_MARK + z.solfa, lyric: [a.lyric, z.lyric].filter(Boolean).join(" "), beat: a.beat, parts: [strip(a), strip(z)] });
      else cells.push(strip(a));
    }
    bars.push(cells);
  }
  return bars;
}

/**
 * The engine's labelling and hymn grid for a melody: `label` names every note in the key,
 * `hymnRows` lays them in half-beat cells with the words under them (or, for a tune with
 * quarter-beat notes, quarterBars does, with the engine's syllables). Returns the bars (each a list
 * of {solfa, lyric, beat} cells, a split cell also carrying its two `parts`), the doh header, and
 * the labelled notes.
 */
export function engineGrid(melody, { key, underlay = "", transpose = 0 }) {
  const N = loadEngine();
  const notes = melody.notes.map((n) => ({ pitchMidi: n.pitchMidi + transpose, startBeat: n.startBeat, durBeats: n.durBeats }));
  // The engine runs in its own VM realm; its arrays are copied into this one at the boundary.
  const labelled = Array.from(N.label(notes, key), (n) => ({ ...n }));
  const bpb = N.beatsPerBar(melody.time);
  let bars;
  if (onHalfBeatGrid(notes)) {
    const rows = N.hymnRows(labelled, underlay, melody.time, 1e6);
    bars = Array.from(rows[0] || [], (bar, b) => Array.from(bar, (cell, c) => ({ solfa: cell.solfa, lyric: cell.lyric, beat: b * bpb + c * 0.5 })));
  } else bars = quarterBars(labelled, underlay, melody.time);
  // A pickup sits at the end of the first bar and the last bar is short by as much: the empty
  // cells either side are not part of the tune, so a hymn book leaves them out.
  if (bars.length && melody.pickup) while (bars[0].length && bars[0][0].solfa === "_") bars[0].shift();
  const last = bars[bars.length - 1];
  if (last) while (last.length > 1 && last[last.length - 1].solfa === "_") last.pop();
  return { header: N.keyHeader(key), bars, labelled, notes };
}

/**
 * Bars grouped into hymn-book lines: `lineBars` a line (or a list of line lengths, the last one
 * repeated), the first line also carrying a pickup bar.
 */
export function toLines(bars, { lineBars = 4, pickup = 0 } = {}) {
  const sizes = Array.isArray(lineBars) ? lineBars : [lineBars];
  const lines = [];
  let i = 0, k = 0;
  while (i < bars.length) {
    let n = sizes[Math.min(k, sizes.length - 1)];
    if (k === 0 && pickup) n += 1;
    lines.push(bars.slice(i, i + n));
    i += n; k++;
  }
  return lines;
}

/** One line as text, the way the engine's renderLines prints a row. */
export function lineText(line) {
  return "| " + line.map((bar) => bar.map((c) => c.solfa).join(" ")).join(" | ") + " |";
}
/** The words sung in a line, syllables joined back into words. */
export function lineWords(line) {
  let out = "";
  for (const bar of line) for (const c of bar.flatMap((cell) => cell.parts || [cell])) {
    const s = c.lyric;
    if (!s || s === "_") continue;
    if (out && !out.endsWith("-")) out += " ";
    out += s;
  }
  return out.replace(/-(?=\S)/g, "").replace(/-$/, "");
}

/** An ascending one-octave scale in a key (quarters, 4/4), its letter names as the words. */
export function scaleMelody(keyText, { harmonic = false } = {}) {
  const N = loadEngine();
  const key = N.parseKey(keyText);
  if (!key) throw new Error(`not a key: "${keyText}"`);
  const steps = (key.mode === "minor" ? MINOR_STEPS : MAJOR_STEPS).slice();
  if (harmonic) { if (key.mode !== "minor") throw new Error("only a minor key has a harmonic minor scale"); steps[6] = 11; }
  const tonic = 60 + key.tonicPitchClass;
  const pitches = steps.concat([12]).map((s) => tonic + s);
  const notes = pitches.map((p, i) => ({ pitchMidi: p, startBeat: i, durBeats: 1 }));
  const words = pitches.map((p) => pitchLabel(p, keyText)).join(" ");
  return { melody: { notes, offset: 0, endBeat: 8, bpb: 4, pickup: 0, time: "4/4" }, words };
}
