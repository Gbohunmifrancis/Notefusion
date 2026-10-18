import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { AdminPage, AdminTopBar } from "../../components/admin/AdminChrome";
import {
  AttentionLine,
  Dot,
  FilterChips,
  LinkText,
  LoadState,
  Meter,
  Panel,
  SectionHead,
  Segmented,
  StatTile,
  TileGrid,
} from "../../components/admin/AdminUI";
import { AreaChart, Bars, Donut, Sparkline } from "../../components/admin/Charts";
import { ChartSheet, type ChartRequest } from "../../components/admin/ChartSheet";
import { Icon, type IconName } from "../../components/Icon";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import type { ActivityItem, AdminPaymentRow, AnalyticsOverview, PaymentOpsSummary, SystemHealth } from "../../api/types";
import { useAuth } from "../../lib/auth";
import { useAdminQuery } from "../../lib/adminCache";
import { openConsole } from "../../lib/adminConsole";
import { showDialog } from "../../lib/dialog";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import {
  ago,
  agoSentence,
  bucketSeries,
  byCurrency,
  change,
  count,
  countryName,
  dayShort,
  firstName,
  greeting,
  healthWord,
  money,
  parseUtc,
  rangeFor,
  rangeLabel,
  shortPlan,
  type Bucket,
  type RangePreset,
} from "../../lib/adminFormat";
import type { AdminTabParams } from "../../navigation/types";

type Feed = "all" | "transcription" | "signup" | "payment";

const FEED_ICON: Record<string, IconName> = {
  payment: "card",
  transcription: "transcribe",
  transcription_failed: "problem",
  signup: "user-plus",
  feedback: "feedback",
  outreach: "mail",
};

/**
 * The console's Overview, one column (boards f-admin/01–02): the greeting and range, one line for the stack's health,
 * money first (revenue and run-rate per currency, never added together, and the last payment), the amber line only
 * when something needs a look, the tiles (each with a series opens its chart), Signups, Recent activity, Pro
 * membership and the outcomes. The web's long tail stays on Insights.
 */
export function AdminOverviewScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const nav = useNavigation<BottomTabNavigationProp<AdminTabParams>>();
  const { user } = useAuth();
  const [days, setDays] = useState<RangePreset>(30);
  const [bucket, setBucket] = useState<Bucket>("day");
  const [feed, setFeed] = useState<Feed>("all");
  const [chart, setChart] = useState<ChartRequest | null>(null);
  const [pinned, setPinned] = useState(false);

  const now = new Date();
  const { from, to } = rangeFor(days, now);
  const rangeKey = `${days}:${from.toDateString()}`;
  const overview = useAdminQuery<AnalyticsOverview>(`overview:${rangeKey}`, () =>
    adminApi.overview(from.toISOString(), to.toISOString()),
  );
  const summary = useAdminQuery<PaymentOpsSummary>("payments-summary", adminApi.paymentsSummary);
  const health = useAdminQuery<SystemHealth>("health", adminApi.health);
  const last = useAdminQuery("last-payment", () => adminApi.payments({ page: 1, pageSize: 1, status: "Completed" }));

  const o = overview.data;
  const refreshing = overview.refreshing || summary.refreshing;
  const refresh = () => {
    void overview.refresh();
    void summary.refresh();
    void health.refresh();
    void last.refresh();
  };

  const range = (
    <View style={s.rangeBar}>
      <Segmented
        options={[
          { value: "7", label: "7d" },
          { value: "30", label: "30d" },
          { value: "90", label: "90d" },
        ]}
        value={String(days)}
        onChange={(v) => setDays(Number(v) as RangePreset)}
      />
    </View>
  );

  const pickRange = () =>
    showDialog({
      title: "Show",
      actions: ([7, 30, 90] as const).map((d) => ({
        label: `Last ${d} days`,
        icon: "calendar" as IconName,
        selected: d === days,
        onPress: () => setDays(d),
      })),
    });

  return (
    <AdminPage
      header={<AdminTopBar />}
      onRefresh={refresh}
      refreshing={refreshing}
      onScroll={(y) => setPinned(y > 110)}
      overlay={
        pinned ? (
          <View style={s.pinned}>
            <Text style={s.pinnedTitle}>Overview</Text>
            {range}
          </View>
        ) : null
      }
    >
      <Text style={s.hello} accessibilityRole="header">{`${greeting(now.getHours())}, ${firstName(user?.fullName)}`}</Text>
      <Text style={s.helloSub}>{`${dayShort(now)} · days counted in West Africa Time`}</Text>

      <View style={s.rangeRow}>
        {range}
        <Touchable onPress={pickRange} accessibilityLabel={`Range ${rangeLabel(from, to)}`}>
          <View style={s.dateBtn}>
            <Icon name="calendar" size={15} color={a.muted} />
            <Text style={s.dateText}>{rangeLabel(from, to)}</Text>
            <Icon name="down" size={15} color={a.muted} />
          </View>
        </Touchable>
      </View>

      <StatusLine health={health.data} onPress={() => nav.navigate("Health")} />

      {o ? (
        <>
          <MoneyCard overview={o} last={last.data?.items[0]} now={now} />

          {summary.data && summary.data.verifiedCount + summary.data.stuckCount > 0 ? (
            <View style={s.gap10}>
              <AttentionLine onPress={() => nav.navigate("Payments", { filter: "attention", nonce: Date.now() })}>
                <Text style={s.attentionBold}>
                  {summary.data.verifiedCount > 0 ? `${summary.data.verifiedCount} paid, no Pro yet` : ""}
                </Text>
                {summary.data.verifiedCount > 0 && summary.data.stuckCount > 0 ? " · " : ""}
                {summary.data.stuckCount > 0
                  ? `${summary.data.stuckCount} checkout${summary.data.stuckCount === 1 ? "" : "s"} stuck`
                  : ""}
              </AttentionLine>
            </View>
          ) : null}

          <View style={s.gap12}>
            <TileGrid>
              <StatTile
                label="Pro members"
                value={count(o.membership.activeMembers)}
                sub={[
                  `${count(o.membership.paidMembers)} paid`,
                  `${count(o.membership.giftedMembers)} gifted`,
                  o.membership.activeChoirs ? `${count(o.membership.activeChoirs)} choirs` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <StatTile label="New members" value={count(o.membership.newMembers)} sub="First Pro period started" />
              <StatTile
                label="Total users"
                value={count(o.users.totalUsers)}
                sub={`${count(o.users.newUsers)} new in this period`}
                corner={<Sparkline values={o.signupsPerDay.map((p) => p.count)} />}
                onPress={() =>
                  setChart({
                    title: "Sign-ups",
                    hint: `${rangeLabel(from, to)} · new accounts, team left out`,
                    value: count(o.users.newUsers),
                    pct: change(o.users.newUsers, o.users.newUsersPrevious),
                    pctSuffix: `on the ${days} days before`,
                    series: o.signupsPerDay,
                    noun: "sign-ups",
                    third: { value: count(o.users.totalUsers), label: "Accounts\nin all" },
                    link: { label: "Open Insights", onPress: () => openConsole("/insights") },
                  })
                }
              />
              <StatTile label="Active today" value={count(o.users.activeToday)} sub="Seen since midnight" />
              <StatTile
                label="Transcriptions"
                value={count(o.transcriptions.totalTranscribed)}
                pct={change(o.transcriptions.totalTranscribed, o.transcriptions.totalTranscribedPrevious)}
                sub={`${count(o.transcriptions.totalSaved)} kept as sheets`}
                corner={<Sparkline values={o.transcriptionsPerDay.map((p) => p.count)} />}
                onPress={() =>
                  setChart({
                    title: "Transcriptions",
                    hint: `${rangeLabel(from, to)} · results produced, previews included`,
                    value: count(o.transcriptions.totalTranscribed),
                    pct: change(o.transcriptions.totalTranscribed, o.transcriptions.totalTranscribedPrevious),
                    pctSuffix: `on the ${days} days before`,
                    series: o.transcriptionsPerDay,
                    noun: "transcriptions",
                    third: o.transcriptions.totalTranscribed
                      ? {
                          value: `${Math.round((o.transcriptions.totalSaved / o.transcriptions.totalTranscribed) * 100)}%`,
                          label: "Kept as\nsheets",
                        }
                      : undefined,
                    link: { label: "Open Transcriptions", onPress: () => openConsole("/transcriptions") },
                  })
                }
              />
              <StatTile
                label="Active this period"
                value={count(o.users.activeUsers)}
                pct={change(o.users.activeUsers, o.users.activeUsersPrevious)}
                sub="Transcribed, visited, joined"
              />
              <StatTile
                label="Hymns recognised"
                value={count(o.transcriptions.hymnMatchesOffered)}
                sub={`${count(o.transcriptions.hymnVersionsSaved)} hymnbook versions kept`}
              />
              <StatTile
                label="Songs this month"
                value={count(o.membership.songsUsedThisMonth)}
                sub={`${count(o.membership.membersOutOfSongs)} used all 20`}
              />
            </TileGrid>
          </View>

          <Panel
            style={s.gap12}
            title="Signups"
            hint="New accounts per day"
            action={
              <Segmented
                options={[
                  { value: "day", label: "Day" },
                  { value: "week", label: "Week" },
                  { value: "month", label: "Month" },
                ]}
                value={bucket}
                onChange={setBucket}
              />
            }
          >
            <SignupChart series={bucketSeries(o.signupsPerDay, bucket)} />
          </Panel>

          <Panel style={s.gap12} title="Recent activity" action={<LinkText label="View all" onPress={() => openConsole("/activity")} />}>
            <FilterChips
              options={[
                { value: "all", label: "All" },
                { value: "transcription", label: "Transcriptions" },
                { value: "signup", label: "Sign-ups" },
                { value: "payment", label: "Payments" },
              ]}
              value={feed}
              onChange={setFeed}
            />
            <ActivityFeed items={o.recentActivity} feed={feed} now={now} />
          </Panel>

          <SectionHead title="Pro membership" link="Growth" onLink={() => nav.getParent()?.navigate("AdminGrowth")} />
          <TileGrid>
            <StatTile
              label="Lapsed"
              value={count(o.membership.lapsedMembers)}
              sub={`${o.membership.activeMembers ? Math.round((o.membership.lapsedMembers / Math.max(1, o.membership.activeMembers + o.membership.lapsedMembers)) * 100) : 0}% of members · win back`}
            />
            <StatTile
              label="Ending in 7 days"
              value={count(summary.data?.expiringInSevenDaysCount ?? 0)}
              sub="Nothing renews by itself"
            />
          </TileGrid>

          <Panel style={s.gap10} title="Members by plan">
            <Bars
              rows={o.membership.membersByPlan.map((p, i) => ({
                label: p.label,
                value: p.count,
                color: [a.series, a.sky, a.indigo, a.grey][i % 4]!,
              }))}
            />
          </Panel>

          <Outcomes overview={o} />

          <Text style={s.foot}>
            Website traffic, the web funnel and cohorts are on{" "}
            <Text style={s.footLink} onPress={() => openConsole("/insights")} accessibilityRole="link">
              Insights
            </Text>
            .
          </Text>
        </>
      ) : (
        <LoadState loading={overview.loading} error={overview.error} onRetry={overview.refresh} />
      )}

      <ChartSheet request={chart} onClose={() => setChart(null)} />
    </AdminPage>
  );
}

/** One line for the whole stack, from the API's own roll-up; it opens Health. */
function StatusLine({ health, onPress }: { health?: SystemHealth; onPress: () => void }) {
  const s = useAdminStyles(makeStyles);
  const a = useAdminColors();
  if (!health) return <View style={[s.panelLike, s.gap14, { height: 62 }]} />;
  const tiers = [health.database, health.transcriptionWorker, health.webhookBacklog];
  const backupsOk = !health.backups || health.backups.status.toLowerCase() === "healthy";
  const up = tiers.filter((t) => t.status.toLowerCase() !== "down").length + (health.backups ? (backupsOk ? 1 : 0) : 0);
  const total = tiers.length + (health.backups ? 1 : 0);
  const word = healthWord(health.status);
  const minutes = Math.max(0, Math.round((Date.now() - parseUtc(health.checkedAtUtc).getTime()) / 60000));
  const title =
    word.tone === "ok" && backupsOk
      ? "All systems operational"
      : word.tone === "bad"
        ? `${tiers.find((t) => t.status.toLowerCase() === "down")?.name ?? "A tier"} is down`
        : "Something needs a look";
  return (
    <Touchable onPress={onPress} accessibilityLabel={`${title}. Open Health`}>
      <View style={[s.panelLike, s.status, s.gap14]}>
        <Dot tone={word.tone === "ok" && !backupsOk ? "warn" : word.tone} />
        <View style={s.flex}>
          <Text style={s.statusTitle}>{title}</Text>
          <Text style={s.statusSub}>{`Checked ${minutes < 1 ? "just now" : `${minutes} min ago`} · ${up} of ${total} tiers up`}</Text>
        </View>
        <Icon name="chevron" size={16} color={a.dim} />
      </View>
    </Touchable>
  );
}

/** Money first: revenue and run-rate per currency (never added across), and the last payment. */
function MoneyCard({ overview, last, now }: { overview: AnalyticsOverview; last?: AdminPaymentRow; now: Date }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const revenue = byCurrency(overview.membership.revenue);
  const runRate = byCurrency(overview.membership.monthlyRunRate);
  const col = (label: string, list: typeof revenue) => (
    <View style={s.moneyCol}>
      <Text style={s.moneyLabel}>{label}</Text>
      <Text style={s.moneyBig} numberOfLines={1} adjustsFontSizeToFit>
        {list[0] ? money(list[0].amountMinor, list[0].currency) : money(0, "NGN")}
      </Text>
      {list.slice(1).map((m) => (
        <Text key={m.currency} style={s.moneySmall}>
          {money(m.amountMinor, m.currency)}
        </Text>
      ))}
    </View>
  );
  return (
    <View style={[s.panelLike, s.money, s.gap10]}>
      <View style={s.moneyRow}>
        {col("Revenue collected", revenue)}
        <View style={s.moneyRule} />
        {col("Monthly run-rate", runRate)}
      </View>
      {last ? (
        <View style={s.lastPay}>
          <Icon name="money" size={17} color={a.ok} />
          <Text style={s.lastPayText} numberOfLines={1}>
            <Text style={s.lastPayName}>{last.userFullName || last.userEmail}</Text>
            {` paid ${money(last.amountMinor, last.currency)} · ${shortPlan(last.planName)}`}
          </Text>
          <Text style={s.lastPayWhen}>{ago(parseUtc(last.updatedAtUtc), now)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SignupChart({ series }: { series: readonly { date: string; count: number }[] }) {
  const short = (d?: { date: string }) => (d ? dayShort(new Date(d.date + "T00:00:00")).slice(4) : "");
  return (
    <AreaChart
      values={series.map((p) => p.count)}
      labels={[short(series[0]), short(series[Math.floor(series.length / 2)]), short(series[series.length - 1])]}
      height={160}
    />
  );
}

/** The web's Recent activity: a monochrome glyph, a sentence, where and when. */
function ActivityFeed({ items, feed, now }: { items: readonly ActivityItem[]; feed: Feed; now: Date }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const shown = items
    .filter((i) => feed === "all" || i.kind === feed || (feed === "transcription" && i.kind === "transcription_failed"))
    .slice(0, 6);
  if (!shown.length) return <Text style={s.feedEmpty}>Nothing in this period.</Text>;
  return (
    <View style={s.feed}>
      {shown.map((i, n) => (
        <View key={`${i.kind}-${i.occurredAtUtc}-${n}`} style={[s.feedItem, n > 0 && s.feedRule]}>
          <Icon name={FEED_ICON[i.kind] ?? "activity"} size={16} color={i.kind === "transcription_failed" ? a.warn : a.faint} />
          <View style={s.flex}>
            <Text style={s.feedText}>
              <Text style={s.feedName}>{i.title}</Text> {i.detail ?? i.subtitle ?? ""}
            </Text>
            <Text style={s.feedWhere}>{[countryName(i.country), agoSentence(parseUtc(i.occurredAtUtc), now)].filter(Boolean).join(" · ")}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Outcomes({ overview }: { overview: AnalyticsOverview }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const t = overview.transcriptions;
  const started = t.succeededCount + t.failedCount + t.inFlightCount;
  const pct = (n: number) => (started ? (n / started) * 100 : 0);
  const rows = [
    { label: "Succeeded", value: t.succeededCount, color: a.ok },
    { label: "Failed", value: t.failedCount, color: a.bad },
    { label: "Still running", value: t.inFlightCount, color: a.seriesFaint },
  ];
  return (
    <Panel
      style={s.gap12}
      title="Transcription outcomes"
      action={<Text style={s.panelNote}>{started ? `${Math.round(pct(t.succeededCount))}% succeeded` : ""}</Text>}
    >
      <View style={s.outcomes}>
        <Donut parts={rows.map((r) => ({ value: r.value, color: r.color }))} total={count(started)} label="Started" />
        <View style={s.meters}>
          {rows.map((r) => (
            <View key={r.label}>
              <View style={s.meterHead}>
                <View style={s.meterKeyRow}>
                  <View style={[s.meterKey, { backgroundColor: r.color }]} />
                  <Text style={s.meterLabel}>{r.label}</Text>
                </View>
                <Text style={s.meterValue}>{count(r.value)}</Text>
              </View>
              <View style={s.meterBar}>
                <Meter pct={pct(r.value)} color={r.color} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </Panel>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    gap10: { marginTop: 10 },
    gap12: { marginTop: 12 },
    gap14: { marginTop: 14 },
    hello: { fontFamily: fonts.semibold, fontSize: 23, letterSpacing: -0.4, color: a.text },
    helloSub: { fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, marginTop: 4 },
    rangeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14 },
    rangeBar: {},
    dateBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 38,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: a.line,
      backgroundColor: a.card,
    },
    dateText: { fontFamily: fonts.medium, fontSize: 13, color: a.text },
    pinned: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 8,
      backgroundColor: a.bg,
      borderBottomWidth: 1,
      borderBottomColor: a.line,
    },
    pinnedTitle: { fontFamily: fonts.semibold, fontSize: 17, color: a.text },
    panelLike: { backgroundColor: a.card, borderWidth: 1, borderColor: a.line, borderRadius: 12 },
    status: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12 },
    statusTitle: { fontFamily: fonts.semibold, fontSize: 14, color: a.text },
    statusSub: { fontFamily: fonts.regular, fontSize: 13, color: a.muted, marginTop: 2 },
    money: { padding: 14 },
    moneyRow: { flexDirection: "row" },
    moneyCol: { flex: 1, minWidth: 0 },
    moneyRule: { width: 1, backgroundColor: a.line, marginHorizontal: 14 },
    moneyLabel: { fontFamily: fonts.medium, fontSize: 12.5, color: a.muted },
    moneyBig: { fontFamily: fonts.semibold, fontSize: 23, letterSpacing: -0.4, color: a.text, marginTop: 8, fontVariant: ["tabular-nums"] },
    moneySmall: { fontFamily: fonts.medium, fontSize: 14.5, color: a.muted, marginTop: 4, fontVariant: ["tabular-nums"] },
    lastPay: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: a.line,
    },
    lastPayText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: a.muted },
    lastPayName: { fontFamily: fonts.semibold, color: a.text },
    lastPayWhen: { fontFamily: fonts.regular, fontSize: 13, color: a.muted, fontVariant: ["tabular-nums"] },
    attentionBold: { fontFamily: fonts.semibold },
    feed: { marginTop: 8 },
    feedItem: { flexDirection: "row", gap: 11, paddingVertical: 9 },
    feedRule: { borderTopWidth: 1, borderTopColor: a.line2 },
    feedText: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.muted },
    feedName: { fontFamily: fonts.semibold, color: a.text },
    feedWhere: { fontFamily: fonts.regular, fontSize: 12, color: a.faint, marginTop: 2 },
    feedEmpty: { fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, paddingVertical: 14 },
    panelNote: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted },
    outcomes: { flexDirection: "row", alignItems: "center", gap: 18 },
    meters: { flex: 1, gap: 10 },
    meterHead: { flexDirection: "row", justifyContent: "space-between" },
    meterKeyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    meterKey: { width: 8, height: 8, borderRadius: 2 },
    meterLabel: { fontFamily: fonts.regular, fontSize: 13, color: a.text },
    meterValue: { fontFamily: fonts.regular, fontSize: 13, color: a.muted, fontVariant: ["tabular-nums"] },
    meterBar: { marginTop: 5 },
    foot: { fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, textAlign: "center", marginTop: 14, lineHeight: 20 },
    footLink: { color: a.brand, fontFamily: fonts.medium },
  });
