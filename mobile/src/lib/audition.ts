import { File, Paths } from "expo-file-system";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { ensurePiano } from "./piano";
import { synthesizeMelodyWavBase64 } from "./synth";
import type { NoteEvent } from "../api/types";

/**
 * Plays one note, once — the "is this the pitch I actually sang?" check behind
 * tap-to-correct (F-07).
 *
 * Deliberately not built on `useNotePlayer`: that hook owns a transport UI
 * (progress bar, seeking, which syllable is lit) and reloads on every payload
 * change. Auditioning a note is fire-and-forget, so it uses the imperative
 * `createAudioPlayer` instead. Only one audition is ever alive — a second tap
 * replaces the first rather than layering two tones.
 */

interface Audition {
  player: AudioPlayer;
  file: File;
}

let current: Audition | null = null;

/**
 * Bumped by every call. Setting the audio mode is asynchronous, so two quick taps
 * could otherwise both reach `play()` and layer two tones — the loser checks this
 * after the await and bows out.
 */
let generation = 0;

/** Best-effort teardown; a leftover cache file or player is not worth throwing over. */
function dispose(audition: Audition | null): void {
  if (!audition) return;
  try {
    audition.player.remove();
  } catch {
    // Already released.
  }
  deleteQuietly(audition.file);
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Already gone or locked.
  }
}

/**
 * Synthesises `note` on its own and plays it immediately.
 *
 * The note is moved to beat 0 (its real onset may be 40 bars in, which would
 * otherwise synthesise 40 bars of silence) and given at least a beat of length,
 * so a semiquaver is still long enough to hear as a pitch rather than a click.
 */
export async function auditionNote(note: NoteEvent, tempoBpm: number): Promise<void> {
  const mine = ++generation;
  dispose(current);
  current = null;

  // A pitch check wants the real piano, not the fallback voice, so wait for the samples
  // (already in memory on any tap after the app's first second).
  await ensurePiano();
  if (mine !== generation) return;

  const wav = synthesizeMelodyWavBase64(
    [{ ...note, startBeat: 0, durBeats: Math.max(note.durBeats, 1) }],
    tempoBpm,
  );
  if (!wav) return;

  const file = new File(Paths.cache, `notefusion-audition-${Date.now()}.wav`);
  file.write(wav, { encoding: "base64" });

  // The silent switch shouldn't silence a deliberate tap on "Hear it" (iOS).
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  if (mine !== generation) {
    deleteQuietly(file); // superseded while we waited
    return;
  }

  const player = createAudioPlayer({ uri: file.uri });
  current = { player, file };
  player.play();
}

/** Releases the last audition. Call when the editor closes. */
export function stopAudition(): void {
  generation++;
  dispose(current);
  current = null;
}
