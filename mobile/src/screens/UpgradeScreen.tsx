import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { BrandMark } from "../components/BrandMark";
import { billingApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import {
  fonts,
  gradients,
  radii,
  spacing,
  typography,
  type Palette,
  type Shadows,
} from "../design/theme";
import { useColors, useThemedStyles } from "../lib/theme";
import type { Plan, Subscription } from "../api/types";
import type { RootStackParams } from "../navigation/types";

type Props = { navigation: any; route?: any };

/**
 * The deep link the provider redirects to when hosted checkout finishes. It has to
 * match BillingSettings.CheckoutCallbackUrl on the server and app.json's "scheme",
 * so openAuthSessionAsync can detect the return and close the external browser.
 */
const RETURN_URL = "notefusion://billing/return";

/** What Pro unlocks — the paywall's value proposition. */
const PRO_FEATURES: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: "infinite", text: "Unlimited transcriptions" },
  { icon: "musical-notes", text: "Full staff notation & MIDI export" },
  { icon: "sync", text: "Cloud library sync across devices" },
  { icon: "flash", text: "Priority processing queue" },
];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "$4.99" for USD; falls back to "USD 4.99" for anything else. */
function formatPrice(amountMinor: number, currency: string): string {
  const major = (amountMinor / 100).toFixed(2);
  return currency === "USD" ? `$${major}` : `${currency} ${major}`;
}

/** Percentage a yearly plan saves over paying monthly for a year, or null. */
function savingsPercent(monthly?: Plan, yearly?: Plan): number | null {
  if (!monthly || !yearly) return null;
  const fullYear = monthly.amountMinor * 12;
  if (fullYear <= 0) return null;
  const pct = Math.round((1 - yearly.amountMinor / fullYear) * 100);
  return pct > 0 ? pct : null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * UpgradeScreen — the Pro paywall and external-browser checkout.
 *
 * The app never collects card details (store-policy safe, Spotify-style): it asks
 * the API to start a hosted-checkout session, opens the returned provider URL in an
 * external browser, and — because the real result arrives out-of-band by webhook —
 * polls my-subscription after the browser closes to learn when Pro unlocks.
 *
 * If the caller is already Pro, the paywall is replaced by a status card.
 */
export function UpgradeScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // opening checkout
  const [verifying, setVerifying] = useState(false); // polling after return

  // Guards against setState after the screen unmounts mid-poll.
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [planList, sub] = await Promise.all([
        billingApi.plans(),
        billingApi.mySubscription(),
      ]);
      if (!mounted.current) return;
      setPlans(planList);
      setSubscription(sub);
      // Default to the best-value (highest) plan so the recommended choice is preselected.
      const best = [...planList].sort((a, b) => b.amountMinor - a.amountMinor)[0];
      setSelectedId((cur) => cur ?? best?.id ?? null);
    } catch {
      // A failed load leaves the empty state; the retry button re-runs this.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── After the external browser returns, the webhook may still be in flight, so
  //    poll a handful of times before giving up. Either path just informs the user;
  //    the server is the source of truth. ──────────────────────────────────────
  async function verifyActivation() {
    setVerifying(true);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const sub = await billingApi.mySubscription();
        if (!mounted.current) return;
        if (sub.isActive) {
          setSubscription(sub);
          setVerifying(false);
          Alert.alert("Welcome to Pro 🎉", "Your subscription is now active.");
          return;
        }
      } catch {
        // transient — keep polling
      }
      await delay(2000);
      if (!mounted.current) return;
    }
    if (!mounted.current) return;
    setVerifying(false);
    Alert.alert(
      "Payment processing",
      "If you completed payment, Pro will unlock in a moment. Reopen this screen to check.",
    );
  }

  async function handleUpgrade() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const session = await billingApi.checkout(selectedId);
      // Spotify-style: the provider's hosted page opens outside the app. openAuthSessionAsync
      // ties the browser to RETURN_URL so it auto-closes when the provider redirects back.
      await WebBrowser.openAuthSessionAsync(session.checkoutUrl, RETURN_URL);
      if (!mounted.current) return;
      setBusy(false);
      // The result type (success/cancel/dismiss) isn't trusted — the user may have paid and
      // simply closed the tab — so verify against the server regardless.
      await verifyActivation();
    } catch (e) {
      if (!mounted.current) return;
      setBusy(false);
      Alert.alert("Checkout failed", toApiError(e).message);
    }
  }

  const monthly = plans.find((p) => p.interval === "monthly");
  const yearly = plans.find((p) => p.interval === "yearly");
  const saving = savingsPercent(monthly, yearly);
  const selected = plans.find((p) => p.id === selectedId);
  const isActive = subscription?.isActive ?? false;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Screen scroll contentStyle={styles.screen}>
      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <View style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </TouchableOpacity>

        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>Membership</Text>
          <Text style={styles.titleMain}>NoteFusion Pro</Text>
        </View>
      </View>

      {/* ── Hero badge ─────────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <LinearGradient
          colors={gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroBadge}
        >
          {isActive ? (
            <Ionicons name="checkmark-circle" size={32} color={colors.onAccent} />
          ) : (
            <BrandMark size={34} color="#FFFFFF" waveColor="rgba(255,255,255,0.7)" />
          )}
        </LinearGradient>
        <Text style={styles.heroTitle}>
          {isActive ? "You're on Pro" : "Unlock everything"}
        </Text>
        <Text style={styles.heroSub}>
          {isActive
            ? "Thanks for supporting NoteFusion."
            : "Go further with unlimited transcriptions and full exports."}
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : isActive ? (
        <ActiveState subscription={subscription!} />
      ) : plans.length === 0 ? (
        <EmptyState
          onRetry={() => {
            setLoading(true);
            load();
          }}
        />
      ) : (
        <>
          {/* ── Feature list ─────────────────────────────────────────────── */}
          <Card style={styles.card}>
            {PRO_FEATURES.map((f, i) => (
              <View
                key={f.text}
                style={[styles.featureRow, i === 0 && styles.featureRowFirst]}
              >
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon} size={15} color={colors.accent} />
                </View>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </Card>

          {/* ── Plan selector ────────────────────────────────────────────── */}
          <View style={styles.sectionHeader}>
            <Ionicons name="pricetags-outline" size={14} color={colors.purple} />
            <Text style={styles.sectionTitle}>Choose a plan</Text>
          </View>

          {plans
            .slice()
            .sort((a, b) => a.amountMinor - b.amountMinor)
            .map((plan) => (
              <PlanOption
                key={plan.id}
                plan={plan}
                selected={plan.id === selectedId}
                badge={
                  plan.interval === "yearly" && saving
                    ? `Save ${saving}%`
                    : undefined
                }
                onSelect={() => setSelectedId(plan.id)}
              />
            ))}

          {/* ── CTA ──────────────────────────────────────────────────────── */}
          <Button
            label={
              verifying
                ? "Confirming…"
                : selected
                  ? `Upgrade — ${formatPrice(selected.amountMinor, selected.currency)}/${selected.interval === "yearly" ? "yr" : "mo"}`
                  : "Upgrade"
            }
            icon="lock-open-outline"
            onPress={handleUpgrade}
            loading={busy || verifying}
            disabled={!selectedId}
            style={styles.cta}
          />

          <Text style={styles.finePrint}>
            Secure checkout opens in your browser. You'll return here automatically.
          </Text>
        </>
      )}
    </Screen>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Status card shown when the caller already has an active subscription. */
function ActiveState({ subscription }: { subscription: Subscription }) {
  const styles = useThemedStyles(makeStyles);
  const renews = subscription.currentPeriodEndUtc
    ? new Date(subscription.currentPeriodEndUtc).toLocaleDateString("en", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const canceled = subscription.status === "canceled";

  return (
    <Card style={styles.card}>
      <View style={styles.activeRow}>
        <Text style={styles.activeLabel}>Status</Text>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {canceled ? "Cancels at period end" : "Active"}
          </Text>
        </View>
      </View>
      {renews && (
        <View style={styles.activeRow}>
          <Text style={styles.activeLabel}>
            {canceled ? "Access until" : "Renews"}
          </Text>
          <Text style={styles.activeValue}>{renews}</Text>
        </View>
      )}
      <Text style={styles.manageHint}>
        Manage or cancel your plan from the receipt email sent by our payment
        provider.
      </Text>
    </Card>
  );
}

/** A selectable plan row with a radio, price, and optional savings badge. */
function PlanOption({
  plan,
  selected,
  badge,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  badge?: string;
  onSelect: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const period = plan.interval === "yearly" ? "year" : "month";

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onSelect}
      style={[styles.planOption, selected && styles.planOptionSelected]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View
        style={[styles.radio, selected && styles.radioSelected]}
      >
        {selected && <View style={styles.radioDot} />}
      </View>

      <View style={styles.planInfo}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planName}>{plan.name}</Text>
          {badge && (
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={styles.planPrice}>
          {formatPrice(plan.amountMinor, plan.currency)}
          <Text style={styles.planPeriod}> / {period}</Text>
        </Text>
      </View>

      {selected && (
        <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
      )}
    </TouchableOpacity>
  );
}

/** Shown when plans can't be loaded (offline, or billing not configured server-side). */
function EmptyState({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={styles.card}>
      <View style={styles.emptyBlock}>
        <Ionicons name="cloud-offline-outline" size={28} color={colors.textFaint} />
        <Text style={styles.emptyText}>Plans couldn't be loaded right now.</Text>
        <Button label="Try again" variant="secondary" onPress={onRetry} />
      </View>
    </Card>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    screen: {
      paddingBottom: spacing.xxxl,
    },

    // ── Header ──────────────────────────────────────────────────────────────
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: spacing.sm,
      marginBottom: spacing.xl,
    },
    backCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    titleBlock: {
      flex: 1,
      marginHorizontal: spacing.md,
    },
    titleLabel: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontSize: 10,
    },
    titleMain: {
      ...typography.title,
      color: c.text,
      fontSize: 22,
      letterSpacing: -0.4,
      marginTop: 1,
    },

    // ── Hero ────────────────────────────────────────────────────────────────
    hero: {
      alignItems: "center",
      marginBottom: spacing.xl,
    },
    heroBadge: {
      width: 64,
      height: 64,
      borderRadius: radii.lg,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.lg,
      ...s.glow,
    },
    heroTitle: {
      ...typography.title,
      color: c.text,
      fontSize: 24,
      letterSpacing: -0.4,
      textAlign: "center",
      marginBottom: spacing.xs,
    },
    heroSub: {
      ...typography.body,
      color: c.textMuted,
      textAlign: "center",
      fontSize: 14,
      lineHeight: 20,
      paddingHorizontal: spacing.md,
    },

    // ── Shared card ─────────────────────────────────────────────────────────
    card: {
      marginBottom: spacing.xl,
    },

    loadingBlock: {
      paddingVertical: spacing.xxxl,
      alignItems: "center",
    },

    // ── Feature list ────────────────────────────────────────────────────────
    featureRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingTop: spacing.md,
    },
    featureRowFirst: {
      paddingTop: 0,
    },
    featureIcon: {
      width: 30,
      height: 30,
      borderRadius: radii.sm,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    featureText: {
      ...typography.body,
      color: c.text,
      fontSize: 15,
      flex: 1,
    },

    // ── Section header ──────────────────────────────────────────────────────
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      ...typography.label,
      color: c.textMuted,
      fontSize: 12,
      fontFamily: fonts.bold,
      textTransform: "uppercase",
      letterSpacing: 1,
    },

    // ── Plan option ─────────────────────────────────────────────────────────
    planOption: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: c.surface,
      borderWidth: 1.5,
      borderColor: c.border,
      borderRadius: radii.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
    },
    planOptionSelected: {
      borderColor: c.accent,
      backgroundColor: c.accentSoft,
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: c.textFaint,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    radioSelected: {
      borderColor: c.accent,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.accent,
    },
    planInfo: {
      flex: 1,
    },
    planTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: 2,
    },
    planName: {
      ...typography.label,
      color: c.text,
      fontSize: 15,
    },
    saveBadge: {
      backgroundColor: c.success,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
    },
    saveBadgeText: {
      ...typography.caption,
      color: c.onAccent,
      fontSize: 10,
      fontFamily: fonts.bold,
    },
    planPrice: {
      ...typography.heading,
      color: c.text,
      fontSize: 18,
    },
    planPeriod: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 13,
    },

    // ── CTA ─────────────────────────────────────────────────────────────────
    cta: {
      marginTop: spacing.sm,
    },
    finePrint: {
      ...typography.caption,
      color: c.textFaint,
      textAlign: "center",
      fontSize: 11,
      lineHeight: 16,
      marginTop: spacing.md,
      paddingHorizontal: spacing.lg,
    },

    // ── Active state ────────────────────────────────────────────────────────
    activeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.sm,
    },
    activeLabel: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 14,
    },
    activeValue: {
      ...typography.label,
      color: c.text,
      fontSize: 14,
    },
    statusPill: {
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentGlow,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
    },
    statusPillText: {
      ...typography.caption,
      color: c.accent,
      fontSize: 12,
      fontFamily: fonts.bold,
    },
    manageHint: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 12,
      lineHeight: 18,
      marginTop: spacing.md,
    },

    // ── Empty state ─────────────────────────────────────────────────────────
    emptyBlock: {
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.lg,
    },
    emptyText: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 14,
      textAlign: "center",
    },
  });
