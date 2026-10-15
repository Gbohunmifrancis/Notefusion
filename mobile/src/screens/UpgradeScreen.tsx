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
import { PRO_FEATURES } from "../lib/proFeatures";
import type { AuthUser, MyProfile, Plan, Subscription } from "../api/types";
import type { RootStackParams } from "../navigation/types";
import { tierOf } from "../lib/planTier";

type Props = { navigation: any; route?: any };

/**
 * The deep link the provider redirects to when hosted checkout finishes. It has to
 * match BillingSettings.CheckoutCallbackUrl on the server and app.json's "scheme",
 * so openAuthSessionAsync can detect the return and close the external browser.
 */
const RETURN_URL = "notefusion://billing/return";

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
  return plan.interval === "lifetime" || plan.interval === "single"
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
 * external browser, and — once the browser closes — hands the wait to SubscriptionProvider,
 * which polls confirm (the server verifies with the provider there and then instead of
 * waiting for the webhook) and shows the one welcome pop-up when the payment lands.
 *
 * If the caller is already Pro, the paywall is replaced by a status card.
 */
export function UpgradeScreen({ navigation, route }: Props) {
  // Opened from a refusal for having nothing left: one more song is what was just asked for.
  const forLimit = route?.params?.reason === "limit";
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const {
    refresh: refreshSubscription,
    beginCheckout,
    watchPayment,
    abandonCheckout,
    paymentCheck,
    pendingCheckout,
    subscription: liveSubscription,
  } = useSubscription();
  const { user } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // opening checkout
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
      // Default to the best-value (highest) plan so the recommended choice is preselected — or, when
      // the free allowance has just run out, to the one-song purchase.
      const single = sub.isActive ? undefined : planList.find((p) => p.interval === "single");
      const best = [...planList]
        .filter((p) => p.interval !== "single")
        .sort((a, b) => b.amountMinor - a.amountMinor)[0];
      const preferred = forLimit && single ? single : best ?? single;
      setSelectedId((cur) => cur ?? preferred?.id ?? null);
    } catch {
      // A failed load leaves the empty state; the retry button re-runs this.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [forLimit]);

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

  async function handleUpgrade() {
    if (!selectedId) return;
    const single = plans.find((p) => p.id === selectedId)?.interval === "single";
    setBusy(true);
    try {
      const session = await billingApi.checkout(selectedId);
      if (!session || !session.checkoutUrl) {
        setBusy(false);
        showDialog({
          title: "Checkout error",
          message: "Could not initialize checkout. Please try again.",
          icon: "alert-circle-outline",
          tone: "danger",
        });
        return;
      }

      // Before the browser opens: what the provider compares the server's answer against, so a
      // member adding time is told apart from one whose checkout simply closed.
      beginCheckout(selectedId, subscription, single);

      // Open Paystack hosted checkout in the in-app browser sheet. Every outcome —
      // returned via the deep link, dismissed, or the sheet failing to open — falls
      // through to watching for the payment, because none of them is evidence either way
      // and only the server knows whether money moved.
      //
      // In particular a dismissal must NOT reopen checkout: paying and then swiping the
      // sheet away is ordinary behaviour, and showing that person Paystack a second time
      // reads as "your payment didn't work" at the exact moment it did.
      // Only the provider sending the browser back to the app says a payment was made; a sheet
      // closed by hand is still watched, quietly, so the plans stay usable for a second try.
      let returned = false;
      try {
        const outcome = await WebBrowser.openAuthSessionAsync(session.checkoutUrl, RETURN_URL);
        returned = outcome.type === "success";
      } catch {
        await WebBrowser.openBrowserAsync(session.checkoutUrl).catch((e) => {
          // Neither browser would open, so nothing can have been paid: no wait to leave behind.
          abandonCheckout();
          throw e;
        });
      }

      // The provider confirms from here, and owns the welcome when the payment lands, so it
      // carries on if this screen is left.
      watchPayment(!returned);
      if (!mounted.current) return;
      setBusy(false);
    } catch (e) {
      if (!mounted.current) return;
      setBusy(false);
      // An earlier checkout turned out to be paid: nothing to buy, so the welcome, not an error.
      if (toApiError(e).code === "BILLING_PAYMENT_ALREADY_RECEIVED" && selectedId) {
        // For one song the snapshot's count is lowered by one, so the purchase already made reads as landed.
        beginCheckout(
          selectedId,
          single && subscription
            ? { ...subscription, boughtTranscriptionsTotal: (subscription.boughtTranscriptionsTotal ?? 1) - 1 }
            : subscription,
          single,
        );
        watchPayment();
        return;
      }
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
  // A member who chose "Add more Pro time" sees the plans: each payment covers one period, and a
  // new one starts when the current time ends.
  const [extending, setExtending] = useState(false);
  const isActive = (subscription?.isActive ?? false) && !extending;
  // The one-song purchase, for a free account only (the server hides it from members too); listed
  // first, beside Pro, as the smallest thing to buy.
  const singlePlan =
    subscription?.isActive || extending ? undefined : plans.find((p) => p.interval === "single");
  const proPlans = plans.filter((p) => p.interval !== "single");
  const buyingSong = selected?.interval === "single";

  // The provider drops its checkout snapshot when the payment lands (it shows the welcome
  // itself): back to the member hub, re-read so it carries the new dates. One song bought goes
  // back to where the person was (the recorder, or the link still in its field) to use it.
  const hadPending = useRef<{ single: boolean; bought: number } | null>(null);
  useEffect(() => {
    if (pendingCheckout) {
      hadPending.current = {
        single: Boolean(pendingCheckout.single),
        bought: pendingCheckout.bought ?? 0,
      };
    } else if (hadPending.current) {
      const was = hadPending.current;
      hadPending.current = null;
      setExtending(false);
      if (was.single && (liveSubscription?.boughtTranscriptionsTotal ?? 0) > was.bought && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
      load();
    }
  }, [pendingCheckout, load, liveSubscription, navigation]);

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

      {/* ── Payment not confirmed after the quick checks: the provider keeps asking ── */}
      {!loading && paymentCheck === "delayed" && (
        <View style={styles.confirmNote}>
          <Ionicons name="time-outline" size={18} color={colors.accent} />
          <Text style={styles.confirmNoteText}>
            {pendingCheckout?.single
              ? "Your payment is still being confirmed. Your song unlocks automatically the moment it lands."
              : "Your payment is still being confirmed. Pro unlocks automatically the moment it lands."}
          </Text>
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBlock}>
          <PlanCardSkeleton />
          <PlanCardSkeleton />
        </View>
      ) : paymentCheck === "confirming" ? (
        // The provider is asking the server; there is nothing to press until it answers.
        <Card style={styles.card}>
          <View style={styles.confirmBlock}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.confirmTitle}>Confirming your payment…</Text>
            <Text style={styles.confirmText}>This usually takes a few seconds.</Text>
          </View>
        </Card>
      ) : isActive ? (
        <ActiveState
          subscription={subscription!}
          profile={profile}
          user={user}
          onExtend={() => setExtending(true)}
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

          {singlePlan ? (
            <PlanOption
              plan={singlePlan}
              title="Just this song"
              note="One more transcription, any recording or song link. No subscription."
              selected={singlePlan.id === selectedId}
              badge="No subscription"
              onSelect={() => setSelectedId(singlePlan.id)}
            />
          ) : null}

          {proPlans
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
              selected
                ? buyingSong
                  ? `Buy this song — ${formatPrice(selected.amountMinor, selected.currency)}`
                  : `Upgrade — ${ctaPrice(selected)}`
                : "Upgrade"
            }
            icon={buyingSong ? "musical-note-outline" : "lock-open-outline"}
            onPress={handleUpgrade}
            loading={busy}
            disabled={!selectedId}
            style={styles.cta}
          />

          <Text style={styles.finePrint}>
            {buyingSong
              ? "One payment, one transcription that never expires. Secure checkout opens in your browser; you'll come back to your song."
              : "Secure checkout opens in your browser. You'll return here automatically."}
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
  onExtend,
}: {
  subscription: Subscription;
  profile: MyProfile | null;
  user: AuthUser | null;
  onChanged: () => void;
  onExtend: () => void;
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
              {lifetime ? "VALIDITY" : "PRO UNTIL"}
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
              Pro until
            </Text>
            <Text style={styles.billingValue}>{renews}</Text>
          </View>
        )}

        {!lifetime && (
          <Button
            label="Add more Pro time"
            icon="add-circle-outline"
            onPress={onExtend}
            style={styles.cancelBtn}
          />
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
                : "Each payment covers one period and nothing renews without you. Added time starts when your current time ends. Receipts are in your email inbox."}
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
  title,
  note,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  badge?: string;
  /** Overrides the plan's own name, as "Just this song" does for the one-song purchase. */
  title?: string;
  /** A plain line under the price. */
  note?: string;
  onSelect: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  // A noun for the lifetime tier, not a rate: "/ month" would be wrong and "/ lifetime" still reads
  // like one. The slash is part of the string so it can be dropped along with the period.
  const period =
    plan.interval === "lifetime" || plan.interval === "single"
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
      accessibilityLabel={`${title ?? plan.name}, ${formatPrice(plan.amountMinor, plan.currency)} ${period}`}
    >
      <View
        style={[styles.radio, selected && styles.radioSelected]}
      >
        {selected && <View style={styles.radioDot} />}
      </View>

      <View style={styles.planInfo}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planName}>{title ?? plan.name}</Text>
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
        {note ? <Text style={styles.planNote}>{note}</Text> : null}
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
    planNote: {
      ...typography.caption,
      color: c.textMuted,
      marginTop: 2,
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

    // ── Confirming a payment ────────────────────────────────────────────────
    confirmBlock: {
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.lg,
    },
    confirmTitle: {
      ...typography.label,
      color: c.text,
      fontSize: 15,
    },
    confirmText: {
      ...typography.body,
      color: c.textMuted,
      fontSize: 13,
      textAlign: "center",
    },
    confirmNote: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentGlow,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.xl,
    },
    confirmNoteText: {
      ...typography.body,
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: c.text,
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

