/**
 * Which sign-up failures belong to a field rather than above the button. Pure (`authErrors.test.ts`).
 */

import type { ApiError } from "../api/types";

const NOT_AN_EMAIL = "That doesn't look like an email address.";

/**
 * The words for the Email field when the server refused the address itself — a throwaway inbox, or an address its
 * own check could not read — so they sit on the field that needs changing; null for any other failure.
 */
export function emailFieldError(err: Pick<ApiError, "code" | "message" | "details">): string | null {
  if (err.code === "AUTH_DISPOSABLE_EMAIL") return err.message;
  if (err.code === "Validation.Failed" && (err.details?.Email?.length || err.details?.email?.length)) return NOT_AN_EMAIL;
  return null;
}
