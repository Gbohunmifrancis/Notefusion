/**
 * The admin lock's rules as plain data (board f-admin/10; tests: adminLock.test.ts). The runtime around it —
 * the fingerprint prompt, the app's comings and goings, the password fallback — is `lib/adminLockRuntime.tsx`.
 *
 * Admin opens only after the phone's own lock says so: a fingerprint or face, else the phone's PIN, pattern or
 * password (Android's BiometricPrompt, Face ID with the passcode on an iPhone), never a PIN of ours. It locks again
 * after 5 minutes away, on sign-out and on an account change; leaving it within 5 minutes and coming back finds it
 * where it was. Suspend, End subscription, Revoke Pro, Change role and any feature-flag change ask again.
 */

/** Away this long (the app in the background), Admin locks. */
export const RELOCK_AFTER_MS = 5 * 60 * 1000;

export interface LockState {
  /** When the lock last opened; null while locked. */
  unlockedAt: number | null;
  /** When the app last went to the background while unlocked; null while it is in front. */
  awayAt: number | null;
}

export const LOCKED: LockState = { unlockedAt: null, awayAt: null };

export type LockEvent =
  | { type: "unlock"; at: number }
  | { type: "background"; at: number }
  | { type: "foreground"; at: number }
  /** Sign-out, an account change, the × out of Admin's data: everything. */
  | { type: "lock" };

export function lockReducer(state: LockState, event: LockEvent): LockState {
  switch (event.type) {
    case "unlock":
      return { unlockedAt: event.at, awayAt: null };
    case "background":
      return state.unlockedAt === null || state.awayAt !== null ? state : { ...state, awayAt: event.at };
    case "foreground":
      if (state.unlockedAt === null) return state;
      if (state.awayAt !== null && event.at - state.awayAt >= RELOCK_AFTER_MS) return LOCKED;
      return { ...state, awayAt: null };
    case "lock":
      return LOCKED;
  }
}

/** Whether Admin is open at `now`: unlocked, and not away for 5 minutes or more. */
export function isUnlocked(state: LockState, now: number): boolean {
  if (state.unlockedAt === null) return false;
  return state.awayAt === null || now - state.awayAt < RELOCK_AFTER_MS;
}

/**
 * How this phone can open Admin, from expo-local-authentication's `getEnrolledLevelAsync` (0 none, 1 a PIN, pattern
 * or password, 2 weak and 3 strong biometrics) and `hasHardwareAsync`:
 * - `biometric`: a fingerprint or face, with the phone's PIN behind "Use PIN";
 * - `device`: the phone's PIN, pattern or password alone;
 * - `password`: no screen lock at all (or no module on this build), so the account password is typed instead.
 */
export type LockMethod = "biometric" | "device" | "password";

export function lockMethod(caps: { available: boolean; hasHardware: boolean; level: number }): LockMethod {
  if (!caps.available) return "password";
  if (caps.hasHardware && caps.level >= 2) return "biometric";
  if (caps.level >= 1) return "device";
  return "password";
}

/** The three lines BiometricPrompt shows; we write nothing else of it. */
export const PROMPT = {
  promptMessage: "Unlock Admin",
  promptSubtitle: "Use your fingerprint or face",
  promptDescription: "Admin locks again after 5 minutes away.",
} as const;

/** What a destructive action's second ask says under its sheet (board f-admin/05). */
export const CONFIRM_LINE = "Your fingerprint or face confirms it next. Written to the audit log under your name.";

/** The locked page's line for each method. */
export function lockedLine(method: LockMethod): string {
  switch (method) {
    case "biometric":
      return "Unlock with your fingerprint, face or phone PIN to see payments and accounts.";
    case "device":
      return "Unlock with your phone's PIN, pattern or password to see payments and accounts.";
    case "password":
      return "This phone has no screen lock. Enter your NoteFusion password to see payments and accounts, or set a screen lock in your phone's settings.";
  }
}

/** The footnote on the locked page. */
export const LOCKED_FOOTNOTE =
  "Locks again 5 minutes after you leave Admin or the app, and when you sign out. Five failed tries hand over to the phone's own lockout.";
