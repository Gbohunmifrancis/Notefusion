import { useCallback, useEffect, useRef, useState } from "react";

/** A sheet that opens faster than this never shows "Opening…", so a quick open does not blink. */
export const OPENING_SHOWN_AFTER_MS = 300;

/**
 * The saved sheet being opened from a list (board m-ux-medium P2b): from the tap until the Result screen opens, the
 * tapped row says "Opening…" with a spinner, once 300 ms have passed. `begin` refuses a second open while one loads —
 * a second tap would push a second Result.
 */
export function useOpening() {
  const [opening, setOpening] = useState<string | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const begin = useCallback((id: string): boolean => {
    if (busy.current) return false;
    busy.current = true;
    timer.current = setTimeout(() => setOpening(id), OPENING_SHOWN_AFTER_MS);
    return true;
  }, []);

  const end = useCallback(() => {
    busy.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpening(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { opening, begin, end };
}
