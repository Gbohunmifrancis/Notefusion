"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CreditCard,
  Info,
  MailCheck,
  Music2,
  UserRound,
  UserRoundPlus,
  Zap,
  LogIn,
  Globe,
  Share2,
  Eye,
  Crown,
  Bookmark,
  MousePointerClick,
  Wallet,
  TrendingUp,
  UserRoundMinus,
  Gauge,
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
import { DonutCard } from "@/components/DonutCard";
import type { DonutSlice } from "@/components/DonutCard";
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
  description?: string | null;
  hint?: string;
  icon: typeof UserRound;
  iconStyle?: string;
}

function StatCard({ stat }: { stat: StatItem }) {
  const Icon = stat.icon;

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm dark:border-zinc-800 dark:bg-[#09090b]">
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

        {stat.change && (
          <div className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <ArrowUpRight size={13} />
            <span>{stat.change}</span>
            {stat.description && (
              <span className="font-normal text-slate-400 dark:text-slate-500">
                {stat.description}
              </span>
            )}
          </div>
        )}
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
    <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b]">
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

      <div className="h-64 w-full">
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
 * The website's funnel: previews at the top, Pro at the bottom. Each stage names what it counts,
 * and the rates are computed here from the counts the API returned rather than returned as rates,
 * so a reader can check the arithmetic against the tiles above.
 */
function WebFunnelPanel({ funnel }: { funnel: AnalyticsOverview["webFunnel"] }) {
  const chart = useChartPalette();
  const previewChange = changeAgainst(funnel.previews, funnel.previewsPrevious);
  const signupChange = changeAgainst(funnel.webSignups, funnel.webSignupsPrevious);
  const rate = (num: number, den: number) => (den > 0 ? formatPercent(num / den, 0) : UNKNOWN);

  const stages = [
    { label: "Previews", value: funnel.previews, hint: "Anonymous 30-second transcriptions started from the website" },
    { label: "Sign-ups from a preview", value: funnel.signupsFromPreview, hint: "Web accounts created after a preview, attributed by the claim the app makes on sign-in" },
    { label: "Saved a sheet", value: funnel.webSignupsWhoSaved, hint: "Of this window's web sign-ups, those with at least one sheet in their library" },
    { label: "Went Pro", value: funnel.webProConversions, hint: "Subscriptions started in the window by accounts that signed up on the web" },
  ];
  const top = stages[0]?.value ?? 0;

  const tiles: StatItem[] = [
    { title: "Previews", value: formatCount(funnel.previews), change: previewChange?.label ?? null, description: previewChange ? "vs. previous period" : null, icon: Globe, hint: `${formatCount(funnel.previewDevices)} browsers · ${formatCount(funnel.previewsSucceeded)} reached a result` },
    { title: "Web sign-ups", value: formatCount(funnel.webSignups), change: signupChange?.label ?? null, description: signupChange ? "vs. previous period" : null, icon: UserRoundPlus, hint: "Accounts created on the website in this window" },
    { title: "Preview → sign-up", value: rate(funnel.signupsFromPreview, funnel.previews), icon: Bookmark, hint: "Sign-ups that claimed a preview, over previews started" },
    { title: "Shares", value: formatCount(funnel.sharesCreated), icon: Share2, hint: `Sheets put behind a public link in this window · ${formatCount(funnel.shareViews)} link opens all time` },
    { title: "Link opens", value: formatCount(funnel.shareViews), icon: Eye, hint: "Opens of public sheet links, all time" },
    { title: "Web → Pro", value: rate(funnel.webProConversions, funnel.webSignups), icon: Crown, hint: "Pro subscriptions started by this window's web sign-ups, over web sign-ups" },
  ];

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Web funnel
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((stat) => (
          <StatCard key={stat.title} stat={stat} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 xl:col-span-8">
          <DailyChart title="Previews" info="Anonymous try-it-free transcriptions per day" data={funnel.previewsPerDay} unit="previews" color={chart.series} />
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b] lg:col-span-5 xl:col-span-4">
          <h4 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">Preview to Pro</h4>
          <div className="space-y-3">
            {stages.map((stage) => {
              const share = top > 0 ? Math.min(100, Math.round((stage.value / top) * 100)) : 0;
              return (
                <div key={stage.label} title={stage.hint}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{stage.label}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {formatCount(stage.value)}
                      <span className="ml-2 font-normal text-slate-400">{top > 0 ? `${share}%` : UNKNOWN}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800">
                    <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${share}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
            Shares of the window&apos;s previews. &ldquo;Saved&rdquo; and &ldquo;Pro&rdquo; count the window&apos;s web sign-ups, who may have previewed earlier.
          </p>
        </div>
      </div>
    </div>
  );
}

/** One ranked list on the traffic panel: label, count and share of the list's total. */
function RankedList({ title, rows, empty }: { title: string; rows: CategoryCount[]; empty: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b]">
      <h4 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h4>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
            return (
              <li key={row.label} className="text-xs" title={row.label}>
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">{row.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatCount(row.count)}
                    <span className="ml-2 font-normal text-slate-400">{share}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-slate-100 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-blue-600/80" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * What the website's own tracker saw: visits, visitors, clicks, where they came from, and what
 * signed-in accounts did in the web app. Every figure is a count over events the browser posted,
 * so a quiet window is zeros, not an outage.
 */
function WebTrafficPanel({ traffic }: { traffic: AnalyticsOverview["webTraffic"] }) {
  const chart = useChartPalette();
  const now = Date.now();
  const viewChange = changeAgainst(traffic.pageviews, traffic.pageviewsPrevious);
  const visitorChange = changeAgainst(traffic.visitors, traffic.visitorsPrevious);
  const rate = (num: number, den: number) => (den > 0 ? formatPercent(num / den, 0) : UNKNOWN);

  const tiles: StatItem[] = [
    { title: "Page views", value: formatCount(traffic.pageviews), change: viewChange?.label ?? null, description: viewChange ? "vs. previous period" : null, icon: Eye, hint: "Pages viewed on the website and in the web app in this window" },
    { title: "Visitors", value: formatCount(traffic.visitors), change: visitorChange?.label ?? null, description: visitorChange ? "vs. previous period" : null, icon: Globe, hint: `Distinct browsers · ${formatCount(traffic.sessions)} sessions` },
    { title: "Clicks", value: formatCount(traffic.clicks), icon: MousePointerClick, hint: "Links and buttons clicked anywhere on the site" },
    { title: "Sign-up clicks", value: formatCount(traffic.signupClicks), description: traffic.visitors > 0 ? `${rate(traffic.signupClicks, traffic.visitors)} of visitors` : null, icon: UserRoundPlus, hint: "Clicks on anything that leads to the sign-up form" },
    { title: "App actions", value: formatCount(traffic.actions), icon: Zap, hint: "Named actions in the web app: previews, uploads, recordings, saves, shares, checkouts" },
    { title: "Active web accounts", value: formatCount(traffic.activeWebUsers), icon: UserRound, hint: "Signed-in accounts that took at least one action in the web app" },
  ];

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Website traffic
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((stat) => (
          <StatCard key={stat.title} stat={stat} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 xl:col-span-8">
          <DailyChart title="Page views" info="Pages viewed per day, website and web app together" data={traffic.pageviewsPerDay} unit="views" color={chart.series} />
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b] lg:col-span-5 xl:col-span-4">
          <h4 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">What web users do</h4>
          {traffic.recentActions.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">No signed-in actions in this window yet</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-zinc-800">
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
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <RankedList title="Pages" rows={traffic.topPages} empty="No page views yet" />
        <RankedList title="Came from" rows={traffic.topReferrers} empty="No referrers yet" />
        <RankedList title="Most clicked" rows={traffic.topClicks} empty="No clicks yet" />
        <RankedList title="Actions" rows={traffic.topActions} empty="No actions yet" />
        <RankedList title="Devices" rows={traffic.devices} empty="No page views yet" />
      </div>
    </div>
  );
}

/** Amounts in several currencies, each in its own, joined; never summed across currencies. */
function moneyList(amounts: { currency: string; amountMinor: number }[]): string {
  return amounts.length === 0 ? formatMoney(0, "USD") : amounts.map((a) => formatMoney(a.amountMinor, a.currency)).join(" · ");
}

/**
 * Pro membership: who has it now, who joined and who lapsed in the window, the money collected, and
 * how the monthly song allowance is being used. Nothing renews by itself, so lapsed members are the
 * ones to win back and the run-rate is what would recur if every member bought again.
 */
function MembershipPanel({ membership }: { membership: AnalyticsOverview["membership"] }) {
  const m = membership;
  const lapseRate = m.activeMembers + m.lapsedMembers > 0 ? formatPercent(m.lapsedMembers / (m.activeMembers + m.lapsedMembers), 0) : UNKNOWN;
  const tiles: StatItem[] = [
    { title: "Pro members", value: formatCount(m.activeMembers), description: `${formatCount(m.paidMembers)} paid · ${formatCount(m.giftedMembers)} gifted${m.lifetimeMembers ? ` · ${formatCount(m.lifetimeMembers)} lifetime` : ""}`, icon: Crown, hint: "Accounts with Pro right now, each counted once" },
    { title: "New members", value: formatCount(m.newMembers), icon: UserRoundPlus, hint: "Accounts whose first Pro period started in this window" },
    { title: "Lapsed", value: formatCount(m.lapsedMembers), description: `${lapseRate} of members in this window`, icon: UserRoundMinus, hint: "Paid time ran out in this window with no new payment: the people to win back" },
    { title: "Revenue collected", value: moneyList(m.revenue), icon: Wallet, hint: "Payments received in this window, per currency, from the ledger" },
    { title: "Monthly run-rate", value: moneyList(m.monthlyRunRate), icon: TrendingUp, hint: "Running paid memberships per month (yearly at a twelfth). Nothing renews by itself, so this recurs only if members buy again" },
    { title: "Songs this month", value: formatCount(m.songsUsedThisMonth), description: m.membersOutOfSongs ? `${formatCount(m.membersOutOfSongs)} members used all 20` : "No one has run out", icon: Gauge, hint: "Song credits spent since the first of the month (UTC)" },
  ];
  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Pro membership
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((stat) => (
          <StatCard key={stat.title} stat={stat} />
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <RankedList title="Members by plan" rows={m.membersByPlan} empty="No Pro members yet" />
      </div>
    </div>
  );
}

function MostTranscribedKeys({ keys }: { keys: { label: string; count: number }[] }) {
  const topKeys = keys.slice(0, 5);
  const total = keys.reduce((sum, k) => sum + k.count, 0);

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Most transcribed keys
          </h2>
          <Info size={13} className="text-slate-400" />
        </div>

        <Link href="/transcriptions" className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
          View all
        </Link>
      </div>

      {topKeys.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400">
          No transcriptions saved yet
        </div>
      ) : (
        <div className="space-y-2">
          {topKeys.map((key, index) => {
            const percentage = total > 0 ? Math.round((key.count / total) * 100) : 0;
            return (
              <div
                key={key.label}
                className="rounded-lg bg-slate-50 px-3 py-2 transition hover:bg-slate-100 dark:bg-zinc-900/50 dark:hover:bg-zinc-800/70"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-slate-500 shadow-xs dark:bg-zinc-800 dark:text-slate-300">
                    {index + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                        {key.label}
                      </span>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold text-slate-800 dark:text-white">
                          {key.count}
                        </span>

                        <span className="w-7 text-right text-[11px] text-slate-400">
                          {percentage}%
                        </span>
                      </div>
                    </div>

                    <div className="mt-1.5 h-1 rounded-full bg-slate-200 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-blue-600 transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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

function RecentActivityPanel({ items }: { items: AnalyticsOverview["recentActivity"] }) {
  const now = Date.now();
  const displayItems = items.length > 0 ? items.slice(0, 5) : [];
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailTarget, setEmailTarget] = useState<{ email: string; fullName: string; id: string } | null>(null);

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent activity</h2>

        <Link href="/activity?tab=feed" className="text-xs font-medium text-[#2563EB] hover:underline dark:text-blue-400">
          View all
        </Link>
      </div>

      {displayItems.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No activity recorded yet
        </div>
      ) : (
        <div className="space-y-4">
          {displayItems.map((item, index) => {
            const isSignup = item.kind === "signup";
            const isTranscription = item.kind === "transcription";
            const isLogin = item.kind === "login";

            const Icon = isSignup ? UserRoundPlus : isTranscription ? Music2 : isLogin ? LogIn : CreditCard;
            const iconStyle = isSignup
              ? "bg-blue-50 text-[#2563EB] dark:bg-blue-950/60 dark:text-blue-400"
              : isTranscription
                ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                : isLogin
                  ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400"
                  : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400";

            const verb = isSignup ? "New user signed up" : isTranscription ? "Transcription completed" : isLogin ? "User signed in" : "Payment received";
            const flag = getFlagEmoji(item.country);
            
            return (
              <div key={`${item.kind}-${item.occurredAtUtc}-${index}`} className="flex items-center justify-between gap-3 group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconStyle}`}>
                    <Icon size={16} />
                  </div>

                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {verb}
                    </div>
                    <div className="truncate text-[11px] text-slate-400 dark:text-slate-500 flex items-center gap-1">
                      {item.title}{flag && <span className="ml-1 leading-none">{flag}</span>}{item.subtitle ? ` • ${item.subtitle}` : ""}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {item.email && item.userId && (
                    <button 
                      onClick={() => {
                        setEmailTarget({ email: item.email!, fullName: item.title, id: item.userId! });
                        setEmailDialogOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-600 p-1 rounded-md hover:bg-blue-50 dark:hover:bg-zinc-800"
                      title="Send email"
                    >
                      <MailCheck size={14} />
                    </button>
                  )}
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {formatRelative(item.occurredAtUtc.endsWith('Z') ? item.occurredAtUtc : `${item.occurredAtUtc}Z`, now)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {emailTarget && (
        <SendEmailDialog
          open={emailDialogOpen}
          onOpenChange={setEmailDialogOpen}
          targetUser={emailTarget}
        />
      )}
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
          const userChange = changeAgainst(data.users.newUsers, data.users.newUsersPrevious);
          const activeChange = changeAgainst(data.users.activeUsers, data.users.activeUsersPrevious);
          const txChange = changeAgainst(data.transcriptions.totalTranscribed, data.transcriptions.totalTranscribedPrevious);

          const topStats: StatItem[] = [
            {
              title: "Total users",
              value: formatCount(data.users.totalUsers),
              change: userChange?.label ?? null,
              description: userChange ? "vs. previous period" : null,
              icon: UserRound,
              hint: "Every account, all time",
            },
            {
              title: "Active today",
              value: formatCount(data.users.activeUsers),
              change: activeChange?.label ?? null,
              description: activeChange ? "vs. previous period" : null,
              icon: Zap,
              hint: "Signed in recently",
            },
            {
              title: "Transcriptions",
              value: formatCount(data.transcriptions.totalTranscribed),
              change: txChange?.label ?? null,
              description: `${formatCount(data.transcriptions.totalSaved)} saved${txChange ? " · vs. previous period" : ""}`,
              icon: Music2,
              hint: "Transcriptions that produced a result in this window, saved or not, including free previews",
            },
          ];

          const ended = data.transcriptions.succeededCount + data.transcriptions.failedCount;
          const outcomes: DonutSlice[] = [
            {
              label: "Succeeded",
              value: data.transcriptions.succeededCount,
              color: chart.success,
            },
            { label: "Failed", value: data.transcriptions.failedCount, color: chart.danger },
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
              <div className="grid gap-4 sm:grid-cols-3">
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
                <div className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-[#09090b]">
                  <div className="mb-4 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Transcription outcomes
                    </h4>
                    <span className="text-xs text-slate-400">Ended jobs</span>
                  </div>
                  <DonutCard
                    slices={outcomes}
                    centerLabel="Ended jobs"
                    centerValue={formatCount(ended)}
                    meters
                    emptyMessage="Nothing reached a final state in this window"
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
                        Share of each signup week that has ever signed in on a later day
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
