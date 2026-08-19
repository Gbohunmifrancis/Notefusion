/**
 * Table metrics, shared by the two tables on the dashboard — accounts and retention
 * cohorts. They are the same object visually, so their header, row and cell classes live
 * here instead of being retyped in each page and drifting apart.
 *
 * Cells are padded rather than the rows, so a horizontally scrolled table keeps its
 * gutters at both ends.
 */

/** Header cell. Sentence case, not uppercase — long headings stay readable. */
export const TH = "whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium text-muted";

/** Body cell. */
export const TD = "px-4 py-3 align-middle text-[13px] text-muted";

/** Body row. */
export const TR = "border-b border-border-light transition last:border-0 hover:bg-surface-alt/50";

/** The header row itself, which carries the only full-weight rule in the table. */
export const THEAD_TR = "border-b border-border";
