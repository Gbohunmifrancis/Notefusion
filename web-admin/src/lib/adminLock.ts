/**
 * The console lock (board i-console-lock), on this side: the pass the API opened, whether the console
 * is locked, and the one prompt that asks an admin to confirm it is them.
 *
 * The pass is `X-Admin-Session` on every admin call. It lives in memory only — never storage — so a
 * reload, another tab or a copied token starts locked. The server is the boundary: it refuses admin
 * routes without an open pass (`ADMIN_LOCKED`) and the destructive ones without a fresh one
 * (`ADMIN_CONFIRM_REQUIRED`). This module keeps the console's picture of that and lets the API client
 * wait for an unlock or a confirmation instead of failing the page.
 *
 * Pure (no React, no `@/` imports), so it runs the same in a test as in the browser.
 */

export const ADMIN_SESSION_HEADER = "X-Admin-Session";

/** The console locks itself after this long without a key, click, scroll or touch. */
export const IDLE_LOCK_MS = 5 * 60_000;

/**
 * How long an unlock counts as the fresh confirmation the destructive actions want. The server allows
 * 60 s; a little less here, so the console never skips asking when the server would refuse.
 */
export const FRESH_MS = 55_000;

/** "away": 5 minutes without a touch. "required": the server said so (a reload, the hour, a new tab). */
export type LockReason = "away" | "required";

export interface LockState {
  locked: boolean;
  reason: LockReason;
  /** True while an action waits on the admin to confirm it is them. */
  confirming: boolean;
}

/** Thrown to whatever was waiting on an unlock or a confirmation when the admin signs out instead. */
export class ConsoleLockReset extends Error {
  constructor() {
    super("Signed out.");
    this.name = "ConsoleLockReset";
  }
}

let pass: string | null = null;
let freshUntil = 0;
let state: LockState = { locked: false, reason: "required", confirming: false };
const listeners = new Set<() => void>();

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}
let unlockWaiters: Waiter<void>[] = [];
let confirmation: Promise<boolean> | null = null;
let confirmationWaiter: Waiter<boolean> | null = null;
let promptHosts = 0;

function update(next: Partial<LockState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The same object until something changes, as `useSyncExternalStore` needs. */
export const getLockState = (): LockState => state;

export const getAdminPass = (): string | null => pass;

/** True for the paths the pass is sent on: the admin API and the passkeys the console manages. */
export function needsPassHeader(path: string): boolean {
  return path.startsWith("/api/admin/") || path.startsWith("/api/auth/passkeys");
}

/** The unlock routes themselves: never held behind the lock they open. */
export function isLockExemptPath(path: string): boolean {
  return path.startsWith("/api/admin/console-lock/");
}

/** Admin calls wait while the console is locked, so nothing loads behind the lock. */
export function holdsWhileLocked(path: string): boolean {
  return path.startsWith("/api/admin/") && !isLockExemptPath(path);
}

/**
 * A pass from the API: a sign-in's header or an unlock's answer. It opens the console and lets every
 * call that was waiting go. `fresh` marks it as the confirmation just given (an unlock, not a sign-in).
 */
export function setAdminPass(next: string, { fresh = false, now = Date.now() } = {}) {
  pass = next;
  freshUntil = fresh ? now + FRESH_MS : 0;
  const waiting = unlockWaiters;
  unlockWaiters = [];
  if (state.locked) update({ locked: false });
  for (const waiter of waiting) waiter.resolve();
  // An unlock is the confirmation itself: a prompt still waiting has its answer.
  if (fresh) settleConfirmation(true);
}

/** True while the last unlock still counts as a fresh confirmation. */
export const isFresh = (now = Date.now()): boolean => pass !== null && now < freshUntil;

/** Locks the console and forgets the pass, handing it back so it can be ended on the server. */
export function lockConsole(reason: LockReason): string | null {
  const ended = pass;
  pass = null;
  freshUntil = 0;
  if (!state.locked) update({ locked: true, reason });
  return ended;
}

/** Resolves when the console is next unlocked; at once when it is not locked. */
export function waitForUnlock(): Promise<void> {
  if (!state.locked) return Promise.resolve();
  return new Promise((resolve, reject) => unlockWaiters.push({ resolve, reject }));
}

/**
 * Asks the admin to confirm it is them, for a call the server refused with `ADMIN_CONFIRM_REQUIRED`.
 * Calls refused together share one prompt. Resolves true once confirmed (the fresh pass is already
 * set), false when the admin cancels or no prompt is on screen to ask.
 */
export function requestConfirmation(): Promise<boolean> {
  if (promptHosts === 0) return Promise.resolve(false);
  confirmation ??= new Promise<boolean>((resolve, reject) => {
    confirmationWaiter = { resolve, reject };
    update({ confirming: true });
  });
  return confirmation;
}

/** The prompt's answer to `requestConfirmation`. */
export function settleConfirmation(confirmed: boolean) {
  const waiter = confirmationWaiter;
  confirmation = null;
  confirmationWaiter = null;
  if (state.confirming) update({ confirming: false });
  waiter?.resolve(confirmed);
}

/** The component that shows the confirmation prompt registers here while mounted. */
export function registerPromptHost(): () => void {
  promptHosts++;
  return () => {
    promptHosts--;
    if (promptHosts === 0) settleConfirmation(false);
  };
}

/** True once `IDLE_LOCK_MS` has passed since the last sign of the admin at the desk. */
export const idleExpired = (lastActivity: number, now: number): boolean =>
  now - lastActivity >= IDLE_LOCK_MS;

/** Signing out (or a session that ended): no pass, no lock, and nothing left waiting on either. */
export function resetAdminLock() {
  pass = null;
  freshUntil = 0;
  const waiting = unlockWaiters;
  unlockWaiters = [];
  const confirmWaiter = confirmationWaiter;
  confirmation = null;
  confirmationWaiter = null;
  update({ locked: false, reason: "required", confirming: false });
  for (const waiter of waiting) waiter.reject(new ConsoleLockReset());
  confirmWaiter?.reject(new ConsoleLockReset());
}
