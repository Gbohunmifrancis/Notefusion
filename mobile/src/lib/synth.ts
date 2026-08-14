import { NoteEvent } from "../api/types";

/**
 * Generates a base64-encoded 16-bit PCM WAV audio clip for a list of NoteEvents.
 * Used when opening saved transcriptions from the library so audio can be previewed
 * and played back anytime, offline or online.
 */
export function synthesizeMelodyWavBase64(notes: NoteEvent[], tempoBpm: number): string {
  if (!notes || notes.length === 0) return "";

  const sampleRate = 8000;
  const beatSec = 60 / Math.max(tempoBpm, 30);
  
  // Calculate total duration in samples
  let maxBeat = 0;
  for (const n of notes) {
    const end = n.startBeat + n.durBeats;
    if (end > maxBeat) maxBeat = end;
  }
  const totalDurationSec = maxBeat * beatSec + 0.2;
  const totalSamples = Math.ceil(totalDurationSec * sampleRate);
  
  const buffer = new Int16Array(totalSamples);

  // Generate sine wave tones for each note with gentle attack/decay envelope
  for (const note of notes) {
    if (note.pitchMidi <= 0) continue;
    
    const freq = 440 * Math.pow(2, (note.pitchMidi - 69) / 12);
    const startSample = Math.floor(note.startBeat * beatSec * sampleRate);
    const noteDurationSamples = Math.floor(note.durBeats * beatSec * sampleRate);
    const endSample = Math.min(totalSamples, startSample + noteDurationSamples);

    const attackSamples = Math.min(160, Math.floor(noteDurationSamples * 0.1));
    const decaySamples = Math.min(240, Math.floor(noteDurationSamples * 0.15));

    for (let i = startSample; i < endSample; i++) {
      const sampleIndexInNote = i - startSample;
      let envelope = 1.0;

      if (sampleIndexInNote < attackSamples && attackSamples > 0) {
        envelope = sampleIndexInNote / attackSamples;
      } else if (sampleIndexInNote > noteDurationSamples - decaySamples && decaySamples > 0) {
        envelope = (noteDurationSamples - sampleIndexInNote) / decaySamples;
      }
      envelope = Math.max(0, Math.min(1, envelope));

      const t = i / sampleRate;
      const sampleValue = Math.sin(2 * Math.PI * freq * t) * envelope * 12000;
      buffer[i] = Math.max(-32768, Math.min(32767, buffer[i] + sampleValue));
    }
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
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample

  // data subchunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Write PCM audio data
  for (let i = 0; i < totalSamples; i++) {
    view.setInt16(44 + i * 2, buffer[i], true);
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
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // In React Native / JS runtime, btoa or Buffer converts binary string to base64
  if (typeof btoa === "function") {
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
