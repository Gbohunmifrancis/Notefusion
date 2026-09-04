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
import type { Subscription } from '../api/types';

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
   * Free transcriptions left, from the server. Falls back to the full allowance while
   * unknown, for the same fail-open reason as `known`: a dropped billing request must
   * not read as "0 left" and block the microphone. Gates pair it with `known`.
   */
  trialRemaining: number;
  /** The free allowance, so copy can say "2 of 5" without repeating the 5. */
  trialTotal: number;
  /** Re-reads the server. Called after a checkout completes, or a generation succeeds. */
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState | undefined>(undefined);

/**
 * Only used before the server has answered. The real number always comes from the
 * server (`FreeTier.TrialGenerationsFor`), and it is regional — 5 in Nigeria, 10
 * elsewhere — so no single value here can be right for everyone. Deliberately the
 * smaller one: this placeholder exists to keep a dropped request from looking like an
 * exhausted trial, and under-promising corrects upward, which reads as a bonus rather
 * than as a trial that shrank.
 */
const DEFAULT_TRIAL_TOTAL = 5;

/**
 * Where the last successful answer is kept, per account, so a cold start can paint Pro before the
 * billing service has replied. Not SecureStore: that is reserved for bearer credentials, and this is
 * a cosmetic head start, not a capability — the server is still the only thing that grants anything.
 *
 * Per-user, because a handset is shared and one account's paid status must never be read for another.
 */
const cacheKey = (userId: string) => `@notefusion_sub:${userId}`;
const trackerKey = (userId: string) => `@notefusion_sub_tracker:${userId}`;

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
 * Owns "is this account premium?" for the whole app.
 *
 * Before this existed the question was answered four different ways — the profile
 * badge read `role`, the record screen made its own `mySubscription()` call on every
 * tap, the paywall read `isActive`, and the tab bar didn't ask at all — so the same
 * account could look Pro in one place and Free in another. Billing state now has
 * exactly one reader, and everything else consumes this hook.
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sub = await billingApi.mySubscription();
      if (!mounted.current) return;
      setSubscription(sub);
      setKnown(true);
      knownRef.current = true;

      const id = userIdRef.current;
      const prev = lastSeenRef.current;
      const currentIsActive = sub.isActive;
      const currentIsGift = Boolean(sub.isGift);

      // Only check state transitions when we have an existing known baseline
      if (prev !== null) {
        if (!prev.isActive && currentIsActive) {
          if (currentIsGift) {
            haptics.play('success');
            showDialog({
              title: "Pro Access Gifted! 🎁",
              message:
                "An administrator has gifted you NoteFusion Pro access! Enjoy unlimited transcriptions, full staff notation, and priority processing.",
              icon: "gift-outline",
              tone: "premium",
            });
          } else {
            haptics.play('success');
            showDialog({
              title: "Welcome to NoteFusion Pro! 🎉",
              message:
                "Your payment has been confirmed and your Pro subscription is now active. Enjoy unlimited transcriptions and premium exports!",
              icon: "sparkles",
              tone: "premium",
            });
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
  }, []);

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
      const [rawSub, rawTracker] = await Promise.all([
        AsyncStorage.getItem(cacheKey(id)),
        AsyncStorage.getItem(trackerKey(id)),
      ]);
      if (rawTracker) {
        lastSeenRef.current = JSON.parse(rawTracker);
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
  }, []);

  useEffect(() => {
    if (!userId) {
      // Signed out — drop the previous account's state entirely, cache included: the paid status of
      // an account nobody is signed into has no business surviving on the handset.
      const previous = userIdRef.current;
      if (previous) {
        void AsyncStorage.removeItem(cacheKey(previous)).catch(() => undefined);
        void AsyncStorage.removeItem(trackerKey(previous)).catch(() => undefined);
      }
      userIdRef.current = null;
      lastSeenRef.current = null;
      setSubscription(null);
      setKnown(false);
      knownRef.current = false;
      setLoading(false);
      return;
    }
    // Before the fetch, and outside it: `load` is `useCallback(…, [])` for a stable identity, so it
    // cannot take a `userId` dependency without making the AppState listener below re-subscribe on
    // every change. It reads the id back through `userIdRef` instead.
    userIdRef.current = userId;
    void hydrateFromCache(userId);
    load();
  }, [userId, load, hydrateFromCache]);

  // Re-read whenever the app comes back to the foreground. Checkout happens in an
  // external browser, so the moment Pro actually unlocks is a moment this app is not
  // in front of the user — without this the gold ring and the lifted quota waited for
  // a relaunch. Keyed on AppState rather than screen focus because the provider sits
  // above the navigator, and because returning from the browser is the case that matters.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') load();
    });
    return () => sub.remove();
  }, [userId, load]);

  const value = useMemo<SubscriptionState>(
    () => ({
      subscription,
      isPro: subscription?.isActive ?? false,
      isGift: Boolean(subscription?.isGift),
      known,
      loading,
      trialRemaining: subscription?.trialGenerationsRemaining ?? DEFAULT_TRIAL_TOTAL,
      trialTotal: subscription?.trialGenerationsTotal ?? DEFAULT_TRIAL_TOTAL,
      refresh: load,
    }),
    [subscription, known, loading, load],
  );

  return (
    <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used inside SubscriptionProvider');
  return ctx;
}
