/**
 * The single HTTP entry point. Everything the dashboard fetches goes through `request`,
 * which owns three things the pages should not each reimplement: the bearer header, the
 * `ApiError` envelope, and one silent refresh-and-retry on a 401.
 */

import type { ApiErrorBody, TokenPairResponse } from "@/api/types";
import { clearSession, getAccessToken, getRefreshToken, setTokens } from "@/lib/session";

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
  }

  return fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * Refresh is serialised through this promise. Without it, a dashboard that fires five
 * requests on mount would send five refreshes, and since refresh tokens are single-use
 * and rotating, four of them would fail and log the admin out mid-load.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;

      const response = await send("/api/auth/refresh", {
        method: "POST",
        body: { refreshToken },
        anonymous: true,
      });
      if (!response.ok) return false;

      const pair = (await response.json()) as TokenPairResponse;
      setTokens(pair.accessToken, pair.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);

  if (response.status === 401 && !options.anonymous) {
    if (await refreshTokens()) {
      response = await send(path, options);
    } else {
      clearSession();
      onSessionExpired();
      throw await parseError(response);
    }
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
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
