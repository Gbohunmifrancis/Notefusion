/**
 * The last support message this phone has shown (its time), so Home's chat bubble can show a dot for an answer not yet
 * read. Kept per device; the server's own "read" is what the console sees.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "nf.support.seen";

export async function supportSeenAt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function markSupportSeen(isoUtc: string): Promise<void> {
  try {
    const was = await AsyncStorage.getItem(KEY);
    if (!was || isoUtc > was) await AsyncStorage.setItem(KEY, isoUtc);
  } catch {
    // Storage refused: the dot may show once more.
  }
}

/** True when the newest message is an answer newer than the last one shown here. */
export function hasUnreadAnswer(messages: readonly { fromAdmin: boolean; createdAtUtc: string }[], seenAt: string | null): boolean {
  const last = messages[messages.length - 1];
  return !!last && last.fromAdmin && (!seenAt || last.createdAtUtc > seenAt);
}
