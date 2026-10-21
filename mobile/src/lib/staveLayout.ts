/**
 * The stave's size before the engraver has drawn it (board n-ux-low Q1f). At a phone's width the engraver sets four bars
 * to a system, each about 130 px tall, so the Staff card opens at the height its bars will need, with grey stave lines
 * where the systems will be, and nothing under it jumps when the stave arrives. Pure, so it is tested
 * (`staveLayout.test.ts`); components/ScoreView draws it.
 */

export const BARS_PER_SYSTEM = 4;
export const SYSTEM_HEIGHT = 130;
/** Never shorter than one system and its room, so the WebView is never laid out at zero height. */
export const MIN_STAVE_HEIGHT = 160;
/** A system's top stave line, below the room its bar numbers and high notes take. */
const STAFF_TOP = 44;
/** The five lines' spacing. */
export const STAFF_LINE_GAP = 8;

/** How many systems a tune of `bars` bars is set on. */
export function systemsFor(bars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, bars) / BARS_PER_SYSTEM));
}

/** The stave's expected height, inside the card's padding. */
export function expectedStaveHeight(bars: number): number {
  return Math.max(MIN_STAVE_HEIGHT, systemsFor(bars) * SYSTEM_HEIGHT);
}

/** Where each system's top stave line sits in the skeleton, from the stave's top. */
export function skeletonStaffTops(bars: number): number[] {
  return Array.from({ length: systemsFor(bars) }, (_, k) => STAFF_TOP + k * SYSTEM_HEIGHT);
}
