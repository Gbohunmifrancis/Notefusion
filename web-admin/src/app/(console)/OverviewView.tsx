"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CreditCard,
  Gauge,
  Globe,
  Hourglass,
  Info,
  MailCheck,
  Music2,
  ShieldCheck,
  UserRound,
  UserRoundPlus,
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
import type { AnalyticsOverview, DailyCount } from "@/api/types";
import { Badge } from "@/components/Badge";
import { DonutCard } from "@/components/DonutCard";
import type { DonutSlice } from "@/components/DonutCard";
import { RangePicker } from "@/components/RangePicker";
import type { Range } from "@/components/RangePicker";
import { EmptyView, StateView } from "@/components/StateView";
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
  formatOffset,
  formatPercent,
  formatRelative,
  formatWeekOf,
} from "@/lib/format";
import { rememberReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";

function seedRange(overview: AnalyticsOverview): Range | null {
  const first = overview.signupsPerDay.at(0);
  const last = overview.signupsPerDay.at(-1);
  return first && last ? { from: first.date, to: last.date } : null;
}

function greeting(firstName: string): string {
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
  iconStyle: string;
}

function StatCard({ stat }: { stat: StatItem }) {
  const Icon = stat.icon;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
            <span className="truncate">{stat.title}</span>
            <span title={stat.hint ?? stat.title} className="inline-flex items-center">
              <Info size={14} className="shrink-0 text-slate-400" />
            </span>
          </div>

          <div className="mt-3 text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
            {stat.value}
          </div>

          {stat.change && (
            <div className="mt-2 flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <ArrowUpRight size={15} />
              <span>{stat.change}</span>
            </div>
          )}

          {stat.description && (
            <div className="mt-2 text-xs text-slate-400">
              {stat.description}
            </div>
          )}
        </div>

        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${stat.iconStyle}`}
        >
          <Icon size={22} strokeWidth={2} />
        </div>
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
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Signups</h2>
          <Info size={14} className="text-slate-400" />
        </div>

        <div className="flex rounded-lg border border-slate-200 p-1 text-xs font-medium dark:border-slate-800">
          <button
            onClick={() => setBucket("day")}
            className={`rounded-md px-3 py-1.5 transition ${
              bucket === "day"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            Day
          </button>
          <button
            onClick={() => setBucket("week")}
            className={`rounded-md px-3 py-1.5 transition ${
              bucket === "week"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setBucket("month")}
            className={`rounded-md px-3 py-1.5 transition ${
              bucket === "month"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            Month
          </button>
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="signupGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.7} />
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
                  <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{point.title}</p>
                    <p className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
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
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#signupGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MostTranscribedKeys({ keys }: { keys: { label: string; count: number }[] }) {
  const topKeys = keys.slice(0, 5);
  const total = keys.reduce((sum, k) => sum + k.count, 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">
            Most transcribed keys
          </h2>
          <Info size={14} className="text-slate-400" />
        </div>

        <Link href="/audit-log" className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
          View all
        </Link>
      </div>

      {topKeys.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">
          No transcriptions saved yet
        </div>
      ) : (
        <div className="space-y-2">
          {topKeys.map((key, index) => {
            const percentage = total > 0 ? Math.round((key.count / total) * 100) : 0;
            return (
              <div
                key={key.label}
                className="rounded-xl bg-slate-50 px-3.5 py-3 transition hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800/70"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-500 shadow-sm dark:bg-slate-700 dark:text-slate-300">
                    {index + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                        {key.label}
                      </span>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-semibold text-slate-800 dark:text-white">
                          {key.count}
                        </span>

                        <span className="w-8 text-right text-xs text-slate-400">
                          {percentage}%
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700">
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

function RecentActivityPanel({ items }: { items: AnalyticsOverview["recentActivity"] }) {
  const now = Date.now();
  const displayItems = items.slice(0, 4);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">Recent activity</h2>

        <Link href="/audit-log" className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
          View all activity
        </Link>
      </div>

      {displayItems.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">
          No activity recorded yet
        </div>
      ) : (
        <div className="space-y-4">
          {displayItems.map((item, index) => {
            const isSignup = item.kind === "signup";
            const isTranscription = item.kind === "transcription";

            const Icon = isSignup ? UserRoundPlus : isTranscription ? Music2 : ShieldCheck;
            const iconStyle = isSignup
              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
              : isTranscription
                ? "bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400"
                : "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400";

            const verb = isSignup ? "New user registered" : isTranscription ? "Transcription completed" : "User sign-in";

            return (
              <div key={`${item.kind}-${item.occurredAtUtc}-${index}`} className="flex items-center gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconStyle}`}>
                  <Icon size={19} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                    {verb}
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {item.title} {item.subtitle ? `• ${item.subtitle}` : ""} • {formatRelative(item.occurredAtUtc, now)}
                  </div>
                </div>

                <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  Success ✓
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const UNMEASURED = [
  {
    icon: Globe,
    metric: "Top countries and geography",
    waiting: "Needs a GeoIP provider",
    tone: "warning" as const,
    body: (
      <>
        An account does carry a country, resolved from the caller&apos;s address once at its first
        sign-in and only when a GeoIP provider is configured — so on a deployment without one it is
        null for everybody.
      </>
    ),
  },
  {
    icon: CreditCard,
    metric: "Subscribed, paid and free-tier counts",
    waiting: "Lives on System health",
    tone: "blue" as const,
    body: (
      <>
        The billing tables exist, but every figure on this page is windowed to the range above and a
        subscription count belongs to an instant instead. The live numbers are on{" "}
        <Link href="/health" className="font-medium text-brand hover:opacity-80">
          System health
        </Link>
        .
      </>
    ),
  },
  {
    icon: CalendarClock,
    metric: "Day-N retention",
    waiting: "Never recorded",
    tone: "neutral" as const,
    body: (
      <>
        Only the latest sign-in is stored, not a login history, so a cohort can be asked whether it
        ever returned and not whether it was active in week three.
      </>
    ),
  },
  {
    icon: MailCheck,
    metric: "Email verification",
    waiting: "Never recorded",
    tone: "neutral" as const,
    body: (
      <>
        There is no verification flag. The Google-linked count above is the closest honest proxy and
        is labelled as exactly that.
      </>
    ),
  },
];

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
  const firstName = user?.fullName.trim().split(/\s+/)[0] ?? "NoteFusion";

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
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">
            {greeting(firstName)} 👋
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Here&apos;s what&apos;s happening with your platform today.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-400">
            Days bucketed in {formatOffset(state.data?.reportingOffsetMinutes ?? 60)}
          </span>

          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-slate-900">
            <button
              onClick={() => setPresetDays(7)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                isPreset(7)
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              7d
            </button>
            <button
              onClick={() => setPresetDays(30)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                isPreset(30)
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              30d
            </button>
            <button
              onClick={() => setPresetDays(90)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                isPreset(90)
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              90d
            </button>
          </div>

          <button
            onClick={() => setShowRangePicker((p) => !p)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
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
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md dark:border-slate-800 dark:bg-slate-900">
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

      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span>Dashboard</span>
        <span>/</span>
        <span className="font-medium text-slate-600 dark:text-slate-300">Overview</span>
      </div>

      <StateView state={state} loadingLabel="Loading analytics">
        {(data) => {
          const stats: StatItem[] = [
            {
              title: "Total users",
              value: formatCount(data.users.totalUsers),
              change: `+${formatCount(data.users.newUsers)} vs none`,
              icon: UserRound,
              iconStyle: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400",
              hint: "Every account, all time",
            },
            {
              title: "New signups",
              value: formatCount(data.users.newUsers),
              change:
                changeAgainst(data.users.newUsers, data.users.newUsersPrevious)?.label ||
                `+${formatCount(data.users.newUsers)} vs none`,
              icon: UserRoundPlus,
              iconStyle: "bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400",
              hint: "Registered inside the window",
            },
            {
              title: "Active users",
              value: formatCount(data.users.activeUsers),
              change:
                changeAgainst(data.users.activeUsers, data.users.activeUsersPrevious)?.label ||
                `+${formatCount(data.users.activeUsers)} vs none`,
              icon: Activity,
              iconStyle: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
              hint: "Signed in within the last 30 days",
            },
            {
              title: "Google-linked",
              value: formatCount(data.users.googleVerifiedUsers),
              description: "Accounts with Google identity",
              icon: ShieldCheck,
              iconStyle: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400",
              hint: "Signed in through Google",
            },
            {
              title: "Transcriptions saved",
              value: formatCount(data.transcriptions.totalSaved),
              change:
                changeAgainst(
                  data.transcriptions.totalSaved,
                  data.transcriptions.totalSavedPrevious,
                )?.label || `+${formatCount(data.transcriptions.totalSaved)} vs none`,
              icon: Music2,
              iconStyle: "bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400",
              hint: "Saved inside the window",
            },
            {
              title: "Success rate",
              value: formatPercent(data.transcriptions.successRate),
              description: `${formatCount(data.transcriptions.succeededCount)} done, ${formatCount(
                data.transcriptions.failedCount,
              )} failed`,
              icon: CircleCheck,
              iconStyle: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
              hint: "Succeeded as a share of ended jobs",
            },
            {
              title: "Average confidence",
              value: formatPercent(data.transcriptions.averageConfidence),
              icon: Gauge,
              iconStyle: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400",
              hint: "Mean confidence across completed jobs",
            },
            {
              title: "In flight",
              value: formatCount(data.transcriptions.inFlightCount),
              description: "Right now",
              icon: Hourglass,
              iconStyle: "bg-orange-50 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400",
              hint: "Pending or processing right now",
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
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {stats.map((stat) => (
                  <StatCard key={stat.title} stat={stat} />
                ))}
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.7fr_1fr]">
                <SignupChart data={data.signupsPerDay} />
                <MostTranscribedKeys keys={data.topKeys} />
              </div>

              <div className="xl:max-w-[calc(100%-33%)]">
                <RecentActivityPanel items={data.recentActivity} />
              </div>

              <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-6">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Platform telemetry &amp; cohorts
                </h3>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                    <h4 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Transcription outcomes
                    </h4>
                    <DonutCard
                      slices={outcomes}
                      centerLabel="Ended jobs"
                      centerValue={formatCount(ended)}
                      meters
                      emptyMessage="Nothing reached a final state in this window"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                    <h4 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Signup methods
                    </h4>
                    <DonutCard
                      slices={methods}
                      centerLabel="All accounts"
                      centerValue={formatCount(methodTotal)}
                      meters
                      emptyMessage="No accounts yet"
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <h4 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Weekly cohorts
                  </h4>
                  <p className="mb-4 text-xs text-slate-400">
                    Share of each signup week that has ever signed in on a later day
                  </p>
                  {data.retention.length === 0 ? (
                    <EmptyView message="No signups in the last twelve weeks" />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className={TH}>Cohort</TableHead>
                            <TableHead className={TH}>Signups</TableHead>
                            <TableHead className={TH}>Ever returned</TableHead>
                            <TableHead className={TH}>Rate</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className={TBODY}>
                          {data.retention.map((cohort) => (
                            <TableRow key={cohort.cohortStart}>
                              <TableCell className={TD}>{formatWeekOf(cohort.cohortStart)}</TableCell>
                              <TableCell className={TD}>{formatCount(cohort.cohortSize)}</TableCell>
                              <TableCell className={TD}>{formatCount(cohort.returnedCount)}</TableCell>
                              <TableCell className={TD}>{formatPercent(cohort.retentionRate)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {UNMEASURED.map(({ icon: Icon, metric, waiting, tone, body }) => (
                    <div
                      key={metric}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        <span className="flex-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {metric}
                        </span>
                        <Badge tone={tone}>{waiting}</Badge>
                      </div>
                      <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        }}
      </StateView>
    </div>
  );
}
