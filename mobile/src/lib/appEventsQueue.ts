import type { AppEventInput } from "../api/types";

/**
 * The pure half of lib/appEvents: how an event is named, given an id and its details written, how a native event
 * becomes one the API takes, how the kept list is bounded, and what a failed send means. Tested on its own
 * (appEventsQueue.test.ts).
 */

export type Detail = Record<string, string | number | boolean | null | undefined>;

/** At most this many kept on the phone; past it the oldest go first. */
export const MAX_KEPT = 2000;
/** The server's own limit on a detail string (`AppEvent.DetailMaxLength`). */
export const DETAIL_MAX = 300;
/** The server's own limit on a name, and the shape it takes (`^[a-z][a-z0-9_]*$`). */
export const NAME_MAX = 60;
/** How long to wait after the first, second and third failed send; after that, the next time the app moves. */
export const RETRY_DELAYS_MS = [4_000, 15_000, 60_000] as const;

/** Any name as one the server takes: lower case, anything but a-z 0-9 _ as `_`, `e_` before a leading digit, cut to 60. */
export function eventName(name: string): string {
  let out = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z]/.test(out)) out = `e_${out}`;
  return out.slice(0, NAME_MAX);
}

/**
 * A fresh id the server can tell a repeat by: the time in base 36 and random letters, 16–20 characters of [a-z0-9].
 * `random` is there for the tests.
 */
export function newEventId(now: number = Date.now(), random: () => number = Math.random): string {
  let tail = "";
  while (tail.length < 8) tail += Math.floor(random() * 36).toString(36);
  return `${now.toString(36)}${tail}`;
}

/** `{ from: "tile", sec: 42 }` → `from=tile;sec=42`. Separators in a value are dropped; empty values are left out. */
export function formatDetail(detail?: Detail): string | null {
  if (!detail) return null;
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(detail)) {
    if (raw === null || raw === undefined || raw === "") continue;
    const value = typeof raw === "boolean" ? (raw ? "1" : "0") : String(raw);
    const k = key.replace(/[;=\s]/g, "");
    const v = value.replace(/[;=]/g, " ").trim();
    if (k && v) parts.push(`${k}=${v}`);
  }
  const out = parts.join(";");
  return out ? out.slice(0, DETAIL_MAX) : null;
}

/** One event as the API takes it, stamped now with a new id. */
export function makeEvent(name: string, detail?: Detail, now: number = Date.now()): AppEventInput {
  return { id: newEventId(now), name: eventName(name), detail: formatDetail(detail), occurredAt: new Date(now).toISOString() };
}

/** The native log's `{name, detail, at}` (epoch ms) as the API's event, with an id of its own. */
export function nativeToInput(e: { name: string; detail?: string | null; at: number }): AppEventInput {
  return {
    id: newEventId(e.at),
    name: eventName(e.name),
    detail: e.detail ? e.detail.slice(0, DETAIL_MAX) : null,
    occurredAt: new Date(e.at).toISOString(),
  };
}

/** What was kept, as events: anything that is not one is dropped, and one kept by an older build without an id gets one. */
export function readKept(parsed: unknown): AppEventInput[] {
  if (!Array.isArray(parsed)) return [];
  const out: AppEventInput[] = [];
  for (const e of parsed as Partial<AppEventInput>[]) {
    if (!e || typeof e.name !== "string" || typeof e.occurredAt !== "string") continue;
    const at = Date.parse(e.occurredAt);
    out.push({
      id: typeof e.id === "string" && e.id ? e.id : newEventId(Number.isFinite(at) ? at : Date.now()),
      name: e.name,
      detail: typeof e.detail === "string" ? e.detail : null,
      occurredAt: e.occurredAt,
    });
  }
  return out;
}

/** The kept list with `added` on the end, the oldest dropped past `MAX_KEPT`. */
export function mergeQueue(kept: AppEventInput[], added: AppEventInput[]): AppEventInput[] {
  const all = kept.concat(added);
  return all.length > MAX_KEPT ? all.slice(all.length - MAX_KEPT) : all;
}

/** The kept list without the events just sent (by id: the list may have been trimmed or added to meanwhile). */
export function withoutSent(kept: AppEventInput[], sent: AppEventInput[]): AppEventInput[] {
  const ids = new Set(sent.map((e) => e.id));
  return kept.filter((e) => !ids.has(e.id));
}

/**
 * Whether a failed send means that batch can never go: only the server refusing the batch itself (400, 413). Signed out
 * (401/403), a server without the route yet (404), a timeout, too many (429), a server error or no network at all
 * (status 0) all keep it for later; the ids make sending it again harmless.
 */
export function dropsBatch(status: number): boolean {
  return status === 400 || status === 413;
}

/** How long to wait before trying again after `failures` failed sends in a row; null = wait for the app to move. */
export function retryDelay(failures: number): number | null {
  return failures >= 1 && failures <= RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[failures - 1] : null;
}
