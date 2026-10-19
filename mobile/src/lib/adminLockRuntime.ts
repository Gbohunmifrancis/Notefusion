import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { adminApi } from "../api/endpoints";
import { setAdminSessionHooks, toApiError } from "../api/client";
import type { AdminCodeSent, AdminPhoneSetUp } from "../api/types";
import { clearAdminData } from "./adminCache";
import { tokenStore } from "./tokenStore";
import {
  LOCKED,
  PROMPT,
  idleExpired,
  isUnlocked,
  lockMethod,
  lockReducer,
  type LockEvent,
  type LockMethod,
  type LockState,
} from "./adminLock";

/**
 * The admin lock at run time (board f-admin/10 revised). The rules are `lib/adminLock` (pure, tested). The server asks
 * every admin request from this phone for an open pass (`X-Admin-Session`), held here in memory only. A pass comes
 * from this phone's key: a secret the server handed over once at setup (password, emailed code), kept in
 * expo-secure-store with `requireAuthentication`, which on Android is a Keystore key only a Class 3 fingerprint or face
 * can use (no PIN, no camera face unlock) and which a newly enrolled fingerprint wipes; Face ID or Touch ID on an
 * iPhone. A phone with no such sensor gets a pass for the password and an emailed code instead.
 *
 * Admin stays off screenshots and the app switcher with expo-screen-capture while it is on screen.
 */

type ScreenCapture = typeof import("expo-screen-capture");

function screenCapture(): ScreenCapture | null {
  try {
    return require("expo-screen-capture") as ScreenCapture;
  } catch {
    return null;
  }
}

/** This phone's key: which account and which server row; the secret itself is in SecureStore behind the fingerprint. */
const KEY_RECORD = "nf.adminPhoneKey";
const SECRET = "nf.adminPhoneSecret";

interface KeyRecord {
  userId: string;
  keyId: string;
  /** The phone wiped the secret (a fingerprint or face was added): set up again. */
  wiped: boolean;
}

let state: LockState = LOCKED;
/** The open pass, in memory only: never stored, gone with the app. */
let pass: string | null = null;
/** A setup the server finished whose secret is not stored yet (the fingerprint sheet was cancelled): tried again. */
let pendingSetup: AdminPhoneSetUp | null = null;
let lastTouchAt = Date.now();
const listeners = new Set<() => void>();

function dispatch(event: LockEvent): void {
  const next = lockReducer(state, event);
  if (next === state) return;
  const wasOpen = state.unlockedAt !== null;
  state = next;
  // Locked again: no pass, and nothing admin stays in memory.
  if (wasOpen && next.unlockedAt === null) {
    pass = null;
    clearAdminData();
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The client sends the pass on admin calls, and a server that says Admin is locked locks it here too.
setAdminSessionHooks(
  () => pass,
  () => lockAdmin(),
);

function open(session: string): void {
  pass = session;
  lastTouchAt = Date.now();
  dispatch({ type: "unlock", at: Date.now() });
}

/** Locks Admin now and drops what it read: sign-out, an account change, the server ending the pass. */
export function lockAdmin(): void {
  // A setup left at the fingerprint is this account's alone: the next one to sign in starts its own.
  pendingSetup = null;
  dispatch({ type: "lock" });
}

/** Whether Admin is open at this moment. */
export function adminUnlocked(): boolean {
  return isUnlocked(state, Date.now());
}

async function currentUserId(): Promise<string | null> {
  return (await tokenStore.getUser().catch(() => null))?.id ?? null;
}

async function readKeyRecord(): Promise<KeyRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_RECORD);
    const record = raw ? (JSON.parse(raw) as KeyRecord) : null;
    const userId = await currentUserId();
    // Another account's key on a shared phone is no key for this one.
    return record && record.userId === userId && typeof record.keyId === "string" ? record : null;
  } catch {
    return null;
  }
}

async function writeKeyRecord(record: KeyRecord | null): Promise<void> {
  if (record) await AsyncStorage.setItem(KEY_RECORD, JSON.stringify(record)).catch(() => undefined);
  else await AsyncStorage.removeItem(KEY_RECORD).catch(() => undefined);
  for (const l of listeners) l();
}

function strongBiometrics(): boolean {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

/** How this phone opens Admin: its key, setting one up, setting it up again, or the password and an emailed code. */
export async function readLockMethod(): Promise<LockMethod> {
  const record = await readKeyRecord();
  return lockMethod({ strongBiometrics: strongBiometrics(), hasKey: record !== null, wiped: record?.wiped ?? false });
}

type SecretRead =
  | { ok: true; keyId: string; secret: string }
  | { ok: false; wiped: boolean; message: string | null };

/** The key, read with the fingerprint or face (the phone's own sheet, titled `prompt`). */
async function readSecret(prompt: string): Promise<SecretRead> {
  const record = await readKeyRecord();
  if (!record || record.wiped) return { ok: false, wiped: record !== null, message: null };
  try {
    const secret = await SecureStore.getItemAsync(SECRET, { requireAuthentication: true, authenticationPrompt: prompt });
    if (!secret) {
      // The Keystore key was invalidated: a fingerprint or face was enrolled since setup.
      await writeKeyRecord({ ...record, wiped: true });
      return { ok: false, wiped: true, message: null };
    }
    return { ok: true, keyId: record.keyId, secret };
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    // Cancelled is silent; the sensor's own lockout says so.
    return /lockout/i.test(text)
      ? { ok: false, wiped: false, message: "Too many tries on the sensor. Wait a moment, then try again." }
      : { ok: false, wiped: false, message: null };
  }
}

export type UnlockOutcome = { kind: "open" } | { kind: "cancelled" } | { kind: "wiped" } | { kind: "failed"; message: string };

/** Asks for a pass with this phone's key: `reason` titles the fingerprint sheet. */
async function unlockWithKey(reason: string): Promise<UnlockOutcome> {
  const read = await readSecret(reason);
  if (!read.ok) {
    if (read.wiped) return { kind: "wiped" };
    return read.message ? { kind: "failed", message: read.message } : { kind: "cancelled" };
  }
  try {
    const answer = await adminApi.unlockPhone(read.keyId, read.secret);
    open(answer.session);
    return { kind: "open" };
  } catch (e) {
    const err = toApiError(e);
    // Retired on the server (set up on this phone again elsewhere, or past the limit): set up afresh.
    if (err.code === "ADMIN_PHONE_KEY_INVALID") await writeKeyRecord(null);
    return { kind: "failed", message: err.message };
  }
}

/** Opens Admin with the fingerprint or face. */
export function unlockWithPhone(): Promise<UnlockOutcome> {
  return unlockWithKey(PROMPT.unlock);
}

/** Step one of setting up, and of a phone with no sensor: the password, then a code to the account's inbox. */
export function requestCode(password: string, purpose: "setup" | "unlock"): Promise<AdminCodeSent> {
  return adminApi.requestAdminCode(password, purpose);
}

/** The emailed setup code: the server makes this phone's key, and the fingerprint stores it. */
export async function finishSetup(codeId: string, code: string): Promise<UnlockOutcome> {
  const record = await readKeyRecord();
  try {
    pendingSetup = await adminApi.setUpPhone(codeId, code, Device.modelName ?? "Phone", record?.keyId ?? null);
  } catch (e) {
    return { kind: "failed", message: toApiError(e).message };
  }
  return storePendingKey();
}

/** Stores the key behind the fingerprint (the phone's own sheet), then opens Admin. Safe to call again on a cancel. */
export async function storePendingKey(): Promise<UnlockOutcome> {
  const setUp = pendingSetup;
  const userId = await currentUserId();
  if (!setUp || !userId) return { kind: "failed", message: "Start the setup again." };
  try {
    await SecureStore.setItemAsync(SECRET, setUp.secret, {
      requireAuthentication: true,
      authenticationPrompt: PROMPT.setup,
    });
  } catch {
    return { kind: "cancelled" };
  }
  pendingSetup = null;
  await writeKeyRecord({ userId, keyId: setUp.keyId, wiped: false });
  open(setUp.session);
  return { kind: "open" };
}

/** Whether a setup is waiting on the fingerprint. */
export function setupPending(): boolean {
  return pendingSetup !== null;
}

/** A phone with no sensor: the emailed unlock code opens Admin. Null when it opened, else a sentence to show. */
export async function verifyCode(codeId: string, code: string): Promise<string | null> {
  try {
    const answer = await adminApi.verifyAdminCode(codeId, code);
    open(answer.session);
    return null;
  } catch (e) {
    return toApiError(e).message;
  }
}

/**
 * The second ask before a destructive action (Suspend, End subscription, Revoke Pro, Change role, a flag): the
 * fingerprint once more, which gets a fresh pass the server checks; on a phone with no sensor, the password, which the
 * server checks and marks the pass fresh. Null when confirmed; otherwise a sentence to show, or "" when cancelled.
 */
export async function confirmAgain(reason: string, method: LockMethod, password?: string): Promise<string | null> {
  if (method === "code") {
    if (!password) return "Enter your password to confirm.";
    try {
      await adminApi.confirmPassword(password);
      return null;
    } catch (e) {
      return toApiError(e).message;
    }
  }
  const outcome = await unlockWithKey(reason);
  switch (outcome.kind) {
    case "open":
      return null;
    case "cancelled":
      return "";
    case "wiped":
      lockAdmin();
      return "This phone's Admin key was wiped. Set Admin up again.";
    case "failed":
      return outcome.message;
  }
}

/** The fingerprint before a quiet change (a flag's preview or date): true when confirmed. */
export async function askPhoneLock(reason: string): Promise<boolean> {
  return (await confirmAgain(reason, "biometric")) === null;
}

/** The lock's state for a component, and how this phone opens it (re-read when the lock or the key changes). */
export function useAdminLock(): { unlocked: boolean; method: LockMethod | null } {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const [method, setMethod] = useState<LockMethod | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let live = true;
    void readLockMethod().then((m) => live && setMethod(m));
    return () => {
      live = false;
    };
  }, [version]);
  return { unlocked: isUnlocked(snapshot, Date.now()), method };
}

/** A tap anywhere in Admin: the 5 minutes without a tap start again. */
export function noteAdminActivity(): void {
  lastTouchAt = Date.now();
}

/**
 * While Admin is on screen: the away clock (5 minutes in the background, or out of Admin, locks it), the idle clock
 * (5 minutes without a tap locks it, and ends the pass on the server too), a blank cover whenever the app is not in
 * front (so the app switcher never shows a figure), and no screenshots. Returns whether the cover is up.
 */
export function useAdminPresence(): boolean {
  const [away, setAway] = useState(AppState.currentState !== "active");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Back into Admin: the clock that started when it was left is read now.
    dispatch({ type: "foreground", at: Date.now() });
    lastTouchAt = Date.now();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        dispatch({ type: "foreground", at: Date.now() });
        setAway(false);
      } else {
        dispatch({ type: "background", at: Date.now() });
        setAway(true);
      }
    });

    timer.current = setInterval(() => {
      if (state.unlockedAt === null || !idleExpired(lastTouchAt, Date.now())) return;
      const ending = pass;
      lockAdmin();
      if (ending) void adminApi.lockPhone(ending).catch(() => undefined);
    }, 10_000);

    const sc = screenCapture();
    const key = "nf-admin";
    void sc?.preventScreenCaptureAsync(key).catch(() => undefined);
    if (Platform.OS === "ios") void sc?.enableAppSwitcherProtectionAsync?.().catch(() => undefined);

    return () => {
      sub.remove();
      if (timer.current) clearInterval(timer.current);
      // Leaving Admin starts the same 5 minutes as leaving the app.
      dispatch({ type: "background", at: Date.now() });
      void sc?.allowScreenCaptureAsync(key).catch(() => undefined);
      if (Platform.OS === "ios") void sc?.disableAppSwitcherProtectionAsync?.().catch(() => undefined);
    };
  }, []);

  return away;
}
