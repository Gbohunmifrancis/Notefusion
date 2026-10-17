"use client";

import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card } from "@/components/Card";
import { Segmented } from "@/components/Segmented";
import { useChartPalette } from "@/lib/chart";
import { formatCount, formatDayLong, formatDayShort, formatPercent } from "@/lib/format";

/* Shared pieces for the Insights page and the overview's consolidated charts.
 *
 * Every chart: one axis, thin marks with rounded data-ends on the baseline, a 2px surface gap between
 * stacked segments, a legend whenever there are two or more series, a hover tooltip, and a Chart/Table
 * switch so nothing is read from colour alone. Colours come from `series5` in fixed order, so a series
 * keeps its colour when a filter changes what else is shown. */

export interface SeriesDef<K extends string> {
  key: K;
  label: string;
}

type View = "chart" | "table";
const VIEWS = [
  { value: "chart", label: "Chart" },
  { value: "table", label: "Table" },
] as const satisfies readonly { value: View; label: string }[];

/** A card with the Chart/Table switch, an optional extra control, and a legend for multi-series charts. */
export function ChartCard({
  title,
  info,
  hint,
  extra,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  info?: string;
  hint?: string;
  extra?: ReactNode;
  legend?: { label: string; color: string }[];
  table: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<View>("chart");
  return (
    <Card
      title={title}
      {...(info ? { info } : {})}
      {...(hint ? { hint } : {})}
      className={`h-full ${className ?? ""}`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {extra}
          <Segmented label={`${title}: chart or table`} options={VIEWS} value={view} onChange={setView} />
        </div>
      }
    >
      {view === "table" ? (
        <div className="max-h-80 overflow-auto">{table}</div>
      ) : (
        <>
          {legend && legend.length >= 2 && (
            <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
              {legend.map((l) => (
                <li key={l.label} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} aria-hidden="true" />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
          {children}
        </>
      )}
    </Card>
  );
}

/** A plain table for the Table view: first column the label, then one column per value. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="sticky top-0 bg-card text-muted-foreground">
        <tr>
          {head.map((h, i) => (
            <th key={h} className={`py-2 font-medium ${i > 0 ? "text-right" : ""}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={`py-1.5 ${j > 0 ? "text-right tabular-nums text-foreground" : "text-foreground"}`}>
                {typeof c === "number" ? formatCount(c) : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Daily stacked bars, one bar per local date. */
export function StackedDaily<K extends string>({
  data,
  series,
  unit,
}: {
  data: ({ date: string } & Record<K, number>)[];
  series: SeriesDef<K>[];
  unit: string;
}) {
  const c = useChartPalette();
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="date" tickFormatter={formatDayShort} stroke={c.tick} fontSize={11} tickLine={false} axisLine={{ stroke: c.axis }} minTickGap={18} />
          <YAxis stroke={c.tick} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: c.grid }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const total = payload.reduce((n, p) => n + Number(p.value ?? 0), 0);
              return (
                <div className="rounded-[8px] border border-border bg-popover px-3 py-2 text-[11px] shadow-md">
                  <p className="font-semibold text-foreground">{formatDayLong(String(label))}</p>
                  {[...payload].reverse().map((p) => (
                    <p key={String(p.dataKey)} className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
                      {series.find((s) => s.key === p.dataKey)?.label}: <span className="text-foreground">{formatCount(Number(p.value))}</span>
                    </p>
                  ))}
                  <p className="mt-1 text-foreground">
                    {formatCount(total)} {unit}
                  </p>
                </div>
              );
            }}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={c.series5[i % c.series5.length]}
              stroke={c.surface}
              strokeWidth={series.length > 1 ? 2 : 0}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bars for a ranked list: label, bar, count and share. Keyboard- and hover-readable. */
export function RankedBars({
  rows,
  colorIndex = 0,
  total,
  empty = "Nothing here yet",
}: {
  rows: { label: string; count: number; note?: string | undefined }[];
  colorIndex?: number;
  total?: number;
  empty?: string;
}) {
  const c = useChartPalette();
  const sum = total ?? rows.reduce((n, r) => n + r.count, 0);
  const top = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-xs" title={`${r.label}: ${formatCount(r.count)}${sum ? ` (${formatPercent(r.count / sum, 0)})` : ""}`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-foreground">{r.label}</span>
            <span className="shrink-0 tabular-nums text-foreground">
              {formatCount(r.count)}
              <span className="ml-2 text-muted-foreground">{r.note ?? (sum ? formatPercent(r.count / sum, 0) : "")}</span>
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full" style={{ width: `${(r.count / top) * 100}%`, background: c.series5[colorIndex % c.series5.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A funnel: each step's count as a bar, with the share of the first step and of the step before. */
export function FunnelBars({ steps }: { steps: { step: string; count: number; hint?: string }[] }) {
  const c = useChartPalette();
  const first = steps[0]?.count ?? 0;
  if (first === 0) return <p className="py-8 text-center text-xs text-muted-foreground">No one entered the funnel in this window</p>;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i === 0 ? s.count : steps[i - 1]!.count;
        return (
          <li key={s.step} className="text-xs" title={s.hint ?? s.step}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-foreground">{s.step}</span>
              <span className="shrink-0 tabular-nums text-foreground">
                {formatCount(s.count)}
                <span className="ml-2 text-muted-foreground">
                  {formatPercent(s.count / first, 0)}
                  {i > 0 && prev > 0 && ` · ${formatPercent(s.count / prev, 0)} of previous`}
                </span>
              </span>
            </div>
            <div className="mt-1 h-3 rounded-sm bg-muted">
              <div className="h-3 rounded-sm" style={{ width: `${Math.max(0.5, (s.count / first) * 100)}%`, background: c.series5[0] }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Magnitude cells on the one-hue ramp, light to dark; the count is in the tooltip and the table view. */
export function rampColor(ramp: readonly string[], value: number, max: number): string {
  if (max <= 0 || value <= 0) return ramp[0]!;
  const i = Math.min(ramp.length - 1, 1 + Math.floor((value / max) * (ramp.length - 1)));
  return ramp[i]!;
}

/**
 * Several numbers in one card, side by side, instead of a card each: a row of figures reads as one
 * thing, and the page stops being a field of tiles. Each figure keeps its own hint on hover.
 */
export function MetricRow({
  items,
  className,
}: {
  items: { label: string; value: string; note?: string | null | undefined; hint?: string | undefined; tone?: "up" | "down" | undefined }[];
  className?: string;
}) {
  return (
    // The cells draw their own right and bottom rules; the inner grid is pulled 1px past the
    // panel's edge so the last column and row do not double the panel's hairline.
    <div className={`nf-panel overflow-hidden ${className ?? ""}`}>
      <div className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3">
        {items.map((m) => (
          <div key={m.label} className="border-b border-r border-border p-4" title={m.hint}>
            <div className="text-xs text-muted-foreground">{m.label}</div>
            <div className="mt-1.5 text-xl font-semibold tracking-[-0.01em] text-foreground tabular-nums">{m.value}</div>
            {m.note && (
              <div
                className={`mt-1 text-xs ${
                  m.tone === "up" ? "text-success-deep" : m.tone === "down" ? "text-danger-deep" : "text-muted-foreground"
                }`}
              >
                {m.note}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
