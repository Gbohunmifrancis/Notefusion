import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toApiError } from "../api/client";

/**
 * What the phone admin has read from the API, held in memory only (board f-admin/11, "The data"): never written to
 * AsyncStorage, the offline library or any file, and dropped when Admin locks and when the account signs out or
 * changes (`clearAdminData`). A screen opened again within the session shows what it last read at once and asks
 * again behind it.
 */

interface Entry {
  data: unknown;
  at: number;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Changes on every clear, so a request that answers after one is not written back. */
let epoch = 0;

function emit(): void {
  for (const l of listeners) l();
}

export function clearAdminData(): void {
  epoch += 1;
  entries.clear();
  emit();
}

export function readAdminData<T>(key: string): T | undefined {
  return entries.get(key)?.data as T | undefined;
}

export function writeAdminData<T>(key: string, data: T): void {
  entries.set(key, { data, at: Date.now() });
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** What another screen read under `key`, kept current; undefined until something reads it. */
export function useAdminData<T>(key: string): T | undefined {
  return useSyncExternalStore(subscribe, () => readAdminData<T>(key));
}

export interface AdminQuery<T> {
  data: T | undefined;
  /** A plain sentence (`toApiError`), never the server's or a provider's own text. */
  error: string | null;
  /** The first read, with nothing to show yet. */
  loading: boolean;
  /** A read behind data already shown (pull to refresh, a re-check). */
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Reads `key` through `fetcher` while `enabled`, keeping the answer in memory for the session. `key` must change
 * whenever what is asked for does (a filter, a page, a window).
 */
export function useAdminQuery<T>(key: string, fetcher: () => Promise<T>, enabled = true): AdminQuery<T> {
  const data = useSyncExternalStore(subscribe, () => readAdminData<T>(key));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const live = useRef(true);

  const run = useCallback(async () => {
    const started = epoch;
    setBusy(true);
    try {
      const value = await fetcherRef.current();
      if (started === epoch) writeAdminData(key, value);
      if (live.current) setError(null);
    } catch (e) {
      if (live.current) setError(toApiError(e).message);
    } finally {
      if (live.current) setBusy(false);
    }
  }, [key]);

  useEffect(() => {
    live.current = true;
    if (enabled) void run();
    return () => {
      live.current = false;
    };
  }, [run, enabled]);

  return { data, error, loading: busy && data === undefined, refreshing: busy && data !== undefined, refresh: run };
}
