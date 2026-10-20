import AsyncStorage from "@react-native-async-storage/async-storage";
import { readPendingVerify, type PendingVerify } from "./pendingVerify";

const KEY = "nf.pendingVerify";

/**
 * The code waiting to be typed (`lib/pendingVerify`), kept while the code screen is open. Best-effort, like the
 * onboarding flag: losing it costs a trip back through sign-in, nothing worse.
 */
export const pendingVerifyStore = {
  /** The code still good now; an expired one is forgotten on the way. */
  async read(): Promise<PendingVerify | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const pending = readPendingVerify(raw, Date.now());
      if (raw && !pending) AsyncStorage.removeItem(KEY).catch(() => undefined);
      return pending;
    } catch {
      return null;
    }
  },
  save(pending: PendingVerify): void {
    AsyncStorage.setItem(KEY, JSON.stringify(pending)).catch(() => undefined);
  },
  clear(): void {
    AsyncStorage.removeItem(KEY).catch(() => undefined);
  },
};
