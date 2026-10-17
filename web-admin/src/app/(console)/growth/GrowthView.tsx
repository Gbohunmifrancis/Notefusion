"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarClock, Smartphone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { getGrowth } from "@/api/endpoints";
import type { Growth, KindHealth, PriceSetName } from "@/api/types";
import { RateMeter, Section, SectionNav, Takeaway } from "@/components/analytics/Section";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { ChartCard, DataTable, MetricRow, RankedBars } from "@/components/insights/Charts";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { EmptyView, StateView } from "@/components/StateView";
import { useChartPalette } from "@/lib/chart";
import { addDays, formatCount, formatInstantDate, formatPercent, reportingToday, UNKNOWN } from "@/lib/format";

/* Growth: the numbers the subscription business turns on that no other page had — renewals (nothing renews by
 * itself, so a member must buy again), free to paid by price set, where transcriptions fail, and which app builds
 * phones run. What the Overview and Insights already show is linked from here, not repeated. */

const SECTIONS = [
  { id: "renewals", label: "Renewals" },
  { id: "free-to-paid", label: "Free to paid" },
  { id: "transcriptions", label: "Transcription health" },
  { id: "app-versions", label: "App versions" },
] as const;

const SET_LABELS: Record<PriceSetName, { label: string; note: string }> = {
  naira: { label: "Naira", note: "Nigeria" },
  regional: { label: "Regional $", note: "Africa outside Nigeria, South & Southeast Asia" },
  standard: { label: "Standard $", note: "Every other known country" },
  unknown: { label: "Country unknown", note: "Offered naira and standard $" },
};

const KIND_LABELS: Record<KindHealth["kind"], { label: string; note: string }> = {
  recording: { label: "Recordings", note: "Hums, mic takes and plain uploads" },
  song: { label: "Song uploads", note: "Uploads with the voice isolated" },
  link: { label: "Song links", note: "YouTube, Spotify, Apple Music" },
  preview: { label: "Website previews", note: "Anonymous 30-second tries" },
};

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

/** "Ends today", "1 day left", "12 days left": whole days until an instant, rounded up. */
function timeLeft(iso: string, nowMs: number): string {
  const days = Math.ceil((new Date(iso).getTime() - nowMs) / 86_400_000);
  return days <= 0 ? "Ends today" : `${days} ${days === 1 ? "day" : "days"} left`;
}
const pct = (value: number | null, digits = 0) => (value == null ? UNKNOWN : formatPercent(value, digits));
const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

export function GrowthView() {
  const [range, setRange] = useState<Range | null>(null);
  const state = useQuery({
    queryKey: ["growth", range?.from, range?.to],
    queryFn: ({ signal }) => getGrowth(range?.from, range?.to, signal),
    placeholderData: keepPreviousData,
  });
  const offset = state.data?.reportingOffsetMinutes ?? 60;
  const picker: Range = range ?? { from: addDays(reportingToday(offset), -29), to: reportingToday(offset) };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Growth"
        subtitle="Renewals, free to paid by price set, where transcriptions fail, and which app builds phones run."
        breadcrumb={["Dashboard", "Growth"]}
      />
      <div className="flex flex-wrap items-center gap-3 nf-panel p-3">
        <RangePicker value={picker} offsetMinutes={offset} onChange={setRange} />
        <span className="text-[11px] text-muted-foreground">Memberships ending soon and app versions are as of now, whatever the dates.</span>
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      <SectionNav sections={SECTIONS} />
      <StateView state={state} loadingLabel="Loading growth">
        {(d) => <GrowthBody d={d} offset={offset} />}
      </StateView>
    </div>
  );
}

function GrowthBody({ d, offset }: { d: Growth; offset: number }) {
  return (
    <div className="space-y-8">
      <RenewalsSection d={d} offset={offset} />
      <FreeToPaidSection d={d} />
      <TranscriptionHealthSection d={d} />
      <AppVersionsSection d={d} />
    </div>
  );
}

// ── Renewals ────────────────────────────────────────────────────────────────

function RenewalsSection({ d, offset }: { d: Growth; offset: number }) {
  const c = useChartPalette();
  const r = d.renewals;
  const renewed = r.renewedEarly + r.renewedLate;
  const byKind = (label: string) => r.endingIn30DaysByKind.find((k) => k.label === label)?.count ?? 0;
  const outcomes = [
    { label: "Renewed before the end", count: r.renewedEarly, color: c.series5[0]! },
    { label: `Renewed within ${r.graceDays} days after`, count: r.renewedLate, color: c.series5[2]! },
    { label: "Lapsed", count: r.lapsed, color: c.series5[1]! },
    { label: "Still deciding", count: r.deciding, color: c.faint },
  ];
  const now = Date.now();

  return (
    <Section
      id="renewals"
      title="Renewals"
      description="Nothing renews by itself: a member buys again to add a period, which stacks after the time left. This is the membership business's churn."
    >
      <MetricRow
        items={[
          {
            label: "Ending in 7 days",
            value: formatCount(r.endingIn7Days),
            info: "Memberships whose current period ends within 7 days from now: Pro (paid or a console gift) and choirs. Each must be bought again to continue.",
          },
          {
            label: "Ending in 30 days",
            value: formatCount(r.endingIn30Days),
            note: `${formatCount(byKind("Pro, paid"))} paid · ${plural(byKind("Pro, gift"), "gift")} · ${plural(byKind("Choir"), "choir")}`,
            info: "The same, within 30 days",
          },
          {
            label: "Due in these dates",
            value: formatCount(r.dueInWindow),
            info: "Paid periods (Pro and choir) whose end fell in these dates, up to now. Periods are rebuilt from the membership payments; gifts and console extensions are not payments and are left out.",
          },
          {
            label: "Renewal rate",
            value: pct(r.renewalRate),
            note: renewed + r.lapsed ? `${formatCount(renewed)} of ${formatCount(renewed + r.lapsed)} decided` : null,
            info: `Of the due ends decided so far: the share paid again before the end or within ${r.graceDays} days after it. The rest lapsed.`,
          },
          {
            label: "Lapsed",
            value: formatCount(r.lapsed),
            tone: r.lapsed > 0 ? "down" : undefined,
            note: `No payment within ${r.graceDays} days`,
            info: `Due ends with no payment within ${r.graceDays} days after. The Overview's "Lapsed" counts every membership whose time ran out in the dates, including those still inside the ${r.graceDays} days.`,
          },
          {
            label: "Still deciding",
            value: formatCount(r.deciding),
            note: `Ended under ${r.graceDays} days ago`,
            info: `Due ends less than ${r.graceDays} days ago with no payment yet: the people to nudge now`,
          },
        ]}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <ChartCard
            title="What happened at each due end"
            info={`Every paid period that was due to end in these dates. Before the end: the member had already paid again, so the time stacked on. Within ${r.graceDays} days: paid again after it ran out.`}
            table={<DataTable head={["Outcome", "Memberships"]} rows={outcomes.map((o) => [o.label, o.count])} />}
          >
            {r.dueInWindow === 0 ? (
              <EmptyView compact icon={CalendarClock} message="No paid periods ended in these dates" hint="A monthly member's period ends a month after they pay; a yearly one, a year." />
            ) : (
              <>
                <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Due ends by outcome; the table view has the numbers">
                  {outcomes.filter((o) => o.count > 0).map((o) => (
                    <span key={o.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(o.count / r.dueInWindow) * 100}%`, background: o.color }} title={`${o.label}: ${o.count}`} />
                  ))}
                </div>
                <ul className="mt-4 space-y-2 text-xs">
                  {outcomes.map((o) => (
                    <li key={o.label} className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-foreground">
                        <span className="size-2.5 rounded-sm" style={{ background: o.color }} aria-hidden="true" />
                        {o.label}
                      </span>
                      <span className="tabular-nums text-foreground">
                        {formatCount(o.count)}
                        <span className="ml-2 text-muted-foreground">{pct(rate(o.count, r.dueInWindow))}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Takeaway>
                  Members now, new members, revenue and run-rate are on the{" "}
                  <Link href="/" className="font-medium text-brand hover:underline">Overview</Link>.
                </Takeaway>
              </>
            )}
          </ChartCard>
        </div>
        <div className="xl:col-span-7">
          <Card title="Ending soon" info="Memberships whose current period ends in the next 30 days, soonest first. Opens the account, where the console can extend it or send an email." bleed className="h-full">
            {r.endingSoon.length === 0 ? (
              <div className="p-5">
                <EmptyView compact icon={CalendarClock} message="Nothing ends in the next 30 days" />
              </div>
            ) : (
              <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto overscroll-contain">
                {r.endingSoon.map((m) => (
                  <li key={`${m.kind}-${m.userId}`} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/users/${m.userId}`} className="truncate text-[13px] font-medium text-foreground hover:text-brand">
                          {m.fullName || m.email}
                        </Link>
                        {m.kind === "choir" ? <Badge tone="blue">Choir</Badge> : m.paid ? <Badge tone="premium">Pro</Badge> : <Badge>Gift</Badge>}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {m.plan} · {m.email}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13px] tabular-nums text-foreground">{formatInstantDate(m.endsAtUtc, offset)}</p>
                      <p className="text-[11px] text-muted-foreground">{timeLeft(m.endsAtUtc, now)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Section>
  );
}

// ── Free to paid ────────────────────────────────────────────────────────────

function FreeToPaidSection({ d }: { d: Growth }) {
  const rows = d.freeToPaid;
  const total = rows.reduce((n, r) => n + r.signedUp, 0);
  const steps = [
    { key: "transcribed", label: "Transcribed", hint: "Had a transcription produce a result" },
    { key: "reachedFreeLimit", label: "Hit the free limit", hint: "Spent every free transcription of some week, on the account or its phone (the same rule as Insights)" },
    { key: "startedCheckout", label: "Started checkout", hint: "Asked for a checkout: a payment was started, whatever became of it" },
    { key: "paid", label: "Paid", hint: "Paid for anything: Pro, a choir or one song" },
  ] as const;

  return (
    <Section
      id="free-to-paid"
      title="Free to paid, by price set"
      description="The accounts that signed up in these dates, by the prices their country is offered, and how far each got, ever."
    >
      <Card
        title="From sign-up to paying"
        info="Each step counts the window's sign-ups that have reached it at any time since. The share under each count is of that set's sign-ups. Median days to pay: from signing up to the first payment, of those who paid."
        bleed
      >
        {total === 0 ? (
          <div className="p-5">
            <EmptyView compact message="No sign-ups in these dates" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Price set</th>
                  <th className="px-4 py-2.5 text-right font-medium">Signed up</th>
                  {steps.map((s) => (
                    <th key={s.key} className="px-4 py-2.5 text-right font-medium" title={s.hint}>
                      {s.label}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-right font-medium" title="Days from signing up to the first payment, the median of those who paid">
                    Median days to pay
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.set} className={r.signedUp === 0 ? "text-muted-foreground" : undefined}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground">{SET_LABELS[r.set].label}</div>
                      <div className="text-[11px] text-muted-foreground">{SET_LABELS[r.set].note}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">{formatCount(r.signedUp)}</td>
                    {steps.map((s) => (
                      <td key={s.key} className="px-4 py-2.5 text-right tabular-nums">
                        <div className="text-foreground">{formatCount(r[s.key])}</div>
                        <div className="text-[11px] text-muted-foreground">{pct(rate(r[s.key], r.signedUp))}</div>
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{r.medianDaysToPay == null ? UNKNOWN : r.medianDaysToPay.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 pb-4">
          <Takeaway>
            The whole path to paying, cut by country, platform and plan, is on{" "}
            <Link href="/insights" className="font-medium text-brand hover:underline">Insights</Link>; checkout errors are on{" "}
            <Link href="/activity" className="font-medium text-brand hover:underline">Activity</Link>.
          </Takeaway>
        </div>
      </Card>
    </Section>
  );
}

// ── Transcription health ────────────────────────────────────────────────────

function TranscriptionHealthSection({ d }: { d: Growth }) {
  const c = useChartPalette();
  const t = d.transcriptions;
  return (
    <Section id="transcriptions" title="Transcription health" description="Where transcriptions fail, by kind, and why song links are refused.">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Card title="Failures by kind" info="Jobs started in these dates. Failure rate: failed over finished (succeeded plus failed); still running is left out until it ends." bleed className="h-full">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Kind</th>
                    <th className="px-4 py-2.5 text-right font-medium">Started</th>
                    <th className="px-4 py-2.5 text-right font-medium">Succeeded</th>
                    <th className="px-4 py-2.5 text-right font-medium">Failed</th>
                    <th className="px-4 py-2.5 text-right font-medium">Running</th>
                    <th className="px-4 py-2.5 text-right font-medium">Failure rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {t.byKind.map((k) => (
                    <tr key={k.kind}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground">{KIND_LABELS[k.kind].label}</div>
                        <div className="text-[11px] text-muted-foreground">{KIND_LABELS[k.kind].note}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCount(k.started)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCount(k.succeeded)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCount(k.failed)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatCount(k.running)}</td>
                      <td className="px-4 py-2.5"><RateMeter value={k.failureRate} color={c.danger} digits={1} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 pb-4">
              <Takeaway>
                How long they take is on <Link href="/insights" className="font-medium text-brand hover:underline">Insights</Link>; hymns recognised and kept are on the{" "}
                <Link href="/" className="font-medium text-brand hover:underline">Overview</Link>; each request, with its error, is in the{" "}
                <Link href="/activity" className="font-medium text-brand hover:underline">Activity log</Link>.
              </Takeaway>
            </div>
          </Card>
        </div>
        <div className="xl:col-span-5">
          <ChartCard
            title="Song link problems"
            info="Song links asked for in these dates (accounts and website previews) that were refused before the worker took them, or failed after, by the sentence the person was shown. Each refusal reason has its own sentence."
            table={<DataTable head={["What they were told", "Links"]} rows={t.linkProblems.map((p) => [p.label, p.count])} />}
          >
            <p className="mb-3 text-xs text-muted-foreground">
              {formatCount(t.linkAttempts)} links · {formatCount(t.linkRefused)} refused ({pct(rate(t.linkRefused, t.linkAttempts))}) · {formatCount(t.linkFailed)} failed ({pct(rate(t.linkFailed, t.linkAttempts))})
            </p>
            <RankedBars rows={t.linkProblems} colorIndex={1} total={t.linkRefused + t.linkFailed} empty="No refused or failed links in these dates" />
          </ChartCard>
        </div>
      </div>
    </Section>
  );
}

// ── App versions ────────────────────────────────────────────────────────────

function AppVersionsSection({ d }: { d: Growth }) {
  const c = useChartPalette();
  const v = d.appVersions;
  const android = v.builds.reduce((n, b) => n + b.android, 0);
  const ios = v.builds.reduce((n, b) => n + b.ios, 0);
  const known = v.builds.filter((b) => b.build > 0);
  const oldest = known.length ? known[known.length - 1]!.build : null;

  return (
    <Section
      id="app-versions"
      title="App versions"
      description="Customers' phones by the native build they last registered with, beside the over-the-air code that takes practice reminders from the server: store-build reach against update reach. As of now."
    >
      <MetricRow
        items={[
          { label: "Phones", value: formatCount(v.phones), note: `${formatCount(android)} Android · ${formatCount(ios)} iOS`, info: "Customers' registered phones (push tokens). Browsers are not counted." },
          { label: "Seen in 30 days", value: formatCount(v.recent), note: v.phones ? `${pct(rate(v.recent, v.phones))} of phones` : null, info: "Phones that registered again in the last 30 days: every sign-in and app start does, so the rest are likely uninstalled or idle" },
          {
            label: "On the latest store build",
            value: v.latestBuild > 0 ? pct(rate(v.onLatestBuild, v.phones)) : "Not set",
            note: v.latestBuild > 0 ? `Build ${v.latestBuild} or newer: ${formatCount(v.onLatestBuild)}` : "AppRelease__LatestBuild is 0",
            info: "Phones whose native build is the newest store release (AppRelease__LatestBuild) or newer",
          },
          { label: "On the new reminder code", value: pct(rate(v.serverReminders, v.phones)), note: `${formatCount(v.serverReminders)} phones`, info: "Phones running the over-the-air code that takes practice reminders from the server. It ships without a store build, so it can run on older native builds." },
          { label: "Native builds in use", value: formatCount(v.builds.length), info: "Distinct native builds among customers' phones. Build 0: registered before the app reported its build." },
          { label: "Oldest known build", value: oldest == null ? UNKNOWN : `${oldest}`, info: "The oldest reported native build still registered. Phones registered before builds were reported (build 0) are left out of this one." },
        ]}
      />
      <Card title="Phones by native build" info="Newest build first. The meter is the share of that build's phones on the new reminder code." bleed>
        {v.builds.length === 0 ? (
          <div className="p-5">
            <EmptyView compact icon={Smartphone} message="No phones registered yet" hint="A phone registers when the app asks for notifications after sign-in." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Build</th>
                  <th className="px-4 py-2.5 text-right font-medium">Phones</th>
                  <th className="px-4 py-2.5 text-right font-medium">Seen in 30 days</th>
                  <th className="px-4 py-2.5 text-right font-medium">Android</th>
                  <th className="px-4 py-2.5 text-right font-medium">iOS</th>
                  <th className="px-4 py-2.5 text-right font-medium">New reminder code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {v.builds.map((b) => (
                  <tr key={b.build}>
                    <td className="px-4 py-2.5">
                      <span className="font-medium tabular-nums text-foreground">{b.build === 0 ? "Unknown" : b.build}</span>
                      {v.latestBuild > 0 && b.build >= v.latestBuild && <span className="ml-2"><Badge tone="success">Latest</Badge></span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCount(b.phones)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCount(b.recent)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatCount(b.android)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{formatCount(b.ios)}</td>
                    <td className="px-4 py-2.5"><RateMeter value={rate(b.serverReminders, b.phones)} color={c.series} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}
