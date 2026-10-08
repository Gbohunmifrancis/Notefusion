import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDED_KEY = "nf.onboarded";

/**
 * Whether this install has been through the three intro cards. Someone who has
 * seen them and signed out later should land on the Welcome choices, not be
 * walked through the product again.
 */
export const onboarding = {
  async seen(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(ONBOARDED_KEY)) !== null;
    } catch {
      return false;
    }
  },
  markSeen(): void {
    // Best-effort: failing to write costs one more look at the cards, nothing worse.
    AsyncStorage.setItem(ONBOARDED_KEY, "1").catch(() => undefined);
  },
};
