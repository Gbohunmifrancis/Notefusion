import { Fragment, type ReactNode } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * A page's title block: heading, breadcrumb trail, and the controls that act on the whole
 * page. Every signed-in page opens with one of these so the pages share a top edge.
 */

interface PageHeaderProps {
  title: ReactNode;
  /** One line under the title saying what the page is for. */
  subtitle?: string;
  /** Trail shown under the title, outermost first, e.g. `["Dashboard", "Overview"]`. */
  breadcrumb: readonly string[];
  /** Pinned to the right of the title row — a range control, a search box. */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumb, actions }: PageHeaderProps) {
  const last = breadcrumb.length - 1;

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {/* The trail sits above the title: where you are, small and quiet, then what this page is. */}
        {/*
          No crumb is a link. The trail says where the page sits in the console rather than
          offering a way back up — "Dashboard / Overview" has no "Dashboard" page to visit — and
          a crumb that looks clickable but is not is worse than plain text. Only the final crumb
          gets `BreadcrumbPage`, which carries `aria-current="page"`; putting that on all of them
          would announce several current pages.
        */}
        <Breadcrumb>
          <BreadcrumbList className="gap-1.5 text-xs text-muted-foreground sm:gap-1.5">
            {breadcrumb.map((crumb, index) => (
              <Fragment key={crumb}>
                {index > 0 && <BreadcrumbSeparator className="text-faint">/</BreadcrumbSeparator>}
                <BreadcrumbItem>
                  {index === last ? (
                    <BreadcrumbPage className="text-muted-foreground">{crumb}</BreadcrumbPage>
                  ) : (
                    crumb
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
