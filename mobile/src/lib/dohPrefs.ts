import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EMPTY_DOH_MEMORY, parseDohMemory, type DohMemory } from "./dohSuggestion";

/**
 * What the phone keeps for Doh outside Practice (boards c-practice/8a–8c), all on the device:
 *
 *  - the "Doh's suggestions" switch in Settings (on by default) — off, Home shows no Doh card;
 *  - the Home card's memory (`lib/dohSuggestion`), per account, so × and "once a day" hold across launches;
 *  - the jobs whose result was already celebrated, so the result toast shows on a sheet's first open only.
 *
 * The switch is held in module scope like the data saver, so a read is free.
 */

const SWITCH_KEY = "nf.dohSuggestions";
const memoryKey = (userId: string) => `nf.doh.card.${userId}`;
const CELEBRATED_KEY = "nf.doh.celebrated";
/** Job ids remembered for the toast; a job opened again later than this many jobs ago is long past fresh. */
const CELEBRATED_KEEP = 20;

let on = true;
let loaded: Promise<void> | null = null;
const listeners = new Set<(on: boolean) => void>();

export function loadDohSuggestions(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const stored = await AsyncStorage.getItem(SWITCH_KEY);
        if (stored !== null) setLocal(stored === "true");
      } catch {
        // Unreadable: the default stands.
      }
    })();
  }
  return loaded;
}
void loadDohSuggestions();

function setLocal(next: boolean): void {
  if (next === on) return;
  on = next;
  for (const fn of listeners) fn(on);
}

export async function setDohSuggestions(next: boolean): Promise<void> {
  setLocal(next);
  await AsyncStorage.setItem(SWITCH_KEY, String(next)).catch(() => undefined);
}

/** The switch as React state; follows changes made anywhere in the app. */
export function useDohSuggestions(): boolean {
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

export async function loadDohMemory(userId: string): Promise<DohMemory> {
  try {
    return parseDohMemory(await AsyncStorage.getItem(memoryKey(userId)));
  } catch {
    return EMPTY_DOH_MEMORY;
  }
}

export function saveDohMemory(userId: string, memory: DohMemory): Promise<void> {
  return AsyncStorage.setItem(memoryKey(userId), JSON.stringify(memory)).catch(() => undefined);
}

/**
 * True the first time a finished job's result is asked about, false after: the result toast celebrates a sheet once,
 * whether it was opened from the job or from its notification.
 */
export async function firstCelebration(jobId: string): Promise<boolean> {
  let ids: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(CELEBRATED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // Unreadable: celebrate; a second toast is the lesser harm than a missing one.
  }
  if (ids.includes(jobId)) return false;
  await AsyncStorage.setItem(CELEBRATED_KEY, JSON.stringify([...ids, jobId].slice(-CELEBRATED_KEEP))).catch(() => undefined);
  return true;
}
