import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyCount } from "@/api/types";
import { formatCount, formatDayLong, formatDayShort } from "@/lib/format";

/**
 * A daily series. The API zero-fills every day in the range, so a flat stretch here means
 * "nothing happened on those days" and not "no data was returned" — which is why the
 * points are plotted as-is with no gap-filling or smoothing of our own.
 *
 * `date` is a reporting-local calendar string and is formatted as one. Handing it to
 * `new Date` would shift the axis a day in negative-offset browsers.
 */

interface DailyChartProps {
  data: DailyCount[];
  color?: string;
  gradientId: string;
  /** Singular noun for the tooltip, e.g. "signup". */
  unit: string;
}

interface TooltipEntry {
  value?: number;
  payload?: { date?: string };
}

function renderTooltip(props: unknown): ReactNode {
  const { active, payload } = (props ?? {}) as {
    active?: boolean;
    payload?: readonly TooltipEntry[];
  };
  const first = payload?.[0];
  if (!active || !first?.payload?.date) return null;

  return (
    <div className="rounded-sm border border-border bg-surface px-3 py-2 shadow-lift">
      <p className="text-xs font-semibold text-ink">{formatDayLong(first.payload.date)}</p>
      <p className="text-xs text-muted">{formatCount(first.value ?? 0)}</p>
    </div>
  );
}

export function DailyChart({ data, color = "#2563eb", gradientId, unit }: DailyChartProps) {
  // Every count is an integer, so a fractional tick would be meaningless.
  const max = Math.max(...data.map((d) => d.count), 0);
  const tickCount = Math.min(max + 1, 5);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eff3f9" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayShort}
            tick={{ fill: "#5d6d82", fontSize: 11 }}
            stroke="#e2e8f0"
            // A 90-day range would otherwise stack 90 labels on top of each other.
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            allowDecimals={false}
            tickCount={tickCount}
            tick={{ fill: "#5d6d82", fontSize: 11 }}
            stroke="#e2e8f0"
          />
          <Tooltip content={renderTooltip} />
          <Area
            type="monotone"
            dataKey="count"
            name={unit}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
