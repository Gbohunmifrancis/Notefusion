import { test } from "node:test";
import assert from "node:assert/strict";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import { followStatus } from "./playerStatus.ts";

/** Android's player as it behaves: one "loaded" event as it becomes ready, then silence while paused. */
function fakePlayer() {
  const listeners = new Set<(s: AudioStatus) => void>();
  let status = { isLoaded: false, playing: false, currentTime: 0, duration: 0 } as AudioStatus;
  return {
    get currentStatus() {
      return status;
    },
    addListener(_event: string, l: (s: AudioStatus) => void) {
      listeners.add(l);
      return { remove: () => listeners.delete(l) };
    },
    /** The native side reaching READY: it tells whoever is listening at that moment. */
    load() {
      status = { ...status, isLoaded: true, duration: 12 };
      for (const l of listeners) l(status);
    },
    listening: () => listeners.size,
  };
}

test("a player that loaded before anyone listened is still heard as loaded", () => {
  const player = fakePlayer();
  player.load(); // a local WAV is ready before the screen's effect attaches its listener
  const heard: AudioStatus[] = [];

  followStatus(player as unknown as AudioPlayer, (s) => heard.push(s));

  assert.equal(heard.at(-1)?.isLoaded, true);
  assert.equal(heard.at(-1)?.duration, 12);
});

test("later events are heard, and none after the unsubscribe", () => {
  const player = fakePlayer();
  const heard: AudioStatus[] = [];

  const stop = followStatus(player as unknown as AudioPlayer, (s) => heard.push(s));
  assert.equal(heard.at(-1)?.isLoaded, false);
  player.load();
  assert.equal(heard.at(-1)?.isLoaded, true);

  stop();
  assert.equal(player.listening(), 0);
});
