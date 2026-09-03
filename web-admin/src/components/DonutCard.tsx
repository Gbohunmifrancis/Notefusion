"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { InfoHint } from "@/components/InfoHint";
import { EmptyView } from "@/components/StateView";
import { formatCount } from "@/lib/format";

/**
 * A composition as a ring with the total in the middle and a legend beside it. Meant to
 * sit inside a `Card`, which owns the title and the header control.
 *
 * A ring earns its place here where a bar list would not: these slices are parts of one
 * whole, so the total in the centre is the point, and there are never more than four of
 * them. For an open-ended list of categories use `BreakdownList` instead.
 */

export interface DonutSlice {
  label: string;
  /** Drives the arc. Zero-value slices keep their legend row but draw no segment. */
  value: number;
  color: string;
  /** Overrides the legend figure when the raw count is not the thing to read. */
  display?: string;
  hint?: string;
}

interface DonutCardProps {
  slices: readonly DonutSlice[];
  /** Caption above the centre figure, e.g. "Reached an end state". */
  centerLabel: string;
  centerValue: string;
  /** Give each legend row a share meter, as the reference's donut cards do. */
  meters?: boolean;
  emptyMessage: string;
}

export function DonutCard({
  slices,
  centerLabel,
  centerValue,
  meters = false,
  emptyMessage,
}: DonutCardProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  // An all-zero ring is a full circle of nothing, which reads as missing data rather than
  // as an empty set. Say it in words instead.
  if (total === 0) return <EmptyView message={emptyMessage} />;

  const drawn = slices.filter((slice) => slice.value > 0);

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="relative h-[172px] w-[172px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={drawn}
              dataKey="value"
              nameKey="label"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              cornerRadius={6}
              stroke="none"
              isAnimationActive={false}
            >
              {drawn.map((slice) => (
                <Cell key={slice.label} fill={slice.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/*
         * The centre block is sized to the hole, not to the chart. `inset-0` centres it correctly
         * but leaves it 172px wide — the width of the whole ring — so a caption longer than the
         * hole laid itself out on one line and ran underneath the segments, which is how
         * "Reached an end state" came to render with its first and last letters buried in the
         * green. The hole is 110px across (innerRadius 55), and the widest box that fits inside a
         * circle is its inscribed square, 110/√2 ≈ 78px.
         *
         * Wrapping then does the work, and `line-clamp-2` is the backstop: a caption too long for
         * two lines truncates inside the hole instead of escaping it again.
         */}
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
          <div className="w-[78px] text-center">
            <p className="line-clamp-2 text-[10px] leading-[1.25] text-muted-foreground">
              {centerLabel}
            </p>
            <p className="mt-1 text-xl font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
              {centerValue}
            </p>
          </div>
        </div>
      </div>

      <ul className="w-full min-w-0 space-y-3.5">
        {slices.map((slice) => (
          <li key={slice.label}>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="truncate text-muted-foreground">{slice.label}</span>
                {slice.hint && <InfoHint text={slice.hint} size={11} />}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-foreground">
                {slice.display ?? formatCount(slice.value)}
              </span>
            </div>

            {meters && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-muted">
                <div
                  className="h-full rounded-pill"
                  style={{
                    width: `${(slice.value / total) * 100}%`,
                    backgroundColor: slice.color,
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
