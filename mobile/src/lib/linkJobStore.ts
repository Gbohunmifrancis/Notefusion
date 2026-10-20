import AsyncStorage from "@react-native-async-storage/async-storage";
import { readLinkJob, type LinkJob } from "./linkJob";

const KEY = "nf.linkJob";

/**
 * The song link the Song link screen sent (`lib/linkJob`), from the API's answer until the job ends. Not a
 * credential — the job id is read with the account's own token — so AsyncStorage, and best-effort: losing it only
 * means the screen opens empty while the push still comes.
 */
export const linkJobStore = {
  /** This account's job while it is recent; anything else is forgotten on the way. */
  async read(userId: string): Promise<LinkJob | null> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const job = readLinkJob(raw, Date.now(), userId);
      if (raw && !job) AsyncStorage.removeItem(KEY).catch(() => undefined);
      return job;
    } catch {
      return null;
    }
  },
  save(job: LinkJob): void {
    AsyncStorage.setItem(KEY, JSON.stringify(job)).catch(() => undefined);
  },
  clear(): void {
    AsyncStorage.removeItem(KEY).catch(() => undefined);
  },
};
