/**
 * "Make the second m an f": a correction to a sheet, typed in plain words. The phone's copy of the web's
 * `web-site/assets/sheet-edit.js`, kept in step with it (same phrasings, same sentences, same tests:
 * `sheetEdit.test.ts` ↔ `web-site/tests/sheet-edit.test.mjs`).
 *
 * A fixed set of phrasings, read on the phone (nothing is sent anywhere, and the same words always do the same thing):
 *   make the second m an f · change note 5 to s · the last d should be r · replace the third s with l
 *   change every t to ta · the first m in bar 3 to f · make the m in bar 2 a d'
 *   move the last d up an octave · lower note 4 by a semitone · raise the second s two semitones
 *   delete note 6 · remove the third m
 * A note is named by its syllable as the sheet writes it (d r m f s l t and the chromatics de ra re ma fe sa se
 * la le ta; doh ray me fah soh lah te too), optionally with its octave marks (s, d'), by its count ("the second
 * m", "the last d", "every t") or by its place ("note 5", "the last note"), and narrowed to a bar ("in bar 3",
 * "in the pickup": bars are counted as the staff numbers them, from the first full bar).
 * A new syllable lands in the octave nearest the old note unless octave marks say where.
 *
 * Pure: the solfa engine is handed in (`SheetContext.label`, the Result screen's `deriveSolfa`), so this runs
 * under `node --test` as it is.
 */
import type { NoteEvent } from "../api/types";

/** The sheet a correction is made on: its doh (null when it has no key), its time signature, and its labeller. */
export interface SheetContext {
  dohPc: number | null;
  timeSignature: string;
  /** The notes labelled in the sheet's key, as the sheet shows them. */
  label: (notes: NoteEvent[]) => NoteEvent[];
}

export interface SyllableName {
  syl: string;
  marks: string | null;
}

export type EditTarget =
  | { every: true; syl: string; marks: string | null; bar?: number }
  | { place: number; bar?: number }
  | { syl: string; marks: string | null; nth: number | null; bar?: number };

export type EditChange = { to: SyllableName } | { shift: number } | { remove: true };

export type EditRequest = { ok: true; target: EditTarget; change: EditChange } | { ok: false; error: string };

/** The change made: the notes relabelled, what was done in a sentence, and `from[i]`, the index of the note now at i. */
export type EditResult = { notes: NoteEvent[]; said: string; from: number[]; error?: undefined } | { error: string };

// Semitones above doh of every syllable the engine writes (choir.js ASC/DESC).
const SEMIS: Record<string, number> = {
  d: 0, de: 1, ra: 1, r: 2, re: 3, ma: 3, m: 4, f: 5, fe: 6, sa: 6, s: 7, se: 8, la: 8, l: 9, le: 10, ta: 10, t: 11,
};
// Whole names. "la" and "re" are not among them: in tonic solfa they are the chromatics (flat lah, sharp ray).
const NAMES: Record<string, string> = {
  doh: "d", do: "d", ray: "r", me: "m", mi: "m", fah: "f", fa: "f", soh: "s", sol: "s", so: "s", lah: "l", te: "t", ti: "t",
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const COUNTS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eleven: 11, twelve: 12,
};
export const EDIT_EXAMPLE = "Try “make the second m an f”, “change note 5 to s” or “move the last d up an octave”.";

const own = (table: Record<string, number | string>, key: string) => Object.prototype.hasOwnProperty.call(table, key);

/** A syllable token ("m", "s,", "d'", "doh", "m's") as {syl, marks}, or null. */
function syllableOf(token: string, plural: boolean): SyllableName | null {
  const t = plural ? token.replace(/'s$/, "") : token;
  const m = /^([a-z]+)(['’,]*)$/.exec(t);
  if (!m) return null;
  const word = m[1]!;
  const syl = own(SEMIS, word) ? word : own(NAMES, word) ? NAMES[word]! : null;
  return syl ? { syl, marks: m[2] ? m[2].replace(/’/g, "'") : null } : null;
}

/** "second", "2nd", "2" as 2; "last" as -1; null otherwise. */
function ordinalOf(token: string): number | null {
  if (token === "last") return -1;
  if (own(ORDINALS, token)) return ORDINALS[token]!;
  const m = /^(\d+)(st|nd|rd|th)?$/.exec(token);
  return m ? Number(m[1]) : null;
}

function countOf(token: string): number | null {
  if (own(COUNTS, token)) return COUNTS[token]!;
  return /^\d+$/.test(token) ? Number(token) : null;
}

function tokens(text: string): string[] {
  const s = String(text || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”"]/g, " ")
    .replace(/\b(please|can you|could you|i want to|i'd like to)\b/g, " ")
    .replace(/[.!?;:]+(\s|$)/g, " ").replace(/,(\s+(?=[a-z]{2,}))/g, "$1").trim();
  return s ? s.split(/\s+/) : [];
}

/** The target at tok[i]: a note by place, by syllable and count, or every one of a syllable; then "in bar N". */
function readTarget(tok: string[], i: number): { target: EditTarget; i: number } | null {
  let target: EditTarget;
  if (tok[i] === "the") i++;
  if (tok[i] === "every" || tok[i] === "all") {
    i++;
    if (tok[i] === "the") i++;
    const every = tok[i] ? syllableOf(tok[i]!, true) : null;
    if (!every) return null;
    target = { every: true, syl: every.syl, marks: every.marks };
    i++;
  } else if (tok[i] === "note" && countOf(tok[i + 1] ?? "") !== null) {
    target = { place: countOf(tok[i + 1]!)! };
    i += 2;
  } else {
    let nth = tok[i] !== undefined ? ordinalOf(tok[i]!) : null;
    if (nth !== null) i++;
    if (nth !== null && tok[i] === "to" && tok[i + 1] === "last") { nth = -2; i += 2; }
    if (tok[i] === "note") { target = { place: nth === null ? 1 : nth }; i++; }
    else {
      const one = tok[i] ? syllableOf(tok[i]!, false) : null;
      if (!one) return null;
      target = { syl: one.syl, marks: one.marks, nth };
      i++;
    }
  }
  if (tok[i] === "in") {
    let j = i + 1;
    if (tok[j] === "the") j++;
    let bar: number | null = null;
    if (tok[j] === "pickup" || tok[j] === "upbeat" || tok[j] === "anacrusis") { bar = 0; j += 1; }
    else if (tok[j] === "bar" && tok[j + 1] && countOf(tok[j + 1]!) !== null) { bar = countOf(tok[j + 1]!); j += 2; }
    else if (tok[j] && (ordinalOf(tok[j]!) ?? 0) > 0 && tok[j + 1] === "bar") { bar = ordinalOf(tok[j]!); j += 2; }
    if (bar !== null) { target.bar = bar; i = j; }
  }
  return { target, i };
}

/** "up an octave", "by a semitone", "two semitones down", "an octave higher": signed semitones, or null. */
function readShift(tok: string[], i: number, sign: number): number | null {
  let dir = sign || 0, amount: number | null = null, unit: number | null = null;
  for (; i < tok.length; i++) {
    const w = tok[i]!;
    if (w === "up" || w === "higher") dir = 1;
    else if (w === "down" || w === "lower") dir = -1;
    else if (w === "by") continue;
    else if (countOf(w) !== null && amount === null) amount = countOf(w);
    else if (/^octaves?$/.test(w)) unit = 12;
    else if (/^semitones?$/.test(w) || w === "half-step" || w === "half-steps") unit = 1;
    else if (w === "half" && /^steps?$/.test(tok[i + 1] ?? "")) { unit = 1; i++; }
    else return null;
  }
  if (!dir || !unit) return null;
  return dir * (amount === null ? 1 : amount) * unit;
}

/** The syllable after "to", "into", "a", "an", "be", "with", or null. */
function readSyllable(tok: string[], i: number): SyllableName | null {
  while (i < tok.length && /^(to|into|a|an|be|is|really|should|with|it|instead)$/.test(tok[i]!)) i++;
  if (i !== tok.length - 1) return null;
  return syllableOf(tok[i]!, false);
}

/** What `text` asks for, or why it could not be followed, in a sentence that says how to put it. */
export function readEdit(text: string): EditRequest {
  const tok = tokens(text);
  if (!tok.length) return { ok: false, error: "Type a change to make. " + EDIT_EXAMPLE };
  let verb = tok[0]!, i = 1, sign = 0;
  if (/^(make|turn|change|replace|move|put|take|raise|lower|delete|remove|drop|set)$/.test(verb)) {
    if (verb === "raise") sign = 1;
    if (verb === "lower") sign = -1;
  } else { verb = ""; i = 0; }
  const found = readTarget(tok, i);
  if (!found) return { ok: false, error: "I couldn't tell which note you mean. " + EDIT_EXAMPLE };
  const rest = found.i;
  let change: EditChange | null = null;
  if (/^(delete|remove|drop)$/.test(verb)) {
    if (rest === tok.length) change = { remove: true };
  } else {
    const shift = readShift(tok, rest, sign);
    if (shift !== null) change = { shift };
    else if (!sign) {
      const to = readSyllable(tok, rest);
      if (to && (verb || /^(to|should|is|into)$/.test(tok[rest] ?? ""))) change = { to };
    }
  }
  if (!change) return { ok: false, error: "I couldn't tell what to change it to. " + EDIT_EXAMPLE };
  return { ok: true, target: found.target, change };
}

function beatsPerBar(ts: string): number {
  const p = String(ts || "4/4").split("/").map(Number);
  return p[0] && p[1] ? (p[0] * 4) / p[1] : 4;
}

/**
 * Bars counted as the staff numbers them: a first bar the tune enters part-way through is the pickup (bar 0),
 * and bar 1 is the first full one, as a hymn book counts.
 */
function barCounter(notes: readonly NoteEvent[], perBar: number): (note: NoteEvent) => number {
  const first = notes.reduce((m, n) => Math.min(m, n.startBeat), Infinity);
  const base = Math.floor(first / perBar + 1e-9), pickup = first - base * perBar > 1e-9;
  return (note) => Math.floor(note.startBeat / perBar + 1e-9) - base + (pickup ? 0 : 1);
}
const nameOf = (note: NoteEvent) => note.solfa + (note.octaveMark || "");
const plural = (syl: string) => syl + "’s";
function marksShift(marks: string | null | undefined): number {
  if (!marks) return 0;
  return (marks.match(/'/g) || []).length - (marks.match(/,/g) || []).length;
}
const timeOrder = (notes: readonly NoteEvent[]) =>
  notes.map((_, k) => k).sort((a, b) => notes[a]!.startBeat - notes[b]!.startBeat);

/** The indices (into `notes`) the target names, in order, or an error sentence. */
function resolve(notes: readonly NoteEvent[], target: EditTarget, barOf: (n: NoteEvent) => number): { picked: number[] } | { error: string } {
  let order = timeOrder(notes);
  const where = target.bar === undefined ? "" : target.bar === 0 ? " in the pickup" : " in bar " + target.bar;
  if (target.bar !== undefined) {
    order = order.filter((k) => barOf(notes[k]!) === target.bar);
    if (!order.length) return { error: "There are no notes" + where + "." };
  }
  if ("place" in target) {
    const at = target.place < 0 ? order.length + target.place : target.place - 1;
    if (at < 0 || at >= order.length) return { error: "There " + (order.length === 1 ? "is only 1 note" : "are only " + order.length + " notes") + where + "." };
    return { picked: [order[at]!] };
  }
  const matches = order.filter((k) => {
    const n = notes[k]!;
    return n.solfa === target.syl && (target.marks === null || (n.octaveMark || "") === target.marks);
  });
  const name = target.syl + (target.marks || "");
  if (!matches.length) return { error: "There's no " + name + where + " on this sheet." };
  if ("every" in target) return { picked: matches };
  if (target.nth === null) {
    if (matches.length > 1) return { error: "There are " + matches.length + " " + plural(name) + where + ". Say which one, like “the second " + name + "”." };
    return { picked: matches };
  }
  const idx = target.nth < 0 ? matches.length + target.nth : target.nth - 1;
  if (idx < 0 || idx >= matches.length) return { error: "There " + (matches.length === 1 ? "is only 1 " + name : "are only " + matches.length + " " + plural(name)) + where + "." };
  return { picked: [matches[idx]!] };
}

/** The new pitch of `note` written as `to`: its nearest octave, or where `to`'s marks put it. */
function pitchFor(note: NoteEvent, to: SyllableName, dohPc: number): number {
  const old = (((note.pitchMidi - dohPc) % 12) + 12) % 12, want = SEMIS[to.syl]!;
  if (to.marks !== null) {
    // The unmarked doh this note was written from, then the new syllable as many octaves off it as its marks say.
    const unmarkedDoh = note.pitchMidi - old - 12 * marksShift(note.octaveMark);
    return unmarkedDoh + want + 12 * marksShift(to.marks);
  }
  const step = (((want - old) % 12) + 12) % 12;
  return note.pitchMidi + (step > 6 ? step - 12 : step);
}

/** "note 5 (bar 2" — closed by the caller, which adds the syllable or not. */
function describe(note: NoteEvent, barOf: (n: NoteEvent) => number, notes: readonly NoteEvent[]): string {
  const bar = barOf(note);
  return "note " + (timeOrder(notes).indexOf(notes.indexOf(note)) + 1) + " (" + (bar === 0 ? "the pickup" : "bar " + bar);
}

function amount(semis: number): string {
  if (semis % 12 === 0) return semis === 12 ? "an octave" : semis / 12 + " octaves";
  return semis === 1 ? "a semitone" : semis + " semitones";
}

/** `request` (from readEdit) made on `notes` (labelled, as the sheet shows them). The notes given are never changed. */
export function applyEdit(notes: readonly NoteEvent[], sheet: SheetContext, request: Extract<EditRequest, { ok: true }>): EditResult {
  if (sheet.dohPc === null) return { error: "This sheet has no key to name the notes from." };
  const dohPc = sheet.dohPc;
  const barOf = barCounter(notes, beatsPerBar(sheet.timeSignature));
  const found = resolve(notes, request.target, barOf);
  if ("error" in found) return { error: found.error };
  const picked = found.picked, change = request.change, first = notes[picked[0]!]!, many = picked.length > 1;
  // "4 m’s" or "note 5 (bar 2, m)"; a change to a syllable names the old one itself ("from m to f").
  const target = request.target as { syl?: string; marks?: string | null };
  const what = many ? picked.length + " " + plural((target.syl ?? "") + (target.marks || "")) : describe(first, barOf, notes);
  const whole = many ? what : what + ", " + nameOf(first) + ")";
  if ("remove" in change) {
    if (picked.length >= notes.length) return { error: "A sheet must keep at least one note." };
    const gone = new Set(picked);
    const from = notes.map((_, k) => k).filter((k) => !gone.has(k));
    return { notes: sheet.label(from.map((k) => notes[k]!)), said: "Deleted " + whole + ".", from };
  }
  const moved = notes.slice();
  for (const k of picked) {
    const n = notes[k]!;
    const pitch = "shift" in change ? n.pitchMidi + change.shift : pitchFor(n, change.to, dohPc);
    if (pitch < 21 || pitch > 108) return { error: "That would take " + describe(n, barOf, notes) + ") off the keyboard." };
    // The singer is the source for this note now, so it stops being flagged.
    moved[k] = { ...n, pitchMidi: pitch, conf: 1 };
  }
  const labelled = sheet.label(moved), now = labelled[picked[0]!]!;
  const said = "shift" in change
    ? "Moved " + whole + " " + (change.shift > 0 ? "up" : "down") + " " + amount(Math.abs(change.shift)) + "."
    : "Changed " + (many ? what : what + ") from " + nameOf(first)) + " to " + nameOf(now) + ".";
  return { notes: labelled, said, from: notes.map((_, k) => k) };
}

/** readEdit() then applyEdit(). */
export function editSheet(notes: readonly NoteEvent[], sheet: SheetContext, text: string): EditResult {
  const request = readEdit(text);
  return request.ok ? applyEdit(notes, sheet, request) : { error: request.error };
}
