/**
 * The single HTTP entry point. Everything the dashboard fetches goes through `request`,
 * which owns what the pages should not each reimplement: the bearer header, the
 * `ApiError` envelope, one silent refresh-and-retry on a 401, and the console lock's pass
 * (src/lib/adminLock.ts): sent on admin calls, held while locked, and one retry once the
 * admin has unlocked or confirmed it is them.
 */

import type { ApiErrorBody, TokenPairResponse } from "@/api/types";
import {
  ADMIN_SESSION_HEADER,
  getAdminPass,
  holdsWhileLocked,
  isLockExemptPath,
  lockConsole,
  needsPassHeader,
  requestConfirmation,
  setAdminPass,
  tryReopen,
  waitForUnlock,
} from "@/lib/adminLock";
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  isRemembered,
  setTokens,
} from "@/lib/session";

/**
 * Required, with no fallback.
 *
 * The Vite build had a same-origin escape hatch — it threw only in dev, because the
 * production bundle was served out of the API's own `wwwroot` where relative paths were
 * exactly right. The dashboard now deploys to Vercel and the API lives on another origin,
 * so an unset value is a blank console rather than a working one. `next.config.ts` asserts
 * it at build time so a misconfigured deploy fails the build instead of shipping.
 */
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

/** A failed API call, carrying the server's error code so callers can branch on it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string[]> | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.code ?? "UNKNOWN";
    this.details = body?.details ?? null;
  }
}

/** Set when the session is unrecoverable, so the router can bounce to /login. */
export type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => undefined;
export const setSessionExpiredHandler = (handler: SessionExpiredHandler) => {
  onSessionExpired = handler;
};

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  /** Skip the bearer header and the refresh retry. Used by login and refresh themselves. */
  anonymous?: boolean;
  signal?: AbortSignal;
  /** The console pass to send instead of the one held: ending a pass the console just let go of. */
  adminPass?: string;
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    return new ApiError(response.status, (await response.json()) as ApiErrorBody);
  } catch {
    // A CORS rejection, a proxy error page, or a 500 with no body all land here.
    return new ApiError(response.status, null);
  }
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  if (!options.anonymous) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const pass = options.adminPass ?? getAdminPass();
    if (pass && needsPassHeader(path)) headers[ADMIN_SESSION_HEADER] = pass;
  }

  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * What a refresh came to. Only the server saying no (400/401) ends the session; a network
 * failure, a 5xx or a 429 says nothing about the refresh token, so it is kept for the next try.
 */
type RefreshOutcome = "refreshed" | "rejected" | "unavailable";

/**
 * Refresh is serialised through this promise. Without it, a dashboard that fires five
 * requests on mount would send five refreshes, and since refresh tokens are single-use
 * and rotating, four of them would fail and log the admin out mid-load.
 */
let refreshInFlight: Promise<RefreshOutcome> | null = null;

function refreshTokens(): Promise<RefreshOutcome> {
  refreshInFlight ??= (async (): Promise<RefreshOutcome> => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return "rejected";

      let response: Response;
      try {
        response = await send("/api/auth/refresh", {
          method: "POST",
          body: { refreshToken },
          anonymous: true,
        });
      } catch {
        return "unavailable";
      }
      if (response.status === 400 || response.status === 401) {
        // Another tab may have rotated the token while this one was asking: its new pair is
        // already in storage, and the request can go again with it instead of signing out.
        const latest = getRefreshToken();
        return latest && latest !== refreshToken ? "refreshed" : "rejected";
      }
      if (!response.ok) return "unavailable";

      const pair = (await response.json()) as TokenPairResponse;
      // Keep the store the admin chose at sign-in ("Remember me" or this tab only).
      setTokens(pair.accessToken, pair.refreshToken, isRemembered());
      return "refreshed";
    } catch {
      return "unavailable";
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * The console lock's two refusals. `ADMIN_LOCKED`: lock the console and send the call again once
 * the admin unlocks. `ADMIN_CONFIRM_REQUIRED`: ask the admin to confirm it is them and send it again;
 * a cancelled prompt fails the call. Either way, one retry only.
 */
async function sendPastLock(path: string, options: RequestOptions): Promise<Response> {
  if (holdsWhileLocked(path)) await waitForUnlock();
  const response = await send(path, options);
  if (response.status !== 403 || options.anonymous || isLockExemptPath(path)) return response;

  const refusal = await parseError(response.clone());
  if (refusal.code === "ADMIN_LOCKED") {
    // A remembered browser opens the console again without asking (lib/consoleTrust); otherwise lock and ask.
    if (await tryReopen()) return send(path, options);
    lockConsole("required");
    await waitForUnlock();
    return send(path, options);
  }
  if (refusal.code === "ADMIN_CONFIRM_REQUIRED") {
    if (await requestConfirmation()) return send(path, options);
    // The server's sentence is written for the phone ("your fingerprint or face").
    throw new ApiError(403, { code: refusal.code, message: "Confirm it’s you to do that." });
  }
  return response;
}

/**
 * Opens a server-sent event stream (the live notices' feed, `src/lib/liveFeed.ts`) with the bearer token and console
 * pass any other call carries. The response is the caller's to read; nothing here retries or refreshes.
 */
export function openStream(path: string, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const pass = getAdminPass();
  if (pass && needsPassHeader(path)) headers[ADMIN_SESSION_HEADER] = pass;
  return fetch(`${BASE_URL}${path}`, { headers, signal, cache: "no-store" });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await respond(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** As `request`, for a file the API serves (a session recording's video piece): the body as a Blob. */
export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  return (await respond(path, options)).blob();
}

/** The bearer, the console pass and one refresh-and-retry; anything but a 2xx is thrown as an ApiError. */
async function respond(path: string, options: RequestOptions): Promise<Response> {
  let response = await sendPastLock(path, options);

  if (response.status === 401 && !options.anonymous) {
    const outcome = await refreshTokens();
    if (outcome === "refreshed") {
      response = await sendPastLock(path, options);
    } else if (outcome === "unavailable") {
      throw new ApiError(0, {
        code: "NETWORK",
        message: "We couldn't reach the server. Check your connection and try again.",
      });
    } else {
      clearSession();
      onSessionExpired();
      throw await parseError(response);
    }
  }

  // A sign-in hands an admin the console's first pass in this header (exposed by CORS).
  const pass = response.headers.get(ADMIN_SESSION_HEADER);
  if (pass) setAdminPass(pass);

  if (!response.ok) throw await parseError(response);
  return response;
}

/** Builds a query string, dropping empty values so the server sees its own defaults. */
export function query(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}
