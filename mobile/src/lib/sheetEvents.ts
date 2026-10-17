/**
 * Saved-sheet changes as the API confirmed them: `api/endpoints.ts` reports every library write
 * here, and the offline library (`offlineLibrary.ts`) keeps its copies level with them. A plain
 * emitter with no imports, so the endpoints can report without depending on the cache.
 */
import type { SavedTranscription } from "../api/types";

export type SheetEvent = { type: "saved"; sheet: SavedTranscription } | { type: "removed"; id: string };

const listeners = new Set<(e: SheetEvent) => void>();

export function onSheetEvent(fn: (e: SheetEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitSheetEvent(e: SheetEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      // A listener's failure is its own; the API call it reports on succeeded.
    }
  }
}

/** For `.then(sheetSaved)`: reports the sheet and hands it on unchanged. */
export function sheetSaved(sheet: SavedTranscription): SavedTranscription {
  emitSheetEvent({ type: "saved", sheet });
  return sheet;
}
