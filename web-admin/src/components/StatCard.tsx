import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";

/**
 * A single figure with a coloured spine — the tile the reference uses for the states of a
 * pipeline, where the colour carries the state and the meter carries the share.
 *
 * For the headline row of unrelated KPIs use `StatStrip` / `StatTile` instead; this one is
 * for a set of tiles that partition the same total.
 */

type Tone = "blue" | "success" | "warning" | "danger" | "neutral";

const TONES: Record<Tone, { spine: string; fill: string }> = {
  // `brand`, not `primary`: the spine and the meter are small marks read against the card,
  // and the other four tones brighten in dark mode. A fill-weight blue beside a bright
  // green would read as the odd one out rather than as the same kind of mark.
  blue: { spine: "bg-brand", fill: "bg-brand" },
  success: { spine: "bg-success", fill: "bg-success" },
  warning: { spine: "bg-warning", fill: "bg-warning" },
  danger: { spine: "bg-danger", fill: "bg-danger" },
  neutral: { spine: "bg-faint", fill: "bg-faint" },
};

interface StatCardProps {
  label: string;
  value: string;
  /** The small line under the value. */
  sub?: string;
  /** What the number counts, in the reader's terms. Carried by the ⓘ beside the label. */
  hint?: string;
  tone?: Tone;
  /** 0–1 share of the group's total, drawn as a meter. Null renders no meter. */
  share?: number | null;
  /** True when the API returned null, so the tile reads as unknown rather than as zero. */
  unknown?: boolean;
}

export function StatCard({
  label,
  value,
  sub,
  hint,
  tone = "blue",
  share = null,
  unknown = false,
}: StatCardProps) {
  const { spine, fill } = TONES[tone];

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-card py-4 pl-6 pr-5 shadow-hairline">
      <span
        aria-hidden="true"
        className={cn("absolute inset-y-4 left-0 w-[3px] rounded-r-pill", spine)}
      />

      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        {hint && <InfoHint text={hint} />}
      </p>

      <p
        className={cn(
          "mt-2 text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
          unknown ? "text-faint" : "text-foreground",
        )}
      >
        {value}
      </p>

      {sub && <p className="mt-2 truncate text-[11px] text-faint">{sub}</p>}

      {share !== null && (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-muted">
            <div
              className={cn("h-full rounded-pill", fill)}
              style={{ width: `${Math.min(Math.max(share, 0), 1) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">
            {(share * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  );
}
