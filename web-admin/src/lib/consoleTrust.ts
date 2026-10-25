/**
 * A browser the console remembers (`AdminTrustedBrowser` on the API): after a passkey or password unlock, or a sign-in,
 * the console asks the API for a token and keeps it here, and whenever it finds itself locked (a reload, a new tab, an
 * hour away, an API restart) it trades the token for a pass instead of asking for the passkey again. That pass is never
 * the fresh confirmation, so Suspend, End subscription, Revoke Pro, Change role, flags and passkeys still ask.
 *
 * The token lives in localStorage for 30 days (the server's limit), is forgotten at sign-out, and any remembered
 * browser can be forgotten from Settings.
 */

import { ApiError } from "@/api/client";
import { forgetConsoleBrowser, openConsoleFromTrust, rememberConsoleBrowser } from "@/api/endpoints";
import { setAdminPass, setReopener } from "@/lib/adminLock";

const KEY = "nf.admin.trust";

interface Kept {
  token: string;
  expiresAtUtc: string;
}

function read(): Kept | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? "null") as Kept | null;
    if (!kept?.token || Date.parse(kept.expiresAtUtc) <= Date.now()) return null;
    return kept;
  } catch {
    return null;
  }
}

function forgetLocally() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage refused: nothing was kept.
  }
}

export const trustToken = (): string | null => read()?.token ?? null;

/** True while this browser is remembered: the console opens itself again instead of locking. */
export const isRemembered = (): boolean => read() !== null;

/** Right after an unlock or a sign-in (the pass is fresh): remembers this browser, once. Never throws. */
export async function rememberThisBrowser(): Promise<void> {
  if (isRemembered()) return;
  try {
    const trust = await rememberConsoleBrowser();
    localStorage.setItem(KEY, JSON.stringify({ token: trust.token, expiresAtUtc: trust.expiresAtUtc }));
  } catch {
    // Not remembered this time; the console asks as before, and tries again at the next unlock.
  }
}

/** Opens the console with the kept token: true with the pass set; false (and the token dropped if refused) otherwise. */
async function reopen(): Promise<boolean> {
  const token = trustToken();
  if (!token) return false;
  try {
    const session = await openConsoleFromTrust(token);
    setAdminPass(session.session);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.code === "ADMIN_TRUST_INVALID") forgetLocally();
    return false;
  }
}

/** Signing out: this browser is forgotten on the server and here. */
export async function forgetThisBrowser(): Promise<void> {
  const token = trustToken();
  forgetLocally();
  if (!token) return;
  try {
    await forgetConsoleBrowser(token);
  } catch {
    // It ends by itself after 30 days; the token is gone from this browser either way.
  }
}

/** Called after Settings forgot this browser by id. */
export const forgetThisBrowserLocally = forgetLocally;

setReopener(reopen);
