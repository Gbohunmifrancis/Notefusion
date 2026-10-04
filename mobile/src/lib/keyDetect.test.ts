// Run with `npm test` (node --test): Node strips the types itself, so the module under test must
// stay import-free and use erasable syntax only. The test files are outside the tsc project
// (tsconfig `exclude`) because `@types/node` is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KeyDetector, chordOf, type KeyEstimate } from "./keyDetect.ts";

const SR = 16000;

/** A decaying chord with five harmonics per note, `cents` off concert pitch. */
function chord(midis: number[], sec: number, cents = 0): Float32Array {
  const out = new Float32Array(Math.round(sec * SR));
  for (const m of midis) {
    const f0 = 440 * 2 ** ((m - 69 + cents / 100) / 12);
    for (let h = 1; h <= 5; h++) {
      for (let i = 0; i < out.length; i++) {
        out[i] += (0.2 / h) * Math.sin((2 * Math.PI * f0 * h * i) / SR) * Math.exp(-i / SR / 1.5);
      }
    }
  }
  return out;
}

/** Plays the progression three times through, in 250 ms chunks like the microphone service sends. */
function run(detector: KeyDetector, prog: number[][], cents = 0) {
  let status = detector.status();
  for (let r = 0; r < 3; r++) {
    for (const c of prog) {
      const audio = chord(c, 1.0, cents);
      for (let i = 0; i < audio.length; i += SR / 4) status = detector.push(audio.subarray(i, i + SR / 4));
    }
  }
  return status;
}

/** Test-only mirror of solfa.ts's la-based rule, so a relative-key reading still passes on its doh. */
const dohOf = (k: KeyEstimate) => (k.mode === "major" ? k.tonic : (k.tonic + 3) % 12);

const C_MAJOR = [[48, 64, 67, 72], [53, 65, 69, 72], [55, 62, 67, 71], [48, 64, 67, 72]];
const G_MAJOR = [[43, 59, 62, 67], [48, 60, 64, 67], [50, 57, 62, 66], [43, 59, 62, 67]];
const A_MINOR = [[45, 60, 64, 69], [50, 62, 65, 69], [52, 59, 64, 68], [45, 60, 64, 69]];
const EB_MAJOR = [[51, 67, 70, 75], [56, 68, 72, 75], [58, 65, 70, 74], [51, 67, 70, 75]];

test("C major I-IV-V-I -> doh C, heard", () => {
  const s = run(new KeyDetector(SR), C_MAJOR);
  assert.ok(s.hearing);
  assert.ok(s.stable);
  assert.equal(dohOf(s.stable), 0);
  assert.ok(s.stable.confidence > 0.4);
});

test("G major played 30 cents sharp -> doh G", () => {
  const s = run(new KeyDetector(SR), G_MAJOR, 30);
  assert.ok(s.stable);
  assert.equal(dohOf(s.stable), 7);
});

test("A minor i-iv-V-i -> doh C (la-based minor)", () => {
  const s = run(new KeyDetector(SR), A_MINOR);
  assert.ok(s.stable);
  assert.equal(dohOf(s.stable), 0);
});

test("Eb major -> doh Eb", () => {
  const s = run(new KeyDetector(SR), EB_MAJOR);
  assert.ok(s.stable);
  assert.equal(dohOf(s.stable), 3);
});

test("silence: nothing heard, no key", () => {
  const d = new KeyDetector(SR);
  const s = d.push(new Float32Array(SR * 2));
  assert.equal(s.hearing, false);
  assert.equal(s.stable, null);
  assert.equal(s.chord, null);
});

test("hearing drops after a second of silence and comes back with sound", () => {
  const d = new KeyDetector(SR);
  run(d, C_MAJOR);
  assert.ok(d.status().hearing);
  const quiet = d.push(new Float32Array(SR * 1.5));
  assert.equal(quiet.hearing, false);
  // The key found is kept through the gap rather than thrown away.
  assert.ok(quiet.stable);
  const back = d.push(chord([48, 64, 67, 72], 0.5));
  assert.ok(back.hearing);
});

test("a new key is shown only after it keeps winning", () => {
  const d = new KeyDetector(SR, { halfLifeSec: 2 });
  run(d, C_MAJOR);
  assert.equal(dohOf(d.status().stable!), 0);
  // One short chord from far away does not move the doh…
  const first = d.push(chord([54, 66, 70, 73], 0.3));
  assert.equal(dohOf(first.stable!), 0);
  // …but a sustained change of key does.
  const s = run(d, [[54, 66, 70, 73], [59, 66, 71, 75], [61, 65, 68, 73], [54, 66, 70, 73]]);
  assert.equal(dohOf(s.stable!), 6);
});

test("chordOf names the triad holding the mass and declines flat noise", () => {
  const dMinor = new Array(12).fill(0.02);
  dMinor[2] = 1;
  dMinor[5] = 0.8;
  dMinor[9] = 0.9;
  assert.deepEqual(chordOf(dMinor), { root: 2, quality: "min" });
  assert.equal(chordOf(new Array(12).fill(1)), null);
});

test("a live D minor chord is read from the audio", () => {
  const d = new KeyDetector(SR);
  const audio = chord([50, 57, 62, 65], 1.5);
  let s = d.status();
  for (let i = 0; i < audio.length; i += SR / 4) s = d.push(audio.subarray(i, i + SR / 4));
  assert.deepEqual(s.chord, { root: 2, quality: "min" });
});
