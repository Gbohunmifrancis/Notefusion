import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  /** What the number counts, in the reader's terms. Ambiguous metrics get misread. */
  hint?: string;
  icon: LucideIcon;
  change?: { label: string; up: boolean } | null;
  /** True when the API returned null, so the tile reads as unknown rather than empty. */
  unknown?: boolean;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  change,
  unknown = false,
}: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-alt text-blue">
          <Icon size={18} strokeWidth={2} aria-hidden="true" />
        </span>
      </div>

      <p
        className={`mt-3 text-3xl font-semibold tabular-nums ${
          unknown ? "text-faint" : "text-ink"
        }`}
      >
        {value}
      </p>

      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}

      {change && (
        <p
          className={`mt-3 flex items-center gap-1 text-xs font-medium ${
            change.up ? "text-success" : "text-danger"
          }`}
        >
          {change.up ? (
            <TrendingUp size={14} aria-hidden="true" />
          ) : (
            <TrendingDown size={14} aria-hidden="true" />
          )}
          {change.label}
        </p>
      )}
    </div>
  );
}
