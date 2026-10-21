/**
 * A free account's weekly transcriptions: how many are left and when they come back.
 *
 * Free accounts get 3 hummed or recorded transcriptions a week; the week turns every Friday
 * at 17:00 UTC for everyone (`FreeTier` in the API). The API sends the moment as
 * `freeResetsAtUtc`; this shows it in the phone's own time ("Friday 1pm" in New York), never in
 * another zone's. The web app keeps its own copy in `web-site/assets/freeweek.js`.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** What to say when the API did not send the moment (an older API): the rule itself, in UTC. */
export const FREE_RESET_FALLBACK = "Friday 17:00 UTC";

/** "6pm", "6:30pm", "12am": short, and the same whatever the phone's language. */
function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** When the free ones come back, in the phone's time: "Friday 6pm". */
export function freeResetLabel(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return FREE_RESET_FALLBACK;
  return `${DAYS[d.getDay()]} ${clock(d)}`;
}

/** The subscription fields this reads (a subset of `Subscription` in api/types). */
export interface FreeWeekSource {
  trialGenerationsRemaining?: number;
  trialGenerationsTotal?: number;
  boughtTranscriptionsRemaining?: number;
  boughtTranscriptionsTotal?: number;
  freeTranscriptionsRemaining?: number;
  freeTranscriptionsPerWeek?: number;
  freeResetsAtUtc?: string | null;
}

export interface FreeWeek {
  /** This week's free ones not yet used or running. */
  left: number;
  /** Free ones a week. */
  total: number;
  /** When they come back, in the phone's time ("Friday 6pm"). */
  back: string;
}

/**
 * This week's free ones from the subscription the API returned. An API from before the weekly
 * fields only sent the totals with bought ones folded in; those are taken apart again.
 */
export function freeWeek(sub: FreeWeekSource | null | undefined): FreeWeek | null {
  if (!sub) return null;
  let total = sub.freeTranscriptionsPerWeek;
  let left = sub.freeTranscriptionsRemaining;
  if (typeof total !== "number" || total <= 0) {
    total = Math.max(0, (sub.trialGenerationsTotal ?? 0) - (sub.boughtTranscriptionsTotal ?? 0));
    left = Math.max(0, (sub.trialGenerationsRemaining ?? 0) - (sub.boughtTranscriptionsRemaining ?? 0));
  }
  return { left: Math.max(0, left ?? 0), total, back: freeResetLabel(sub.freeResetsAtUtc) };
}
