import {
  getAnalytics,
  logEvent,
  logScreenView as fbLogScreenView,
  setUserId as fbSetUserId,
  setUserProperty as fbSetUserProperty,
  type Analytics,
} from '@react-native-firebase/analytics';
import { logAppEvent } from './appEvents';

/**
 * Centralized Google Analytics / Firebase Analytics service.
 * Safe-wrapped: will never crash UI if native modules are not linked or running in development.
 *
 * Every event and screen logged here also goes to our own server (lib/appEvents), which is what the admin console
 * reads; Firebase is never read there. So params must stay what appEvents allows: ids, kinds, counts, screen names and
 * error codes, never anything the person wrote, sang or named.
 */

/** Firebase-only names: their first-party twin is logged beside them under the name the console already reads. */
const NOT_MIRRORED = new Set([
  'listen_anywhere_setting',
  'listen_anywhere_take',
  'listen_anywhere_take_recovered',
  'data_saver',
  'keep_all_offline',
]);

let analyticsInstance: Analytics | null = null;

function getSafeAnalytics(): Analytics | null {
  if (analyticsInstance) return analyticsInstance;
  try {
    analyticsInstance = getAnalytics();
    return analyticsInstance;
  } catch (error) {
    if (__DEV__) {
      console.log('[Analytics] Firebase Analytics instance unavailable:', error);
    }
    return null;
  }
}

/**
 * Log a screen transition. Called automatically by NavigationContainer onStateChange.
 */
export async function logScreenView(screenName: string, screenClassOverride?: string): Promise<void> {
  logAppEvent('screen_view', { screen: screenName });
  try {
    if (__DEV__) {
      console.log(`[Analytics] Screen: ${screenName}`);
    }
    const inst = getSafeAnalytics();
    if (!inst) return;
    await fbLogScreenView(inst, {
      screen_name: screenName,
      screen_class: screenClassOverride ?? screenName,
    });
  } catch (err) {
    if (__DEV__) console.warn('[Analytics] Failed to log screen view:', err);
  }
}

/**
 * Identify a user in Google Analytics / Firebase.
 * Passing null clears the user ID on sign out.
 */
export async function setAnalyticsUserId(userId: string | null): Promise<void> {
  try {
    if (__DEV__) {
      console.log(`[Analytics] Set UserId: ${userId}`);
    }
    const inst = getSafeAnalytics();
    if (!inst) return;
    await fbSetUserId(inst, userId);
  } catch (err) {
    if (__DEV__) console.warn('[Analytics] Failed to set user id:', err);
  }
}

/**
 * Set custom user property (e.g. plan, role, language).
 */
export async function setAnalyticsUserProperty(name: string, value: string | null): Promise<void> {
  try {
    if (__DEV__) {
      console.log(`[Analytics] Set Property ${name}: ${value}`);
    }
    const inst = getSafeAnalytics();
    if (!inst) return;
    await fbSetUserProperty(inst, name, value);
  } catch (err) {
    if (__DEV__) console.warn('[Analytics] Failed to set user property:', err);
  }
}

/**
 * Log a generic custom event with parameters.
 */
export async function logAnalyticsEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): Promise<void> {
  if (!NOT_MIRRORED.has(name)) logAppEvent(name, params);
  try {
    if (__DEV__) {
      console.log(`[Analytics] Event ${name}:`, params);
    }
    const inst = getSafeAnalytics();
    if (!inst) return;
    logEvent(inst, name, params);
  } catch (err) {
    if (__DEV__) console.warn(`[Analytics] Failed to log event "${name}":`, err);
  }
}

// ── Common Business Events ───────────────────────────────────────────────────

export async function logSignUp(method: 'email' | 'google'): Promise<void> {
  try {
    const inst = getSafeAnalytics();
    if (!inst) return;
    logEvent(inst, 'sign_up', { method });
  } catch (err) {
    if (__DEV__) console.warn('[Analytics] Failed to log sign up:', err);
  }
}

export async function logLogin(method: 'email' | 'google'): Promise<void> {
  try {
    const inst = getSafeAnalytics();
    if (!inst) return;
    logEvent(inst, 'login', { method });
  } catch (err) {
    if (__DEV__) console.warn('[Analytics] Failed to log login:', err);
  }
}

export async function logTranscriptionStarted(source: 'mic' | 'file'): Promise<void> {
  await logAnalyticsEvent('transcription_started', { source });
}

export async function logTranscriptionCompleted(params?: {
  durationSec?: number;
  solfaKey?: string;
  notesCount?: number;
}): Promise<void> {
  await logAnalyticsEvent('transcription_completed', params);
}

export async function logSolfaRekeyed(params: {
  fromKey: string;
  toKey: string;
}): Promise<void> {
  await logAnalyticsEvent('solfa_rekeyed', params);
}

export async function logExport(format: 'musicxml' | 'midi' | 'pdf' | 'solfa'): Promise<void> {
  await logAnalyticsEvent('score_exported', { format });
}

export async function logPaywallViewed(source?: string): Promise<void> {
  await logAnalyticsEvent('paywall_viewed', source ? { source } : undefined);
}

export async function logSubscriptionPurchased(params: {
  plan: string;
  priceMinor?: number;
  currency?: string;
}): Promise<void> {
  await logAnalyticsEvent('subscription_purchased', params);
}
