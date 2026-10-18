/* "Learn my part": the practise view's arithmetic, apart from the page that draws it.
 *
 * A singer picks their part (remembered per browser), hears it loud with the others soft, alone, or
 * all equal, loops a few bars, slows them down, and sings them back to be marked. Grading takes the
 * part's notes for just the looped bars, moved to start at beat 0 and stretched by the slow-down, so
 * the worker's POST /v1/grade (via the C# /api/transcriptions/grade) needs nothing new: the take is a
 * count-in and then the singer alone, and the target is exactly what they were asked to sing.
 * The mobile copy is mobile/src/lib/practice.ts — keep the two in step.
 *
 * Plain functions over plain objects; app.js draws the view and drives the player.
 */
(function () {
  "use strict";

  var VOICES = ["soprano", "alto", "tenor", "bass"];
  /** How loud the other parts are under yours in the balanced mix (yours is 1). */
  var OTHERS_LEVEL = 0.25;
  var BALANCES = ["balance", "alone", "equal"];
  var SPEEDS = [0.5, 0.75, 1];
  /** A take is at most 120 s on the worker (GRADE_MAX_SECONDS); this leaves room for the tail. */
  var MAX_TAKE_SEC = 110;
  /** Recording runs on this long after the last bar, so a held ending is not cut. */
  var TAIL_SEC = 1;
  /** The worker refuses a target note shorter than this (MIN_NOTE_BEATS). */
  var MIN_NOTE_BEATS = 1 / 16;

  function beatsPerBar(ts) { var p = String(ts || "4/4").split("/").map(Number); return p[0] && p[1] ? (p[0] * 4) / p[1] : 4; }
  function beatSec(tempo) { return 60 / Math.max(30, tempo || 0); }

  /** The parts a singer can practise, tune first: the soprano (the tune) always, the others the sheet has. */
  function partsOf(parts) {
    return VOICES.filter(function (v) { return v === "soprano" || (parts && parts[v] && parts[v].notes && parts[v].notes.length); });
  }

  /** The remembered part when this sheet has it, else the tune. */
  function choosePart(available, remembered) {
    return available.indexOf(remembered) >= 0 ? remembered : available[0] || "soprano";
  }

  /** Each part's level in the mix: yours at 1; the others soft ("balance"), silent ("alone") or at 1 ("equal"). */
  function levels(names, mine, balance) {
    var out = {};
    names.forEach(function (n) { out[n] = n === mine || balance === "equal" ? 1 : balance === "alone" ? 0 : OTHERS_LEVEL; });
    return out;
  }

  /** Where the loop starts out: the whole tune when it is short, else the first phrase (four bars). */
  function defaultRange(barCount) {
    var bars = Math.max(1, barCount || 1);
    return { from: 1, to: bars <= 8 ? bars : 4 };
  }

  /**
   * Choosing the bars by tapping two of them. The first tap loops that bar alone and waits; the second
   * makes the range between the two, whichever order they came in. Returns { range, pending }.
   */
  function tapBar(pending, bar) {
    if (pending == null) return { range: { from: bar, to: bar }, pending: bar };
    return { range: { from: Math.min(pending, bar), to: Math.max(pending, bar) }, pending: null };
  }

  /**
   * The notes of bars from..to (1-based, inclusive), moved so the first bar starts at beat 0. A note is
   * in the range when it starts inside it; one held past the last bar-line is cut there. `index` maps
   * each sliced note back to its place in `notes`, so a mark lands on the note the singer sees.
   */
  function sliceBars(notes, from, to, ts) {
    var bpb = beatsPerBar(ts), start = (from - 1) * bpb, end = to * bpb;
    var out = [], index = [];
    (notes || []).forEach(function (n, i) {
      if (!(n.pitchMidi > 0) || n.startBeat < start - 1e-6 || n.startBeat >= end - 1e-6) return;
      var dur = Math.min(n.durBeats, end - n.startBeat);
      if (dur < MIN_NOTE_BEATS) return;
      out.push(Object.assign({}, n, { startBeat: n.startBeat - start, durBeats: dur }));
      index.push(i);
    });
    return { notes: out, index: index, beats: end - start };
  }

  /** Seconds the sliced bars take at this speed (1 = the sheet's tempo). */
  function sliceSeconds(slice, tempo, speed) { return slice.beats * beatSec(tempo) / (speed || 1); }

  /** The longest count-in before a take: from pressing Sing to beat one, in seconds. */
  var MAX_LEAD_IN_SEC = 5;

  /**
   * The count-in before every take — a drill (practice-progress.js), "Sing it" and "Sing it back" (app.js) — at
   * most MAX_LEAD_IN_SEC: the starting note held, then clicks that end on beat one, a click on every beat
   * throughout. A whole bar of clicks after the note when that and a beat of the note fit; the note then fills
   * what is left in whole beats (at least one, at most a bar). At a slow tempo fewer clicks, so the wait stays
   * inside the five seconds, and never fewer than two beats in all. `speed` slows the beat as a slowed practice
   * does (the 30 BPM floor first, as every player here has it). Returns { beats, holdBeats (the note's), beatsPerBar
   * (the click a whole bar before beat one is accented), beatSec, seconds }. Mirrors mobile lib/practice.ts
   * leadInPlan; the server takes the seconds as the take's lead-in.
   */
  function leadInPlan(tempo, ts, speed) {
    var beat = beatSec(tempo) / (speed || 1);
    var bar = Math.max(1, Math.round(beatsPerBar(ts)));
    var fit = Math.max(2, Math.floor(MAX_LEAD_IN_SEC / beat + 1e-9));
    var clicks = Math.min(bar, fit - 1);
    var hold = Math.min(bar, fit - clicks);
    return { beats: hold + clicks, holdBeats: hold, beatsPerBar: bar, beatSec: beat, seconds: (hold + clicks) * beat };
  }

  /** True when a take of these bars (count-in included) would be longer than the worker marks. */
  function tooLong(slice, tempo, speed, leadInSec) { return leadInSec + sliceSeconds(slice, tempo, speed) + TAIL_SEC > MAX_TAKE_SEC; }

  /**
   * The GradeTarget for a take of the sliced bars: beats stretched by 1 / speed at the sheet's tempo
   * (floored at 30 BPM as every player here is), so a take sung at half speed is judged at half speed.
   */
  function gradeTarget(slice, tempo, speed, leadInSec) {
    var s = speed || 1;
    return {
      notes: slice.notes.map(function (n) { return { pitchMidi: n.pitchMidi, startBeat: n.startBeat / s, durBeats: n.durBeats / s }; }),
      tempoBpm: Math.min(300, Math.max(30, tempo || 0)),
      leadInSec: leadInSec
    };
  }

  /** The grade's marks by index into the part's notes: { 12: {status, cents}, … }. */
  function marksByNote(grade, slice) {
    var out = {};
    ((grade && grade.notes) || []).forEach(function (m) {
      var i = slice.index[m.index];
      if (i != null) out[i] = { status: m.status, cents: m.cents };
    });
    return out;
  }

  /** The part's notes bar by bar, for the strip a singer taps: [{bar, notes: [{i, note}]}], every bar listed. */
  function bars(notes, ts, barCount) {
    var bpb = beatsPerBar(ts), out = [];
    for (var b = 1; b <= barCount; b++) out.push({ bar: b, notes: [] });
    (notes || []).forEach(function (n, i) {
      if (!(n.pitchMidi > 0)) return;
      var b = Math.min(barCount, Math.floor(n.startBeat / bpb + 1e-6) + 1);
      if (b >= 1) out[b - 1].notes.push({ i: i, note: n });
    });
    return out;
  }

  window.NfPractice = {
    VOICES: VOICES, OTHERS_LEVEL: OTHERS_LEVEL, BALANCES: BALANCES, SPEEDS: SPEEDS, TAIL_SEC: TAIL_SEC,
    MAX_LEAD_IN_SEC: MAX_LEAD_IN_SEC,
    partsOf: partsOf, choosePart: choosePart, levels: levels, defaultRange: defaultRange, tapBar: tapBar,
    sliceBars: sliceBars, sliceSeconds: sliceSeconds, leadInPlan: leadInPlan, tooLong: tooLong, gradeTarget: gradeTarget,
    marksByNote: marksByNote, bars: bars
  };
})();
