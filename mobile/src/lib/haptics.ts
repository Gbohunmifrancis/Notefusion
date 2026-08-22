import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback, behind a preference the user can turn off.
 *
 * ── Why the flag is cached in module scope ────────────────────────────────────
 * A haptic fires on *every* press, so reading AsyncStorage per tap would land the
 * buzz after the finger has already lifted. The flag is therefore held in module
 * state and hydrated once, exactly as `push.ts` caches its two switches — and for
 * the same reason its comment records: a preference that is written but never read
 * is a switch that does nothing.
 *
 * The read is kicked off at module load rather than from the boot gate. This module
 * is imported by `components/Touchable.tsx`, so it is evaluated while the bundle is
 * still coming up — many seconds before anyone can tap anything. Someone who turned
 * haptics off would at worst feel one stray tick if they beat AsyncStorage to it,
 * which is not worth threading another promise through `useAppReady`.
 *
 * ── Why every call is swallowed ───────────────────────────────────────────────
 * Not every device has a vibrator, and the native call rejects when there is none.
 * A missing buzz is cosmetic; a press handler that throws is not. So `play` returns
 * void, never rejects, and is safe to call from a render-time event handler without
 * an `await` or a `.catch`.
 */

const HAPTICS_KEY = '@notefusion_haptics';

/** Defaults to on, matching the Settings switch's initial state. */
let hapticsOn = true;
let prefLoaded: Promise<void> | null = null;

/**
 * Reads the stored preference once. Started immediately below; exported so
 * SettingsScreen can await it before painting the switch and avoid showing "on"
 * for a frame when the stored value is off.
 */
export function loadHapticPref(): Promise<void> {
  if (!prefLoaded) {
    prefLoaded = (async () => {
      try {
        const stored = await AsyncStorage.getItem(HAPTICS_KEY);
        if (stored !== null) hapticsOn = stored === 'true';
      } catch {
        // Unreadable preference just means the default.
      }
    })();
  }
  return prefLoaded;
}

export function hapticsEnabled(): boolean {
  return hapticsOn;
}

export async function setHapticsEnabled(on: boolean): Promise<void> {
  hapticsOn = on;
  await AsyncStorage.setItem(HAPTICS_KEY, String(on)).catch(() => undefined);
}

/**
 * The vocabulary of feedback this app uses, named for the *meaning* rather than the
 * waveform so call sites read as intent:
 *
 *  light   — every ordinary tap: buttons, tab items, list rows, chips.
 *  medium  — the deliberate ones: the centre mic, record start/stop.
 *  success — something completed: saved to library, transcription ready, Pro unlocked.
 *  warning — something destructive is about to happen: sign out, delete.
 *  none    — opt out for a control where a buzz would be noise.
 */
export type HapticKind = 'light' | 'medium' | 'success' | 'warning' | 'none';

/**
 * Fire a haptic. Fire-and-forget: no return value to await, no error to handle.
 *
 * Web has no equivalent worth emulating — the Vibration API is a blunt buzz that
 * feels nothing like a UIImpactFeedbackGenerator tick — so it is skipped outright.
 */
export function play(kind: HapticKind): void {
  if (kind === 'none' || !hapticsOn || Platform.OS === 'web') return;

  const run =
    kind === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : kind === 'warning'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        : Haptics.impactAsync(
            kind === 'medium'
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
          );

  run.catch(() => undefined); // No vibrator, or the OS declined. Cosmetic either way.
}

// Hydrate on import — see the note at the top of the file.
void loadHapticPref();
