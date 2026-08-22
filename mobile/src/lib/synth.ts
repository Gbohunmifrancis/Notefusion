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

/**
 * Hammer contact point as a fraction of the speaking length. A real piano's is
 * near 1/7 to 1/8; it puts a node on the 7th-8th partial, which is audible as the
 * absence of a sour minor seventh rather than as a missing partial.
 */
const STRIKE_POS = 1 / 7.6;

/**
 * Body spectrum: |sin(k·pi·x)| / k^rolloff. Below 1 is buzzy, above 1.4 is dull.
 * Real pianos are flatter in the bass and steeper in the treble — the hammer is
 * wide relative to a short treble string and narrow relative to a long bass one —
 * so the exponent tilts with register rather than being one number for the compass.
 */
const BODY_ROLLOFF_C4 = 1.05;
const ROLLOFF_TILT = 1 / 120; // per semitone above C4
const ROLLOFF_MIN = 0.85;
const ROLLOFF_MAX = 1.45;

/**
 * The one number that decides "soft piano" rather than "bright piano": a gently
 * played note has little above ~5 kHz. Applied as a one-pole tilt rather than a
 * brick wall — a hard cut is what left the old treble with 5 partials.
 */
const BRIGHT_CEILING_HZ = 5200;

/** Generation ceiling, and the level below which a partial is inaudible anyway. */
const MAX_PARTIALS = 48;
const PARTIAL_FLOOR_DB = -60;

/** Stretches partial k by (1 + B·k²). 1.1e-4 is in the range measured on pianos. */
const INHARMONICITY = 1.1e-4;

/**
 * The hammer: a second, much brighter partial stack that is gone in ~15 ms. This
 * is what a strike *is* — broadband energy at contact, immediately gone, leaving
 * the string ringing. Without it a note simply appears.
 */
const STRIKE_GAIN = 0.22;
const STRIKE_ROLLOFF = 0.35;
const STRIKE_TAU_SEC = 0.014;
/** Ten time constants: past here the strike term is below -87 dB. */
const STRIKE_SPAN_SEC = 10 * STRIKE_TAU_SEC;

/**
 * Per-partial damping. Partial k's time constant is tau0/(1 + DAMP_K·k^DAMP_EXP),
 * so the tone darkens as it rings — but far more slowly than the old
 * exp(-k·t/1.6), which collapsed the tone to its bare fundamental inside 100 ms
 * and is why the voice measured as a sine wave.
 */
const DAMP_K = 0.14;
const DAMP_EXP = 1.15;

const STRING_DECAY_SEC_C4 = 2.4;
const STRING_DECAY_MIN_SEC = 0.55;
const STRING_DECAY_MAX_SEC = 4.0;

/**
 * Piano notes fall fast at first and then much more slowly — the two
 * polarisations of string motion decay at different rates and the crossover is
 * plainly audible. A mixture of two exponentials rather than one.
 */
const TAIL_MIX = 0.22;
const TAIL_FACTOR = 3.2;

/**
 * Unison detuning, in cents: tuners leave a couple of cents between the two or
 * three strings of a note deliberately, and the slow beating that results is what
 * the ear reads as warmth.
 *
 * Modelled as (1 + depth·cos) rather than as a literal sum of three equal strings.
 * That sum is sin(2·pi·f·t)·(1 + 2·cos(2·pi·d·t)), and (1 + 2·cos) passes through
 * *zero* at 2·pi/3 on its way to -1 — so every partial periodically vanishes
 * outright. Measured, that reads as 49 dB of "beating" and it is a dropout, not a
 * shimmer. Real unisons never null, because the strings differ in amplitude and
 * phase. A depth of 0.6 is a 12 dB swing between 1.6 and 0.4.
 *
 * The depth ramps in over the first few partials, which is both Weinreich's
 * measured result on coupled piano strings — a unison phase-locks at the
 * fundamental and decouples higher up, so the shimmer is a partial-band effect —
 * and what stops the energy-dominant fundamental from swinging the whole spectrum
 * up and down as it beats.
 */
const DETUNE_CENTS = 2.0;
const UNISON_DEPTH = 0.6;
const UNISON_KNEE = 4;

/** Below this the strings are wound and single or paired — no useful beating. */
const UNISON_MIN_MIDI = 52;

const ATTACK_SEC = 0.005; // hammer strike
const RELEASE_SEC = 0.08; // damper landing at note-off

/** Every note is normalised to this, so level does not depend on the spectrum. */
const PEAK_TARGET = 0.95;

/** Samples between renormalisations of the rotation oscillators. */
const RENORM_EVERY = 4096;

/**
 * Metronome click. Deliberately not a piano note — it has to read as a separate
 * instrument keeping time, not as part of the tune, so it sits above the melody's
 * usual range and is gone inside 35 ms. The accent is higher and louder rather
 * than a different timbre, which is how a downbeat is heard on a real one.
 */
const CLICK_HZ = 1000;
const CLICK_ACCENT_HZ = 1500;
const CLICK_DECAY_SEC = 0.035;
const CLICK_LEN_SEC = 0.06;
const CLICK_GAIN = 0.45;
const CLICK_ACCENT_GAIN = 0.7;

/**
 * Seconds per quarter note. Floored at 30 BPM so a bad tempo can't divide by ~0.
 *
 * Exported because anything mapping beats onto this audio has to use the *same*
 * floor — `useNotePlayer`'s highlight windows in particular. Two definitions
 * that disagree only below 30 BPM is exactly the kind of thing that ships.
 */
export function beatSecOf(tempoBpm: number): number {
  return 60 / Math.max(tempoBpm, 30);
}

/** Body decay constant: doubles every two octaves down. Mirrors _string_decay_sec. */
function stringDecaySec(pitchMidi: number): number {
  const scaled = STRING_DECAY_SEC_C4 * Math.pow(2, (60 - pitchMidi) / 24);
  return Math.min(Math.max(scaled, STRING_DECAY_MIN_SEC), STRING_DECAY_MAX_SEC);
}

/** Spectral roll-off exponent for this register. Mirrors _body_rolloff. */
function bodyRolloff(pitchMidi: number): number {
  const tilted = BODY_ROLLOFF_C4 + (pitchMidi - 60) * ROLLOFF_TILT;
  return Math.min(Math.max(tilted, ROLLOFF_MIN), ROLLOFF_MAX);
}

/** Raised-cosine ramp, zero slope at both ends. Mirrors _smooth_ramp. */
function smoothRamp(i: number, n: number): number {
  return 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1));
}

/**
 * One note at unit peak: a struck-string partial stack with a hammer transient,
 * per-partial damping, a double decay and unison beating. Depends only on pitch
 * and length, which is what makes it cacheable — a melody repeats pitches and
 * note lengths heavily, and this is the expensive part.
 *
 * The oscillators are complex rotations rather than a Math.sin per sample, and
 * the envelopes are geometric rather than a Math.exp per sample. That is what
 * pays for 5x the partial count: measured on the 25 s test melody this renders in
 * 130 ms against the old 8-partial version's 113 ms, because two transcendentals
 * per sample per partial cost more than the multiplies that replace them. The
 * numpy mirror uses closed-form exp/sin instead, since vectorised numpy has no
 * per-sample call overhead to avoid; the two differ only in the last ULP.
 */
function renderVoice(pitchMidi: number, lengthSamples: number): Float64Array {
  const out = new Float64Array(lengthSamples);
  const f0 = 440 * Math.pow(2, (pitchMidi - 69) / 12);
  const nyquist = 0.5 * SAMPLE_RATE;
  const tau0 = stringDecaySec(pitchMidi);
  const rolloff = bodyRolloff(pitchMidi);
  const unison = pitchMidi >= UNISON_MIN_MIDI;
  const detuneHz = f0 * (Math.pow(2, DETUNE_CENTS / 1200) - 1);

  // Lay the partials out first, so the audibility gate is relative to the loudest
  // of them rather than to an assumed k=1.
  const fks: number[] = [];
  const bodyAmps: number[] = [];
  const strikeAmps: number[] = [];
  let loudest = 0;
  for (let k = 1; k <= MAX_PARTIALS; k++) {
    const fk = f0 * k * (1 + INHARMONICITY * k * k);
    if (fk >= nyquist) break;
    const node = Math.abs(Math.sin(k * Math.PI * STRIKE_POS));
    // One-pole brightness tilt: unity well below the ceiling, -3 dB at it.
    const tilt = 1 / (1 + (fk / BRIGHT_CEILING_HZ) ** 2);
    const bodyAmp = (node * tilt) / Math.pow(k, rolloff);
    const strikeAmp = (STRIKE_GAIN * node * tilt) / Math.pow(k, STRIKE_ROLLOFF);
    fks.push(fk);
    bodyAmps.push(bodyAmp);
    strikeAmps.push(strikeAmp);
    loudest = Math.max(loudest, bodyAmp + strikeAmp);
  }
  const floor = loudest * Math.pow(10, PARTIAL_FLOOR_DB / 20);

  const strikeSpan = Math.min(lengthSamples, Math.ceil(STRIKE_SPAN_SEC * SAMPLE_RATE));
  const rStrike = Math.exp(-1 / (STRIKE_TAU_SEC * SAMPLE_RATE));

  for (let idx = 0; idx < fks.length; idx++) {
    const k = idx + 1;
    const bodyAmp = bodyAmps[idx]!;
    const strikeAmp = strikeAmps[idx]!;
    if (bodyAmp + strikeAmp < floor) continue;

    const tauK = tau0 / (1 + DAMP_K * Math.pow(k, DAMP_EXP));
    const rFast = Math.exp(-1 / (tauK * SAMPLE_RATE));
    const rSlow = Math.exp(-1 / (tauK * TAIL_FACTOR * SAMPLE_RATE));

    // Deterministic phase from pitch and partial index, as on the server: two
    // fragments of the same pitch then reinforce instead of cancelling.
    const phase = 2 * Math.PI * ((pitchMidi * 0.5698402909 + k * 0.618033988) % 1);
    const omega = (2 * Math.PI * fks[idx]!) / SAMPLE_RATE;
    const beat = (2 * Math.PI * k * detuneHz) / SAMPLE_RATE;
    const depth = unison ? UNISON_DEPTH * Math.min(1, k / UNISON_KNEE) : 0;

    // sin(omega·i + phase) by complex rotation: z advances by exp(j·omega) each
    // step and the sine is its imaginary part. Renormalised periodically so float
    // drift cannot change the level.
    const cw = Math.cos(omega);
    const sw = Math.sin(omega);
    let zr = Math.cos(phase);
    let zi = Math.sin(phase);

    // The unison modulation is a second rotation, at the beat rate.
    const bw = Math.cos(beat);
    const bs = Math.sin(beat);
    let mr = 1;
    let mi = 0;

    // The strike is a separate, short pass: it is below -87 dB after 140 ms, so
    // carrying it through a whole note costs a multiply-add per sample for
    // nothing. It needs no unison term either — a 15 ms transient cannot beat.
    if (strikeAmp >= floor) {
      let sr = Math.cos(phase);
      let si = Math.sin(phase);
      let e = strikeAmp;
      for (let i = 0; i < strikeSpan; i++) {
        out[i] = out[i]! + e * si;
        const nr = sr * cw - si * sw;
        si = sr * sw + si * cw;
        sr = nr;
        e *= rStrike;
        if ((i & (RENORM_EVERY - 1)) === RENORM_EVERY - 1) {
          const g = 1 / Math.hypot(sr, si);
          sr *= g;
          si *= g;
        }
      }
    }

    let eFast = 1 - TAIL_MIX;
    let eSlow = TAIL_MIX;
    for (let i = 0; i < lengthSamples; i++) {
      out[i] = out[i]! + bodyAmp * (eFast + eSlow) * (1 + depth * mr) * zi;

      const nzr = zr * cw - zi * sw;
      zi = zr * sw + zi * cw;
      zr = nzr;
      eFast *= rFast;
      eSlow *= rSlow;
      if (unison) {
        const nmr = mr * bw - mi * bs;
        mi = mr * bs + mi * bw;
        mr = nmr;
      }
      if ((i & (RENORM_EVERY - 1)) === RENORM_EVERY - 1) {
        const g = 1 / Math.hypot(zr, zi);
        zr *= g;
        zi *= g;
        if (unison) {
          const h = 1 / Math.hypot(mr, mi);
          mr *= h;
          mi *= h;
        }
      }
    }
  }

  // Envelope: continuous decay from the strike, never a sustain plateau. The
  // plateau is what made this an organ rather than a piano.
  const attack = Math.min(Math.floor(ATTACK_SEC * SAMPLE_RATE), lengthSamples >> 2);
  const release = Math.min(Math.floor(RELEASE_SEC * SAMPLE_RATE), lengthSamples >> 1);
  let peak = 0;
  for (let i = 0; i < lengthSamples; i++) {
    if (attack > 1 && i < attack) out[i] = out[i]! * smoothRamp(i, attack);
    const fromEnd = lengthSamples - 1 - i;
    if (release > 1 && fromEnd < release) out[i] = out[i]! * smoothRamp(fromEnd, release);
    const a = Math.abs(out[i]!);
    if (a > peak) peak = a;
  }

  // Normalise per note rather than by a computed weight sum: the partial phases
  // do not align, so the analytic ceiling is far above the real peak and using it
  // would leave every note quiet. A real piano is near equal-loudness across its
  // compass anyway, so per-note normalisation is also the right voicing.
  if (peak > 0) {
    const g = PEAK_TARGET / peak;
    for (let i = 0; i < lengthSamples; i++) out[i] = out[i]! * g;
  }
  return out;
}

/**
 * One metronome click. Sine into a fast exponential decay — a woodblock rather
 * than a note, so it cuts through the melody without being mistaken for it.
 */
function renderClick(accent: boolean): Float64Array {
  const n = Math.ceil(CLICK_LEN_SEC * SAMPLE_RATE);
  const out = new Float64Array(n);
  const omega = 2 * Math.PI * (accent ? CLICK_ACCENT_HZ : CLICK_HZ);
  const gain = accent ? CLICK_ACCENT_GAIN : CLICK_GAIN;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // A handful of samples of fade-in: starting a sine at full amplitude is
    // itself a click, and two clicks per beat is not what was asked for.
    const ramp = i < 8 ? i / 8 : 1;
    out[i] = gain * ramp * Math.exp(-t / CLICK_DECAY_SEC) * Math.sin(omega * t);
  }
  return out;
}

export interface SynthOptions {
  /** A click on every beat, accented on the first of each bar. */
  metronome?: boolean;
  /**
   * Bars of clicks before the melody starts, so a singer can find the pulse
   * before the first note. Clicks during the count-in sound whether or not
   * `metronome` is set — that is the whole point of one.
   */
  countInBars?: number;
  /**
   * Quarter-note beats per bar, from the transcription's time signature. Sets
   * where the accent falls and how long a count-in bar is. Compound meters get
   * a quarter-note pulse rather than a dotted one — 6/8 clicks three to the bar,
   * which is the usual practice-tool compromise.
   */
  beatsPerBar?: number;
}

/**
 * How much audio a count-in puts in front of the melody, in seconds.
 *
 * Callers need this to keep positions lined up: with a count-in, a note whose
 * `startBeat` says 0 is heard `leadInSec` into the clip, so anything mapping a
 * playback position back onto a note has to subtract it first.
 */
export function leadInSec(tempoBpm: number, opts: SynthOptions = {}): number {
  const bars = Math.max(0, Math.floor(opts.countInBars ?? 0));
  if (bars === 0) return 0;
  return bars * beatsPerBarOf(opts) * beatSecOf(tempoBpm);
}

function beatsPerBarOf(opts: SynthOptions): number {
  const perBar = opts.beatsPerBar ?? 4;
  return perBar > 0 ? perBar : 4;
}

/**
 * Generates a base64-encoded 16-bit PCM WAV audio clip for a list of NoteEvents.
 * Used when opening saved transcriptions from the library so audio can be previewed
 * and played back anytime, offline or online, and after every local note edit.
 */
export function synthesizeMelodyWavBase64(
  notes: NoteEvent[],
  tempoBpm: number,
  opts: SynthOptions = {},
): string {
  if (!notes || notes.length === 0) return "";

  const beatSec = beatSecOf(tempoBpm);
  const lead = leadInSec(tempoBpm, opts);
  const leadSamples = Math.round(lead * SAMPLE_RATE);

  // Total length = end of the last note + short tail so the release doesn't clip
  let maxBeat = 0;
  for (const n of notes) {
    const end = n.startBeat + n.durBeats;
    if (end > maxBeat) maxBeat = end;
  }
  const totalSamples = Math.ceil((lead + maxBeat * beatSec + 0.25) * SAMPLE_RATE);
  const mix = new Float64Array(totalSamples);
  const cache = new Map<string, Float64Array>();

  for (const note of notes) {
    if (note.pitchMidi <= 0) continue;

    const startSample = leadSamples + Math.floor(note.startBeat * beatSec * SAMPLE_RATE);
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
    // renderVoice already normalises each note to PEAK_TARGET, so there is no
    // separate voice gain to apply here.
    const conf = Number.isFinite(note.conf) ? Math.min(Math.max(note.conf, 0), 1) : 1;
    const gain = 0.55 + 0.35 * conf;
    const n = Math.min(durSamples, totalSamples - startSample);
    for (let i = 0; i < n; i++) {
      mix[startSample + i] = mix[startSample + i]! + voice[i]! * gain;
    }
  }

  // Clicks are mixed into the melody's own buffer rather than played by a second
  // player. Two players started together drift, and a metronome that drifts is
  // worse than no metronome at all; in one buffer they are sample-locked.
  const metronome = opts.metronome === true;
  if (metronome || leadSamples > 0) {
    const perBar = beatsPerBarOf(opts);
    const countInBeats = Math.round(lead / beatSec);
    // The last beat that has music on it. A click on the bar-line *after* the
    // final note would sound like the piece has one bar more than it does.
    const lastBeat = metronome ? Math.ceil(maxBeat) - 1 : -1;
    const plain = renderClick(false);
    const accented = renderClick(true);

    for (let beat = -countInBeats; beat <= lastBeat; beat++) {
      // A count-in is a whole number of bars, so its beats are negative
      // multiples of `perBar` and this accents them on the same downbeats the
      // melody will land on. (`-0 % perBar` is `-0`, and `-0 === 0`.)
      const click = beat % perBar === 0 ? accented : plain;
      const startSample = leadSamples + Math.round(beat * beatSec * SAMPLE_RATE);
      if (startSample < 0) continue;
      const n = Math.min(click.length, totalSamples - startSample);
      for (let i = 0; i < n; i++) {
        mix[startSample + i] = mix[startSample + i]! + click[i]!;
      }
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
