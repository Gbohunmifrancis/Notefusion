/**
 * The rules a job's live stream keeps (`jobStream.ts`), pure so they are testable. The API tells the phone
 * what a running job is doing (`GET /api/transcriptions/jobs/{id}/events`: `ready`, `job`, `ended`, a ping
 * every 20 s) instead of being asked every few seconds; these numbers say how long silence is tolerated,
 * how soon a dropped stream is opened again, and when the phone gives up holding one and asks instead.
 */

/** Waits before each reopening after a stream fails, by how many have failed in a row; the last one repeats. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

/** Streams that must fail in a row before the job is also read on a timer (`jobFallbackPollMs`). */
export const FALLBACK_AFTER_FAILURES = 3;

/** Nothing at all for this long (the server pings every 20 s) is a dead connection: abort and reopen. */
export const WATCHDOG_MS = 45_000;

/** No word about a running job for this long: read it once, in case its end was missed. */
export const QUIET_CHECK_MS = 90_000;

/** A stream's text is kept by XMLHttpRequest as it grows; past this many characters it is opened afresh. */
export const MAX_STREAM_CHARS = 256 * 1024;

export function reconnectDelayMs(failuresInARow: number): number {
  const i = Math.min(Math.max(failuresInARow, 1), RECONNECT_DELAYS_MS.length) - 1;
  return RECONNECT_DELAYS_MS[i];
}

export function shouldFallBack(failuresInARow: number): boolean {
  return failuresInARow >= FALLBACK_AFTER_FAILURES;
}

/** Done or failed, in any spelling the API has used (the enum's number, its name, camelCase). */
export function isTerminalStatus(status: unknown): boolean {
  return status === 2 || status === 3 || status === "done" || status === "Done" || status === "failed" || status === "Failed";
}
