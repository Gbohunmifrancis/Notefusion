/**
 * Movable-do solfa engine — mirrors src/NoteFusion.Core/Solfa (C#) and
 * server/app/pipeline/solfa.py (Python).
 *
 * Lives client-side on purpose: a key override is a re-labelling, never a
 * re-transcription (TRD §4.1), so the app re-derives every syllable locally
 * and the display updates with no round-trip. The server still owns the
 * durable override (PUT /api/library/{id}/key) — this module owns the render.
 *
 * Keep all four implementations in sync (with web-site/assets/choir.js): same
 * syllable tables, la-based minor, the hymn-book chromatic rule and octave reference. Octave marks follow the Python wire
 * format (' above, , below) because stored notes already carry those strings.
 *
 * The primitives below (parseKey, dohPitchClass, referenceDoh, ascendingFlags,
 * syllable, dohHeader) are exported to mirror solfa.py's function-level API so the
 * two can be diffed case-by-case; the app itself only calls deriveSolfa, sameKey,
 * and KEY_CHOICES.
 */

import type { NoteEvent } from "../api/types";

export type KeyMode = "major" | "minor";

export interface ParsedKey {
  tonicPitchClass: number;
  mode: KeyMode;
}

const PITCH_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const ASCENDING_SYLLABLES = [
  "d",
  "de",
  "r",
  "re",
  "m",
  "f",
  "fe",
  "s",
  "se",
  "l",
  "le",
  "t",
] as const;

const DESCENDING_SYLLABLES = [
  "d",
  "ra",
  "r",
  "ma",
  "m",
  "f",
  "sa",
  "s",
  "la",
  "l",
  "ta",
  "t",
] as const;

/** Regional descending chromatic conventions (TRD §4.2). */
export type ChromaticSet = "african" | "standard";

export const CHROMATIC_SETS = {
  african: DESCENDING_SYLLABLES,
  standard: [
    "d",
    "ra",
    "r",
    "ma",
    "m",
    "f",
    "fe",
    "s",
    "le",
    "l",
    "ta",
    "t",
  ] as const,
} as const;

/** Diatonic degree for each semitone above doh (ascending/sharp convention). */
const SEMITONE_TO_DEGREE = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7] as const;

/**
 * The name a tonic solfa hymn book gives each semitone above doh when the note does not
 * move on by a semitone (a leap, a tone, the last note): de, ma, fe, se, ta. true is the
 * sharpened name; diatonic entries are unobservable. Reasons are in SolfaMapper.cs.
 */
const DEFAULT_SHARP = [true, true, true, false, true, true, true, true, true, true, false, true] as const;

export type ChromaticSpelling = "direction" | "ascending" | "descending";

const NATURAL_PITCH_CLASS: Readonly<Record<string, number>> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

/** Longest-first so "minor" isn't read as "m" + "inor" (mirrors KeyParser.cs). */
const MODE_SUFFIXES: readonly (readonly [string, KeyMode])[] = [
  ["minor", "minor"],
  ["min", "minor"],
  ["maj", "major"],
  ["major", "major"],
  ["m", "minor"],
];

/**
 * Parses a human-written key name into a pitch class + mode. Accepts the same
 * spellings as KeyParser.cs, including music21's `-` flat ("B- major") which
 * the Python worker can emit. Returns null when the text isn't a key.
 */
export function parseKey(text: string | null | undefined): ParsedKey | null {
  if (!text || !text.trim()) return null;

  let s = text.trim();
  let mode: KeyMode = "major";

  for (const [suffix, m] of MODE_SUFFIXES) {
    if (s.length > suffix.length && s.toLowerCase().endsWith(suffix)) {
      mode = m;
      s = s.slice(0, s.length - suffix.length).trimEnd();
      break;
    }
  }

  if (s.length === 0) return null;

  let pitchClass = NATURAL_PITCH_CLASS[s[0]!.toLowerCase()];
  if (pitchClass === undefined) return null;

  for (const ch of s.slice(1).trim()) {
    if (ch === "#" || ch === "♯") pitchClass += 1;
    else if (ch === "b" || ch === "B" || ch === "♭" || ch === "-")
      pitchClass -= 1;
    else return null;
  }

  return { tonicPitchClass: ((pitchClass % 12) + 12) % 12, mode };
}

/**
 * Whether two key names mean the same key. Compares parsed values, not text,
 * so "Bb major" still matches the picker's enharmonic "A# major" chip.
 */
export function sameKey(a: string, b: string): boolean {
  const x = parseKey(a);
  const y = parseKey(b);
  return (
    x !== null &&
    y !== null &&
    x.tonicPitchClass === y.tonicPitchClass &&
    x.mode === y.mode
  );
}

/** Doh for the key; la-based minor uses the relative major's tonic (TRD §4.1). */
export function dohPitchClass(key: ParsedKey): number {
  return key.mode === "major"
    ? key.tonicPitchClass
    : (key.tonicPitchClass + 3) % 12;
}

/**
 * Doh names as key signatures spell them — "Bb", not "A#" (F# kept): the doh tile, every
 * "Doh is" header and the listener's notification, so they all agree.
 */
export const DOH_NAMES: readonly string[] = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/**
 * The letter on a sheet's doh tile and DOH figure, spelled as the key signature spells
 * it whatever spelling the key arrived in (the API writes "A# major"); a minor key's
 * doh is its relative major's tonic (la-based), so "D minor" reads F. A dash when the
 * key cannot be read.
 */
export function dohLetter(keyText: string): string {
  const parsed = parseKey(keyText);
  if (!parsed) return "–";
  return DOH_NAMES[dohPitchClass(parsed)]!;
}

/**
 * The unmarked doh, as a tonic solfa hymn book sets it: the doh at or below the melody's
 * middle (median) note, so a tune between doh and soh prints with no marks. In a la-based
 * minor key the middle note is first raised a minor third, so a tune centred on its lah keeps
 * that lah under an unmarked doh (l, t, d). An empty list reads as a middle note of middle C.
 * Mirrors SolfaMapper.ReferenceDoh and solfa.py's reference_doh.
 */
export function referenceDoh(pitches: readonly number[], dohPc: number, mode: KeyMode): number {
  let middle = 60;
  if (pitches.length > 0) {
    const sorted = [...pitches].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    middle = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  if (mode === "minor") middle += 3;
  let ref = Math.floor((middle - dohPc) / 12) * 12 + dohPc;
  while (ref > 127) ref -= 12;
  while (ref < 0) ref += 12;
  return ref;
}

/**
 * The notes a part's octave marks are measured from: the soprano, which is the tune as the parts
 * write it (a man's tune moved up to a soprano's octave, so it reads exactly as the tune does), or
 * the melody when there is no soprano. Mirrors SolfaLabels.LabelParts and choir.js `partReference`.
 */
export function partReference(
  parts: Readonly<Record<string, { notes: readonly NoteEvent[] } | undefined>> | null | undefined,
  melody: readonly NoteEvent[],
): readonly NoteEvent[] {
  const soprano = parts?.soprano?.notes;
  return soprano && soprano.length > 0 ? soprano : melody;
}

/**
 * Which chromatic table each note is spelled from — the tonic solfa hymn-book rule.
 * Mirrors solfa.py's `ascending_flags` and SolfaMapper.cs's `AscendingFlags`.
 *
 * A chromatic note is named for where it goes, not where it came from: one that rises a
 * semitone to the next note is a sharpened degree (de re fe se le); one that falls a
 * semitone is a flattened degree (ra ma sa la ta). Anything else — a tone, a leap, the
 * last note — takes the name hymn books print for that pitch in the key (de ma fe se ta).
 *
 * Equal neighbours are one run and share a flag, read from the next *differing* pitch: a
 * chromatic sung twice must not be spelled `ra` then `de`.
 *
 * Only the five chromatic semitones {1, 3, 6, 8, 10} can be affected — the two
 * tables agree on all seven diatonic degrees, so a diatonic note's flag is
 * unobservable.
 *
 * `pitches` must be in melodic (time) order; this is a statement about a note's
 * position in the tune, not about the note in isolation.
 */
export function ascendingFlags(pitches: readonly number[], dohPc: number): boolean[] {
  const flags: boolean[] = new Array(pitches.length).fill(true);
  let start = 0;
  while (start < pitches.length) {
    // Last index of the run of pitches equal to pitches[start].
    let end = start;
    while (end + 1 < pitches.length && pitches[end + 1] === pitches[start]) end++;

    const step = end + 1 < pitches.length ? pitches[end + 1]! - pitches[start]! : 0;
    const flag =
      step === 1 ? true : step === -1 ? false : DEFAULT_SHARP[(((pitches[start]! - dohPc) % 12) + 12) % 12]!;

    for (let i = start; i <= end; i++) flags[i] = flag;
    start = end + 1;
  }
  return flags;
}

function resolveAscending(flag: boolean, spelling: ChromaticSpelling): boolean {
  if (spelling === "ascending") return true;
  if (spelling === "descending") return false;
  return flag;
}

export interface Syllable {
  solfa: string;
  octaveMark: string;
  degree: number;
}

/** Maps a MIDI pitch to its movable-do syllable, octave mark, and degree. */
export function syllable(
  pitchMidi: number,
  dohPc: number,
  refDohMidi: number,
  ascending = true,
  chromaticSet: ChromaticSet = "african",
): Syllable {
  const semitones = (((pitchMidi - dohPc) % 12) + 12) % 12;
  const shift = Math.floor((pitchMidi - refDohMidi) / 12);
  const table = ascending ? ASCENDING_SYLLABLES : CHROMATIC_SETS[chromaticSet];
  return {
    solfa: table[semitones]!,
    octaveMark: shift > 0 ? "'".repeat(shift) : ",".repeat(-shift),
    degree: SEMITONE_TO_DEGREE[semitones]!,
  };
}

/** The "Doh is F" header shown above every solfa sheet. */
export function dohHeader(dohPc: number): string {
  return `Doh is ${DOH_NAMES[dohPc]}`;
}

/**
 * Quarter-note beats per bar. startBeat/durBeats arrive as music21
 * quarterLengths, so 6/8 is 3 quarter beats, not 6. Falls back to 4.
 */
function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

/**
 * Cells per beat a sheet needs: 4 when a note starts or ends between the eighths, else 2, so
 * a line read on sixteenths never puts two notes in one cell ("d+r"). Mirrors the worker's
 * `solfa_render.divisions_for` and web `choir.js` `divisionsFor`.
 */
export function divisionsFor(notes: readonly { startBeat: number; durBeats: number }[]): number {
  for (const n of notes) {
    for (const at of [n.startBeat, n.startBeat + Math.max(0, n.durBeats)]) {
      if (Math.abs(at * 2 - Math.round(at * 2)) > 0.01) return 4;
    }
  }
  return 2;
}

/** Mirrors app/pipeline/solfa_render.py. */
export function renderSolfaLines(
  notes: readonly NoteEvent[],
  header: string,
  timeSignature: string,
  divisionsPerBeat = 2,
): string[] {
  if (notes.length === 0) return [header];
  divisionsPerBeat = Math.max(1, divisionsPerBeat, divisionsFor(notes));
  const cellBeats = 1 / Math.max(1, divisionsPerBeat);
  const barBeats = beatsPerBar(timeSignature);
  const cellsPerBar = Math.max(1, Math.round(barBeats * divisionsPerBeat));
  const maxEnd = Math.max(...notes.map((n) => n.startBeat + Math.max(0, n.durBeats)));
  const barCount = Math.max(1, Math.ceil(maxEnd / barBeats - 1e-9));
  const ordered = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.durBeats - b.durBeats);
  const startsByCell = new Map<number, NoteEvent[]>();
  const quantizedStart = new Map<NoteEvent, number>();
  for (const note of ordered) {
    // Match Python's explicit half-up grid rounding; Math.round differs only at ties.
    const cellIndex = Math.floor(note.startBeat / cellBeats + 0.5);
    quantizedStart.set(note, cellIndex * cellBeats);
    if (cellIndex >= 0 && cellIndex < barCount * cellsPerBar) {
      const starts = startsByCell.get(cellIndex) ?? [];
      starts.push(note);
      startsByCell.set(cellIndex, starts);
    }
  }
  const cells: string[] = [];

  for (let cell = 0; cell < barCount * cellsPerBar; cell++) {
    const start = cell * cellBeats;
    const end = start + cellBeats;
    const starts = startsByCell.get(cell) ?? [];
    const active = ordered.filter(
      (n) => {
        const quantized = quantizedStart.get(n) ?? n.startBeat;
        return quantized < end - 1e-9 && quantized + Math.max(0, n.durBeats) > start + 1e-9;
      },
    );
    if (starts.length > 0) {
      cells.push(starts.map((n) => `${n.solfa}${n.octaveMark}`).join("+"));
    } else if (active.length > 0) {
      cells.push("-");
    } else {
      cells.push("_");
    }
  }

  const bars: string[] = [];
  for (let i = 0; i < cells.length; i += cellsPerBar) {
    bars.push(cells.slice(i, i + cellsPerBar).join(" "));
  }
  const lines = [header];
  for (let i = 0; i < bars.length; i += 4) {
    lines.push(`| ${bars.slice(i, i + 4).join(" | ")} |`);
  }
  return lines;
}

/**
 * Renders notes in formal Curwen Tonic Sol-fa notation.
 * Uses traditional barlines |, beat delimiters :, sub-beat dots ., and held dashes -.
 * Quarters, on a sheet that has them, within their half: `d,r . m,f`, `d . ,r`, `d,r`.
 */
export function renderCurwenLines(
  notes: readonly NoteEvent[],
  header: string,
  timeSignature: string = "4/4",
  barsPerLine: number = 4,
): string[] {
  if (notes.length === 0) return [header];

  const barBeats = beatsPerBar(timeSignature);
  const beatsPerBarCount = Math.max(1, Math.round(barBeats));
  const divisionsPerBeat = divisionsFor(notes);
  const half = divisionsPerBeat / 2;
  const cellBeats = 1.0 / divisionsPerBeat;
  const cellsPerBar = beatsPerBarCount * divisionsPerBeat;

  const maxEnd = Math.max(...notes.map((n) => n.startBeat + Math.max(0, n.durBeats)));
  const barCount = Math.max(1, Math.ceil(maxEnd / barBeats - 1e-9));
  const ordered = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.durBeats - b.durBeats);
  const startsByCell = new Map<number, NoteEvent[]>();
  const quantizedStart = new Map<NoteEvent, number>();

  for (const note of ordered) {
    const cellIndex = Math.floor(note.startBeat / cellBeats + 0.5);
    quantizedStart.set(note, cellIndex * cellBeats);
    if (cellIndex >= 0 && cellIndex < barCount * cellsPerBar) {
      const starts = startsByCell.get(cellIndex) ?? [];
      starts.push(note);
      startsByCell.set(cellIndex, starts);
    }
  }

  const barStrings: string[] = [];
  for (let b = 0; b < barCount; b++) {
    const beatStrings: string[] = [];
    for (let beatIdx = 0; beatIdx < beatsPerBarCount; beatIdx++) {
      const c0 = (b * beatsPerBarCount + beatIdx) * divisionsPerBeat;
      const startsAt = (cIdx: number): boolean => (startsByCell.get(cIdx)?.length ?? 0) > 0;

      const cellToken = (cIdx: number): string => {
        const tStart = cIdx * cellBeats;
        const tEnd = tStart + cellBeats;
        const starts = startsByCell.get(cIdx) ?? [];
        const active = ordered.filter((n) => {
          const q = quantizedStart.get(n) ?? n.startBeat;
          return q < tEnd - 1e-9 && q + Math.max(0, n.durBeats) > tStart + 1e-9;
        });
        if (starts.length > 0) {
          return starts.map((n) => `${n.solfa}${n.octaveMark}`).join("+");
        }
        if (active.length > 0) {
          return "-";
        }
        return " ";
      };

      // A half beat, split at its quarter when a note starts there.
      const halfBeat = (first: number, opensBeat: boolean): string => {
        let token = opensBeat || startsAt(first) ? cellToken(first) : "";
        if (half > 1 && startsAt(first + 1)) token += `,${cellToken(first + 1)}`;
        return token;
      };

      let beat = halfBeat(c0, true);
      let second = false;
      for (let c = c0 + half; c < c0 + divisionsPerBeat; c++) second = second || startsAt(c);
      if (second) beat += ` . ${halfBeat(c0 + half, false)}`;
      beatStrings.push(beat);
    }
    barStrings.push(beatStrings.join(" : "));
  }

  const lines = [header];
  for (let i = 0; i < barStrings.length; i += barsPerLine) {
    lines.push(`| ${barStrings.slice(i, i + barsPerLine).join(" | ")} |`);
  }
  return lines;
}

export interface DerivedSolfa {
  /** The same notes with solfa/octaveMark/degree filled in for this key. */
  notes: NoteEvent[];
  /** Doh header followed by bar-grouped lines, 4 bars per line. */
  solfaLines: string[];
  /** Formal Curwen notation lines. */
  curwenLines: string[];
}

/**
 * Re-derives solfa for a note list in a given key — the whole point of a
 * movable-do engine. Used when opening a saved transcription (the library DTO
 * carries pitches but no syllables) and when the user overrides the key.
 */
export function deriveSolfa(
  notes: readonly NoteEvent[],
  keyText: string,
  timeSignature: string,
  chromaticSpelling: ChromaticSpelling = "direction",
  chromaticSet: ChromaticSet = "african",
): DerivedSolfa {
  const key = parseKey(keyText);
  if (!key || notes.length === 0) return { notes: [...notes], solfaLines: [], curwenLines: [] };

  const dohPc = dohPitchClass(key);
  const refDoh = referenceDoh(
    notes.map((n) => n.pitchMidi),
    dohPc,
    key.mode,
  );

  // A chromatic's spelling is a property of its position in the tune, and this list arrives in
  // whatever order the API sent it — not necessarily start-beat order. So the flags are
  // computed over a time-ordered view and scattered back, exactly as LibraryDtos.cs does,
  // because the two must agree character for character: the server labels a saved
  // transcription and this re-labels it on a key override. Sort is stable in ES2019+, so
  // notes sharing a start beat keep their relative order on both sides.
  const melodic = notes
    .map((_, i) => i)
    .sort((a, b) => notes[a]!.startBeat - notes[b]!.startBeat);
  const inMelodicOrder = ascendingFlags(melodic.map((i) => notes[i]!.pitchMidi), dohPc);
  const ascending: boolean[] = new Array(notes.length).fill(true);
  melodic.forEach((storageIndex, k) => {
    ascending[storageIndex] = resolveAscending(inMelodicOrder[k]!, chromaticSpelling);
  });

  const labelled = notes.map((n, i) => ({
    ...n,
    ...syllable(n.pitchMidi, dohPc, refDoh, ascending[i], chromaticSet),
  }));

  const solfaLines = renderSolfaLines(labelled, dohHeader(dohPc), timeSignature);
  const curwenLines = renderCurwenLines(labelled, dohHeader(dohPc), timeSignature);

  return { notes: labelled, solfaLines, curwenLines };
}

/** Every key the re-key picker offers — 12 majors then 12 minors. */
export const KEY_CHOICES: readonly string[] = [
  ...PITCH_NAMES.map((n) => `${n} major`),
  ...PITCH_NAMES.map((n) => `${n} minor`),
];

/** Minor tonics as their relative major's signature spells them, so D# minor sits on doh F# (`DOH_NAMES`). */
const MINOR_NAMES: readonly string[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

/** One doh in the doh picker (board n-ux-low Q1a). */
export interface DohCell {
  /** The doh, spelled as the DOH figure spells it ("Bb", never "A#"). */
  doh: string;
  /** The key a tap re-labels the sheet in: the doh's major, or the la-based minor on it ("E minor" on doh G). */
  key: string;
  /** Minor only: the key's name as its relative major's signature spells it ("Bb minor" on doh Db); null in major. */
  minorName: string | null;
  /** The sheet's own key. */
  on: boolean;
}

/**
 * The doh picker's twelve cells, C first in pitch order (display only, not the engine). Major gives each doh its major
 * key; Minor (la-based) the minor key whose doh it is, so doh G is E minor. Either is a re-label: the notes never move.
 */
export function dohCells(current: string, mode: KeyMode): DohCell[] {
  return DOH_NAMES.map((doh, pc) => {
    const tonic = mode === "major" ? pc : (pc + 9) % 12;
    const key = `${PITCH_NAMES[tonic]} ${mode}`;
    return { doh, key, minorName: mode === "minor" ? `${MINOR_NAMES[tonic]} minor` : null, on: sameKey(key, current) };
  });
}
