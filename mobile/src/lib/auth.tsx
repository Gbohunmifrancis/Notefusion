import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onSessionExpired } from '../api/client';
import { authApi } from '../api/endpoints';
import { tokenStore } from '../lib/tokenStore';
import { registerForPushAsync } from '../lib/push';
import type { AuthUser } from '../api/types';

interface AuthState {
  user: AuthUser | null;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: AuthUser) => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Owns the session. On boot it reads the cached user (a valid token pair implies
 * a live session; the axios refresh interceptor repairs an expired access token
 * on the first authed call). A hard refresh failure calls signOut via the
 * onSessionExpired bridge, so a dead session can never strand the user on a
 * logged-in screen.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const cached = await tokenStore.getUser();
      const refresh = await tokenStore.getRefresh();
      if (cached && refresh && mounted.current) setUserState(cached);
      if (mounted.current) setInitializing(false);
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => onSessionExpired(() => setUserState(null)), []);

  async function persistSession(
    accessToken: string,
    refreshToken: string,
    authed: AuthUser,
  ) {
    await tokenStore.save(accessToken, refreshToken);
    await tokenStore.saveUser(authed);
    setUserState(authed);
    // Best-effort push registration once we have a session — never blocks login.
    registerForPushAsync().catch(() => undefined);
  }

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      async signIn(email, password) {
        const res = await authApi.login(email, password);
        await persistSession(res.accessToken, res.refreshToken, res.user);
      },
      async signUp(fullName, email, password) {
        const res = await authApi.register(fullName, email, password);
        await persistSession(res.accessToken, res.refreshToken, res.user);
      },
      async signOut() {
        const refresh = await tokenStore.getRefresh();
        if (refresh) await authApi.logout(refresh).catch(() => undefined);
        await tokenStore.clear();
        setUserState(null);
      },
      setUser: (u) => {
        setUserState(u);
        tokenStore.saveUser(u).catch(() => undefined);
      },
    }),
    [user, initializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
