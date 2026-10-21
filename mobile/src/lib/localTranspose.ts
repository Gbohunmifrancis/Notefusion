/**
 * "Transpose for my choir" with no connection: the same move the API makes (every pitch, the parts
 * and the chords by the same interval, the key renamed), done on the phone so a saved copy can be
 * read in another key offline. The view only — the saved sheet is moved on the server when it can
 * be reached. Solfa is movable-do, so the syllables read as before; the stave is engraved from these
 * notes (ScoreView builds its MusicXML locally).
 */
import type { ChordSymbol, NoteEvent } from "../api/types";

const NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
/** Key names as their signatures spell them (Bb major, G# minor; F# and Eb at the ties), as MusicalKey.cs. */
const MAJOR_KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Pitch class of a key's tonic and whether its signature uses flats ("F major", "D minor" → flats). */
function keyInfo(key: string): { pc: number; flats: boolean; minor: boolean } | null {
  const m = /^\s*([A-Ga-g])([#♯b♭]?)\s*(.*)$/.exec(key);
  if (!m) return null;
  let pc = LETTER_PC[m[1]!.toUpperCase()]!;
  if (m[2] === "#" || m[2] === "♯") pc += 1;
  if (m[2] === "b" || m[2] === "♭") pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  const minor = /^(m|min|minor)\b/i.test(m[3]!.trim());
  // Flat keys, as the key names spell them: F Bb Eb Ab Db major (F# kept at the tie); D G C F Bb Eb minor.
  const flats = minor ? [2, 7, 0, 5, 10, 3].includes(pc) : [5, 10, 3, 8, 1].includes(pc);
  return { pc, flats, minor };
}

/** The key `semitones` away, spelled the way its signature is ("Eb major" + 2 → "F major"), as `shiftKeyName`. */
export function transposeKeyName(key: string, semitones: number): string {
  const k = keyInfo(key);
  if (!k) return key;
  const pc = (((k.pc + semitones) % 12) + 12) % 12;
  return k.minor ? `${MINOR_KEY_NAMES[pc]} minor` : `${MAJOR_KEY_NAMES[pc]} major`;
}

export function shiftPitches(notes: readonly NoteEvent[], semitones: number): NoteEvent[] {
  return notes.map((n) => ({ ...n, pitchMidi: Math.min(127, Math.max(0, n.pitchMidi + semitones)) }));
}

/** A chord moved with the tune: root and bass shift, the letters are respelled for the new key, the solfa stays. */
export function transposeChord(chord: ChordSymbol, semitones: number, newKey: string): ChordSymbol {
  const flats = keyInfo(newKey)?.flats ?? false;
  const names = flats ? NAMES_FLAT : NAMES_SHARP;
  const root = (((chord.root + semitones) % 12) + 12) % 12;
  const bass = chord.bass === null ? null : (((chord.bass + semitones) % 12) + 12) % 12;
  // The quality as the symbol wrote it, between the root letter and any slash bass ("m7" in "Dm7/C").
  const m = /^[A-G][#b♯♭]?(.*?)(\/[A-G][#b♯♭]?)?$/.exec(chord.symbol);
  const suffix = m ? m[1]! : "";
  const symbol = `${names[root]}${suffix}${bass === null ? "" : `/${names[bass]}`}`;
  return { ...chord, root, bass, symbol };
}

export interface MovableSheet {
  key: string;
  notes: NoteEvent[];
  parts: Record<string, { notes: NoteEvent[]; solfaLines: string[] }> | null;
  chords: ChordSymbol[] | null;
}

export function transposeLocally(sheet: MovableSheet, semitones: number): MovableSheet {
  const key = transposeKeyName(sheet.key, semitones);
  const parts = sheet.parts
    ? Object.fromEntries(Object.entries(sheet.parts).map(([v, p]) => [v, { ...p, notes: shiftPitches(p.notes, semitones) }]))
    : null;
  return {
    key,
    notes: shiftPitches(sheet.notes, semitones),
    parts,
    chords: sheet.chords ? sheet.chords.map((c) => transposeChord(c, semitones, key)) : null,
  };
}
