/**
 * One fetch, three states, an abort on unmount. This is the whole state layer — with two
 * read endpoints there is nothing for a cache library to earn.
 *
 * `fetcher` must be stable (wrap it in `useCallback`); it takes the abort signal so a
 * range change mid-flight cancels the request it supersedes instead of racing it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(fetcher: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // Keeps stale responses from overwriting fresh ones when two loads overlap.
  const latest = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const run = ++latest.current;

    setLoading(true);
    fetcher(controller.signal)
      .then((result) => {
        if (run !== latest.current) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        // An abort is the caller's own doing, not a failure to report.
        if (controller.signal.aborted || run !== latest.current) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (run === latest.current) setLoading(false);
      });

    return () => controller.abort();
  }, [fetcher, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload };
}

/** Delays a fast-changing value, so a search box does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
