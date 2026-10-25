import { Asset } from "expo-asset";
import { File } from "expo-file-system";

/**
 * The recorded piano the synth plays notes with: 17 Salamander Grand soft-layer notes,
 * C2..C6 every three semitones, built by tools/build-piano-samples.py (the web plays
 * the same notes as MP3s — keep the two in lock-step). Bundled as WAV assets, read once
 * through expo-asset the way ScoreView reads the engraver, parsed here into
 * Float32Arrays and kept for the session: 2.6 MB of PCM is nothing next to the WAVs the
 * synth writes out, and parsing them again on every play would be.
 *
 * `ensurePiano()` is kicked off from App.tsx. The synth is synchronous, so it asks
 * `nearestSample()` at render time and falls back to its additive voice while the
 * samples are still loading (a cold-start deep link) or if they failed to load.
 */

export interface PianoSample {
  /** The note recorded. */
  midi: number;
  /** How far the recording sounds above equal temperament; the player undoes it. */
  centsSharp: number;
  /** Mono PCM at `SAMPLE_RATE`, already faded to silence at its end. */
  pcm: Float32Array;
}

/** The rate the samples were built at; synth.ts renders at the same one. */
export const SAMPLE_RATE = 22050;

const SAMPLES: readonly { name: string; midi: number; module: number }[] = [
  { name: "C2", midi: 36, module: require("../../assets/piano/C2.wav") },
  { name: "Ds2", midi: 39, module: require("../../assets/piano/Ds2.wav") },
  { name: "Fs2", midi: 42, module: require("../../assets/piano/Fs2.wav") },
  { name: "A2", midi: 45, module: require("../../assets/piano/A2.wav") },
  { name: "C3", midi: 48, module: require("../../assets/piano/C3.wav") },
  { name: "Ds3", midi: 51, module: require("../../assets/piano/Ds3.wav") },
  { name: "Fs3", midi: 54, module: require("../../assets/piano/Fs3.wav") },
  { name: "A3", midi: 57, module: require("../../assets/piano/A3.wav") },
  { name: "C4", midi: 60, module: require("../../assets/piano/C4.wav") },
  { name: "Ds4", midi: 63, module: require("../../assets/piano/Ds4.wav") },
  { name: "Fs4", midi: 66, module: require("../../assets/piano/Fs4.wav") },
  { name: "A4", midi: 69, module: require("../../assets/piano/A4.wav") },
  { name: "C5", midi: 72, module: require("../../assets/piano/C5.wav") },
  { name: "Ds5", midi: 75, module: require("../../assets/piano/Ds5.wav") },
  { name: "Fs5", midi: 78, module: require("../../assets/piano/Fs5.wav") },
  { name: "A5", midi: 81, module: require("../../assets/piano/A5.wav") },
  { name: "C6", midi: 84, module: require("../../assets/piano/C6.wav") },
];
const TUNING = require("../../assets/piano/tuning.json") as { centsSharp: Record<string, number> };

let loaded: PianoSample[] | null = null;
let loading: Promise<boolean> | null = null;

/**
 * Loads the samples once; resolves true when the piano is ready, false if it could not
 * be read (the synth then keeps its fallback voice). Safe to call repeatedly.
 */
export function ensurePiano(): Promise<boolean> {
  if (loaded) return Promise.resolve(true);
  if (!loading) {
    loading = Promise.all(SAMPLES.map(loadSample)).then(
      (samples) => {
        loaded = samples;
        return true;
      },
      () => {
        loading = null; // a later call may try again
        return false;
      },
    );
  }
  return loading;
}

async function loadSample(entry: { name: string; midi: number; module: number }): Promise<PianoSample> {
  const asset = Asset.fromModule(entry.module);
  await asset.downloadAsync();
  const bytes = await new File(asset.localUri ?? asset.uri).arrayBuffer();
  return { midi: entry.midi, centsSharp: TUNING.centsSharp[entry.name] ?? 0, pcm: parseWav(bytes) };
}

/** The recorded note nearest to `midi` (never more than a semitone away), or null until loaded. */
export function nearestSample(midi: number): PianoSample | null {
  if (!loaded) return null;
  let best = loaded[0]!;
  for (const s of loaded) if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
  return best;
}

/**
 * PCM16 mono WAV at SAMPLE_RATE → Float32Array in [-1, 1). Walks the RIFF chunks rather
 * than assuming a 44-byte header, since an encoder may put a LIST chunk before the data.
 */
export function parseWav(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  if (tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") throw new Error("not a WAV file");
  let channels = 1;
  let bits = 16;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (view.getUint16(body, true) !== 1) throw new Error("not PCM");
      channels = view.getUint16(body + 2, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (bits !== 16) throw new Error("not 16-bit");
      const frames = Math.floor(Math.min(size, view.byteLength - body) / (2 * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        // Extra channels are averaged, though the pack is mono.
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += view.getInt16(body + (i * channels + c) * 2, true);
        out[i] = sum / (channels * 32768);
      }
      return out;
    }
    offset = body + size + (size & 1);
  }
  throw new Error("no data chunk");
}

function tag(view: DataView, at: number): string {
  return String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
}
