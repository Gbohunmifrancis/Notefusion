/**
 * Proving it is the admin, the two ways the console accepts: one of their passkeys, or their
 * password. Each opens a new pass that also counts as the fresh confirmation for the next minute.
 * Shared by the lock, the confirm dialog, the confirmation prompt and adding a passkey.
 */

import { ApiError } from "@/api/client";
import {
  getConsoleUnlockOptions,
  unlockConsoleWithPasskey,
  unlockConsoleWithPassword,
} from "@/api/endpoints";
import type { ConsoleSession, Passkey } from "@/api/types";
import { setAdminPass } from "@/lib/adminLock";
import { rememberThisBrowser } from "@/lib/consoleTrust";
import { assertionToJson, passkeyErrorMessage, passkeysSupported, toRequestOptions } from "@/lib/webauthn";

function accept(session: ConsoleSession) {
  setAdminPass(session.session, { fresh: true });
  void rememberThisBrowser();
}

export async function unlockWithPasskey(): Promise<void> {
  const options = await getConsoleUnlockOptions();
  const credential = (await navigator.credentials.get({
    publicKey: toRequestOptions(options),
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("No passkey was chosen.", "NotAllowedError");
  accept(await unlockConsoleWithPasskey(assertionToJson(credential)));
}

export async function unlockWithPassword(password: string): Promise<void> {
  accept(await unlockConsoleWithPassword(password));
}

/** True when the passkey is the way to offer first: the browser can, and the account has one. */
export function offersPasskey(passkeys: readonly Passkey[] | undefined): boolean {
  return passkeysSupported() && (passkeys === undefined || passkeys.length > 0);
}

/**
 * A plain sentence for a failed unlock. The server's refusals (a wrong password, too many tries, no
 * password on a Google-only account) are written for this reader; the rest is the passkey's own.
 */
export function unlockErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code !== "UNKNOWN" && error.message) return error.message;
  return passkeyErrorMessage(error, "sign-in");
}
