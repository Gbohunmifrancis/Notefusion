"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { getEngagement } from "@/api/endpoints";
import type { CategoryCount, EngagedUser } from "@/api/types";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { DailyChart } from "@/components/DailyChart";
import { RangePicker } from "@/components/RangePicker";
import type { Range } from "@/components/RangePicker";
import { StateView } from "@/components/StateView";
import { useChartPalette } from "@/lib/chart";
import { addDays, formatRelative, reportingToday } from "@/lib/format";
import { getReportingOffset } from "@/lib/reporting";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

/** A plain bar list; the bars share one scale so the eye compares lengths. */
function Bars({ title, rows, hint }: { title: string; rows: CategoryCount[]; hint?: string }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card title={title} {...(hint ? { hint } : {})}>
      {rows.every((r) => r.count === 0) ? (
        <p className="text-[13px] text-muted-foreground">Nothing in this window yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{r.label}</span>
              <span className="h-2 rounded-full bg-muted">
                <span className="block h-2 rounded-full bg-brand" style={{ width: `${(r.count / top) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums text-foreground">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The leaderboard rows; <paramref name="compact"/> drops the less important columns for the overview card. */
function Leaderboard({ users, compact = false }: { users: EngagedUser[]; compact?: boolean }) {
  const now = Date.now();
  if (users.length === 0) return <p className="px-5 pb-5 text-[13px] text-muted-foreground">No active users in this window.</p>;
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-xs">
        <thead className="border-b border-border bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">#</th>
            <th className="px-4 py-2.5 font-medium">User</th>
            <th className="px-4 py-2.5 text-right font-medium" title="Transcriptions that produced a result">Transcribed</th>
            <th className="px-4 py-2.5 text-right font-medium" title="Days with any activity">Active days</th>
            {!compact && <th className="px-4 py-2.5 text-right font-medium">Saved</th>}
            {!compact && <th className="px-4 py-2.5 text-right font-medium" title="Visits to the web app">Web visits</th>}
            <th className="px-4 py-2.5 text-right font-medium">Last active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((u, i) => (
            <tr key={u.userId} className="hover:bg-muted/40">
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
              <td className="max-w-[16rem] px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Link href={`/users/${u.userId}`} className="truncate font-semibold text-foreground hover:text-brand">
                    {u.fullName || u.email}
                  </Link>
                  {u.isPro && <Badge tone="premium">Pro</Badge>}
                  {u.country && <span className="text-[11px] text-muted-foreground">{u.country}</span>}
                </div>
                {!compact && <div className="truncate text-[11px] text-muted-foreground">{u.email}</div>}
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-foreground">{u.transcriptions}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{u.activeDays}</td>
              {!compact && <td className="px-4 py-2.5 text-right tabular-nums">{u.saved}</td>}
              {!compact && <td className="px-4 py-2.5 text-right tabular-nums">{u.webSessions}</td>}
              <td className="px-4 py-2.5 text-right text-muted-foreground">
                <Link href={`/activity/journey?userId=${u.userId}`} className="hover:text-brand" title="Open journey">
                  {formatRelative(u.lastActiveUtc, now)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Activity page's Engagement tab: who is most active, how often people come back, and when. */
export function EngagementTab() {
  const offset = getReportingOffset();
  const today = reportingToday(offset);
  const [range, setRange] = useState<Range>({ from: addDays(today, -29), to: today });
  const chart = useChartPalette();
  const state = useQuery({
    queryKey: ["engagement", range.from, range.to, 50],
    queryFn: ({ signal }) => getEngagement(range.from, range.to, 50, signal),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          An account is active on a day when it ran a transcription, saved a sheet, did something in the web app or
          signed in. The leaderboard ranks by transcriptions ×3 + active days ×2 + saved sheets.
        </p>
        <RangePicker value={range} offsetMinutes={offset} onChange={setRange} />
      </div>

      <StateView state={state} loadingLabel="Loading engagement">
        {(e) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label="Active users" value={`${e.activeUsers}`} hint={`${e.newActiveUsers} new · ${e.returningActiveUsers} returning`} />
              <Stat label="Daily active (last day)" value={`${e.dau}`} hint={`average ${e.averageDau}`} />
              <Stat label="Weekly active" value={`${e.wau}`} hint="last 7 days of the window" />
              <Stat label="Monthly active" value={`${e.mau}`} hint="last 30 days of the window" />
              <Stat
                label="Stickiness"
                value={e.stickiness == null ? "—" : `${Math.round(e.stickiness * 100)}%`}
                hint="average daily ÷ monthly active"
              />
              <Stat
                label="Transcribers"
                value={`${e.activeUsers - (e.usersByTranscriptions.find((b) => b.label === "0")?.count ?? 0)}`}
                hint="active users who transcribed"
              />
            </div>

            <DailyChart title="Daily active users" info="Accounts active each day" data={e.dailyActiveUsers} unit="users" color={chart.series} />

            <Card title="Most active users" hint="Top 50 in this window" bleed>
              <Leaderboard users={e.topUsers} />
            </Card>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <Bars title="Transcriptions per active user" rows={e.usersByTranscriptions} hint="How many users fall in each bracket" />
              <Bars title="Busiest weekdays" rows={e.transcriptionsByWeekday} hint="Transcriptions started" />
              <Bars title="Web or app" rows={e.transcriptionsByClient} hint="Transcriptions asked for, from the activity log" />
            </div>
            <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
              <Bars title="Busiest hours" rows={e.transcriptionsByHour} hint="Transcriptions started, by hour of day (reporting time)" />
              <Bars title="What they transcribe" rows={e.transcriptionsByKind} hint="upload, song, link or score" />
            </div>
          </div>
        )}
      </StateView>
    </div>
  );
}

/** The overview's top-5 card, for the same window as the overview. */
export function MostActiveUsersCard({ from, to }: { from?: string | undefined; to?: string | undefined }) {
  const state = useQuery({
    queryKey: ["engagement", from ?? null, to ?? null, 5],
    queryFn: ({ signal }) => getEngagement(from, to, 5, signal),
    placeholderData: keepPreviousData,
  });
  return (
    <Card
      title="Most active users"
      hint={state.data ? `${state.data.activeUsers} active · ${state.data.mau} monthly active` : "In this window"}
      action={
        <Link href="/activity?tab=engagement" className="text-xs font-medium text-brand hover:underline">
          View all
        </Link>
      }
      bleed
    >
      <StateView state={state} loadingLabel="Loading most active users">
        {(e) => <Leaderboard users={e.topUsers} compact />}
      </StateView>
    </Card>
  );
}
