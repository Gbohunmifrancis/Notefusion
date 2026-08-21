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
import { billingApi } from '../api/endpoints';
import { useAuth } from './auth';
import type { Subscription } from '../api/types';

interface SubscriptionState {
  /** The server's answer, or null for "no subscription OR we don't know yet". */
  subscription: Subscription | null;
  /**
   * Whether to show Pro treatment. Deliberately `?? false`: an account whose
   * state we could not read is a **Free** account. Every premium perk — the gold
   * avatar ring, the Pro badge, the Premium tab label — gates on this, so
   * a failed request can never hand out a paid look.
   */
  isPro: boolean;
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
 * server (`FreeTier.TrialGenerations`); this is the optimistic placeholder that keeps
 * a dropped request from looking like an exhausted trial.
 */
const DEFAULT_TRIAL_TOTAL = 5;

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

  useEffect(() => {
    if (!userId) {
      // Signed out — drop the previous account's state entirely.
      setSubscription(null);
      setKnown(false);
      knownRef.current = false;
      setLoading(false);
      return;
    }
    load();
  }, [userId, load]);

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
