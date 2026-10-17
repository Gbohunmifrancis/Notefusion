"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { getInsights } from "@/api/endpoints";
import type { Insights } from "@/api/types";
import { Card } from "@/components/Card";
import { ChartCard, DataTable, FunnelBars, RankedBars, StackedDaily, rampColor } from "@/components/insights/Charts";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { Segmented } from "@/components/Segmented";
import { StateView } from "@/components/StateView";
import { useChartPalette } from "@/lib/chart";
import { formatCount, formatDayShort, formatPercent, formatWeekOf, reportingToday, addDays } from "@/lib/format";

/* Insights: the customer behaviour behind the overview's totals, cut by date, country, platform and plan.
 * Every chart answers one question a decision hangs on, and says its answer in a line under the title. */

const PLATFORMS = [
  { value: "all", label: "All" },
  { value: "web", label: "Web" },
  { value: "app", label: "App" },
] as const;
const PLANS = [
  { value: "all", label: "Everyone" },
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
] as const;
const COUNTRY_METRICS = [
  { value: "accounts", label: "Accounts" },
  { value: "active", label: "Active" },
  { value: "transcriptions", label: "Transcriptions" },
  { value: "pro", label: "Pro" },
] as const;
type CountryMetric = (typeof COUNTRY_METRICS)[number]["value"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** What a path-to-paying step counts, on hover, where the name alone leaves a question. */
const FUNNEL_HINTS: Record<string, string> = {
  "Reached the free limit": "Spent every free transcription (on the account or its phone), so met the paywall",
};

function countryName(code: string): string {
  if (code === "??") return "Unknown";
  if (code === "Other") return "Other countries";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function minutes(m: number | null): string {
  if (m == null) return "—";
  if (m < 1) return `${Math.round(m * 60)} s`;
  if (m < 90) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
  if (m < 60 * 48) return `${(m / 60).toFixed(1)} h`;
  return `${(m / 1440).toFixed(1)} days`;
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div className="nf-panel p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</div>
      {note && <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

/** The one line under a chart that says what it means. */
function Takeaway({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">{children}</p>;
}

export function InsightsView() {
  const c = useChartPalette();
  const [range, setRange] = useState<Range | null>(null);
  const [country, setCountry] = useState("all");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]["value"]>("all");
  const [plan, setPlan] = useState<(typeof PLANS)[number]["value"]>("all");
  const [metric, setMetric] = useState<CountryMetric>("accounts");

  const state = useQuery({
    queryKey: ["insights", range?.from, range?.to, country, platform, plan],
    queryFn: ({ signal }) =>
      getInsights(
        {
          from: range?.from,
          to: range?.to,
          country: country === "all" ? undefined : country,
          platform: platform === "all" ? undefined : platform,
          plan: plan === "all" ? undefined : plan,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
  });

  const offset = state.data?.reportingOffsetMinutes ?? 60;
  const picker: Range = range ?? { from: addDays(reportingToday(offset), -29), to: reportingToday(offset) };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader title="Insights" breadcrumb={["Dashboard", "Insights"]} />

      {/* Filters: one row, applied to every chart below. */}
      <div className="flex flex-wrap items-center gap-3 nf-panel p-3">
        <RangePicker value={picker} offsetMinutes={offset} onChange={setRange} />
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="Country"
          className="h-9 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground"
        >
          <option value="all">All countries</option>
          {(state.data?.filters.countries ?? []).map((c) => (
            <option key={c.label} value={c.label}>
              {countryName(c.label)} ({c.count})
            </option>
          ))}
        </select>
        <Segmented label="Platform" options={PLATFORMS} value={platform} onChange={setPlatform} />
        <Segmented label="Plan" options={PLANS} value={plan} onChange={setPlan} />
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
        {(country !== "all" || platform !== "all" || plan !== "all") && (
          <span className="text-[11px] text-muted-foreground">
            Website visits and anonymous previews have no country or plan, so they are left out while a filter is on.
          </span>
        )}
      </div>

      <StateView state={state} loadingLabel="Loading insights">
        {(d) => <InsightsBody d={d} metric={metric} setMetric={setMetric} ramp={c.ramp} colors={c.series5} />}
      </StateView>
    </div>
  );
}

function InsightsBody({
  d,
  metric,
  setMetric,
  ramp,
  colors,
}: {
  d: Insights;
  metric: CountryMetric;
  setMetric: (m: CountryMetric) => void;
  ramp: readonly string[];
  colors: readonly string[];
}) {
  const k = d.kpis;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const activeTotals = useMemo(
    () => ({ fresh: sum(d.dailyActive.map((x) => x.new)), back: sum(d.dailyActive.map((x) => x.returning)) }),
    [d.dailyActive],
  );
  const busiestDay = d.dailyActive.reduce((best, x) => (x.new + x.returning > best.new + best.returning ? x : best), d.dailyActive[0]!);

  // The funnel's biggest drop between consecutive steps: where to work first.
  const drop = d.funnel.slice(1).reduce<{ from: string; to: string; lost: number } | null>((worst, s, i) => {
    const prev = d.funnel[i]!;
    const lost = prev.count > 0 ? 1 - s.count / prev.count : 0;
    return !worst || lost > worst.lost ? { from: prev.step, to: s.step, lost } : worst;
  }, null);

  const tx = d.dailyTranscriptions;
  const txTotals = {
    recording: sum(tx.map((x) => x.recording)),
    songLink: sum(tx.map((x) => x.songLink)),
    songUpload: sum(tx.map((x) => x.songUpload)),
    preview: sum(tx.map((x) => x.preview)),
    failed: sum(tx.map((x) => x.failed)),
  };
  const txSeries = [
    { key: "recording" as const, label: "Recording" },
    { key: "songLink" as const, label: "Song link" },
    { key: "songUpload" as const, label: "Song upload" },
    { key: "preview" as const, label: "Free preview" },
    { key: "failed" as const, label: "Failed" },
  ];

  const signupSeries = [
    { key: "web" as const, label: "Web" },
    { key: "app" as const, label: "App" },
  ];
  const signupTotals = { web: sum(d.dailySignups.map((x) => x.web)), app: sum(d.dailySignups.map((x) => x.app)) };

  const countryRows = d.countries.map((r) => ({ label: countryName(r.country), count: r[metric], raw: r }));
  const bestPro = d.countries.filter((r) => r.accounts >= 5 && r.country !== "Other").sort((a, b) => b.pro / b.accounts - a.pro / a.accounts)[0];

  const heatMax = Math.max(0, ...d.heatmap.map((h) => h.count));
  const busiest = d.heatmap.reduce((b, h) => (h.count > b.count ? h : b), d.heatmap[0] ?? { weekday: 0, hour: 0, count: 0 });

  const sessionsTotal = sum(d.sessionLengths.map((s) => s.count));
  const quick = d.sessionLengths[0]?.count ?? 0;
  const never = d.timeToFirstTranscription.find((b) => b.label === "Not yet")?.count ?? 0;
  const firstTotal = sum(d.timeToFirstTranscription.map((b) => b.count));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Accounts" value={formatCount(k.accounts)} note={`${formatCount(k.newAccounts)} new in this window`} />
        <Kpi label="Active" value={formatCount(k.activeAccounts)} note={k.accounts ? `${formatPercent(k.activeAccounts / k.accounts, 0)} of accounts` : undefined} />
        <Kpi label="Transcriptions" value={formatCount(k.transcriptions)} note={k.successRate != null ? `${formatPercent(k.successRate, 0)} succeeded` : undefined} />
        <Kpi label="Paid conversions" value={formatCount(k.paidConversions)} note={k.newAccounts ? `${formatPercent(k.paidConversions / k.newAccounts, 1)} of new accounts` : undefined} />
        <Kpi label="Time per web visit" value={minutes(k.medianSessionMinutes)} note="Median, first to last action" />
        <Kpi label="Time to first sheet" value={minutes(k.medianMinutesToFirstTranscription)} note="Median, after signing up" />
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <ChartCard
            title="Who is active each day"
            info="Accounts that transcribed, used the web app, or were seen on a day. New: signed up that day; returning: joined earlier."
            legend={[
              { label: "Returning", color: colors[0]! },
              { label: "New", color: colors[1]! },
            ]}
            table={<DataTable head={["Day", "Returning", "New"]} rows={d.dailyActive.map((x) => [formatDayShort(x.date), x.returning, x.new])} />}
          >
            <StackedDaily data={d.dailyActive} series={[{ key: "returning", label: "Returning" }, { key: "new", label: "New" }]} unit="active" />
            <Takeaway>
              {activeTotals.back + activeTotals.fresh === 0
                ? "No activity in this window."
                : `${formatPercent(activeTotals.back / (activeTotals.back + activeTotals.fresh), 0)} of daily activity is people coming back. Busiest day: ${formatDayShort(busiestDay.date)} (${busiestDay.new + busiestDay.returning}).`}
            </Takeaway>
          </ChartCard>
        </div>
        <div className="xl:col-span-4">
          <ChartCard
            title="Path to paying"
            info="Of the accounts that signed up in this window, how many reached each step, ever."
            table={<DataTable head={["Step", "Accounts"]} rows={d.funnel.map((s) => [s.step, s.count])} />}
          >
            <FunnelBars steps={d.funnel.map((s) => (FUNNEL_HINTS[s.step] ? { ...s, hint: FUNNEL_HINTS[s.step]! } : s))} />
            {drop && drop.lost > 0 && (
              <Takeaway>
                Biggest drop: <span className="text-foreground">{drop.from} → {drop.to}</span>, losing {formatPercent(drop.lost, 0)}. Fix this step first.
              </Takeaway>
            )}
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <ChartCard
            title="Transcriptions each day"
            info="Finished transcriptions by kind, and the ones that failed. Free previews are anonymous website tries."
            legend={txSeries.map((s, i) => ({ label: s.label, color: colors[i]! }))}
            table={<DataTable head={["Day", ...txSeries.map((s) => s.label)]} rows={tx.map((x) => [formatDayShort(x.date), x.recording, x.songLink, x.songUpload, x.preview, x.failed])} />}
          >
            <StackedDaily data={tx} series={txSeries} unit="transcriptions" />
            <Takeaway>
              Most used: {[...txSeries].filter((s) => s.key !== "failed").sort((a, b) => txTotals[b.key] - txTotals[a.key])[0]?.label.toLowerCase()} · {formatCount(txTotals.failed)} failed
              {txTotals.songLink > 0 && ` · song links are ${formatPercent(txTotals.songLink / Math.max(1, sum(Object.values(txTotals)) - txTotals.failed), 0)} of the work`}.
            </Takeaway>
          </ChartCard>
        </div>
        <div className="xl:col-span-4">
          <ChartCard
            title="How long transcriptions take"
            info="From starting the job to the sheet being ready. Median and the slowest tenth (p90)."
            table={<DataTable head={["Kind", "Done", "Median", "p90"]} rows={d.jobDurations.map((j) => [j.kind, j.count, j.medianSeconds == null ? "—" : `${Math.round(j.medianSeconds)} s`, j.p90Seconds == null ? "—" : `${Math.round(j.p90Seconds)} s`])} />}
          >
            <RankedBars
              rows={d.jobDurations.filter((j) => j.medianSeconds != null).map((j) => ({ label: j.kind, count: Math.round(j.medianSeconds!), note: `s median · p90 ${Math.round(j.p90Seconds ?? 0)} s` }))}
              total={0}
              empty="No finished transcriptions in this window"
            />
            <Takeaway>Long waits lose people: a p90 well above the median means some jobs sit in the queue.</Takeaway>
          </ChartCard>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="Sign-ups by platform"
          legend={signupSeries.map((s, i) => ({ label: s.label, color: colors[i]! }))}
          table={<DataTable head={["Day", "Web", "App"]} rows={d.dailySignups.map((x) => [formatDayShort(x.date), x.web, x.app])} />}
        >
          <StackedDaily data={d.dailySignups} series={signupSeries} unit="sign-ups" />
          <Takeaway>
            {signupTotals.web + signupTotals.app === 0
              ? "No sign-ups in this window."
              : `${formatPercent(signupTotals.web / (signupTotals.web + signupTotals.app), 0)} of sign-ups come from the web.`}
          </Takeaway>
        </ChartCard>
        <ChartCard
          title="Countries"
          extra={<Segmented label="Country measure" options={COUNTRY_METRICS} value={metric} onChange={setMetric} />}
          table={<DataTable head={["Country", "Accounts", "Active", "Transcriptions", "Pro"]} rows={d.countries.map((r) => [countryName(r.country), r.accounts, r.active, r.transcriptions, r.pro])} />}
        >
          <RankedBars rows={[...countryRows].sort((a, b) => b.count - a.count)} />
          {bestPro && bestPro.pro > 0 && (
            <Takeaway>
              Highest share on Pro: <span className="text-foreground">{countryName(bestPro.country)}</span> ({formatPercent(bestPro.pro / bestPro.accounts, 0)} of {bestPro.accounts} accounts).
            </Takeaway>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="Time spent per web visit"
          info="Web sessions, from the first to the last thing done. The phone app does not report sessions."
          table={<DataTable head={["Length", "Visits"]} rows={d.sessionLengths.map((s) => [s.label, s.count])} />}
        >
          <RankedBars rows={d.sessionLengths} colorIndex={0} />
          {sessionsTotal > 0 && <Takeaway>{formatPercent(quick / sessionsTotal, 0)} of visits last under a minute: the first screen has seconds to make its case.</Takeaway>}
        </ChartCard>
        <ChartCard
          title="Time to a first transcription"
          info="For accounts that signed up in this window: how long after signing up their first sheet came back."
          table={<DataTable head={["When", "Accounts"]} rows={d.timeToFirstTranscription.map((s) => [s.label, s.count])} />}
        >
          <RankedBars rows={d.timeToFirstTranscription} colorIndex={2} />
          {firstTotal > 0 && <Takeaway>{formatPercent(never / firstTotal, 0)} have not transcribed anything yet: a nudge email is aimed at them.</Takeaway>}
        </ChartCard>
      </div>

      {/* The heatmap gets the full width: 24 columns need it. */}
      <div>
        <ChartCard
          title="When people use it"
          info="Transcriptions and web-app actions by weekday and hour, in reporting time."
          table={
            <DataTable
              head={["Day", ...Array.from({ length: 24 }, (_, h) => `${h}`)]}
              rows={WEEKDAYS.map((w, wd) => [w, ...Array.from({ length: 24 }, (_, h) => d.heatmap.find((x) => x.weekday === wd && x.hour === h)?.count ?? 0)])}
            />
          }
        >
          <div className="overflow-x-auto">
            <div className="grid min-w-[300px] gap-[2px]" style={{ gridTemplateColumns: "2.2rem repeat(24, minmax(0, 1fr))" }} role="img" aria-label="Activity by weekday and hour; use the table view for the numbers">
              {WEEKDAYS.map((w, wd) => [
                <span key={w} className="pr-1 text-[10px] leading-6 text-muted-foreground">{w}</span>,
                ...Array.from({ length: 24 }, (_, h) => {
                  const n = d.heatmap.find((x) => x.weekday === wd && x.hour === h)?.count ?? 0;
                  return <span key={`${w}-${h}`} title={`${w} ${h}:00 · ${n}`} className="h-6 rounded-[3px]" style={{ background: rampColor(ramp, n, heatMax) }} />;
                }),
              ])}
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={`h${h}`} className="text-center text-[9px] text-muted-foreground">{h % 6 === 0 ? h : ""}</span>
              ))}
            </div>
          </div>
          {busiest.count > 0 && <Takeaway>Busiest: {WEEKDAYS[busiest.weekday]} around {busiest.hour}:00. Send emails and posts just before then.</Takeaway>}
        </ChartCard>
      </div>

      <Card title="Who comes back, week by week" info="Each row is a week's sign-ups; each cell the share active in that week after joining (week 0 counts only a later day). Blank: not reached yet." bleed>
        <div className="overflow-x-auto px-5 pb-5 sm:px-6">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2 text-left font-medium">Signed up</th>
                <th className="py-2 text-right font-medium">Accounts</th>
                {Array.from({ length: d.retention[0]?.weeks.length ?? 8 }, (_, w) => (
                  <th key={w} className="py-2 text-center font-medium">Week {w}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.retention.map((r) => (
                <tr key={r.cohortStart}>
                  <td className="py-1 pr-3 text-foreground">{formatWeekOf(r.cohortStart)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums text-foreground">{formatCount(r.size)}</td>
                  {r.weeks.map((v, w) => (
                    <td key={w} className="p-0.5">
                      {v == null ? (
                        <span className="block h-7" />
                      ) : (
                        <span
                          className={`flex h-7 items-center justify-center rounded-[3px] tabular-nums ${v >= 0.5 ? "text-white" : "text-foreground"}`}
                          style={{ background: rampColor(ramp, v, 1) }}
                        >
                          {formatPercent(v, 0)}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {d.retention.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No sign-ups in the last eight weeks</p>}
        </div>
      </Card>
    </div>
  );
}
