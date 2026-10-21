/**
 * A marked note told by its shape as well as its colour (board l-ux-high 05b), the way the practice modes draw it
 * (components/practice/ModeResult): ✓ in tune, ~ close, struck through when off the note, dashed with – when not
 * sung. Focused (`GradeMarks`) and Playful (`StarGrade`) share it; Playful says it in its own words, without cents.
 * Pure, so it is tested (`markShape.test.ts`).
 */

import type { GradeStatus } from "../api/types";

/** The glyph after the letter. Off the note has none: its letter is struck through. */
export function markGlyph(status: GradeStatus): string {
  return status === "hit" ? "✓" : status === "near" ? "~" : status === "missed" ? "–" : "";
}

const WORDS: Record<"focused" | "playful", Record<GradeStatus, string>> = {
  focused: { hit: "in tune", near: "close", wrong: "off the note", missed: "not sung" },
  playful: { hit: "spot on", near: "close", wrong: "try again", missed: "not heard" },
};

/** What a screen reader says for one mark: "d: in tune, 6 cents sharp", "s: not sung"; Playful's without cents. */
export function markLabel(syllable: string, status: GradeStatus, cents: number | null | undefined, playful = false): string {
  const said = `${syllable}: ${WORDS[playful ? "playful" : "focused"][status]}`;
  if (playful || status === "missed" || cents == null || !Number.isFinite(cents)) return said;
  const c = Math.round(cents);
  if (c === 0) return said;
  const n = Math.abs(c);
  return `${said}, ${n} ${n === 1 ? "cent" : "cents"} ${c > 0 ? "sharp" : "flat"}`;
}

/** The legends under the marks name the shapes, never the colours alone. */
export const FOCUSED_MARK_LEGEND = "✓ in tune · ~ close · struck through: off the note · – not sung. Numbers are cents off.";
export const PLAYFUL_MARK_LEGEND = "✓ spot on · ~ close · struck through: try again · – not heard";
