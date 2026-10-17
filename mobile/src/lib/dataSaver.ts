import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The Data saver switch (Settings → Offline & data). On by default: most of our singers are on
 * mobile data, and a phone cannot tell us here whether it is on Wi-Fi (that needs netinfo, a native
 * module this over-the-air update cannot add), so the careful setting is the one we start with.
 *
 * What it changes is in `dataPolicy.ts` (pure) and its callers: a smaller recording upload
 * (`recordingPreset.ts`), no profile pictures or song artwork, slower job polling, and the hymn
 * pack refreshed only when asked. Held in module scope like the haptics flag, so a read is free.
 */

const KEY = "nf.dataSaver";

let on = true;
let loaded: Promise<void> | null = null;
const listeners = new Set<(on: boolean) => void>();

export function loadDataSaver(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const stored = await AsyncStorage.getItem(KEY);
        if (stored !== null) setLocal(stored === "true");
      } catch {
        // Unreadable: the default stands.
      }
    })();
  }
  return loaded;
}
void loadDataSaver();

function setLocal(next: boolean): void {
  if (next === on) return;
  on = next;
  for (const fn of listeners) fn(on);
}

export function dataSaverOn(): boolean {
  return on;
}

export async function setDataSaver(next: boolean): Promise<void> {
  setLocal(next);
  await AsyncStorage.setItem(KEY, String(next)).catch(() => undefined);
}

/** The switch as React state; follows changes made anywhere in the app. */
export function useDataSaver(): boolean {
  const [value, setValue] = useState(on);
  useEffect(() => {
    setValue(on);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
