/**
 * Live key estimation from microphone PCM — the engine behind "Find the key".
 *
 * Streaming: 16 kHz mono float samples go in ~250 ms at a time; every 4096-point frame (hop 2048)
 * adds a harmonic-salience chroma to a slowly decaying 12-bin profile (half-life about 8 s), and the
 * profile is matched against the 24 Krumhansl-Kessler key templates. A new key is only reported once
 * it has won a few frames in a row by a margin, so the display does not flicker on every chord.
 *
 * Plain log-magnitude chroma read C major as G (the fifth error: every note's third harmonic lands a
 * fifth above it). The salience step sums each candidate note's first four harmonics and then takes
 * back what the note a fifth-plus-octave below explains, which is what fixed it on the synthetic set.
 *
 * No imports, and erasable TypeScript syntax only (no parameter properties, no enums): the tests run
 * on Node's own type stripping. Doh is *not* derived here — the hook uses `solfa.ts` for that, so the
 * la-based minor rule lives in one place.
 */

export type KeyMode = "major" | "minor";

export interface KeyEstimate {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  mode: KeyMode;
  /** 0..1, from the template correlation and how far ahead of the runner-up it is. */
  confidence: number;
}

export interface ChordEstimate {
  /** Pitch class of the root, 0 = C. */
  root: number;
  quality: "maj" | "min";
}

export interface KeyStatus {
  /** False after a second of nothing above the silence floor: "Can't hear anything". */
  hearing: boolean;
  /** The key shown: changes only after `winsNeeded` consecutive frames agree with margin. */
  stable: KeyEstimate | null;
  /** The frame-by-frame best guess, for the confidence bar before anything is stable. */
  candidate: KeyEstimate | null;
  /** The chord sounding now, from a fast-decaying chroma; null when nothing dominates. */
  chord: ChordEstimate | null;
}

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const FFT_SIZE = 4096;
const HOP = FFT_SIZE / 2;
/** MIDI range the salience scan covers: C2..C6. */
const LOW_MIDI = 36;
const HIGH_MIDI = 84;
/** Frame RMS below this is silence (about −48 dBFS). */
const SILENCE_RMS = 0.004;
/** Consecutive silent frames (128 ms each) before `hearing` drops. */
const SILENT_FRAMES = 8;

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Pearson correlation of two 12-vectors. */
function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < 12; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= 12;
  mb /= 12;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

interface Scored {
  tonic: number;
  mode: KeyMode;
  score: number;
}

/** All 24 keys scored against a chroma, best first. */
function rankKeys(chroma: ArrayLike<number>): Scored[] {
  const out: Scored[] = [];
  const rolled = new Float64Array(12);
  for (let t = 0; t < 12; t++) {
    for (let i = 0; i < 12; i++) rolled[i] = chroma[(i + t) % 12];
    out.push({ tonic: t, mode: "major", score: corr(rolled, KK_MAJOR) });
    out.push({ tonic: t, mode: "minor", score: corr(rolled, KK_MINOR) });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export interface KeyDetectorOptions {
  /** How long the key profile remembers, in seconds. */
  halfLifeSec?: number;
  /** Frames in a row a new key must win before it is shown. */
  winsNeeded?: number;
  /** Lead over the runner-up a winning frame needs. */
  minMargin?: number;
}

export class KeyDetector {
  private readonly sampleRate: number;
  private readonly win: Float64Array;
  private readonly decay: number;
  private readonly chordDecay: number;
  private readonly winsNeeded: number;
  private readonly minMargin: number;

  private pending: Float32Array = new Float32Array(0);
  private readonly chroma = new Float64Array(12);
  private readonly chordChroma = new Float64Array(12);
  private readonly re = new Float64Array(FFT_SIZE);
  private readonly im = new Float64Array(FFT_SIZE);
  private readonly salience = new Float64Array(128);

  private silentFrames = SILENT_FRAMES;
  private stable: KeyEstimate | null = null;
  private candidate: KeyEstimate | null = null;
  private candidateWins = 0;
  private chord: ChordEstimate | null = null;

  constructor(sampleRate: number = 16000, options: KeyDetectorOptions = {}) {
    this.sampleRate = sampleRate;
    const halfLife = options.halfLifeSec ?? 8;
    const hopSec = HOP / sampleRate;
    this.decay = Math.pow(0.5, hopSec / halfLife);
    this.chordDecay = Math.pow(0.5, hopSec / 0.5);
    this.winsNeeded = options.winsNeeded ?? 3;
    this.minMargin = options.minMargin ?? 0.03;
    this.win = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE);
  }

  /** Forgets everything heard so far. */
  reset(): void {
    this.pending = new Float32Array(0);
    this.chroma.fill(0);
    this.chordChroma.fill(0);
    this.silentFrames = SILENT_FRAMES;
    this.stable = null;
    this.candidate = null;
    this.candidateWins = 0;
    this.chord = null;
  }

  /** Feeds a chunk of mono samples (any length) and returns the status afterwards. */
  push(samples: ArrayLike<number>): KeyStatus {
    const merged = new Float32Array(this.pending.length + samples.length);
    merged.set(this.pending, 0);
    for (let i = 0; i < samples.length; i++) merged[this.pending.length + i] = samples[i];
    let offset = 0;
    while (merged.length - offset >= FFT_SIZE) {
      this.frame(merged, offset);
      offset += HOP;
    }
    this.pending = merged.slice(offset);
    return this.status();
  }

  status(): KeyStatus {
    return {
      hearing: this.silentFrames < SILENT_FRAMES,
      stable: this.stable,
      candidate: this.candidate,
      chord: this.chord,
    };
  }

  private frame(x: Float32Array, offset: number): void {
    const re = this.re;
    const im = this.im;
    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const v = x[offset + i];
      energy += v * v;
      re[i] = v * this.win[i];
      im[i] = 0;
    }
    if (Math.sqrt(energy / FFT_SIZE) < SILENCE_RMS) {
      this.silentFrames = Math.min(SILENT_FRAMES, this.silentFrames + 1);
      // Silence keeps the key it had; it does not vote.
      if (this.silentFrames >= SILENT_FRAMES) this.chord = null;
      return;
    }
    this.silentFrames = 0;

    fft(re, im);
    const half = FFT_SIZE / 2;
    const binHz = this.sampleRate / FFT_SIZE;
    const at = (f: number): number => {
      const k = Math.round(f / binHz);
      return k < half ? Math.sqrt(re[k] * re[k] + im[k] * im[k]) : 0;
    };

    // Harmonic-sum salience per semitone candidate.
    const sal = this.salience;
    sal.fill(0);
    for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) {
      const f0 = 440 * 2 ** ((m - 69) / 12);
      let s = 0;
      for (let h = 1; h <= 4; h++) s += at(f0 * h) * 0.8 ** (h - 1);
      sal[m] = s;
    }
    // Take back what the note a fifth-plus-octave below (19 semitones) explains as its 3rd harmonic:
    // this is the partial that pulls keys to the dominant.
    for (let m = HIGH_MIDI; m >= LOW_MIDI + 19; m--) sal[m] = Math.max(0, sal[m] - 0.5 * sal[m - 19]);

    const c = new Float64Array(12);
    for (let m = LOW_MIDI; m <= HIGH_MIDI; m++) c[m % 12] += Math.sqrt(sal[m]);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += c[i];
    if (sum <= 0) return;
    for (let i = 0; i < 12; i++) {
      const v = c[i] / sum;
      this.chroma[i] = this.chroma[i] * this.decay + v;
      this.chordChroma[i] = this.chordChroma[i] * this.chordDecay + v;
    }

    this.vote();
    this.chord = chordOf(this.chordChroma);
  }

  private vote(): void {
    const ranked = rankKeys(this.chroma);
    const best = ranked[0];
    const margin = best.score - ranked[1].score;
    const estimate: KeyEstimate = {
      tonic: best.tonic,
      mode: best.mode,
      confidence: Math.max(0, Math.min(1, best.score * 0.6 + Math.min(margin, 0.2) * 2)),
    };

    if (this.candidate && this.candidate.tonic === best.tonic && this.candidate.mode === best.mode) {
      this.candidateWins += 1;
    } else {
      this.candidateWins = 1;
    }
    this.candidate = estimate;

    const same = this.stable && this.stable.tonic === best.tonic && this.stable.mode === best.mode;
    if (same) {
      this.stable = estimate;
    } else if (this.candidateWins >= this.winsNeeded && margin >= this.minMargin) {
      this.stable = estimate;
    }
  }
}

/**
 * The chord dominating a short-memory chroma: the major or minor triad whose three bins hold the
 * most of the mass, shown only when they hold most of it. Sevenths and suspensions fold into the
 * nearest triad, which is what a singer reading solfa over a tune wants anyway.
 */
export function chordOf(chroma: ArrayLike<number>): ChordEstimate | null {
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (total <= 0) return null;
  let best: ChordEstimate | null = null;
  let bestMass = 0;
  for (let root = 0; root < 12; root++) {
    const fifth = chroma[(root + 7) % 12];
    const maj = chroma[root] + chroma[(root + 4) % 12] + fifth;
    const min = chroma[root] + chroma[(root + 3) % 12] + fifth;
    if (maj > bestMass) {
      bestMass = maj;
      best = { root, quality: "maj" };
    }
    if (min > bestMass) {
      bestMass = min;
      best = { root, quality: "min" };
    }
  }
  // Three of twelve bins hold a quarter of flat noise; ask for well over half before naming a chord.
  return best && bestMass / total >= 0.55 ? best : null;
}
