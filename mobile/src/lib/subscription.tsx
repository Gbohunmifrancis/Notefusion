import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { billingApi } from '../api/endpoints';
import { useAuth } from './auth';
import type { Subscription } from '../api/types';

interface SubscriptionState {
  /** The server's answer, or null for "no subscription OR we don't know yet". */
  subscription: Subscription | null;
  /**
   * Whether to show Pro treatment. Deliberately `?? false`: an account whose
   * state we could not read is a **Free** account. Every premium perk — the gold
   * avatar ring, the Pro badge, the hidden Subscription tab — gates on this, so
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
  /** Re-reads the server. Called after a checkout completes. */
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionState | undefined>(undefined);

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
    } catch {
      // Network down, 5xx, expired session mid-refresh — all resolve to Free.
      // `known` stays false so quota gates keep failing open.
      if (!mounted.current) return;
      setSubscription(null);
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
      setLoading(false);
      return;
    }
    load();
  }, [userId, load]);

  const value = useMemo<SubscriptionState>(
    () => ({
      subscription,
      isPro: subscription?.isActive ?? false,
      known,
      loading,
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
