import { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appApi } from '../api/endpoints';
import { showDialog } from './dialog';
import type { AppVersionInfo } from '../api/types';

/**
 * "There's a newer version in the store" — the in-app half of it.
 *
 * ── Why the app cannot work this out for itself ───────────────────────────────
 * Nothing on the device knows what the store carries. `expo-updates` knows about *OTA*
 * updates, which is a different thing entirely: a JS patch shipped over `eas update`
 * changes no build number and needs no store visit, so asking it would prompt for the
 * wrong thing. So the server holds the answer (`AppRelease__LatestBuild`) and this asks it.
 *
 * ── Builds, never version strings ────────────────────────────────────────────
 * `"1.10.0" < "1.9.0"` lexically, so comparing the names would stop prompting at 1.10.
 * `nativeBuildVersion` is the monotonic integer EAS assigns under
 * `appVersionSource: remote`, and it is the only thing compared here.
 *
 * ── Fails open, always ───────────────────────────────────────────────────────
 * Any network error, non-200, or unparseable body means no prompt. The blocking state is
 * exactly where a fail-*closed* bug would be unrecoverable — an undismissable dialog
 * raised by a server hiccup, on a build that is perfectly fine, with no way past it.
 */

/** Snooze on the soft prompt, keyed by the build it was about. */
const SNOOZE_KEY = '@notefusion_update_snooze';

/**
 * Long enough that "Later" means later, short enough that a release still lands within a
 * week. Two prompts a week is the ceiling this sets.
 */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/** How often a long-lived session re-asks. A release is not urgent to the minute. */
const RECHECK_MS = 60 * 60 * 1000;

export type UpdateState = 'none' | 'soft' | 'blocked';

/** This build, or 0 when the native module has nothing to say (Expo Go, web). */
function currentBuild(): number {
  return Number(Application.nativeBuildVersion ?? 0) || 0;
}

/**
 * What, if anything, to say about the installed build. Never rejects.
 *
 * A `build` of 0 means the platform would not tell us. Treated as up to date rather than
 * hopelessly behind: guessing "behind" there would hard-block every Expo Go session the
 * moment a minimum was set, and the store cannot help a client that has no build number.
 */
export async function checkForUpdate(): Promise<{ state: UpdateState; info: AppVersionInfo } | null> {
  const build = currentBuild();
  if (build <= 0) return null;

  let info: AppVersionInfo;
  try {
    info = await appApi.version();
  } catch {
    return null;
  }

  if (typeof info?.latestBuild !== 'number') return null;

  if (info.minimumBuild > 0 && build < info.minimumBuild) {
    return { state: 'blocked', info };
  }
  if (info.latestBuild > 0 && build < info.latestBuild) {
    return { state: 'soft', info };
  }
  return { state: 'none', info };
}

/** The store page for this platform, or null when none is configured. */
function storeUrl(info: AppVersionInfo): string | null {
  const url = Platform.OS === 'ios' ? info.iosStoreUrl : info.androidStoreUrl;
  return url && url.length > 0 ? url : null;
}

async function openStore(info: AppVersionInfo): Promise<void> {
  const url = storeUrl(info);
  if (!url) return;
  await Linking.openURL(url).catch(() => undefined);
}

/**
 * Opens the store listing, asking the server where it is.
 *
 * What a tap on the update notification means. Deliberately not `promptForUpdateIfNeeded` — that
 * respects the snooze, and a user who just tapped "NoteFusion 1.2 is out" has already decided;
 * showing them a dialog asking the same question again, or nothing at all because they pressed
 * Later yesterday, would both be wrong.
 */
export async function openStoreListing(): Promise<void> {
  try {
    await openStore(await appApi.version());
  } catch {
    // No answer from the server means no URL to open. Nothing useful to say about it.
  }
}

/**
 * Whether the soft prompt for `build` is still snoozed.
 *
 * Keyed on the build, so a *newer* release re-prompts immediately instead of inheriting the
 * snooze the previous one earned — the case that matters, because the reason to ship twice
 * in three days is usually that the first one was broken.
 */
async function isSnoozed(build: number): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const { build: forBuild, until } = JSON.parse(raw) as { build?: number; until?: number };
    return forBuild === build && typeof until === 'number' && Date.now() < until;
  } catch {
    return false;
  }
}

async function snooze(build: number): Promise<void> {
  await AsyncStorage.setItem(
    SNOOZE_KEY,
    JSON.stringify({ build, until: Date.now() + SNOOZE_MS }),
  ).catch(() => undefined);
}

/**
 * Checks, and prompts if there is something to say. Safe to call repeatedly — the snooze and
 * the caller's own throttle keep it quiet.
 */
export async function promptForUpdateIfNeeded(): Promise<void> {
  const checked = await checkForUpdate();
  if (!checked || checked.state === 'none') return;

  const { state, info } = checked;
  const notes = info.releaseNotes?.trim();

  if (state === 'blocked') {
    // No cancel, no backdrop dismiss, back button dead. The only way on is the store, which
    // is the truth of the situation: this build is below what the server will serve.
    showDialog({
      title: 'Update required',
      message:
        notes ||
        'This version of NoteFusion is no longer supported. Update to keep transcribing.',
      icon: 'arrow-up-circle-outline',
      blocking: true,
      actions: [{ label: 'Update now', icon: 'open-outline', onPress: () => void openStore(info) }],
    });
    return;
  }

  if (await isSnoozed(info.latestBuild)) return;

  showDialog({
    title: `NoteFusion ${info.latestVersion} is here`,
    message: notes || 'A new version is available with the latest fixes and improvements.',
    icon: 'sparkles-outline',
    actions: [
      { label: 'Update now', icon: 'open-outline', onPress: () => void openStore(info) },
      { label: 'Later', style: 'cancel', onPress: () => void snooze(info.latestBuild) },
    ],
  });
}

/**
 * Runs the check once the app is usable, and again when it returns to the foreground.
 *
 * The foreground re-check is what reaches a session that stays open for days: without it a
 * user who never fully closes the app would only ever see the prompt they saw on install.
 * Throttled to {@link RECHECK_MS} so a user flicking between apps does not hammer the endpoint.
 *
 * @param ready Whether the splash is done and a real screen is up. Not "signed in": a build below
 * the minimum is rejected at sign-in, so the login screen is where such a user ends up and where
 * the dialog most needs to reach them. A dialog over the splash reads as a crash.
 */
export function useAppUpdatePrompt(ready: boolean): void {
  const lastCheck = useRef(0);

  useEffect(() => {
    if (!ready) return;

    const run = () => {
      const now = Date.now();
      if (now - lastCheck.current < RECHECK_MS) return;
      lastCheck.current = now;
      void promptForUpdateIfNeeded();
    };

    run();

    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') run();
    });
    return () => sub.remove();
  }, [ready]);
}
