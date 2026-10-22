"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { getListenAnalytics } from "@/api/endpoints";
import type { ListenAnalytics, ListenBreakdown, ListenCount } from "@/api/types";
import { Section, SectionNav, Takeaway } from "@/components/analytics/Section";
import { ChartCard, DataTable, FunnelBars, MetricRow, RankedBars, StackedDaily } from "@/components/insights/Charts";
import { PageHeader } from "@/components/PageHeader";
import { RangePicker, type Range } from "@/components/RangePicker";
import { EmptyView, StateView } from "@/components/StateView";
import { useChartPalette } from "@/lib/chart";
import { addDays, formatCount, formatPercent, reportingToday, UNKNOWN } from "@/lib/format";

/* Listen from anywhere (Android): the floating button and the Listen notification (Pro) and the Listen tile (everyone).
 * Read off the phone's own events (the native service logs what it did; the app sends them with the account's token)
 * and the jobs the takes became. A take is followed from its way in to a finished sheet; the forgotten ones (the cap,
 * the music stopping, nothing heard) are counted apart, as are the reminders, the settings people keep on, and the Pro
 * locks free accounts tap. */

const SECTIONS = [
  { id: "takes", label: "Takes" },
  { id: "ways-in", label: "Ways in" },
  { id: "endings", label: "How takes end" },
  { id: "settings", label: "Settings & Pro" },
] as const;

/** The API's reporting day is West Africa Time, as on the console's other pages. */
const OFFSET_MINUTES = 60;

const ENTRY_LABELS: Record<string, string> = {
  bubble: "Floating button",
  notification: "Listen notification",
  tile: "Quick Settings tile",
};
const SOURCE_LABELS: Record<string, string> = { room: "The room (microphone)", phone: "This phone’s sound" };
const KIND_LABELS: Record<string, string> = { melody: "Singing (a tune)", poly: "Instrument (several notes)", chords: "Chords" };
const ENDING_LABELS: Record<string, string> = {
  stop: "Stopped by the person",
  cap: "Reached the length limit",
  music_stopped: "The music stopped (sent)",
  nothing_heard: "Nothing heard in a minute",
  projection_ended: "Android ended the capture",
  cancel: "Cancelled",
  failed: "Recording failed",
  killed: "App closed by Android",
};
const REFUSAL_LABELS: Record<string, string> = {
  not_pro: "Button or notification without Pro",
  none_left: "No transcriptions left",
  signed_out: "Signed out",
  no_mic: "Microphone not allowed",
  not_allowed: "Android refused to start",
  mic_unavailable: "Microphone busy",
};

const label = (labels: Record<string, string>, key: string) => labels[key] ?? key.replace(/_/g, " ");
const rate = (num: number, den: number) => (den > 0 ? formatPercent(num / den, 0) : UNKNOWN);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function ListenView() {
  const [range, setRange] = useState<Range | null>(null);
  const state = useQuery({
    queryKey: ["listen", range?.from, range?.to],
    queryFn: ({ signal }) => getListenAnalytics(range?.from, range?.to, signal),
    placeholderData: keepPreviousData,
  });
  const picker: Range = range ?? { from: addDays(reportingToday(OFFSET_MINUTES), -29), to: reportingToday(OFFSET_MINUTES) };

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Listen from anywhere"
        subtitle="The floating button and Listen notification (Pro) and the Listen tile: who uses them, what each take became, and how takes end."
        breadcrumb={["Dashboard", "Listen from anywhere"]}
      />
      <div className="flex flex-wrap items-center gap-3 nf-panel p-3">
        <RangePicker value={picker} offsetMinutes={OFFSET_MINUTES} onChange={setRange} />
        <span className="text-[11px] text-muted-foreground">
          Phones send their events when the app next opens, so the last day or two fill in late. Settings are as each account last left them.
        </span>
        {state.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
      </div>
      <SectionNav sections={SECTIONS} />
      <StateView state={state} loadingLabel="Loading Listen from anywhere">
        {(d) =>
          d.summary.people === 0 && d.settings.proLockTaps === 0 ? (
            <EmptyView
              message="No one has used Listen from anywhere in these dates"
              hint="It arrived with Android build 61; events come in as phones on it open the app."
            />
          ) : (
            <ListenBody d={d} />
          )
        }
      </StateView>
    </div>
  );
}

function ListenBody({ d }: { d: ListenAnalytics }) {
  return (
    <div className="space-y-8">
      <TakesSection d={d} />
      <WaysInSection d={d} />
      <EndingsSection d={d} />
      <SettingsSection d={d} />
    </div>
  );
}

// ── Takes ───────────────────────────────────────────────────────────────────

function TakesSection({ d }: { d: ListenAnalytics }) {
  const s = d.summary;
  const c = useChartPalette();
  const days = d.days.map((x) => ({ date: x.date, sent: x.sent, unsent: Math.max(0, x.started - x.sent) }));
  return (
    <Section
      id="takes"
      title="Takes"
      description="A take is one recording from the button, the notification or the tile. A sent one becomes a transcription, charged like a Record-screen take when it finishes."
    >
      <MetricRow
        items={[
          {
            label: "People",
            value: formatCount(s.people),
            note: `${formatCount(s.proPeople)} took one as Pro`,
            info: "Accounts with any Listen from anywhere event in these dates: a take, a refusal, a setting, a dismissal.",
          },
          { label: "Takes started", value: formatCount(s.takesStarted), info: "Recordings that started." },
          {
            label: "Sent",
            value: formatCount(s.takesSent),
            share: rate(s.takesSent, s.takesSent + s.takesUnsent),
            info: "Takes handed to the send queue, of every take that ended.",
          },
          {
            label: "Finished sheets",
            value: formatCount(s.transcriptions),
            note: `${formatCount(s.transcriptionsFailed)} failed · ${formatCount(s.transcriptionsPending)} running or not heard from`,
            info: "Jobs from sent takes that finished with a sheet. A take is followed to its job by the id the app logs when it sends it.",
          },
          {
            label: "Average sent take",
            value: s.takesSent ? clock(s.averageSentSeconds) : UNKNOWN,
            info: "The average length of a take that was sent.",
          },
          {
            label: "Forgotten takes",
            value: formatCount(s.endedByThemselves),
            share: rate(s.endedByThemselves, s.takesSent + s.takesUnsent),
            info: "Takes that ended by themselves: the length limit, the music stopping for 45 seconds, or nothing heard in the first minute.",
          },
        ]}
      />
      <ChartCard
        title="Takes by day"
        info="Takes started each reporting day (WAT), split into sent and not sent."
        legend={[
          { label: "Sent", color: c.series5[0]! },
          { label: "Not sent", color: c.series5[1]! },
        ]}
        table={<DataTable head={["Day", "Started", "Sent", "People"]} rows={d.days.map((x) => [x.date, x.started, x.sent, x.people])} />}
      >
        <StackedDaily
          data={days}
          series={[
            { key: "sent", label: "Sent" },
            { key: "unsent", label: "Not sent" },
          ]}
          unit="takes"
        />
      </ChartCard>
      <FunnelBars
        steps={[
          { step: "Takes started", count: s.takesStarted },
          { step: "Sent", count: s.takesSent },
          { step: "Finished as a sheet", count: s.transcriptions },
        ]}
      />
    </Section>
  );
}

// ── Ways in ─────────────────────────────────────────────────────────────────

function breakdownRows(list: ListenBreakdown[], labels: Record<string, string>) {
  return list.map((b) => ({
    label: label(labels, b.key),
    count: b.started,
    note: `${formatCount(b.sent)} sent · ${formatCount(b.people)} ${b.people === 1 ? "person" : "people"}`,
  }));
}

function WaysInSection({ d }: { d: ListenAnalytics }) {
  const top = [...d.byEntry].sort((a, b) => b.started - a.started)[0];
  return (
    <Section
      id="ways-in"
      title="Ways in"
      description="Which entry people start takes from, and what they listen to. The button and the notification are Pro's; the tile is everyone's."
    >
      {top && top.started > 0 && (
        <Takeaway>
          Most takes start from the {label(ENTRY_LABELS, top.key).toLowerCase()}: {formatCount(top.started)} of {formatCount(d.summary.takesStarted)}.
        </Takeaway>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Takes by way in"
          info="Takes started from each entry, with how many were sent and by how many people."
          table={<DataTable head={["Way in", "Started", "Sent", "People"]} rows={d.byEntry.map((b) => [label(ENTRY_LABELS, b.key), b.started, b.sent, b.people])} />}
        >
          <RankedBars rows={breakdownRows(d.byEntry, ENTRY_LABELS)} empty="No takes in these dates" />
        </ChartCard>
        <ChartCard
          title="What takes listen to"
          info="The microphone, or the phone's own sound (Android 10+, with Android's screen-sharing consent each time)."
          {...(d.summary.captureBlocked
            ? { hint: `${formatCount(d.summary.captureBlocked)} fell back to the room: the playing app refused its sound` }
            : {})}
          table={<DataTable head={["Source", "Started", "Sent", "People"]} rows={d.bySource.map((b) => [label(SOURCE_LABELS, b.key), b.started, b.sent, b.people])} />}
        >
          <RankedBars rows={breakdownRows(d.bySource, SOURCE_LABELS)} colorIndex={2} empty="No takes in these dates" />
        </ChartCard>
        <ChartCard
          title="Listen for"
          info="What takes were sent as: Singing (a voice or one instrument's tune; read as chords when no voice is heard), Instrument, or Chords. Counted on the takes that ended, since the pill's chip can change it mid-take."
          table={<DataTable head={["Sent as", "Ended", "Sent", "People"]} rows={d.byKind.map((b) => [label(KIND_LABELS, b.key), b.started, b.sent, b.people])} />}
        >
          <RankedBars rows={breakdownRows(d.byKind, KIND_LABELS)} colorIndex={4} empty="No takes ended in these dates" />
        </ChartCard>
      </div>
    </Section>
  );
}

// ── How takes end ───────────────────────────────────────────────────────────

function countRows(list: ListenCount[], labels: Record<string, string>, withSent: boolean) {
  return list.map((c) => ({
    label: label(labels, c.key),
    count: c.count,
    note: withSent ? `${formatCount(c.sent)} sent` : undefined,
  }));
}

function EndingsSection({ d }: { d: ListenAnalytics }) {
  const s = d.summary;
  return (
    <Section
      id="endings"
      title="How takes end"
      description="A take that runs on gets a reminder at 2:00 and a minute before its limit. Nothing heard in the first minute ends it unsent; the music stopping for 45 seconds ends it sent; the limit ends it sent. A take with almost nothing heard is never sent."
    >
      <MetricRow
        items={[
          { label: "Reminders shown", value: formatCount(s.reminders), info: "“Still listening” and “One minute left” notifications." },
          {
            label: "Stopped from a reminder",
            value: formatCount(s.stoppedFromReminder),
            share: rate(s.stoppedFromReminder, s.reminders),
            info: "Takes stopped or cancelled with a reminder's own buttons, of the reminders shown.",
          },
          { label: "Not sent", value: formatCount(s.takesUnsent), info: "Cancelled, too short, nothing heard, or the recording failed." },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Endings"
          info="Why each take ended, and how many of each were sent."
          table={<DataTable head={["Ending", "Takes", "Sent"]} rows={d.endings.map((c) => [label(ENDING_LABELS, c.key), c.count, c.sent])} />}
        >
          <RankedBars rows={countRows(d.endings, ENDING_LABELS, true)} empty="No takes ended in these dates" />
        </ChartCard>
        <ChartCard
          title="Takes that could not start"
          info="Taps that did not start a recording, and why."
          table={<DataTable head={["Reason", "Times"]} rows={d.refusals.map((c) => [label(REFUSAL_LABELS, c.key), c.count])} />}
        >
          <RankedBars rows={countRows(d.refusals, REFUSAL_LABELS, false)} colorIndex={1} empty="Every tap started a take" />
        </ChartCard>
      </div>
    </Section>
  );
}

// ── Settings & Pro ──────────────────────────────────────────────────────────

function SettingsSection({ d }: { d: ListenAnalytics }) {
  const st = d.settings;
  const s = d.summary;
  return (
    <Section
      id="settings"
      title="Settings & Pro"
      description="What people keep on, as each account last left it by the end of these dates, and the Pro-locked rows free accounts tap in Settings."
    >
      <MetricRow
        items={[
          { label: "Floating button on", value: formatCount(st.buttonOn), info: "Accounts whose last word on the floating button was on (shown only while they are Pro)." },
          { label: "Listen notification on", value: formatCount(st.notificationOn), info: "The same for Listen in notifications." },
          { label: "Tile added", value: formatCount(st.tileAdded), info: "Accounts that added the Listen tile to Quick Settings." },
          { label: "Listen to: phone’s sound", value: formatCount(st.phoneSound), info: "Accounts whose last choice was “This phone’s sound” rather than the room." },
          {
            label: "Pro lock taps",
            value: formatCount(st.proLockTaps),
            note: `${formatCount(st.proLockPeople)} ${st.proLockPeople === 1 ? "account" : "accounts"}`,
            info: "Taps on the Pro-locked floating button or notification rows in Settings, which open the plans.",
          },
          {
            label: "Upgraded after a lock tap",
            value: formatCount(st.upgradedAfterLock),
            share: rate(st.upgradedAfterLock, st.proLockPeople),
            info: "Accounts that paid for Pro or a choir within 7 days of their first lock tap in these dates (one-song purchases not counted).",
          },
        ]}
      />
      <ChartCard
        title="Turning it off"
        info="How people put the button and the notification away."
        table={
          <DataTable
            head={["Action", "Times"]}
            rows={[
              ["Floating button dragged onto ×", s.buttonHidden],
              ["Listen notification swiped away", s.noticeDismissed],
              ["Listen notification: Hide", s.noticeHidden],
              ["“Buy one song” on the none-left card", s.buySongTaps],
            ]}
          />
        }
      >
        <RankedBars
          rows={[
            { label: "Floating button dragged onto ×", count: s.buttonHidden },
            { label: "Listen notification swiped away", count: s.noticeDismissed, note: "back when the app opens" },
            { label: "Listen notification: Hide", count: s.noticeHidden, note: "switch turned off" },
            { label: "“Buy one song” on the none-left card", count: s.buySongTaps },
          ]}
          colorIndex={3}
        />
      </ChartCard>
    </Section>
  );
}
