import type { CategoryCount } from "@/api/types";
import { formatCount } from "@/lib/format";

/**
 * A categorical breakdown as a labelled bar list rather than a pie. Three or four slices
 * of similar size are hard to compare by angle and trivial to compare by bar length, and
 * the raw count stays visible next to the share.
 */

interface BreakdownListProps {
  data: CategoryCount[];
  color?: string;
}

export function BreakdownList({ data, color = "#2563eb" }: BreakdownListProps) {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  return (
    <ul className="space-y-3">
      {data.map((row) => {
        // Share of the total, not of the largest bar: the numbers add to 100%.
        const share = total === 0 ? 0 : row.count / total;
        return (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-medium text-ink" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {formatCount(row.count)}
                <span className="ml-2 text-xs text-faint">
                  {(share * 100).toFixed(0)}%
                </span>
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-pill bg-surface-alt">
              <div
                className="h-full rounded-pill transition-[width] duration-500"
                style={{ width: `${Math.max(share * 100, 1.5)}%`, backgroundColor: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
