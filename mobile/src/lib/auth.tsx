import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onSessionExpired } from '../api/client';
import { authApi, meApi } from '../api/endpoints';
import { tokenStore } from '../lib/tokenStore';
import { registerForPushAsync, unregisterPushAsync } from '../lib/push';
import * as Listen from '../../modules/notefusion-listen';
import { googleAuthConfigured } from '../lib/env';
import { getGoogleIdToken } from '../lib/googleSignin';
import {
  setAnalyticsUserId,
  setAnalyticsUserProperty,
  logLogin,
  logSignUp,
} from '../lib/analytics';
import type { AuthUser } from '../api/types';
import { bindOfflineLibrary, clearOfflineLibrary } from '../lib/offlineLibrary';
import { bindOutbox, clearOutbox } from '../lib/outbox';
import { drainPendingTakes } from '../lib/listenAnywhereBridge';

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
      if (cached && refresh && mounted.current) {
        setUserState(cached);
        void setAnalyticsUserId(cached.id);
        void setAnalyticsUserProperty('user_role', cached.role);
      }
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
          void setAnalyticsUserProperty('user_role', fresh.role);
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

  // The offline library and the send queue belong to one account: bound to whoever is signed in, and
  // an index or a queue left by another account is deleted before anything of it is shown.
  useEffect(() => {
    if (initializing) return;
    void bindOfflineLibrary(user?.id ?? null);
    // Then any take "Listen from anywhere" recorded that never reached its headless task (the process died in
    // between) joins the queue.
    void bindOutbox(user?.id ?? null).then(() => {
      if (user?.id) void drainPendingTakes();
    });
    Listen.setAccount(Boolean(user?.id));
  }, [user?.id, initializing]);

  useEffect(() => onSessionExpired(() => {
    // The server has already refused the refresh token and the pair is cleared, so the push token
    // cannot be unregistered from here: that authenticated call would only 401 into this handler
    // again. The microphone, at least, belongs to the session that just ended.
    Listen.stop();
    void setAnalyticsUserId(null);
    setUserState(null);
  }), []);

  async function persistSession(
    accessToken: string,
    refreshToken: string,
    authed: AuthUser,
  ) {
    await tokenStore.save(accessToken, refreshToken);
    await tokenStore.saveUser(authed);
    setUserState(authed);
    void setAnalyticsUserId(authed.id);
    void setAnalyticsUserProperty('user_role', authed.role);
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
        await tokenStore.saveLastEmail(res.user.email).catch(() => undefined);
        await persistSession(res.accessToken, res.refreshToken, res.user);
        void logLogin('email');
      },
      async signUp(fullName, email, password) {
        const res = await authApi.register(fullName, email, password);
        // Remembered here rather than after verification: if the app dies on the code
        // screen, the next launch should still offer the email button they last used.
        await tokenStore.saveLastAuthMethod('email');
        await tokenStore.saveLastEmail(res.email).catch(() => undefined);
        void logSignUp('email');
        return res.email;
      },
      async verifyEmail(email, code) {
        const res = await authApi.verifyEmail(email, code);
        await persistSession(res.accessToken, res.refreshToken, res.user);
        void logLogin('email');
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
        void logLogin('google');
      },
      async reauthWithGoogle() {
        // Force the chooser: the SDK would otherwise hand back the cached account
        // silently, and this is the proof-of-identity step before a deletion.
        return promptGoogleIdToken(true);
      },
      async signOut() {
        // Both before the tokens go: the listener belongs to this session, and unregistering the
        // push token is an authenticated call. Neither failure stops the sign-out.
        Listen.stop();
        await unregisterPushAsync();
        const refresh = await tokenStore.getRefresh();
        if (refresh) await authApi.logout(refresh).catch(() => undefined);
        await tokenStore.clear();
        // Saved-sheet copies and queued recordings are this account's; the hymn pack is public and stays.
        await Promise.all([clearOfflineLibrary(), clearOutbox()]).catch(() => undefined);
        void setAnalyticsUserId(null);
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
