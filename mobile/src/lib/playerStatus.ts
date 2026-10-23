import { useEffect, useState } from "react";
import type { AudioPlayer, AudioStatus } from "expo-audio";

/**
 * The one event this hook needs from the player. At runtime every `AudioPlayer` is an expo SharedObject with
 * `addListener`; its declared type loses that because expo-modules-core sits nested under `expo` in node_modules.
 */
interface StatusSource {
  addListener(event: "playbackStatusUpdate", listener: (status: AudioStatus) => void): { remove(): void };
}

/**
 * Listens to the player's status and, once the listener is attached, hands over what it already says: a player that
 * loaded before anyone listened is still heard as loaded. Returns the unsubscribe.
 */
export function followStatus(player: AudioPlayer, onStatus: (status: AudioStatus) => void): () => void {
  const sub = (player as unknown as StatusSource).addListener("playbackStatusUpdate", onStatus);
  onStatus(player.currentStatus);
  return () => sub.remove();
}

/**
 * A player's status, as expo-audio's `useAudioPlayerStatus` gives it, without the two ways that one goes stale.
 *
 * Android's player says "loaded" once, as it becomes ready, and while paused says nothing more. expo's hook only
 * listens from its effect, after the render that made the player, so a local file that loads first is never heard:
 * the status stays "not loaded" and the play button stays grey for good. And when the source changes, expo's hook
 * keeps the old player's last status until the new one speaks. Here the player's own status is read the moment
 * the listener is attached, and a status from another player is never returned.
 */
export function usePlayerStatus(player: AudioPlayer): AudioStatus {
  const [heard, setHeard] = useState<{ player: AudioPlayer; status: AudioStatus }>(() => ({
    player,
    status: player.currentStatus,
  }));

  useEffect(() => followStatus(player, (status) => setHeard({ player, status })), [player]);

  return heard.player === player ? heard.status : player.currentStatus;
}
