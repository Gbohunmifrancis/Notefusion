import React, { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../../components/Screen";
import { Card } from "../../components/Card";
import { Button } from "../../components/Button";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import { toApiError } from "../../api/client";
import { showDialog } from "../../lib/dialog";
import {
  fonts,
  motion,
  spacing,
  typography,
  type Palette,
} from "../../design/theme";
import { useColors, useThemedStyles } from "../../lib/theme";
import {
  AdminHeader,
  Field,
  ListState,
  RefreshButton,
  SectionTitle,
  StatusPill,
  ago,
  dateTime,
  money,
  parseUtc,
  paymentTone,
} from "./parts";
import type { AdminUserDetail, BillingInterval } from "../../api/types";
import type { RootStackParams } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParams, "AdminUser">;

/**
 * Stamped on every mutation from this screen.
 *
 * The audit trail already records who and what; this records *where*, which is the
 * question asked when an action looks out of character — a gift granted from a
 * phone at midnight reads differently from one granted at a desk.
 */
const NOTE = "via mobile admin";

const GIFTS: { label: string; duration: BillingInterval }[] = [
  { label: "Monthly", duration: "monthly" },
  { label: "Yearly", duration: "yearly" },
  { label: "Lifetime", duration: "lifetime" },
];

const EXTENSIONS: { label: string; days?: number; months?: number }[] = [
  { label: "+7 days", days: 7 },
  { label: "+1 month", months: 1 },
  { label: "+3 months", months: 3 },
];

/**
 * The new period end, as UTC ISO.
 *
 * Counts from *now* when the old end is already behind us: the server only
 * requires the new end to be later than the one it replaces, so adding a month to
 * a date three months gone would satisfy that check and still grant nothing.
 */
function extendedEnd(
  currentEndUtc: string,
  by: { days?: number; months?: number },
): string {
  const from = Math.max(parseUtc(currentEndUtc).getTime(), Date.now());
  const d = new Date(from);
  if (by.months) d.setUTCMonth(d.getUTCMonth() + by.months);
  if (by.days) d.setUTCDate(d.getUTCDate() + by.days);
  return d.toISOString();
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * One account, and every operator action the server already supports.
 *
 * Each action is shown only in the state that makes it legal — gifting is hidden
 * while a subscription is active, revoking only appears for a gift, extending only
 * for a dated period — because the API refuses those combinations anyway, and a
 * button that exists to return an error teaches the operator to distrust the
 * screen. Role changes are deliberately absent: granting admin is not a decision
 * to take one-handed, and the console has it.
 */
export function AdminUserScreen({ navigation, route }: Props) {
  const { userId } = route.params;
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setUser(await adminApi.user(userId));
      setError(null);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Runs one mutation, then re-reads the account rather than patching state
   * locally: `hasProAccess` and the subscription window are computed server-side,
   * and a client that guesses at the new shape eventually disagrees with it.
   */
  async function run(key: string, done: string, fn: () => Promise<void>) {
    setAction(key);
    try {
      await fn();
      await load();
      showDialog({
        title: done,
        icon: "checkmark-circle-outline",
        tone: "brand",
      });
    } catch (e) {
      const err = toApiError(e);
      showDialog({
        title: "Couldn't do that",
        message: `${err.message}\n\n${err.code}`,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    } finally {
      setAction(null);
    }
  }

  function confirm(opts: {
    title: string;
    message: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    destructive?: boolean;
    key: string;
    done: string;
    fn: () => Promise<void>;
  }) {
    showDialog({
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      tone: opts.destructive ? "danger" : "brand",
      actions: [
        {
          label: opts.label,
          style: opts.destructive ? "destructive" : "default",
          icon: opts.icon,
          onPress: () => void run(opts.key, opts.done, opts.fn),
        },
        { label: "Cancel", style: "cancel" },
      ],
    });
  }

  const sub = user?.subscription ?? null;
  const locked =
    user?.lockoutEndAt != null &&
    parseUtc(user.lockoutEndAt).getTime() > Date.now();

  return (
    <Screen>
      <AdminHeader
        label="Account"
        title={user?.fullName ?? "Account"}
        onBack={() => navigation.goBack()}
        right={<RefreshButton onPress={() => void load()} busy={busy} />}
      />

      {user === null ? (
        <ListState
          loading={busy}
          error={error}
          emptyIcon="person-outline"
          emptyTitle="Not found"
          emptyHint="No account with that id."
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={busy}
              onRefresh={() => void load()}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
        >
          {/* ── Identity ─────────────────────────────────────────────────────── */}
          <Card>
            <View style={styles.pills}>
              {user.role === "Admin" ? (
                <StatusPill label="Admin" tone="info" />
              ) : null}
              {sub?.isGift ? (
                <StatusPill label="Gifted Pro" tone="warn" />
              ) : sub?.isActive ? (
                <StatusPill label="Pro" tone="good" />
              ) : (
                <StatusPill label="Free" tone="muted" />
              )}
              {!user.isActive ? (
                <StatusPill label="Suspended" tone="bad" />
              ) : null}
              {locked ? <StatusPill label="Locked out" tone="bad" /> : null}
            </View>

            <Field label="Email" value={user.email} mono />
            <Field label="Phone" value={user.phoneNumber} />
            <Field label="Country" value={user.country} />
            <Field
              label="Sign-in"
              value={
                [user.hasGoogle && "Google", user.hasPassword && "Password"]
                  .filter(Boolean)
                  .join(" + ") || "None"
              }
            />
            <Field label="Joined" value={dateTime(user.createdAt)} />
            <Field
              label="Last seen"
              value={
                user.lastLoginAt
                  ? `${dateTime(user.lastLoginAt)} · ${ago(user.lastLoginAt)} ago`
                  : "Never"
              }
            />
            {locked && user.lockoutEndAt ? (
              <Field
                label="Locked until"
                value={dateTime(user.lockoutEndAt)}
                tone="bad"
              />
            ) : null}
            <Field
              label="Transcriptions"
              value={String(user.transcriptionCount)}
            />
            <Field
              label="Free trial"
              value={`${user.trialGenerationsUsed} of ${user.trialGenerationsTotal} used`}
            />
          </Card>

          {/* ── Subscription ─────────────────────────────────────────────────── */}
          <SectionTitle>Subscription</SectionTitle>
          <Card>
            {sub === null ? (
              <Text style={styles.note}>
                No subscription. Gifting grants Pro at no charge — no payment and
                no ledger entry, because a gift is not revenue.
              </Text>
            ) : (
              <>
                <Field label="Plan" value={sub.planName ?? sub.planCode} />
                <Field label="Status" value={sub.status} />
                <Field label="Provider" value={sub.provider} />
                <Field
                  label="Started"
                  value={dateTime(sub.currentPeriodStartUtc)}
                />
                <Field
                  label="Ends"
                  value={
                    sub.isLifetime
                      ? "Never — lifetime"
                      : sub.currentPeriodEndUtc
                        ? dateTime(sub.currentPeriodEndUtc)
                        : null
                  }
                />
                {sub.canceledAtUtc ? (
                  <Field
                    label="Canceled"
                    value={dateTime(sub.canceledAtUtc)}
                    tone="bad"
                  />
                ) : null}
              </>
            )}

            {/* Gifting is refused while a subscription is active, so it is only
                offered when there is nothing in the way. */}
            {!sub?.isActive ? (
              <>
                <Text style={styles.actionLabel}>Gift Pro</Text>
                <View style={styles.buttonRow}>
                  {GIFTS.map((g) => (
                    <Button
                      key={g.duration}
                      label={g.label}
                      variant="secondary"
                      loading={action === `gift-${g.duration}`}
                      disabled={action !== null}
                      style={styles.rowButton}
                      onPress={() =>
                        confirm({
                          title: `Gift ${g.label.toLowerCase()} Pro?`,
                          message: `${user.email} gets Pro at no charge. This writes no payment and no ledger entry.`,
                          label: "Gift Pro",
                          icon: "gift-outline",
                          key: `gift-${g.duration}`,
                          done: `${g.label} Pro granted`,
                          fn: () => adminApi.giftPro(user.id, g.duration, NOTE),
                        })
                      }
                    />
                  ))}
                </View>
              </>
            ) : null}

            {/* A lifetime period has a year-9999 sentinel behind it; there is
                nothing to move. */}
            {sub?.isActive && !sub.isLifetime && sub.currentPeriodEndUtc ? (
              <>
                <Text style={styles.actionLabel}>Extend the period</Text>
                <View style={styles.buttonRow}>
                  {EXTENSIONS.map((x) => (
                    <Button
                      key={x.label}
                      label={x.label}
                      variant="secondary"
                      loading={action === `extend-${x.label}`}
                      disabled={action !== null}
                      style={styles.rowButton}
                      onPress={() => {
                        const end = sub.currentPeriodEndUtc;
                        if (!end) return;
                        const next = extendedEnd(end, x);
                        confirm({
                          title: `Extend by ${x.label.replace("+", "")}?`,
                          message: `The period will end ${dateTime(next)}.`,
                          label: "Extend",
                          icon: "calendar-outline",
                          key: `extend-${x.label}`,
                          done: "Period extended",
                          fn: () =>
                            adminApi.extendSubscription(user.id, next, NOTE),
                        });
                      }}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {sub?.isGift ? (
              <Button
                label="Revoke the gift"
                variant="danger"
                icon="close-circle-outline"
                loading={action === "revoke"}
                disabled={action !== null}
                style={styles.stacked}
                onPress={() =>
                  confirm({
                    title: "Revoke this gift?",
                    message: `${user.email} loses Pro immediately. Only gifts can be revoked — a paid subscription is refused.`,
                    label: "Revoke",
                    icon: "close-circle-outline",
                    destructive: true,
                    key: "revoke",
                    done: "Gift revoked",
                    fn: () => adminApi.revokePro(user.id, NOTE),
                  })
                }
              />
            ) : null}

            {sub?.isActive ? (
              <Button
                label="End the subscription now"
                variant="danger"
                icon="stop-circle-outline"
                loading={action === "end"}
                disabled={action !== null}
                style={styles.stacked}
                onPress={() =>
                  confirm({
                    title: "End it now?",
                    message:
                      "The rest of the paid period is forfeited and nothing is refunded. Refunds happen at the provider.",
                    label: "End it",
                    icon: "stop-circle-outline",
                    destructive: true,
                    key: "end",
                    done: "Subscription ended",
                    fn: () => adminApi.endSubscription(user.id, NOTE),
                  })
                }
              />
            ) : null}
          </Card>

          {/* ── Access ───────────────────────────────────────────────────────── */}
          <SectionTitle>Access</SectionTitle>
          <Card>
            {user.isActive ? (
              <Button
                label="Suspend this account"
                variant="danger"
                icon="ban-outline"
                loading={action === "suspend"}
                disabled={action !== null}
                onPress={() =>
                  confirm({
                    title: "Suspend this account?",
                    message:
                      "Sign-in is blocked and refresh tokens are revoked. An access token already issued keeps working until it expires — up to an hour.",
                    label: "Suspend",
                    icon: "ban-outline",
                    destructive: true,
                    key: "suspend",
                    done: "Account suspended",
                    fn: () => adminApi.suspend(user.id, NOTE),
                  })
                }
              />
            ) : (
              <Button
                label="Reactivate this account"
                icon="checkmark-circle-outline"
                loading={action === "reactivate"}
                disabled={action !== null}
                onPress={() =>
                  confirm({
                    title: "Reactivate this account?",
                    message: `${user.email} will be able to sign in again.`,
                    label: "Reactivate",
                    icon: "checkmark-circle-outline",
                    key: "reactivate",
                    done: "Account reactivated",
                    fn: () => adminApi.reactivate(user.id, NOTE),
                  })
                }
              />
            )}

            <Button
              label="Email a password reset"
              variant="secondary"
              icon="mail-outline"
              loading={action === "reset"}
              disabled={action !== null}
              style={styles.stacked}
              onPress={() =>
                confirm({
                  title: "Send a reset link?",
                  message: `A link goes to ${user.email}. This is the supported way to help someone locked out — it puts the new password in their hands, not yours.`,
                  label: "Send it",
                  icon: "mail-outline",
                  key: "reset",
                  done: "Reset link sent",
                  fn: () => adminApi.sendPasswordReset(user.id, NOTE),
                })
              }
            />

            {!user.hasPassword ? (
              <Text style={styles.note}>
                This account signs in with Google and has no password, so a reset
                link is what creates one.
              </Text>
            ) : null}
            {locked ? (
              <Text style={styles.note}>
                The lockout is from failed sign-ins and lifts on its own. A reset
                link is the faster way through it.
              </Text>
            ) : null}
          </Card>

          {/* ── Payments ─────────────────────────────────────────────────────── */}
          <SectionTitle>Payments</SectionTitle>
          {user.payments.length === 0 ? (
            <Card>
              <Text style={styles.note}>
                No payment attempts. A gifted account never has any.
              </Text>
            </Card>
          ) : (
            <Card padded={false}>
              {user.payments.map((p, i) => (
                <Touchable
                  key={p.id}
                  // The repair lives on the payment, so tapping goes there rather
                  // than duplicating Reconcile on this screen.
                  onPress={() =>
                    navigation.push("AdminPayments", { search: p.reference })
                  }
                  style={[styles.subRow, i > 0 && styles.subRowDivided]}
                  scaleTo={motion.scale.row}
                  accessibilityLabel={`${p.reference}, ${p.status}`}
                >
                  <View style={styles.subMain}>
                    <Text style={styles.subTitle} numberOfLines={1}>
                      {p.planName ?? p.provider}
                    </Text>
                    <Text style={styles.subRef} numberOfLines={1}>
                      {p.reference}
                    </Text>
                    <Text style={styles.subMeta}>
                      {dateTime(p.createdAtUtc)}
                    </Text>
                    {p.failureReason ? (
                      <Text style={styles.subError} numberOfLines={2}>
                        {p.failureReason}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.subRight}>
                    <Text style={styles.subAmount}>
                      {money(p.amountMinor, p.currency)}
                    </Text>
                    <StatusPill label={p.status} tone={paymentTone(p.status)} />
                  </View>
                </Touchable>
              ))}
            </Card>
          )}

          {/* ── Ledger ───────────────────────────────────────────────────────── */}
          {user.ledger.length > 0 ? (
            <>
              <SectionTitle>Ledger</SectionTitle>
              <Card padded={false}>
                {user.ledger.map((entry, i) => (
                  <View
                    key={entry.id}
                    style={[styles.subRow, i > 0 && styles.subRowDivided]}
                  >
                    <View style={styles.subMain}>
                      <Text style={styles.subTitle}>
                        {entry.direction} · {entry.reason}
                      </Text>
                      <Text style={styles.subMeta} numberOfLines={2}>
                        {entry.description}
                      </Text>
                      <Text style={styles.subMeta}>
                        {dateTime(entry.createdAtUtc)}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.subAmount,
                        {
                          color:
                            entry.direction === "Credit"
                              ? colors.success
                              : colors.danger,
                        },
                      ]}
                    >
                      {money(entry.amountMinor, entry.currency)}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* ── Audit ────────────────────────────────────────────────────────── */}
          {user.recentActions.length > 0 ? (
            <>
              <SectionTitle>Recent admin actions</SectionTitle>
              <Card padded={false}>
                {user.recentActions.map((a, i) => (
                  <View
                    key={a.id}
                    style={[styles.subRow, i > 0 && styles.subRowDivided]}
                  >
                    <View style={styles.subMain}>
                      <Text style={styles.subTitle}>{a.summary}</Text>
                      <Text style={styles.subMeta} numberOfLines={1}>
                        {a.actorEmail} · {dateTime(a.occurredAtUtc)}
                      </Text>
                      {a.note ? (
                        <Text style={styles.subNote}>“{a.note}”</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      paddingBottom: spacing.xxxl,
    },

    pills: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    note: {
      ...typography.caption,
      color: c.textMuted,
      fontSize: 11.5,
      lineHeight: 17,
      marginTop: spacing.md,
    },

    actionLabel: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 10,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    buttonRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    rowButton: {
      flex: 1,
    },
    stacked: {
      marginTop: spacing.sm,
    },

    // ── Nested lists ────────────────────────────────────────────────────────
    subRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.md,
      padding: spacing.lg,
    },
    subRowDivided: {
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    subMain: {
      flex: 1,
    },
    subTitle: {
      fontSize: 13.5,
      fontFamily: fonts.semibold,
      color: c.text,
    },
    subRef: {
      ...typography.mono,
      fontSize: 11,
      color: c.textMuted,
      marginTop: 2,
    },
    subMeta: {
      fontSize: 11.5,
      fontFamily: fonts.regular,
      color: c.textFaint,
      marginTop: 2,
    },
    subNote: {
      fontSize: 11.5,
      fontFamily: fonts.regular,
      color: c.textMuted,
      fontStyle: "italic",
      marginTop: 2,
    },
    subError: {
      ...typography.mono,
      fontSize: 10.5,
      lineHeight: 15,
      color: c.danger,
      marginTop: spacing.xs,
    },
    subRight: {
      alignItems: "flex-end",
      gap: spacing.xs,
    },
    subAmount: {
      fontSize: 13,
      fontFamily: fonts.bold,
      color: c.text,
    },
  });
