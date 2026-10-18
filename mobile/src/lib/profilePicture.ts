import { useSyncExternalStore } from "react";
import { meApi } from "../api/endpoints";

/**
 * The signed-in account's picture, shared by every tab's header avatar and Profile, so the five headers do not
 * each ask the API for it. Read on focus at most every 30 s (a picture changed on Profile is set here at once),
 * and kept against the account it belongs to so a new sign-in never shows the last one's face.
 */
const FRESH_MS = 30_000;

let owner: string | null = null;
let url: string | null = null;
let readAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** After an upload or a removal on Profile: shown on every header at once. */
export function setProfilePicture(userId: string, next: string | null): void {
  owner = userId;
  url = next;
  readAt = Date.now();
  emit();
}

/** Asks the API for the picture unless it was read in the last 30 s (or `force`, a pull to refresh). */
export function refreshProfilePicture(userId: string, force = false): Promise<void> {
  if (!force && owner === userId && Date.now() - readAt < FRESH_MS) return Promise.resolve();
  if (inflight) return inflight;
  inflight = meApi
    .get()
    .then((p) => setProfilePicture(p.id ?? userId, p.profilePictureUrl))
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The picture's URL for this account, or null (none set, not read yet, or another account's). */
export function useProfilePicture(userId: string | undefined): string | null {
  const current = useSyncExternalStore(subscribe, () => (owner === userId ? url : null));
  return userId ? current : null;
}
