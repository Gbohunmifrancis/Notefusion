import { useEffect, useState } from "react";
import { baseURL } from "../api/client";
import { onReachability, reachability, reportReachable, type Reachability } from "./reachability";

/**
 * "Can we reach NoteFusion right now?" without a native network module: a GET of the API's own
 * liveness route (`/health`, anonymous, ~20 bytes, checks nothing behind it) with a short timeout.
 * Everything else the app sends reports in too (client.ts), so this only runs when nothing has
 * spoken lately: the send queue before it tries an upload, and the app coming forward.
 */

const PROBE_TIMEOUT_MS = 5_000;
let inFlight: Promise<boolean> | null = null;

export function probeApi(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseURL}/health`, { method: "GET", signal: abort.signal, headers: { "Cache-Control": "no-cache" } });
      // Any answer is the API (or its host) answering; a 5xx still means the network works.
      reportReachable(true);
      return res.status < 500;
    } catch {
      reportReachable(false);
      return false;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** The last word on reachability, as React state. */
export function useReachability(): Reachability {
  const [state, setState] = useState<Reachability>(reachability());
  useEffect(() => {
    setState(reachability());
    return onReachability(setState);
  }, []);
  return state;
}
