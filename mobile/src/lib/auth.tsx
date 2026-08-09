import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import { onSessionExpired } from '../api/client';
import { authApi } from '../api/endpoints';
import { tokenStore } from '../lib/tokenStore';
import { registerForPushAsync } from '../lib/push';
import { googleAuth, googleAuthConfigured, isExpoGo } from '../lib/env';
import type { AuthUser } from '../api/types';

// expo-auth-session needs the browser warm so the redirect back can close the tab.
WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  user: AuthUser | null;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<void>;
  /** Signs in with Google. Serves both first-time and returning users. */
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (u: AuthUser) => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Stands in for a real client ID on a build that has none.
 *
 * expo-auth-session asserts the current platform's client ID while *building*
 * the request, inside its own useMemo — so on a build with empty IDs it throws
 * during render and takes the whole app down at launch, rather than merely
 * leaving the button dead. Hooks cannot be called conditionally, so we always
 * build a request and refuse to prompt one that isn't real; googleAuthConfigured
 * guards both the buttons and signInWithGoogle. Shaped like a genuine ID because
 * the native redirect URI is derived from it.
 */
const UNCONFIGURED_CLIENT_ID = 'unconfigured.apps.googleusercontent.com';


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

  // Google OAuth. We ask for an ID token rather than an access token because
  // that is what the API validates (POST /api/auth/google → GoogleTokenValidator);
  // an access token would need a second round-trip to Google's userinfo endpoint.
  // Client IDs come from app.json extra — see lib/env.
  // The response slot is unused: signInWithGoogle awaits the prompt's own result
  // instead, so the token exchange stays inside the call that started it.
  // Redirect URI strategy:
  // - Expo Go: use the Expo auth proxy (https://auth.expo.io/@fransix66/notefusion).
  //   This is a stable HTTPS URI registered in Google Cloud Console.
  //   expo-auth-session v5+ dropped `useProxy`; we pass it as `native` to override the
  //   dynamic exp://IP:port URI that Google rejects with Error 400 invalid_request.
  // - Standalone / dev builds: use the notefusion:// native scheme.
  const redirectUri = makeRedirectUri(
    isExpoGo
      ? { native: 'https://auth.expo.io/@fransix66/notefusion' }
      : { scheme: 'notefusion' },
  );

  const [googleReq, , googlePrompt] = Google.useIdTokenAuthRequest({
    iosClientId: googleAuth.iosClientId || undefined,
    androidClientId: googleAuth.androidClientId || undefined,
    // Falls back to the placeholder so an unconfigured build boots — see above.
    clientId: googleAuth.webClientId || UNCONFIGURED_CLIENT_ID,
    redirectUri,
  });

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
        // The request above is built from a placeholder ID on an unconfigured
        // build, so it exists but must never reach Google's servers.
        if (!googleAuthConfigured) {
          throw new Error('Google sign-in is not configured in this build.');
        }
        if (!googleReq) throw new Error('Google sign-in is not available yet.');

        const res = await googlePrompt();
        if (res.type !== 'success') return;

        const idToken = res.params.id_token;
        if (!idToken) throw new Error('Google did not return an ID token.');

        const session = await authApi.google(idToken);
        await persistSession(
          session.accessToken,
          session.refreshToken,
          session.user,
        );
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
    [user, initializing, googleReq, googlePrompt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
