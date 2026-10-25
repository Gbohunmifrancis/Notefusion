/**
 * The live notices' feed: `GET /api/admin/analytics/live/events` says `ready`, then `changed` each time someone comes
 * online or signs up, a transcription starts or a payment goes through, and the notices fetch `live` only then —
 * instead of every fifteen seconds in every tab, hidden ones included. A hidden tab keeps its stream, so the payment's
 * "ka-ching" still rings from a tab in the background.
 *
 * While the console is locked there is no pass to open it with: it closes and opens again on unlock. A stream that
 * cannot be held is reopened after 1, 2, 5, 10 and then 30 s, and after three failures in a row `live` is fetched
 * every minute until one holds. The API closes each stream after ten minutes; it is opened again at once.
 *
 * One stream per tab, whoever follows it: the notices and the Users page follow `changed`, the Blog section's drafting
 * cards follow `blog` (a batch of drafts moved), the Support page and its nav badge `support` (a message or a read).
 * `ready` and the fallback tell every follower.
 */

import { openStream } from "@/api/client";
import { getLockState, subscribe } from "@/lib/adminLock";
import { SseParser } from "@/lib/sse";

const PATH = "/api/admin/analytics/live/events";
/** Two missed pings (the API sends one every 20 s): the connection is gone without saying so. */
const WATCHDOG_MS = 45_000;
/** A burst of changes (a deploy bringing everyone back online) is one fetch. */
const SETTLE_MS = 1_000;
const FALLBACK_MS = 60_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export type LiveEvent = "changed" | "blog" | "support";

type Follower = { event: LiveEvent; onChange: () => void; settle: ReturnType<typeof setTimeout> | null };

const followers = new Set<Follower>();
let disconnect: (() => void) | null = null;

/** Follows the feed, calling `onChange` when `event` says to fetch again; returns a function that stops it. */
export function followLiveFeed(onChange: () => void, event: LiveEvent = "changed"): () => void {
  const me: Follower = { event, onChange, settle: null };
  followers.add(me);
  disconnect ??= connect();
  return () => {
    followers.delete(me);
    if (me.settle) clearTimeout(me.settle);
    if (followers.size > 0) return;
    disconnect?.();
    disconnect = null;
  };
}

/** Tells the followers of `event`, or all of them. */
function tell(event?: string): void {
  for (const f of followers) {
    if ((event && f.event !== event) || f.settle) continue;
    f.settle = setTimeout(() => {
      f.settle = null;
      if (followers.has(f)) f.onChange();
    }, SETTLE_MS);
  }
}

function connect(): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let fallback: ReturnType<typeof setInterval> | null = null;

  const close = () => {
    controller?.abort();
    controller = null;
    if (watchdog) clearTimeout(watchdog);
    watchdog = null;
  };

  const later = () => {
    failures += 1;
    if (failures >= 3 && !fallback) fallback = setInterval(() => !stopped && tell(), FALLBACK_MS);
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => {
      retry = null;
      void open();
    }, BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]);
  };

  const held = () => {
    failures = 0;
    if (fallback) clearInterval(fallback);
    fallback = null;
  };

  async function open(): Promise<void> {
    close();
    if (stopped || getLockState().locked) return;
    const mine = new AbortController();
    controller = mine;
    const guard = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        if (controller !== mine) return;
        close();
        later();
      }, WATCHDOG_MS);
    };

    try {
      guard();
      const response = await openStream(PATH, mine.signal);
      if (controller !== mine) return;
      if (!response.ok || !response.body) {
        // A token that ran out is refreshed by the next ordinary call, which this asks for; a locked console waits
        // for its unlock (the lock listener below reopens it).
        if (response.status === 401) tell();
        if (response.status === 403 && getLockState().locked) return close();
        close();
        return later();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      for (;;) {
        const chunk = await reader.read();
        if (controller !== mine) return;
        if (chunk.done) break;
        guard();
        for (const event of parser.feed(decoder.decode(chunk.value, { stream: true }))) {
          if (event.event === "ready") {
            held();
            tell();
          } else if (event.event) tell(event.event);
        }
      }
      // The API ended it (its ten minutes, or a restart): open the next one now.
      close();
      void open();
    } catch {
      if (controller !== mine) return; // closed here on purpose
      close();
      later();
    }
  }

  // Locked: nothing to open it with. Unlocked: open it again, and fetch what was missed.
  const unsubscribe = subscribe(() => {
    if (stopped) return;
    if (getLockState().locked) close();
    else if (!controller && !retry) void open();
  });

  void open();

  return () => {
    stopped = true;
    unsubscribe();
    close();
    if (retry) clearTimeout(retry);
    if (fallback) clearInterval(fallback);
  };
}
