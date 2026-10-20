import AsyncStorage from "@react-native-async-storage/async-storage";
import { readPendingPreview, type PendingPreview } from "./guestPreview";

const KEY = "nf.guestPreview";

/**
 * The guest's preview on this phone (`lib/guestPreview`), from the moment the API has the take until an account
 * keeps it: closing the preview, or the app, does not lose it. Not a credential — the job id is the API's own
 * handle on an anonymous preview — so AsyncStorage, and best-effort like the onboarding flag.
 */
export const guestPreviewStore = {
  async read(): Promise<PendingPreview | null> {
    try {
      return readPendingPreview(await AsyncStorage.getItem(KEY));
    } catch {
      return null;
    }
  },
  async save(preview: PendingPreview): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(preview)).catch(() => undefined);
  },
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(KEY).catch(() => undefined);
  },
};
