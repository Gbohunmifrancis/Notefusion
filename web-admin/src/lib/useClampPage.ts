"use client";

import { useEffect } from "react";

/**
 * Snaps a table's page back inside the result set once the server says it no longer exists.
 *
 * The server clamps the low end and deliberately leaves the high end alone — a request for page 9
 * of 8 returns zero rows with a real `totalCount`. Every paged view hands that result to
 * `StateView`, which sees an empty page, swaps in the "nothing here" message and drops the footer
 * with it, taking away the one control that could step back. So the correction belongs on this
 * side, next to the state that asked for the page.
 *
 * Reachable whenever the set shrinks underneath the page number: suspending an account moves it out
 * of the "active" filter, another admin reconciles or deletes a row, or a restored tab replays a
 * page number from a longer list. Snapping to the last real page rather than to page 1 keeps the
 * operator near where they were.
 */
export function useClampPage(
  page: number,
  totalPages: number | undefined,
  setPage: (next: number) => void,
): void {
  useEffect(() => {
    // `undefined` is "no response yet" and 0 is "no rows at all" — the empty state owns that one,
    // and snapping to page 0 would ask the server for something that cannot exist.
    if (totalPages !== undefined && totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [page, totalPages, setPage]);
}
