/* The live pitch meter on the web: pitch match's needle (board c-practice/6b), read off the microphone in the browser.
 *
 * YIN (de Cheveigné & Kawahara, 2002) on one frame of samples: the squared difference of the frame against itself at
 * every lag, normalised by its running mean, and the first dip under a threshold is the period, refined by a parabola
 * through its neighbours. A frame too quiet, or with no clear period (breath, hiss, a clap), reads as nothing. The
 * needle only guides: it reports nothing, and every mark is still the server's.
 *
 * Pure (a Float32Array in, a frequency out) and unit-tested on synthetic tones (web-site/tests/pitch-track.test.mjs).
 * Web only: phones have no live pitch stream until a store build adds one, so there is no mobile copy yet.
 * Loaded with the mode screens (assets/practice-mode-view.js), only when a mode is opened.
 */
(function () {
  "use strict";

  /** The voice's compass, with room: a bass's low E2 (82 Hz) to a soprano's high C6 (1047 Hz). */
  var MIN_HZ = 65, MAX_HZ = 1100;
  /** The first lag whose normalised difference dips under this is the period (YIN's absolute threshold). */
  var THRESHOLD = 0.15;
  /** With no dip under the threshold, the deepest one still counts while it is under this; above it, no pitch. */
  var UNVOICED = 0.35;
  /** Quieter than this (RMS of the frame, full scale 1) is silence, not a note. */
  var MIN_RMS = 0.01;

  function rms(buf) {
    var s = 0;
    for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return buf.length ? Math.sqrt(s / buf.length) : 0;
  }

  /**
   * The fundamental of one frame, `{ freq, clarity }` (clarity 0–1, 1 a perfect period), or null when nothing pitched
   * is there. A frame of 2048 samples at 44.1–48 kHz covers the lowest note twice over.
   */
  function detectPitch(buf, sampleRate) {
    var n = buf.length;
    var minTau = Math.max(2, Math.floor(sampleRate / MAX_HZ));
    var maxTau = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(n / 2));
    if (maxTau <= minTau + 2 || rms(buf) < MIN_RMS) return null;
    var w = n - maxTau;
    var d = new Float32Array(maxTau + 2);
    for (var tau = 1; tau <= maxTau + 1 && tau < n - w + 1; tau++) {
      var sum = 0;
      for (var j = 0; j < w; j++) { var diff = buf[j] - buf[j + tau]; sum += diff * diff; }
      d[tau] = sum;
    }
    // The cumulative mean normalised difference: 1 at lag 0, dipping towards 0 at the period and its multiples.
    var cmnd = new Float32Array(maxTau + 2);
    cmnd[0] = 1;
    var running = 0;
    for (tau = 1; tau <= maxTau + 1; tau++) {
      running += d[tau];
      cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    var best = -1;
    for (tau = minTau; tau <= maxTau; tau++) {
      if (cmnd[tau] < THRESHOLD) {
        while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      var lowest = Infinity;
      for (tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < lowest) { lowest = cmnd[tau]; best = tau; }
      if (lowest > UNVOICED) return null;
    }
    // A parabola through the dip and its neighbours puts the period between samples.
    var a = cmnd[best - 1], b = cmnd[best], c = cmnd[best + 1];
    var denom = a - 2 * b + c;
    var shift = best > minTau && best < maxTau && denom > 0 ? (a - c) / (2 * denom) : 0;
    var period = best + Math.max(-1, Math.min(1, shift));
    return { freq: sampleRate / period, clarity: Math.max(0, Math.min(1, 1 - b)) };
  }

  /**
   * A short memory of readings that steadies the needle: the median of the last few pitches (as MIDI), so one stray
   * frame (an octave slip, a consonant) never throws it, and nothing once the voice has been gone a moment.
   */
  function createSmoother(size) {
    var keep = Math.max(1, size || 5), recent = [], gaps = 0;
    return {
      push: function (midi) {
        if (midi == null || !isFinite(midi)) {
          gaps++;
          if (gaps >= 3) recent = [];
          return recent.length ? median(recent) : null;
        }
        gaps = 0;
        recent.push(midi);
        if (recent.length > keep) recent.shift();
        return median(recent);
      },
      reset: function () { recent = []; gaps = 0; }
    };
  }

  function median(values) {
    var s = values.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  window.NfPitchTrack = { MIN_HZ: MIN_HZ, MAX_HZ: MAX_HZ, MIN_RMS: MIN_RMS, rms: rms, detectPitch: detectPitch, createSmoother: createSmoother, median: median };
})();
