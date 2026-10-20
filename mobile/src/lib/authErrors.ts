/**
 * Which sign-up failures belong to a field rather than above the button. Pure (`authErrors.test.ts`).
 */

import type { ApiError } from "../api/types";

const NOT_AN_EMAIL = "That doesn't look like an email address.";

/**
 * Wrong email or password, counted in a row (board l-ux-high 04d): any other answer starts the count again. From the
 * second miss the error note carries its own "Forgot password?" (`offersReset`), where the eye already is.
 */
export function missesAfter(previous: number, code: string): number {
  return code === "AUTH_INVALID_CREDENTIALS" ? previous + 1 : 0;
}

export function offersReset(misses: number): boolean {
  return misses >= 2;
}

/**
 * What a failed Google sign-in says. The API's refusals keep their own words; a failure on the phone itself (Google's
 * sheet would not open, Play services missing — `toApiError` reads any such error as UNKNOWN) offers the way on this
 * screen has, `alternative`, instead of a bare "Something went wrong".
 */
export function googleFailure(err: Pick<ApiError, "code" | "message">, alternative: string): string {
  return err.code === "UNKNOWN" ? `Google sign-in didn't work on this phone. Try again, or ${alternative}.` : err.message;
}

/** Where someone can write to us (the address the website, receipts and the code screen give). */
const HELP_EMAIL = "hello@notefusion.studio";

/**
 * A refusal only we can lift — the account was deactivated, and the server's sentence ends "Contact support." — so its
 * note carries a way to write to us (a mail to that address); null for any other.
 */
export function contactUsUrl(code: string): string | null {
  if (code !== "AUTH_ACCOUNT_INACTIVE") return null;
  return `mailto:${HELP_EMAIL}?subject=${encodeURIComponent("My account is deactivated")}`;
}

/**
 * The words for the Email field when the server refused the address itself — a throwaway inbox, or an address its
 * own check could not read — so they sit on the field that needs changing; null for any other failure.
 */
export function emailFieldError(err: Pick<ApiError, "code" | "message" | "details">): string | null {
  if (err.code === "AUTH_DISPOSABLE_EMAIL") return err.message;
  if (err.code === "Validation.Failed" && (err.details?.Email?.length || err.details?.email?.length)) return NOT_AN_EMAIL;
  return null;
}
