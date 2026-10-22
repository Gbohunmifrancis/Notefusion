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

/** Long enough for the sheet to be on screen and read before Google's card slides over it. */
const REVIEW_DELAY_MS = 2500;

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
 * Google's in-app review card, asked with no question before it (Google's in-app review guidance: no "do you like
 * the app?" ahead of the card, so every rating reaches the store, not only the happy ones). Google decides whether the
 * card shows (a quota per person) and never says whether they rated. Loaded only here, inside the try: a store build
 * older than the module has no native side, and an update published to its runtime must not crash on start.
 */
async function requestInAppReview(): Promise<void> {
  try {
    const StoreReview = await import("expo-store-review");
    if (await StoreReview.isAvailableAsync()) await StoreReview.requestReview();
  } catch {
    // No module in this build, or Play could not show it: nothing to say to the person.
  }
}

/**
 * The rating ask. Screens only report what happened — a sheet saved, a job failed — and Google's card is asked for
 * when `ratingPolicy` says the moment has come; feedback stays the person's own choice (Profile › Send feedback).
 *
 * Android only for now: there is no App Store listing yet.
 */
export const rating = {
  /**
   * Counts a saved sheet, and on the third (then no sooner than ninety days later) asks Google for its review card,
   * a moment after the sheet is on screen.
   */
  async recordSave(): Promise<void> {
    if (Platform.OS !== "android") return;
    const s = await read();
    const now = Date.now();
    const next = { ...s, saves: s.saves + 1 };
    if (!shouldAskForRating(next, now)) {
      write(next);
      return;
    }
    // Whether they rated is never known, so the ask waits its ninety days rather than ending.
    write({ ...next, snoozedUntil: now + SNOOZE_MS });
    setTimeout(() => void requestInAppReview(), REVIEW_DELAY_MS);
  },

  async recordFailure(): Promise<void> {
    const s = await read();
    write({ ...s, lastFailureAt: Date.now() });
  },

  /**
   * Profile's "Rate Notefusion": opens the listing and never asks again, whether or not they leave a rating. Not
   * Google's card, which may not show at all when asked from a button.
   */
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
