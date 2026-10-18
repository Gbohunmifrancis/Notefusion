import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AdminPage, AdminTopBar, PageTitle } from "../../components/admin/AdminChrome";
import { Badge, DefRows, Dot, LoadState, Meter, Panel, WarnNote } from "../../components/admin/AdminUI";
import { Button } from "../../components/Button";
import { Icon, type IconName } from "../../components/Icon";
import { adminApi } from "../../api/endpoints";
import type { BackupRun, HealthPanel, SystemHealth } from "../../api/types";
import { useAdminQuery } from "../../lib/adminCache";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import {
  agoSentence,
  bytes,
  clock,
  count,
  dayShort,
  healthWord,
  parseUtc,
  quotaTone,
  tierTone,
} from "../../lib/adminFormat";

const TIER_ICON: Record<string, IconName> = {
  Database: "database",
  "Transcription worker": "server",
  "Webhook backlog": "webhook",
};

const TIER_SUB: Record<string, string> = {
  Database: "Round trip",
  "Transcription worker": "Answered its health check",
  "Webhook backlog": "Nothing waiting",
};

const WINDOW: Record<string, string> = { day: "Last 24 hours", week: "Last 7 days", month: "Last 31 days" };

/**
 * The web's System Health, worst news first (board f-admin/06): one word for the whole stack (the API's own
 * roll-up), the three tiers it is made of with their latency, Backups as the web lists them, Email quota as meters
 * with the optional-mail line, the new Push panel, the background workers, jobs, the Pro snapshot, and "Not
 * monitored". Red appears only as a "Down" status.
 */
export function AdminHealthScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const q = useAdminQuery<SystemHealth>("health", adminApi.health);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(false);
  const h = q.data;
  const word = h ? healthWord(h.status) : null;
  const now = new Date();

  const recheck = async () => {
    setBusy(true);
    await q.refresh();
    setBusy(false);
  };

  return (
    <AdminPage
      header={<AdminTopBar />}
      onRefresh={() => void recheck()}
      refreshing={q.refreshing && !busy}
      onScroll={(y) => setPinned(y > 70)}
      overlay={
        // Once the title has scrolled away, the page's name and its one word stay under the bar (board f-admin/06).
        pinned && word ? (
          <View style={s.pinned}>
            <Text style={s.pinnedTitle}>System Health</Text>
            <View style={s.pinnedWord}>
              <Dot tone={word.tone} size={8} />
              <Text style={[s.pinnedWordText, { color: word.tone === "ok" ? a.ok : word.tone === "warn" ? a.warn : a.bad }]}>{word.word}</Text>
            </View>
          </View>
        ) : null
      }
    >
      <PageTitle
        title="System Health"
        sub={h ? `Checked ${clock(parseUtc(h.checkedAtUtc))}` : " "}
        right={<Button label="Re-check" icon="sync" variant="secondary" size="sm" onPress={() => void recheck()} loading={busy} />}
      />
      {!h ? (
        <LoadState loading={q.loading} error={q.error} onRetry={q.refresh} />
      ) : (
        <>
          <Verdict health={h} />

          <View style={[s.card, s.gap10]}>
            {[h.database, h.transcriptionWorker, h.webhookBacklog].map((t, i) => (
              <Tier key={t.name} tier={t} first={i === 0} />
            ))}
          </View>

          {h.backups ? (
            <Panel
              style={s.gap12}
              title="Backups"
              hint="Encrypted copies kept off this server"
              action={<StatusWord status={h.backups.status} />}
            >
              {h.backups.problems.length ? (
                <View style={s.problems}>
                  {h.backups.problems.map((p) => (
                    <View key={p} style={s.problem}>
                      <Icon name="problem" size={15} color={a.warn} />
                      <Text style={s.problemText}>{p}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={s.backupLine}>
                <Icon name="backup" size={18} color={a.icon} />
                <Text style={s.backupText}>{h.backups.summary || lastDump(h.backups.lastDump, now)}</Text>
              </View>
              <DefRows
                rows={[
                  { term: "WAL archived", value: h.backups.walArchivedAtUtc ? agoSentence(parseUtc(h.backups.walArchivedAtUtc), now) : "Never" },
                  { term: "Base backup", value: runAgo(h.backups.lastBaseBackup, now) },
                  { term: "Photos and keys", value: runAgo(h.backups.lastFiles, now) },
                  { term: "Repository check", value: runAgo(h.backups.lastCheck, now) },
                  {
                    term: "Last restore drill",
                    value: h.backups.lastDrill
                      ? `${h.backups.lastDrill.ok ? "Passed" : "Failed"} ${dayShort(parseUtc(h.backups.lastDrill.finishedAtUtc))}`
                      : "Not yet",
                    tone: h.backups.lastDrill?.ok ? "ok" : h.backups.lastDrill ? "warn" : undefined,
                  },
                ]}
              />
            </Panel>
          ) : null}

          {h.emailUsage?.length ? (
            <Panel style={s.gap12} title="Email quota" hint="Optional mail waits at the line; codes and receipts always send">
              {h.emailUsage.map((w, i) => {
                const tone = quotaTone(w.sent, w.optionalCeiling, w.limit);
                return (
                  <View key={w.window} style={[s.quota, i > 0 && s.quotaRule]}>
                    <View style={s.quotaHead}>
                      <Text style={s.quotaTitle}>{WINDOW[w.window] ?? w.window}</Text>
                      <Text style={s.quotaValue}>{`${count(w.sent)} / ${count(w.limit)}`}</Text>
                    </View>
                    <View style={s.meter}>
                      <Meter
                        pct={w.limit ? (w.sent / w.limit) * 100 : 0}
                        color={tone === "ok" ? a.ok : tone === "warn" ? a.warn : a.bad}
                        mark={w.limit ? (w.optionalCeiling / w.limit) * 100 : undefined}
                      />
                    </View>
                    <Text style={s.quotaSub}>{`Optional mail until ${count(w.optionalCeiling)}`}</Text>
                  </View>
                );
              })}
            </Panel>
          ) : null}

          {h.push ? (
            <Panel
              style={s.gap12}
              title="Push"
              hint="Phones the API can reach, and the payment alerts"
              titleExtra={<Badge label="NEW" tone="blue" />}
            >
              <DefRows
                rows={[
                  {
                    term: "Phones registered",
                    value: `${count(h.push.phonesRegistered)} · ${count(h.push.android)} Android · ${count(h.push.ios)} iOS`,
                  },
                  { term: "Admin phones with payment alerts", value: count(h.push.adminAlertPhones) },
                  {
                    term: "Last payment alert",
                    value: h.push.lastPaymentAlertAtUtc
                      ? `${clock(parseUtc(h.push.lastPaymentAlertAtUtc))} · reached ${h.push.lastPaymentAlertAccepted} of ${h.push.lastPaymentAlertDevices}`
                      : "None yet",
                  },
                  { term: "Refused by Expo, last 24 h", value: count(h.push.refusedLast24h), tone: h.push.refusedLast24h ? "warn" : undefined },
                  {
                    // Every push, not only payment alerts: what Google or Apple did with it (Expo's receipts).
                    term: "Not delivered, last 24 h",
                    value: `${count(h.push.notDeliveredLast24h ?? 0)} of ${count(h.push.receiptsLast24h ?? 0)}`,
                    tone: h.push.notDeliveredLast24h ? "warn" : undefined,
                  },
                ]}
              />
              {h.push.notDeliveredLast24h && h.push.lastProblem ? (
                <WarnNote style={s.gap12}>{h.push.lastProblem}</WarnNote>
              ) : null}
            </Panel>
          ) : null}

          {h.workerHeartbeats?.length ? (
            <Panel style={s.gap12} title="Background workers" hint="Last run, how long, what it said">
              {h.workerHeartbeats.map((w, i) => (
                <View key={w.workerName} style={[s.worker, i > 0 && s.quotaRule]}>
                  <View style={s.flex}>
                    <Text style={s.workerName}>{w.workerName}</Text>
                    <Text style={s.workerSub} numberOfLines={2}>
                      {[agoSentence(parseUtc(w.lastRunUtc), now), `${w.durationMs} ms`, w.detail].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Badge label={w.status} tone={tierTone(w.status)} />
                </View>
              ))}
            </Panel>
          ) : null}

          <Panel style={s.gap12} title="Jobs and Pro">
            <DefRows
              rows={[
                { term: "Transcriptions, last 24 h", value: count(h.activity.jobsLast24Hours) },
                { term: "Transcriptions, last 7 days", value: count(h.activity.jobsLast7Days) },
                { term: "Pro members now", value: `${count(h.subscriptions.activeCount)} · ${count(h.subscriptions.giftedCount)} gifted` },
                { term: "Ending in 7 days", value: count(h.subscriptions.expiringWithinSevenDays) },
              ]}
            />
          </Panel>

          {h.notMonitored.length ? (
            <Panel style={s.gap12} title="Not monitored" hint="Named rather than faked">
              {h.notMonitored.map((n) => (
                <Text key={n} style={s.notMonitored}>
                  {n}
                </Text>
              ))}
            </Panel>
          ) : null}
        </>
      )}
    </AdminPage>
  );
}

function Verdict({ health }: { health: SystemHealth }) {
  const s = useAdminStyles(makeStyles);
  const word = healthWord(health.status);
  const down = [health.database, health.transcriptionWorker, health.webhookBacklog].filter((t) => tierTone(t.status) !== "ok");
  return (
    <View style={[s.card, s.verdict, s.gap14]}>
      <Dot tone={word.tone} size={14} />
      <View style={s.flex}>
        <Text style={s.verdictWord}>{word.word}</Text>
        <Text style={s.verdictSub}>
          {down.length ? down.map((t) => `${t.name}: ${t.detail ?? t.status}`).join(" ") : "Every tier answered. The worst of the three decides this word."}
        </Text>
      </View>
    </View>
  );
}

function Tier({ tier, first }: { tier: HealthPanel; first: boolean }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const tone = tierTone(tier.status);
  const label = tone === "ok" ? (tier.name === "Webhook backlog" ? "Clear" : "Healthy") : tone === "warn" ? "Degraded" : "Down";
  return (
    <View style={[s.tier, !first && s.tierRule]}>
      <View style={s.tierTile}>
        <Icon name={TIER_ICON[tier.name] ?? "server"} size={18} color={a.icon} />
      </View>
      <View style={s.flex}>
        <Text style={s.tierName}>{tier.name === "Webhook backlog" ? "Webhooks" : tier.name}</Text>
        <Text style={s.tierSub} numberOfLines={2}>
          {tone === "ok" ? (tier.detail ?? TIER_SUB[tier.name] ?? "") : (tier.detail ?? "")}
        </Text>
      </View>
      {tier.latencyMs !== null ? <Text style={s.latency}>{`${tier.latencyMs} ms`}</Text> : null}
      <Badge label={label} tone={tone} />
    </View>
  );
}

function StatusWord({ status }: { status: string }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const tone = tierTone(status);
  return (
    <View style={s.statusWord}>
      <View style={[s.dot, { backgroundColor: tone === "ok" ? a.ok : tone === "warn" ? a.warn : a.bad }]} />
      <Text style={[s.statusText, { color: tone === "ok" ? a.ok : tone === "warn" ? a.warn : a.bad }]}>
        {tone === "ok" ? "Healthy" : tone === "warn" ? "Late" : "Down"}
      </Text>
    </View>
  );
}

function runAgo(run: BackupRun | null, now: Date): string {
  if (!run) return "Never";
  return `${agoSentence(parseUtc(run.finishedAtUtc), now)}${run.ok ? "" : " · failed"}`;
}

function lastDump(run: BackupRun | null, now: Date): string {
  if (!run) return "No database backup yet";
  return `Last database backup ${agoSentence(parseUtc(run.finishedAtUtc), now)} · ${bytes(run.sizeBytes)}${run.verified ? " · verified" : ""}`;
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    gap10: { marginTop: 10 },
    gap12: { marginTop: 12 },
    gap14: { marginTop: 14 },
    card: { backgroundColor: a.card, borderWidth: 1, borderColor: a.line, borderRadius: 12, overflow: "hidden" },
    pinned: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 48,
      paddingHorizontal: 16,
      backgroundColor: a.bg,
      borderBottomWidth: 1,
      borderBottomColor: a.line,
    },
    pinnedTitle: { fontFamily: fonts.semibold, fontSize: 17, color: a.text },
    pinnedWord: { flexDirection: "row", alignItems: "center", gap: 6 },
    pinnedWordText: { fontFamily: fonts.medium, fontSize: 14 },
    verdict: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16 },
    verdictWord: { fontFamily: fonts.semibold, fontSize: 24, letterSpacing: -0.4, color: a.text },
    verdictSub: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: a.muted, marginTop: 3 },
    tier: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 12 },
    tierRule: { borderTopWidth: 1, borderTopColor: a.line },
    tierTile: { width: 34, height: 34, borderRadius: 9, backgroundColor: a.sub, alignItems: "center", justifyContent: "center" },
    tierName: { fontFamily: fonts.medium, fontSize: 15, color: a.text },
    tierSub: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 2 },
    latency: { fontFamily: fonts.regular, fontSize: 13, color: a.muted, fontVariant: ["tabular-nums"] },
    problems: { gap: 6, marginBottom: 10 },
    problem: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
    problemText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: a.warnDeep },
    backupLine: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 6 },
    backupText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: a.text },
    quota: { paddingVertical: 10 },
    quotaRule: { borderTopWidth: 1, borderTopColor: a.line2 },
    quotaHead: { flexDirection: "row", justifyContent: "space-between" },
    quotaTitle: { fontFamily: fonts.medium, fontSize: 14.5, color: a.text },
    quotaValue: { fontFamily: fonts.semibold, fontSize: 14.5, color: a.text, fontVariant: ["tabular-nums"] },
    meter: { marginVertical: 10 },
    quotaSub: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted },
    worker: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
    workerName: { fontFamily: fonts.medium, fontSize: 14.5, color: a.text },
    workerSub: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 2 },
    notMonitored: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: a.muted, paddingVertical: 4 },
    statusWord: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontFamily: fonts.medium, fontSize: 13.5 },
  });
