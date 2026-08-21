import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { showDialog } from "../lib/dialog";
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
import { useSubscription } from "../lib/subscription";
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

/**
 * "$4.99", "₦7,500", or "SEK 49.00" for a currency we know no symbol for. Two tiers are on sale in
 * two currencies now, so this can no longer assume dollars: naira figures are five digits and need
 * grouping to be readable, and a round one carries no kobo worth printing.
 *
 * Grouped by hand rather than with `toLocaleString`, which takes its options argument only where
 * Hermes was built with full Intl — on Android it is quietly ignored and the separators never appear.
 */
function formatPrice(amountMinor: number, currency: string): string {
  const whole = Math.trunc(amountMinor / 100);
  const minor = Math.abs(amountMinor % 100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // Cents are conventional in dollar prices even at .00; kobo on a whole naira figure are noise.
  const major =
    minor === 0 && currency !== "USD" ? grouped : `${grouped}.${String(minor).padStart(2, "0")}`;

  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : null;
  return symbol ? `${symbol}${major}` : `${currency} ${major}`;
}

/**
 * The price as the CTA says it. A lifetime plan is bought, not rented — billing it "/mo" would
 * both misdescribe the purchase and understate what it costs, which is the one mistake on this
 * screen a buyer would be right to complain about afterwards.
 */
function ctaPrice(plan: Plan): string {
  const price = formatPrice(plan.amountMinor, plan.currency);
  return plan.interval === "lifetime"
    ? `${price} once`
    : `${price}/${plan.interval === "yearly" ? "yr" : "mo"}`;
}

/** Percentage a yearly plan saves over paying monthly for a year, or null. */
function savingsPercent(monthly?: Plan, yearly?: Plan): number | null {
  if (!monthly || !yearly) return null;
  // Dividing one currency by another gives a number with no meaning. The list can hold both when the
  // server does not know where the account is and offers every tier.
  if (monthly.currency !== yearly.currency) return null;
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
 * external browser, and — once the browser closes — calls confirm, which has the server
 * verify with the provider there and then instead of waiting for the webhook.
 *
 * If the caller is already Pro, the paywall is replaced by a status card.
 */
export function UpgradeScreen({ navigation }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const { refresh: refreshSubscription } = useSubscription();

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

  // ── After the external browser returns, ask the server to verify with the provider
  //    straight away rather than waiting to be told by webhook — that wait was the
  //    several minutes between paying and Pro appearing. A couple of retries cover the
  //    provider not having finalised the charge in the same instant the browser closed. ──
  async function verifyActivation() {
    setVerifying(true);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        // confirm() reconciles and reports in one round trip; mySubscription() would only
        // report, so it can never do better than "whenever the webhook lands".
        const sub = await billingApi.confirm();
        if (!mounted.current) return;
        if (sub.isActive) {
          setSubscription(sub);
          setVerifying(false);
          // Tell the shared provider too, so the Subscription tab and the gold
          // avatar ring update without waiting for a relaunch.
          refreshSubscription().catch(() => undefined);
          // The gold treatment carries the celebration now, so the 🎉 the OS
          // dialog needed to feel like anything is gone.
          showDialog({
            title: "Welcome to Pro",
            message: "Your subscription is now active. Transcribe as much as you like.",
            icon: "sparkles",
            tone: "premium",
          });
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
    showDialog({
      title: "Payment processing",
      message:
        "If you completed payment, Pro will unlock in a moment. Reopen this screen to check.",
      icon: "time-outline",
    });
  }

  async function handleUpgrade() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const session = await billingApi.checkout(selectedId);
      if (!session || !session.checkoutUrl) {
        showDialog({
          title: "Checkout error",
          message: "Could not initialize checkout. Please try again.",
          icon: "alert-circle-outline",
          tone: "danger",
        });
        return;
      }

      // Open Paystack hosted checkout in the in-app browser sheet. Every outcome —
      // returned via the deep link, dismissed, or the sheet failing to open — falls
      // through to verifyActivation, because none of them is evidence either way and
      // only the server knows whether money moved.
      //
      // In particular a dismissal must NOT reopen checkout: paying and then swiping the
      // sheet away is ordinary behaviour, and showing that person Paystack a second time
      // reads as "your payment didn't work" at the exact moment it did.
      try {
        await WebBrowser.openAuthSessionAsync(session.checkoutUrl, RETURN_URL);
      } catch {
        await WebBrowser.openBrowserAsync(session.checkoutUrl);
      }

      if (!mounted.current) return;
      setBusy(false);
      await verifyActivation();
    } catch (e) {
      if (!mounted.current) return;
      setBusy(false);
      showDialog({
        title: "Checkout failed",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
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
        <ActiveState
          subscription={subscription!}
          onChanged={() => {
            load();
            // The shared provider drives the tab label and the gold ring, so it has to
            // hear about a cancellation too — not just this screen's local copy.
            refreshSubscription().catch(() => undefined);
          }}
        />
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
                  ? `Upgrade — ${ctaPrice(selected)}`
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

/**
 * Status and management card for a caller who already has an active subscription. This is what the
 * Premium tab lands on, so it has to be more than a receipt: the renewal date, and the way out.
 */
function ActiveState({
  subscription,
  onChanged,
}: {
  subscription: Subscription;
  onChanged: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [canceling, setCanceling] = useState(false);
  const renews = subscription.currentPeriodEndUtc
    ? new Date(subscription.currentPeriodEndUtc).toLocaleDateString("en", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const canceled = subscription.status === "canceled";
  const lifetime = subscription.isLifetime;

  async function cancel() {
    setCanceling(true);
    try {
      await billingApi.cancel();
      // Re-read rather than patch the local copy: the server decides how long access runs,
      // and this screen's whole job is to report that date accurately.
      onChanged();
      showDialog({
        title: "Subscription cancelled",
        message: renews
          ? `Pro stays active until ${renews}. It won't renew after that, and you can resubscribe any time.`
          : "Pro stays active until the end of your paid period.",
        icon: "checkmark-circle-outline",
      });
    } catch (e) {
      showDialog({
        title: "Could not cancel",
        message: toApiError(e).message,
        icon: "alert-circle-outline",
        tone: "danger",
      });
    } finally {
      setCanceling(false);
    }
  }

  function confirmCancel() {
    showDialog({
      title: "Cancel subscription?",
      message: renews
        ? `You'll keep Pro until ${renews} — nothing is withdrawn today and nothing is refunded. ` +
          `After that date your account returns to the free plan. Everything in your library stays.`
        : "You'll keep Pro until the end of your paid period, then return to the free plan.",
      icon: "warning-outline",
      tone: "danger",
      actions: [
        { label: "Cancel subscription", style: "destructive", onPress: cancel },
        { label: "Keep Pro", style: "cancel" },
      ],
    });
  }

  return (
    <Card style={styles.card}>
      <View style={styles.activeRow}>
        <Text style={styles.activeLabel}>Current Plan</Text>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {lifetime ? "NoteFusion Pro — Lifetime ✨" : "NoteFusion Pro ✨"}
          </Text>
        </View>
      </View>
      <View style={styles.activeRow}>
        <Text style={styles.activeLabel}>Subscription Status</Text>
        <Text style={styles.activeValue}>
          {lifetime ? "Yours for good" : canceled ? "Cancels at period end" : "Active & Paid"}
        </Text>
      </View>
      {/* Suppressed for lifetime: the period end is a year-9999 sentinel, and printing it at the
          customer who paid the most reads as a bug. */}
      {renews && !lifetime && (
        <View style={styles.activeRow}>
          <Text style={styles.activeLabel}>
            {canceled ? "Access until" : "Renews on"}
          </Text>
          <Text style={styles.activeValue}>{renews}</Text>
        </View>
      )}

      <View style={styles.featureBlock}>
        <Text style={styles.featureBlockTitle}>Included with Pro</Text>
        {PRO_FEATURES.map((f) => (
          <View key={f.text} style={styles.includedRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.premium} />
            <Text style={styles.includedText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* ── Manage ──────────────────────────────────────────────────────────────
          Only offered while there is something to cancel. A lifetime plan has no period
          to end, and an already-cancelled one would just be a button that does nothing. */}
      {!lifetime && !canceled && (
        <Button
          label="Cancel subscription"
          variant="secondary"
          icon="close-circle-outline"
          onPress={confirmCancel}
          loading={canceling}
          style={styles.cancelBtn}
        />
      )}

      <Text style={styles.manageHint}>
        {lifetime
          ? "Lifetime access — there is nothing to renew or cancel. Receipts are in your email inbox."
          : canceled
            ? "Cancelled. You keep Pro until the date above, then the account returns to the free plan — resubscribe any time."
            : "Cancelling keeps Pro until the end of the period you've paid for. Receipts are in your email inbox."}
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
  // A noun for the lifetime tier, not a rate: "/ month" would be wrong and "/ lifetime" still reads
  // like one. The slash is part of the string so it can be dropped along with the period.
  const period =
    plan.interval === "lifetime"
      ? "one-time"
      : plan.interval === "yearly"
        ? "/ year"
        : "/ month";

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
          <Text style={styles.planPeriod}> {period}</Text>
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

    // What Pro includes, restated for someone who already owns it — the same list as the
    // paywall but in gold, since here it is a receipt rather than a pitch.
    featureBlock: {
      marginTop: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderColor: c.border,
    },
    featureBlockTitle: {
      ...typography.label,
      color: c.text,
      fontSize: 13,
      textTransform: "uppercase",
      letterSpacing: 1,
      marginBottom: spacing.sm,
    },
    includedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: 8,
    },
    includedText: {
      ...typography.body,
      color: c.text,
      fontSize: 13,
    },
    // Centred rather than full-width: leaving is allowed, but it is not the action this
    // screen is for, and a full-bleed button reads like the primary one.
    cancelBtn: {
      alignSelf: "center",
      marginTop: spacing.lg,
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
