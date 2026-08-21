import { useState } from "react";
import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DailyCount } from "@/api/types";
import { Card } from "@/components/Card";
import { Segmented } from "@/components/Segmented";
import {
  formatCount,
  formatDayLong,
  formatDayShort,
  formatMonthShort,
  formatMonthYear,
} from "@/lib/format";
import { useTheme } from "@/lib/theme";

/**
 * A daily series as bars, with a grey full-height ghost behind each one so the plot reads as
 * a row of gauges rather than as a set of floating marks.
 *
 * The API zero-fills every day in the range, so a missing bar means "nothing happened that
 * day" and not "no data was returned" — the points are plotted as-is, with no gap-filling or
 * smoothing of our own. `date` is a reporting-local calendar string and is formatted as one;
 * handing it to `new Date` would shift the axis a day in negative-offset browsers.
 *
 * Grouping is Day / Week / Month, and an option is disabled rather than hidden when the
 * window is too short to make more than one bar out of it.
 */

type Bucket = "day" | "week" | "month";

interface Group {
  /** The first calendar date in the group. Doubles as the x-axis key. */
  key: string;
  label: string;
  /** The heading in the tooltip, where there is room to name the whole span. */
  title: string;
  count: number;
}

/**
 * Weeks are consecutive seven-day blocks anchored at the start of the window, not ISO weeks:
 * the admin asked for this window, so the blocks should line up with it. The final block is
 * short whenever the range is not a multiple of seven, and its tooltip names its real span.
 */
function groupIntoWeeks(data: DailyCount[]): Group[] {
  const groups: Group[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const block = data.slice(i, i + 7);
    const first = block[0];
    const last = block[block.length - 1];
    if (!first || !last) continue;
    groups.push({
      key: first.date,
      label: formatDayShort(first.date),
      title:
        first.date === last.date
          ? formatDayLong(first.date)
          : `${formatDayShort(first.date)} – ${formatDayLong(last.date)}`,
      count: block.reduce((sum, day) => sum + day.count, 0),
    });
  }
  return groups;
}

/** The series arrives ordered by date, so a month closes as soon as the prefix changes. */
function groupIntoMonths(data: DailyCount[]): Group[] {
  const groups: Group[] = [];
  for (const day of data) {
    const open = groups[groups.length - 1];
    if (open && open.key.slice(0, 7) === day.date.slice(0, 7)) {
      open.count += day.count;
    } else {
      groups.push({
        key: day.date,
        label: formatMonthShort(day.date),
        title: formatMonthYear(day.date),
        count: day.count,
      });
    }
  }
  return groups;
}

const groupIntoDays = (data: DailyCount[]): Group[] =>
  data.map((day) => ({
    key: day.date,
    label: formatDayShort(day.date),
    title: formatDayLong(day.date),
    count: day.count,
  }));

interface TooltipEntry {
  payload?: Partial<Group>;
}

function tooltip(unit: string, color: string) {
  return function render(props: unknown): ReactNode {
    const { active, payload } = (props ?? {}) as {
      active?: boolean;
      payload?: readonly TooltipEntry[];
    };
    const group = payload?.[0]?.payload;
    if (!active || !group?.title) return null;

    return (
      <div className="rounded-sm border border-border bg-surface px-3 py-2 shadow-lift">
        <p className="text-[11px] font-semibold text-ink">{group.title}</p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          {formatCount(group.count ?? 0)} {unit}
        </p>
      </div>
    );
  };
}

interface DailyChartProps {
  title: string;
  /** The caveat behind the ⓘ beside the title. */
  info?: string;
  data: DailyCount[];
  /** Plural noun for the tooltip, e.g. "signups". */
  unit: string;
  /** Bar colour. Defaults to the theme's series colour; pass one from `useTheme().chart`. */
  color?: string;
  className?: string;
}

export function DailyChart({
  title,
  info,
  data,
  unit,
  color,
  className = "",
}: DailyChartProps) {
  const { chart } = useTheme();
  const [chosen, setChosen] = useState<Bucket>("day");

  const fill = color ?? chart.series;

  const weeks = groupIntoWeeks(data);
  const months = groupIntoMonths(data);

  // A single bar is not a chart, so a grouping that collapses the window to one is offered
  // but disabled, with the reason on hover. Falling back to days rather than storing the
  // correction keeps the admin's choice intact if they widen the range again.
  const options: readonly { value: Bucket; label: string; disabledReason?: string }[] = [
    { value: "day", label: "Day" },
    {
      value: "week",
      label: "Week",
      ...(weeks.length < 2 ? { disabledReason: "The window is under two weeks long" } : {}),
    },
    {
      value: "month",
      label: "Month",
      ...(months.length < 2 ? { disabledReason: "The window sits inside one month" } : {}),
    },
  ];

  const bucket: Bucket =
    (chosen === "week" && weeks.length < 2) || (chosen === "month" && months.length < 2)
      ? "day"
      : chosen;

  const groups =
    bucket === "week" ? weeks : bucket === "month" ? months : groupIntoDays(data);

  // Every count is an integer, so a fractional tick would be meaningless.
  const max = Math.max(...groups.map((group) => group.count), 0);

  return (
    <Card
      title={title}
      {...(info ? { info } : {})}
      className={className}
      action={
        <Segmented<Bucket>
          label="Chart grouping"
          options={options}
          value={bucket}
          onChange={setChosen}
        />
      }
    >
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={groups} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={chart.grid} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: chart.tick, fontSize: 11 }}
              stroke={chart.axis}
              tickLine={false}
              // A 90-day range would otherwise stack 90 labels on top of each other.
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              allowDecimals={false}
              tickCount={Math.min(max + 1, 5)}
              tick={{ fill: chart.tick, fontSize: 11 }}
              stroke={chart.axis}
              tickLine={false}
            />
            {/* The ghost bar is already the hover affordance, so recharts' grey cursor band
                on top of it would just muddy the column. */}
            <Tooltip content={tooltip(unit, fill)} cursor={false} />
            <Bar
              dataKey="count"
              name={unit}
              fill={fill}
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              background={{ fill: chart.track, radius: 4 }}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
