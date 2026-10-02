import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Touchable } from "../components/Touchable";
import { Avatar } from "../components/Avatar";
import { PlanCardSkeleton } from "../components/Skeleton";
import { BrandMark } from "../components/BrandMark";
import { billingApi, meApi } from "../api/endpoints";
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
import { useAuth } from "../lib/auth";
import { useSubscription } from "../lib/subscription";
import type { AuthUser, MyProfile, Plan, Subscription } from "../api/types";
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
  { icon: "musical-notes", text: "Whole songs, up to six minutes, twenty a month" },
  { icon: "people", text: "Alto, tenor and bass written under any tune, when you ask" },
  { icon: "download", text: "PDF, MusicXML and MIDI downloads, no watermark" },
  { icon: "flash", text: "Priority lane and sing-along marking" },
];

/** Key features displayed in the active Pro subscription hub. */
const PRO_BENEFITS: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
}[] = [
  {
    icon: "musical-notes",
    title: "Whole Songs",
    desc: "Songs from a link or a recording, up to six minutes each, twenty a month. Hummed tunes are never counted.",
  },
  {
    icon: "people",
    title: "Four-Part Harmony",
    desc: "Alto, tenor and bass written under any tune the way a hymn arranger would — only when you ask.",
  },
  {
    icon: "download",
    title: "Every Download",
    desc: "Clean PDF, MusicXML and MIDI with no watermark, ready for your choir.",
  },
  {
    icon: "flash",
    title: "Priority Lane & Sing-Along",
    desc: "Never queued behind anyone, and sing a take to have every note marked.",
  },
];

/** "Monthly" or "Yearly" from the plan's name or code, for the member card. */
function tierOf(subscription: Subscription): string {
  const label = `${subscription.planName ?? ""} ${subscription.planCode ?? ""}`.toLowerCase();
  if (label.includes("year")) return "Yearly";
  if (label.includes("month")) return "Monthly";
  return "Pro";
}

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
  const { user } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // opening checkout
  const [verifying, setVerifying] = useState(false); // polling after return
  const [refreshing, setRefreshing] = useState(false); // pull-to-refresh

  // Guards against setState after the screen unmounts mid-poll.
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [planList, sub, prof] = await Promise.all([
        billingApi.plans(),
        billingApi.mySubscription(),
        meApi.get().catch(() => null),
      ]);
      if (!mounted.current) return;
      setPlans(planList);
      setSubscription(sub);
      if (prof) setProfile(prof);
      // Default to the best-value (highest) plan so the recommended choice is preselected.
      const best = [...planList].sort((a, b) => b.amountMinor - a.amountMinor)[0];
      setSelectedId((cur) => cur ?? best?.id ?? null);
    } catch {
      // A failed load leaves the empty state; the retry button re-runs this.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Reconcile and confirm any in-flight checkout with the provider, and refresh plans/profile
      const [sub] = await Promise.all([
        billingApi.confirm().catch(() => billingApi.mySubscription()),
        billingApi.plans().then((planList) => setPlans(planList)).catch(() => undefined),
        meApi.get().then((p) => setProfile(p)).catch(() => null),
      ]);
      if (!mounted.current) return;
      if (sub) {
        setSubscription(sub);
        if (sub.isActive) {
          refreshSubscription(true).catch(() => undefined);
        }
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [refreshSubscription]);

  useEffect(() => {
    load();
  }, [load]);

  // ── After the external browser returns, ask the server to verify with the provider
  //    straight away rather than waiting to be told by webhook. Extended to 10 attempts
  //    (20 seconds total) to comfortably absorb payment gateway settlement latency. ──
  async function verifyActivation() {
    setVerifying(true);
    for (let attempt = 0; attempt < 10; attempt++) {
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
          refreshSubscription(true).catch(() => undefined);
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
        "If you completed payment, Pro will unlock in a moment. Drag down to refresh or reopen this screen to check.",
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
    <Screen
      scroll
      contentStyle={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <Touchable
          onPress={() =>
            navigation.canGoBack()
              ? navigation.goBack()
              : navigation.navigate("Tabs", { screen: "Home" })
          }
          accessibilityLabel="Go back"
          hitSlop={8}
          ripple="borderless"
        >
          <View style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </View>
        </Touchable>

        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>
            {isActive ? "Account" : "Membership"}
          </Text>
          <Text style={styles.titleMain}>
            {isActive ? "Subscription" : "NoteFusion Pro"}
          </Text>
        </View>

        {isActive && (
          <View style={styles.activePill}>
            <View style={styles.activeDot} />
            <Text style={styles.activePillText}>Pro Active</Text>
          </View>
        )}
      </View>

      {/* ── Hero badge (only on paywall when not active) ─────────────────── */}
      {!isActive && !loading && (
        <View style={styles.hero}>
          <LinearGradient
            colors={gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroBadge}
          >
            <BrandMark size={34} color="#FFFFFF" waveColor="rgba(255,255,255,0.7)" />
          </LinearGradient>
          <Text style={styles.heroTitle}>Unlock everything</Text>
          <Text style={styles.heroSub}>
            Go further with unlimited transcriptions and full exports.
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBlock}>
          <PlanCardSkeleton />
          <PlanCardSkeleton />
        </View>
      ) : isActive ? (
        <ActiveState
          subscription={subscription!}
          profile={profile}
          user={user}
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
 * Clean, focused member hub for a user with active Pro status.
 * Displays their current plan details, included privileges, and billing management.
 */
function ActiveState({
  subscription,
  profile,
  user,
  onChanged,
}: {
  subscription: Subscription;
  profile: MyProfile | null;
  user: AuthUser | null;
  onChanged: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [canceling, setCanceling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);

  const renews = subscription.currentPeriodEndUtc
    ? new Date(subscription.currentPeriodEndUtc).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const canceled = subscription.status === "canceled";
  const lifetime = subscription.isLifetime;
  const isGift = subscription.isGift ?? false;

  const displayName = user?.fullName || profile?.fullName || "NoteFusion Member";
  const displayEmail = user?.email || profile?.email || "";

  async function cancel() {
    setCanceling(true);
    setShowCancelModal(false);
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

  /** Opens the reason-survey modal — the actual cancel() only fires after
   *  the user picks a reason and confirms. */
  function openCancelFlow() {
    setCancelReason(null);
    setShowCancelModal(true);
  }


  return (
    <View style={styles.hubContainer}>
      {/* ── 1. Membership Status Card ─────────────────────────────────── */}
      <Card style={styles.memberCard}>
        <View style={styles.memberHeader}>
          <Avatar
            uri={profile?.profilePictureUrl}
            name={displayName}
            size={56}
            premium={true}
          />
          <View style={styles.memberInfo}>
            <Text style={styles.memberName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.memberEmail} numberOfLines={1}>
              {displayEmail}
            </Text>
            <View style={styles.memberBadge}>
              <Ionicons
                name={lifetime ? "diamond-outline" : isGift ? "gift-outline" : "sparkles"}
                size={12}
                color={colors.premiumDeep}
              />
              <Text style={styles.memberBadgeText}>
                {lifetime
                  ? "Lifetime Member"
                  : isGift
                    ? "Complimentary Access"
                    : "Pro Subscriber"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.memberDivider} />

        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>STATUS</Text>
            <View style={styles.statStatusRow}>
              <View
                style={[
                  styles.statDot,
                  { backgroundColor: canceled ? colors.warning : colors.success },
                ]}
              />
              <Text style={styles.statValue}>
                {canceled ? "Ending Soon" : "Active"}
              </Text>
            </View>
          </View>

          <View style={styles.statCol}>
            <Text style={styles.statLabel}>TIER</Text>
            <Text style={styles.statValue}>
              {lifetime ? "Lifetime" : isGift ? "Gift" : tierOf(subscription)}
            </Text>
          </View>

          <View style={[styles.statCol, { alignItems: "flex-end" }]}>
            <Text style={styles.statLabel}>
              {lifetime ? "VALIDITY" : canceled ? "EXPIRES" : "RENEWS"}
            </Text>
            <Text style={styles.statValue}>
              {lifetime ? "Perpetual" : renews ? renews : "Active"}
            </Text>
          </View>
        </View>
      </Card>

      {/* ── 2. Notice Callout (if canceled) ───────────────────────────── */}
      {canceled && renews && (
        <View style={styles.noticeWarning}>
          <Ionicons name="time-outline" size={18} color={colors.warning} />
          <Text style={styles.noticeWarningText}>
            Your subscription has been canceled and will end on {renews}. Pro features remain active until then, and all your saved music scores will stay safe in your library.
          </Text>
        </View>
      )}

      {/* ── 3. Included Pro Privileges ────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="sparkles-outline" size={14} color={colors.accent} />
        <Text style={styles.sectionTitle}>Included With Pro</Text>
      </View>

      <Card style={styles.benefitsCard}>
        {PRO_BENEFITS.map((item, index) => (
          <View
            key={item.title}
            style={[styles.benefitRow, index > 0 && styles.benefitRowBorder]}
          >
            <View style={styles.benefitIconCircle}>
              <Ionicons name={item.icon} size={18} color={colors.accent} />
            </View>
            <View style={styles.benefitContent}>
              <Text style={styles.benefitTitle}>{item.title}</Text>
              <Text style={styles.benefitDesc}>{item.desc}</Text>
            </View>
            <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
          </View>
        ))}
      </Card>

      {/* ── 4. Plan & Billing Details ─────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Ionicons name="card-outline" size={14} color={colors.textMuted} />
        <Text style={styles.sectionTitle}>Billing Details</Text>
      </View>

      <Card style={styles.billingCard}>
        <View style={styles.billingRow}>
          <Text style={styles.billingLabel}>Plan</Text>
          <Text style={styles.billingValue}>
            {lifetime
              ? "NoteFusion Pro — Lifetime"
              : isGift
                ? "NoteFusion Pro — Gift"
                : subscription.planName || "NoteFusion Pro"}
          </Text>
        </View>

        {typeof subscription.songCreditsTotal === "number" && (
          <View style={styles.billingRow}>
            <Text style={styles.billingLabel}>Songs this month</Text>
            <Text style={styles.billingValue}>
              {subscription.songCreditsRemaining ?? subscription.songCreditsTotal} of {subscription.songCreditsTotal} left
            </Text>
          </View>
        )}

        <View style={styles.billingRow}>
          <Text style={styles.billingLabel}>Status</Text>
          <Text style={styles.billingValue}>
            {lifetime
              ? "Paid in full"
              : isGift
                ? "Complimentary"
                : canceled
                  ? "Cancels at period end"
                  : "Active & Paid"}
          </Text>
        </View>

        {renews && !lifetime && (
          <View style={styles.billingRow}>
            <Text style={styles.billingLabel}>
              {canceled ? "Access until" : "Next renewal"}
            </Text>
            <Text style={styles.billingValue}>{renews}</Text>
          </View>
        )}

        {!lifetime && !isGift && !canceled && (
          <Button
            label="Cancel subscription"
            variant="secondary"
            icon="close-circle-outline"
            onPress={openCancelFlow}
            loading={canceling}
            style={styles.cancelBtn}
          />
        )}

        <Text style={styles.billingHint}>
          {lifetime
            ? "Lifetime access — there is nothing to renew or cancel. Invoices and receipts were sent to your email."
            : isGift
              ? "Complimentary access granted by the NoteFusion team. No payment method is linked or billed."
              : canceled
                ? `Subscription canceled. Pro privileges remain active until ${renews}. You can resubscribe any time.`
                : "Cancelling keeps Pro until the end of the period you've paid for. Receipts are in your email inbox."}
        </Text>
      </Card>

      {/* ── Cancel Reason Survey Modal ───────────────────────────────── */}
      <CancelReasonModal
        visible={showCancelModal}
        renews={renews}
        selectedReason={cancelReason}
        onSelectReason={setCancelReason}
        onConfirm={cancel}
        onDismiss={() => setShowCancelModal(false)}
        canceling={canceling}
      />
    </View>
  );
}

const CANCEL_REASONS = [
  "Too expensive",
  "Not using it enough",
  "Missing features I need",
  "Found a better alternative",
  "Other",
] as const;

/**
 * Slide-up survey modal shown before the subscription is actually cancelled.
 * The user picks one of five pre-set reasons, then confirms. The reason is
 * held client-side (available for future analytics or a server endpoint).
 */
function CancelReasonModal({
  visible,
  renews,
  selectedReason,
  onSelectReason,
  onConfirm,
  onDismiss,
  canceling,
}: {
  visible: boolean;
  renews: string | null;
  selectedReason: string | null;
  onSelectReason: (r: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  canceling: boolean;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <Pressable style={styles.cancelModalBackdrop} onPress={onDismiss} />
      <View style={styles.cancelModalSheet}>
        {/* Header */}
        <View style={styles.cancelModalHandle} />
        <View style={styles.cancelModalHeader}>
          <Ionicons name="heart-dislike-outline" size={28} color={colors.danger} />
          <Text style={styles.cancelModalTitle}>Before you go…</Text>
          <Text style={styles.cancelModalSub}>
            Help us improve — why are you cancelling?
          </Text>
        </View>

        {/* Reason list */}
        {CANCEL_REASONS.map((reason) => {
          const active = selectedReason === reason;
          return (
            <Touchable
              key={reason}
              style={[styles.cancelReasonRow, active && styles.cancelReasonRowActive]}
              onPress={() => onSelectReason(reason)}
              scaleTo={0.98}
              ripple={false}
              accessibilityLabel={reason}
            >
              <View
                style={[
                  styles.cancelReasonRadio,
                  active && styles.cancelReasonRadioActive,
                ]}
              >
                {active && (
                  <View style={styles.cancelReasonRadioDot} />
                )}
              </View>
              <Text style={[styles.cancelReasonLabel, active && styles.cancelReasonLabelActive]}>
                {reason}
              </Text>
            </Touchable>
          );
        })}

        {/* Info strip */}
        {renews && (
          <View style={styles.cancelModalInfo}>
            <Ionicons name="time-outline" size={14} color={colors.textMuted} />
            <Text style={styles.cancelModalInfoText}>
              Pro stays active until {renews}. No refund, no charge today.
            </Text>
          </View>
        )}

        {/* Actions */}
        <Button
          label="Confirm cancellation"
          variant="danger"
          icon="close-circle-outline"
          onPress={onConfirm}
          loading={canceling}
          disabled={!selectedReason}
          style={styles.cancelConfirmBtn}
        />
        <Button
          label="Keep Pro"
          variant="secondary"
          onPress={onDismiss}
          style={styles.cancelKeepBtn}
        />
      </View>
    </Modal>
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
    <Touchable
      onPress={onSelect}
      style={[styles.planOption, selected && styles.planOptionSelected]}
      // Flat surface fill and no shadow, so the ripple can be clipped to the card's
      // own corner radius rather than painting a square over it.
      radius={radii.lg}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${plan.name}, ${formatPrice(plan.amountMinor, plan.currency)} ${period}`}
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
    </Touchable>
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
      paddingVertical: spacing.md,
      gap: spacing.md,
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

    // ── Header active badge ─────────────────────────────────────────────────
    activePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentGlow,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.pill,
    },
    activeDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: c.success,
    },
    activePillText: {
      ...typography.caption,
      color: c.accent,
      fontSize: 11,
      fontFamily: fonts.bold,
      letterSpacing: 0.3,
    },

    // ── Active Pro Member Hub ───────────────────────────────────────────────
    hubContainer: {
      marginBottom: spacing.md,
    },
    memberCard: {
      marginBottom: spacing.xl,
    },
    memberHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
    },
    memberInfo: {
      flex: 1,
    },
    memberName: {
      ...typography.heading,
      fontSize: 18,
      color: c.text,
      marginBottom: 2,
    },
    memberEmail: {
      ...typography.caption,
      fontSize: 13,
      color: c.textMuted,
      marginBottom: spacing.sm,
    },
    memberBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      alignSelf: "flex-start",
      backgroundColor: c.premiumSoft,
      borderWidth: 1,
      borderColor: c.premiumBorder,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 3,
      borderRadius: radii.pill,
    },
    memberBadgeText: {
      ...typography.caption,
      fontSize: 11,
      fontFamily: fonts.bold,
      color: c.premiumDeep,
    },
    memberDivider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: spacing.md,
    },
    statsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    statCol: {
      flex: 1,
    },
    statLabel: {
      ...typography.caption,
      fontSize: 10,
      fontFamily: fonts.bold,
      color: c.textFaint,
      letterSpacing: 0.8,
      marginBottom: 2,
    },
    statStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    statDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    statValue: {
      ...typography.label,
      fontSize: 13,
      color: c.text,
    },

    // ── Notice callout ──────────────────────────────────────────────────────
    noticeWarning: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      backgroundColor: c.warning + "12",
      borderWidth: 1,
      borderColor: c.warning + "35",
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.xl,
    },
    noticeWarningText: {
      ...typography.body,
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: c.text,
    },

    // ── Included benefits ───────────────────────────────────────────────────
    benefitsCard: {
      marginBottom: spacing.xl,
      paddingHorizontal: 0,
      paddingVertical: spacing.xs,
    },
    benefitRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    benefitRowBorder: {
      borderTopWidth: 1,
      borderTopColor: c.borderLight,
    },
    benefitIconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: c.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginRight: spacing.md,
    },
    benefitContent: {
      flex: 1,
      paddingRight: spacing.sm,
    },
    benefitTitle: {
      ...typography.label,
      fontSize: 14,
      color: c.text,
      marginBottom: 2,
    },
    benefitDesc: {
      ...typography.caption,
      fontSize: 12,
      lineHeight: 17,
      color: c.textMuted,
    },

    // ── Billing details ─────────────────────────────────────────────────────
    billingCard: {
      marginBottom: spacing.xl,
    },
    billingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: spacing.sm,
    },
    billingLabel: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 14,
    },
    billingValue: {
      ...typography.label,
      color: c.text,
      fontSize: 14,
    },
    billingHint: {
      ...typography.caption,
      color: c.textFaint,
      fontSize: 12,
      lineHeight: 18,
      marginTop: spacing.md,
    },
    cancelBtn: {
      alignSelf: "center",
      marginTop: spacing.lg,
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

    // ── Cancel Reason Modal ──────────────────────────────────────────────────
    cancelModalBackdrop: {
      flex: 1,
      backgroundColor: c.scrim,
    },
    cancelModalSheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xxl + 8,
      paddingTop: spacing.sm,
    },
    cancelModalHandle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginBottom: spacing.lg,
    },
    cancelModalHeader: {
      alignItems: "center",
      gap: spacing.xs,
      marginBottom: spacing.xl,
    },
    cancelModalTitle: {
      fontSize: 20,
      fontFamily: fonts.bold,
      color: c.text,
    },
    cancelModalSub: {
      fontSize: 14,
      fontFamily: fonts.regular,
      color: c.textMuted,
      textAlign: "center",
    },
    cancelReasonRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      marginBottom: spacing.xs,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    cancelReasonRowActive: {
      borderColor: c.accent,
      backgroundColor: c.accentSoft,
    },
    cancelReasonRadio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },
    cancelReasonRadioActive: {
      borderColor: c.accent,
    },
    cancelReasonRadioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.accent,
    },
    cancelReasonLabel: {
      flex: 1,
      fontSize: 15,
      fontFamily: fonts.medium,
      color: c.text,
    },
    cancelReasonLabelActive: {
      color: c.accent,
      fontFamily: fonts.semibold,
    },
    cancelModalInfo: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      backgroundColor: c.surfaceAlt,
      borderRadius: radii.md,
      padding: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.lg,
    },
    cancelModalInfoText: {
      flex: 1,
      fontSize: 12,
      fontFamily: fonts.regular,
      color: c.textMuted,
      lineHeight: 18,
    },
    cancelConfirmBtn: {
      marginTop: spacing.xs,
    },
    cancelKeepBtn: {
      marginTop: spacing.sm,
    },
  });

