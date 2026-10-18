import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { billingApi } from '../api/endpoints';
import { useAuth } from './auth';
import { showDialog } from './dialog';
import * as haptics from './haptics';
import { ProWelcomeModal, type ProWelcome } from '../components/ProWelcomeModal';
import { PRO_FEATURES } from './proFeatures';
import type { Subscription } from '../api/types';
import { FREE_RESET_FALLBACK, freeWeek } from './freeWeek';

/**
 * What the account looked like the moment a checkout opened. A payment has landed when the server's
 * answer moves past this — `isActive` alone cannot say so for a member who was already Pro and is
 * adding time, and who is active whether or not they paid.
 */
export interface CheckoutSnapshot {
  planId: string;
  /** Epoch milliseconds. */
  startedAt: number;
  wasActive: boolean;
  periodEnd: string | null;
  lifetime: boolean;
  planCode: string | null;
  /** A one-song purchase: it lands as one more bought transcription, never as Pro. */
  single?: boolean;
  /** `boughtTranscriptionsTotal` when the checkout opened, for a one-song purchase. */
  bought?: number;
  /** A choir plan: it lands as the choir's period end moving on, whatever the account's own Pro does. */
  choir?: boolean;
  /** `choirPeriodEndUtc` when the checkout opened, for a choir plan. */
  choirPeriodEnd?: string | null;
}

/** `confirming` while polling hard just after checkout; `delayed` once that window passed unanswered. */
export type PaymentCheck = 'idle' | 'confirming' | 'delayed';

interface SubscriptionState {
  /**
   * The server's answer, or null for "no subscription OR we don't know yet". Before the server has
   * replied this may be the previous session's cached answer — `known` is what says which.
   */
  subscription: Subscription | null;
  /**
   * Whether to show Pro treatment. Deliberately `?? false`: an account whose
   * state we could not read is a **Free** account. Every premium perk — the gold
   * avatar ring, the Pro badge, the Premium tab label — gates on this, so
   * a failed request can never hand out a paid look.
   */
  isPro: boolean;
  /** True when the active subscription was granted by an operator rather than purchased. */
  isGift: boolean;
  /**
   * True once a fetch has come back successfully. Distinguishes "definitely not
   * subscribed" from "couldn't ask", which matters for *restricting* a free user:
   * `isPro` alone would lock a paying customer out on a dropped request. UI reads
   * `isPro`; quota gates read `known && !isPro` so they still fail open.
   */
  known: boolean;
  loading: boolean;
  /**
   * Transcriptions left for a hum or recording: this week's free ones plus the bought ones,
   * from the server. Falls back to the full allowance while unknown, for the same fail-open
   * reason as `known`: a dropped billing request must not read as "0 left" and block the
   * microphone. Gates pair it with `known`.
   */
  trialRemaining: number;
  /** The week's free allowance plus any bought, so copy can say "2 of 5" without repeating the 5. */
  trialTotal: number;
  /** This week's free hums and recordings left, bought ones apart (fails open like `trialRemaining`). */
  freeRemaining: number;
  /** Free hums and recordings a week (3). */
  freePerWeek: number;
  /** When this week's free ones come back, in the phone's time ("Friday 6pm"). */
  freeBack: string;
  /** Bought transcriptions not yet used (0 on Pro): each can be a whole linked song. */
  boughtRemaining: number;
  /** Transcriptions ever bought, so copy can tell the free ones from the bought ones. */
  boughtTotal: number;
  /** Re-reads the server. If reconcilePending is true (default for manual refresh), verifies any in-flight payment first. */
  refresh: (reconcilePending?: boolean) => Promise<void>;
  /** The checkout this device opened and has not yet seen land, or null. */
  pendingCheckout: CheckoutSnapshot | null;
  paymentCheck: PaymentCheck;
  /**
   * Records the state a checkout starts from. Call before the provider's page opens.
   * `single` for the one-song purchase, which lands as a bought transcription, not Pro;
   * `choir` for a choir plan, which lands as the choir's period moving on.
   */
  beginCheckout: (planId: string, current: Subscription | null, single?: boolean, choir?: boolean) => void;
  /**
   * Polls until the pending checkout lands, then shows the one welcome pop-up. Safe to call again
   * while it runs. Returns false when there is nothing pending to watch. The paywall calls it once
   * the checkout browser has closed, which is also what lets foreground re-reads resume.
   *
   * `quiet` polls without the "Confirming your payment…" state, for when nothing says a payment was
   * made (the sheet was closed by hand, the app came back to the front): a person who cancelled is
   * not kept from the plans, and a payment that did go through still gets its welcome.
   */
  watchPayment: (quiet?: boolean) => boolean;
  /** Drops the snapshot of a checkout whose browser never opened, so nothing waits on it. */
  abandonCheckout: () => void;
}

const SubscriptionContext = createContext<SubscriptionState | undefined>(undefined);

/**
 * Only used before the server has answered. The real number always comes from the
 * server (`FreeTier.TrialGenerationsFor`, three a week everywhere); this matches it so the
 * pill does not change under the user when the answer lands, and keeps a dropped
 * request from looking like an exhausted trial.
 */
const DEFAULT_TRIAL_TOTAL = 3;

/**
 * Where the last successful answer is kept, per account, so a cold start can paint Pro before the
 * billing service has replied. Not SecureStore: that is reserved for bearer credentials, and this is
 * a cosmetic head start, not a capability — the server is still the only thing that grants anything.
 *
 * Per-user, because a handset is shared and one account's paid status must never be read for another.
 */
const cacheKey = (userId: string) => `@notefusion_sub:${userId}`;
const trackerKey = (userId: string) => `@notefusion_sub_tracker:${userId}`;
/** The pending checkout, kept so an app closed while the browser was open still celebrates on reopen. */
const checkoutKey = (userId: string) => `@notefusion_checkout:${userId}`;

/**
 * How a payment is watched after the browser closes: quick ticks first, because most land within
 * seconds, then slow ones for a provider that settles minutes later. A checkout older than the TTL
 * was abandoned and is no longer asked about.
 */
const FAST_TICK_MS = 2_500;
const FAST_WINDOW_MS = 60_000;
const SLOW_TICK_MS = 15_000;
const WATCH_WINDOW_MS = 10 * 60_000;
const CHECKOUT_TTL_MS = 2 * 60 * 60_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether a cached period has already run out, in which case it is hydrated inactive. `isLifetime`
 * needs no special case — its `currentPeriodEndUtc` is a far-future sentinel — and a null end date is
 * unjudgeable, so it stands and the fetch settles it a moment later.
 */
function lapsed(sub: Subscription): boolean {
  return (
    sub.isActive &&
    sub.currentPeriodEndUtc !== null &&
    Date.parse(sub.currentPeriodEndUtc) < Date.now()
  );
}

/**
 * Whether `sub` shows that the payment started from `from` has landed. Active is enough for an
 * account that was not; a member adding time needs the period to move on, the plan to change, or
 * lifetime to arrive — otherwise a cancelled checkout would read as a purchase.
 */
function landed(from: CheckoutSnapshot, sub: Subscription): boolean {
  // One song bought: the bought count moves on; Pro does not change.
  if (from.single) return (sub.boughtTranscriptionsTotal ?? 0) > (from.bought ?? 0);
  // A choir plan: the choir's own period moves on (a director may hold Pro of their own beside it).
  if (from.choir) {
    if (!sub.choirPeriodEndUtc) return false;
    return !from.choirPeriodEnd || Date.parse(sub.choirPeriodEndUtc) > Date.parse(from.choirPeriodEnd);
  }
  if (!sub.isActive) return false;
  if (!from.wasActive) return true;
  if (sub.isLifetime && !from.lifetime) return true;
  if (sub.planCode !== from.planCode) return true;
  if (!sub.currentPeriodEndUtc) return false;
  return (
    from.periodEnd === null ||
    Date.parse(sub.currentPeriodEndUtc) > Date.parse(from.periodEnd)
  );
}

/**
 * Owns "is this account premium?" for the whole app.
 *
 * Before this existed the question was answered four different ways — the profile
 * badge read `role`, the record screen made its own `mySubscription()` call on every
 * tap, the paywall read `isActive`, and the tab bar didn't ask at all — so the same
 * account could look Pro in one place and Free in another. Billing state now has
 * exactly one reader, and everything else consumes this hook.
 *
 * It also owns the wait after a checkout: the paywall records where the account stood
 * (`beginCheckout`), and from the browser's return this polls confirm until the payment
 * lands and shows the one welcome pop-up, over whatever screen the user is on by then.
 *
 * Must be mounted *inside* AuthProvider: the fetch is keyed on the session, and a
 * sign-out has to wipe the cached state so the next user doesn't inherit it.
 */
export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [known, setKnown] = useState(false);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  /** Mirrors `known` for reads inside `load`, which must not depend on it. */
  const knownRef = useRef(false);
  /** Which account the cache belongs to. Same reason as `knownRef`: `load` may not depend on it. */
  const userIdRef = useRef<string | null>(null);
  /** Previous acknowledged subscription state for detecting gifts, revokes, and purchases. */
  const lastSeenRef = useRef<{ isActive: boolean; isGift: boolean } | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<CheckoutSnapshot | null>(null);
  /** Mirrors `pendingCheckout` for the poll, which reads it between awaits. */
  const pendingRef = useRef<CheckoutSnapshot | null>(null);
  const [paymentCheck, setPaymentCheckState] = useState<PaymentCheck>('idle');
  const paymentCheckRef = useRef<PaymentCheck>('idle');
  /** Bumped to stop a running poll: each loop exits once the number is no longer its own. */
  const pollRunRef = useRef(0);
  /** The running poll's number and start, and whether it is quiet (see `watchPayment`). */
  const watchRef = useRef<{ run: number; started: number; quiet: boolean } | null>(null);
  /**
   * True from `beginCheckout` until the paywall reports the browser closed. iOS keeps the app
   * active under the checkout sheet, and coming back from a bank or SMS app mid-payment fires
   * `active` while the sheet is still up: a poll started then could land the payment and raise the
   * welcome while the sheet is presented, where iOS refuses to show it and the pop-up is lost.
   */
  const checkoutOpenRef = useRef(false);
  /** The last subscription state celebrated, so one payment gets one pop-up. */
  const celebratedRef = useRef<string | null>(null);
  const [welcome, setWelcome] = useState<ProWelcome | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setPending = useCallback((next: CheckoutSnapshot | null) => {
    pendingRef.current = next;
    setPendingCheckout(next);
    const id = userIdRef.current;
    if (!id) return;
    void (next
      ? AsyncStorage.setItem(checkoutKey(id), JSON.stringify(next))
      : AsyncStorage.removeItem(checkoutKey(id))
    ).catch(() => undefined);
  }, []);

  const setPaymentCheck = useCallback((next: PaymentCheck) => {
    paymentCheckRef.current = next;
    setPaymentCheckState(next);
  }, []);

  const stopWatching = useCallback(() => {
    pollRunRef.current += 1;
    setPaymentCheck('idle');
  }, [setPaymentCheck]);

  /**
   * The poll, a foreground re-read and a pull-to-refresh can all see the same payment land.
   * Whichever sees it first is the only one that speaks.
   */
  const celebrate = useCallback((sub: Subscription, extended: boolean, song: boolean = false) => {
    const key = song
      ? `song|${sub.boughtTranscriptionsTotal ?? 0}`
      : `${sub.planCode}|${sub.currentPeriodEndUtc}|${sub.isLifetime}|${sub.choirPeriodEndUtc ?? ''}`;
    if (celebratedRef.current === key) return;
    celebratedRef.current = key;
    haptics.play('success');
    setWelcome({ subscription: sub, extended, kind: song ? 'song' : 'pro' });
  }, []);

  /** Takes a fresh answer from the server: state, transitions, and the cache. */
  const apply = useCallback(
    (sub: Subscription) => {
      setSubscription(sub);
      setKnown(true);
      knownRef.current = true;

      const id = userIdRef.current;
      const prev = lastSeenRef.current;
      const currentIsActive = sub.isActive;
      const currentIsGift = Boolean(sub.isGift);
      const pending = pendingRef.current;

      if (pending && landed(pending, sub)) {
        // The payment this device started. Judged against the snapshot rather than the last
        // state seen, so a member adding time is celebrated too.
        setPending(null);
        celebrate(sub, pending.wasActive, Boolean(pending.single));
      } else if (prev !== null) {
        // Only check state transitions when we have an existing known baseline
        if (!prev.isActive && currentIsActive) {
          if (currentIsGift) {
            haptics.play('success');
            showDialog({
              kind: "celebrate",
              title: "Pro access gifted",
              message: "An administrator has gifted you NoteFusion Pro.",
              icon: "gift-outline",
              tone: "premium",
              perks: PRO_FEATURES,
              actions: [{ label: "Start using Pro", style: "cancel" }],
            });
          } else {
            // Paid where this device was not watching: the website, or a checkout that outlived
            // its snapshot.
            celebrate(sub, false);
          }
        } else if (prev.isActive && !currentIsActive) {
          haptics.play('warning');
          showDialog({
            title: "Pro Access Updated",
            message: prev.isGift
              ? "Your gifted NoteFusion Pro access has been revoked by an administrator. Your account has returned to the Free plan."
              : "Your NoteFusion Pro subscription has ended. Your account has returned to the Free plan.",
            icon: "alert-circle-outline",
            tone: "danger",
          });
        }
      }

      lastSeenRef.current = { isActive: currentIsActive, isGift: currentIsGift };

      // Best-effort, and never awaited: the answer is already on screen, and a storage failure has
      // no consequence beyond the next cold start flashing Free the way it used to.
      if (id) {
        void AsyncStorage.setItem(cacheKey(id), JSON.stringify(sub)).catch(() => undefined);
        void AsyncStorage.setItem(
          trackerKey(id),
          JSON.stringify({ isActive: currentIsActive, isGift: currentIsGift }),
        ).catch(() => undefined);
      }
    },
    [celebrate, setPending],
  );

  const load = useCallback(async (reconcilePending: boolean = false) => {
    setLoading(true);
    try {
      // If reconcilePending is true (on pull-to-refresh or foreground return), call confirm()
      // which checks with the payment gateway for any in-flight checkout session first.
      // If no checkout is pending or confirm fails, it safely falls back to mySubscription().
      const sub = reconcilePending
        ? await billingApi.confirm().catch(() => billingApi.mySubscription())
        : await billingApi.mySubscription();
      if (!mounted.current) return;
      apply(sub);
    } catch {
      // Network down, 5xx, expired session mid-refresh. Only clear the state we have
      // never successfully read — a *re*-read that fails must leave the last known
      // answer standing. Wiping it would set `isPro` false while `known` stayed true,
      // and quota gates read `known && !isPro`, so a dropped request on a refresh would
      // gate a paying customer out of the microphone. `known` false keeps them open.
      //
      // Read through a ref, not the state: this callback must keep a stable identity or
      // the effects below re-run on every state change and re-fetch in a loop.
      if (!mounted.current) return;
      if (!knownRef.current) setSubscription(null);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [apply]);

  const watchPayment = useCallback((quiet: boolean = false): boolean => {
    checkoutOpenRef.current = false;
    const pending = pendingRef.current;
    if (!pending) return false;
    if (Date.now() - pending.startedAt > CHECKOUT_TTL_MS) {
      setPending(null);
      return false;
    }
    // Still in its quick ticks: keep it, only letting a return from the provider make it visible.
    const live = watchRef.current;
    if (live && live.run === pollRunRef.current && Date.now() - live.started < FAST_WINDOW_MS) {
      if (!quiet && live.quiet) {
        live.quiet = false;
        setPaymentCheck('confirming');
      }
      return true;
    }

    const run = ++pollRunRef.current;
    const watch = { run, started: Date.now(), quiet };
    watchRef.current = watch;
    setPaymentCheck(quiet ? 'idle' : 'confirming');
    void (async () => {
      const started = watch.started;
      for (;;) {
        const elapsed = Date.now() - started;
        if (elapsed >= WATCH_WINDOW_MS) break;
        if (elapsed >= FAST_WINDOW_MS && !watch.quiet && paymentCheckRef.current !== 'delayed') {
          setPaymentCheck('delayed');
        }
        try {
          const sub = await billingApi.confirm();
          if (!mounted.current || pollRunRef.current !== run) return;
          apply(sub); // clears the snapshot once the payment has landed
        } catch {
          // Offline, a slow provider, a server hiccup: nothing to say, the next tick asks again.
        }
        if (!pendingRef.current) break;
        await delay(elapsed < FAST_WINDOW_MS ? FAST_TICK_MS : SLOW_TICK_MS);
        if (!mounted.current || pollRunRef.current !== run) return;
      }
      if (mounted.current && pollRunRef.current === run) setPaymentCheck('idle');
    })();
    return true;
  }, [apply, setPending, setPaymentCheck]);

  const beginCheckout = useCallback(
    (planId: string, current: Subscription | null, single: boolean = false, choir: boolean = false) => {
      setPending({
        planId,
        startedAt: Date.now(),
        wasActive: current?.isActive ?? false,
        periodEnd: current?.currentPeriodEndUtc ?? null,
        lifetime: current?.isLifetime ?? false,
        planCode: current?.planCode ?? null,
        single,
        bought: current?.boughtTranscriptionsTotal ?? 0,
        choir,
        choirPeriodEnd: current?.choirPeriodEndUtc ?? null,
      });
      // Nothing confirms behind the sheet, an earlier checkout's slow poll included: the watch
      // starts again from the browser's return.
      checkoutOpenRef.current = true;
      stopWatching();
    },
    [setPending, stopWatching],
  );

  const abandonCheckout = useCallback(() => {
    checkoutOpenRef.current = false;
    setPending(null);
  }, [setPending]);

  // Keyed on user id, not the object: `setUser` replaces the object on every
  // profile edit, and a name change is no reason to re-ask the billing service.
  const userId = user?.id ?? null;

  /**
   * Paints the last known answer while the server is being asked, so a paying customer does not watch
   * their Pro badge and gold ring arrive a few hundred milliseconds late on every cold start.
   *
   * Sets `subscription` and deliberately **leaves `known` false**. That is the whole safety property:
   * `isPro` turns true immediately, so the premium treatment paints, while quota gates reading
   * `known && !isPro` stay open until the server itself has answered. Nothing is granted from cache —
   * a cached "active" that the server then contradicts is corrected on the same tick as before.
   */
  const hydrateFromCache = useCallback(async (id: string) => {
    try {
      const [rawSub, rawTracker, rawCheckout] = await Promise.all([
        AsyncStorage.getItem(cacheKey(id)),
        AsyncStorage.getItem(trackerKey(id)),
        AsyncStorage.getItem(checkoutKey(id)),
      ]);
      // Never over an answer the fetch already gave: a stale "inactive" here would make the next
      // re-read look like a purchase and put the welcome up for nothing.
      if (rawTracker && lastSeenRef.current === null) {
        lastSeenRef.current = JSON.parse(rawTracker);
      }
      if (rawCheckout && userIdRef.current === id && !pendingRef.current) {
        pendingRef.current = JSON.parse(rawCheckout) as CheckoutSnapshot;
        setPendingCheckout(pendingRef.current);
        // Reopened after being closed mid-checkout: nothing says whether it was paid, so look quietly.
        watchPayment(true);
      }
      if (!rawSub) return;
      const cached = JSON.parse(rawSub) as Subscription;

      // The fetch may have won the race, or the account may have changed under this read. Either way
      // the newer thing wins — this must never overwrite an answer.
      if (!mounted.current || knownRef.current || userIdRef.current !== id) return;

      setSubscription(lapsed(cached) ? { ...cached, isActive: false } : cached);
    } catch {
      // No entry, unreadable, or written by an older shape of `Subscription`. The fetch already
      // underway is the real answer, so there is nothing to recover from.
    }
  }, [watchPayment]);

  useEffect(() => {
    if (!userId) {
      // Signed out — drop the previous account's state entirely, cache included: the paid status of
      // an account nobody is signed into has no business surviving on the handset.
      const previous = userIdRef.current;
      if (previous) {
        void AsyncStorage.removeItem(cacheKey(previous)).catch(() => undefined);
        void AsyncStorage.removeItem(trackerKey(previous)).catch(() => undefined);
        void AsyncStorage.removeItem(checkoutKey(previous)).catch(() => undefined);
      }
      userIdRef.current = null;
      lastSeenRef.current = null;
      pendingRef.current = null;
      checkoutOpenRef.current = false;
      setPendingCheckout(null);
      stopWatching();
      celebratedRef.current = null;
      setWelcome(null);
      setSubscription(null);
      setKnown(false);
      knownRef.current = false;
      setLoading(false);
      return;
    }
    // Before the fetch, and outside it: `load` keeps a stable identity (its deps are all stable), so it
    // cannot take a `userId` dependency without making the AppState listener below re-subscribe on
    // every change. It reads the id back through `userIdRef` instead.
    userIdRef.current = userId;
    void hydrateFromCache(userId);
    load();
  }, [userId, load, hydrateFromCache, stopWatching]);

  // Re-read whenever the app comes back to the foreground. Checkout happens in an
  // external browser, so the moment Pro actually unlocks is a moment this app is not
  // in front of the user — without this the gold ring and the lifted quota waited for
  // a relaunch. Keyed on AppState rather than screen focus because the provider sits
  // above the navigator, and because returning from the browser is the case that matters.
  //
  // A checkout in flight is watched instead: the poll confirms on its first tick, and keeps
  // asking only while the app is in front. While its browser is still open the paywall starts
  // that watch itself when the browser closes.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (next) => {
      // Reconcile pending payments when returning to foreground (e.g. from checkout browser)
      if (next === 'active') {
        if (checkoutOpenRef.current) return;
        if (!watchPayment(true)) void load(true);
      } else if (next === 'background') {
        stopWatching();
      }
    });
    return () => sub.remove();
  }, [userId, load, watchPayment, stopWatching]);

  const week = useMemo(() => freeWeek(subscription), [subscription]);
  const value = useMemo<SubscriptionState>(
    () => ({
      subscription,
      isPro: subscription?.isActive ?? false,
      isGift: Boolean(subscription?.isGift),
      known,
      loading,
      trialRemaining: subscription?.trialGenerationsRemaining ?? DEFAULT_TRIAL_TOTAL,
      trialTotal: subscription?.trialGenerationsTotal ?? DEFAULT_TRIAL_TOTAL,
      freeRemaining: week?.left ?? DEFAULT_TRIAL_TOTAL,
      freePerWeek: week?.total ?? DEFAULT_TRIAL_TOTAL,
      freeBack: week?.back ?? FREE_RESET_FALLBACK,
      boughtRemaining: subscription?.isActive ? 0 : subscription?.boughtTranscriptionsRemaining ?? 0,
      boughtTotal: subscription?.boughtTranscriptionsTotal ?? 0,
      refresh: (reconcile = true) => load(reconcile),
      pendingCheckout,
      paymentCheck,
      beginCheckout,
      watchPayment,
      abandonCheckout,
    }),
    [
      subscription,
      week,
      known,
      loading,
      load,
      pendingCheckout,
      paymentCheck,
      beginCheckout,
      watchPayment,
      abandonCheckout,
    ],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
      <ProWelcomeModal welcome={welcome} onClose={() => setWelcome(null)} />
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside SubscriptionProvider');
  return ctx;
}
