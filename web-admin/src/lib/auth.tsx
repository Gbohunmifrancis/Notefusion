/**
 * Who is signed in, and the two operations that change that.
 *
 * The admin check happens here at sign-in as well as on the server. The server is the
 * boundary — it enforces the Admin policy on every analytics request — but a non-admin who
 * signs in successfully would otherwise land on a dashboard where every panel reports 403.
 * Telling them plainly that the account lacks access is the honest failure.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { setSessionExpiredHandler } from "@/api/client";
import { login, logout } from "@/api/endpoints";
import type { AuthUser } from "@/api/types";
import {
  clearSession,
  getRefreshToken,
  getStoredUser,
  isAdmin,
  setTokens,
  storeUser,
} from "@/lib/session";

interface AuthContextValue {
  user: AuthUser | null;
  signIn: (email: string, password: string, remember?: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seeded from storage so a refresh does not bounce a signed-in admin to /login.
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const navigate = useNavigate();

  useEffect(() => {
    // The API client cannot navigate; it reports an unrecoverable session and this does.
    setSessionExpiredHandler(() => {
      setUser(null);
      navigate("/login", { replace: true });
    });
    return () => setSessionExpiredHandler(() => undefined);
  }, [navigate]);

  const signIn = useCallback(async (email: string, password: string, remember = true) => {
    const response = await login(email, password);

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

  const signOut = useCallback(async () => {
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
    navigate("/login", { replace: true });
  }, [navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, signIn, signOut }),
    [user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside an AuthProvider.");
  return context;
}
