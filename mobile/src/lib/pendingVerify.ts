/**
 * An emailed sign-up code still waiting to be typed. Android may close the app while the person is in their mail
 * fetching the code; the address and the time it went are kept (`pendingVerifyStore`) so the next start opens the
 * code screen again instead of Welcome, for as long as the code lasts. Pure (`pendingVerify.test.ts`).
 */

/** A code lasts 10 minutes (the code screen says so); after that a start lands on Welcome as usual. */
export const VERIFY_CODE_MS = 10 * 60 * 1000;

export interface PendingVerify {
  email: string;
  /** Reached from sign-up ("2 of 2"), not from a refused sign-in. */
  fromSignUp: boolean;
  /** When the latest code was sent (ms). */
  sentAt: number;
}

/** The stored code, while it is still good at `now`; null when there is none, it is unreadable or it has expired. */
export function readPendingVerify(raw: string | null | undefined, now: number): PendingVerify | null {
  if (!raw) return null;
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof p !== "object" || p === null) return null;
  const { email, fromSignUp, sentAt } = p as Record<string, unknown>;
  if (typeof email !== "string" || email.trim() === "" || typeof sentAt !== "number" || !Number.isFinite(sentAt)) return null;
  const age = now - sentAt;
  if (age < 0 || age >= VERIFY_CODE_MS) return null;
  return { email, fromSignUp: fromSignUp === true, sentAt };
}
