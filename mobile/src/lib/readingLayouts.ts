import type { NoteEvent } from "../api/types";
import type { HymnCell } from "./choir";

/**
 * The ways to read a sheet's solfa, as the Result's Layout menu names them (board n-ux-low Q1b): one bar to a row, the
 * text grid, Curwen and the hymn layout, each with a line on what it is and the tune's own first bar as it writes it,
 * so the difference is seen before the tap. Staff is the other half of the Solfa | Staff switch, not a layout.
 * Pure, so it is tested (`readingLayouts.test.ts`).
 */

export type SolfaLayout = "bars" | "grid" | "curwen" | "hymn";

export interface LayoutInfo {
  id: SolfaLayout;
  /** The Layout button and the menu row: "By bar". */
  name: string;
  /** What it is, in a line. */
  line: string;
}

export const SOLFA_LAYOUTS: readonly LayoutInfo[] = [
  { id: "bars", name: "By bar", line: "One bar to a row. Tap a syllable to hear it and fix it." },
  { id: "grid", name: "Grid", line: "A column for every half beat: - holds the note, _ is a rest." },
  { id: "curwen", name: "Curwen", line: "As hymn books print it: | between bars, : between beats." },
  { id: "hymn", name: "Hymn", line: "Your words under each note, a line at a time." },
];

/** The layouts a sheet offers: Hymn only when it has words to put under the notes. */
export function layoutsFor(hasLyrics: boolean): LayoutInfo[] {
  return SOLFA_LAYOUTS.filter((l) => l.id !== "hymn" || hasLyrics);
}

/** The Layout button's words for the layout in use. */
export function layoutName(id: SolfaLayout): string {
  return SOLFA_LAYOUTS.find((l) => l.id === id)!.name;
}

/** Whether a bar, a cell or a token holds a syllable rather than holds, rests and bar lines. */
const SUNG = /[a-z]/i;

/**
 * By bar's sample: the syllables of the first bar a note starts in, two spaces apart ("s,  d  d  r"). Null with no
 * notes.
 */
export function firstBarSyllables(notes: readonly NoteEvent[], timeSignature: string): string | null {
  if (notes.length === 0) return null;
  const [num, den] = timeSignature.split("/").map(Number);
  const barBeats = num && den ? (num * 4) / den : 4;
  const barOf = (n: NoteEvent) => Math.floor(n.startBeat / barBeats + 1e-6);
  const ordered = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  const first = barOf(ordered[0]!);
  return ordered
    .filter((n) => barOf(n) === first)
    .map((n) => `${n.solfa}${n.octaveMark}`)
    .join("  ");
}

/**
 * Grid's and Curwen's sample: the first bar of their text that holds a syllable, between its bar lines
 * ("| s, - d - d - r - |", "| s, : d : d : r |"). The lines come after their "Doh is" header. Null when none does.
 */
export function firstBarOf(lines: readonly string[]): string | null {
  for (const line of lines.slice(1)) {
    for (const bar of line.split("|")) {
      const trimmed = bar.trim();
      if (SUNG.test(trimmed)) return `| ${trimmed} |`;
    }
  }
  return null;
}

/**
 * Hymn's sample: the first bar with a syllable sung in it, its syllables two spaces apart and the words sung on them
 * under it ("s,  d  d  r" over "A- ma- zing grace"). Null when no bar has one.
 */
export function firstHymnBar(rows: readonly (readonly (readonly HymnCell[])[])[]): { solfa: string; words: string } | null {
  for (const row of rows) {
    for (const bar of row) {
      const sung = bar.filter((cell) => SUNG.test(cell.solfa));
      if (sung.length === 0) continue;
      return {
        solfa: sung.map((cell) => cell.solfa).join("  "),
        words: sung
          .map((cell) => cell.lyric)
          .filter(Boolean)
          .join(" "),
      };
    }
  }
  return null;
}
