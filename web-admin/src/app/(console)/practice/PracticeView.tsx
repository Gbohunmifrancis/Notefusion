"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AudioLines, BellOff, Flame, Medal, Route } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { getPracticeAnalytics, getPracticeReminderLog } from "@/api/endpoints";
import type {
  DailyCount,
  PathTrackStat,
  PracticeAnalytics,
  PracticeReminderKindName,
  PracticeReminderOverview,
  PracticeTrackName,
} from "@/api/types";
import { RateMeter, Section, SectionNav, Takeaway } from "@/components/analytics/Section";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Card } from "@/components/Card";
import { DailyChart } from "@/components/DailyChart";
import { ChartCard, DataTable, MetricRow, RankedBars, StackedDaily, rampColor } from "@/components/insights/Charts";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { Segmented } from "@/components/Segmented";
import { EmptyView, StateView, type QueryState } from "@/components/StateView";
import { StatStrip, StatTile } from "@/components/StatStrip";
import { useChartPalette } from "@/lib/chart";
import {
  addDays,
  changeAgainst,
  formatCount,
  formatDayLong,
  formatDayShort,
  formatPercent,
  formatRelative,
  formatWeekOf,
  reportingToday,
  UNKNOWN,
} from "@/lib/format";

/* Practice: who practises and how much, whether it brings them back, streaks, where singers get to on the path and
 * where they stall, the daily drill allowance, reminders and badges. Every figure is read off the rows the server
 * writes when a take is marked (GET /api/admin/analytics/practice); nothing is reported by a client. */

const SECTIONS = [
  { id: "practisers", label: "Practisers" },
  { id: "retention", label: "Coming back" },
  { id: "streaks", label: "Streaks" },
  { id: "path", label: "The path" },
  { id: "allowance", label: "Drill allowance" },
  { id: "reminders", label: "Reminders" },
  { id: "badges", label: "Badges" },
] as const;

const TRACKS = [
  { value: "none", label: "No track" },
  { value: "playful", label: "Playful" },
  { value: "focused", label: "Focused" },
] as const satisfies readonly { value: PracticeTrackName; label: string }[];

const KIND_LABELS: Record<PracticeReminderKindName, { label: string; hint: string }> = {
  ordinary: { label: "Ordinary", hint: "A one-day streak: today would make it two" },
  streakAtRisk: { label: "Streak at risk", hint: "A streak of two or more ends at midnight unless today is practised" },
  freezeReady: { label: "Freeze ready", hint: "This week's freeze would carry today over, if skipped" },
  lastChance: { label: "Last chance", hint: "21:30, a streak of three or more with no freeze to save it" },
  streakLost: { label: "Streak lost", hint: "The first day after a streak of two or more ended" },
  learningWaiting: { label: "Lessons waiting", hint: "A lapsed singer, on days 1, 2, 3, 5, 7, 14 and 30 after their last practice" },
  final: { label: "Final", hint: "\"We'll stop reminding you\", 45 days after the last practice; nothing follows until they practise" },
};
const KIND_ORDER: PracticeReminderKindName[] = ["ordinary", "streakAtRisk", "freezeReady", "lastChance", "streakLost", "learningWaiting", "final"];

const rate = (num: number, den: number) => (den > 0 ? num / den : null);
const points = (diff: number) => Math.round(diff * 100);
const pct = (value: number | null, digits = 0) => (value == null ? UNKNOWN : formatPercent(value, digits));
const series = (rows: PracticeAnalytics["daily"], pick: (d: PracticeAnalytics["daily"][number]) => number): DailyCount[] =>
  rows.map((d) => ({ date: d.date, count: pick(d) }));

export function PracticeView() {
  const [range, setRange] = useState<Range | null>(null);
  const state = useQuery({
    queryKey: ["practice-analytics", range?.from, range?.to],
    queryFn: ({ signal }) => getPracticeAnalytics(range?.from, range?.to, signal),
    placeholderData: keepPreviousData,
  });
  const offset = state.data?.reportingOffsetMinutes ?? 60;
  const picker: Range = range ?? { from: addDays(reportingToday(offset), -29), to: reportingToday(offset) };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Practice"
        subtitle="Singers practising in the phone app: how many, how often they come back, how far they get on the path, and what reminders and the drill allowance do."
        breadcrumb={["Dashboard", "Practice"]}
      />
      <div className="flex flex-wrap items-center gap-3 nf-panel p-3">
        <RangePicker value={picker} offsetMinutes={offset} onChange={setRange} />
        <span className="text-[11px] text-muted-foreground">
          Takes and reminders count on each singer&apos;s own calendar day, the day their streak counts.
        </span>
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      <SectionNav sections={SECTIONS} />
      <StateView state={state} loadingLabel="Loading practice">
        {(d) => <PracticeBody d={d} />}
      </StateView>
    </div>
  );
}

function PracticeBody({ d }: { d: PracticeAnalytics }) {
  const c = useChartPalette();
  const k = d.headline;
  const noPractice = k.practisers === 0 && k.mau === 0;

  return (
    <div className="space-y-8">
      {noPractice && (
        <div className="nf-panel">
          <EmptyView
            icon={AudioLines}
            message="No practice in these dates yet"
            hint="Practice ships in the phone app's update. Marked takes appear here as soon as singers on the new version sing their first drill. Reminders and how far the update has reached are further down."
          />
        </div>
      )}

      <Section id="practisers" title="Practisers" description="Who practised in these dates, how much, and how well.">
        <StatStrip className="xl:grid-cols-5">
          <StatTile
            label="Practisers"
            value={formatCount(k.practisers)}
            change={changeAgainst(k.practisers, k.practisersPrevious)}
            sub={`DAU ${formatCount(k.dau)} · WAU ${formatCount(k.wau)} · MAU ${formatCount(k.mau)}`}
            hint="Singers with at least one marked take (a drill or a part of a sheet) on a day in these dates. DAU, WAU and MAU: practisers on the last day, in the last 7 and in the last 30 days of the range."
          />
          <StatTile
            label="Marked takes"
            value={formatCount(k.takes)}
            change={changeAgainst(k.takes, k.takesPrevious)}
            sub={`${formatCount(k.drills)} drills · ${formatCount(k.parts)} parts`}
            hint="Takes the server marked: lesson-path drills, and parts of sheets sung back (Pro). Compared with the same number of days before."
          />
          <StatTile
            label="Takes per practiser-day"
            value={k.takesPerPractiserDay == null ? UNKNOWN : k.takesPerPractiserDay.toFixed(1)}
            unknown={k.takesPerPractiserDay == null}
            sub={`${k.averageDau.toFixed(1)} practisers a day`}
            hint="Marked takes divided by the days singers practised: how long a session is, in takes."
          />
          <StatTile
            label="Average score"
            value={k.averageScore == null ? UNKNOWN : k.averageScore.toFixed(0)}
            unknown={k.averageScore == null}
            sub="Out of 100"
            hint="The mean mark of the window's takes. 80 passes a drill; under 50 twice in a row steps back."
          />
          <StatTile
            label="XP earned"
            value={formatCount(k.xpEarned)}
            sub={`${formatCount(k.newPractisers)} singers new to practice`}
            hint="XP the window's takes earned, each singer's day held to the 150 XP daily cap, exactly as the app counts it. New: first marked take ever in these dates."
          />
        </StatStrip>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7 xl:col-span-8">
            <DailyChart
              className="h-full"
              title="Practisers per day"
              info="Singers with a marked take that day, on their own calendar."
              data={series(d.daily, (x) => x.practisers)}
              unit="practisers"
              color={c.series}
            />
          </div>
          <div className="lg:col-span-5 xl:col-span-4">
            <Card title="Practisers by track" info="The window's practisers by the track they have chosen now. A track is a style, never an age." className="h-full">
              {k.practisers === 0 ? (
                <EmptyView compact icon={Route} message="No practisers in these dates" hint="Singers pick Playful or Focused on the Practice screen; until then they are on no track." />
              ) : (
                <>
                  <RankedBars rows={k.practisersByTrack} colorIndex={0} />
                  <Takeaway>
                    {formatPercent(rate(k.practisersByTrack.find((t) => t.label === "Not chosen")?.count ?? 0, k.practisers), 0)} have not chosen a track yet.
                  </Takeaway>
                </>
              )}
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7 xl:col-span-8">
            <ChartCard
              title="Marked takes per day"
              info="Drills on the lesson path and parts of sheets sung back, on the singer's own day."
              legend={[
                { label: "Drills", color: c.series5[0]! },
                { label: "Parts", color: c.series5[1]! },
              ]}
              table={<DataTable head={["Day", "Drills", "Parts", "Practisers"]} rows={d.daily.map((x) => [formatDayShort(x.date), x.drills, x.parts, x.practisers])} />}
            >
              {k.takes === 0 ? (
                <EmptyView compact icon={AudioLines} message="No marked takes in these dates" hint="A take is marked when a drill or a part is sung and the server grades it." />
              ) : (
                <StackedDaily data={d.daily} series={[{ key: "drills", label: "Drills" }, { key: "parts", label: "Parts" }]} unit="takes" />
              )}
            </ChartCard>
          </div>
          <div className="lg:col-span-5 xl:col-span-4">
            <DailyChart className="h-full" title="XP earned per day" info="Each singer's day held to the 150 XP cap." data={series(d.daily, (x) => x.xp)} unit="XP" color={c.series5[2]!} />
          </div>
        </div>
      </Section>

      <RetentionSection d={d} />
      <StreaksSection d={d} />
      <PathSection d={d} />
      <AllowanceSection d={d} />
      <RemindersSection d={d} />
      <BadgesSection d={d} />
    </div>
  );
}

// ── Coming back ─────────────────────────────────────────────────────────────

function RetentionSection({ d }: { d: PracticeAnalytics }) {
  const c = useChartPalette();
  const r = d.retention;
  const both = r.practiserRate != null && r.otherRate != null;

  return (
    <Section
      id="retention"
      title="Coming back"
      description="Whether new singers practise again, and whether practising keeps people using the app."
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Card
            title="First-practice cohorts"
            info="Each row: the singers whose first marked take ever fell in that week (Monday to Sunday, their own calendar). D1, D7, D30: the share who had a take marked exactly 1, 7 and 30 days after their first day. A singer counts only once that day is over; blank: no one has reached it yet."
            bleed
            className="h-full"
          >
            {r.cohorts.length === 0 ? (
              <div className="p-5">
                <EmptyView compact message="No new singers in these dates" hint="A cohort is the week of a singer's first marked take. Its D1, D7 and D30 fill in as those days pass." />
              </div>
            ) : (
              <div className="overflow-x-auto px-5 pb-5 sm:px-6">
                <table className="w-full min-w-[19rem] text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-2.5 text-left font-medium">First practised</th>
                      <th className="py-2.5 text-right font-medium">Singers</th>
                      {(["D1", "D7", "D30"] as const).map((h) => (
                        <th key={h} className="py-2.5 text-center font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {r.cohorts.map((cohort) => (
                      <tr key={cohort.weekStart}>
                        <td className="py-1 pr-3 text-foreground">{formatWeekOf(cohort.weekStart)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums text-foreground">{formatCount(cohort.singers)}</td>
                        {([
                          [cohort.d1, cohort.eligibleD1],
                          [cohort.d7, cohort.eligibleD7],
                          [cohort.d30, cohort.eligibleD30],
                        ] as const).map(([v, eligible], i) => (
                          <td key={i} className="p-0.5">
                            {v == null ? (
                              <span className="flex h-7 items-center justify-center text-faint" title="No one in this cohort has reached this day yet">·</span>
                            ) : (
                              <span
                                className={`flex h-7 items-center justify-center rounded-[3px] tabular-nums ${v >= 0.5 ? "text-white" : "text-foreground"}`}
                                style={{ background: rampColor(c.ramp, v, 1) }}
                                title={`${formatPercent(v, 0)} of ${eligible} singers who have reached the day`}
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
              </div>
            )}
          </Card>
        </div>
        <div className="xl:col-span-5">
          <ChartCard
            title="Does practice bring people back?"
            info="For every Monday–Sunday week (reporting days) starting in these dates whose following week is over: the accounts active in it, split by whether they had a take marked that week, and the share of each active again the next week. Active: started a transcription, saved a sheet, did something signed in on the web, had a take marked, or was last seen then. One account in one week is one account-week."
            table={
              <DataTable
                head={["Week", "Practised", "Back", "Didn't practise", "Back"]}
                rows={r.weeks.map((w) => [formatWeekOf(w.weekStart), w.practisersActive, w.practisersBack, w.othersActive, w.othersBack])}
              />
            }
          >
            {r.weeks.length === 0 ? (
              <EmptyView compact message="Not enough time yet" hint="This needs a full week inside these dates and the week after it to have ended. Pick a range that starts at least two weeks ago." />
            ) : (
              <div className="space-y-5">
                <ReturnBar label="Practised that week" rate={r.practiserRate} back={r.practiserWeeksBack} of={r.practiserWeeks} color={c.series5[0]!} />
                <ReturnBar label="Active, but did not practise" rate={r.otherRate} back={r.otherWeeksBack} of={r.otherWeeks} color={c.faint} />
                <Takeaway>
                  {both
                    ? r.practiserRate! >= r.otherRate!
                      ? `Practisers came back the next week ${points(r.practiserRate! - r.otherRate!)} points more often. They are keener to begin with, so read it as a signal, not proof.`
                      : `Practisers came back less often than other active accounts, by ${points(r.otherRate! - r.practiserRate!)} points.`
                    : "One of the two groups has no account-weeks yet."}
                </Takeaway>
              </div>
            )}
          </ChartCard>
        </div>
      </div>
    </Section>
  );
}

function ReturnBar({ label, rate: value, back, of, color }: { label: string; rate: number | null; back: number; of: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-foreground">{label}</span>
        <span className="text-xl font-semibold tracking-[-0.01em] text-foreground tabular-nums">{pct(value)}</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-muted" aria-hidden="true">
        <div className="h-2.5 rounded-full" style={{ width: `${(value ?? 0) * 100}%`, background: color }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {formatCount(back)} of {formatCount(of)} account-weeks active the week after
      </p>
    </div>
  );
}

// ── Streaks ─────────────────────────────────────────────────────────────────

function StreaksSection({ d }: { d: PracticeAnalytics }) {
  const s = d.streaks;
  const count = (label: string) => s.current.find((b) => b.label === label)?.count ?? 0;
  const onStreak = s.current.filter((b) => b.label !== "0").reduce((n, b) => n + b.count, 0);
  const total = s.current.reduce((n, b) => n + b.count, 0);

  return (
    <Section
      id="streaks"
      title="Streaks"
      description={`Days practised in a row, as the app counts them (one freeze a week bridges a missed day), read at the end of ${formatDayLong(s.asOf)}.`}
    >
      <MetricRow
        items={[
          { label: "On a streak", value: formatCount(onStreak), note: total ? `${pct(rate(onStreak, total))} of practisers` : null, info: "The window's practisers whose current streak is one day or more at the end of the range" },
          { label: "8 days or more", value: formatCount(count("8–29") + count("30+")), info: "Practisers with a current streak of at least eight days" },
          { label: "Longest running", value: s.longest[0] ? `${s.longest[0].current} days` : UNKNOWN, info: "The longest current streak among the window's practisers" },
          { label: "Freezes used", value: formatCount(s.freezesUsed), info: "Missed days in these dates that the week's freeze bridged, keeping a streak alive" },
          { label: "Streaks broken", value: formatCount(s.streaksBroken), info: "Streaks of two days or more that ended in these dates: the first missed day no freeze bridged (the day the app says it slipped)" },
          { label: "Best ever", value: s.longest.length ? `${Math.max(...s.longest.map((l) => l.best))} days` : UNKNOWN, info: "The longest streak any singer on the list below has ever had" },
        ]}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <ChartCard
          title="Current streaks"
          info="The window's practisers by the streak they hold at the end of the range. 0: practised in these dates, but the streak has since ended."
          table={<DataTable head={["Streak (days)", "Practisers"]} rows={s.current.map((b) => [b.label, b.count])} />}
        >
          {total === 0 ? (
            <EmptyView compact icon={Flame} message="No practisers in these dates" />
          ) : (
            <RankedBars rows={s.current.map((b) => ({ label: `${b.label} ${b.label === "1" ? "day" : "days"}`, count: b.count }))} colorIndex={0} />
          )}
        </ChartCard>
        <Card title="Longest streaks" info="The window's practisers with the longest streaks running at the end of the range. Opens their account." className="h-full" bleed>
          {s.longest.length === 0 ? (
            <div className="p-5">
              <EmptyView compact icon={Flame} message="No streaks running" hint="A streak starts with one day practised and grows with each day after." />
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {s.longest.map((l, i) => (
                <li key={l.userId} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/users/${l.userId}`} className="block truncate text-[13px] font-medium text-foreground hover:text-brand">
                      {l.fullName || l.email}
                    </Link>
                    <p className="truncate text-[11px] text-muted-foreground">
                      Best {l.best} · last practised {formatDayShort(l.lastPractised)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">
                    {l.current} {l.current === 1 ? "day" : "days"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <ChartCard
          title="Streaks broken per day"
          info="Streaks of two days or more that ended that day: the first missed day no freeze bridged. The table adds the freezes used each day."
          table={<DataTable head={["Day", "Broken", "Freezes used"]} rows={d.daily.map((x) => [formatDayShort(x.date), x.streaksBroken, x.freezesUsed])} />}
        >
          {s.streaksBroken === 0 && s.freezesUsed === 0 ? (
            <EmptyView compact icon={Flame} message="No streak ended in these dates" hint="A streak of two days or more ends on the first missed day the week's freeze does not bridge." />
          ) : (
            <StackedDaily data={d.daily} series={[{ key: "streaksBroken", label: "Streaks broken" }]} unit="streaks broken" />
          )}
        </ChartCard>
      </div>
    </Section>
  );
}

// ── The path ────────────────────────────────────────────────────────────────

const MIN_TAKES_TO_RANK = 5;

function PathSection({ d }: { d: PracticeAnalytics }) {
  const c = useChartPalette();
  const [track, setTrack] = useState<PracticeTrackName>(() => busiestTrack(d.path));
  const t = d.path.find((p) => p.track === track) ?? d.path[0]!;
  const units = useMemo(
    () =>
      t.grades
        .flatMap((g) => g.units.map((u) => ({ ...u, grade: g.label })))
        .filter((u) => u.takes > 0)
        .sort(
          (a, b) =>
            Number(b.takes >= MIN_TAKES_TO_RANK) - Number(a.takes >= MIN_TAKES_TO_RANK) ||
            (a.passRate ?? 1) - (b.passRate ?? 1) ||
            (b.stepBackRate ?? 0) - (a.stepBackRate ?? 0) ||
            b.takes - a.takes,
        ),
    [t],
  );
  const unitsDone = d.daily.reduce((n, x) => n + x.unitsCompleted, 0);
  const gradesDone = d.daily.reduce((n, x) => n + x.gradesCompleted, 0);
  const reachedGrades = t.grades.filter((g) => g.reached > 0);
  const furthest = reachedGrades.at(-1);
  const trackLabel = TRACKS.find((x) => x.value === track)!.label;

  return (
    <Section
      id="path"
      title="The path"
      description="Grades → units → drills, sung in order. Each singer's path is replayed from their marked drills exactly as the app reads it."
      action={
        <Segmented
          label="Track"
          options={TRACKS.map((x) => ({ value: x.value, label: `${x.label} · ${d.path.find((p) => p.track === x.value)?.singers ?? 0}` }))}
          value={track}
          onChange={setTrack}
        />
      }
    >
      <MetricRow
        items={[
          { label: "Singers on this path", value: formatCount(t.singers), info: "Singers with a marked drill that moved this track's path in these dates. A singer's path is the track they sang on; each track keeps its own place." },
          { label: "Path takes", value: formatCount(t.takes), info: "Marked drills that moved this path in these dates. A drill sung again for practice, or from an old screen, earns XP but does not move the path, so it is not here." },
          { label: "Furthest grade reached", value: furthest ? furthest.label : UNKNOWN, info: "The highest grade any of these singers' paths has reached by the end of the range" },
          { label: "Units completed", value: formatCount(unitsDone), note: "All tracks", info: "Unit milestones reached in these dates, on any track: each unit once per singer, as the app announces it" },
          { label: "Grades completed", value: formatCount(gradesDone), note: "All tracks", info: "Grade milestones reached in these dates, on any track" },
          { label: "Pass rate", value: pct(rate(units.reduce((n, u) => n + Math.round((u.passRate ?? 0) * u.takes), 0), t.takes)), info: "Path takes marked 80 or more, which pass the drill" },
        ]}
      />

      {t.singers === 0 ? (
        <div className="nf-panel">
          <EmptyView
            icon={Route}
            message={`No one moved the ${trackLabel === "No track" ? "no-track" : trackLabel} path in these dates`}
            hint={track === "focused" ? "Focused starts two grades ahead of the singer's level, for those who want the work." : "Singers appear here once a marked drill moves their path."}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-5">
              <ChartCard
                title="How far singers got"
                info="Of the singers on this path in these dates: how many their path has taken to each grade by the end of the range (it was, or is, the grade offered to them), and how many finished it. Focused starts two grades ahead of the singer's level, so its first grades can hold fewer singers than later ones."
                table={<DataTable head={["Grade", "Reached", "Completed", "Takes"]} rows={t.grades.map((g) => [g.label, g.reached, g.completed, g.takes])} />}
              >
                <RankedBars
                  rows={t.grades.map((g) => ({ label: g.label, count: g.reached, note: `${formatCount(g.completed)} completed` }))}
                  colorIndex={0}
                  total={t.singers}
                />
              </ChartCard>
            </div>
            <div className="xl:col-span-7">
              <Card
                title="Where singers stall"
                info={`Units ranked by the lowest pass rate, then the highest step-back rate, over the takes sung there in these dates. Pass: marked 80+. Retry: sung at a drill already missed (the same drill again, or an easier variant). Step back: the second take under 50 in a row that day, which moves the singer back a drill. Units with fewer than ${MIN_TAKES_TO_RANK} takes are listed after the rest.`}
                bleed
                className="h-full"
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-xs">
                    <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Unit</th>
                        <th className="px-4 py-2.5 text-right font-medium">Takes</th>
                        <th className="px-4 py-2.5 text-right font-medium">Pass</th>
                        <th className="px-4 py-2.5 text-right font-medium">Retry</th>
                        <th className="px-4 py-2.5 text-right font-medium">Step back</th>
                        <th className="px-4 py-2.5 text-right font-medium">Avg score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {units.slice(0, 8).map((u) => (
                        <tr key={u.code} className={u.takes < MIN_TAKES_TO_RANK ? "opacity-70" : undefined}>
                          <td className="max-w-[16rem] px-4 py-2.5">
                            <div className="truncate font-medium text-foreground">{u.title}</div>
                            <div className="whitespace-nowrap text-[11px] text-muted-foreground" title={`${formatCount(u.reached)} singers reached this unit`}>
                              {u.grade} · unit {u.unitNumber}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCount(u.takes)}</td>
                          <td className="px-4 py-2.5"><RateMeter value={u.passRate} color={c.series5[2]!} /></td>
                          <td className="px-4 py-2.5"><RateMeter value={u.retryRate} color={c.series5[3]!} /></td>
                          <td className="px-4 py-2.5"><RateMeter value={u.stepBackRate} color={c.series5[1]!} /></td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{u.averageScore == null ? UNKNOWN : u.averageScore.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {units.length === 0 && <p className="px-5 py-6 text-center text-xs text-muted-foreground">No path takes in these dates</p>}
                </div>
              </Card>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            <div className="xl:col-span-5">
              <Card title="Average score by grade" info="The mean mark of this path's takes in each grade, on a fixed 0–100 scale. 80 passes." className="h-full">
                <ScoreBars rows={t.grades.filter((g) => g.takes > 0).map((g) => ({ label: g.label, score: g.averageScore, takes: g.takes }))} color={c.series5[0]!} />
              </Card>
            </div>
            <div className="xl:col-span-7">
              <ChartCard
                title="Milestones per day"
                info="Units and grades completed, on any track, on the day the take that finished them was sung. Each is a milestone once per singer, as the app announces it."
                legend={[
                  { label: "Units", color: c.series5[0]! },
                  { label: "Grades", color: c.series5[1]! },
                ]}
                table={<DataTable head={["Day", "Units", "Grades"]} rows={d.daily.map((x) => [formatDayShort(x.date), x.unitsCompleted, x.gradesCompleted])} />}
              >
                <StackedDaily data={d.daily} series={[{ key: "unitsCompleted", label: "Units" }, { key: "gradesCompleted", label: "Grades" }]} unit="milestones" />
              </ChartCard>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function busiestTrack(path: PathTrackStat[]): PracticeTrackName {
  return [...path].sort((a, b) => b.singers - a.singers)[0]?.track ?? "none";
}

function ScoreBars({ rows, color }: { rows: { label: string; score: number | null; takes: number }[]; color: string }) {
  if (rows.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">No path takes in these dates</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-xs" title={`${r.label}: ${r.score ?? UNKNOWN} average over ${r.takes} takes`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-foreground">{r.label}</span>
            <span className="shrink-0 tabular-nums text-foreground">
              {r.score == null ? UNKNOWN : r.score.toFixed(0)}
              <span className="ml-2 text-muted-foreground">{formatCount(r.takes)} takes</span>
            </span>
          </div>
          <div className="relative mt-1 h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full" style={{ width: `${r.score ?? 0}%`, background: color }} />
            {/* The pass mark, so a grade's average reads against it. */}
            <span className="absolute -top-0.5 h-3 w-px bg-foreground/40" style={{ left: "80%" }} aria-hidden="true" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Drill allowance ─────────────────────────────────────────────────────────

function AllowanceSection({ d }: { d: PracticeAnalytics }) {
  const a = d.allowance;
  return (
    <Section
      id="allowance"
      title="Daily drill allowance"
      description={`A free account may have ${a.freeLimit} drills marked a day, Pro ${a.proLimit}. Who reaches it, and whether free singers who do go on to buy.`}
    >
      <MetricRow
        items={[
          {
            label: "Reached the limit",
            value: formatCount(a.hitLimit),
            note: a.drillSingers ? `${pct(rate(a.hitLimit, a.drillSingers))} of ${formatCount(a.drillSingers)} drill singers` : null,
            info: "Singers who had their day's last allowed drill marked at least once in these dates: ten while not on Pro, twenty on Pro",
          },
          { label: `Free limit (${a.freeLimit})`, value: formatCount(a.hitFreeLimit), info: "Singers who reached ten drills in a day while not on Pro (their membership, or a choir seat, did not cover that moment)" },
          { label: `Pro limit (${a.proLimit})`, value: formatCount(a.hitProLimit), info: "Singers who reached twenty drills in a day" },
          { label: "Days at the limit", value: formatCount(a.limitDays), info: "Singer-days that reached the limit" },
          {
            label: "Bought within 7 days",
            value: formatCount(a.bought),
            note: a.freeHittersDecided ? `${pct(a.conversionRate)} of ${formatCount(a.freeHittersDecided)} free singers` : `${formatCount(a.freeHitters)} free singers, none decided yet`,
            info: "Of the free singers who reached the limit, those who bought anything (Pro, a choir, one song) within seven days after their first time. The rate counts only singers whose seven days are over, or who bought already.",
          },
          {
            label: "What they bought",
            value: a.bought ? `${formatCount(a.boughtMembership)} · ${formatCount(a.boughtSingle)}` : UNKNOWN,
            note: "Pro or a choir · one song",
            info: "Of the free singers who bought within seven days: a membership, or a one-song purchase only",
          },
        ]}
      />
    </Section>
  );
}

// ── Reminders ───────────────────────────────────────────────────────────────

const REMINDER_GROUPS = [
  { key: "alive", label: "Streak alive" },
  { key: "lastChance", label: "Last chance" },
  { key: "lapsed", label: "After a lapse" },
] as const;

function RemindersSection({ d }: { d: PracticeAnalytics }) {
  const c = useChartPalette();
  const r = d.reminders;
  const log = useQuery({ queryKey: ["practice-reminder-log", 30], queryFn: ({ signal }) => getPracticeReminderLog(30, signal) });
  const grouped = d.reminders.daily.map((x) => ({
    date: x.date,
    alive: x.ordinary + x.streakAtRisk + x.freezeReady,
    lastChance: x.lastChance,
    lapsed: x.streakLost + x.learningWaiting + x.final,
  }));
  const attempted = r.sent + r.failed;

  return (
    <Section
      id="reminders"
      title="Reminders"
      description="Server pushes to phones on the new app code, at the singer's hour on a day not yet practised, and on the lapse schedule. A reminder converts when a take is marked after it."
      action={
        log.data ? (
          <Badge tone={log.data.enabled ? "success" : "warning"} title="PracticeReminders__Enabled">
            {log.data.enabled ? "Sweep is sending" : "Sweep is off"}
          </Badge>
        ) : undefined
      }
    >
      <MetricRow
        items={[
          { label: "Sent", value: formatCount(r.sent), note: `to ${formatCount(r.accountsReminded)} singers`, info: "Reminders Expo accepted, on the singers' days in these dates" },
          { label: "Practised within 2 hours", value: pct(rate(r.practisedWithin2h, r.sent)), note: `${formatCount(r.practisedWithin2h)} reminders`, info: "Sent reminders followed by a marked take within two hours of the send" },
          { label: "Practised the same day", value: pct(rate(r.practisedSameDay, r.sent)), note: `${formatCount(r.practisedSameDay)} reminders`, info: "Sent reminders followed by a marked take later on the same local day" },
          { label: "Failed", value: formatCount(r.failed), note: attempted ? `${pct(rate(r.failed, attempted), 1)} of sends` : null, tone: r.failed > 0 ? "down" : undefined, info: "Sends Expo refused or did not answer (after the one retry)" },
          { label: "Switched off", value: pct(rate(r.remindersOff, r.remindersApplicable), 1), note: `${formatCount(r.remindersOff)} of ${formatCount(r.remindersApplicable)} accounts, now`, info: "Accounts whose reminder switch is off, of those reminders apply to (practised, chose a track, or set the switch). A snapshot of now: the switch keeps no history." },
          { label: "\"We'll stop\" sent", value: formatCount(r.finalSent), note: `${formatCount(r.finalCameBack)} came back since`, info: "The last reminder of a lapse, sent in these dates. Came back: has had a take marked since; the rest are no longer reminded." },
        ]}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <ChartCard
            title="Reminders sent per day"
            info="By the singer's day. Streak alive: ordinary, streak at risk, freeze ready. After a lapse: streak lost, lessons waiting, final. The table has every kind."
            legend={REMINDER_GROUPS.map((g, i) => ({ label: g.label, color: c.series5[i]! }))}
            table={
              <DataTable
                head={["Day", ...KIND_ORDER.map((k) => KIND_LABELS[k].label), "Failed"]}
                rows={r.daily.map((x) => [formatDayShort(x.date), x.ordinary, x.streakAtRisk, x.freezeReady, x.lastChance, x.streakLost, x.learningWaiting, x.final, x.failed])}
              />
            }
          >
            {attempted === 0 ? (
              <EmptyView compact icon={BellOff} message="No reminders in these dates" hint="Reminders go only to phones on the app code that takes them from the server; older code reminds on the phone itself." />
            ) : (
              <StackedDaily data={grouped} series={[...REMINDER_GROUPS]} unit="reminders" />
            )}
          </ChartCard>
        </div>
        <div className="xl:col-span-5">
          <Card title="By kind" info="Each kind's sends and what singers did after them. Rates are of that kind's sent reminders." bleed className="h-full">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left text-xs">
                <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Kind</th>
                    <th className="px-4 py-2.5 text-right font-medium">Sent</th>
                    <th className="px-4 py-2.5 text-right font-medium">Within 2 h</th>
                    <th className="px-4 py-2.5 text-right font-medium">Same day</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {KIND_ORDER.map((kind) => {
                    const row = r.kinds.find((x) => x.kind === kind);
                    return (
                      <tr key={kind}>
                        <td className="px-4 py-2.5" title={KIND_LABELS[kind].hint}>
                          <div className="font-medium text-foreground">{KIND_LABELS[kind].label}</div>
                          {(row?.failed ?? 0) > 0 && <div className="text-[11px] text-danger-deep">{row!.failed} failed</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatCount(row?.sent ?? 0)}</td>
                        <td className="px-4 py-2.5"><RateMeter value={row?.within2hRate ?? null} color={c.series5[0]!} /></td>
                        <td className="px-4 py-2.5"><RateMeter value={row?.sameDayRate ?? null} color={c.series5[2]!} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <Card title="Phones on the new reminder code" info="Customers' registered phones whose app code takes its reminders from the server: the over-the-air update's reach. Only these phones are sent reminders. A snapshot of now.">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-foreground">{pct(rate(r.phonesOnServerReminders, r.phones))}</span>
              <span className="text-xs text-muted-foreground">
                {formatCount(r.phonesOnServerReminders)} of {formatCount(r.phones)} phones
              </span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted" aria-hidden="true">
              <div className="h-2 rounded-full" style={{ width: `${(rate(r.phonesOnServerReminders, r.phones) ?? 0) * 100}%`, background: c.series }} />
            </div>
            <Takeaway>
              The update reaches a phone the next time its app opens. Phones by native build are on{" "}
              <Link href="/growth#app-versions" className="font-medium text-brand hover:underline">
                Growth
              </Link>
              .
            </Takeaway>
          </Card>
        </div>
        <div className="xl:col-span-8">
          <ReminderLog state={log} />
        </div>
      </div>
    </Section>
  );
}

const STATUS_TONES: Record<"pending" | "sent" | "failed", BadgeTone> = { sent: "success", pending: "warning", failed: "danger" };

function ReminderLog({ state }: { state: QueryState<PracticeReminderOverview> }) {
  const now = Date.now();
  return (
    <Card title="Latest reminders" info="The newest reminders the sweep claimed, with the words the singer read. GET /api/admin/practice-reminders." bleed className="h-full">
      <StateView state={state} loadingLabel="Loading reminders" isEmpty={(x) => x.recent.length === 0} emptyMessage="No reminders claimed yet" emptyHint="The sweep runs every ten minutes once PracticeReminders__Enabled is on.">
        {(x) => (
          <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto overscroll-contain">
            {x.recent.slice(0, 30).map((row) => (
              <li key={row.id} className="flex items-start gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-foreground">
                    <span className="font-medium">{row.title}</span>
                    <span className="text-muted-foreground"> · {row.body}</span>
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    <Link href={`/users/${row.userId}`} className="hover:text-foreground hover:underline">
                      {row.fullName || row.email || "Account"}
                    </Link>
                    {" · "}
                    {KIND_LABELS[row.kind]?.label ?? row.kind}
                    {row.streak > 0 ? ` · ${row.streak}-day streak` : ""}
                    {row.error ? ` · ${row.error}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={STATUS_TONES[row.status] ?? "neutral"}>{row.status === "sent" ? "Sent" : row.status === "failed" ? "Failed" : "Pending"}</Badge>
                  <time className="text-[11px] tabular-nums text-muted-foreground" dateTime={row.sentAtUtc ?? row.createdAtUtc}>
                    {formatRelative(row.sentAtUtc ?? row.createdAtUtc, now)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </Card>
  );
}

// ── Badges ──────────────────────────────────────────────────────────────────

function BadgesSection({ d }: { d: PracticeAnalytics }) {
  const c = useChartPalette();
  const inWindow = d.badges.reduce((n, b) => n + b.earnedInWindow, 0);
  const ever = d.badges.reduce((n, b) => n + b.earnedAllTime, 0);
  return (
    <Section id="badges" title="Badges" description="Earned once each, when the take that reached one is marked.">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <ChartCard
            title="Badges earned"
            info="How many singers earned each badge in these dates; the figure beside it is how many have it, ever. Listed in the order the Practice screen shows them."
            table={<DataTable head={["Badge", "In these dates", "Ever"]} rows={d.badges.map((b) => [b.title, b.earnedInWindow, b.earnedAllTime])} />}
          >
            {ever === 0 ? (
              <EmptyView compact icon={Medal} message="No badges earned yet" hint="The first, First drill, comes with a singer's first marked drill." />
            ) : (
              <RankedBars rows={d.badges.map((b) => ({ label: b.title, count: b.earnedInWindow, note: `${formatCount(b.earnedAllTime)} ever` }))} colorIndex={2} />
            )}
          </ChartCard>
        </div>
        <div className="xl:col-span-5">
          <DailyChart
            className="h-full"
            title="Badges per day"
            info={`Badges awarded each day (reporting days): ${formatCount(inWindow)} in these dates.`}
            data={series(d.daily, (x) => x.badgesEarned)}
            unit="badges"
            color={c.series5[2]!}
          />
        </div>
      </div>
    </Section>
  );
}
