import {
  Activity,
  CheckCircle2,
  Gauge,
  HardDrive,
  Hourglass,
  Music4,
  ShieldCheck,
  UserPlus,
  Users2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getOverview } from "@/api/endpoints";
import type { AnalyticsOverview } from "@/api/types";
import { BreakdownList } from "@/components/BreakdownList";
import { Card } from "@/components/Card";
import { DailyChart } from "@/components/DailyChart";
import { RangePicker } from "@/components/RangePicker";
import type { Range } from "@/components/RangePicker";
import { RecentActivity } from "@/components/RecentActivity";
import { StatCard } from "@/components/StatCard";
import { EmptyView, StateView } from "@/components/StateView";
import {
  changeAgainst,
  formatBytes,
  formatCount,
  formatDayLong,
  formatInstantDate,
  formatOffset,
  formatPercent,
  formatWeekOf,
  UNKNOWN,
} from "@/lib/format";
import { useAsync } from "@/lib/useAsync";
import { rememberReportingOffset } from "@/lib/reporting";

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

export function OverviewPage() {
  const [range, setRange] = useState<Range | null>(null);

  const fetcher = useCallback(
    (signal: AbortSignal) => getOverview(range?.from, range?.to, signal),
    [range],
  );
  const state = useAsync<AnalyticsOverview>(fetcher);

  // This is the only response that carries the offset, so the users table borrows it from here.
  const offset = state.data?.reportingOffsetMinutes;
  useEffect(() => {
    if (offset !== undefined) rememberReportingOffset(offset);
  }, [offset]);

  const picker = range ?? (state.data ? seedRange(state.data) : null);

  return (
    <div className="animate-fade-in space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Overview</h1>
          <p className="mt-1 text-sm text-muted">
            {state.data ? (
              <>
                {formatInstantDate(state.data.fromUtc, state.data.reportingOffsetMinutes)} to{" "}
                {picker ? formatDayLong(picker.to) : UNKNOWN} · days bucketed in{" "}
                {formatOffset(state.data.reportingOffsetMinutes)}
              </>
            ) : (
              "Loading the reporting window"
            )}
          </p>
        </div>

        {state.data && picker && (
          <RangePicker
            value={picker}
            offsetMinutes={state.data.reportingOffsetMinutes}
            onChange={setRange}
          />
        )}
      </header>

      <StateView state={state} loadingLabel="Loading analytics">
        {(data) => (
          <div className="space-y-6">
            {/* People */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Total users"
                value={formatCount(data.users.totalUsers)}
                hint="Every account, all time"
                icon={Users2}
              />
              <StatCard
                label="New signups"
                value={formatCount(data.users.newUsers)}
                hint="Registered inside the window"
                icon={UserPlus}
                change={changeAgainst(data.users.newUsers, data.users.newUsersPrevious)}
              />
              <StatCard
                label="Active users"
                value={formatCount(data.users.activeUsers)}
                hint="Signed in within the last 30 days"
                icon={Activity}
                change={changeAgainst(data.users.activeUsers, data.users.activeUsersPrevious)}
              />
              {/* Labelled for what it measures. It is not an email-verification count, and
                  calling it "Verified" would overstate what the schema knows. */}
              <StatCard
                label="Google-linked accounts"
                value={formatCount(data.users.googleVerifiedUsers)}
                hint="Signed in through Google, so the address is Google-verified"
                icon={ShieldCheck}
              />
            </div>

            {/* Transcription */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Transcriptions saved"
                value={formatCount(data.transcriptions.totalSaved)}
                hint="Saved inside the window"
                icon={Music4}
                change={changeAgainst(
                  data.transcriptions.totalSaved,
                  data.transcriptions.totalSavedPrevious,
                )}
              />
              <StatCard
                label="Success rate"
                value={formatPercent(data.transcriptions.successRate)}
                hint={
                  data.transcriptions.successRate === null
                    ? "Nothing reached a final state in this window"
                    : `${formatCount(data.transcriptions.succeededCount)} done, ${formatCount(
                        data.transcriptions.failedCount,
                      )} failed`
                }
                icon={CheckCircle2}
                unknown={data.transcriptions.successRate === null}
              />
              <StatCard
                label="Average confidence"
                value={formatPercent(data.transcriptions.averageConfidence)}
                hint="Mean confidence across completed transcriptions"
                icon={Gauge}
                unknown={data.transcriptions.averageConfidence === null}
              />
              <StatCard
                label="In flight"
                value={formatCount(data.transcriptions.inFlightCount)}
                hint="Pending or processing right now"
                icon={Hourglass}
              />
            </div>

            {/* Series */}
            <div className="grid gap-4 xl:grid-cols-2">
              <Card
                title="Signups per day"
                hint="Zero-filled, so a flat stretch means no signups that day"
              >
                <DailyChart
                  data={data.signupsPerDay}
                  gradientId="signups"
                  unit="signups"
                  color="#2563eb"
                />
              </Card>
              <Card
                title="Transcriptions per day"
                hint="Counted on the day the transcription was saved"
              >
                <DailyChart
                  data={data.transcriptionsPerDay}
                  gradientId="transcriptions"
                  unit="transcriptions"
                  color="#0ea5e9"
                />
              </Card>
            </div>

            {/* Breakdowns */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card
                title="Signup method"
                hint={`All accounts. "Both" linked Google to a password account.`}
              >
                <BreakdownList data={data.signupMethods} />
              </Card>
              <Card title="Push platforms" hint="Registered device tokens, all time">
                {data.devicePlatforms.length === 0 ? (
                  <EmptyView
                    message="No devices registered"
                    hint="A token appears here once a build with push enabled signs in."
                  />
                ) : (
                  <BreakdownList data={data.devicePlatforms} color="#0ea5e9" />
                )}
              </Card>
              <Card title="Most transcribed keys" hint="All saved transcriptions, all time">
                {data.topKeys.length === 0 ? (
                  <EmptyView message="No transcriptions saved yet" />
                ) : (
                  <BreakdownList data={data.topKeys} color="#1d4ed8" />
                )}
              </Card>
            </div>

            {/* Activity feed + storage — the mockup's right-rail, made honest. The feed is real
                recorded events; storage is the exact MusicXML footprint, since audio is deleted. */}
            <div className="grid gap-4 lg:grid-cols-3">
              <Card
                title="Recent activity"
                hint="Newest signups, saved transcriptions, and sign-ins across the platform"
                className="lg:col-span-2"
              >
                <RecentActivity items={data.recentActivity} />
              </Card>
              <StatCard
                label="Storage used"
                value={formatBytes(data.transcriptions.storedBytes)}
                hint="MusicXML held across all transcriptions. Audio is deleted after each job, so this is the whole footprint."
                icon={HardDrive}
              />
            </div>

            {/* Retention — deliberately not called D1/D7/D30. See the note below. */}
            <Card
              title="Weekly cohorts"
              hint="Share of each signup week that has ever signed in on a later day"
            >
              {data.retention.length === 0 ? (
                <EmptyView message="No signups in the last twelve weeks" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                        <th className="py-2 pr-4 font-semibold">Cohort</th>
                        <th className="py-2 pr-4 font-semibold">Signups</th>
                        <th className="py-2 pr-4 font-semibold">Ever returned</th>
                        <th className="py-2 font-semibold">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.retention.map((cohort) => (
                        <tr
                          key={cohort.cohortStart}
                          className="border-b border-border-light last:border-0"
                        >
                          <td className="py-2.5 pr-4 font-medium text-ink">
                            {formatWeekOf(cohort.cohortStart)}
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums text-muted">
                            {formatCount(cohort.cohortSize)}
                          </td>
                          <td className="py-2.5 pr-4 tabular-nums text-muted">
                            {formatCount(cohort.returnedCount)}
                          </td>
                          <td className="w-40 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-20 overflow-hidden rounded-pill bg-surface-alt">
                                <div
                                  className="h-full rounded-pill bg-blue"
                                  style={{
                                    width: `${(cohort.retentionRate ?? 0) * 100}%`,
                                  }}
                                />
                              </div>
                              <span
                                className={`tabular-nums text-xs ${
                                  cohort.retentionRate === null ? "text-faint" : "text-ink"
                                }`}
                              >
                                {formatPercent(cohort.retentionRate, 0)}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Account health */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card title="Password-only accounts">
                <p className="text-2xl font-semibold tabular-nums text-ink">
                  {formatCount(data.users.passwordOnlyUsers)}
                </p>
                <p className="mt-1 text-xs text-muted">No Google identity linked</p>
              </Card>
              <Card title="Locked out">
                <p className="text-2xl font-semibold tabular-nums text-ink">
                  {formatCount(data.users.lockedOutUsers)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Lockout still active from failed sign-ins
                </p>
              </Card>
              <Card title="Deactivated">
                <p className="text-2xl font-semibold tabular-nums text-ink">
                  {formatCount(data.users.deactivatedUsers)}
                </p>
                <p className="mt-1 text-xs text-muted">Accounts marked inactive</p>
              </Card>
            </div>

            {/*
              What the dashboard does not claim to know. This panel exists so that an absent
              metric reads as absent rather than as a zero, and so nobody plans against a
              number this system cannot currently produce.
            */}
            <Card title="Not measured yet" hint="Why these are missing rather than zero">
              <ul className="space-y-2 text-sm text-muted">
                <li>
                  <span className="font-medium text-ink">Top countries and geography.</span>{" "}
                  No location, IP, or locale is stored against an account or a transcription, so a
                  country breakdown would be invented, not measured. It arrives if and when the
                  schema captures a signal worth mapping.
                </li>
                <li>
                  <span className="font-medium text-ink">
                    Subscribed, paid and free-tier counts.
                  </span>{" "}
                  No subscription, plan or payment entity exists in the schema. Once pricing
                  is settled these become real columns, and only then real cards.
                </li>
                <li>
                  <span className="font-medium text-ink">Day-N retention.</span> Only the
                  latest sign-in is stored, not a login history, so a cohort can be asked
                  whether it ever returned and not whether it was active in week three.
                </li>
                <li>
                  <span className="font-medium text-ink">Email verification.</span> There is
                  no verification flag. The Google-linked count above is the closest honest
                  proxy and is labelled as exactly that.
                </li>
              </ul>
            </Card>
          </div>
        )}
      </StateView>
    </div>
  );
}
