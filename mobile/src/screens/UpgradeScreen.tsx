import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon, type IconName } from "../components/Icon";
import * as WebBrowser from "expo-web-browser";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "../components/Screen";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Sheet, SheetActions, SheetMessage, SheetTitle } from "../components/Sheet";
import { ChoiceRow } from "../components/SheetRows";
import { CheckoutExitSheet, type CheckoutExitAsk } from "../components/CheckoutExitSheet";
import { Group, Row } from "../components/settings/Rows";
import { Touchable } from "../components/Touchable";
import { Avatar } from "../components/Avatar";
import { PlanCardSkeleton } from "../components/Skeleton";
import { BrandMark } from "../components/BrandMark";
import { billingApi, meApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { showDialog } from "../lib/dialog";
import { showToast } from "../lib/toast";
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
import type { AuthUser, CheckoutExit, MyProfile, Plan, Subscription } from "../api/types";
import type { RootStackParams } from "../navigation/types";
import { tierOf } from "../lib/planTier";
import { siteUrls } from "../lib/env";
import {
  bestValuePlan,
  formatPrice,
  nairaNote,
  paidUntilLine,
  payLabel,
  periodLabel,
  plansInOrder,
  webFinePrint,
  yearNote,
} from "../lib/price";
import {
  parseAsked,
  rememberAsked,
  secondsOpen,
  shouldReportReturn,
  type PaymentCheckResult,
} from "../lib/checkoutExit";
import {
  isOnHold,
  manageUrl,
  offerFor,
  playButtonLabel,
  playFinePrint,
  playHint,
  playMemberState,
  playProblemNote,
  playStatusLine,
  sellsOnPlay,
  type PlayOffer,
} from "../lib/playBilling";
import {
  buyOnPlay,
  loadPlayOffers,
  playBillingReady,
  registerPlayPurchase,
  restorePlayPurchases,
  usesPlayBilling,
} from "../lib/playStore";

type Props = { navigation: any; route?: any };

/**
 * The deep link the provider redirects to when hosted checkout finishes. It has to
 * match BillingSettings.CheckoutCallbackUrl on the server and app.json's "scheme",
 * so openAuthSessionAsync can detect the return and close the external browser.
 */
const RETURN_URL = "notefusion://billing/return";

/** The checkouts this device has asked "What stopped you?" about (references, newest first). */
const ASKED_KEY = "nf.checkoutAsked";

/** Where a question about paying goes: the app's help address. */
const HELP_EMAIL = "hello@notefusion.studio";

/** The refund policy as the Terms put it (§8), said where the money is asked for. */
const REFUND_LINE =
  "Write to us and we answer within 14 days. We refund in full where the service failed: a transcription you paid for was never delivered, the service was unavailable for a sustained period, or you were charged twice. It goes back to the same card or account.";

/** Key features displayed in the active Pro subscription hub. */
const PRO_BENEFITS: {
  icon: IconName;
  title: string;
  desc: string;
}[] = [
  {
    icon: "song",
    title: "Whole Songs",
    desc: "Songs from a link or a recording, up to six minutes each, twenty a month. Hummed tunes are never counted.",
  },
  {
    icon: "parts",
    title: "Four-Part Harmony",
    desc: "Alto, tenor and bass written under any tune the way a hymn arranger would — only when you ask.",
  },
  {
    icon: "export",
    title: "Every Download",
    desc: "Clean PDF, MusicXML and MIDI with no watermark, ready for your choir.",
  },
  {
    icon: "quick",
    title: "Priority Lane & Sing-Along",
    desc: "Never queued behind anyone, and sing a take to have every note marked.",
  },
];

/** A plan as the list and the pay bar name it: the one-song purchase and the choir plans by what they are. */
function planTitle(plan: Plan): string {
  if (plan.interval === "single") return "Just this song";
  if (plan.choirSeats) return plan.interval === "yearly" ? "Choir · Yearly" : "Choir · Monthly";
  return plan.name;
}

/**
 * The Pro plans with the one-song purchase beside them. The server lists the purchase apart
 * (`plans/single`), so a build that labels everything in the main list as Pro never shows it.
 */
function withSingle(pro: Plan[], single: Plan[]): Plan[] {
  // An API from before the split still lists it in the main list.
  const songs = single.length > 0 ? single : pro;
  return [...pro.filter((p) => p.interval !== "single"), ...songs.filter((p) => p.interval === "single")];
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
  // A plan already chosen, by a row of the limit sheet that showed its price.
  const askedPlanId = route?.params?.planId;
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
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
  // The choir plans, listed apart (a director buys one for the whole choir); empty if the list fails.
  const [choirPlans, setChoirPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // On Android, what Google Play sells and at what price (board h-play): a plan without an offer is not shown there.
  const [playOffers, setPlayOffers] = useState<Map<string, PlayOffer>>(new Map());
  // Selling through Google Play (Android, the server ready, Play selling the products); else the website's checkout.
  const [play, setPlay] = useState(false);
  const [busy, setBusy] = useState(false); // opening checkout
  // The choir plans' own sheet, opened from the "For choir directors" row (board l-ux-high 03a).
  const [choirOpen, setChoirOpen] = useState(false);
  // "Questions? Help & refunds" (board m-ux-medium P4e), and what its row does once the sheet has gone.
  const [helpOpen, setHelpOpen] = useState(false);
  const afterHelp = useRef<(() => void) | null>(null);
  const closeHelp = (then?: () => void) => {
    afterHelp.current = then ?? null;
    setHelpOpen(false);
  };
  const [restoring, setRestoring] = useState(false);
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
      const [proList, sub, prof, choirList, singleList, ready] = await Promise.all([
        billingApi.plans(),
        billingApi.mySubscription(),
        meApi.get().catch(() => null),
        billingApi.choirPlans().catch(() => [] as Plan[]),
        // The one-song purchase is listed apart; a failure there leaves Pro on sale.
        billingApi.singlePlans().catch(() => [] as Plan[]),
        playBillingReady(),
      ]);
      // Google Play is asked only once the server can confirm what it sells.
      const offers = ready ? await loadPlayOffers().catch(() => new Map<string, PlayOffer>()) : new Map<string, PlayOffer>();
      if (!mounted.current) return;
      const viaPlay = sellsOnPlay(usesPlayBilling, ready, offers.size);
      setPlay(viaPlay);
      setPlayOffers(offers);
      // Through Google Play only what it sells is shown, at its price.
      const sold = (p: Plan) => !viaPlay || offerFor(p, offers) !== undefined;
      const planList = withSingle(proList, singleList).filter(sold);
      setPlans(planList);
      setChoirPlans(choirList.filter(sold));
      setSubscription(sub);
      if (prof) setProfile(prof);
      // Default to the best-value (highest) plan so the recommended choice is preselected — or, when
      // the free allowance has just run out, to the one-song purchase.
      const single = sub.isActive ? undefined : planList.find((p) => p.interval === "single");
      const best = bestValuePlan(planList);
      const asked = askedPlanId ? planList.find((p) => p.id === askedPlanId) : undefined;
      const preferred = asked ?? (forLimit && single ? single : best ?? single);
      setSelectedId((cur) => cur ?? preferred?.id ?? null);
    } catch {
      // A failed load leaves the empty state; the retry button re-runs this.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [forLimit, askedPlanId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Reconcile and confirm any in-flight checkout with the provider, and refresh plans/profile
      const [sub] = await Promise.all([
        billingApi.confirm().catch(() => billingApi.mySubscription()),
        Promise.all([billingApi.plans(), billingApi.singlePlans().catch(() => [] as Plan[])])
          // The same filter as the first load: through Google Play, only what it sells.
          .then(([proList, singleList]) =>
            setPlans(withSingle(proList, singleList).filter((p) => !play || offerFor(p, playOffers) !== undefined)),
          )
          .catch(() => undefined),
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
  }, [refreshSubscription, play, playOffers]);

  useEffect(() => {
    load();
  }, [load]);

  // ── "What stopped you?": asked once per checkout that comes back unpaid (board g-checkout) ──
  const [exitAsk, setExitAsk] = useState<CheckoutExitAsk | null>(null);
  /** The checkout asked about: what the answer is posted with, and the plan "Try again" reopens. */
  const exitFor = useRef<{ reference: string; secondsOpen: number; planId: string } | null>(null);
  /** Read when the quick check answers, which is after this render. */
  const paymentCheckRef = useRef(paymentCheck);
  paymentCheckRef.current = paymentCheck;
  const songPlanRef = useRef<Plan | undefined>(undefined);

  /**
   * The page was closed without the provider's return and the quick check found no payment: report the return
   * (with how long the page was open) and, if the API says this checkout is one to ask about, raise the sheet.
   */
  const askWhy = useCallback(
    async (found: PaymentCheckResult, reference: string, seconds: number, plan: Plan | undefined) => {
      const asked = parseAsked(await AsyncStorage.getItem(ASKED_KEY).catch(() => null));
      if (!plan || !shouldReportReturn({ returned: false, check: found, reference, asked })) return;
      let reply: CheckoutExit;
      try {
        reply = await billingApi.checkoutExit(reference, { secondsOpen: seconds });
      } catch {
        return; // offline or refused: nothing recorded, so nothing to ask about
      }
      await AsyncStorage.setItem(ASKED_KEY, JSON.stringify(rememberAsked(asked, reference))).catch(() => undefined);
      if (!reply.ask || !mounted.current || paymentCheckRef.current === "confirming") return;
      const song = songPlanRef.current;
      exitFor.current = { reference, secondsOpen: seconds, planId: plan.id };
      setExitAsk({
        reference,
        currency: reply.currency,
        price: formatPrice(reply.amountMinor, reply.currency),
        songPrice: song ? formatPrice(song.amountMinor, song.currency) : null,
        buyingSong: plan.interval === "single",
        keptMinutes: reply.keptMinutes,
      });
    },
    [],
  );

  /** A plan chosen from an older read of what Google Play sells: said, rather than Pay doing nothing. */
  function notOnPlay() {
    showDialog({
      title: "Not on sale in Google Play",
      message: "Google Play isn't selling this plan right now. Pull down to refresh, or choose another plan.",
      icon: "problem",
    });
  }

  /**
   * The Android purchase (board h-play 02): Google's own sheet, then the server, which asks Google before anything is
   * granted, then the welcome the provider shows once the membership has moved on.
   */
  async function buyWithPlay(plan: Plan) {
    const offer = offerFor(plan, playOffers);
    if (!offer) {
      notOnPlay();
      return;
    }
    if (!user) return;
    setBusy(true);
    beginCheckout(plan.id, subscription, plan.interval === "single", Boolean(plan.choirSeats));
    const outcome = await buyOnPlay(offer, user.id);
    if (outcome.kind !== "purchased") {
      abandonCheckout();
      if (mounted.current) setBusy(false);
      if (outcome.kind === "pending")
        showDialog({
          title: "Payment pending",
          message: "Google Play is waiting for your payment to go through. Pro unlocks the moment it does.",
          icon: "clock",
        });
      else if (outcome.kind === "failed")
        showDialog({
          title: "Google Play couldn't open",
          message: "Nothing was charged. Please try again in a moment.",
          icon: "problem",
          tone: "danger",
        });
      return;
    }
    try {
      await registerPlayPurchase(outcome.purchase);
      // The server has it: the provider's next read sees the membership move on and shows the welcome.
      watchPayment();
    } catch (e) {
      abandonCheckout();
      playRefusal(e, offer.productId);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  /** Restore purchases (board h-play 01/04): whatever this phone's Google account bought, handed to the server. */
  async function restore() {
    setRestoring(true);
    const found = await restorePlayPurchases(true);
    if (!mounted.current) return;
    setRestoring(false);
    if (found.restored > 0) {
      // Pro that has just arrived is welcomed by the provider, as any payment made away from this screen is.
      await refreshSubscription(false).catch(() => undefined);
      if (subscription?.isActive || !found.subscription?.isActive)
        showToast("Your Google Play purchases are up to date.");
      load();
      return;
    }
    if (found.otherAccount) {
      playRefusal({ code: "BILLING_PLAY_OTHER_ACCOUNT" }, null);
    } else if (found.failed) {
      showDialog({
        title: "Couldn't check just now",
        message: "Your purchases are safe with Google. Please try again in a minute.",
        icon: "problem",
        tone: "danger",
      });
    } else {
      showDialog({
        title: "Nothing to restore",
        message:
          "This phone's Google account has no NoteFusion purchase. If you paid with another Google account, switch to it in Google Play and try again.",
      });
    }
  }

  function playRefusal(e: unknown, productId: string | null) {
    const err = (e as { code?: string })?.code ? (e as { code: string }) : toApiError(e);
    if (err.code === "BILLING_PLAY_OTHER_ACCOUNT") {
      showDialog({
        title: "This purchase is on another account",
        message:
          "This Google Play purchase was bought while signed in to a different NoteFusion account. Sign in to that account to use it, or cancel it in Google Play.",
        actions: [
          { label: "Manage in Google Play", onPress: () => void Linking.openURL(manageUrl(productId)) },
          { label: "OK", style: "cancel" },
        ],
      });
      return;
    }
    showDialog({
      title: "Couldn't confirm your purchase",
      message: "Your purchase is safe with Google Play. It is confirmed the next time you open NoteFusion.",
      icon: "problem",
      tone: "danger",
    });
  }

  async function handleUpgrade(planId: string | null = selectedId) {
    if (!planId) return;
    const plan = plans.find((p) => p.id === planId) ?? choirPlans.find((p) => p.id === planId);
    const single = plan?.interval === "single";
    const choir = choirPlans.some((p) => p.id === planId);
    if (play) {
      if (plan) await buyWithPlay(plan);
      else notOnPlay();
      return;
    }
    setBusy(true);
    try {
      const session = await billingApi.checkout(planId);
      if (!session || !session.checkoutUrl) {
        setBusy(false);
        showDialog({
          title: "Checkout didn't open",
          message: "We couldn't open checkout. Check your connection and try again.",
          icon: "problem",
          tone: "danger",
        });
        return;
      }

      // Before the browser opens: what the provider compares the server's answer against, so a
      // member adding time is told apart from one whose checkout simply closed.
      beginCheckout(planId, subscription, single, choir);

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
      // Only a session the app watched close says how long the page was open and that it was closed by hand.
      let watchedClose = true;
      const openedAt = Date.now();
      try {
        const outcome = await WebBrowser.openAuthSessionAsync(session.checkoutUrl, RETURN_URL);
        returned = outcome.type === "success";
      } catch {
        watchedClose = false;
        await WebBrowser.openBrowserAsync(session.checkoutUrl).catch((e) => {
          // Neither browser would open, so nothing can have been paid: no wait to leave behind.
          abandonCheckout();
          throw e;
        });
      }
      const seconds = secondsOpen(openedAt, Date.now());

      // The provider confirms from here, and owns the welcome when the payment lands, so it
      // carries on if this screen is left. Closed by hand, its first answer is the quick check
      // "What stopped you?" waits on; never after the provider's own return.
      watchPayment(
        !returned,
        returned || !watchedClose
          ? undefined
          : (found) => void askWhy(found, session.reference, seconds, plan),
      );
      if (!mounted.current) return;
      setBusy(false);
    } catch (e) {
      if (!mounted.current) return;
      setBusy(false);
      // An earlier checkout turned out to be paid: nothing to buy, so the welcome, not an error.
      if (toApiError(e).code === "BILLING_PAYMENT_ALREADY_RECEIVED") {
        // For one song the snapshot's count is lowered by one, so the purchase already made reads as landed.
        beginCheckout(
          planId,
          single && subscription
            ? { ...subscription, boughtTranscriptionsTotal: (subscription.boughtTranscriptionsTotal ?? 1) - 1 }
            : choir && subscription
              ? { ...subscription, choirPeriodEndUtc: null } // the choir's period as it is now reads as landed
              : subscription,
          single,
          choir,
        );
        watchPayment();
        return;
      }
      showDialog({
        title: "Checkout failed",
        message: toApiError(e).message,
        icon: "problem",
        tone: "danger",
      });
    }
  }

  // One badge on the paywall (board m-ux-medium P4a): "Best value" on the plan it opens on, Pro's year, when the year
  // does save on paying by the month.
  const bestValue = bestValuePlan(plans);
  const bestValueId = bestValue && yearNote(bestValue, plans) ? bestValue.id : undefined;
  const selected = plans.find((p) => p.id === selectedId) ?? choirPlans.find((p) => p.id === selectedId);
  const buyingChoir = choirPlans.some((p) => p.id === selectedId);
  // A member who chose "Add more Pro time" sees the plans: each payment covers one period, and a
  // new one starts when the current time ends.
  const [extending, setExtending] = useState(false);
  // Until this screen's own read lands, the app's copy of the membership says which screen this is, so a member's
  // title does not flip from "NoteFusion Pro" to "Subscription" and the paywall's hero does not pop in once it does.
  const membership = subscription ?? liveSubscription ?? null;
  // Pro paused on Google Play's account hold shows the member screen with its fix, not the plans.
  const onHold = play && isOnHold(membership);
  const isActive = ((membership?.isActive ?? false) || onHold) && !extending;
  // The one-song purchase, for a free account only (the server hides it from members too); listed
  // first, beside Pro, as the smallest thing to buy.
  const singlePlan =
    subscription?.isActive || extending ? undefined : plans.find((p) => p.interval === "single");
  songPlanRef.current = singlePlan;
  // On Android a member opens the plans only to start a choir: Google Play renews their own Pro.
  const proPlans = play && extending ? [] : plans.filter((p) => p.interval !== "single");
  const buyingSong = selected?.interval === "single";
  // The chosen plan's price as the bar says it: Google Play's own on Android.
  const selectedPrice = selected
    ? offerFor(selected, playOffers)?.price ?? formatPrice(selected.amountMinor, selected.currency)
    : null;
  // The plans are on screen: the chosen plan's price and Pay sit in a bar pinned to the bottom (board l-ux-high 03a).
  const choosing = !loading && paymentCheck !== "confirming" && !isActive && (plans.length > 0 || choirPlans.length > 0);
  // The choir plans fold into one row when there is something else to choose; alone (a member starting a choir on
  // Android), they are the list.
  const foldChoir = proPlans.length > 0 || Boolean(singlePlan);
  const choirSorted = plansInOrder(choirPlans);
  const choirFrom = choirSorted[0];

  // The provider drops its checkout snapshot when the payment lands (it shows the welcome
  // itself): back to the member hub, re-read so it carries the new dates. One song bought goes
  // back to where the person was (the recorder, or the link still in its field) to use it.
  const hadPending = useRef<{ single: boolean; bought: number; choir: boolean } | null>(null);
  useEffect(() => {
    if (pendingCheckout) {
      hadPending.current = {
        single: Boolean(pendingCheckout.single),
        bought: pendingCheckout.bought ?? 0,
        choir: Boolean(pendingCheckout.choir),
      };
    } else if (hadPending.current) {
      const was = hadPending.current;
      hadPending.current = null;
      setExtending(false);
      if (was.single && (liveSubscription?.boughtTranscriptionsTotal ?? 0) > was.bought && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
      // A choir bought: on to the choir, where the invite link is.
      if (was.choir && liveSubscription?.choirPeriodEndUtc) {
        navigation.replace("Choir");
        return;
      }
      load();
    }
  }, [pendingCheckout, load, liveSubscription, navigation]);

  // ── Render ─────────────────────────────────────────────────────────────────

  /** What Pro brings: the same words before and after the plans load. */
  const featureList = (
    <Card style={styles.card}>
      {PRO_FEATURES.map((f, i) => (
        <View
          key={f.text}
          style={[styles.featureRow, i === 0 && styles.featureRowFirst]}
        >
          <View style={styles.featureIcon}>
            <Icon name={f.icon} size={16} color={colors.icon} />
          </View>
          <Text style={styles.featureText}>{f.text}</Text>
        </View>
      ))}
    </Card>
  );

  return (
    <View style={styles.flex}>
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
              <Icon name="back" size={20} color={colors.text} />
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

          {isActive && !onHold && (
            <View style={styles.activePill}>
              <View style={styles.activeDot} />
              <Text style={styles.activePillText}>Pro Active</Text>
            </View>
          )}
        </View>

        {/* ── Hero badge (only on paywall when not active), there from the first frame ── */}
        {!isActive && (
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
            {/* What Pro is, no more: hummed tunes are never counted, whole songs are twenty a month (PRO_FEATURES). */}
            <Text style={styles.heroSub}>
              Unlimited hummed tunes, twenty whole songs a month, and every download.
            </Text>
          </View>
        )}

        {/* ── Payment not confirmed after the quick checks: the provider keeps asking ── */}
        {!loading && paymentCheck === "delayed" && (
          <View style={styles.confirmNote}>
            <Icon name="clock" size={18} color={colors.icon} />
            <Text style={styles.confirmNoteText}>
              {pendingCheckout?.single
                ? "Your payment is still being confirmed. Your song unlocks automatically the moment it lands."
                : "Your payment is still being confirmed. Pro unlocks automatically the moment it lands."}
            </Text>
          </View>
        )}

        {loading ? (
          <>
            {/* The perks are fixed words: shown while the plans load, so the plans arrive under them. */}
            {!isActive ? featureList : null}
            <View style={styles.loadingBlock}>
              <PlanCardSkeleton />
              <PlanCardSkeleton />
            </View>
          </>
        ) : paymentCheck === "confirming" ? (
          // The provider is asking the server; there is nothing to press until it answers.
          <Card style={styles.card}>
            <View style={styles.confirmBlock}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.confirmTitle}>
                {play ? "Confirming with Google Play…" : "Confirming your payment…"}
              </Text>
              <Text style={styles.confirmText}>This usually takes a few seconds.</Text>
            </View>
          </Card>
        ) : isActive ? (
          <ActiveState
            subscription={membership!}
            profile={profile}
            user={user}
            onAndroid={play}
            onExtend={() => setExtending(true)}
            onOpenChoir={() => navigation.navigate("Choir")}
            onChanged={() => {
              load();
              // The shared provider drives the tab label and the gold ring, so it has to
              // hear about a cancellation too — not just this screen's local copy.
              refreshSubscription().catch(() => undefined);
            }}
          />
        ) : plans.length === 0 && choirPlans.length === 0 ? (
          <EmptyState
            onRetry={() => {
              setLoading(true);
              load();
            }}
          />
        ) : (
          <>
            {featureList}

            {/* ── Plan selector ────────────────────────────────────────────── */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Choose a plan</Text>
            </View>

            {singlePlan ? (
              <PlanOption
                plan={singlePlan}
                priceLabel={offerFor(singlePlan, playOffers)?.price}
                viaPlay={play}
                title={planTitle(singlePlan)}
                note="One more transcription, any recording or song link. No subscription."
                selected={singlePlan.id === selectedId}
                onSelect={() => setSelectedId(singlePlan.id)}
              />
            ) : null}

            {plansInOrder(proPlans).map((plan) => (
              <PlanOption
                key={plan.id}
                plan={plan}
                priceLabel={offerFor(plan, playOffers)?.price}
                viaPlay={play}
                selected={plan.id === selectedId}
                bestValue={plan.id === bestValueId}
                // The year in money (board m-ux-medium P4b); Google Play's own prices say their own.
                note={play ? undefined : yearNote(plan, plans) ?? undefined}
                onSelect={() => setSelectedId(plan.id)}
              />
            ))}

            {/* ── The choir plan: one director pays, the whole choir is Pro ───── */}
            {choirFrom && foldChoir ? (
              <Touchable
                onPress={() => setChoirOpen(true)}
                style={[styles.planOption, buyingChoir && styles.planOptionSelected]}
                radius={radii.lg}
                accessibilityLabel={
                  buyingChoir && selected
                    ? `For choir directors, ${planTitle(selected)} chosen. Open the choir plans`
                    : "For choir directors. Open the choir plans"
                }
              >
                <View style={styles.featureIcon}>
                  <Icon name="choir" size={16} color={colors.icon} />
                </View>
                <View style={styles.planInfo}>
                  <Text style={styles.planName}>For choir directors</Text>
                  <Text style={styles.planNote}>
                    {buyingChoir && selected
                      ? `${planTitle(selected)} · ${selectedPrice} ${periodLabel(selected.interval, play)}`
                      : `Pro for you and ${choirFrom.choirSeats ?? 25} singers · from ${
                          offerFor(choirFrom, playOffers)?.price ?? formatPrice(choirFrom.amountMinor, choirFrom.currency)
                        } ${periodLabel(choirFrom.interval, play)}`}
                  </Text>
                </View>
                <Icon name="chevron" size={18} color={colors.textFaint} />
              </Touchable>
            ) : choirPlans.length > 0 ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>For choir directors</Text>
                </View>
                {choirSorted.map((plan) => (
                  <ChoirPlanOption
                    key={plan.id}
                    plan={plan}
                    priceLabel={offerFor(plan, playOffers)?.price}
                    viaPlay={play}
                    selected={plan.id === selectedId}
                    onSelect={() => setSelectedId(plan.id)}
                  />
                ))}
              </>
            ) : null}

            <Text style={styles.finePrint}>
              {selected
                ? play
                  ? playFinePrint(selected)
                  : webFinePrint(selected)
                : "Secure checkout opens in your browser. You'll return here automatically."}
            </Text>

            {play ? (
              <View style={styles.restoreRow}>
                <Button label="Restore purchases" variant="text" onPress={() => void restore()} loading={restoring} />
              </View>
            ) : null}

            {/* A quiet row, not a link in the fine print: the pay bar keeps its one action. */}
            <Touchable
              onPress={() => setHelpOpen(true)}
              style={styles.helpRow}
              scaleTo={0.99}
              accessibilityLabel="Questions? Help and refunds"
            >
              <Icon name="help" size={20} color={colors.icon} />
              <Text style={styles.helpRowText}>Questions? Help & refunds</Text>
              <Icon name="chevron" size={16} color={colors.textFaint} />
            </Touchable>
          </>
        )}

        <CheckoutExitSheet
          ask={exitAsk}
          onClose={() => setExitAsk(null)}
          onAnswer={(reason, note) => {
            const at = exitFor.current;
            if (!at) return;
            // Best effort: the answer on screen does not wait on it, and a lost one is only a missing row.
            billingApi
              .checkoutExit(at.reference, { secondsOpen: at.secondsOpen, reason, ...(note ? { note } : {}) })
              .catch(() => undefined);
          }}
          onTryAgain={() => {
            // The same plan: the server hands back the same checkout while it is kept.
            const at = exitFor.current;
            if (at) void handleUpgrade(at.planId);
          }}
          onSong={() => {
            const song = songPlanRef.current;
            if (!song) return;
            setSelectedId(song.id);
            void handleUpgrade(song.id);
          }}
        />

        <Sheet
          visible={helpOpen}
          onClose={() => closeHelp()}
          onClosed={() => {
            const run = afterHelp.current;
            afterHelp.current = null;
            run?.();
          }}
        >
          <SheetTitle>Questions about paying?</SheetTitle>
          <SheetMessage>{REFUND_LINE}</SheetMessage>
          <Group cardStyle={styles.helpGroup}>
            <Row
              icon="mail"
              label="Email us"
              value={HELP_EMAIL}
              onPress={() =>
                closeHelp(() =>
                  void Linking.openURL(
                    `mailto:${HELP_EMAIL}?subject=${encodeURIComponent("Help with a payment")}`,
                  ).catch(() => undefined),
                )
              }
            />
            <Row
              icon="terms"
              label="Refunds and terms"
              external
              onPress={() => closeHelp(() => void WebBrowser.openBrowserAsync(siteUrls.terms).catch(() => undefined))}
            />
            <Row icon="help" label="FAQ & Help" chevron onPress={() => closeHelp(() => navigation.navigate("Help"))} />
          </Group>
        </Sheet>

        <Sheet visible={choirOpen} onClose={() => setChoirOpen(false)}>
          <SheetTitle>For choir directors</SheetTitle>
          <SheetMessage>One director pays and the whole choir is Pro, with one shared library.</SheetMessage>
          {choirSorted.map((plan) => (
            <ChoirPlanOption
              key={plan.id}
              plan={plan}
              priceLabel={offerFor(plan, playOffers)?.price}
              viaPlay={play}
              selected={plan.id === selectedId}
              onSelect={() => {
                setSelectedId(plan.id);
                setChoirOpen(false);
              }}
            />
          ))}
        </Sheet>
      </Screen>

      {/* ── The pay bar: the chosen plan's price and Pay, where the thumb is ── */}
      {choosing ? (
        <View style={[styles.payBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {selected && selectedPrice ? (
            <View style={styles.payLine}>
              <Text style={styles.payPlan} numberOfLines={1}>{planTitle(selected)}</Text>
              {/* On the website's checkout, how long it lasts (board m-ux-medium P4b); Google Play's own labels stay. */}
              {play ? (
                <Text style={styles.payPrice}>
                  {selectedPrice}
                  <Text style={styles.planPeriod}> {periodLabel(selected.interval, play)}</Text>
                </Text>
              ) : (
                <Text style={styles.payUntil}>{paidUntilLine(selected, membership, new Date())}</Text>
              )}
            </View>
          ) : null}
          <Button
            label={
              selected && play
                ? playButtonLabel(
                    selected,
                    selectedPrice ?? formatPrice(selected.amountMinor, selected.currency),
                    subscription?.choirRole === "director",
                  )
                : selected
                  // What one payment buys, on the website's checkout (board m-ux-medium P4d).
                  ? payLabel(selected)
                  : "Upgrade"
            }
            icon={buyingSong ? "song" : buyingChoir ? "choir" : "pro"}
            onPress={() => void handleUpgrade()}
            loading={busy}
            disabled={!selectedId}
            block
          />
          {selected && nairaNote(selected.currency, play) ? (
            <Text style={styles.nairaLine}>{nairaNote(selected.currency, play)}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
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
  onAndroid,
  onChanged,
  onExtend,
  onOpenChoir,
}: {
  subscription: Subscription;
  profile: MyProfile | null;
  user: AuthUser | null;
  /** The Android app, which pays through Google Play only: no website time is sold or cancelled here. */
  onAndroid: boolean;
  onChanged: () => void;
  onExtend: () => void;
  onOpenChoir: () => void;
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
  // Pro through a choir alone: the plan shown is the choir's, and there is no membership of one's own to cancel.
  const viaChoir = Boolean(subscription.choirRole) && (subscription.planCode ?? "").startsWith("choir_");
  // Google Play renews this membership (board h-play 03): it is managed, fixed and cancelled in Google Play.
  const play = onAndroid ? playMemberState(subscription) : null;
  const paidOnWeb = onAndroid && subscription.billedThrough === "web";
  const openPlay = () => void Linking.openURL(manageUrl(subscription.storeProductId));

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
        // Nothing bought on the website renews, so this never says "won't renew": only that nothing more is charged.
        message: renews
          ? `Pro stays active until ${renews}, and nothing more is charged. Add time again whenever you like.`
          : "Pro stays active until the end of your paid period, and nothing more is charged.",
        icon: "done",
      });
    } catch (e) {
      showDialog({
        title: "Could not cancel",
        message: toApiError(e).message,
        icon: "problem",
        tone: "danger",
      });
    } finally {
      setCanceling(false);
    }
  }

  /** Opens the reason-survey modal — the actual cancel() only fires once
   *  the user confirms; picking a reason is optional. */
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
              <Icon name="pro" size={13} color={colors.premiumDeep} />
              <Text style={styles.memberBadgeText}>
                {lifetime
                  ? "Lifetime Member"
                  : viaChoir
                    ? subscription.choirName ?? "Choir"
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
                {play === "hold" ? "Paused" : canceled ? "Ending Soon" : "Active"}
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

      {/* ── 2. Notice Callout (a renewal Google Play could not take, or cancelled) ───── */}
      {play && playProblemNote(play) ? (
        <View style={styles.noticeWarning}>
          <Icon name="problem" size={18} color={colors.warning} />
          <Text style={styles.noticeWarningText}>{playProblemNote(play)}</Text>
        </View>
      ) : null}
      {canceled && renews && !play && (
        <View style={styles.noticeWarning}>
          <Icon name="problem" size={18} color={colors.warning} />
          <Text style={styles.noticeWarningText}>
            Your subscription has been canceled and will end on {renews}. Pro features remain active until then, and all your saved music scores will stay safe in your library.
          </Text>
        </View>
      )}

      {/* ── 3. Included Pro Privileges ────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Included With Pro</Text>
      </View>

      <Card style={styles.benefitsCard}>
        {PRO_BENEFITS.map((item, index) => (
          <View
            key={item.title}
            style={[styles.benefitRow, index > 0 && styles.benefitRowBorder]}
          >
            <View style={styles.benefitIconCircle}>
              <Icon name={item.icon} size={20} color={colors.icon} />
            </View>
            <View style={styles.benefitContent}>
              <Text style={styles.benefitTitle}>{item.title}</Text>
              <Text style={styles.benefitDesc}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* ── 4. Plan & Billing Details ─────────────────────────────────── */}
      <View style={styles.sectionHeader}>
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

        {play || paidOnWeb ? (
          <View style={styles.billingRow}>
            <Text style={styles.billingLabel}>{play ? "Paid through" : "Paid on"}</Text>
            <Text style={styles.billingValue}>{play ? "Google Play" : "NoteFusion website"}</Text>
          </View>
        ) : null}

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
            {play
              ? playStatusLine(play)
              : lifetime
              ? "Paid in full"
              : isGift
                ? "Complimentary"
                : canceled
                  ? "Cancels at period end"
                  : "Active & Paid"}
          </Text>
        </View>

        {renews && !lifetime && play !== "hold" && (
          <View style={styles.billingRow}>
            <Text style={styles.billingLabel}>
              {play === "renewing" ? "Next charge" : "Pro until"}
            </Text>
            <Text style={styles.billingValue}>{renews}</Text>
          </View>
        )}

        {/* Google Play: the fix, the way back, or the page where it is managed. */}
        {play === "grace" || play === "hold" ? (
          <Button label="Fix payment in Google Play" icon="card" onPress={openPlay} style={styles.cancelBtn} />
        ) : play === "cancelled" ? (
          <Button
            label="Resubscribe in Google Play"
            variant="secondary"
            icon="sync"
            onPress={openPlay}
            style={styles.cancelBtn}
          />
        ) : play === "renewing" ? (
          <Button label="Manage in Google Play" variant="secondary" icon="external" onPress={openPlay} style={styles.cancelBtn} />
        ) : null}

        {/* A singer's Pro is the choir's: their director renews it, so there is nothing for them to add. On Android
            time is never sold here: Google Play renews its own memberships, and the app may not point elsewhere. */}
        {!lifetime && !onAndroid && !(viaChoir && subscription.choirRole === "member") && (
          <Button
            label={viaChoir ? "Add choir time" : "Add more Pro time"}
            icon="add"
            onPress={onExtend}
            style={styles.cancelBtn}
          />
        )}

        {subscription.choirRole ? (
          <Button
            label="My choir"
            variant="secondary"
            icon="choir"
            onPress={onOpenChoir}
            style={styles.cancelBtn}
          />
        ) : (
          <Button
            label="Start a choir"
            variant="secondary"
            icon="choir"
            onPress={onExtend}
            style={styles.cancelBtn}
          />
        )}

        {!lifetime && !isGift && !canceled && !viaChoir && !onAndroid && (
          <Button
            label="Cancel subscription"
            variant="secondary"
            icon="clear"
            onPress={openCancelFlow}
            loading={canceling}
            style={styles.cancelBtn}
          />
        )}

        <Text style={styles.billingHint}>
          {play
            ? playHint(play, renews)
            : paidOnWeb && !viaChoir
            ? "This Pro was bought on the NoteFusion website. When it ends, this phone offers Pro through Google Play."
            : lifetime
            ? "Lifetime access — there is nothing to renew or cancel. Invoices and receipts were sent to your email."
            : viaChoir
              ? subscription.choirRole === "member"
                ? `You have Pro through ${subscription.choirName}. Your choir director renews the choir's plan.`
                : "Your singers are Pro while the choir's plan runs. Each payment adds one period after the time left."
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
 * The survey shown before the membership is cancelled, as a bottom sheet: the reasons are rows
 * you tap once, then "Cancel membership" confirms. A quiet pill, not a red one: nothing is lost,
 * Pro runs to its date. A reason is optional — the server takes none yet, so cancelling never
 * waits on one; it is held client-side (available for future analytics or a server endpoint).
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
  return (
    <Sheet visible={visible} onClose={onDismiss}>
      <SheetTitle>Before you go…</SheetTitle>
      <SheetMessage>
        {renews
          ? `Pro stays active until ${renews}: no refund, and no charge today. Why are you cancelling? (optional)`
          : "Help us improve: why are you cancelling? (optional)"}
      </SheetMessage>
      {CANCEL_REASONS.map((reason) => (
        <ChoiceRow
          key={reason}
          title={reason}
          selected={selectedReason === reason}
          onPress={() => onSelectReason(reason)}
        />
      ))}
      <SheetActions style={{ marginTop: spacing.sm }}>
        <Button label="Keep Pro" variant="text" onPress={onDismiss} />
        <Button
          label="Cancel membership"
          variant="secondary"
          onPress={onConfirm}
          loading={canceling}
        />
      </SheetActions>
    </Sheet>
  );
}

/** A choir plan as a plan row: in the "For choir directors" sheet, or the list when it is all there is. */
function ChoirPlanOption({
  plan,
  priceLabel,
  viaPlay,
  selected,
  onSelect,
}: {
  plan: Plan;
  priceLabel?: string;
  viaPlay: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <PlanOption
      plan={plan}
      priceLabel={priceLabel}
      viaPlay={viaPlay}
      title={planTitle(plan)}
      note={`Pro for you and up to ${plan.choirSeats ?? 25} singers, one shared library.`}
      selected={selected}
      onSelect={onSelect}
    />
  );
}

/** A selectable plan row with a radio and price, and the "Best value" tab on the plan the paywall opens on. */
function PlanOption({
  plan,
  selected,
  bestValue = false,
  title,
  note,
  priceLabel,
  viaPlay,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  /** The one badge on the paywall: a small tab on the card's top edge, so the plan's name keeps its line. */
  bestValue?: boolean;
  /** The price as Google Play shows it, on Android, instead of the plan's own. */
  priceLabel?: string;
  /** Sold through Google Play, which renews: the price is a rate there, and what one payment buys on the website. */
  viaPlay: boolean;
  /** Overrides the plan's own name, as "Just this song" does for the one-song purchase. */
  title?: string;
  /** A plain line under the price. */
  note?: string;
  onSelect: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const period = periodLabel(plan.interval, viaPlay);

  return (
    <View>
      <Touchable
        onPress={onSelect}
        style={[styles.planOption, selected && styles.planOptionSelected]}
        // Flat surface fill and no shadow, so the ripple can be clipped to the card's
        // own corner radius rather than painting a square over it.
        radius={radii.lg}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${title ?? plan.name}, ${priceLabel ?? formatPrice(plan.amountMinor, plan.currency)} ${period}${bestValue ? ", best value" : ""}`}
      >
        <View
          style={[styles.radio, selected && styles.radioSelected]}
        >
          {selected && <View style={styles.radioDot} />}
        </View>

        <View style={styles.planInfo}>
          <View style={styles.planTitleRow}>
            <Text style={styles.planName}>{title ?? plan.name}</Text>
          </View>
          <Text style={styles.planPrice}>
            {priceLabel ?? formatPrice(plan.amountMinor, plan.currency)}
            <Text style={styles.planPeriod}> {period}</Text>
          </Text>
          {note ? <Text style={styles.planNote}>{note}</Text> : null}
        </View>

        {selected && (
          <Icon name="check" size={20} color={colors.link} />
        )}
      </Touchable>
      {/* Beside the card rather than in it: the card clips to its corners for the ripple, and the tab stands proud. */}
      {bestValue ? (
        <View style={styles.bestTab} pointerEvents="none">
          <Text style={styles.bestTabText}>Best value</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Shown when plans can't be loaded (offline, or billing not configured server-side). */
function EmptyState({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={styles.card}>
      <View style={styles.emptyBlock}>
        <Icon name="offline" size={28} color={colors.textFaint} />
        <Text style={styles.emptyText}>Plans couldn't be loaded right now.</Text>
        <Button label="Try again" variant="secondary" onPress={onRetry} />
      </View>
    </Card>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const makeStyles = (c: Palette, s: Shadows) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.bg },
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
      backgroundColor: c.sheetTile,
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
    /** "Best value", in the selected blue, on the card's top edge (board m-ux-medium P4a). */
    bestTab: {
      position: "absolute",
      top: -11,
      right: spacing.lg,
      backgroundColor: c.accentSoftOpaque,
      borderWidth: 1,
      borderColor: c.accent,
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    bestTabText: {
      fontFamily: fonts.bold,
      fontSize: 12,
      color: c.link,
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
    // The plans' notes and the terms under them are read, not glanced at: 13.5 in the muted grey (board m-ux-medium P4c).
    planNote: {
      fontFamily: fonts.regular,
      fontSize: 13.5,
      lineHeight: 19,
      color: c.textMuted,
      marginTop: 3,
    },

    // ── The pay bar: the canvas under a hairline, pinned to the bottom ────────
    payBar: {
      gap: spacing.sm,
      paddingTop: spacing.md,
      paddingHorizontal: spacing.lg,
      backgroundColor: c.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    payLine: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    payPlan: {
      ...typography.caption,
      color: c.textMuted,
      flexShrink: 1,
    },
    payPrice: {
      ...typography.label,
      color: c.text,
      fontSize: 15,
    },
    payUntil: {
      fontFamily: fonts.semibold,
      fontSize: 13.5,
      color: c.text,
    },
    nairaLine: {
      ...typography.caption,
      color: c.textMuted,
      textAlign: "center",
      lineHeight: 17,
      paddingHorizontal: spacing.md,
    },
    finePrint: {
      fontFamily: fonts.regular,
      fontSize: 13.5,
      lineHeight: 19,
      color: c.textMuted,
      textAlign: "center",
      marginTop: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    restoreRow: {
      alignItems: "center",
      marginTop: spacing.sm,
    },
    /** "Questions? Help & refunds": a 52 px row between hairlines, under the terms. */
    helpRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      minHeight: 52,
      marginTop: 14,
      paddingHorizontal: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    helpRowText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: c.text,
    },
    helpGroup: {
      backgroundColor: c.sheetRow,
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
      color: c.premiumText,
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
      backgroundColor: c.sheetTile,
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
  });

