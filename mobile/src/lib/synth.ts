import { NoteEvent } from "../api/types";

/*
 * Soft-piano voice — mirrors server/app/pipeline/transcriber.py:44-88 and
 * _synthesize_audio_preview. **Keep the two in lock-step.**
 *
 * This is not a cosmetic duplication. The server preview is only heard on the
 * first render of a fresh transcription; the moment the user edits a note or
 * changes the key, ResultScreen regenerates the audio with this function
 * instead. Any divergence between the two is therefore audible as the timbre
 * changing underfoot mid-session, which is worse than either voice being
 * imperfect. Same rate, same partials, same envelope, same limiter.
 */

/** Matches PREVIEW_SAMPLE_RATE. 8 kHz here was telephone-band and sounded it. */
const SAMPLE_RATE = 22050;

/** Falls off as roughly 1/k²: a gently-struck piano has weak upper partials. */
const HARMONIC_WEIGHTS = [1.0, 0.28, 0.14, 0.07, 0.04, 0.022, 0.012, 0.007];

/** Partial k is damped by exp(-k·t/this), so the tone darkens as it rings. */
const HARMONIC_DECAY_SEC = 1.6;

/** Stretches partial k by (1 + B·k²); keeps the partials off a static buzz. */
const INHARMONICITY = 8e-5;

const ATTACK_SEC = 0.006; // hammer strike
const RELEASE_SEC = 0.08; // damper landing at note-off

const STRING_DECAY_SEC_C4 = 2.6;
const STRING_DECAY_MIN_SEC = 0.6;
const STRING_DECAY_MAX_SEC = 4.0;

/** Every note peaks at the sum of the weights, so this normalises to 1.0. */
const VOICE_GAIN = 1 / HARMONIC_WEIGHTS.reduce((a, b) => a + b, 0);

/** Body decay constant: doubles every two octaves down. Mirrors _string_decay_sec. */
function stringDecaySec(pitchMidi: number): number {
  const scaled = STRING_DECAY_SEC_C4 * Math.pow(2, (60 - pitchMidi) / 24);
  return Math.min(Math.max(scaled, STRING_DECAY_MIN_SEC), STRING_DECAY_MAX_SEC);
}

/** Raised-cosine ramp, zero slope at both ends. Mirrors _smooth_ramp. */
function smoothRamp(i: number, n: number): number {
  return 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1));
}

/**
 * One note at unit velocity: partials, brightness decay, body decay, attack and
 * release. Depends only on pitch and length, which is what makes it cacheable —
 * a melody repeats pitches and note lengths heavily, and this is the expensive
 * part (8 partials × 22 050 samples of Math.sin per second of audio).
 */
function renderVoice(pitchMidi: number, lengthSamples: number): Float64Array {
  const out = new Float64Array(lengthSamples);
  const freq = 440 * Math.pow(2, (pitchMidi - 69) / 12);
  const nyquist = 0.5 * SAMPLE_RATE;
  const tau = stringDecaySec(pitchMidi);

  for (let k = 1; k <= HARMONIC_WEIGHTS.length; k++) {
    const weight = HARMONIC_WEIGHTS[k - 1]!;
    const fk = freq * k * (1 + INHARMONICITY * k * k);
    if (fk >= nyquist) break;
    // Deterministic phase from pitch and partial index, as on the server: two
    // fragments of the same pitch then reinforce instead of cancelling.
    const phase =
      2 * Math.PI * ((pitchMidi * 0.5698402909 + k * 0.618033988) % 1);
    const omega = 2 * Math.PI * fk;
    for (let i = 0; i < lengthSamples; i++) {
      const t = i / SAMPLE_RATE;
      out[i] =
        out[i]! +
        weight * Math.exp((-k * t) / HARMONIC_DECAY_SEC) * Math.sin(omega * t + phase);
    }
  }

  // Envelope: continuous exponential decay, not a sustain plateau. The plateau is
  // what made this an organ rather than a piano.
  const attack = Math.min(Math.floor(ATTACK_SEC * SAMPLE_RATE), lengthSamples >> 2);
  const release = Math.min(Math.floor(RELEASE_SEC * SAMPLE_RATE), lengthSamples >> 1);
  for (let i = 0; i < lengthSamples; i++) {
    let env = Math.exp(-(i / SAMPLE_RATE) / tau);
    if (attack > 1 && i < attack) env *= smoothRamp(i, attack);
    const fromEnd = lengthSamples - 1 - i;
    if (release > 1 && fromEnd < release) env *= smoothRamp(fromEnd, release);
    out[i] = out[i]! * env;
  }
  return out;
}

/**
 * Generates a base64-encoded 16-bit PCM WAV audio clip for a list of NoteEvents.
 * Used when opening saved transcriptions from the library so audio can be previewed
 * and played back anytime, offline or online, and after every local note edit.
 */
export function synthesizeMelodyWavBase64(notes: NoteEvent[], tempoBpm: number): string {
  if (!notes || notes.length === 0) return "";

  const beatSec = 60 / Math.max(tempoBpm, 30);

  // Total length = end of the last note + short tail so the release doesn't clip
  let maxBeat = 0;
  for (const n of notes) {
    const end = n.startBeat + n.durBeats;
    if (end > maxBeat) maxBeat = end;
  }
  const totalSamples = Math.ceil((maxBeat * beatSec + 0.25) * SAMPLE_RATE);
  const mix = new Float64Array(totalSamples);
  const cache = new Map<string, Float64Array>();

  for (const note of notes) {
    if (note.pitchMidi <= 0) continue;

    const startSample = Math.floor(note.startBeat * beatSec * SAMPLE_RATE);
    if (startSample >= totalSamples) continue;
    // Floored at 40 ms so a zero-length note still sounds, as on the server.
    const durSamples = Math.max(
      Math.floor(note.durBeats * beatSec * SAMPLE_RATE),
      Math.floor(0.04 * SAMPLE_RATE),
    );

    const key = `${note.pitchMidi}:${durSamples}`;
    let voice = cache.get(key);
    if (!voice) {
      voice = renderVoice(note.pitchMidi, durSamples);
      cache.set(key, voice);
    }

    // Velocity from confidence, matching the server's 0.55 + 0.35·conf.
    const conf = Number.isFinite(note.conf) ? Math.min(Math.max(note.conf, 0), 1) : 1;
    const gain = (0.55 + 0.35 * conf) * VOICE_GAIN;
    const n = Math.min(durSamples, totalSamples - startSample);
    for (let i = 0; i < n; i++) {
      mix[startSample + i] = mix[startSample + i]! + voice[i]! * gain;
    }
  }

  // Soft-limit through tanh rather than rescaling by the peak: a pile-up of
  // overlapping notes then compresses into the headroom it needs instead of
  // dragging the level of every other note down with it.
  const buffer = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    buffer[i] = Math.round(Math.tanh(mix[i]!) * 32767);
  }

  // Build WAV header
  const dataSize = totalSamples * 2;
  const headerSize = 44;
  const wavBytes = new Uint8Array(headerSize + dataSize);
  const view = new DataView(wavBytes.buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt subchunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true);  // NumChannels (1 for Mono)
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // ByteRate
  view.setUint16(32, 2, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data subchunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write PCM audio data
  for (let i = 0; i < totalSamples; i++) {
    view.setInt16(44 + i * 2, buffer[i]!, true);
  }

  // Convert Uint8Array to base64 string
  return uint8ToBase64(wavBytes);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  const len = bytes.byteLength;
  // In React Native / JS runtime, btoa or Buffer converts binary string to base64
  if (typeof btoa === "function") {
    // Chunked: at 22 050 Hz a 30 s melody is ~1.3 MB, and appending a character at
    // a time built that string one rope node per sample.
    const CHUNK = 8192;
    let binary = "";
    for (let i = 0; i < len; i += CHUNK) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + CHUNK, len)),
      );
    }
    return btoa(binary);
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  let i = 0;
  while (i < len) {
    const b1 = bytes[i++];
    const b2 = i < len ? bytes[i++] : 0;
    const b3 = i < len ? bytes[i++] : 0;
    const c1 = b1 >> 2;
    const c2 = ((b1 & 3) << 4) | (b2 >> 4);
    let c3 = ((b2 & 15) << 2) | (b3 >> 6);
    let c4 = b3 & 63;
    if (i > len + 1) c3 = 64;
    if (i > len) c4 = 64;
    result += chars[c1] + chars[c2] + (c3 === 64 ? "=" : chars[c3]) + (c4 === 64 ? "=" : chars[c4]);
  }
  return result;
}
