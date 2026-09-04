import { TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";

/**
 * The headline KPI row: four separate cards with the canvas showing between them.
 *
 * They used to be one card divided by hairlines, which was tidier but flatter — nothing on the
 * page had an icon and every tile was grey text on white. Splitting them gives each metric a
 * card edge of its own to hang a badge on, which is what makes the row scannable.
 */

export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

/**
 * Badge fills, keyed by name rather than passed as a class so a page cannot reach for a colour
 * Tailwind will not have compiled. All five are non-flipping and carry a white glyph — see the
 * `badge-*` tokens in src/app/globals.css for the contrast measurements.
 */
const TONES = {
  indigo: "bg-badge-indigo",
  violet: "bg-badge-violet",
  emerald: "bg-badge-emerald",
  cyan: "bg-badge-cyan",
  orange: "bg-badge-orange",
} as const;

export type StatTone = keyof typeof TONES;

interface StatTileProps {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: StatTone;
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
  icon: Icon,
  tone,
  hint,
  sub,
  change,
  unknown = false,
}: StatTileProps) {
  return (
    <div className="rounded-xl border border-border/80 bg-card p-4 sm:p-4.5 shadow-xs transition-all hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span className="truncate">{label}</span>
            {hint && <InfoHint text={hint} size={13} />}
          </p>

          {/* The measured change sits beside the number rather than under it: the two are read
              together, and stacking them pushed the card taller than the metric deserved. */}
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p
              className={cn(
                "text-2xl font-bold leading-none tracking-tight tabular-nums",
                unknown ? "text-faint" : "text-foreground",
              )}
            >
              {value}
            </p>
            {change && (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-semibold",
                  change.up ? "text-success-deep" : "text-danger-deep",
                )}
              >
                {change.up ? (
                  <TrendingUp size={12} aria-hidden="true" />
                ) : (
                  <TrendingDown size={12} aria-hidden="true" />
                )}
                {change.label}
              </span>
            )}
          </div>
        </div>

        <span
          aria-hidden="true"
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white shadow-xs",
            TONES[tone],
          )}
        >
          <Icon size={16} />
        </span>
      </div>

      {/* A measured change already won the slot beside the value, so this only restates what the
          tile counts when there is no change to show. */}
      {!change && sub && <p className="mt-2 truncate text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

