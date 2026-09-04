import { InteractionManager } from "react-native";
import { File, Paths } from "expo-file-system";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { synthesizeMelodyWavBase64 } from "./synth";

/**
 * A playable keyboard: one pre-rendered sample per pitch, each held open in its own
 * native player, wound back and buffered ahead of time so that pressing a key is a
 * single `play()` and nothing else.
 *
 * That is the whole reason this exists rather than a `synthesizeMelodyWavBase64`
 * call per tap. Rendering one note measures ~18 ms on desktop V8 and several times
 * that under Hermes — far past the point where a key still feels connected to the
 * finger, and it would land on the JS thread the game is already using to judge
 * timing. So every cost (the render, the cache write, the player construction, the
 * first buffer fill, the one audio-mode switch) is hoisted into a warm-up the user
 * watches happen, and the tap path does no work at all.
 *
 * The rewind is hoisted the same way. A player that has just sounded is parked at
 * the end of its clip, and seeking it back is a promise over a native call that
 * `play()` then waits on — audible as a late note. So the seek happens *after* the
 * sound instead, in the silence between presses, and the press finds the voice
 * already armed. See `rearmVoice`.
 *
 * Follows `audition.ts`, the app's other imperative player, down to its generation
 * counter — warm-up is a long await, so a screen that unmounts halfway through
 * would otherwise leave a dozen native players alive with nothing holding them.
 */

interface Voice {
  player: AudioPlayer;
  /**
   * True while the player sits paused at position 0 with its buffer filled, so a
   * press is a single `play()` and nothing else.
   */
  armed: boolean;
  /** Pending re-arm, cancelled by a repeat press so the timer cannot cut the note. */
  rearm: ReturnType<typeof setTimeout> | null;
  /**
   * Bumped by every press.
   *
   * `rearmVoice` finishes asynchronously, so without this a press landing in the gap
   * between its `pause()` and its seek resolving would let the seek report back
   * "armed" about a player that is now mid-note. The next press would then trust
   * `armed`, skip the rewind and call `play()` on something already playing — which
   * does nothing audible, so the key simply stops responding.
   */
  epoch: number;
}

interface Keyboard {
  voices: Map<number, Voice>;
  files: File[];
}

/**
 * Seek tolerance, in ms. A seek with no tolerance is frame-exact, which on Android
 * means decoding back to the preceding sync sample; these clips have one sync point
 * at the start, so anything up to a full clip length lands in the same place and
 * costs less to get to.
 */
const SEEK_TOL_MS = 250;

/** Used when the player has not reported a duration yet. Two beats and a ring-out. */
const FALLBACK_CLIP_MS = 1400;

/**
 * Grace on top of the clip before a played key is wound back. Re-arming early would
 * cut the ring-out; re-arming late only means a fast repeat pays for one seek.
 */
const REARM_MARGIN_MS = 150;

/**
 * One key's sample. Rendered at a fixed tempo and length rather than at the piece's
 * tempo: a key is an instrument, not a note in the score, so how long it rings has
 * nothing to do with how fast the music goes. Two beats at 120 BPM is a second of
 * note plus its ring-out.
 */
const KEY_DUR_BEATS = 2;
const KEY_TEMPO_BPM = 120;

let current: Keyboard | null = null;

/**
 * Bumped by every `prepareKeyboard` and every `releaseKeyboard`. Warming up 20-odd
 * keys is seconds of awaits, and the loser of a race has to know to throw away what
 * it built instead of installing it over the winner.
 */
let generation = 0;

/** Best-effort teardown; a leftover cache file or player is not worth throwing over. */
function dispose(keyboard: Keyboard | null): void {
  if (!keyboard) return;
  for (const voice of keyboard.voices.values()) {
    if (voice.rearm) clearTimeout(voice.rearm);
    try {
      voice.player.remove();
    } catch {
      // Already released.
    }
  }
  for (const file of keyboard.files) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Already gone, or locked by a player that has not finished releasing.
    }
  }
}

/** Hands the JS thread back, so a progress readout between keys actually paints. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}

/**
 * Renders and loads a player for every pitch in `pitches`, replacing any keyboard
 * already loaded.
 *
 * @param onProgress Called after each key with how many are done, so the caller can
 * show the warm-up rather than appear to hang through it.
 * @returns Whether this call's keyboard is the one now installed. `false` means it
 * was superseded or released while it was still building, and the caller should drop
 * whatever it was going to do next.
 */
export async function prepareKeyboard(
  pitches: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<boolean> {
  const mine = ++generation;
  dispose(current);
  current = null;

  // Once for the whole set, not once per key: it is an await, and 20 of them is a
  // second of warm-up spent on a switch that only has to be flipped once. The
  // silent switch shouldn't silence a game the user is deliberately playing (iOS).
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  if (mine !== generation) return false;

  // One stamp for the whole set, so a rebuild writes fresh files rather than trying
  // to overwrite ones the previous keyboard's players may still hold open.
  const stamp = Date.now();
  const built: Keyboard = { voices: new Map(), files: [] };

  for (let i = 0; i < pitches.length; i++) {
    const pitch = pitches[i]!;
    const wav = synthesizeMelodyWavBase64(
      [
        {
          pitchMidi: pitch,
          startBeat: 0,
          durBeats: KEY_DUR_BEATS,
          degree: 1,
          solfa: "",
          octaveMark: "",
          conf: 1,
        },
      ],
      KEY_TEMPO_BPM,
    );
    if (mine !== generation) {
      dispose(built);
      return false;
    }
    if (!wav) continue;

    const file = new File(Paths.cache, `notefusion-key-${stamp}-${pitch}.wav`);
    file.write(wav, { encoding: "base64" });
    built.files.push(file);

    const player = createAudioPlayer({ uri: file.uri });
    // Seek before anyone can press it. A player built from a uri does not read the
    // file until it has to, so without this the *first* press of every key pays for
    // opening and buffering it — which is exactly the press whose latency gets
    // noticed. Awaited here because the warm-up is already a wait the user is
    // watching, and it is the whole point of having one.
    try {
      await player.seekTo(0, SEEK_TOL_MS, SEEK_TOL_MS);
    } catch {
      // Unprepared is survivable: the first press will do it, just more slowly.
    }
    built.voices.set(pitch, { player, armed: true, rearm: null, epoch: 0 });

    onProgress?.(i + 1, pitches.length);
    await yieldToUi();
    if (mine !== generation) {
      dispose(built);
      return false;
    }
  }

  current = built;
  return true;
}

/**
 * Winds a voice back to the start and leaves it paused, ready for the next press.
 *
 * This runs *after* a note has finished ringing rather than before the next one
 * starts, which is the whole trick: a rewind is the expensive half of sounding a
 * key, so it is done in the silence nobody is listening to instead of in the
 * milliseconds between a finger landing and the note being expected.
 */
function rearmVoice(voice: Voice): void {
  voice.rearm = null;
  const epoch = voice.epoch;
  try {
    voice.player.pause();
    voice.player.seekTo(0, SEEK_TOL_MS, SEEK_TOL_MS).then(
      () => {
        // Only if nothing has been pressed since: a press during the seek means the
        // player is sounding again, and calling it armed would silence the next one.
        if (voice.epoch === epoch) voice.armed = true;
      },
      () => {
        // Left unarmed; the next press seeks for itself.
      },
    );
  } catch {
    // Released underneath the timer.
  }
}

/**
 * Sounds one key. Silent for a pitch that was never prepared, which is the right
 * behaviour rather than an error — the caller draws its keys from the same list it
 * warmed up, so a miss here means a key was pressed while the keyboard was being
 * rebuilt.
 *
 * An armed voice is already sitting at position 0 with a full buffer, so the press
 * path is one synchronous `play()`. That matters more than it looks: `seekTo` is a
 * promise over a native call, and issuing one immediately before `play()` — even
 * unawaited — makes the player wait for the seek to land before it starts, which is
 * a delay a finger on a key can hear. The seek moves to `rearmVoice`, after the
 * sound, and only a repeat inside the same note still pays for one.
 */
export function playKey(pitch: number): void {
  const voice = current?.voices.get(pitch);
  if (!voice) return;

  voice.epoch++;

  // A pending re-arm belongs to the previous press. Leaving it running would pause
  // the note this press is about to start.
  if (voice.rearm) {
    clearTimeout(voice.rearm);
    voice.rearm = null;
  }

  try {
    // `armed` is bookkeeping and the player is the truth, so check both. A voice that
    // is still sounding needs the rewind whatever the flag says — `play()` on a player
    // that is already playing is a no-op, and a no-op reads as a dead key.
    if (voice.armed && !voice.player.playing) {
      voice.armed = false;
    } else {
      // Mid-note repeat: there is one player per pitch, so restarting it is the only
      // way to retrigger, and the seek cannot be avoided.
      voice.armed = false;
      void voice.player.seekTo(0, SEEK_TOL_MS, SEEK_TOL_MS);
    }
    voice.player.play();

    const clipMs = voice.player.duration > 0 ? voice.player.duration * 1000 : FALLBACK_CLIP_MS;
    voice.rearm = setTimeout(() => rearmVoice(voice), clipMs + REARM_MARGIN_MS);
  } catch {
    // Released underneath us, most likely an unmount racing a press.
  }
}

/** Releases every player and cache file. Call on unmount. */
export function releaseKeyboard(): void {
  generation++;
  dispose(current);
  current = null;
}
