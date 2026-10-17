import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";

/**
 * The headline KPI row: plain tiles, each a label, one big tabular number, the change against the
 * previous window in green or red, and one quiet line saying what it counts. No colour on a tile
 * that is not carrying meaning, and nothing animates.
 */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>;
}

interface StatTileProps {
  label: string;
  /** The figure, already formatted. */
  value: string;
  /** A small monochrome glyph before the label. Optional: the label carries the meaning. */
  icon?: LucideIcon;
  /** What the number counts, in the reader's terms. Carried by the ⓘ beside the label. */
  hint?: string;
  /** The small line under the value. */
  sub?: string | null;
  change?: { label: string; up: boolean } | null;
  /** True when the API returned null, so the tile reads as unknown rather than as zero. */
  unknown?: boolean;
}

export function StatTile({ label, value, icon: Icon, hint, sub, change, unknown = false }: StatTileProps) {
  return (
    <div className="nf-panel p-5">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        {Icon && <Icon size={14} aria-hidden="true" className="shrink-0 text-faint" />}
        <span className="truncate">{label}</span>
        {hint && <InfoHint text={hint} />}
      </p>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p
          className={cn(
            "text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
            unknown ? "text-faint" : "text-foreground",
          )}
        >
          {value}
        </p>
        {change && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
              change.up ? "text-success-deep" : "text-danger-deep",
            )}
          >
            {change.up ? (
              <ArrowUpRight size={14} aria-hidden="true" />
            ) : (
              <ArrowDownRight size={14} aria-hidden="true" />
            )}
            {change.label}
          </span>
        )}
      </div>

      {sub && (
        <p className="mt-2 truncate text-xs text-muted-foreground" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}
