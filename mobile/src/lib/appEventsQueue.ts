import type { AppEventInput } from "../api/types";

/**
 * The pure half of lib/appEvents: how an event's details are written, how a native event becomes one the API takes,
 * and how the kept list is bounded. Tested on its own (appEventsQueue.test.ts).
 */

export type Detail = Record<string, string | number | boolean | null | undefined>;

/** At most this many kept on the phone; past it the oldest go first. */
export const MAX_KEPT = 300;
/** The server's own limit on a detail string (`AppEvent.DetailMaxLength`). */
export const DETAIL_MAX = 300;

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

/** The native log's `{name, detail, at}` (epoch ms) as the API's event. */
export function nativeToInput(e: { name: string; detail?: string | null; at: number }): AppEventInput {
  return {
    name: e.name,
    detail: e.detail ? e.detail.slice(0, DETAIL_MAX) : null,
    occurredAt: new Date(e.at).toISOString(),
  };
}

/** The kept list with `added` on the end, the oldest dropped past `MAX_KEPT`. */
export function mergeQueue(kept: AppEventInput[], added: AppEventInput[]): AppEventInput[] {
  const all = kept.concat(added);
  return all.length > MAX_KEPT ? all.slice(all.length - MAX_KEPT) : all;
}
