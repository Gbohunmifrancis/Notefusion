/**
 * The two metrics shadcn's `Table` does not have, shared by the console's tables — accounts, the
 * audit log, and the retention cohorts inside a user's detail page. They are the same object
 * visually, so the numbers live here instead of being retyped per page and drifting apart.
 *
 * Only the cells. The rules and the row hover come from `TableHeader`/`TableRow` as generated:
 * shadcn already draws a full-weight border under the header and a hover tint on a body row, which
 * is exactly the treatment this console had. Body rows get the lighter `border-border-light` rule
 * from a single override on `TableBody`, so a long table reads as one block rather than as a stack
 * of framed strips.
 *
 * Cells are padded rather than the rows, so a horizontally scrolled table keeps its gutters at
 * both ends.
 */

/** Header cell: small, medium weight, sentence case. */
export const TH = "px-5 py-2.5 text-xs font-medium text-muted-foreground";

/** Body cell: comfortable row height, clear text contrast. */
export const TD = "px-5 py-3.5 text-[13px] text-slate-700 dark:text-slate-300";

/** Body rows, applied once to `TableBody`: subtle hairline divider without double borders. */
export const TBODY = "[&_tr]:border-border/60 last:[&_tr]:border-0";

