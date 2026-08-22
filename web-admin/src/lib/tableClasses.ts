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

/** Header cell. Sentence case, not uppercase — long headings stay readable. */
export const TH = "px-4 py-2.5 text-xs font-medium text-muted-foreground";

/** Body cell. */
export const TD = "px-4 py-3 text-[13px] text-muted-foreground";

/** Body rows, applied once to `TableBody`: a hairline rule rather than the header's full weight. */
export const TBODY = "[&_tr]:border-border-light";
