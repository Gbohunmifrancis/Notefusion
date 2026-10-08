/**
 * When to ask for a store rating — the pure rule, kept apart from storage so it
 * can be tested without React Native.
 *
 * Ask once someone has saved their third sheet: by then they have had the app
 * work for them three times, which is when a rating is both deserved and honest.
 * Never straight after a job failed, never twice once they have rated, and
 * "Not now" holds for ninety days.
 */

export const SAVES_BEFORE_ASKING = 3;
export const SNOOZE_MS = 90 * 24 * 60 * 60 * 1000;
/** A failure this recent means the person's last memory of the app is a bad one. */
export const FAILURE_QUIET_MS = 24 * 60 * 60 * 1000;

export interface RatingState {
  saves: number;
  /** Rated, or chose to go to the store: never ask again. */
  done: boolean;
  snoozedUntil: number;
  lastFailureAt: number;
}

export const INITIAL_RATING_STATE: RatingState = { saves: 0, done: false, snoozedUntil: 0, lastFailureAt: 0 };

export function shouldAskForRating(s: RatingState, now: number): boolean {
  return (
    !s.done &&
    s.saves >= SAVES_BEFORE_ASKING &&
    now >= s.snoozedUntil &&
    now - s.lastFailureAt >= FAILURE_QUIET_MS
  );
}

/** Reads whatever was stored, tolerating a missing or corrupted value. */
export function parseRatingState(raw: string | null): RatingState {
  if (!raw) return INITIAL_RATING_STATE;
  try {
    const v = JSON.parse(raw) as Partial<RatingState>;
    return {
      saves: Number.isFinite(v.saves) ? Number(v.saves) : 0,
      done: v.done === true,
      snoozedUntil: Number.isFinite(v.snoozedUntil) ? Number(v.snoozedUntil) : 0,
      lastFailureAt: Number.isFinite(v.lastFailureAt) ? Number(v.lastFailureAt) : 0,
    };
  } catch {
    return INITIAL_RATING_STATE;
  }
}
