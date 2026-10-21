/**
 * The admin lock's rules as plain data (board f-admin/10; tests: adminLock.test.ts). The runtime around it —
 * the key behind the fingerprint, the app's comings and goings, the codes — is `lib/adminLockRuntime.ts`.
 *
 * Admin opens only with a pass the server gives for this phone's key (read with a strong fingerprint or face, never the
 * phone's PIN) or, on a phone with no such sensor, the password and an emailed code. It locks again after an hour
 * without a tap, an hour away, on sign-out and on an account change; leaving it within the hour and coming back finds
 * it where it was. Suspend, End subscription, Revoke Pro, Change role and any feature-flag change ask again.
 */

/** Away this long (the app in the background), Admin locks. */
export const RELOCK_AFTER_MS = 60 * 60 * 1000;

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

/** Whether Admin is open at `now`: unlocked, and not away for an hour or more. */
export function isUnlocked(state: LockState, now: number): boolean {
  if (state.unlockedAt === null) return false;
  return state.awayAt === null || now - state.awayAt < RELOCK_AFTER_MS;
}

/** Admin on screen this long without a tap, it locks: the server's pass ends after the same hour idle. */
export const IDLE_LOCK_MS = 60 * 60 * 1000;

/** Whether Admin has gone untouched long enough to lock. */
export function idleExpired(lastTouchAt: number, now: number): boolean {
  return now - lastTouchAt >= IDLE_LOCK_MS;
}

/**
 * How this phone opens Admin (board f-admin/10 revised). The server asks every admin request from the phone for a pass
 * that only these open:
 * - `biometric`: this phone's key, which only a strong fingerprint or face can read (no PIN, no camera face unlock);
 * - `setup`: a strong sensor but no key yet: the password, an emailed code, then the fingerprint makes one;
 * - `rekey`: the phone wiped the key because a fingerprint or face was added to it: set up again;
 * - `code`: no strong sensor: the password and an emailed code each time.
 */
export type LockMethod = "biometric" | "setup" | "rekey" | "code";

export function lockMethod(caps: { strongBiometrics: boolean; hasKey: boolean; wiped: boolean }): LockMethod {
  if (!caps.strongBiometrics) return "code";
  if (caps.wiped) return "rekey";
  return caps.hasKey ? "biometric" : "setup";
}

/** The fingerprint prompt's title: the phone's own sheet shows it over the key. */
export const PROMPT = {
  unlock: "Unlock Admin",
  setup: "Finish setting up Admin",
} as const;

/** What a destructive action's second ask says under its sheet (board f-admin/05). */
export const CONFIRM_LINE = "Your fingerprint or face confirms it next. Written to the audit log under your name.";

/** The locked page's title for each method. */
export function lockedTitle(method: LockMethod): string {
  switch (method) {
    case "setup":
      return "Set up Admin here";
    case "rekey":
      return "Set up Admin again";
    default:
      return "Admin is locked";
  }
}

/** The locked page's line for each method. */
export function lockedLine(method: LockMethod): string {
  switch (method) {
    case "biometric":
      return "Unlock with your fingerprint or face to see payments and accounts.";
    case "setup":
      return "Set Admin up on this phone once: your password, a code we email you, then your fingerprint or face.";
    case "rekey":
      return "A fingerprint or face was added to this phone, so Admin's key was wiped. Confirm it's you with your password and an emailed code.";
    case "code":
      return "This phone has no fingerprint or face sensor Admin can use. Enter your password, then the code we email you.";
  }
}

/** The footnote on the locked page. */
export function lockedFootnote(method: LockMethod): string {
  switch (method) {
    case "biometric":
      return "Fingerprint or face only, never the phone's PIN. Locks after an hour without a tap or an hour away, and when you sign out.";
    case "setup":
      return "Only this phone's fingerprint or face can use the key it makes. Adding a fingerprint to the phone later wipes it.";
    case "rekey":
      return "If you didn't add one, someone with your phone's PIN may have. Change it in the phone's settings.";
    case "code":
      return "Codes last 10 minutes. Five wrong tries and Admin stays locked for 15 minutes.";
  }
}

/** A six-digit code as typed: digits only, at most six. */
export function cleanCode(typed: string): string {
  return typed.replace(/\D/g, "").slice(0, 6);
}
