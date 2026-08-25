import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { devicesApi } from '../api/endpoints';
import { colors } from '../design/theme';
import { isExpoGo } from './env';

/**
 * Expo push registration and the two user-facing notification preferences.
 *
 * `expo-notifications` is imported lazily (via require) rather than at the top of
 * the module: in Expo Go (SDK 53+) importing it runs push-token auto-registration
 * that throws, so on Expo Go we skip loading it entirely. Push works normally in
 * dev/production builds.
 *
 * ── Why the preferences live here ─────────────────────────────────────────────
 * The Settings switches used to write `@notefusion_push` / `@notefusion_sound` to
 * AsyncStorage and nothing ever read them, so turning push "off" changed nothing.
 * The flags now sit next to the notification handler that consumes them, and they
 * are cached in module scope because `handleNotification` runs on every incoming
 * notification — an AsyncStorage round-trip per banner would be a waste.
 */

const PUSH_KEY = '@notefusion_push';
const SOUND_KEY = '@notefusion_sound';
const ASKED_KEY = '@notefusion_push_asked';

/** Both default to on, matching the switches' initial state. */
let pushOn = true;
let soundOn = true;
/** Whether the record screen's `offerBackgroundAlerts` has had its one turn. */
let asked = false;
let prefsLoaded: Promise<void> | null = null;

/**
 * Reads the stored preferences once. Awaited by `handleNotification` so a
 * notification arriving before the user has visited Settings still respects a
 * choice made in a previous session.
 */
export function loadNotificationPrefs(): Promise<void> {
  if (!prefsLoaded) {
    prefsLoaded = (async () => {
      try {
        const [push, sound, wasAsked] = await AsyncStorage.multiGet([
          PUSH_KEY,
          SOUND_KEY,
          ASKED_KEY,
        ]);
        if (push[1] !== null) pushOn = push[1] === 'true';
        if (sound[1] !== null) soundOn = sound[1] === 'true';
        asked = wasAsked[1] === 'true';
      } catch {
        // Unreadable preferences just mean the defaults.
      }
    })();
  }
  return prefsLoaded;
}

export function pushEnabled(): boolean {
  return pushOn;
}

export function soundEnabled(): boolean {
  return soundOn;
}

/** Silences (or restores) banners without touching the OS permission. */
export async function setPushEnabled(on: boolean): Promise<void> {
  pushOn = on;
  await AsyncStorage.setItem(PUSH_KEY, String(on)).catch(() => undefined);
}

export async function setSoundEnabled(on: boolean): Promise<void> {
  soundOn = on;
  await AsyncStorage.setItem(SOUND_KEY, String(on)).catch(() => undefined);
}

// Foreground presentation: show a banner even while the app is open — unless the
// user turned notifications off. This handler is the thing that makes both
// switches real. Installed once at module load, but only outside Expo Go.
if (!isExpoGo) {
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      await loadNotificationPrefs();
      return {
        shouldShowAlert: pushOn,
        shouldShowBanner: pushOn,
        shouldShowList: pushOn,
        shouldPlaySound: pushOn && soundOn,
        shouldSetBadge: false,
      };
    },
  });
}

/**
 * Whether this build can receive remote push at all, and what the OS says.
 *
 * `unsupported` is a real answer, not an error: Expo Go dropped remote push in
 * SDK 53 and simulators have no push hardware. The Settings row says so instead
 * of showing a switch that cannot work.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function getPushPermission(): Promise<PushPermission> {
  if (isExpoGo || !Device.isDevice) return 'unsupported';
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    if (status === 'undetermined') return 'undetermined';
    return 'denied';
  } catch {
    return 'unsupported';
  }
}

/**
 * Turns notifications on: asks the OS if it hasn't been asked, then registers the
 * token with the API. Returns the resulting permission so the caller can show the
 * blocked state rather than leaving a switch that silently snaps back.
 */
export async function enablePush(): Promise<PushPermission> {
  const current = await getPushPermission();
  if (current === 'unsupported' || current === 'denied') return current;

  const token = await registerForPushAsync({ force: true });
  if (!token) return getPushPermission();

  await setPushEnabled(true);
  return 'granted';
}

/**
 * Whether the app has already offered notifications of its own accord.
 *
 * Nothing outside Settings used to force the permission prompt, so a user who
 * never opened Settings → Notifications had no token on the server and the
 * background-completion push had nowhere to go. The first transcription submit
 * now offers it — once. Call {@link loadNotificationPrefs} first; it hydrates
 * this alongside the two switches in a single read.
 */
export function pushPermissionAsked(): boolean {
  return asked;
}

export async function markPushPermissionAsked(): Promise<void> {
  asked = true;
  await AsyncStorage.setItem(ASKED_KEY, 'true').catch(() => undefined);
}

/**
 * Turns notifications off, on this device and on the server.
 *
 * Muting the handler alone is not enough: it only affects a foregrounded app, and the
 * whole point of these notifications is to arrive while the app is closed. So we also
 * drop the token server-side. Best-effort — if the call fails the local switch still
 * applies, and `registerForPushAsync` will not re-register without `force`.
 */
export async function disablePush(): Promise<void> {
  await setPushEnabled(false);
  if (isExpoGo) return;
  try {
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    await Notifications.dismissAllNotificationsAsync();

    if (Device.isDevice) {
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      const { data: token } = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      await devicesApi.unregister(token).catch(() => undefined);
    }
  } catch {
    // Nothing to dismiss, no notifications module, or the token could not be read —
    // the local mute already applied, which is what the user asked for.
  }
}

/**
 * Registers this device for push. Entirely best-effort: a denied permission or a
 * simulator (no push hardware) just returns null without throwing.
 *
 * Called on every sign-in, so it honours the user's own switch — without `force`
 * it will not re-register a device whose owner turned notifications off, and it
 * never triggers a permission prompt at login. `force` is for the Settings switch,
 * where the user explicitly asked for this.
 */
export async function registerForPushAsync(
  opts: { force?: boolean } = {},
): Promise<string | null> {
  if (isExpoGo) return null; // Remote push unsupported in Expo Go (SDK 53+).
  if (!Device.isDevice) return null; // Push tokens need real hardware.

  await loadNotificationPrefs();
  if (!pushOn && !opts.force) return null;

  const Notifications = require('expo-notifications') as typeof import('expo-notifications');

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    // Only prompt when the user asked for this. A silent login should never raise
    // a system dialog they didn't initiate.
    if (!opts.force) return null;
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Transcriptions',
      importance: Notifications.AndroidImportance.DEFAULT,
      // The light palette's accent, read from the plain export: this is a module,
      // so no hook is available, and the notification LED is an OS surface that
      // has no idea which theme the app is in anyway.
      lightColor: colors.accent,
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  const token = tokenResponse.data;

  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  await devicesApi.register(token, platform).catch(() => undefined);

  return token;
}
