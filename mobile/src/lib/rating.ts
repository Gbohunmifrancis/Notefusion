import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import {
  SNOOZE_MS,
  parseRatingState,
  shouldAskForRating,
  type RatingState,
} from "./ratingPolicy";

const KEY = "nf.rating";

type Listener = (saves: number) => void;
let listener: Listener | null = null;

async function read(): Promise<RatingState> {
  try {
    return parseRatingState(await AsyncStorage.getItem(KEY));
  } catch {
    return parseRatingState(null);
  }
}

function write(s: RatingState): void {
  AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => undefined);
}

/**
 * The store-rating ask. Screens only report what happened — a sheet saved, a job
 * failed — and `RatingPrompt` (mounted once, in App) decides whether to show
 * itself. See `ratingPolicy` for the rule.
 *
 * Android only for now: the ask opens the Play Store listing. Google's in-app
 * review sheet needs a native module, which waits for the next store build.
 */
export const rating = {
  /** The prompt registers here; one at a time. */
  subscribe(fn: Listener): () => void {
    listener = fn;
    return () => {
      if (listener === fn) listener = null;
    };
  },

  async recordSave(): Promise<void> {
    if (Platform.OS !== "android") return;
    const s = await read();
    const next = { ...s, saves: s.saves + 1 };
    write(next);
    if (shouldAskForRating(next, Date.now())) listener?.(next.saves);
  },

  async recordFailure(): Promise<void> {
    const s = await read();
    write({ ...s, lastFailureAt: Date.now() });
  },

  async snooze(): Promise<void> {
    const s = await read();
    write({ ...s, snoozedUntil: Date.now() + SNOOZE_MS });
  },

  /** Opens the listing and never asks again, whether or not they leave a rating. */
  async rate(): Promise<void> {
    const s = await read();
    write({ ...s, done: true });
    const id = Application.applicationId ?? "com.notefusion.com";
    try {
      await Linking.openURL(`market://details?id=${id}`);
    } catch {
      // No Play Store app (an emulator, a de-Googled phone): the web listing instead.
      await Linking.openURL(`https://play.google.com/store/apps/details?id=${id}`).catch(() => undefined);
    }
  },
};
