import { useSyncExternalStore } from "react";
import { meApi } from "../api/endpoints";
import { parseUtc } from "./sheetMeta";

/**
 * The signed-in account's picture, shared by every tab's header avatar and Profile, so the five headers do not
 * each ask the API for it. Read on focus at most every 30 s (a picture changed on Profile is set here at once),
 * and kept against the account it belongs to so a new sign-in never shows the last one's face.
 *
 * The same read gives the account's creation date, which Home's Doh card needs for "the first week".
 */
const FRESH_MS = 30_000;

let owner: string | null = null;
let url: string | null = null;
let readAt = 0;
/** When the account was made (ms), from the same profile read; null until read. */
let joinedAt: number | null = null;
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
  if (owner !== userId) joinedAt = null;
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
    .then((p) => {
      setProfilePicture(p.id ?? userId, p.profilePictureUrl);
      const at = p.createdAt ? parseUtc(p.createdAt) : NaN;
      joinedAt = Number.isFinite(at) ? at : null;
      emit();
    })
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

/** When this account was made (ms), or null until the profile has been read. */
export function useAccountJoinedAt(userId: string | undefined): number | null {
  const current = useSyncExternalStore(subscribe, () => (owner === userId ? joinedAt : null));
  return userId ? current : null;
}
