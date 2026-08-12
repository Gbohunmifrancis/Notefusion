import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  /** Sits under the title in small muted type. Use it to say what the number means. */
  hint?: string;
  /** Rendered at the top right — a range control, a legend, a count. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The single surface primitive. Everything on a page sits in one of these. */
export function Card({ title, hint, action, className = "", children }: CardProps) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface p-5 shadow-card ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
