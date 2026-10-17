import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * One section of a long analytics page (Practice, Growth): a hairline, the heading, the line that says what the
 * section answers, and its own control on the right. The id is the in-page jump target, offset so the sticky top
 * bar does not cover the heading.
 */
export function Section({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 space-y-4 border-t border-border pt-6", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-base font-semibold tracking-[-0.01em] text-foreground">
            {title}
          </h2>
          {description && <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The page's sections as a row of quiet jump links under the header. Scrolls sideways on a phone rather than wrapping. */
export function SectionNav({ sections }: { sections: readonly { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="-mx-1 overflow-x-auto">
      <ul className="flex w-max gap-1 px-1">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="inline-flex h-7 items-center rounded-[6px] px-2.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border transition-colors hover:bg-accent hover:text-foreground"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The one line under a chart that says what it means. */
export function Takeaway({ children }: { children: ReactNode }) {
  return <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">{children}</p>;
}

/**
 * A share drawn as a thin meter on a fixed 0–100% track, with the figure beside it: for rates in a table, where
 * bars must be comparable down the column. Null renders an em dash and no bar.
 */
export function RateMeter({ value, color, digits = 0 }: { value: number | null; color: string; digits?: number }) {
  if (value == null) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex w-full min-w-[5.5rem] items-center justify-end gap-2">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%`, background: color }} />
      </span>
      <span className="w-10 text-right tabular-nums text-foreground">{(value * 100).toFixed(digits)}%</span>
    </span>
  );
}
