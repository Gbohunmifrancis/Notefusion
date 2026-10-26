/**
 * Choir helpers: the four voices' comfortable ranges (what "transpose for my choir"
 * checks against), lyric syllabification, and the hymn-book layout that puts a
 * lyric syllable under each solfa cell. Pure functions; the web app mirrors them
 * in web-site/assets/choir.js.
 */

import type { NoteEvent, TranscriptionPart } from "../api/types";

export type VoiceName = "soprano" | "alto" | "tenor" | "bass";
export const VOICES: readonly VoiceName[] = ["soprano", "alto", "tenor", "bass"];

/**
 * Comfortable written ranges for an amateur choir, as MIDI. Wider than a beginner's,
 * narrower than a soloist's: the point is to warn before a part is handed out, not
 * to be the last word.
 */
export const VOICE_RANGES: Record<VoiceName, readonly [number, number]> = {
  soprano: [60, 79], // C4–G5
  alto: [53, 74], // F3–D5
  tenor: [48, 67], // C3–G4
  bass: [40, 60], // E2–C4
};

/** What a congregation sings a melody in comfortably: roughly A3–D5. */
export const MELODY_RANGE: readonly [number, number] = [57, 74];

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** Key names as their signatures spell them (Bb major, G# minor; F# and Eb at the ties), as MusicalKey.cs. */
const MAJOR_KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

/** "G5"-style name of a MIDI pitch. */
export function pitchName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** The pitch as a screen reader should say it: "C sharp 4", never a MIDI number or a "#". */
export function spokenPitch(midi: number): string {
  return pitchName(midi).replace(/^([A-G])#/, "$1 sharp ").replace(/^([A-G])(-?\d)/, "$1 $2");
}

export type RangeStatus = "ok" | "high" | "low" | "wide";

export interface VoiceRange {
  voice: VoiceName | "melody";
  low: number;
  high: number;
  status: RangeStatus;
  /** Semitones outside the comfortable range; 0 when inside. */
  overBy: number;
}

/** Each voice's compass after a shift of `semitones`, judged against its comfortable range. */
export function rangeReport(
  melody: readonly NoteEvent[],
  parts: Partial<Record<VoiceName, TranscriptionPart>> | null | undefined,
  semitones: number,
): VoiceRange[] {
  const out: VoiceRange[] = [];
  const judge = (voice: VoiceName | "melody", notes: readonly NoteEvent[], range: readonly [number, number]) => {
    const pitches = notes.map((n) => n.pitchMidi + semitones).filter((p) => p > 0);
    if (pitches.length === 0) return;
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    const tooHigh = Math.max(0, high - range[1]);
    const tooLow = Math.max(0, range[0] - low);
    const status: RangeStatus = tooHigh && tooLow ? "wide" : tooHigh ? "high" : tooLow ? "low" : "ok";
    out.push({ voice, low, high, status, overBy: Math.max(tooHigh, tooLow) });
  };
  if (parts && VOICES.some((v) => parts[v]?.notes.length)) {
    // The tune is the soprano whether or not the parts dictionary repeats it.
    for (const v of VOICES) {
      if (v === "soprano") judge(v, melody, VOICE_RANGES[v]);
      else if (parts[v]) judge(v, parts[v]!.notes, VOICE_RANGES[v]);
    }
  } else {
    judge("melody", melody, MELODY_RANGE);
  }
  return out;
}

/** Shift every pitch; the optimistic local version of what the API's transpose does. */
export function shiftNotes(notes: readonly NoteEvent[], semitones: number): NoteEvent[] {
  return notes.map((n) => ({ ...n, pitchMidi: Math.min(127, Math.max(0, n.pitchMidi + semitones)) }));
}

/** The key name shifted by `semitones`, keeping the mode ("Eb major" → "F major"). */
export function shiftKeyName(key: string, semitones: number): string {
  const m = /^\s*([A-Ga-g])([#♯b♭-]*)\s*(.*)$/.exec(key);
  if (!m) return key;
  const base: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let pc = base[m[1]!.toLowerCase()]!;
  for (const ch of m[2]!) pc += ch === "#" || ch === "♯" ? 1 : -1;
  pc = (((pc + semitones) % 12) + 12) % 12;
  const minor = /^(m|min|minor)$/i.test(m[3]!.trim());
  return minor ? `${MINOR_KEY_NAMES[pc]} minor` : `${MAJOR_KEY_NAMES[pc]} major`;
}

/**
 * Lyric syllables in singing order. Words split on whitespace, syllables on hyphens;
 * a syllable that continues its word keeps a trailing hyphen ("A-", "ma-", "zing").
 * An underscore holds a syllable over the next note ("grace_" → the next note is sung
 * on the same vowel), the convention most choir sheets use.
 */
export function syllabify(lyrics: string): string[] {
  const out: string[] = [];
  for (const word of lyrics.split(/\s+/).filter(Boolean)) {
    const pieces = word.split("-").filter(Boolean);
    pieces.forEach((piece, i) => {
      const holds = piece.split("_");
      holds.forEach((h, j) => {
        if (j === 0) out.push(i < pieces.length - 1 ? `${h}-` : h);
        else out.push("_");
      });
    });
  }
  return out;
}

/** The syllable each note sings, by index into `notes`, in onset order. */
export function lyricsUnderNotes(notes: readonly NoteEvent[], lyrics: string): (string | null)[] {
  const syllables = syllabify(lyrics);
  const order = notes.map((_, i) => i).sort((a, b) => notes[a]!.startBeat - notes[b]!.startBeat);
  const out: (string | null)[] = new Array(notes.length).fill(null);
  order.forEach((noteIndex, k) => {
    out[noteIndex] = syllables[k] ?? null;
  });
  return out;
}

export interface HymnCell {
  solfa: string;
  lyric: string;
}

/**
 * Hymn-book layout: each line is four bars, each bar `beatsPerBar × divisions` cells (2, or the
 * sheet's `divisionsFor` from lib/solfa: 4 when it has sixteenths), each cell
 * the solfa token the grid renderer prints ("d", "-", "_") with the lyric syllable sung
 * on the note starting there. Mirrors renderSolfaLines' quantisation so the two agree.
 */
export function hymnRows(
  notes: readonly NoteEvent[],
  lyrics: string,
  timeSignature: string,
  barsPerLine = 4,
  divisions = 2,
): HymnCell[][][] {
  if (notes.length === 0) return [];
  const [num, den] = timeSignature.split("/").map(Number);
  const barBeats = num && den ? (num * 4) / den : 4;
  const cellBeats = 1 / divisions;
  const cellsPerBar = Math.max(1, Math.round(barBeats * divisions));
  const maxEnd = Math.max(...notes.map((n) => n.startBeat + Math.max(0, n.durBeats)));
  const barCount = Math.max(1, Math.ceil(maxEnd / barBeats - 1e-9));
  const under = lyricsUnderNotes(notes, lyrics);
  const ordered = notes
    .map((n, i) => ({ n, i, q: Math.floor(n.startBeat / cellBeats + 0.5) * cellBeats }))
    .sort((a, b) => a.n.startBeat - b.n.startBeat || a.n.durBeats - b.n.durBeats);

  const cells: HymnCell[] = [];
  for (let cell = 0; cell < barCount * cellsPerBar; cell++) {
    const start = cell * cellBeats;
    const end = start + cellBeats;
    const starts = ordered.filter((o) => Math.abs(o.q - start) < 1e-9);
    const active = ordered.some((o) => o.q < end - 1e-9 && o.q + Math.max(0, o.n.durBeats) > start + 1e-9);
    if (starts.length > 0) {
      cells.push({
        solfa: starts.map((o) => `${o.n.solfa}${o.n.octaveMark}`).join("+"),
        lyric: starts.map((o) => under[o.i] ?? "").filter(Boolean).join(" "),
      });
    } else {
      cells.push({ solfa: active ? "-" : "_", lyric: "" });
    }
  }
  const bars: HymnCell[][] = [];
  for (let i = 0; i < cells.length; i += cellsPerBar) bars.push(cells.slice(i, i + cellsPerBar));
  const rows: HymnCell[][][] = [];
  for (let i = 0; i < bars.length; i += barsPerLine) rows.push(bars.slice(i, i + barsPerLine));
  return rows;
}
