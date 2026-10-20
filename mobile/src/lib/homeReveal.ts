/**
 * When Home's Recent shows its rows, and whether Doh's card comes with them (board m-ux-medium P2f). The card needs
 * the list and the practice progress, and the progress often lands later: a card arriving then pushed every row
 * down under a thumb on its way to one. So Recent keeps its skeleton until both have answered and the card and the
 * rows appear in the same frame; a progress that has not answered in 1.5 s lets the rows show alone, and the card
 * waits for the next visit. Pure (`homeReveal.test.ts`).
 */

/** How long the rows wait for the progress before they show without Doh's card. */
export const PROGRESS_WAIT_MS = 1500;

/** "wait": the skeleton stays; "rows": the rows alone; "rows-and-card": the rows, with the card if there is one. */
export type RecentReveal = "wait" | "rows" | "rows-and-card";

export function recentReveal(s: {
  /** The list has answered (its rows, or an error to show). */
  listIn: boolean;
  /** What the card is chosen from has answered: the practice progress (and the card's memory on the phone). */
  cardIn: boolean;
  /** `PROGRESS_WAIT_MS` has passed since Home first asked. */
  timedOut: boolean;
}): RecentReveal {
  if (!s.listIn) return "wait";
  if (s.cardIn) return "rows-and-card";
  return s.timedOut ? "rows" : "wait";
}
