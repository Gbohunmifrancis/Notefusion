import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";

/**
 * The footer under a paged table: what is on screen, out of what, and the two steps.
 *
 * The range is computed from the server's own `page`/`pageSize`/`totalCount` rather than from the
 * rows in hand, so it stays honest when the last page is short. `busy` disables the steps during a
 * load — without it a double-click on Next skips a page, because the second click is against the
 * page number the server has not returned yet.
 *
 * Not shadcn's `Pagination`. That block is built for link pagination — `PaginationPrevious` renders
 * an `<a>` and expects an `href` — and this table pages by state, with the page number living in a
 * search param the page owns. Two `<Button>`s that can be `disabled` are the honest control; an
 * anchor with no href cannot be disabled, only ignored.
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
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{formatCount(first)}</span> to{" "}
        <span className="font-medium text-foreground">{formatCount(last)}</span> of{" "}
        <span className="font-medium text-foreground">{formatCount(totalCount)}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1 || busy}
          className="size-8 rounded-sm text-muted-foreground"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages || busy}
          className="size-8 rounded-sm text-muted-foreground"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </footer>
  );
}
