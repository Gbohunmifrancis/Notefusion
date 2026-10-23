import type { SynthOptions, SynthVoice } from "./synth";

/**
 * What the player is asked to play: the recipe (the voices, the tempo, the options), not the audio. lib/melodyAudio makes
 * the WAV from it in slices (lib/synth `voicesWav`), with the screen drawn and taps answered between them, and keeps it
 * on the phone under `sourceKey`, so a sheet opened again, or a tempo or part tried before, plays at once.
 */
export interface VoicesSource {
  voices: readonly SynthVoice[];
  tempoBpm: number;
  opts?: SynthOptions;
}

/** The recipe for these voices, or null when none has a note: nothing to play, so no player (as an empty clip was). */
export function voicesSource(voices: readonly SynthVoice[], tempoBpm: number, opts?: SynthOptions): VoicesSource | null {
  return voices.some((v) => v.notes.length > 0) ? { voices, tempoBpm, ...(opts ? { opts } : {}) } : null;
}

/** Bumped whenever lib/synth's sound changes, so no clip made by the old one is played again. */
const SOUND_VERSION = 1;
/** How long a slice may hold the screen before it gets a turn. */
const SLICE_MS = 12;

/** One clip's name: the same recipe always names the same file. */
export function sourceKey(source: VoicesSource): string {
  const parts = [`v${SOUND_VERSION}`, String(source.tempoBpm), JSON.stringify(source.opts ?? {})];
  for (const v of source.voices) {
    parts.push(`g${v.gain}`);
    for (const n of v.notes) parts.push(`${n.pitchMidi},${n.startBeat},${n.durBeats},${n.conf}`);
  }
  return hash(parts.join("|"));
}

/** Two FNV-1a passes with different seeds: 64 bits, so two different sheets do not share a clip. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** Runs a slice-by-slice render, giving the screen a turn every SLICE_MS; null once `cancelled` says so. */
export async function runSliced<T>(render: Generator<void, T, void>, cancelled: () => boolean): Promise<T | null> {
  let started = Date.now();
  for (;;) {
    const step = render.next();
    if (step.done) return step.value;
    if (Date.now() - started >= SLICE_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (cancelled()) return null;
      started = Date.now();
    }
  }
}

