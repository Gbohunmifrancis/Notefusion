import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import { tokenStore } from '../lib/tokenStore';
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

const baseURL: string = getBaseUrl();

export const api: AxiosInstance = axios.create({
  baseURL,
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

// Endpoints that must never carry a (possibly stale) Bearer token or trigger the
// refresh dance — they ARE the auth flow.
const AUTH_FREE = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'];

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }
  if (!AUTH_FREE.some((p) => config.url?.startsWith(p))) {
    const token = await tokenStore.getAccess();
    if (token) config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

/** Rotate the token pair exactly once even under concurrent 401s. */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await tokenStore.getRefresh();
    if (!refreshToken) return null;
    try {
      const { data } = await axios.post<TokenPairResponse>(
        `${baseURL}/api/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );
      await tokenStore.save(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      await tokenStore.clear();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

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
  (r) => r,
  async (error: AxiosError<ApiError>) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;

    const isRetryableAuth =
      status === 401 &&
      original &&
      !original._retried &&
      !AUTH_FREE.some((p) => original.url?.startsWith(p));

    if (isRetryableAuth) {
      original!._retried = true;
      const fresh = await refreshAccessToken();
      if (fresh) {
        original!.headers.set('Authorization', `Bearer ${fresh}`);
        return api(original!);
      }
      sessionExpiredListeners.forEach((fn) => fn());
    }

    return Promise.reject(error);
  },
);

/** Normalize any thrown axios error into the API's ApiError envelope. */
export function toApiError(err: unknown): ApiError {
  const ax = err as AxiosError<ApiError>;
  if (ax?.response?.data?.message) return ax.response.data;
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
  return { code: 'UNKNOWN', message: ax?.message || 'Something went wrong. Please try again.' };
}
