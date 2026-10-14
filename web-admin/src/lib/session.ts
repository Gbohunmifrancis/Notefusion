/**
 * Session storage for the admin dashboard.
 *
 * Tokens live in localStorage. That is a deliberate, bounded trade: a refresh token in
 * localStorage is readable by any script that manages to run on this origin, so the
 * mitigation is that this origin serves nothing but this app — no user content, no
 * third-party embeds, no analytics scripts. The alternative (httpOnly cookies) would
 * need the API to issue and rotate cookies, which it does not do, and would add CSRF
 * surface to a POST-based auth flow.
 *
 * It is also why the console stays a client-rendered app under Next: a session the server
 * cannot read is a session `middleware` cannot gate on, so the route guard is
 * `src/app/(console)/layout.tsx` and every page is a client component. Next is here for
 * the routing, the layouts and the deploy target, not for server rendering.
 *
 * The stored user is a convenience for rendering the sidebar and gating the route. It is
 * not a security boundary: the server checks the Admin policy on every request, and a
 * user who edits localStorage to say "Admin" gets a 403 from the API, not data.
 */

import type { AuthUser } from "@/api/types";

const ACCESS = "nf_admin_access";
const REFRESH = "nf_admin_refresh";
const USER = "nf_admin_user";
/** Remembers which store the tokens went into, so reads and clears hit the same one. */
const PERSIST = "nf_admin_persist";

/**
 * Where the session lives. "Remember me" writes to localStorage, which survives the
 * browser closing; leaving it unchecked writes to sessionStorage, which is wiped when
 * the tab closes. The choice itself is a small flag in localStorage so a page reload in
 * the same tab knows which store to read without guessing.
 *
 * Null during a server render. A client component is still rendered once on the server, so
 * every caller here has to tolerate "no storage yet" rather than throw on `localStorage`.
 */
function store(): Storage | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PERSIST) === "0" ? sessionStorage : localStorage;
}

/** Read a key from whichever store the tokens were written to. */
function read(key: string): string | null {
  return store()?.getItem(key) ?? null;
}

export const getAccessToken = () => read(ACCESS);
export const getRefreshToken = () => read(REFRESH);

/** True unless the admin signed in without "Remember me" (the tokens then live in sessionStorage). */
export function isRemembered(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(PERSIST) !== "0";
}

/** `remember` defaults to true so `setTokens(a, r)` keeps its old persist-forever behaviour. */
export function setTokens(access: string, refresh: string, remember = true) {
  if (typeof window === "undefined") return;

  // Persist the choice first so store() resolves to the intended backend, then clear the
  // other store to avoid a stale token lingering where it will never be read.
  localStorage.setItem(PERSIST, remember ? "1" : "0");
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(ACCESS);
  other.removeItem(REFRESH);
  other.removeItem(USER);

  const target = store();
  target?.setItem(ACCESS, access);
  target?.setItem(REFRESH, refresh);
}

export function storeUser(user: AuthUser) {
  store()?.setItem(USER, JSON.stringify(user));
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = read(USER);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    // A corrupted entry means "not signed in", not a crash on boot.
    return null;
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;

  // Clear both stores unconditionally: the persist flag can be out of step with reality
  // (e.g. after toggling remember-me), and a half-cleared session is worse than a slow one.
  for (const s of [localStorage, sessionStorage]) {
    s.removeItem(ACCESS);
    s.removeItem(REFRESH);
    s.removeItem(USER);
  }
  localStorage.removeItem(PERSIST);
}

/**
 * Read from the login response's `user.role`, not by decoding the JWT. The token writes
 * the role under the long `ClaimTypes.Role` URI, so client-side decoding invites reading
 * the wrong key and concluding the user is not an admin when they are.
 */
export const isAdmin = (user: AuthUser | null) => user?.role === "Admin";
