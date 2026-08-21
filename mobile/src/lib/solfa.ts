/**
 * Movable-do solfa engine — mirrors src/NoteFusion.Core/Solfa (C#) and
 * server/app/pipeline/solfa.py (Python).
 *
 * Lives client-side on purpose: a key override is a re-labelling, never a
 * re-transcription (TRD §4.1), so the app re-derives every syllable locally
 * and the display updates with no round-trip. The server still owns the
 * durable override (PUT /api/library/{id}/key) — this module owns the render.
 *
 * Keep all three implementations in sync: same syllable tables, la-based
 * minor, reference-doh octave marks. Octave marks follow the Python wire
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

/** Diatonic degree for each semitone above doh (ascending/sharp convention). */
const SEMITONE_TO_DEGREE = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7] as const;

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

/** The doh octave nearest the melody's median — the unmarked register. */
export function referenceDoh(pitches: readonly number[], dohPc: number): number {
  // No pitches to centre on — fall back to the doh nearest middle C.
  if (pitches.length === 0) return Math.round((60 - dohPc) / 12) * 12 + dohPc;

  const sorted = [...pitches].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;

  let best = dohPc;
  for (let p = dohPc; p < 128; p += 12) {
    if (Math.abs(p - median) < Math.abs(best - median)) best = p;
  }
  return best;
}

/**
 * Which chromatic table each note is spelled from, decided by melodic direction.
 * Mirrors solfa.py's `ascending_flags` and SolfaMapper.cs's `AscendingFlags`.
 *
 * A rising chromatic is a sharpened degree (de re fe se le); a falling one is a
 * flattened degree (ra ma sa la ta). Direction is taken from the pitch the melody
 * arrived from; on the opening run, where there is nothing to arrive from, it is
 * taken from the pitch the melody leaves for instead; a clip holding one single
 * pitch is ascending by convention.
 *
 * Equal neighbours are one run and share a flag, which is why the previous
 * *differing* pitch is what counts rather than the literal previous note: a
 * chromatic sung twice must not be spelled `ra` then `de`.
 *
 * Only the five chromatic semitones {1, 3, 6, 8, 10} can be affected — the two
 * tables agree on all seven diatonic degrees, so a diatonic note's flag is
 * unobservable.
 *
 * `pitches` must be in melodic (time) order; this is a statement about a note's
 * position in the tune, not about the note in isolation.
 */
export function ascendingFlags(pitches: readonly number[]): boolean[] {
  const flags: boolean[] = new Array(pitches.length).fill(true);
  let start = 0;
  while (start < pitches.length) {
    // Last index of the run of pitches equal to pitches[start].
    let end = start;
    while (end + 1 < pitches.length && pitches[end + 1] === pitches[start]) end++;

    const flag =
      start > 0
        ? // The previous run's pitch, which differs from this one by construction.
          pitches[start - 1]! < pitches[start]!
        : end + 1 >= pitches.length || pitches[end + 1]! > pitches[start]!;

    for (let i = start; i <= end; i++) flags[i] = flag;
    start = end + 1;
  }
  return flags;
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
): Syllable {
  const semitones = (((pitchMidi - dohPc) % 12) + 12) % 12;
  const shift = Math.floor((pitchMidi - refDohMidi) / 12);
  const table = ascending ? ASCENDING_SYLLABLES : DESCENDING_SYLLABLES;
  return {
    solfa: table[semitones]!,
    octaveMark: shift > 0 ? "'".repeat(shift) : ",".repeat(-shift),
    degree: SEMITONE_TO_DEGREE[semitones]!,
  };
}

/** The "Doh is F" header shown above every solfa sheet. */
export function dohHeader(dohPc: number): string {
  return `Doh is ${PITCH_NAMES[dohPc]}`;
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

export interface DerivedSolfa {
  /** The same notes with solfa/octaveMark/degree filled in for this key. */
  notes: NoteEvent[];
  /** Doh header followed by bar-grouped lines, 4 bars per line. */
  solfaLines: string[];
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
): DerivedSolfa {
  const key = parseKey(keyText);
  if (!key || notes.length === 0) return { notes: [...notes], solfaLines: [] };

  const dohPc = dohPitchClass(key);
  const refDoh = referenceDoh(
    notes.map((n) => n.pitchMidi),
    dohPc,
  );

  // Direction is a property of a note's position in the tune, and this list arrives in
  // whatever order the API sent it — not necessarily start-beat order. So the flags are
  // computed over a time-ordered view and scattered back, exactly as LibraryDtos.cs does,
  // because the two must agree character for character: the server labels a saved
  // transcription and this re-labels it on a key override. Sort is stable in ES2019+, so
  // notes sharing a start beat keep their relative order on both sides.
  const melodic = notes
    .map((_, i) => i)
    .sort((a, b) => notes[a]!.startBeat - notes[b]!.startBeat);
  const inMelodicOrder = ascendingFlags(melodic.map((i) => notes[i]!.pitchMidi));
  const ascending: boolean[] = new Array(notes.length).fill(true);
  melodic.forEach((storageIndex, k) => {
    ascending[storageIndex] = inMelodicOrder[k]!;
  });

  const labelled = notes.map((n, i) => ({
    ...n,
    ...syllable(n.pitchMidi, dohPc, refDoh, ascending[i]),
  }));

  // Group into bars by absolute beat, mirroring the worker's measure grouping.
  const perBar = beatsPerBar(timeSignature);
  const bars: string[][] = [];
  for (const n of labelled) {
    const i = Math.max(0, Math.floor(n.startBeat / perBar));
    while (bars.length <= i) bars.push([]);
    bars[i]!.push(n.solfa + n.octaveMark);
  }

  const cells = bars.map((b) => (b.length > 0 ? b.join(" ") : "-"));
  const solfaLines = [dohHeader(dohPc)];
  for (let i = 0; i < cells.length; i += 4) {
    solfaLines.push(`| ${cells.slice(i, i + 4).join(" | ")} |`);
  }

  return { notes: labelled, solfaLines };
}

/** Every key the re-key picker offers — 12 majors then 12 minors. */
export const KEY_CHOICES: readonly string[] = [
  ...PITCH_NAMES.map((n) => `${n} major`),
  ...PITCH_NAMES.map((n) => `${n} minor`),
];
