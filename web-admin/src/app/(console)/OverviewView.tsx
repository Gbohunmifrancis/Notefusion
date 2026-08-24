"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Activity,
  CalendarClock,
  CircleCheck,
  CreditCard,
  Gauge,
  Globe,
  Hourglass,
  MailCheck,
  Music4,
  ShieldCheck,
  UserPlus,
  Users2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getOverview } from "@/api/endpoints";
import type { AnalyticsOverview } from "@/api/types";
import { Badge } from "@/components/Badge";
import { BreakdownList } from "@/components/BreakdownList";
import { Card } from "@/components/Card";
import { DailyChart } from "@/components/DailyChart";
import { DonutCard } from "@/components/DonutCard";
import type { DonutSlice } from "@/components/DonutCard";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker } from "@/components/RangePicker";
import type { Range } from "@/components/RangePicker";
import { RecentActivity } from "@/components/RecentActivity";
import { StatCard } from "@/components/StatCard";
import { StatStrip, StatTile } from "@/components/StatStrip";
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
  formatBytes,
  formatCount,
  formatOffset,
  formatPercent,
  formatWeekOf,
} from "@/lib/format";
import { rememberReportingOffset } from "@/lib/reporting";
import { TBODY, TD, TH } from "@/lib/tableClasses";

/**
 * The requested window, seeded from whatever the server actually returned.
 *
 * The daily series is the server's own list of local dates for the window, so reading the
 * first and last entry gives the picker the exact range the response describes. Deriving it
 * instead of storing it means seeding the control does not trigger a second request for the
 * window we already have.
 */
function seedRange(overview: AnalyticsOverview): Range | null {
  const first = overview.signupsPerDay.at(0);
  const last = overview.signupsPerDay.at(-1);
  return first && last ? { from: first.date, to: last.date } : null;
}

/**
 * The greeting is about the reader, not the data, so it reads the browser's clock — the
 * reporting zone is the wrong one to say good evening in.
 */
function greeting(firstName: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return firstName ? `Good ${part}, ${firstName}` : `Good ${part}`;
}

/**
 * The metrics this page is asked for and will not fake, each with the thing it is actually waiting
 * on.
 *
 * `waiting` is the reason this is a set of tiles now rather than the paragraph list it used to be.
 * All four items used to read as one undifferentiated apology, when they are in fact three
 * different situations: one an operator can clear by setting config, one that already exists on
 * another page, and two that need a column that was never written. Sorting them by that is the
 * only structure here that carries information — so it is the only structure here.
 *
 * The explanations are unchanged. They are the honest part, and shortening them to fit a tile
 * would be the one edit this panel cannot afford.
 */
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
        null for everybody. It is shown per account on the detail page; a breakdown card waits until
        the column is populated widely enough to mean something.
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
        subscription count belongs to an instant instead. The live numbers, labelled as the snapshot
        they are, are on{" "}
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

  const state = useQuery({
    queryKey: ["overview", range?.from ?? null, range?.to ?? null],
    queryFn: ({ signal }) => getOverview(range?.from, range?.to, signal),
    // A new range is a new key. Without this the whole page — eight tiles, two charts, two
    // rings — would blank to a single spinner every time the admin nudged a date.
    placeholderData: keepPreviousData,
  });

  // This is the only response that carries the offset, so the users table borrows it from here.
  const offset = state.data?.reportingOffsetMinutes;
  useEffect(() => {
    if (offset !== undefined) rememberReportingOffset(offset);
  }, [offset]);

  const picker = range ?? (state.data ? seedRange(state.data) : null);
  const firstName = user?.fullName.trim().split(/\s+/)[0] ?? "";

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title={greeting(firstName)}
        subtitle="Signups, transcriptions and account health across the platform"
        breadcrumb={["Dashboard", "Overview"]}
        actions={
          state.data &&
          picker && (
            <>
              {/* The window itself is in the date inputs; this names the zone its days were
                  bucketed in, which is the server's and not the browser's. */}
              <span className="hidden text-[11px] text-faint md:block">
                Days bucketed in {formatOffset(state.data.reportingOffsetMinutes)}
              </span>
              <RangePicker
                value={picker}
                offsetMinutes={state.data.reportingOffsetMinutes}
                onChange={setRange}
              />
            </>
          )
        }
      />

      <StateView state={state} loadingLabel="Loading analytics">
        {(data) => {
          const ended = data.transcriptions.succeededCount + data.transcriptions.failedCount;
          const outcomes: DonutSlice[] = [
            {
              label: "Succeeded",
              value: data.transcriptions.succeededCount,
              color: chart.success,
            },
            { label: "Failed", value: data.transcriptions.failedCount, color: chart.danger },
          ];
          // Ring colours for the signup-method slices, in the order the server lists them.
          const methods: DonutSlice[] = data.signupMethods.map((method, i) => ({
            label: method.label,
            value: method.count,
            color: chart.categorical[i % chart.categorical.length] ?? chart.faint,
          }));
          const methodTotal = data.signupMethods.reduce((sum, row) => sum + row.count, 0);
          /*
           * Null at zero, so the tile draws no meter. An always-empty track with "0%" beside it
           * repeats the 0 already printed above it, and on the two tiles that are normally zero —
           * locked out, deactivated — that was the whole right rail's worth of visual noise. The
           * meter appears the moment the count is real and the share means something.
           */
          const share = (count: number) =>
            count === 0 || data.users.totalUsers === 0 ? null : count / data.users.totalUsers;

          return (
            <div className="space-y-5">
              {/* People */}
              <StatStrip>
                <StatTile
                  label="Total users"
                  value={formatCount(data.users.totalUsers)}
                  hint="Every account, all time"
                  icon={Users2}
                  tone="indigo"
                />
                <StatTile
                  label="New signups"
                  value={formatCount(data.users.newUsers)}
                  hint="Registered inside the window"
                  change={changeAgainst(data.users.newUsers, data.users.newUsersPrevious)}
                  icon={UserPlus}
                  tone="violet"
                />
                <StatTile
                  label="Active users"
                  value={formatCount(data.users.activeUsers)}
                  hint="Signed in within the last 30 days"
                  change={changeAgainst(data.users.activeUsers, data.users.activeUsersPrevious)}
                  icon={Activity}
                  tone="emerald"
                />
                {/* Labelled for what it measures. It is not an email-verification count, and
                    calling it "Verified" would overstate what the schema knows. */}
                <StatTile
                  label="Google-linked"
                  value={formatCount(data.users.googleVerifiedUsers)}
                  hint="Signed in through Google, so the address is Google-verified"
                  sub="Accounts with a Google identity"
                  icon={ShieldCheck}
                  tone="cyan"
                />
              </StatStrip>

              {/* Transcription */}
              <StatStrip>
                <StatTile
                  label="Transcriptions saved"
                  value={formatCount(data.transcriptions.totalSaved)}
                  hint="Saved inside the window"
                  change={changeAgainst(
                    data.transcriptions.totalSaved,
                    data.transcriptions.totalSavedPrevious,
                  )}
                  icon={Music4}
                  tone="violet"
                />
                <StatTile
                  label="Success rate"
                  value={formatPercent(data.transcriptions.successRate)}
                  hint="Succeeded as a share of everything that reached a final state"
                  sub={
                    data.transcriptions.successRate === null
                      ? "Nothing reached a final state"
                      : `${formatCount(data.transcriptions.succeededCount)} done, ${formatCount(
                          data.transcriptions.failedCount,
                        )} failed`
                  }
                  unknown={data.transcriptions.successRate === null}
                  icon={CircleCheck}
                  tone="emerald"
                />
                <StatTile
                  label="Average confidence"
                  value={formatPercent(data.transcriptions.averageConfidence)}
                  hint="Mean confidence across completed transcriptions"
                  unknown={data.transcriptions.averageConfidence === null}
                  icon={Gauge}
                  tone="cyan"
                />
                <StatTile
                  label="In flight"
                  value={formatCount(data.transcriptions.inFlightCount)}
                  hint="Pending or processing right now, not a windowed count"
                  sub="Right now"
                  icon={Hourglass}
                  tone="orange"
                />
              </StatStrip>

              {/* Series, each beside the categorical list that reads with it */}
              <div className="grid gap-5 xl:grid-cols-3">
                <DailyChart
                  title="Signups"
                  info="Zero-filled, so a point at zero means no signups that day."
                  data={data.signupsPerDay}
                  unit="signups"
                  color={chart.series}
                  className="xl:col-span-2"
                />
                <Card title="Most transcribed keys" info="All saved transcriptions, all time">
                  {data.topKeys.length === 0 ? (
                    <EmptyView message="No transcriptions saved yet" />
                  ) : (
                    <BreakdownList data={data.topKeys} />
                  )}
                </Card>
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <DailyChart
                  title="Transcriptions"
                  info="Counted on the day the transcription was saved."
                  data={data.transcriptionsPerDay}
                  unit="transcriptions"
                  color={chart.sky}
                  className="xl:col-span-2"
                />
                <Card
                  title="Push platforms"
                  info="Registered Expo push tokens by platform, all time. A device appears here once it signs in from a build that can receive push."
                >
                  {data.devicePlatforms.length === 0 ? (
                    <EmptyView
                      message="No devices registered"
                      hint="Nothing has registered a push token yet. Expo Go and simulators cannot receive remote push, so a token only appears once a real dev or production build signs in."
                    />
                  ) : (
                    <BreakdownList data={data.devicePlatforms} />
                  )}
                </Card>
              </div>

              {/* Compositions */}
              <div className="grid gap-5 lg:grid-cols-2">
                <Card
                  title="Transcription outcomes"
                  info="Inside the window. In-flight jobs are absent because they have no outcome yet."
                >
                  <DonutCard
                    slices={outcomes}
                    centerLabel="Reached an end state"
                    centerValue={formatCount(ended)}
                    meters
                    emptyMessage="Nothing reached a final state in this window"
                  />
                </Card>
                <Card
                  title="Signup method"
                  info={`All accounts, all time. "Both" linked Google to a password account.`}
                >
                  <DonutCard
                    slices={methods}
                    centerLabel="All accounts"
                    centerValue={formatCount(methodTotal)}
                    meters
                    emptyMessage="No accounts yet"
                  />
                </Card>
              </div>

              {/* Activity feed, with the account-health tiles as its right rail. The feed is
                  real recorded events; storage is the exact MusicXML footprint, since audio
                  is deleted after each job. */}
              <div className="grid gap-5 lg:grid-cols-3">
                <Card
                  title="Recent activity"
                  info="Newest signups, saved transcriptions, and sign-ins across the platform"
                  className="lg:col-span-2"
                >
                  <RecentActivity items={data.recentActivity} />
                </Card>
                <div className="space-y-4">
                  <StatCard
                    label="Password-only accounts"
                    value={formatCount(data.users.passwordOnlyUsers)}
                    sub="No Google identity linked"
                    share={share(data.users.passwordOnlyUsers)}
                  />
                  {/* Tone follows the reading, not the label: a red or orange spine on a count of
                      zero reads as an alarm for something that is in fact the healthy state. It
                      colours up when there is actually somebody locked out or deactivated. */}
                  <StatCard
                    label="Locked out"
                    value={formatCount(data.users.lockedOutUsers)}
                    sub="Lockout still active from failed sign-ins"
                    tone={data.users.lockedOutUsers > 0 ? "warning" : "neutral"}
                    share={share(data.users.lockedOutUsers)}
                  />
                  <StatCard
                    label="Deactivated"
                    value={formatCount(data.users.deactivatedUsers)}
                    sub="Accounts marked inactive"
                    tone={data.users.deactivatedUsers > 0 ? "danger" : "neutral"}
                    share={share(data.users.deactivatedUsers)}
                  />
                  <StatCard
                    label="Storage used"
                    value={formatBytes(data.transcriptions.storedBytes)}
                    sub="MusicXML across all transcriptions"
                    hint="Audio is deleted after each job, so this is the whole stored footprint."
                    tone="neutral"
                  />
                </div>
              </div>

              {/* Retention — deliberately not called D1/D7/D30. See the note below. */}
              <Card
                title="Weekly cohorts"
                info="Share of each signup week that has ever signed in on a later day"
                bleed
              >
                {data.retention.length === 0 ? (
                  <div className="px-5 pb-5">
                    <EmptyView message="No signups in the last twelve weeks" />
                  </div>
                ) : (
                  <div className="border-t border-border">
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
                            <TableCell className={`${TD} font-medium text-foreground`}>
                              {formatWeekOf(cohort.cohortStart)}
                            </TableCell>
                            <TableCell className={`${TD} tabular-nums`}>
                              {formatCount(cohort.cohortSize)}
                            </TableCell>
                            <TableCell className={`${TD} tabular-nums`}>
                              {formatCount(cohort.returnedCount)}
                            </TableCell>
                            <TableCell className={`${TD} w-48`}>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-24 overflow-hidden rounded-pill bg-muted">
                                  <div
                                    className="h-full rounded-pill bg-brand"
                                    style={{
                                      width: `${(cohort.retentionRate ?? 0) * 100}%`,
                                    }}
                                  />
                                </div>
                                <span
                                  className={`text-xs font-semibold tabular-nums ${
                                    cohort.retentionRate === null
                                      ? "text-faint"
                                      : "text-foreground"
                                  }`}
                                >
                                  {formatPercent(cohort.retentionRate, 0)}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>

              {/*
                What the dashboard does not claim to know. This panel exists so that an absent
                metric reads as absent rather than as a zero, and so nobody plans against a
                number this system cannot currently produce. It is a grid of tiles rather than a
                paragraph list because each item is a different kind of "missing" — see UNMEASURED.
              */}
              <Card
                title="Not measured yet"
                hint="Why these read as missing rather than zero — and what each is waiting on"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {UNMEASURED.map(({ icon: Icon, metric, waiting, tone, body }) => (
                    <div
                      key={metric}
                      className="flex flex-col gap-2.5 rounded-sm border border-border-light bg-muted p-4"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-card text-muted-foreground shadow-hairline">
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        <span className="flex-1 text-[13px] font-semibold text-foreground">
                          {metric}
                        </span>
                        <Badge tone={tone}>{waiting}</Badge>
                      </div>
                      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          );
        }}
      </StateView>
    </div>
  );
}
