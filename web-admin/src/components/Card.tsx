import type { ReactNode } from "react";

import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";

interface CardProps {
  title?: string;
  /** Sits under the title in small muted type. Use it for a caveat that must be read. */
  hint?: string;
  /** A longer explanation, tucked behind an ⓘ beside the title. */
  info?: string;
  /** Rendered at the top right — a grouping toggle, a range control, a count. */
  action?: ReactNode;
  /** Drop the body's padding so a table can reach the card's edges. */
  bleed?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The single surface primitive. Everything on a page sits in one of these.
 *
 * It wears `.nf-panel` (src/app/globals.css): the card fill, a 1px hairline and a 10px corner,
 * so every page's cards share one quiet surface without each page restyling them.
 *
 * Not built on shadcn's `Card`. That one is a five-part composition (`CardHeader`,
 * `CardTitle`, `CardAction`, …) whose own `py-6`/`gap-6` rhythm would have to be overridden
 * at every call site to reach this padding, and its title slot has nowhere to put the ⓘ. This
 * component's whole value is that a page says `<Card title hint info action>` and gets the
 * arrangement for free.
 */
export function Card({
  title,
  hint,
  info,
  action,
  bleed = false,
  className,
  children,
}: CardProps) {
  const hasHeader = Boolean(title || action);
  const body = bleed ? undefined : hasHeader ? "px-5 pb-5 pt-1" : "p-5";

  return (
    // `min-w-0`: as a grid item a card would otherwise refuse to shrink below the min-content
    // width of its own nowrap text, widening the track and scrolling the page sideways on a
    // phone. It is inert for a card that is not a grid or flex item.
    <section
      className={cn(
        "nf-panel overflow-hidden",
        className
      )}
    >
      {hasHeader && (
        <header
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4",
            bleed && "border-b border-border"
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <span className="truncate">{title}</span>
                {info && <InfoHint text={info} />}
              </h2>
            )}
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={body}>{children}</div>
    </section>
  );
}

