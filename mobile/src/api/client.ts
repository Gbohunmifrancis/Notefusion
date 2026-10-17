import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { getDeviceId } from '../lib/deviceId';
import { tokenStore } from '../lib/tokenStore';
import { reportReachable } from '../lib/reachability';
import type { ApiError, TokenPairResponse } from './types';

/**
 * The single axios instance the whole app talks through.
 *
 * Two interceptors implement the JWT lifecycle against the C# API:
 *  - request: attach the current access token as a Bearer header.
 *  - response: on a 401, transparently rotate via POST /api/auth/refresh
 *    (rotating refresh tokens, TRD) and replay the original request once.
 *    Concurrent 401s share a single in-flight refresh so we never rotate twice.
 */

// Base URL resolution, in priority order:
//  1. EXPO_PUBLIC_API_URL — explicit environment variable override.
//  2. Expo Go dynamic host IP — auto-detect dev machine LAN IP from Constants.expoConfig.hostUri.
//  3. app.json extra.apiBaseUrl — default fallback (10.0.2.2 for Android emulator).
function getBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  const extraUrl = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl;
  if (extraUrl && (extraUrl.startsWith('https://') || extraUrl.includes('herokuapp.com'))) {
    return extraUrl;
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:5080`;
    }
  }
  return extraUrl ?? 'http://10.0.2.2:5080';
}

export const baseURL: string = getBaseUrl();

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

// Endpoints that must never carry a (possibly stale) Bearer token or trigger the
// refresh dance — they ARE the auth flow.
const AUTH_FREE = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/google',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

/**
 * 401 codes the API returns for a wrong password on an authenticated route (delete-account's
 * re-authentication, change-password's current password). The access token was fine, so a refresh
 * would only rotate the pair and replay the request — a replayed DELETE, at that.
 */
const BUSINESS_401 = new Set(['AUTH_REAUTHENTICATION_REQUIRED', 'AUTH_INVALID_CREDENTIALS']);

/** The device's IANA zone, read once; undefined where Intl cannot say (the server then assumes Lagos). */
const timeZone: string | undefined = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
})();

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  // On every request, including the auth ones: the server reads it on submit to share the free
  // trial across accounts on one handset, and on the subscription query so the count the paywall
  // shows matches the count it enforces. Memoised, so this is one native read per launch.
  const deviceId = await getDeviceId();
  if (deviceId) config.headers.set('X-Device-Id', deviceId);
  // The phone's time zone, so practice streaks run on the singer's own calendar (Africa/Lagos when absent).
  if (timeZone) config.headers.set('X-Time-Zone', timeZone);

  if (!AUTH_FREE.some((p) => config.url?.startsWith(p))) {
    const token = await tokenStore.getAccess();
    if (token) config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

let refreshInFlight: Promise<RefreshOutcome> | null = null;

/**
 * - `fresh`: rotated; replay with the new access token.
 * - `expired`: the server refused the refresh token (400/401), or there is none — the session is over.
 * - `unreachable`: network error, timeout, 429 or 5xx — the session may be fine, so tokens are kept
 *   and the original request fails as a connection error.
 */
type RefreshOutcome =
  | { kind: 'fresh'; accessToken: string }
  | { kind: 'expired' }
  | { kind: 'unreachable' };

/** Rotate the token pair exactly once even under concurrent 401s. */
function refreshAccessToken(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async (): Promise<RefreshOutcome> => {
    try {
      const refreshToken = await tokenStore.getRefresh();
      if (!refreshToken) return { kind: 'expired' };
      const { data } = await axios.post<TokenPairResponse>(
        `${baseURL}/api/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' }, timeout: 25_000 },
      );
      await tokenStore.save(data.accessToken, data.refreshToken);
      return { kind: 'fresh', accessToken: data.accessToken };
    } catch (e) {
      const status = (e as AxiosError)?.response?.status;
      if (status === 400 || status === 401) {
        await tokenStore.clear().catch(() => undefined);
        return { kind: 'expired' };
      }
      return { kind: 'unreachable' };
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

// Fired when refresh fails hard — the AuthProvider subscribes to force a logout.
type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();
export function onSessionExpired(fn: Listener): () => void {
  sessionExpiredListeners.add(fn);
  return () => sessionExpiredListeners.delete(fn);
}

api.interceptors.response.use(
  (r) => {
    // Any answer at all means the API is reachable: the offline library and the send queue listen.
    reportReachable(true);
    return r;
  },
  async (error: AxiosError<ApiError>) => {
    // No answer (no network, DNS, a dropped connection, a timeout) is "offline"; any answer is not.
    if (!axios.isCancel(error)) reportReachable(!!error.response);
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;

    const isRetryableAuth =
      status === 401 &&
      original &&
      !original._retried &&
      !AUTH_FREE.some((p) => original.url?.startsWith(p)) &&
      !BUSINESS_401.has(error.response?.data?.code ?? '');

    if (isRetryableAuth) {
      original!._retried = true;
      const outcome = await refreshAccessToken();
      if (outcome.kind === 'fresh') {
        original!.headers.set('Authorization', `Bearer ${outcome.accessToken}`);
        return api(original!);
      }
      if (outcome.kind === 'expired') {
        sessionExpiredListeners.forEach((fn) => fn());
      } else {
        // The refresh never got an answer: report the original call as a connection failure
        // (toApiError reads a response-less error as offline), not as a 401 to sign out over.
        return Promise.reject(Object.assign(error, { response: undefined }));
      }
    }

    return Promise.reject(error);
  },
);

/** Normalize any thrown axios error into the API's ApiError envelope. */
/**
 * Text a person should never read: a server fault, a provider's reply, a database or stack detail.
 * The API's messages for expected failures are written for people and pass through untouched.
 */
const TECHNICAL =
  /\b(exception|stack|sql|npgsql|postgres|database|entity framework|null reference|object reference|returned \d{3}|status code|http \d{3}|bachs|paystack|flutterwave|squad|resend|traceback|internal server|[A-Z]{3,}_[A-Z_]{3,})/i;

/** A failure reason fit to show: the text itself when it is written for people, the fallback otherwise. */
export function safeReason(text: string | null | undefined, fallback: string): string {
  const t = (text ?? "").trim();
  return t.length > 0 && !TECHNICAL.test(t) ? t : fallback;
}

export function toApiError(err: unknown): ApiError {
  const ax = err as AxiosError<ApiError>;
  const data = ax?.response?.data;
  const status = ax?.response?.status ?? 0;
  if (data?.message && (status >= 500 || TECHNICAL.test(data.message))) {
    if (__DEV__) console.warn("[api]", status, data.code, data.message);
    return {
      code: data.code ?? "SERVER_ERROR",
      message: /^BILLING_/.test(data.code ?? "")
        ? "We couldn't open the payment page just now. Please try again in a minute."
        : "Something went wrong on our side. Please try again in a moment.",
    };
  }
  if (data?.message) return data;
  if (ax?.response?.status === 415) {
    return { code: 'UNSUPPORTED_MEDIA', message: 'Unsupported audio format. Please re-record.' };
  }
  if (ax?.response?.status === 422) {
    return { code: 'INVALID_AUDIO', message: 'No clear notes detected. Sing or play louder.' };
  }
  if (ax?.code === 'ECONNABORTED') {
    return { code: 'NETWORK_TIMEOUT', message: 'The request timed out. Check your connection.' };
  }
  if (ax?.request && !ax.response) {
    return { code: 'NETWORK_OFFLINE', message: 'Could not reach the server. Are you online?' };
  }
  return { code: 'UNKNOWN', message: 'Something went wrong. Please try again.' };
}
