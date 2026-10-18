/**
 * The practice modes' clips, written by the app's own synth (lib/synth): "Hear it", a take's count-in with what plays
 * under the singer (lib/practiceModes `takeSound`), a warm-up guide, and a rhythm's claps. One WAV each, so the
 * clicks, the tones and the piano are sample-locked, as the daily drill's count-in is.
 */

import type { PracticeExercise, WarmUpGuide } from "../api/types";
import { leadInPlan } from "./practice";
import {
  glideRounds,
  guideNotes,
  guideSeconds,
  hearVoices,
  passageSeconds,
  takeSound,
  type CountIn,
} from "./practiceModes";
import { beatSecOf, synthesizeClapsWavBase64, synthesizeGlideWavBase64, synthesizeVoicesWavBase64 } from "./synth";

/** The synth rings each note on this long past its end; a clip's length includes it. */
const RING_SEC = 0.4;

/** The count-in before a take of this exercise (at most five seconds), as the daily drill counts in. */
export function countInFor(ex: Pick<PracticeExercise, "tempoBpm" | "timeSignature">): CountIn {
  return leadInPlan(ex.tempoBpm, ex.timeSignature);
}

/** A take's clip: the count-in, then only what the mode plays under the singer. */
export function takeClip(ex: PracticeExercise, countIn: CountIn, headphones = false): string {
  const sound = takeSound(ex, countIn, headphones);
  if (sound.voices.length === 0) {
    return synthesizeClapsWavBase64([], ex.tempoBpm, { countInBeats: sound.countInBeats, beatsPerBar: sound.beatsPerBar });
  }
  return synthesizeVoicesWavBase64(sound.voices, ex.tempoBpm, { countInBeats: sound.countInBeats, beatsPerBar: sound.beatsPerBar });
}

/** "Hear it": the exercise once, at its tempo, and how long that takes. */
export function hearClip(ex: PracticeExercise): { wav: string; seconds: number } {
  if (ex.mode === "rhythm") {
    const perBar = 4;
    const wav = synthesizeClapsWavBase64(ex.claps, ex.tempoBpm, { countInBeats: perBar, beatsPerBar: perBar, pulse: true });
    return { wav, seconds: perBar * beatSecOf(ex.tempoBpm) + passageSeconds(ex) + RING_SEC };
  }
  const voices = hearVoices(ex);
  const end = voices.reduce((m, v) => v.notes.reduce((e, n) => Math.max(e, n.startBeat + n.durBeats), m), 0);
  return { wav: synthesizeVoicesWavBase64(voices, ex.tempoBpm), seconds: end * beatSecOf(ex.tempoBpm) + RING_SEC };
}

/** A warm-up guide: the piano's notes round by round, or one sliding hum for a siren. */
export function guideClip(guide: WarmUpGuide): { wav: string; seconds: number } {
  const seconds = guideSeconds(guide) + RING_SEC;
  if (guide.glide) return { wav: synthesizeGlideWavBase64(glideRounds(guide)), seconds };
  return { wav: synthesizeVoicesWavBase64([{ notes: guideNotes(guide), gain: 1 }], guide.tempoBpm), seconds };
}
