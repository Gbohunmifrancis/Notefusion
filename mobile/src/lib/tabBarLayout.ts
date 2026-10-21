/**
 * The tab bar's two layouts (board n-ux-low Q5j; tests: tabBarLayout.test.ts). Five floating cells of about 62 dp on
 * a 360 dp phone hold "Practice" whole only up to 1.2x system text (14.4 px). From 1.3x the bar docks instead: edge
 * to edge on the safe area, square ends, the centre Record cell 64 dp and the four labelled cells sharing the rest
 * (72 dp each at 360), 72 tall, the labels growing to 1.5x (18 px: "Practice" semibold is 71.8 px). Below 1.3x
 * nothing changes.
 */

/** From this system text size the bar docks. */
export const TAB_DOCK_FONT_SCALE = 1.3;

/** The floating bar's height, and the docked bar's (its safe-area inset comes under it). */
export const TAB_BAR_HEIGHT = 64;
export const TAB_BAR_DOCKED_HEIGHT = 72;

/** The centre Record cell's width when docked; the labelled cells are `flex: 1` around it. */
export const TAB_DOCKED_CENTRE = 64;

/** The docked bar's side padding: 4 + 4 × 72 + 64 + 4 = 360. */
export const TAB_DOCKED_SIDE = 4;

/** The floating bar stands this far off the bottom: at least 8 under it, plus a 4 lift (spacing.sm, spacing.xs). */
const FLOAT_MIN_GAP = 8;
const FLOAT_LIFT = 4;

export interface TabBarLayout {
  docked: boolean;
  /** The row of cells' own height. */
  height: number;
  /** The labels' `maxFontSizeMultiplier`. */
  labelMaxScale: number;
}

export function tabBarLayout(fontScale: number): TabBarLayout {
  const docked = fontScale >= TAB_DOCK_FONT_SCALE;
  return {
    docked,
    height: docked ? TAB_BAR_DOCKED_HEIGHT : TAB_BAR_HEIGHT,
    labelMaxScale: docked ? 1.5 : 1.2,
  };
}

/** How far the bar's top stands above the screen's bottom edge: what a tab's last line has to clear. */
export function tabBarTop(fontScale: number, insetBottom: number): number {
  return tabBarLayout(fontScale).docked
    ? TAB_BAR_DOCKED_HEIGHT + insetBottom
    : TAB_BAR_HEIGHT + Math.max(insetBottom, FLOAT_MIN_GAP) + FLOAT_LIFT;
}

/**
 * The room a tab adds under its content at this text size, beyond what it keeps for the floating bar: the docked bar
 * stands at most 4 dp higher (a phone with a home indicator), never lower than nothing.
 */
export function dockedExtraRoom(fontScale: number, insetBottom: number): number {
  return Math.max(0, tabBarTop(fontScale, insetBottom) - tabBarTop(1, insetBottom));
}
