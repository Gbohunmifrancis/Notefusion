/**
 * What each "… · Undo" toast says (board m-ux-medium): the change in a few words, already made. Pure
 * (`undoWords.test.ts`).
 */

/** "Doh is D now": another doh chosen from "Which doh is it?". */
export function dohNowLine(dohLetter: string): string {
  return `Doh is ${dohLetter} now`;
}

/** "Use the hymnbook" taken. */
export const HYMNBOOK_IN_LINE = "Hymnbook version in";

/** Profile's "Remove photo". */
export const PHOTO_REMOVED_LINE = "Photo removed";

/** "“Abide with Me” deleted", or "3 sheets deleted": a held delete (board m-ux-medium P2a). */
export function deletedLine(titles: readonly string[]): string {
  return titles.length === 1 ? `“${titles[0]}” deleted` : `${titles.length} sheets deleted`;
}

/** "Moved up 2, to A": a transposition, by semitones, to the key it reached ("A major" is said "A"). */
export function movedLine(semitones: number, key: string): string {
  const to = key.replace(/\s+major$/i, "").trim();
  return `Moved ${semitones > 0 ? "up" : "down"} ${Math.abs(semitones)}, to ${to}`;
}
