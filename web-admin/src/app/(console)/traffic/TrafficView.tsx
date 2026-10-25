"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  getTraffic,
  getTrafficLive,
  type Traffic,
  type TrafficFilterKey,
  type TrafficFilters,
  type TrafficRow,
} from "@/api/traffic";
import { Card } from "@/components/Card";
import { DataTable } from "@/components/insights/Charts";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { useChartPalette } from "@/lib/chart";
import { addDays, changeAgainst, formatCount, formatDayLong, formatDayShort, formatPercent, reportingToday } from "@/lib/format";

/* Traffic: the website's and the web app's visits from the site's own tracker (assets/track.js), customers only.
 * Every list is a filter: click a row and the whole page reads only the visits that match it. */

const FILTER_LABELS: Record<TrafficFilterKey, string> = {
  page: "Viewed",
  entry: "Entered on",
  exit: "Left from",
  source: "Came from",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  ref: "ref",
  country: "Country",
  browser: "Browser",
  os: "System",
  device: "Screen",
};

const REGIONS = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  const flag = String.fromCodePoint(...[...code].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));
  let name = code;
  try {
    name = REGIONS?.of(code) ?? code;
  } catch {
    // An unknown code throws; show the letters.
  }
  return `${flag} ${name}`;
}

function shown(key: TrafficFilterKey, value: string): string {
  return key === "country" ? countryName(value) : value;
}

function seconds(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

/** "2026-08-11T11:00:00" → "11 Aug" or "11:00"; the server sends reporting-local times without a zone. */
function pointLabel(at: string, hourly: boolean): string {
  return hourly ? at.slice(11, 16) : formatDayShort(at.slice(0, 10));
}

function Kpi({
  label,
  value,
  current,
  previous,
  lowerIsBetter = false,
  hint,
}: {
  label: string;
  value: string;
  current: number | null;
  previous: number | null;
  lowerIsBetter?: boolean;
  hint: string;
}) {
  const change = current != null && previous != null ? changeAgainst(current, previous) : null;
  const good = change ? change.up !== lowerIsBetter : false;
  return (
    <div className="nf-panel p-4" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
      {change && (
        <div className={`mt-1 inline-flex items-center gap-1 text-[11px] ${good ? "text-success" : "text-muted-foreground"}`}>
          {change.up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
          {change.label}
        </div>
      )}
    </div>
  );
}

export function TrafficView() {
  const [range, setRange] = useState<Range | null>(null);
  const [filters, setFilters] = useState<TrafficFilters>({});
  const state = useQuery({
    queryKey: ["traffic", range?.from, range?.to, filters],
    queryFn: ({ signal }) => getTraffic(range?.from, range?.to, filters, signal),
    placeholderData: keepPreviousData,
  });
  const live = useQuery({
    queryKey: ["traffic-live"],
    queryFn: ({ signal }) => getTrafficLive(signal),
    refetchInterval: 30_000,
  });

  const offset = state.data?.reportingOffsetMinutes ?? 60;
  const picker: Range = range ?? { from: addDays(reportingToday(offset), -29), to: reportingToday(offset) };
  const active = Object.entries(filters) as [TrafficFilterKey, string][];
  const pick = (key: TrafficFilterKey, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const drop = (key: TrafficFilterKey) =>
    setFilters((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Traffic"
        subtitle="Visits to the website and the web app, where they came from and what they did. Click any row to filter by it."
        breadcrumb={["Dashboard", "Traffic"]}
      />
      <div className="nf-panel flex flex-wrap items-center gap-3 p-3">
        <RangePicker value={picker} offsetMinutes={offset} onChange={setRange} />
        {live.data && (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" title={`Browsers with something sent in the last ${live.data.minutes} minutes`}>
            <span className="relative flex size-2.5" aria-hidden>
              {live.data.visitors > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
              <span className={`relative inline-flex size-2.5 rounded-full ${live.data.visitors > 0 ? "bg-success" : "bg-faint"}`} />
            </span>
            <span className="text-foreground tabular-nums">{formatCount(live.data.visitors)}</span> on the site now
          </span>
        )}
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filters">
          {active.map(([key, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => drop(key)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs text-foreground hover:bg-sidebar-accent"
              aria-label={`Remove filter ${FILTER_LABELS[key]} ${value}`}
            >
              <span className="text-muted-foreground">{FILTER_LABELS[key]}</span> {shown(key, value)}
              <X className="size-3.5" aria-hidden />
            </button>
          ))}
          <button type="button" onClick={() => setFilters({})} className="min-h-8 px-2 text-xs text-muted-foreground underline">
            Clear all
          </button>
        </div>
      )}
      <StateView state={state} loadingLabel="Loading traffic">
        {(d) => <TrafficBody d={d} live={live.data?.pages ?? []} onPick={pick} />}
      </StateView>
    </div>
  );
}

function TrafficBody({ d, live, onPick }: { d: Traffic; live: TrafficRow[]; onPick: (key: TrafficFilterKey, value: string) => void }) {
  const s = d.summary;
  const c = useChartPalette();
  const [metric, setMetric] = useState<"visitors" | "pageviews">("visitors");
  const series = d.series.map((p) => ({ ...p, label: pointLabel(p.at, d.hourly) }));

  return (
    <div className="space-y-5">
      {d.truncated && (
        <p className="nf-panel p-3 text-xs text-muted-foreground">
          This window holds more events than one read takes, so the figures cover its most recent part. Pick a shorter window for the whole of it.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Visitors" value={formatCount(s.visitors)} current={s.visitors} previous={s.visitorsPrevious} hint="Distinct browsers that viewed a page" />
        <Kpi label="Visits" value={formatCount(s.visits)} current={s.visits} previous={s.visitsPrevious} hint="Tab sessions that viewed a page" />
        <Kpi label="Page views" value={formatCount(s.pageviews)} current={s.pageviews} previous={s.pageviewsPrevious} hint="Pages viewed" />
        <Kpi
          label="Views per visit"
          value={s.viewsPerVisit == null ? "—" : s.viewsPerVisit.toFixed(1)}
          current={s.viewsPerVisit}
          previous={s.viewsPerVisitPrevious}
          hint="Page views over visits"
        />
        <Kpi
          label="Bounce rate"
          value={formatPercent(s.bounceRate, 0)}
          current={s.bounceRate == null ? null : s.bounceRate * 100}
          previous={s.bounceRatePrevious == null ? null : s.bounceRatePrevious * 100}
          lowerIsBetter
          hint="Visits that viewed one page and clicked or did nothing"
        />
        <Kpi
          label="Visit length"
          value={seconds(s.avgVisitSeconds)}
          current={s.avgVisitSeconds}
          previous={s.avgVisitSecondsPrevious}
          hint="Mean time from a visit's first event to its last (a one-page visit with nothing else counts as 0 s)"
        />
      </div>

      <Card
        title={d.hourly ? "By the hour" : "By the day"}
        info="Times are West Africa Time, as everywhere in the console."
        action={
          <Segmented
            label="Chart"
            options={[
              { value: "visitors", label: "Visitors" },
              { value: "pageviews", label: "Page views" },
            ]}
            value={metric}
            onChange={setMetric}
          />
        }
      >
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="label" stroke={c.tick} fontSize={11} tickLine={false} axisLine={{ stroke: c.axis }} minTickGap={18} />
              <YAxis stroke={c.tick} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                content={({ active, payload }) => {
                  const p = active ? (payload?.[0]?.payload as (typeof series)[number] | undefined) : undefined;
                  if (!p) return null;
                  return (
                    <div className="rounded-[8px] border border-border bg-popover px-3 py-2 text-[11px] shadow-md">
                      <p className="font-semibold text-foreground">{d.hourly ? `${formatDayLong(p.at.slice(0, 10))}, ${p.label}` : formatDayLong(p.at.slice(0, 10))}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        Visitors: <span className="text-foreground">{formatCount(p.visitors)}</span>
                      </p>
                      <p className="text-muted-foreground">
                        Page views: <span className="text-foreground">{formatCount(p.pageviews)}</span>
                      </p>
                    </div>
                  );
                }}
              />
              <Line type="monotone" dataKey={metric} stroke={c.series} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown
          title="Sources"
          info="Where each visit came from: the site that sent it (none = Direct), and the tags on the link it came in on. A visit counts under the first it sent."
          tabs={[
            { value: "source", label: "Sites", rows: d.sources },
            { value: "utmSource", label: "Source", rows: d.utmSources },
            { value: "utmMedium", label: "Medium", rows: d.utmMediums },
            { value: "utmCampaign", label: "Campaign", rows: d.utmCampaigns },
            { value: "ref", label: "Ref", rows: d.refLinks },
          ]}
          countLabel="Visits"
          onPick={onPick}
        />
        <Breakdown
          title="Pages"
          info="Top pages by visitors (with their page views); entry and exit pages are each visit's first and last page."
          tabs={[
            { value: "page", label: "Top", rows: d.pages, countLabel: "Views" },
            { value: "entry", label: "Entry", rows: d.entryPages },
            { value: "exit", label: "Exit", rows: d.exitPages },
          ]}
          countLabel="Visits"
          onPick={onPick}
        />
        <Breakdown
          title="Countries"
          info="From each visit's address when it arrived; the address itself is never kept."
          tabs={[{ value: "country", label: "Countries", rows: d.countries }]}
          countLabel="Visits"
          format={countryName}
          onPick={onPick}
        />
        <Breakdown
          title="Devices"
          info="The browser and system families read from the browser on arrival, and the screen by its width."
          tabs={[
            { value: "browser", label: "Browsers", rows: d.browsers },
            { value: "os", label: "Systems", rows: d.systems },
            { value: "device", label: "Screens", rows: d.devices },
          ]}
          countLabel="Visits"
          onPick={onPick}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Goals" info="The web app's named actions and the links and buttons clicked, by the visitors who did them; conversion is their share of all visitors.">
          {d.goals.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing clicked or done in this window</p>
          ) : (
            <DataTable
              head={["Goal", "Visitors", "Times", "Conversion"]}
              rows={d.goals.map((g) => [`${g.kind === "click" ? "Clicked" : "Did"}: ${g.name}`, g.visitors, g.count, formatPercent(g.rate, 1)])}
            />
          )}
        </Card>
        <Card title="Right now" info="The page each browser seen in the last few minutes is on; not filtered.">
          <Bars rows={live} countLabel="" format={(x) => x} empty="Nobody on the site in the last few minutes" />
        </Card>
      </div>
    </div>
  );
}

interface Tab {
  value: TrafficFilterKey;
  label: string;
  rows: TrafficRow[];
  countLabel?: string;
}

function Breakdown({
  title,
  info,
  tabs,
  countLabel,
  format = (x: string) => x,
  onPick,
}: {
  title: string;
  info: string;
  tabs: Tab[];
  countLabel: string;
  format?: (label: string) => string;
  onPick: (key: TrafficFilterKey, value: string) => void;
}) {
  const [tab, setTab] = useState<TrafficFilterKey>(tabs[0]!.value);
  const current = tabs.find((t) => t.value === tab) ?? tabs[0]!;
  return (
    <Card
      title={title}
      info={info}
      action={tabs.length > 1 ? <Segmented label={title} options={tabs.map((t) => ({ value: t.value, label: t.label }))} value={tab} onChange={setTab} /> : undefined}
    >
      <Bars
        rows={current.rows}
        countLabel={current.countLabel ?? countLabel}
        format={format}
        empty="Nothing in this window"
        onPick={(label) => onPick(current.value, label)}
      />
    </Card>
  );
}

function Bars({
  rows,
  countLabel,
  format,
  empty,
  onPick,
}: {
  rows: TrafficRow[];
  countLabel: string;
  format: (label: string) => string;
  empty: string;
  onPick?: (label: string) => void;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.visitors), 1);
  return (
    <ul className="space-y-1" role="list">
      <li className="flex justify-end gap-4 px-2 text-[11px] text-muted-foreground" aria-hidden>
        <span className="w-16 text-right">Visitors</span>
        {countLabel && <span className="w-14 text-right">{countLabel}</span>}
      </li>
      {rows.map((r) => {
        const inner = (
          <>
            <span className="absolute inset-y-0 left-0 rounded-[6px] bg-brand/10" style={{ width: `${(r.visitors / max) * 100}%` }} aria-hidden />
            <span className="relative min-w-0 flex-1 truncate text-left">{format(r.label)}</span>
            <span className="relative w-16 text-right tabular-nums text-foreground">{formatCount(r.visitors)}</span>
            {countLabel && <span className="relative w-14 text-right tabular-nums text-muted-foreground">{formatCount(r.count)}</span>}
          </>
        );
        const cls = "relative flex min-h-9 w-full items-center gap-4 rounded-[6px] px-2 text-[13px] text-foreground";
        return (
          <li key={r.label}>
            {onPick ? (
              <button type="button" className={`${cls} hover:bg-sidebar-accent`} onClick={() => onPick(r.label)} title={`Show only visits: ${r.label}`}>
                {inner}
              </button>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
