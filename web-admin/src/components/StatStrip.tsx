"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";

/**
 * The headline KPI row: chunky tiles, each with a coloured icon chip, an uppercase label, a big
 * number and one line saying what it counts. The tiles rise in one after another on first paint
 * (`.nf-stagger`); nothing moves for someone who asked for reduced motion.
 */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("nf-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>
  );
}

/**
 * Chip fills, keyed by name rather than passed as a class so a page cannot reach for a colour
 * Tailwind will not have compiled. All but amber carry a white glyph — see the `badge-*` tokens
 * in src/app/globals.css for the contrast measurements; amber carries the dark premium ink.
 * The glow under each chip is its own colour, which is most of what makes the row read as lit.
 */
const TONES = {
  blue: "bg-badge-blue text-white shadow-badge-blue/45",
  indigo: "bg-badge-indigo text-white shadow-badge-indigo/45",
  violet: "bg-badge-violet text-white shadow-badge-violet/45",
  emerald: "bg-badge-emerald text-white shadow-badge-emerald/45",
  cyan: "bg-badge-cyan text-white shadow-badge-cyan/45",
  orange: "bg-badge-orange text-white shadow-badge-orange/45",
  rose: "bg-badge-rose text-white shadow-badge-rose/45",
  amber: "bg-badge-amber text-premium-ink shadow-badge-amber/40",
} as const;

export type StatTone = keyof typeof TONES;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Counts from the number on screen to `target` over `duration` ms, easing out. Returns the target
 * at once when motion is reduced or there is nothing to count. Cheap: one rAF loop per tile, only
 * while it is moving.
 */
function useCountUp(target: number | undefined, duration = 900): number | undefined {
  const [shown, setShown] = useState<number | undefined>(() =>
    target === undefined || prefersReducedMotion() ? target : 0,
  );
  const from = useRef(shown ?? 0);

  useEffect(() => {
    if (target === undefined) return;
    if (prefersReducedMotion()) {
      setShown(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const value = Math.round(origin + (target - origin) * eased);
      from.current = value;
      setShown(value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return shown;
}

interface StatTileProps {
  label: string;
  /** The figure as it should finally read, already formatted. */
  value: string;
  icon: LucideIcon;
  tone: StatTone;
  /** What the number counts, in the reader's terms. Carried by the ⓘ beside the label. */
  hint?: string;
  /** The small line under the value. */
  sub?: string | null;
  change?: { label: string; up: boolean } | null;
  /** True when the API returned null, so the tile reads as unknown rather than as zero. */
  unknown?: boolean;
  /**
   * The raw number behind `value`, to count up to on first paint; `format` writes the
   * in-between figures. Omit both and the value is simply shown.
   */
  count?: number;
  format?: (n: number) => string;
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
  count,
  format,
}: StatTileProps) {
  const counted = useCountUp(format ? count : undefined);
  const display = counted !== undefined && format && counted !== count ? format(counted) : value;

  return (
    <div className="nf-panel nf-panel-hover flex items-center gap-4 p-4 sm:p-5">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-12 shrink-0 place-items-center rounded-[14px] bg-linear-to-br from-white/25 to-transparent shadow-lg ring-1 ring-white/15 ring-inset",
          TONES[tone],
        )}
      >
        <Icon size={22} strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <span className="truncate">{label}</span>
          {hint && <InfoHint text={hint} size={13} />}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={cn(
              "text-[28px] font-extrabold leading-none tracking-[-0.03em] tabular-nums",
              unknown ? "text-faint" : "text-foreground",
            )}
          >
            {/* The moving figure is for the eye; a screen reader is given the settled one. */}
            <span aria-hidden="true">{display}</span>
            <span className="sr-only">{value}</span>
          </p>
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5 text-[11px] font-semibold",
                change.up ? "bg-success/12 text-success-deep" : "bg-danger/12 text-danger-deep",
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

        {sub && <p className="mt-1.5 truncate text-xs text-muted-foreground" title={sub}>{sub}</p>}
      </div>
    </div>
  );
}
