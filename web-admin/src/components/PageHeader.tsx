import type { ReactNode } from "react";

/**
 * A page's title block: heading, breadcrumb trail, and the controls that act on the whole
 * page. Every signed-in page opens with one of these so the pages share a top edge.
 */

interface PageHeaderProps {
  title: ReactNode;
  /** Trail shown under the title, outermost first, e.g. `["Dashboard", "Overview"]`. */
  breadcrumb: readonly string[];
  /** Pinned to the right of the title row — a range control, a search box. */
  actions?: ReactNode;
}

export function PageHeader({ title, breadcrumb, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          {title}
        </h1>
        <nav
          aria-label="Breadcrumb"
          className="mt-1.5 flex items-center gap-1.5 text-xs text-faint"
        >
          {breadcrumb.map((crumb, index) => (
            <span key={crumb} className="flex items-center gap-1.5">
              {index > 0 && <span aria-hidden="true">/</span>}
              <span className={index === breadcrumb.length - 1 ? "text-muted" : undefined}>
                {crumb}
              </span>
            </span>
          ))}
        </nav>
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
