import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { adminApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { clearAdminData } from "./adminCache";
import {
  LOCKED,
  PROMPT,
  isUnlocked,
  lockMethod,
  lockReducer,
  type LockEvent,
  type LockMethod,
  type LockState,
} from "./adminLock";

/**
 * The admin lock at run time (board f-admin/10). The rules are `lib/adminLock` (pure, tested); this holds the one
 * lock for the app, asks the phone's own lock through expo-local-authentication (Android's BiometricPrompt, Face ID
 * with the passcode behind it), and keeps Admin off screenshots and the app switcher with expo-screen-capture.
 *
 * Both are native modules that ship with the store build. They are required lazily and only when present, so a
 * build without them finds Admin locked behind the account password rather than crashing.
 */

type LocalAuth = typeof import("expo-local-authentication");
type ScreenCapture = typeof import("expo-screen-capture");

function localAuth(): LocalAuth | null {
  try {
    return require("expo-local-authentication") as LocalAuth;
  } catch {
    return null;
  }
}

function screenCapture(): ScreenCapture | null {
  try {
    return require("expo-screen-capture") as ScreenCapture;
  } catch {
    return null;
  }
}

let state: LockState = LOCKED;
const listeners = new Set<() => void>();

function dispatch(event: LockEvent): void {
  const next = lockReducer(state, event);
  if (next === state) return;
  const wasOpen = state.unlockedAt !== null;
  state = next;
  // Locked again: nothing admin stays in memory.
  if (wasOpen && next.unlockedAt === null) clearAdminData();
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Locks Admin now and drops what it read: sign-out, an account change. */
export function lockAdmin(): void {
  dispatch({ type: "lock" });
}

/** Whether Admin is open at this moment. */
export function adminUnlocked(): boolean {
  return isUnlocked(state, Date.now());
}

/** How this phone opens Admin: its fingerprint or face, its PIN alone, or (no screen lock) the account password. */
export async function readLockMethod(): Promise<LockMethod> {
  const la = localAuth();
  if (!la) return lockMethod({ available: false, hasHardware: false, level: 0 });
  try {
    const [hasHardware, level] = await Promise.all([la.hasHardwareAsync(), la.getEnrolledLevelAsync()]);
    return lockMethod({ available: true, hasHardware, level: Number(level) });
  } catch {
    return lockMethod({ available: false, hasHardware: false, level: 0 });
  }
}

/**
 * Asks the phone's own lock. `reason` is the prompt's title ("Unlock Admin", or the action being confirmed). True
 * when the person proved it is them; false when they cancelled or the phone said no.
 */
export async function askPhoneLock(reason: string = PROMPT.promptMessage): Promise<boolean> {
  const la = localAuth();
  if (!la) return false;
  try {
    const result = await la.authenticateAsync({
      promptMessage: reason,
      promptSubtitle: PROMPT.promptSubtitle,
      promptDescription: reason === PROMPT.promptMessage ? PROMPT.promptDescription : undefined,
      cancelLabel: "Cancel",
      // The phone's PIN, pattern or password behind "Use PIN": never a PIN of ours.
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

/** Opens Admin with the phone's lock. */
export async function unlockWithPhone(): Promise<boolean> {
  const ok = await askPhoneLock();
  if (ok) dispatch({ type: "unlock", at: Date.now() });
  return ok;
}

/** Opens Admin on a phone with no screen lock: the account password, checked by the server. Null when it opened. */
export async function unlockWithPassword(password: string): Promise<string | null> {
  try {
    await adminApi.confirmPassword(password);
    dispatch({ type: "unlock", at: Date.now() });
    return null;
  } catch (e) {
    return toApiError(e).message;
  }
}

/**
 * The second ask before a destructive action (Suspend, End subscription, Revoke Pro, Change role, a feature flag):
 * the phone's lock once more. On a phone with no lock the sheet asked for the password instead, so this passes it
 * on and lets the server check it. Null when confirmed; otherwise a sentence to show, or "" when cancelled.
 */
export async function confirmAgain(reason: string, method: LockMethod, password?: string): Promise<string | null> {
  if (method === "password") {
    if (!password) return "Enter your password to confirm.";
    try {
      await adminApi.confirmPassword(password);
      return null;
    } catch (e) {
      return toApiError(e).message;
    }
  }
  return (await askPhoneLock(reason)) ? null : "";
}

/** The lock's state for a component, re-read when it changes and once a second while away. */
export function useAdminLock(): { unlocked: boolean; method: LockMethod | null } {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const [method, setMethod] = useState<LockMethod | null>(null);
  useEffect(() => {
    let live = true;
    void readLockMethod().then((m) => live && setMethod(m));
    return () => {
      live = false;
    };
  }, []);
  return { unlocked: isUnlocked(snapshot, Date.now()), method };
}

/**
 * While Admin is on screen: the away clock (5 minutes in the background, or out of Admin, locks it), a blank cover
 * whenever the app is not in front (so the app switcher never shows a figure), and no screenshots. Returns whether
 * the cover is up.
 */
export function useAdminPresence(): boolean {
  const [away, setAway] = useState(AppState.currentState !== "active");

  useEffect(() => {
    // Back into Admin: the clock that started when it was left is read now.
    dispatch({ type: "foreground", at: Date.now() });
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        dispatch({ type: "foreground", at: Date.now() });
        setAway(false);
      } else {
        dispatch({ type: "background", at: Date.now() });
        setAway(true);
      }
    });

    const sc = screenCapture();
    const key = "nf-admin";
    void sc?.preventScreenCaptureAsync(key).catch(() => undefined);
    if (Platform.OS === "ios") void sc?.enableAppSwitcherProtectionAsync?.().catch(() => undefined);

    return () => {
      sub.remove();
      // Leaving Admin starts the same 5 minutes as leaving the app.
      dispatch({ type: "background", at: Date.now() });
      void sc?.allowScreenCaptureAsync(key).catch(() => undefined);
      if (Platform.OS === "ios") void sc?.disableAppSwitcherProtectionAsync?.().catch(() => undefined);
    };
  }, []);

  return away;
}
