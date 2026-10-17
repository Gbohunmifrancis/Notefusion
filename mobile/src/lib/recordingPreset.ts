/**
 * What the microphone records, by the Data saver switch. Pure, so the choice is testable without the
 * native recorder; RecordScreen lays it over expo-audio's AAC preset.
 *
 * Both are AAC in an .m4a at 22,050 Hz mono — the rate the worker resamples every upload to before
 * pyin and Basic Pitch (server/app/pipeline/transcriber.py loads at sr=22050, mono) — so the only
 * thing data saver changes is the bit rate. Measured on the sung corpus through the worker
 * (16 cases, ffmpeg's AAC at these settings): note F1 0.974 at 128 kbps and 0.979 at 32 kbps, the
 * key the same on every case, syllable accuracy unchanged; 30 s is about 125 KB at 32 kbps against
 * ~480 KB at a nominal 128 kbps. A voice's fundamental sits far below what 32 kbps AAC keeps.
 */

export interface RecordingProfile {
  sampleRate: number;
  numberOfChannels: number;
  /** Bits per second the encoder is asked for. */
  bitRate: number;
}

/** The preset before data saver: the same AAC at expo-audio's HIGH_QUALITY rate. */
export const STANDARD_PROFILE: RecordingProfile = { sampleRate: 22050, numberOfChannels: 1, bitRate: 128_000 };

/** Data saver: a quarter of the bytes, the same transcription. */
export const DATA_SAVER_PROFILE: RecordingProfile = { sampleRate: 22050, numberOfChannels: 1, bitRate: 32_000 };

export function recordingProfile(dataSaver: boolean): RecordingProfile {
  return dataSaver ? DATA_SAVER_PROFILE : STANDARD_PROFILE;
}

/** Roughly how many bytes `seconds` of audio take at this profile (the MP4 container adds ~2%). */
export function estimatedBytes(seconds: number, profile: RecordingProfile): number {
  return Math.round(((profile.bitRate / 8) * seconds) * 1.02);
}
