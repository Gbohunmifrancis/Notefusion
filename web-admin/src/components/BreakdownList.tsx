import type { CategoryCount } from "@/api/types";
import { formatCount } from "@/lib/format";

/**
 * A categorical breakdown as one bordered row per category, label left and figure right.
 *
 * Deliberately not a pie: this list is open-ended (device platforms, transcribed keys), and
 * comparing eight slices by angle is guesswork. Where the categories genuinely partition one
 * total and there are only a few of them, `DonutCard` is the right shape instead.
 */

interface BreakdownListProps {
  data: CategoryCount[];
}

export function BreakdownList({ data }: BreakdownListProps) {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  return (
    <ul className="space-y-2">
      {data.map((row) => {
        // Share of the total, not of the largest row: the percentages add to 100.
        const share = total === 0 ? 0 : row.count / total;
        return (
          <li
            key={row.label}
            className="flex items-center justify-between gap-3 rounded-sm border border-border-light px-3.5 py-3"
          >
            <span className="truncate text-[13px] text-muted" title={row.label}>
              {row.label}
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="text-[13px] font-semibold text-ink">
                {formatCount(row.count)}
              </span>
              <span className="ml-2 text-[11px] text-faint">{(share * 100).toFixed(0)}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
