import { Info, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The headline KPI row: one card whose cells are separated by hairlines rather than four
 * cards with gaps between them.
 *
 * The dividers are the parent's background showing through a 1px grid gap, which keeps
 * them exactly one device pixel at any zoom and needs no per-cell border to reset at the
 * ends of each wrapped row.
 */

export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border-light shadow-hairline sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  /** What the number counts, in the reader's terms. Carried by the ⓘ beside the label. */
  hint?: string;
  /** The small line under the value. */
  sub?: string;
  change?: { label: string; up: boolean } | null;
  /** True when the API returned null, so the tile reads as unknown rather than as zero. */
  unknown?: boolean;
}

export function StatTile({
  label,
  value,
  hint,
  sub,
  change,
  unknown = false,
}: StatTileProps) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className="truncate">{label}</span>
        {hint && (
          <span title={hint} className="shrink-0 cursor-help text-faint">
            <Info size={12} aria-hidden="true" />
            <span className="sr-only">{hint}</span>
          </span>
        )}
      </p>

      <p
        className={`mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${
          unknown ? "text-faint" : "text-ink"
        }`}
      >
        {value}
      </p>

      {/* A measured change beats a restatement of what the tile counts, so it wins the slot. */}
      {change ? (
        <p
          className={`mt-2.5 flex items-center gap-1 text-[11px] font-semibold ${
            change.up ? "text-success-deep" : "text-danger-deep"
          }`}
        >
          {change.up ? (
            <TrendingUp size={12} aria-hidden="true" />
          ) : (
            <TrendingDown size={12} aria-hidden="true" />
          )}
          {change.label}
        </p>
      ) : (
        sub && <p className="mt-2.5 truncate text-[11px] text-faint">{sub}</p>
      )}
    </div>
  );
}
