import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_BACKING_PREFS, clampBalance, parseBackingPrefs, type BackingPrefs } from "./backingSync";

/**
 * The "Song backing" switch and the Solfa · Backing balance, remembered on this phone for every sheet with backing
 * (board O1c), like the way of reading a sheet (`nf.result.view`). Read once at start and held in module scope, so a
 * Result opens on the stored choice rather than the default first and the remembered one a moment later.
 */

const KEY = "nf.result.backing";

let prefs: BackingPrefs = DEFAULT_BACKING_PREFS;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<(p: BackingPrefs) => void>();

export function loadBackingPrefs(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        prefs = parseBackingPrefs(await AsyncStorage.getItem(KEY));
      } catch {
        // Unreadable: the default stands.
      }
      loaded = true;
      for (const fn of listeners) fn(prefs);
    })();
  }
  return loading;
}
void loadBackingPrefs();

function store(next: BackingPrefs, persist: boolean): void {
  prefs = next;
  for (const fn of listeners) fn(prefs);
  if (persist) AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => undefined);
}

/**
 * The remembered switch and balance as React state, and their setters. `ready` is false for the moment before the
 * stored choice is read (the rows wait for it, so a switch left off never shows on first and folds away).
 * `setBalance(v, false)` moves the thumb without writing (a drag); the drag's end writes it.
 */
export function useBackingPrefs(): {
  on: boolean;
  balance: number;
  ready: boolean;
  setOn: (on: boolean) => void;
  setBalance: (balance: number, persist?: boolean) => void;
} {
  const [state, setState] = useState<{ p: BackingPrefs; ready: boolean }>({ p: prefs, ready: loaded });
  useEffect(() => {
    const fn = (p: BackingPrefs) => setState({ p, ready: loaded });
    listeners.add(fn);
    fn(prefs);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const setOn = useCallback((on: boolean) => store({ ...prefs, on }, true), []);
  const setBalance = useCallback(
    (balance: number, persist = true) => store({ ...prefs, balance: clampBalance(balance) }, persist),
    [],
  );
  return { on: state.p.on, balance: state.p.balance, ready: state.ready, setOn, setBalance };
}
