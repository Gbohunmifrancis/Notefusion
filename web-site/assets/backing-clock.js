/* The song's backing on the sheet's clock (boards o-backing O1–O4, the shared backing contract): where a notation beat
 * falls in the recording, and how loud each side plays. Mirrors mobile/src/lib/backingClock.ts — the same cases are in
 * web-site/tests/backing-clock.test.mjs and the phone's own tests.
 *
 *   audioTimeOfBeat(b): with `beatTimesSec` (entry i is the recording's time of notation beat i, increasing), linear
 *   between entries; before beat 0 (a pickup) on with the first interval, past the last entry on with the last one.
 *   Without it, beatOriginSec + b · 60 / tempo.
 *
 * Playback that starts at beat f starts the backing at audioTimeOfBeat(f); every note plays at its own beat on that same
 * clock; at speed s (0.5–1) both run s times as fast and the backing keeps its pitch. The player that does this is
 * assets/choir.js (createPlayer, on its createTransport).
 *
 * Plain script, no build step. Exposes window.NfBackingClock (module.exports for the tests).
 */
(function () {
  "use strict";

  /** Where the balance starts: 40 % toward Backing, so the solfa is on top and the band sits under it. */
  var DEFAULT_BALANCE = 0.4;

  function beatTimes(clock) {
    var t = clock && clock.beatTimesSec;
    return Array.isArray(t) && t.length ? t : null;
  }
  function secondsPerBeat(clock) {
    var tempo = clock && Number(clock.tempo);
    return 60 / (tempo > 0 ? tempo : 100);
  }
  function origin(clock) { return (clock && Number(clock.beatOriginSec)) || 0; }
  /** The step past either end: the first or the last interval; a beat at the tempo when there is only one entry. */
  function edgeStep(times, first, clock) {
    var n = times.length - 1;
    var d = n < 1 ? 0 : first ? times[1] - times[0] : times[n] - times[n - 1];
    return d > 0 ? d : secondsPerBeat(clock);
  }

  /** The recording's time (s) of notation beat `beat`. `clock`: { tempo, beatOriginSec, beatTimesSec }. */
  function audioTimeOfBeat(beat, clock) {
    var times = beatTimes(clock);
    if (!times) return origin(clock) + beat * secondsPerBeat(clock);
    var n = times.length - 1;
    if (beat <= 0) return times[0] + beat * edgeStep(times, true, clock);
    if (beat >= n) return times[n] + (beat - n) * edgeStep(times, false, clock);
    var i = Math.floor(beat);
    return times[i] + (beat - i) * (times[i + 1] - times[i]);
  }

  /** The notation beat at the recording's time `sec`: audioTimeOfBeat's inverse. */
  function beatOfAudioTime(sec, clock) {
    var times = beatTimes(clock);
    if (!times) return (sec - origin(clock)) / secondsPerBeat(clock);
    var n = times.length - 1;
    if (sec <= times[0]) return (sec - times[0]) / edgeStep(times, true, clock);
    if (sec >= times[n]) return n + (sec - times[n]) / edgeStep(times, false, clock);
    var lo = 0, hi = n; // times[lo] <= sec < times[hi]
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (times[mid] <= sec) lo = mid; else hi = mid;
    }
    var span = times[hi] - times[lo];
    return lo + (span > 0 ? (sec - times[lo]) / span : 0);
  }

  /**
   * The two levels the balance sets (0 = the solfa alone, 1 = the backing alone): the louder side at full, the other at
   * its share of it. 0.4 is the solfa at full and the backing at two-thirds of it (40 : 60); the middle is both at full.
   */
  function balanceGains(balance) {
    var b = Math.min(1, Math.max(0, Number(balance)));
    if (!isFinite(b)) b = DEFAULT_BALANCE;
    return { solfa: b <= 0.5 ? 1 : (1 - b) / b, backing: b >= 0.5 ? 1 : b / (1 - b) };
  }

  var api = {
    DEFAULT_BALANCE: DEFAULT_BALANCE,
    audioTimeOfBeat: audioTimeOfBeat, beatOfAudioTime: beatOfAudioTime, balanceGains: balanceGains
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NfBackingClock = api;
})();
