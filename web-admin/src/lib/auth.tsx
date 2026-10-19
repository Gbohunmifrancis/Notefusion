/**
 * Who is signed in, and the two operations that change that.
 *
 * The admin check happens here at sign-in as well as on the server. The server is the
 * boundary — it enforces the Admin policy on every analytics request — but a non-admin who
 * signs in successfully would otherwise land on a dashboard where every panel reports 403.
 * Telling them plainly that the account lacks access is the honest failure.
 */

"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { setSessionExpiredHandler } from "@/api/client";
import {
  getMyProfile,
  getPasskeyLoginOptions,
  lockConsoleSession,
  login,
  logout,
  passkeyLogin,
} from "@/api/endpoints";
import type { AuthUser, LoginResponse } from "@/api/types";
import { getAdminPass, resetAdminLock } from "@/lib/adminLock";
import {
  clearSession,
  getRefreshToken,
  getStoredUser,
  isAdmin,
  setTokens,
  storeUser,
} from "@/lib/session";
import { assertionToJson, toRequestOptions } from "@/lib/webauthn";

interface AuthContextValue {
  user: AuthUser | null;
  /**
   * False until the stored session has been read. `user === null` means two different things
   * before and after that — "nobody is signed in" and "we have not looked yet" — and a route
   * guard that cannot tell them apart bounces every signed-in admin to /login on load.
   */
  ready: boolean;
  /**
   * The operator's own profile picture, or null while it is loading, absent, or unreachable.
   * The login payload does not carry it — it is shared with the mobile client — so it comes
   * from `GET /api/me` instead.
   */
  avatarUrl: string | null;
  signIn: (email: string, password: string, remember?: boolean) => Promise<void>;
  /**
   * Signs in with a passkey: asks the API for options, runs `navigator.credentials.get`, and trades
   * the assertion for the same token pair the password returns. `conditional` runs it as the email
   * field's autofill instead of a prompt; abort `signal` to withdraw that offer.
   */
  signInWithPasskey: (options?: PasskeySignInOptions) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface PasskeySignInOptions {
  conditional?: boolean;
  signal?: AbortSignal;
  /** "Keep me signed in". A function is read when the session is stored, not when the offer starts. */
  remember?: boolean | (() => boolean);
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  /*
   * Seeded in an effect rather than from `useState(getStoredUser)`.
   *
   * Under Vite the initialiser was right: localStorage is synchronous and there was no server
   * render to disagree with. Next renders this component once in Node, where the initialiser
   * would return null, and hydration then compares that against a client tree built from a
   * live session — a mismatch React resolves by throwing the server HTML away. Reading storage
   * after mount costs one extra paint and is the only version that is correct in both places.
   */
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    setUser(getStoredUser());
    setReady(true);
  }, []);

  // Fetched once per signed-in session, and allowed to fail silently: an avatar is decoration,
  // and the initials it falls back to are a correct answer rather than an error state.
  useEffect(() => {
    if (!user) {
      setAvatarUrl(null);
      return;
    }
    const controller = new AbortController();
    getMyProfile(controller.signal)
      .then((profile) => setAvatarUrl(profile.profilePictureUrl))
      .catch(() => undefined);
    return () => controller.abort();
  }, [user]);

  useEffect(() => {
    // The API client cannot navigate; it reports an unrecoverable session and this does.
    setSessionExpiredHandler(() => {
      resetAdminLock();
      setUser(null);
      router.replace("/login");
    });
    return () => setSessionExpiredHandler(() => undefined);
  }, [router]);

  /** Keeps a session the API issued — for an admin only — whichever way it was earned. */
  const accept = useCallback(async (response: LoginResponse, remember: boolean) => {
    if (!isAdmin(response.user)) {
      // Revoke the refresh token we were just issued rather than leaving a live one
      // behind for an account that will not be allowed to use it.
      try {
        await logout(response.refreshToken);
      } catch {
        // Nothing was stored locally, so a failed revoke changes nothing on this side.
      }
      throw new Error("This account does not have admin access.");
    }

    setTokens(response.accessToken, response.refreshToken, remember);
    storeUser(response.user);
    setUser(response.user);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string, remember = true) => {
      await accept(await login(email, password), remember);
    },
    [accept],
  );

  const signInWithPasskey = useCallback(
    async ({ conditional = false, signal, remember = true }: PasskeySignInOptions = {}) => {
      const options = await getPasskeyLoginOptions(signal);
      const credential = (await navigator.credentials.get({
        publicKey: toRequestOptions(options),
        ...(conditional ? { mediation: "conditional" as CredentialMediationRequirement } : {}),
        ...(signal ? { signal } : {}),
      })) as PublicKeyCredential | null;
      if (!credential) throw new DOMException("No passkey was chosen.", "NotAllowedError");

      const keep = typeof remember === "function" ? remember() : remember;
      await accept(await passkeyLogin(assertionToJson(credential)), keep);
    },
    [accept],
  );

  const signOut = useCallback(async () => {
    // The console's pass ends with the session, and nothing is left waiting behind the lock.
    const pass = getAdminPass();
    resetAdminLock();
    if (pass) {
      try {
        await lockConsoleSession(pass);
      } catch {
        // It also lapses by itself after 5 minutes unused.
      }
    }
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await logout(refreshToken);
      } catch {
        // Signing out locally must succeed even when the network does not.
      }
    }
    clearSession();
    setUser(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, avatarUrl, signIn, signInWithPasskey, signOut }),
    [user, ready, avatarUrl, signIn, signInWithPasskey, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside an AuthProvider.");
  return context;
}
