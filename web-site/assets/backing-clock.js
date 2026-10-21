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

  function secondsPerBeat(clock) {
    var tempo = Number(clock.tempo);
    return 60 / (isFinite(tempo) && tempo > 0 ? tempo : 120);
  }
  /** The beat times when they are usable (finite and increasing), else null and the tempo stands. */
  function beatTimes(clock) {
    var t = clock.beatTimesSec;
    if (!t || !t.length) return null;
    for (var i = 0; i < t.length; i++) {
      if (typeof t[i] !== "number" || !isFinite(t[i])) return null;
      if (i > 0 && !(t[i] > t[i - 1])) return null;
    }
    return t;
  }
  /** True when the song carries its own beat times (a tempo that moves), not just an origin and a tempo. */
  function hasBeatTimes(clock) { return !!clock && beatTimes(clock) !== null; }

  /** Where notation beat `beat` falls in the recording, in seconds. `clock`: { tempo, beatOriginSec, beatTimesSec }. */
  function audioTimeOfBeat(beat, clock) {
    var t = beatTimes(clock);
    if (!t) return (clock.beatOriginSec || 0) + beat * secondsPerBeat(clock);
    // One entry gives no interval to follow: the tempo carries on from it.
    if (t.length === 1) return t[0] + beat * secondsPerBeat(clock);
    var last = t.length - 1;
    if (beat <= 0) return t[0] + beat * (t[1] - t[0]);
    if (beat >= last) return t[last] + (beat - last) * (t[last] - t[last - 1]);
    var i = Math.floor(beat);
    return t[i] + (beat - i) * (t[i + 1] - t[i]);
  }

  /** The notation beat heard at `sec` in the recording: the inverse of `audioTimeOfBeat`. */
  function beatOfAudioTime(sec, clock) {
    var t = beatTimes(clock);
    if (!t) return (sec - (clock.beatOriginSec || 0)) / secondsPerBeat(clock);
    if (t.length === 1) return (sec - t[0]) / secondsPerBeat(clock);
    var last = t.length - 1;
    if (sec <= t[0]) return (sec - t[0]) / (t[1] - t[0]);
    if (sec >= t[last]) return last + (sec - t[last]) / (t[last] - t[last - 1]);
    var lo = 0, hi = last;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (t[mid] <= sec) lo = mid; else hi = mid;
    }
    return lo + (sec - t[lo]) / (t[lo + 1] - t[lo]);
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
    audioTimeOfBeat: audioTimeOfBeat, beatOfAudioTime: beatOfAudioTime, hasBeatTimes: hasBeatTimes, balanceGains: balanceGains
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.NfBackingClock = api;
})();
