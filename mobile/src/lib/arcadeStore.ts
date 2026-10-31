/**
 * The arcade's level per game, kept on this phone (`nf.arcade.<game>`, as the web keeps it in the browser): the level
 * to deal next and the best reached. The rules are `lib/practiceArcade` (`recallFrom`/`rememberOver`); this only reads
 * and writes AsyncStorage. A storage failure costs the level, never the game: it starts again at the track's first.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PracticeGameId, PracticeTrack } from "../api/types";
import { GAME_IDS } from "./practiceGames";
import { recallFrom, rememberOver, storageKey, type ArcadeKept } from "./practiceArcade";

/** A game's level and best here; the track's first level when none is kept. */
export async function recallArcade(game: PracticeGameId, track: PracticeTrack | null): Promise<ArcadeKept> {
  const raw = await AsyncStorage.getItem(storageKey(game)).catch(() => null);
  return recallFrom(raw, track);
}

/** Every game's level and best, for the hub's tiles. */
export async function recallAllArcade(track: PracticeTrack | null): Promise<Record<PracticeGameId, ArcadeKept>> {
  const pairs = await AsyncStorage.multiGet(GAME_IDS.map(storageKey)).catch(() => null);
  const raw = new Map(pairs ?? []);
  return Object.fromEntries(GAME_IDS.map((g) => [g, recallFrom(raw.get(storageKey(g)) ?? null, track)])) as Record<PracticeGameId, ArcadeKept>;
}

/** Keeps a game's level and its best (the best never falls). */
export async function rememberArcade(game: PracticeGameId, level: number): Promise<ArcadeKept> {
  const raw = await AsyncStorage.getItem(storageKey(game)).catch(() => null);
  const kept = rememberOver(raw, level);
  await AsyncStorage.setItem(storageKey(game), JSON.stringify(kept)).catch(() => undefined);
  return kept;
}
