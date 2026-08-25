import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onSessionExpired } from '../api/client';
import { authApi, meApi } from '../api/endpoints';
import { tokenStore } from '../lib/tokenStore';
import { registerForPushAsync } from '../lib/push';
import { googleAuthConfigured } from '../lib/env';
import { getGoogleIdToken } from '../lib/googleSignin';
import type { AuthUser } from '../api/types';

interface AuthState {
  user: AuthUser | null;
  initializing: boolean;
  /**
   * Whether this account may reach the admin screens.
   *
   * Compared against `'Admin'` with that exact casing. `AuthUserDto.Role` is a
   * plain `string` built from `user.Role.ToString()`, so the camelCase enum
   * converter never touches it and the wire value is PascalCase. `'admin'`
   * would hide the whole surface and read as a routing bug.
   *
   * A courtesy gate, not the boundary: every admin route is behind the server's
   * Admin policy and answers 403 regardless of what this says.
   */
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Registers the account and returns the server's normalised email. Deliberately
   * does NOT sign anyone in: there is no session until verifyEmail runs, so the
   * caller's job is to route to the code screen with the email this resolves to.
   */
  signUp: (fullName: string, email: string, password: string) => Promise<string>;
  /** Exchanges a sign-up code for the session, and signs in on success. */
  verifyEmail: (email: string, code: string) => Promise<void>;
  /** Signs in with Google. Serves both first-time and returning users. */
  signInWithGoogle: () => Promise<void>;
  /**
   * Runs the Google consent prompt and returns a fresh ID token WITHOUT touching
   * the current session. Used to re-prove identity for a destructive action (account
   * deletion) on a Google-only account, which has no password to re-verify. Resolves
   * to null if the user backs out of the prompt.
   */
  reauthWithGoogle: () => Promise<string | null>;
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

      // The cached user is a snapshot taken at sign-in, so a role granted since
      // then — `Seed:AdminEmails` promotes a matching account at API startup —
      // would stay invisible until a full re-login. Re-read the profile once,
      // after initializing has already cleared so this never delays first paint,
      // and correct only what actually differs.
      if (!cached || !refresh) return;
      try {
        const me = await meApi.get();
        if (!mounted.current) return;
        if (
          me.role !== cached.role ||
          me.fullName !== cached.fullName ||
          me.email !== cached.email
        ) {
          const fresh: AuthUser = {
            id: me.id,
            fullName: me.fullName,
            email: me.email,
            role: me.role,
          };
          setUserState(fresh);
          tokenStore.saveUser(fresh).catch(() => undefined);
        }
      } catch {
        // Offline, or a session the refresh interceptor is about to fail — either
        // way onSessionExpired owns that outcome. The cached user stands.
      }
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

  /**
   * Runs the Google consent prompt and returns the raw ID token, or null if the
   * user backs out. Shared by sign-in and by destructive-action re-auth, so the
   * availability guard lives in exactly one place.
   */
  async function promptGoogleIdToken(forceAccountPicker = false): Promise<string | null> {
    if (!googleAuthConfigured) {
      throw new Error('Google sign-in is not available in this build.');
    }
    return getGoogleIdToken({ forceAccountPicker });
  }

  const value = useMemo<AuthState>(
    () => ({
      user,
      initializing,
      isAdmin: user?.role === 'Admin',
      async signIn(email, password) {
        const res = await authApi.login(email, password);
        await tokenStore.saveLastAuthMethod('email');
        await persistSession(res.accessToken, res.refreshToken, res.user);
      },
      async signUp(fullName, email, password) {
        const res = await authApi.register(fullName, email, password);
        // Remembered here rather than after verification: if the app dies on the code
        // screen, the next launch should still offer the email button they last used.
        await tokenStore.saveLastAuthMethod('email');
        return res.email;
      },
      async verifyEmail(email, code) {
        const res = await authApi.verifyEmail(email, code);
        await persistSession(res.accessToken, res.refreshToken, res.user);
      },
      /**
       * Opens Google's consent screen and exchanges the returned ID token for a
       * NoteFusion session. Awaited end-to-end rather than handled in an effect
       * so a failure rejects here and the calling screen can show it inline —
       * an effect would swallow the error and leave a spinner running forever.
       *
       * A cancelled or dismissed prompt resolves without a session and without
       * throwing: backing out of the consent screen is a choice, not an error.
       */
      async signInWithGoogle() {
        const idToken = await promptGoogleIdToken();
        if (!idToken) return;

        const session = await authApi.google(idToken);
        await tokenStore.saveLastAuthMethod('google');
        await persistSession(
          session.accessToken,
          session.refreshToken,
          session.user,
        );
      },
      async reauthWithGoogle() {
        // Force the chooser: the SDK would otherwise hand back the cached account
        // silently, and this is the proof-of-identity step before a deletion.
        return promptGoogleIdToken(true);
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
