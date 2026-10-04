import { NoteEvent } from "../api/types";
import { type PianoSample, SAMPLE_RATE, nearestSample } from "./piano";

/*
 * Piano voice. Every note the app plays — the preview, a rehearsal mix, "hear it",
 * the sing-along count-in — is rendered here into one WAV, so the piano sounds the
 * same wherever it is heard.
 *
 * The voice is the recorded piano in `lib/piano.ts`: the nearest of 17 Salamander
 * Grand soft-layer samples, resampled onto the pitch (interval plus the sample's
 * stretch-tuning correction), held to note-off, then let go by the damper. The web's
 * `web-site/assets/choir.js` plays the same samples the same way — **keep the two in
 * lock-step**: same release, same damper, same soundboard, same velocity.
 *
 * The additive voice further down (a struck-string partial stack, once mirrored by
 * the server's `_synthesize_audio_preview`) is kept only as the fallback for the
 * moment before the samples have loaded, or if they could not be. Mobile no longer
 * plays the server's preview: ResultScreen always synthesises its own.
 */

/**
 * The damper, after note-off: an exponential fade with this time constant inside the
 * RELEASE_SEC ring-out — 80 ms is a felt damper landing, not a cut. The same two
 * numbers drive the web's `setTargetAtTime(0, off, 0.08)` and `stop(off + 0.35)`.
 */
const DAMPER_TAU_SEC = 0.08;

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
 * The number that decides "soft piano" rather than "bright piano": a gently
 * played note has very little above ~2.5 kHz, and one pole at 5.2 kHz did not
 * come close. Measured on a C4, partial 20 sat about 19 dB below the fundamental
 * where a softly struck piano is 40-plus down — the pole was so far above the
 * partials it was meant to tame that it barely touched the upper lobes of
 * |sin(k·pi·x)|.
 *
 * Applied squared — two poles at this corner rather than one — because what
 * needed to change was the steepness of the skirt, not the passband. Two poles
 * here put partial 20 at -43 dB while moving k=1 by 0.06 dB, so the body of the
 * spectrum is where it was and only the harsh top comes off. Two poles at
 * 2.6 kHz were tried first and overshot to -52 dB, duller than a piano. Still a
 * tilt and not a brick wall: a hard cut is what left the old treble with 5
 * partials.
 *
 * 3.8 kHz was a mezzo-forte piano. The voice is meant to be a *soft* one, and a
 * gently played note has its energy below ~2.5 kHz, so the corner came down to
 * 3 kHz: on a C4 that moves the spectral centroid from 1.0 kHz to 840 Hz and takes
 * the glassy edge off the top octave without dulling the body.
 */
const BRIGHT_CEILING_HZ = 3000;

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
/**
 * 0.22 was a hammer that could be heard as a hammer. For a soft voice the strike
 * has to be felt rather than heard, so it is half that: still enough that a note
 * begins rather than appears, no longer a knock in front of every one.
 */
const STRIKE_GAIN = 0.11;
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
 * phase.
 *
 * Depth is the swing itself, and 0.6 was still far too much of one: 1.6 down to
 * 0.4 is a 12 dB swing on every partial from the fourth up, which the ear reads
 * as an out-of-tune wobble rather than as warmth. 0.25 is 1.25 down to 0.75, a
 * swing of 4.4 dB. Easy to under-read from a rendered clip — the partials each
 * beat at their own k·detune rate, so a summed envelope averages the whole thing
 * away and shows barely 1 dB. Measure per partial.
 *
 * The depth ramps in over the first several partials, which is both Weinreich's
 * measured result on coupled piano strings — a unison phase-locks at the
 * fundamental and decouples higher up, so the shimmer is a partial-band effect —
 * and what stops the energy-dominant fundamental from swinging the whole spectrum
 * up and down as it beats.
 */
const DETUNE_CENTS = 2.0;
const UNISON_DEPTH = 0.25;
const UNISON_KNEE = 8;

/** Below this the strings are wound and single or paired — no useful beating. */
const UNISON_MIN_MIDI = 52;

/** A soft hammer stays on the string longer, so a quiet note rises more slowly: 8 ms, not 5. */
const ATTACK_SEC = 0.008;

/**
 * How long the damper takes to land *after* note-off. This is a ring-out past the
 * notated end, not a fade inside it — the distinction is the whole of it. At 80 ms
 * ending *at* the notated end, every note measured 40 to 43 dB down by the time
 * the next onset arrived, so nothing carried across a note boundary and the melody
 * read as a sequencer rather than as an instrument. A piano rings into the next
 * note, and that overlap is most of what makes it sound like a piano.
 *
 * Ceiling on this: it doubles as the buffer's end padding, and the server's
 * `test_tempo_sets_the_timescale` asserts a 240 BPM render is under 0.6x a 120 BPM
 * one. On its 4-beat fixture a tempo-independent tail T gives (1 + T) < 0.6·(2 + T),
 * so T < 0.5 s. 0.35 leaves 0.574 against that 0.6. Do not raise it to "ring more"
 * without redoing the arithmetic — and it has to move on both sides at once.
 */
const RELEASE_SEC = 0.35;

/**
 * Every note is normalised to this, so level does not depend on the spectrum.
 *
 * It used to be 0.95, which with the velocity range put a solo note at 0.85 going
 * into a plain tanh — and tanh at 0.85 is not a limiter, it is a distortion pedal:
 * a third harmonic 23 dB down on *every* note, and in chords far worse. That edge
 * was most of what read as "not a piano". At 0.70 the loudest solo note peaks at
 * 0.63, under the limiter's knee, so a single note is never bent at all.
 */
const PEAK_TARGET = 0.7;

/**
 * Limiter. Two stages, because they fail differently. The first is a gain rider:
 * it looks at the peak level in a window around each instant and turns the whole
 * mix down, smoothly, by just enough to keep that peak at LIMIT_CEILING. A gain
 * change is not a waveshape, so a four-voice chord comes through as a quieter
 * chord and not — as it did through the old plain tanh, which bent the *sum* of
 * the voices — as a chord with every pair of voices intermodulating into a buzz.
 * The window is a block of 256 samples looked at ±LIMIT_HOLD_BLOCKS either side
 * (about ±46 ms: look-ahead, so the gain is already down when the peak arrives,
 * and hold, so it does not flutter between the notes of a chord), and the block
 * gains are joined by raised-cosine interpolation so the gain itself has no
 * corners to hear. The second stage is a soft knee at LIMIT_KNEE for whatever the
 * interpolation lets through: a waveshaper, but one that is barely ever touched,
 * and never by a solo note.
 */
const LIMIT_CEILING = 0.8;
const LIMIT_BLOCK = 256;
const LIMIT_HOLD_BLOCKS = 4;
const LIMIT_KNEE = 0.9;

/**
 * Soundboard. An additive string on its own is a string in a vacuum, and that is
 * the single biggest tell: a piano note is heard *through* a large wooden plate
 * that rings on after it. Modelled as the smallest thing that does the job — three
 * damped feedback combs in parallel (a dense, short, darkening tail; RT60 about
 * half a second) through one allpass to break up the comb's own pitch — mixed in
 * under the dry note. The delays are mutually prime in samples so their echoes do
 * not line up into a flutter. Wet level: the board's impulse response carries
 * about -13 dB of the dry energy, enough to put the note in a body, not enough to
 * put it in a hall.
 */
const BOARD_DELAYS_SEC = [0.0297, 0.0371, 0.0411] as const;
const BOARD_RT60_SEC = 0.55;
const BOARD_DAMP = 0.35; // one-pole low-pass in each loop: the tail darkens as it decays
const BOARD_ALLPASS_SEC = 0.0051;
const BOARD_ALLPASS_GAIN = 0.5;
const BOARD_WET = 0.07;

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
 * One note from the recorded piano: `sample` resampled onto `pitchMidi` by linear
 * interpolation at rate 2^(interval/12 − cents/1200), held for `lengthSamples`, then
 * the damper — exp(−t/DAMPER_TAU_SEC) over the `tailSamples` ring-out, with a cosine
 * end so the last sample is zero. The recording is already a strike that blooms and
 * fades, so there is no envelope of its own to shape and no normalisation: the pack is
 * level-matched at build time, and velocity is the only gain applied. A note that
 * outlives the 3.5 s recording simply fades with it.
 */
function renderSampledVoice(
  sample: PianoSample,
  pitchMidi: number,
  lengthSamples: number,
  tailSamples: number,
): Float64Array {
  const total = lengthSamples + tailSamples;
  const out = new Float64Array(total);
  const rate = Math.pow(2, (pitchMidi - sample.midi) / 12 - sample.centsSharp / 1200);
  const pcm = sample.pcm;
  const n = Math.min(total, Math.floor((pcm.length - 2) / rate));
  for (let i = 0; i < n; i++) {
    const pos = i * rate;
    const j = Math.floor(pos);
    const frac = pos - j;
    out[i] = pcm[j]! * (1 - frac) + pcm[j + 1]! * frac;
  }
  for (let i = lengthSamples; i < n; i++) {
    const k = i - lengthSamples;
    out[i] = out[i]! * Math.exp(-k / (DAMPER_TAU_SEC * SAMPLE_RATE)) * smoothRamp(tailSamples - 1 - k, tailSamples);
  }
  return out;
}

/**
 * The fallback voice, at unit peak: a struck-string partial stack with a hammer transient,
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
 *
 * Renders `lengthSamples + tailSamples`: the ring-out belongs to the note, so the
 * caller mixes it in on top of whatever comes next rather than truncating it.
 */
function renderVoice(
  pitchMidi: number,
  lengthSamples: number,
  tailSamples: number,
): Float64Array {
  const total = lengthSamples + tailSamples;
  const out = new Float64Array(total);
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
    // Two-pole brightness tilt: unity well below the ceiling, -6 dB at it, and
    // 12 dB per octave above it rather than 6.
    const tilt = 1 / (1 + (fk / BRIGHT_CEILING_HZ) ** 2) ** 2;
    const bodyAmp = (node * tilt) / Math.pow(k, rolloff);
    const strikeAmp = (STRIKE_GAIN * node * tilt) / Math.pow(k, STRIKE_ROLLOFF);
    fks.push(fk);
    bodyAmps.push(bodyAmp);
    strikeAmps.push(strikeAmp);
    loudest = Math.max(loudest, bodyAmp + strikeAmp);
  }
  const floor = loudest * Math.pow(10, PARTIAL_FLOOR_DB / 20);

  const strikeSpan = Math.min(total, Math.ceil(STRIKE_SPAN_SEC * SAMPLE_RATE));
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
    for (let i = 0; i < total; i++) {
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
  // plateau is what made this an organ rather than a piano. The release fade *is*
  // the tail, so it begins at note-off instead of ending there.
  const attack = Math.min(Math.floor(ATTACK_SEC * SAMPLE_RATE), total >> 2);
  const release = tailSamples;
  let peak = 0;
  for (let i = 0; i < total; i++) {
    if (attack > 1 && i < attack) out[i] = out[i]! * smoothRamp(i, attack);
    const fromEnd = total - 1 - i;
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
    for (let i = 0; i < total; i++) out[i] = out[i]! * g;
  }
  return out;
}

/**
 * Adds the soundboard resonance to a finished dry mix. Linear and time-invariant,
 * so it is applied once to the mix rather than per note — the result is identical
 * and it costs a few multiplies per sample instead of a few per note-sample.
 *
 * Each comb is y[n] = x[n] + g·s[n] with s[n] = (1-d)·y[n-D] + d·s[n-1]: the
 * feedback runs through a one-pole low-pass, so high partials die out of the tail
 * first, which is what a wooden plate does and what stops the tail hissing. The
 * allpass is y[n] = -g·x[n] + x[n-D] + g·y[n-D]. Mirrors `_soundboard` on the
 * server, which runs the same recurrences a block at a time.
 */
function soundboard(dry: Float64Array): Float64Array {
  const n = dry.length;
  const wet = new Float64Array(n);
  for (const delaySec of BOARD_DELAYS_SEC) {
    const d = Math.round(delaySec * SAMPLE_RATE);
    // Feedback for the loop to fall 60 dB in RT60.
    const g = Math.pow(10, (-3 * d) / (BOARD_RT60_SEC * SAMPLE_RATE));
    const y = new Float64Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const back = i >= d ? y[i - d]! : 0;
      s = (1 - BOARD_DAMP) * back + BOARD_DAMP * s;
      y[i] = dry[i]! + g * s;
      wet[i] = wet[i]! + y[i]!;
    }
  }

  const ap = Math.round(BOARD_ALLPASS_SEC * SAMPLE_RATE);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const xBack = i >= ap ? wet[i - ap]! : 0;
    const yBack = i >= ap ? out[i - ap]! : 0;
    out[i] = -BOARD_ALLPASS_GAIN * wet[i]! + xBack + BOARD_ALLPASS_GAIN * yBack;
  }

  const mixed = new Float64Array(n);
  for (let i = 0; i < n; i++) mixed[i] = dry[i]! + BOARD_WET * out[i]!;
  return mixed;
}

/**
 * Stage one of the limiter: a smooth gain that holds windowed peaks at the ceiling.
 *
 * Block peaks (LIMIT_BLOCK samples) are widened by a running maximum over
 * ±LIMIT_HOLD_BLOCKS blocks, turned into a per-block gain min(1, ceiling / peak),
 * and interpolated back to sample rate with a raised cosine between block centres.
 * Because every peak sits inside a plateau of its own block's gain, the
 * interpolation is exact where it matters and smooth everywhere else. Mirrors
 * `_ride_gain` on the server.
 */
function rideGain(x: Float64Array): Float64Array {
  const n = x.length;
  const blocks = Math.ceil(n / LIMIT_BLOCK);
  const peak = new Float64Array(blocks);
  for (let i = 0; i < n; i++) {
    const b = (i / LIMIT_BLOCK) | 0;
    const a = Math.abs(x[i]!);
    if (a > peak[b]!) peak[b] = a;
  }
  const gainB = new Float64Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let held = 0;
    const lo = Math.max(0, b - LIMIT_HOLD_BLOCKS);
    const hi = Math.min(blocks - 1, b + LIMIT_HOLD_BLOCKS);
    for (let j = lo; j <= hi; j++) if (peak[j]! > held) held = peak[j]!;
    gainB[b] = Math.min(1, LIMIT_CEILING / Math.max(held, 1e-9));
  }

  const out = new Float64Array(n);
  if (blocks === 1) {
    for (let i = 0; i < n; i++) out[i] = x[i]! * gainB[0]!;
    return out;
  }
  const half = LIMIT_BLOCK / 2;
  for (let i = 0; i < n; i++) {
    // Flat before the first block centre and after the last.
    const idx = Math.min(Math.max(Math.floor((i - half) / LIMIT_BLOCK), 0), blocks - 2);
    const frac = Math.min(Math.max((i - (idx * LIMIT_BLOCK + half)) / LIMIT_BLOCK, 0), 1);
    const w = 0.5 - 0.5 * Math.cos(Math.PI * frac);
    out[i] = x[i]! * (gainB[idx]! + (gainB[idx + 1]! - gainB[idx]!) * w);
  }
  return out;
}

/**
 * Stage two: identity up to LIMIT_KNEE, tanh over the rest. Bounded below 1 for
 * any input, so nothing can clip — and, unlike the plain tanh it replaces, a
 * signal under the knee comes out exactly as it went in.
 */
function softLimit(v: number): number {
  const a = Math.abs(v);
  if (a <= LIMIT_KNEE) return v;
  const span = 1 - LIMIT_KNEE;
  return Math.sign(v) * (LIMIT_KNEE + span * Math.tanh((a - LIMIT_KNEE) / span));
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
  return synthesizeVoicesWavBase64([{ notes, gain: 1 }], tempoBpm, opts);
}

/** One voice of a rehearsal mix: its notes and how loud it sits in the blend. */
export interface SynthVoice {
  notes: readonly NoteEvent[];
  /** 1 is the melody's own level; a part someone else sings sits a little under it. */
  gain: number;
}

/**
 * Several voices in one clip — the rehearsal mix. The parts are rendered through the
 * same piano and summed before the soundboard and the limiter, so four voices at once
 * compress into the headroom rather than clipping. A single voice at gain 1 is sample-identical to the
 * melody preview.
 */
export function synthesizeVoicesWavBase64(
  voices: readonly SynthVoice[],
  tempoBpm: number,
  opts: SynthOptions = {},
): string {
  const notes: { note: NoteEvent; gain: number }[] = [];
  for (const v of voices) for (const note of v.notes) notes.push({ note, gain: v.gain });
  if (notes.length === 0) return "";

  const beatSec = beatSecOf(tempoBpm);
  const lead = leadInSec(tempoBpm, opts);
  const leadSamples = Math.round(lead * SAMPLE_RATE);

  // Total length = end of the last note + the ring-out past it. One constant does
  // both jobs, and deliberately so: the padding exists to hold the release, so any
  // other value either clips the last note's decay or leaves silence after it.
  let maxBeat = 0;
  for (const { note: n } of notes) {
    const end = n.startBeat + n.durBeats;
    if (end > maxBeat) maxBeat = end;
  }
  const tailSamples = Math.round(RELEASE_SEC * SAMPLE_RATE);
  const totalSamples = Math.ceil((lead + maxBeat * beatSec + RELEASE_SEC) * SAMPLE_RATE);
  const mix = new Float64Array(totalSamples);
  const cache = new Map<string, Float64Array>();

  for (const { note, gain: voiceGain } of notes) {
    if (note.pitchMidi <= 0) continue;

    const startSample = leadSamples + Math.floor(note.startBeat * beatSec * SAMPLE_RATE);
    if (startSample >= totalSamples) continue;
    // Floored at 40 ms so a zero-length note still sounds, as on the server.
    const durSamples = Math.max(
      Math.floor(note.durBeats * beatSec * SAMPLE_RATE),
      Math.floor(0.04 * SAMPLE_RATE),
    );

    // The tail is a constant, so the notated length still identifies a render.
    const key = `${note.pitchMidi}:${durSamples}`;
    let voice = cache.get(key);
    if (!voice) {
      const sample = nearestSample(note.pitchMidi);
      voice = sample
        ? renderSampledVoice(sample, note.pitchMidi, durSamples, tailSamples)
        : renderVoice(note.pitchMidi, durSamples, tailSamples);
      cache.set(key, voice);
    }

    // Velocity from confidence, matching the web's 0.55 + 0.35·conf. The sample pack
    // is level-matched at build time and renderVoice normalises each note to
    // PEAK_TARGET, so there is no separate voice gain to apply here.
    const conf = Number.isFinite(note.conf) ? Math.min(Math.max(note.conf, 0), 1) : 1;
    const gain = (0.55 + 0.35 * conf) * voiceGain;
    const n = Math.min(durSamples + tailSamples, totalSamples - startSample);
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

  // The soundboard goes on the dry mix and the limiter after it, so whatever the
  // board adds is bounded too. Limit rather than rescale by the peak: a pile-up of
  // overlapping notes then compresses into the headroom it needs instead of
  // dragging the level of every other note down with it.
  const limited = rideGain(soundboard(mix));
  const buffer = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    buffer[i] = Math.round(softLimit(limited[i]!) * 32767);
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
