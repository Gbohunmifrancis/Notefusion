import { ChevronLeft, ChevronRight } from "lucide-react";

import { formatCount } from "@/lib/format";

const STEP =
  "grid h-8 w-8 place-items-center rounded-sm border border-border text-muted transition hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-40";

/**
 * The footer under a paged table: what is on screen, out of what, and the two steps.
 *
 * The range is computed from the server's own `page`/`pageSize`/`totalCount` rather than from the
 * rows in hand, so it stays honest when the last page is short. `busy` disables the steps during a
 * load — without it a double-click on Next skips a page, because the second click is against the
 * page number the server has not returned yet.
 */
export function Pager({
  page,
  pageSize,
  totalCount,
  totalPages,
  busy = false,
  onPage,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  busy?: boolean | undefined;
  onPage: (next: number) => void;
}) {
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalCount);

  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
      <p className="text-xs text-muted">
        Showing <span className="font-medium text-ink">{formatCount(first)}</span> to{" "}
        <span className="font-medium text-ink">{formatCount(last)}</span> of{" "}
        <span className="font-medium text-ink">{formatCount(totalCount)}</span>
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1 || busy}
          className={STEP}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs tabular-nums text-muted">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages || busy}
          className={STEP}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </footer>
  );
}
