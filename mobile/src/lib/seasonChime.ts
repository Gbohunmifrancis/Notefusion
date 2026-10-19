/**
 * The season's tune on the app's own piano (lib/synth, the same samples as everything else; no audio file): at
 * Christmas "Joy to the world" (d' t l s) as the cap lands on the season's first splash, and the whole first line
 * (d' t l s f m r d) when the Carol singer sticker is earned; at Halloween the Mountain King's tiptoe (l, t, d r m d m)
 * as the witch hat lands, and his first phrase for the Night Singer sticker. Never when the app's sound is off
 * (Notifications › Sound), never in the iPhone's silent mode, and mixed with whatever else is playing rather than
 * stopping it.
 *
 * JS only (expo-audio and expo-file-system, already in the app), so it ships over the air.
 */

import { File, Paths } from "expo-file-system";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import type { NoteEvent } from "../api/types";
import { ensurePiano } from "./piano";
import { loadNotificationPrefs, soundEnabled } from "./push";
import { CHIME_BPM, chimeSeconds } from "./season";
import { synthesizeMelodyWavBase64 } from "./synth";

/** The piano is read behind the splash (App.tsx); the chime waits this long for it, then rings on the synth's own voice. */
const PIANO_WAIT_MS = 500;

let playing: { player: AudioPlayer; file: File; timer: ReturnType<typeof setTimeout> } | null = null;

function release(): void {
  if (!playing) return;
  clearTimeout(playing.timer);
  try { playing.player.remove(); } catch { /* already released */ }
  try { if (playing.file.exists) playing.file.delete(); } catch { /* already gone */ }
  playing = null;
}

/**
 * Renders the notes now (at `bpm`), so the chime can start the moment it is due. Resolves with a function that plays
 * it (or with null when the app's sound is off or the clip could not be written); the clip cleans itself up when done.
 */
export async function prepareTune(notes: readonly NoteEvent[], bpm: number = CHIME_BPM): Promise<(() => void) | null> {
  await loadNotificationPrefs();
  if (!soundEnabled()) return null;
  await Promise.race([ensurePiano(), new Promise((r) => setTimeout(r, PIANO_WAIT_MS))]);
  let file: File;
  try {
    file = new File(Paths.cache, `notefusion-season-${Date.now()}.wav`);
    file.write(synthesizeMelodyWavBase64([...notes], bpm), { encoding: "base64" });
  } catch {
    return null;
  }
  return () => {
    // Asked again at the moment it plays: the switch may have been turned off in between.
    if (!soundEnabled()) {
      try { if (file.exists) file.delete(); } catch { /* gone */ }
      return;
    }
    release();
    try {
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers", allowsRecording: false });
      const player = createAudioPlayer({ uri: file.uri });
      player.volume = 0.85;
      player.play();
      playing = { player, file, timer: setTimeout(release, (chimeSeconds(notes, bpm) + 0.5) * 1000) };
    } catch {
      try { if (file.exists) file.delete(); } catch { /* gone */ }
    }
  };
}

/** Plays the notes once, now (the sticker's line). */
export async function playTune(notes: readonly NoteEvent[], bpm: number = CHIME_BPM): Promise<void> {
  const play = await prepareTune(notes, bpm);
  play?.();
}
