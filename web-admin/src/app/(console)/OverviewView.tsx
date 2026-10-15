"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CreditCard,
  Info,
  MailCheck,
  MessageSquareHeart,
  Music2,
  Share2,
  TriangleAlert,
  UserRound,
  UserRoundPlus,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getOverview } from "@/api/endpoints";
import type { AnalyticsOverview, CategoryCount, DailyCount } from "@/api/types";
import { DailyChart } from "@/components/DailyChart";
import { ChartCard, DataTable, FunnelBars, MetricRow, RankedBars } from "@/components/insights/Charts";
import { Segmented } from "@/components/Segmented";
import { DonutCard } from "@/components/DonutCard";
import type { DonutSlice } from "@/components/DonutCard";
import { MostActiveUsersCard } from "@/components/activity/Engagement";
import { RangePicker } from "@/components/RangePicker";
import type { Range } from "@/components/RangePicker";
import { EmptyView, StateView } from "@/components/StateView";
import { SendEmailDialog } from "@/components/SendEmailDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { useChartPalette } from "@/lib/chart";
import {
  changeAgainst,
  formatCount,
  formatDayLong,
  formatDayShort,
  formatMonthShort,
  formatMonthYear,
  formatMoney,
  formatOffset,
  formatPercent,
  formatRelative,
  formatWeekOf,
  UNKNOWN,
} from "@/lib/format";
import { rememberReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";

function seedRange(overview: AnalyticsOverview): Range | null {
  const first = overview.signupsPerDay.at(0);
  const last = overview.signupsPerDay.at(-1);
  return first && last ? { from: first.date, to: last.date } : null;
}

function greeting(firstName?: string | null): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return firstName ? `Good ${part}, ${firstName}` : `Good ${part}`;
}

type Bucket = "day" | "week" | "month";

interface ChartGroup {
  key: string;
  label: string;
  title: string;
  count: number;
}

function groupIntoWeeks(data: DailyCount[]): ChartGroup[] {
  const groups: ChartGroup[] = [];
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

function groupIntoMonths(data: DailyCount[]): ChartGroup[] {
  const groups: ChartGroup[] = [];
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

function groupIntoDays(data: DailyCount[]): ChartGroup[] {
  return data.map((day) => ({
    key: day.date,
    label: formatDayShort(day.date),
    title: formatDayLong(day.date),
    count: day.count,
  }));
}

interface StatItem {
  title: string;
  value: string;
  change?: string | null;
  /** Direction of the change: a fall is shown falling, in red, not with the rising arrow. */
  up?: boolean | undefined;
  description?: string | null;
  hint?: string;
  icon: typeof UserRound;
  iconStyle?: string;
}

function StatCard({ stat }: { stat: StatItem }) {
  const Icon = stat.icon;

  return (
    <div className="h-full rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow duration-200 hover:shadow-sm dark:border-zinc-800 dark:bg-[#09090b]">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-zinc-900 dark:text-slate-300">
          <Icon size={18} strokeWidth={1.75} />
        </div>
        {stat.hint && (
          <span title={stat.hint} className="inline-flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <Info size={13} />
          </span>
        )}
      </div>

      <div className="mt-3.5">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {stat.title}
        </div>

        <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {stat.value}
        </div>

        {stat.change ? (
          <div
            className={`mt-2 flex flex-wrap items-center gap-1 text-xs font-medium ${
              stat.up === false ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {stat.up === false ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
            <span>{stat.change}</span>
            {stat.description && (
              <span className="font-normal text-slate-400 dark:text-slate-500">{stat.description}</span>
            )}
          </div>
        ) : stat.description ? (
          <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">{stat.description}</div>
        ) : null}
      </div>
    </div>
  );
}

function SignupChart({ data }: { data: DailyCount[] }) {
  const [bucket, setBucket] = useState<Bucket>("day");

  const chartData = useMemo(() => {
    if (bucket === "week") return groupIntoWeeks(data);
    if (bucket === "month") return groupIntoMonths(data);
    return groupIntoDays(data);
  }, [data, bucket]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Signups</h2>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200/80 bg-slate-50/70 p-0.5 text-xs font-medium dark:border-zinc-800 dark:bg-zinc-900/60">
          <button
            type="button"
            onClick={() => setBucket("day")}
            className={`rounded-md px-2.5 py-1 text-xs transition ${
              bucket === "day"
                ? "bg-white font-semibold text-[#2563EB] shadow-xs dark:bg-zinc-800 dark:text-blue-400"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            Day
          </button>
          <button
            type="button"
            onClick={() => setBucket("week")}
            className={`rounded-md px-2.5 py-1 text-xs transition ${
              bucket === "week"
                ? "bg-white font-semibold text-[#2563EB] shadow-xs dark:bg-zinc-800 dark:text-blue-400"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setBucket("month")}
            className={`rounded-md px-2.5 py-1 text-xs transition ${
              bucket === "month"
                ? "bg-white font-semibold text-[#2563EB] shadow-xs dark:bg-zinc-800 dark:text-blue-400"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            Month
          </button>
        </div>
      </div>

      <div className="min-h-64 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="signupGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
            <XAxis
              dataKey="label"
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dy={6}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dx={-4}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null;
                const point = payload[0].payload as ChartGroup;
                return (
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-md dark:border-zinc-800 dark:bg-[#09090b]">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{point.title}</p>
                    <p className="mt-0.5 text-xs font-semibold text-[#2563EB] dark:text-blue-400">
                      {formatCount(point.count)} signups
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#2563eb"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#signupGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * The website's funnel: the figures in one row, then the previews per day beside the path from a preview
 * to Pro as one chart. Rates are computed here from the counts, so they can be checked against them.
 */
function WebFunnelPanel({ funnel }: { funnel: AnalyticsOverview["webFunnel"] }) {
  const chart = useChartPalette();
  const previewChange = changeAgainst(funnel.previews, funnel.previewsPrevious);
  const signupChange = changeAgainst(funnel.webSignups, funnel.webSignupsPrevious);
  const rate = (num: number, den: number) => (den > 0 ? formatPercent(num / den, 0) : UNKNOWN);

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Web funnel</h3>
      <MetricRow
        items={[
          { label: "Previews", value: formatCount(funnel.previews), note: previewChange?.label, tone: previewChange ? (previewChange.up ? "up" : "down") : undefined, hint: `${formatCount(funnel.previewDevices)} browsers · ${formatCount(funnel.previewsSucceeded)} reached a result` },
          { label: "Web sign-ups", value: formatCount(funnel.webSignups), note: signupChange?.label, tone: signupChange ? (signupChange.up ? "up" : "down") : undefined },
          { label: "Preview → sign-up", value: rate(funnel.signupsFromPreview, funnel.previews), hint: "Sign-ups that claimed a preview, over previews started" },
          { label: "Shares", value: formatCount(funnel.sharesCreated), note: `${formatCount(funnel.shareViews)} link opens, all time` },
          { label: "Kept a sheet", value: rate(funnel.webSignupsWhoSaved, funnel.webSignups), note: `${formatCount(funnel.webSignupsWhoSaved)} of web sign-ups` },
          { label: "Web → Pro", value: rate(funnel.webProConversions, funnel.webSignups), note: `${formatCount(funnel.webProConversions)} paid`, hint: "Paid Pro started in this window by web sign-ups. Gifts are not counted." },
        ]}
      />
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="lg:col-span-7 xl:col-span-8">
          <DailyChart className="h-full" title="Previews" info="Anonymous try-it-free transcriptions per day" data={funnel.previewsPerDay} unit="previews" color={chart.series} />
        </div>
        <div className="lg:col-span-5 xl:col-span-4">
          <ChartCard
            title="Preview to Pro"
            info="Shares of the window's previews. Kept and Pro count the window's web sign-ups, who may have previewed earlier."
            table={<DataTable head={["Step", "Count"]} rows={[["Previews", funnel.previews], ["Signed up", funnel.signupsFromPreview], ["Kept a sheet", funnel.webSignupsWhoSaved], ["Paid Pro", funnel.webProConversions]]} />}
          >
            <FunnelBars
              steps={[
                { step: "Previews", count: funnel.previews },
                { step: "Signed up", count: funnel.signupsFromPreview },
                { step: "Kept a sheet", count: funnel.webSignupsWhoSaved },
                { step: "Paid Pro", count: funnel.webProConversions },
              ]}
            />
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

/** A ranked list in a card of its own (used where one list stands alone). */
function RankedList({ title, rows, empty, className = "" }: { title: string; rows: CategoryCount[]; empty: string; className?: string }) {
  return (
    <div className={`h-full min-w-0 rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b] ${className}`}>
      <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h4>
      <RankedBars rows={rows} empty={empty} />
    </div>
  );
}

const TRAFFIC_VIEWS = [
  { value: "pages", label: "Pages" },
  { value: "sources", label: "Sources" },
  { value: "clicks", label: "Clicks" },
  { value: "actions", label: "Actions" },
  { value: "devices", label: "Devices" },
] as const;
type TrafficView = (typeof TRAFFIC_VIEWS)[number]["value"];

/**
 * What the website's tracker saw: the figures in one row, page views beside what signed-in people did,
 * and one chart for where visits go — pages, sources, clicks, actions or devices, switched in place
 * instead of five cards side by side.
 */
function WebTrafficPanel({ traffic }: { traffic: AnalyticsOverview["webTraffic"] }) {
  const chart = useChartPalette();
  const now = Date.now();
  const [view, setView] = useState<TrafficView>("pages");
  const viewChange = changeAgainst(traffic.pageviews, traffic.pageviewsPrevious);
  const visitorChange = changeAgainst(traffic.visitors, traffic.visitorsPrevious);
  const rate = (num: number, den: number) => (den > 0 ? formatPercent(num / den, 0) : UNKNOWN);
  const lists: Record<TrafficView, { rows: CategoryCount[]; empty: string; color: number }> = {
    pages: { rows: traffic.topPages, empty: "No page views yet", color: 0 },
    sources: { rows: traffic.topReferrers, empty: "No referrers yet", color: 1 },
    clicks: { rows: traffic.topClicks, empty: "No clicks yet", color: 2 },
    actions: { rows: traffic.topActions, empty: "No actions yet", color: 3 },
    devices: { rows: traffic.devices, empty: "No page views yet", color: 4 },
  };
  const current = lists[view];

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Website traffic</h3>
      <MetricRow
        items={[
          { label: "Page views", value: formatCount(traffic.pageviews), note: viewChange?.label, tone: viewChange ? (viewChange.up ? "up" : "down") : undefined, hint: "Pages viewed on the website and in the web app" },
          { label: "Visitors", value: formatCount(traffic.visitors), note: visitorChange?.label ?? `${formatCount(traffic.sessions)} sessions`, tone: visitorChange ? (visitorChange.up ? "up" : "down") : undefined },
          { label: "Clicks", value: formatCount(traffic.clicks) },
          { label: "Sign-up clicks", value: formatCount(traffic.signupClicks), note: traffic.visitors > 0 ? `${rate(traffic.signupClicks, traffic.visitors)} of visitors` : null },
          { label: "App actions", value: formatCount(traffic.actions), hint: "Previews, uploads, recordings, saves, shares, checkouts" },
          { label: "Active web accounts", value: formatCount(traffic.activeWebUsers), hint: "Signed-in accounts that did something in the web app" },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 xl:col-span-8">
          <DailyChart className="h-full" title="Page views" info="Pages viewed per day, website and web app together" data={traffic.pageviewsPerDay} unit="views" color={chart.series} />
        </div>
        {/* The feed scrolls inside a card the height of the chart beside it, instead of running on below it. */}
        <div className="flex min-h-0 flex-col rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b] lg:col-span-5 lg:h-[22.5rem] xl:col-span-4">
          <h4 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">What web users do</h4>
          {traffic.recentActions.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No signed-in actions in this window yet</p>
          ) : (
            <ul className="-mr-2 min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain pr-2 dark:divide-zinc-800">
              {traffic.recentActions.map((item, i) => (
                <li key={`${item.userId}-${item.occurredAtUtc}-${i}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-slate-900 dark:text-slate-100">
                      <span className="font-medium">{item.action}</span>
                      <span className="text-slate-400"> · </span>
                      <Link href={`/users/${item.userId}`} className="text-slate-600 hover:underline dark:text-slate-300">{item.fullName}</Link>
                    </p>
                    <p className="truncate text-[11px] text-slate-400">{item.email} · {item.path}</p>
                  </div>
                  <time className="shrink-0 text-[11px] tabular-nums text-slate-400" dateTime={item.occurredAtUtc}>
                    {formatRelative(item.occurredAtUtc, now)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ChartCard
        title="Where visits go"
        info="The top eight of each, with each one's share of the total."
        extra={<Segmented label="Breakdown" options={TRAFFIC_VIEWS} value={view} onChange={setView} />}
        table={<DataTable head={[TRAFFIC_VIEWS.find((v) => v.value === view)!.label, "Count"]} rows={current.rows.map((r) => [r.label, r.count])} />}
      >
        <RankedBars rows={current.rows} colorIndex={current.color} empty={current.empty} />
      </ChartCard>
    </div>
  );
}

/** Amounts in several currencies, each in its own, joined; never summed across currencies. */
function moneyList(amounts: { currency: string; amountMinor: number }[]): string {
  return amounts.length === 0 ? formatMoney(0, "USD") : amounts.map((a) => formatMoney(a.amountMinor, a.currency)).join(" · ");
}

/**
 * Pro membership: who has it, who joined and lapsed in the window, the money, and the song allowance, as
 * one row of figures beside how members split across plans. Nothing renews by itself, so lapsed members
 * are the ones to win back and the run-rate is what would recur if every member bought again.
 */
function MembershipPanel({ membership }: { membership: AnalyticsOverview["membership"] }) {
  const m = membership;
  const lapseRate = m.activeMembers + m.lapsedMembers > 0 ? formatPercent(m.lapsedMembers / (m.activeMembers + m.lapsedMembers), 0) : UNKNOWN;
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Pro membership</h3>
      <div className="grid gap-5 xl:grid-cols-3">
        <MetricRow
          className="xl:col-span-2"
          items={[
            { label: "Pro members", value: formatCount(m.activeMembers), note: `${formatCount(m.paidMembers)} paid · ${formatCount(m.giftedMembers)} gifted`, hint: "Customers with Pro right now, each counted once" },
            { label: "New members", value: formatCount(m.newMembers), hint: "First Pro period started in this window" },
            { label: "Lapsed", value: formatCount(m.lapsedMembers), note: `${lapseRate} of members`, hint: "Paid time ran out with no new payment: the people to win back" },
            { label: "Revenue collected", value: moneyList(m.revenue), hint: "Payments received in this window, per currency" },
            { label: "Monthly run-rate", value: moneyList(m.monthlyRunRate), hint: "Paid memberships per month (yearly at a twelfth)" },
            { label: "Songs this month", value: formatCount(m.songsUsedThisMonth), note: m.membersOutOfSongs ? `${formatCount(m.membersOutOfSongs)} used all 20` : "No one has run out" },
          ]}
        />
        <RankedList title="Members by plan" rows={m.membersByPlan} empty="No Pro members yet" />
      </div>
    </div>
  );
}

function MostTranscribedKeys({ keys }: { keys: { label: string; count: number }[] }) {
  return (
    <ChartCard
      title="Most transcribed keys"
      info="Keys of the sheets kept in this period. Every finished transcription is kept, so these are the transcribed keys."
      table={<DataTable head={["Key", "Sheets"]} rows={keys.map((k) => [k.label, k.count])} />}
    >
      <RankedBars rows={keys.slice(0, 8)} colorIndex={0} empty="No sheets in this period" />
    </ChartCard>
  );
}

function getFlagEmoji(countryCode: string | null | undefined): string {
  if (!countryCode || countryCode.length !== 2) return "";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

const ACTIVITY_FILTERS = [
  { value: "all", label: "All" },
  { value: "transcriptions", label: "Transcriptions" },
  { value: "signups", label: "Sign-ups" },
  { value: "money", label: "Payments" },
  { value: "feedback", label: "Feedback" },
] as const;
type ActivityFilter = (typeof ACTIVITY_FILTERS)[number]["value"];

const ACTIVITY_KINDS: Record<string, { icon: typeof UserRound; style: string; group: ActivityFilter }> = {
  signup: { icon: UserRoundPlus, style: "bg-blue-50 text-[#2563EB] dark:bg-blue-950/60 dark:text-blue-400", group: "signups" },
  transcription: { icon: Music2, style: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400", group: "transcriptions" },
  transcription_failed: { icon: TriangleAlert, style: "bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400", group: "transcriptions" },
  payment: { icon: CreditCard, style: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400", group: "money" },
  feedback: { icon: MessageSquareHeart, style: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400", group: "feedback" },
  share: { icon: Share2, style: "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400", group: "transcriptions" },
  /** The founder's customer-research emails (GET /api/admin/outreach lists them all). */
  outreach: { icon: MailCheck, style: "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-400", group: "feedback" },
};

function regionName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The newest things customers did, each as a sentence: who, what, where, when. Sign-ins are not here
 * (the API no longer sends them: one stored time per account could not say when anyone signed in).
 * The list scrolls inside a card the height of the chart beside it; a row opens that person's journey.
 */
function RecentActivityPanel({ items }: { items: AnalyticsOverview["recentActivity"] }) {
  const now = Date.now();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<{ email: string; fullName: string; id: string } | null>(null);
  const shown = items.filter((i) => filter === "all" || (ACTIVITY_KINDS[i.kind]?.group ?? "all") === filter);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b] lg:max-h-[24.5rem]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent activity</h2>
        <Link href="/activity?tab=feed" className="text-xs font-medium text-[#2563EB] hover:underline dark:text-blue-400">
          View all
        </Link>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {ACTIVITY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filter === f.value
                ? "bg-[#2563EB] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-900 dark:text-slate-300 dark:hover:bg-zinc-800"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400">Nothing of this kind yet</div>
      ) : (
        <ul className="-mr-2 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-2">
          {shown.map((item, index) => {
            const kind = ACTIVITY_KINDS[item.kind] ?? ACTIVITY_KINDS.transcription!;
            const Icon = kind.icon;
            const flag = getFlagEmoji(item.country);
            const at = item.occurredAtUtc;
            const exact = new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
            return (
              <li key={`${item.kind}-${at}-${index}`} className="group relative">
                <Link
                  href={item.userId ? `/activity/journey?userId=${item.userId}` : "/activity?tab=feed"}
                  className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-zinc-900/60"
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${kind.style}`}>
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] leading-snug text-slate-800 dark:text-slate-100">
                      <span className="font-semibold">{item.title}</span> {item.detail ?? item.kind}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-400 dark:text-slate-500">
                      {flag && <span className="mr-1">{flag}</span>}
                      {regionName(item.country)}
                      {item.country ? " · " : ""}
                      <time dateTime={at} title={exact}>{formatRelative(at, now)}</time>
                    </span>
                  </span>
                </Link>
                {item.email && item.userId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEmailTarget({ email: item.email!, fullName: item.title, id: item.userId! });
                      setEmailDialogOpen(true);
                    }}
                    className="absolute right-1 top-2 rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:bg-blue-50 hover:text-blue-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
                    title={`Email ${item.title}`}
                    aria-label={`Email ${item.title}`}
                  >
                    <MailCheck size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {emailTarget && <SendEmailDialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen} targetUser={emailTarget} />}
    </div>
  );
}



export function OverviewView() {
  const { user } = useAuth();
  const chart = useChartPalette();
  const [range, setRange] = useState<Range | null>(null);
  const [showRangePicker, setShowRangePicker] = useState(false);

  const state = useQuery({
    queryKey: ["overview", range?.from ?? null, range?.to ?? null],
    queryFn: ({ signal }) => getOverview(range?.from, range?.to, signal),
    placeholderData: keepPreviousData,
  });

  const offset = state.data?.reportingOffsetMinutes;
  useEffect(() => {
    if (offset !== undefined) rememberReportingOffset(offset);
  }, [offset]);

  const picker = range ?? (state.data ? seedRange(state.data) : null);
  const firstName =
    user?.fullName?.trim().split(/\s+/)[0] ||
    (user?.email ? user.email.split("@")[0] : "");

  function setPresetDays(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    setRange({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
  }

  function isPreset(days: number): boolean {
    if (!picker) return false;
    const diffDays =
      Math.round(
        (new Date(picker.to).getTime() - new Date(picker.from).getTime()) /
          (1000 * 60 * 60 * 24),
      ) + 1;
    return diffDays === days;
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {greeting(firstName)}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Here&apos;s what&apos;s happening with your NoteFusion account today.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-400">
            Days bucketed in {formatOffset(state.data?.reportingOffsetMinutes ?? 60)}
          </span>

          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-zinc-800 dark:bg-[#09090b]">
            <button
              onClick={() => setPresetDays(7)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                isPreset(7)
                  ? "bg-[#2563EB] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              7d
            </button>
            <button
              onClick={() => setPresetDays(30)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                isPreset(30)
                  ? "bg-[#2563EB] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              30d
            </button>
            <button
              onClick={() => setPresetDays(90)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                isPreset(90)
                  ? "bg-[#2563EB] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              90d
            </button>
          </div>

          <button
            onClick={() => setShowRangePicker((p) => !p)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-zinc-800 dark:bg-[#09090b] dark:text-slate-300 dark:hover:bg-zinc-900"
          >
            <CalendarDays size={15} />
            <span>
              {picker
                ? `${formatDayShort(picker.from)} - ${formatDayShort(picker.to)}`
                : "Select dates"}
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {showRangePicker && state.data && picker && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md dark:border-zinc-800 dark:bg-[#09090b]">
          <RangePicker
            value={picker}
            offsetMinutes={state.data.reportingOffsetMinutes}
            onChange={(next) => {
              setRange(next);
              setShowRangePicker(false);
            }}
          />
        </div>
      )}

      <StateView state={state} loadingLabel="Loading analytics">
        {(data) => {
          const activeChange = changeAgainst(data.users.activeUsers, data.users.activeUsersPrevious);
          const txChange = changeAgainst(data.transcriptions.totalTranscribed, data.transcriptions.totalTranscribedPrevious);

          const topStats: StatItem[] = [
            {
              // The total is all time; what moves with the window is how many joined, said as such.
              title: "Total users",
              value: formatCount(data.users.totalUsers),
              description: `${formatCount(data.users.newUsers)} new in this period`,
              icon: UserRound,
              hint: "Every account, all time",
            },
            {
              title: "Active today",
              value: formatCount(data.users.activeToday ?? 0),
              description: "Seen since midnight",
              icon: Zap,
              hint: "Accounts that used the app or the website today (reporting time): any signed-in visit, a transcription, or a sign-in",
            },
            {
              title: "Active this period",
              value: formatCount(data.users.activeUsers),
              change: activeChange?.label ?? null,
              up: activeChange?.up,
              description: activeChange ? "vs. previous period" : null,
              icon: Activity,
              hint: "Accounts that did something in the selected dates: transcribed, used the web app, signed up, or were seen",
            },
            {
              title: "Transcriptions",
              value: formatCount(data.transcriptions.totalTranscribed),
              change: txChange?.label ?? null,
              up: txChange?.up,
              description: `${formatCount(data.transcriptions.totalSaved)} kept${txChange ? " · vs. previous period" : ""}`,
              icon: Music2,
              hint: "Transcriptions that produced a result in this window, including free previews",
            },
          ];

          const started = data.transcriptions.succeededCount + data.transcriptions.failedCount + data.transcriptions.inFlightCount;
          const outcomes: DonutSlice[] = [
            {
              label: "Succeeded",
              value: data.transcriptions.succeededCount,
              color: chart.success,
            },
            { label: "Failed", value: data.transcriptions.failedCount, color: chart.danger },
            { label: "Still running", value: data.transcriptions.inFlightCount, color: chart.faint },
          ];

          const methods: DonutSlice[] = data.signupMethods.map((method, i) => ({
            label: method.label,
            value: method.count,
            color: chart.categorical[i % chart.categorical.length] ?? chart.faint,
          }));
          const methodTotal = data.signupMethods.reduce((sum, row) => sum + row.count, 0);

          return (
            <div className="space-y-6">
              {/* TOP KPI CARDS */}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {topStats.map((stat) => (
                  <StatCard key={stat.title} stat={stat} />
                ))}
              </div>

              {/* TWO-COLUMN LAYOUT: SIGNUPS CHART & RECENT ACTIVITY */}
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7 xl:col-span-8">
                  <SignupChart data={data.signupsPerDay} />
                </div>
                <div className="lg:col-span-5 xl:col-span-4">
                  <RecentActivityPanel items={data.recentActivity} />
                </div>
              </div>

              {/* MOST ACTIVE USERS: the engagement leaderboard's top five for this window */}
              <MostActiveUsersCard from={range?.from} to={range?.to} />

              {/* PRO MEMBERSHIP: members, joins and lapses, money, song use */}
              {data.membership && (
                <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
                  <MembershipPanel membership={data.membership} />
                </div>
              )}

              {/* WEBSITE TRAFFIC: visits, clicks, referrers, what web users do */}
              <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
                <WebTrafficPanel traffic={data.webTraffic} />
              </div>

              {/* WEB FUNNEL: previews → sign-ups → saves → shares → Pro */}
              <div className="mt-8 border-t border-slate-200 pt-6 dark:border-slate-800">
                <WebFunnelPanel funnel={data.webFunnel} />
              </div>

              {/* SECONDARY DEEP DIVE: KEYS & OUTCOMES */}
              <div className="grid gap-6 xl:grid-cols-2">
                <MostTranscribedKeys keys={data.topKeys} />
                <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b]">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Transcription outcomes
                    </h4>
                    <span
                      className="text-xs text-slate-400"
                      title="Every transcription started in this period, account jobs and free previews"
                    >
                      {data.transcriptions.successRate != null
                        ? `${formatPercent(data.transcriptions.successRate, 0)} succeeded`
                        : "Started in this period"}
                    </span>
                  </div>
                  <DonutCard
                    slices={outcomes}
                    centerLabel="Started"
                    centerValue={formatCount(started)}
                    meters
                    emptyMessage="No transcriptions started in this period"
                  />
                </div>
              </div>

              {/* Telemetry, Cohorts & Signup Methods */}
              <div className="mt-8 border-t border-slate-200 pt-6 space-y-5 dark:border-slate-800">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Platform telemetry &amp; cohorts
                </h3>

                <div className="grid gap-5 lg:grid-cols-[1fr_1.6fr]">
                  <div className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
                    <div className="mb-4 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Signup methods
                      </h4>
                      <span className="text-xs text-slate-400">All accounts</span>
                    </div>
                    <DonutCard
                      slices={methods}
                      centerLabel="All accounts"
                      centerValue={formatCount(methodTotal)}
                      meters
                      emptyMessage="No accounts yet"
                    />
                    <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800/60">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Signed up from</h4>
                        <span className="text-xs text-slate-400">All accounts</span>
                      </div>
                      <DonutCard
                        slices={data.signupSources.map((source, i) => ({ label: source.label, value: source.count, color: chart.categorical[(i + 2) % chart.categorical.length] ?? chart.faint }))}
                        centerLabel="All accounts"
                        centerValue={formatCount(data.signupSources.reduce((sum, row) => sum + row.count, 0))}
                        meters
                        emptyMessage="No accounts yet"
                      />
                    </div>
                  </div>

                  {/* Weekly Cohorts Table - Bleed to edges of card, no double box! */}
                  <div className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900/80">
                    <div className="p-4 sm:p-5 pb-3">
                      <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Weekly cohorts
                      </h4>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Share of each signup week that came back on a later day: seen, signed in, or transcribed
                      </p>
                    </div>
                    {data.retention.length === 0 ? (
                      <div className="p-5">
                        <EmptyView message="No signups in the last twelve weeks" />
                      </div>
                    ) : (
                      <div className="w-full overflow-x-auto border-t border-slate-100 dark:border-slate-800/60">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead className={TH}>Cohort</TableHead>
                              <TableHead className={TH}>Signups</TableHead>
                              <TableHead className={TH}>Ever returned</TableHead>
                              <TableHead className={`${TH} text-right`}>Rate</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className={TBODY}>
                            {data.retention.map((cohort) => (
                              <TableRow key={cohort.cohortStart}>
                                <TableCell className={TD}>{formatWeekOf(cohort.cohortStart)}</TableCell>
                                <TableCell className={TD}>{formatCount(cohort.cohortSize)}</TableCell>
                                <TableCell className={TD}>{formatCount(cohort.returnedCount)}</TableCell>
                                <TableCell className={`${TD} text-right font-medium text-foreground`}>
                                  {formatPercent(cohort.retentionRate)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          );

        }}
      </StateView>
    </div>
  );
}
