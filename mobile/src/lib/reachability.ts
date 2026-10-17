/**
 * Whether the API answered lately, as the app last heard it. No native module (netinfo is not in
 * the store builds, and this must ship over the air): every axios answer reports in through
 * `reportReachable` (client.ts), a request that got no answer reports `false`, and
 * `connectivity.ts` probes `/health` when nothing else has spoken. Pure — no imports — so the API
 * client can report into it without a cycle.
 */

export type Reachability = "online" | "offline" | "unknown";

let state: Reachability = "unknown";
const listeners = new Set<(s: Reachability) => void>();

export function reachability(): Reachability {
  return state;
}

/** True only when the last word was "could not reach it": unknown is not offline. */
export function isOffline(): boolean {
  return state === "offline";
}

export function reportReachable(reached: boolean): void {
  const next: Reachability = reached ? "online" : "offline";
  if (next === state) return;
  state = next;
  for (const fn of listeners) fn(state);
}

export function onReachability(fn: (s: Reachability) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `toApiError` codes that mean the request never got an answer: try again later, keep everything. */
export const NETWORK_CODES: ReadonlySet<string> = new Set(["NETWORK_OFFLINE", "NETWORK_TIMEOUT"]);

export function isNetworkCode(code: string | null | undefined): boolean {
  return !!code && NETWORK_CODES.has(code);
}
