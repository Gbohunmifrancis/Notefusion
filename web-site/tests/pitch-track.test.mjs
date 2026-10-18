// node --test web-site/tests/*.test.mjs
// pitch-track.js is pitch match's live needle on the web: YIN on one frame of microphone samples. Checked here on
// synthetic tones: pure sines, a voice-like tone whose fundamental is weaker than its overtones, noise and silence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/pitch-track.js", import.meta.url), "utf8"), { window, Float32Array });
const T = window.NfPitchTrack;
const modes = {};
vm.runInNewContext(readFileSync(new URL("../assets/practice-modes.js", import.meta.url), "utf8"), { window: modes });
const M = modes.NfPracticeModes;

const FRAME = 2048;
const cents = (heard, want) => 1200 * Math.log2(heard / want);

/** A frame of a tone: partials as [harmonic, amplitude], with a phase that does not start at zero. */
function tone(freq, sampleRate, partials = [[1, 0.5]], length = FRAME) {
  const buf = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (const [h, a] of partials) v += a * Math.sin((2 * Math.PI * freq * h * i) / sampleRate + 0.3 * h);
    buf[i] = v;
  }
  return buf;
}

/** A repeatable noise (no Math.random, so the test never flakes). */
function noise(length, level) {
  const buf = new Float32Array(length);
  let x = 12345;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = level * ((x / 0x7fffffff) * 2 - 1);
  }
  return buf;
}

test("a pure sine reads within a few cents, across the voice's compass and both common sample rates", () => {
  for (const sampleRate of [44100, 48000]) {
    for (const freq of [82.41, 110, 196, 261.63, 440, 587.33, 880, 1046.5]) {
      const got = T.detectPitch(tone(freq, sampleRate), sampleRate);
      assert.ok(got, `${freq} Hz at ${sampleRate}`);
      assert.ok(Math.abs(cents(got.freq, freq)) < 3, `${freq} Hz at ${sampleRate} read ${got.freq.toFixed(2)}`);
      assert.ok(got.clarity > 0.9);
    }
  }
});

test("a voice-like tone reads at its fundamental, not an overtone, even when the overtones are louder", () => {
  // An "ah" on A3: the second and third harmonics above the fundamental, as a sung vowel often has them.
  const ah = [[1, 0.25], [2, 0.5], [3, 0.4], [4, 0.2], [5, 0.1]];
  for (const freq of [146.83, 220, 392]) {
    const got = T.detectPitch(tone(freq, 48000, ah), 48000);
    assert.ok(got);
    assert.ok(Math.abs(cents(got.freq, freq)) < 5, `${freq} Hz read ${got.freq.toFixed(2)}`);
  }
});

test("a tone with a little noise still reads; noise alone, a whisper and silence read as nothing", () => {
  const sr = 44100;
  const noisy = tone(330, sr);
  const hiss = noise(FRAME, 0.05);
  for (let i = 0; i < FRAME; i++) noisy[i] += hiss[i];
  const got = T.detectPitch(noisy, sr);
  assert.ok(got && Math.abs(cents(got.freq, 330)) < 10);
  assert.equal(T.detectPitch(noise(FRAME, 0.3), sr), null);
  assert.equal(T.detectPitch(tone(330, sr, [[1, 0.005]]), sr), null);
  assert.equal(T.detectPitch(new Float32Array(FRAME), sr), null);
  assert.equal(T.detectPitch(new Float32Array(64), sr), null);
});

test("the needle reads the detector the grader's way: 6 cents sharp of soh is in tune, 48 flat of high doh close", () => {
  const sr = 48000;
  const soh = 440 * 2 ** (6 / 1200); // A4, 6 cents sharp
  const got = T.detectPitch(tone(soh, sr), sr);
  const c = M.centsOff(got.freq, 69);
  assert.ok(Math.abs(c - 6) < 3, `read ${c}`);
  assert.equal(M.needleZone(c), "in");
  const highDoh = 587.33 * 2 ** (-48 / 1200); // D5, 48 cents flat
  const c2 = M.centsOff(T.detectPitch(tone(highDoh, sr), sr).freq, 74);
  assert.ok(Math.abs(c2 + 48) < 3, `read ${c2}`);
  assert.equal(M.needleZone(c2), "close");
  assert.equal(M.needleWords(c2, "high doh").title, "A little flat");
  // A man singing it an octave down is on the note.
  const low = M.centsOff(T.detectPitch(tone(220, sr), sr).freq, 69);
  assert.ok(Math.abs(low) < 3);
});

test("the smoother takes the median of the last readings and lets go after a short silence", () => {
  const s = T.createSmoother(5);
  assert.equal(s.push(69), 69);
  assert.equal(s.push(69.2), 69.1);
  assert.equal(s.push(81), 69.2); // one octave slip does not throw the needle
  assert.equal(s.push(null), 69.2);
  assert.equal(s.push(null), 69.2);
  assert.equal(s.push(null), null); // three frames of nothing: the voice has gone
  assert.equal(s.push(60), 60);
  s.reset();
  assert.equal(s.push(null), null);
  assert.equal(T.median([3, 1, 2]), 2);
  assert.ok(Math.abs(T.rms(tone(440, 48000)) - 0.5 / Math.SQRT2) < 0.01);
});
