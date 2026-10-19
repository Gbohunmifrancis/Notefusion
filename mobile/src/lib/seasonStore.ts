/**
 * The season flags on the phone (Christmas, Halloween; one at a time): read from `GET /api/app/season` at startup and
 * whenever the app comes forward, kept per device (AsyncStorage `nf.season`) so the next launch's splash can wear the
 * season's costume (the cap, the witch hat) before the network is up,
 * and held in module scope so every screen reads it for free and follows a change within the session.
 *
 * Fails closed to "no season": a phone that cannot reach the API keeps the last answer it had, and one that never had
 * one shows every screen as it always was. A few bytes a read, so Data saver needs no exception.
 */

import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { appApi } from "../api/endpoints";
import { NO_SEASON, SEASON_CACHE_KEY, parseSeason, sameSeason, seasonFrom, serializeSeason, type SeasonFlag } from "./season";

let current: SeasonFlag = NO_SEASON;
let loaded: Promise<void> | null = null;
const listeners = new Set<(s: SeasonFlag) => void>();

function setLocal(next: SeasonFlag): void {
  if (sameSeason(next, current)) return;
  current = next;
  for (const fn of listeners) fn(current);
}

/** The last answer this phone kept, read once (the splash reads it itself, before this module is asked). */
export function loadSeason(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(SEASON_CACHE_KEY)
      .then((text) => setLocal(parseSeason(text)))
      .catch(() => undefined);
  }
  return loaded;
}

/** Seeds the flag from what the launch already read, so Home dresses on its first frame. */
export function primeSeason(s: SeasonFlag): void {
  if (!loaded) loaded = Promise.resolve();
  setLocal(s);
}

export function season(): SeasonFlag {
  return current;
}

let inFlight: Promise<void> | null = null;

/** Asks the API and keeps the answer; an unreachable API leaves the last one standing. */
export function refreshSeason(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    await loadSeason();
    try {
      const next = seasonFrom(await appApi.season());
      setLocal(next);
      await AsyncStorage.setItem(SEASON_CACHE_KEY, serializeSeason(next)).catch(() => undefined);
    } catch {
      // Offline or a hiccup: what was kept stands.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** The flag as React state; follows a change read anywhere in the app. */
export function useSeason(): SeasonFlag {
  const [value, setValue] = useState(current);
  useEffect(() => {
    setValue(current);
    listeners.add(setValue);
    void loadSeason();
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

/**
 * Reads the flag now, each time the app comes forward and when the account changes (an admin's preview answers to
 * their token): RootNavigator, once, signed in or not.
 */
export function useSeasonSync(enabled: boolean, account: string | null): void {
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) return undefined;
    last.current = 0;
    const read = () => {
      // The API caches it for a minute: asking more often than that would only repeat the answer.
      if (Date.now() - last.current < 60_000) return;
      last.current = Date.now();
      void refreshSeason();
    };
    read();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") read();
    });
    return () => sub.remove();
  }, [enabled, account]);
}
