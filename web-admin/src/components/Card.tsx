import { Info } from "lucide-react";
import type { ReactNode } from "react";

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
 * Border-first: the hairline does the separating and the shadow only lifts the card off
 * the canvas, so a page of twelve cards does not read as twelve floating objects.
 */
export function Card({
  title,
  hint,
  info,
  action,
  bleed = false,
  className = "",
  children,
}: CardProps) {
  const hasHeader = Boolean(title || action);
  const body = bleed ? "" : hasHeader ? "px-5 pb-5" : "p-5";

  return (
    // `min-w-0`: as a grid item a card would otherwise refuse to shrink below the min-content
    // width of its own nowrap text, widening the track and scrolling the page sideways on a
    // phone. It is inert for a card that is not a grid or flex item.
    <section
      className={`min-w-0 rounded-md border border-border bg-surface shadow-hairline ${className}`}
    >
      {hasHeader && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 pb-4 pt-5">
          <div className="min-w-0">
            {title && (
              <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">
                <span className="truncate">{title}</span>
                {info && (
                  <span title={info} className="shrink-0 cursor-help text-faint">
                    <Info size={13} aria-hidden="true" />
                    <span className="sr-only">{info}</span>
                  </span>
                )}
              </h2>
            )}
            {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={body}>{children}</div>
    </section>
  );
}
