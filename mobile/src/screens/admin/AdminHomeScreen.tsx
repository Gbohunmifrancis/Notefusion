import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { Card } from "../../components/Card";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import {
  fonts,
  motion,
  radii,
  spacing,
  typography,
  type Palette,
} from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import {
  AdminHeader,
  RefreshButton,
  SectionTitle,
  Stat,
  StatusPill,
  ago,
  dateTime,
  money,
  type Tone,
} from "./parts";
import type {
  HealthPanel,
  PaymentOpsSummary,
  SystemHealth,
} from "../../api/types";
import type { RootStackParams } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "AdminHome">;

/** The health endpoint's own words, as a colour. */
function healthTone(status: string): Tone {
  const s = status.toLowerCase();
  if (s === "healthy" || s === "ok") return "good";
  if (s === "degraded" || s === "warning") return "warn";
  return "bad";
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The operator's landing page: what state the money is in, then the way into each
 * tool.
 *
 * It leads with `verifiedCount` rather than revenue because that is the only
 * number here nobody else is watching. A `Verified` payment means the provider
 * confirmed the charge and the ledger entry and subscription were never written —
 * a customer who has paid and has no Pro — and the reconciliation sweep does not
 * pick those up, because it only looks at rows still in `Processing`. Everything
 * else on this screen either heals itself or is only interesting monthly.
 */
export function AdminHomeScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [summary, setSummary] = useState<PaymentOpsSummary | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(() => {
    setBusy(true);
    // Settled, not `all`: a health probe that cannot answer must not hide the
    // money, which is what this screen is for. Only the summary's failure is
    // reported, because only the summary is load-bearing.
    void Promise.allSettled([adminApi.paymentsSummary(), adminApi.health()])
      .then(([s, h]) => {
        if (s.status === "fulfilled") setSummary(s.value);
        setError(s.status === "rejected" ? toApiError(s.reason).message : null);
        setHealth(h.status === "fulfilled" ? h.value : null);
      })
      .finally(() => setBusy(false));
  }, []);

  useEffect(load, [load]);

  const needsAttention =
    summary !== null && (summary.verifiedCount > 0 || summary.stuckCount > 0);

  return (
    <Screen>
      <AdminHeader
        label="Operations"
        title="Admin"
        onBack={() =>
          navigation.canGoBack()
            ? navigation.goBack()
            : navigation.navigate("Tabs", { screen: "Home" })
        }
        right={<RefreshButton onPress={load} busy={busy} />}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={load}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {error ? (
          <Card style={styles.errorCard}>
            <Ionicons name="alert-circle" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        ) : null}

        {summary ? (
          <>
            {/* ── What needs a human ───────────────────────────────────────── */}
            <Card style={needsAttention ? styles.alertCard : undefined}>
              <View style={styles.cardHead}>
                <Ionicons
                  name={needsAttention ? "warning-outline" : "checkmark-circle-outline"}
                  size={16}
                  color={needsAttention ? colors.danger : colors.success}
                />
                <Text style={styles.cardTitle}>
                  {needsAttention ? "Needs attention" : "Nothing waiting"}
                </Text>
              </View>

              <View style={styles.statRow}>
                <Stat
                  label="Paid, no Pro"
                  value={String(summary.verifiedCount)}
                  tone={summary.verifiedCount > 0 ? "bad" : "muted"}
                  hint="Not self-healing"
                />
                <Stat
                  label="Stuck"
                  value={String(summary.stuckCount)}
                  tone={summary.stuckCount > 0 ? "warn" : "muted"}
                  hint={`Over ${summary.graceWindowMinutes}m`}
                />
                <Stat
                  label="Oldest"
                  value={
                    summary.oldestStuckSinceUtc
                      ? ago(summary.oldestStuckSinceUtc)
                      : "—"
                  }
                  hint={`Sweep ${summary.sweepIntervalMinutes}m`}
                />
              </View>

              <Text style={styles.cardNote}>
                {summary.verifiedCount > 0
                  ? "Verified means the money is confirmed and the subscription was never applied. Reconciling does not retry that state — open the account, gift Pro to unblock the customer, then escalate it."
                  : "The sweep picks up anything still Processing past the grace window. Reconcile from a payment row to force it now."}
              </Text>
            </Card>

            {/* ── Money ────────────────────────────────────────────────────── */}
            <SectionTitle>Ledger · all time</SectionTitle>
            <Card>
              <View style={styles.statRow}>
                <Stat
                  label="Net"
                  value={money(summary.netMinor, summary.currency)}
                  tone="good"
                />
                <Stat
                  label="In"
                  value={money(summary.creditedMinor, summary.currency)}
                />
                <Stat
                  label="Refunded"
                  value={money(summary.refundedMinor, summary.currency)}
                />
              </View>
              <Text style={styles.cardNote}>
                Summed from the ledger entries themselves, so it cannot drift from a
                stored total. Gifted subscriptions are absent by design — no
                payment, no entry.
              </Text>
            </Card>

            {/* ── Payment states ───────────────────────────────────────────── */}
            <SectionTitle>Payments</SectionTitle>
            <Card>
              <View style={styles.statRow}>
                <Stat label="Pending" value={String(summary.pendingCount)} />
                <Stat
                  label="Processing"
                  value={String(summary.processingCount)}
                />
                <Stat
                  label="Completed"
                  value={String(summary.completedCount)}
                  tone="good"
                />
                <Stat label="Failed" value={String(summary.failedCount)} />
              </View>
            </Card>

            {/* ── Webhook inbox ────────────────────────────────────────────── */}
            <SectionTitle>Webhook inbox</SectionTitle>
            <Card>
              <View style={styles.statRow}>
                <Stat
                  label="Awaiting"
                  value={String(summary.webhooksAwaitingCount)}
                  tone={summary.webhooksAwaitingCount > 0 ? "warn" : "muted"}
                  hint={
                    summary.oldestAwaitingWebhookAtUtc
                      ? `oldest ${ago(summary.oldestAwaitingWebhookAtUtc)}`
                      : undefined
                  }
                />
                <Stat
                  label="Processed"
                  value={String(summary.webhooksProcessedCount)}
                  tone="good"
                />
                <Stat
                  label="Failed"
                  value={String(summary.webhooksFailedCount)}
                  tone={summary.webhooksFailedCount > 0 ? "bad" : "muted"}
                />
              </View>
            </Card>
          </>
        ) : null}

        {/* ── Health ─────────────────────────────────────────────────────────── */}
        {health ? (
          <>
            <SectionTitle>System</SectionTitle>
            <Card>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>
                  Checked {dateTime(health.checkedAtUtc)}
                </Text>
                <StatusPill
                  label={health.status}
                  tone={healthTone(health.status)}
                />
              </View>

              <Panel panel={health.database} />
              <Panel panel={health.transcriptionWorker} />
              <Panel panel={health.webhookBacklog} />

              <View style={styles.divider} />

              <View style={styles.statRow}>
                <Stat
                  label="Active subs"
                  value={String(health.subscriptions.activeCount)}
                />
                <Stat
                  label="Gifted"
                  value={String(health.subscriptions.giftedCount)}
                />
                <Stat
                  label="Ending ≤7d"
                  value={String(health.subscriptions.expiringWithinSevenDays)}
                />
                <Stat
                  label="Past due"
                  value={String(health.subscriptions.pastDueCount)}
                  tone={health.subscriptions.pastDueCount > 0 ? "warn" : "muted"}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.statRow}>
                <Stat
                  label="Jobs · 24h"
                  value={String(health.activity.jobsLast24Hours)}
                />
                <Stat
                  label="Jobs · 7d"
                  value={String(health.activity.jobsLast7Days)}
                />
              </View>

              {health.notMonitored.length > 0 ? (
                <Text style={styles.cardNote}>
                  Not monitored: {health.notMonitored.join(", ")}.
                </Text>
              ) : null}
            </Card>
          </>
        ) : null}

        {/* ── Tools ──────────────────────────────────────────────────────────── */}
        <SectionTitle>Tools</SectionTitle>
        <NavRow
          icon="card-outline"
          label="Payments"
          hint="Find a charge, reconcile a stuck one"
          onPress={() => navigation.navigate("AdminPayments")}
        />
        <NavRow
          icon="git-pull-request-outline"
          label="Webhook inbox"
          hint="Why a provider callback would not drain"
          onPress={() => navigation.navigate("AdminWebhooks")}
        />
        <NavRow
          icon="people-outline"
          label="Accounts"
          hint="Gift or end Pro, suspend, send a reset"
          onPress={() => navigation.navigate("AdminUsers")}
        />
      </ScrollView>
    </Screen>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** One tier of the health check. `detail` is where a real failure explains itself. */
function Panel({ panel }: { panel: HealthPanel }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text style={styles.panelName}>{panel.name}</Text>
        <StatusPill label={panel.status} tone={healthTone(panel.status)} />
        {panel.latencyMs !== null ? (
          <Text style={styles.panelLatency}>{panel.latencyMs}ms</Text>
        ) : null}
      </View>
      {panel.detail ? (
        <Text style={styles.panelDetail}>{panel.detail}</Text>
      ) : null}
    </View>
  );
}

function NavRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Touchable
      onPress={onPress}
      style={styles.navRow}
      radius={radii.lg}
      scaleTo={motion.scale.row}
      accessibilityLabel={label}
    >
      <View style={styles.navIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <View style={styles.navText}>
        <Text style={styles.navLabel}>{label}</Text>
        <Text style={styles.navHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Touchable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      paddingBottom: spacing.xxxl,
    },

    cardHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    cardTitle: {
      ...typography.label,
      color: c.text,
      fontSize: 14,
      fontFamily: fonts.bold,
      flex: 1,
    },
    cardNote: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: spacing.md,
    },

    /** Only when something is actually waiting — a permanently red card stops
     *  being read within a week. */
    alertCard: {
      borderColor: c.dangerBorder,
      backgroundColor: c.dangerSoft,
    },

    errorCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderColor: c.dangerBorder,
      marginBottom: spacing.md,
    },
    errorText: {
      ...typography.body,
      color: c.danger,
      fontSize: 13,
      flex: 1,
    },

    statRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: spacing.md,
      columnGap: spacing.sm,
    },

    divider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: spacing.md,
    },

    // ── Health panels ───────────────────────────────────────────────────────
    panel: {
      marginBottom: spacing.sm,
    },
    panelHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    panelName: {
      ...typography.label,
      color: c.text,
      fontSize: 13,
      flex: 1,
    },
    panelLatency: {
      ...typography.mono,
      color: c.textFaint,
      fontSize: 11,
    },
    panelDetail: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 11.5,
      marginTop: 2,
    },

    // ── Tool rows ───────────────────────────────────────────────────────────
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    navIcon: {
      width: 38,
      height: 38,
      borderRadius: radii.md,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    navText: {
      flex: 1,
    },
    navLabel: {
      ...typography.label,
      color: c.text,
      fontSize: 15,
      fontFamily: fonts.bold,
    },
    navHint: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 11.5,
      marginTop: 1,
    },
  });
