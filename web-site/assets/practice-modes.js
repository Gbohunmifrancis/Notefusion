/* "More ways to practise" on the web: the modes beside the practice path (boards c-practice/6a–6d), the words and the
 * arithmetic apart from the screens that draw them (assets/practice-mode-view.js) and the hub's list
 * (assets/practice-view.js).
 *
 * Every mark is the server's (POST /api/practice/modes/grade); this file only lays out what was asked and what came
 * back: the hub's rows, the warm-up's timeline, the range finder's keyboard, pitch match's timed set and its needle
 * words (the needle reads assets/pitch-track.js), a run's blocks, speeds and drawn line, and a rhythm's claps.
 *
 * The mobile copy is mobile/src/lib/practiceModes.ts (tests: practiceModes.test.ts) — keep them in step.
 * Loaded with the Practice view, on demand.
 */
(function () {
  "use strict";

  // ── The hub's list ──────────────────────────────────────────────────────
  /** Every mode this build can open, in the hub's order (C# PracticeModes.All). */
  var MODE_IDS = ["warm-up", "pitch-match", "runs", "intervals", "harmony", "rhythm"];
  /** The warm-up's length (C# WarmUpRoutine: 45 + 60 + 45 + 30 s), said on its row before it is opened. */
  var WARM_UP_MINUTES = 3;

  /**
   * The hub's rows: the modes the server says are live for this track, in its order, each in the track's words. A
   * mode this build does not know is skipped (a newer server); null (an older server) lists none. `liveMeter` is true
   * where pitch match has its live needle (the web), so a phone never promises one.
   */
  function hubModes(modes, track, liveMeter) {
    var out = [];
    (modes || []).forEach(function (id) {
      if (MODE_IDS.indexOf(id) < 0 || out.some(function (r) { return r.id === id; })) return;
      var w = modeWords(id, track, liveMeter);
      out.push({ id: id, title: w.title, subtitle: w.subtitle, value: id === "warm-up" ? WARM_UP_MINUTES + " min" : null });
    });
    return out;
  }

  function modeWords(id, track, liveMeter) {
    var playful = track === "playful";
    switch (id) {
      case "warm-up":
        return { title: "Warm up", subtitle: playful ? "Wake your voice up with Doh" : "Breath, sirens, your range" };
      case "pitch-match":
        return {
          title: "Pitch match",
          subtitle: playful
            ? (liveMeter ? "Keep the needle in the green" : "Hear a note, then hold it steady")
            : (liveMeter ? "Hold a note in tune on a live meter" : "Hear a note, hold it, see how close")
        };
      case "runs":
        return { title: "Riffs & runs", subtitle: "Slow it down, then up to speed" };
      case "intervals":
        return playful ? { title: "Jump to the note", subtitle: "From doh up to soh, and more" } : { title: "Intervals", subtitle: "Hear doh, then sing the note asked" };
      case "harmony":
        return { title: "Sing the harmony", subtitle: "A third above the tune, in headphones" };
      default:
        return playful ? { title: "Clap it back", subtitle: "Copy the rhythm" } : { title: "Rhythm", subtitle: "Clap back what you hear" };
    }
  }

  /** A mode's name on its own screen's eyebrow and in the hub, in the track's words. */
  function modeTitle(id, track) { return modeWords(id, track, false).title; }

  /** The section's heading: Playful plays, Focused practises. */
  function modesHeading(track) { return track === "playful" ? "More ways to play" : "More ways to practise"; }

  /**
   * Focused's one small Doh beside the list, with one suggestion; Playful's Doh is the buddy at the top, so none here
   * (one Doh on screen at most). Null when there is nothing to suggest.
   */
  function modesDohLine(rows, track) {
    if (track === "playful" || !rows || rows.length === 0) return null;
    if (rows.some(function (r) { return r.id === "warm-up"; })) return "Warm up first? It makes the high notes easier.";
    if (rows.some(function (r) { return r.id === "pitch-match"; })) return "Hold one note in tune first. It wakes the ear up.";
    return null;
  }

  // ── The one line at the top (streak and level) ──────────────────────────
  /** "12,450": XP in thousands, grouped by hand as the phone's progressStrip does. */
  function grouped(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /** The streak and the level in one line, where the two stat cards used to open the view (board 6a). */
  function progressStrip(p) {
    var best = p.streak.best || 0, lapsed = p.streak.current <= 0 && best > 0;
    var streak = p.streak.current > 0 ? p.streak.current + "-day streak" : lapsed ? "Your best: " + best + " " + (best === 1 ? "day" : "days") : "No streak yet";
    var lv = p.level;
    var span = lv.nextLevelXp == null ? 0 : lv.nextLevelXp - lv.minXp;
    var fraction = lv.nextLevelXp == null ? 1 : span > 0 ? clamp01((p.xp - lv.minXp) / span) : 1;
    var toNext = lv.nextName ? grouped(lv.xpForNext) + " to " + lv.nextName : null;
    var label = (lapsed ? "No streak now. " + streak : streak) + ". Level " + lv.name + ", " + grouped(p.xp) + " XP" + (lv.nextName ? ", " + grouped(lv.xpForNext) + " XP to " + lv.nextName : "") + ".";
    return { streak: streak, level: lv.name, xp: grouped(p.xp) + " XP", toNext: toNext, fraction: fraction, label: label };
  }

  // ── Shared arithmetic ───────────────────────────────────────────────────
  /** Recording runs on this long after the last thing due, so a held ending is not cut (the server keeps more). */
  var MODE_TAIL_SEC = 1;
  /** The grader's windows (C# PracticeRules, server grade.py): in tune within 35 cents, close within 80. */
  var IN_TUNE_CENTS = 35, CLOSE_CENTS = 80;
  /** A mark this good passes: it lights a speed and offers the next (the path's own "moves on"). */
  var PASS_SCORE = 80;
  /** Harmony's tune under the singer's line, as Learn my part plays the other parts. */
  var TUNE_LEVEL = 0.25;

  function clamp01(v) { return typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
  function endBeat(list) { return (list || []).reduce(function (m, n) { return Math.max(m, n.startBeat + n.durBeats); }, 0); }

  /** Seconds per beat, floored at 30 BPM as every player here is. */
  function beatSeconds(tempo) { return 60 / Math.max(30, tempo || 0); }

  /** From beat one to the end of the last thing sung, played or clapped, in seconds. */
  function passageSeconds(ex) {
    return Math.max(endBeat(ex.notes), endBeat(ex.backing), endBeat(ex.claps)) * beatSeconds(ex.tempoBpm);
  }

  /** How long the browser records: the count-in, the passage and a second more, never past what the worker keeps. */
  function takeSeconds(ex, leadInSec) {
    var natural = leadInSec + passageSeconds(ex) + MODE_TAIL_SEC;
    return ex.maxTakeSeconds > 0 ? Math.min(ex.maxTakeSeconds, natural) : natural;
  }

  /** The first note the singer sings: the count-in holds it (the pitch pipe); null for a rhythm. */
  function firstSungPitch(ex) {
    var first = (ex.notes || []).slice().sort(function (a, b) { return a.startBeat - b.startBeat; })[0];
    return first ? first.pitchMidi : null;
  }

  /**
   * What a mode's take plays while it records: the count-in (clicks, with the first sung note held through its first
   * beats as a pitch pipe; `countIn` is practice.js's leadInPlan), then only what the mode plays under the singer:
   * pitch match's tones before each held note, and harmony's tune soft under the line when the singer has headphones
   * on (without them the tune would reach the microphone, and the grader follows one line). Never the notes being
   * marked, and no clicks after beat one.
   */
  function takeSound(ex, countIn, headphones) {
    var voices = [], pipe = firstSungPitch(ex);
    if (pipe != null && countIn.holdBeats > 0) {
      voices.push({ notes: [{ pitchMidi: pipe, startBeat: -countIn.beats, durBeats: countIn.holdBeats, degree: 1, solfa: "", octaveMark: "", conf: 1 }], gain: 0.9 });
    }
    if (ex.mode === "pitch-match" && ex.backing.length) voices.push({ notes: ex.backing.slice(), gain: 0.9 });
    if (ex.mode === "harmony" && headphones && ex.backing.length) voices.push({ notes: ex.backing.slice(), gain: TUNE_LEVEL });
    return { countInBeats: countIn.beats, beatsPerBar: countIn.beatsPerBar, voices: voices };
  }

  /**
   * "Hear it": what the singer is about to sing. A harmony line with the tune soft under it; a pitch-match set's notes
   * one to a beat (the set itself takes most of a minute); anything else as written.
   */
  function hearVoices(ex) {
    if (ex.mode === "pitch-match") return [{ notes: ex.notes.map(function (n, i) { return Object.assign({}, n, { startBeat: i, durBeats: 1 }); }), gain: 1 }];
    var voices = [{ notes: ex.notes.slice(), gain: 1 }];
    if (ex.mode === "harmony" && ex.backing.length) voices.push({ notes: ex.backing.slice(), gain: TUNE_LEVEL });
    return voices;
  }

  /** The index of the note due `t` seconds after beat one, or −1 between notes (and before or after them). */
  function noteDue(notes, tempo, t) {
    var beat = t / beatSeconds(tempo);
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      if (beat >= n.startBeat && beat < n.startBeat + n.durBeats) return i;
    }
    return -1;
  }

  var NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  /** "A4" for 69; flats when the key is spelled with them ("Doh is Bb"). */
  function midiName(midi, flats) {
    var m = Math.round(midi);
    return (flats ? NAMES_FLAT : NAMES_SHARP)[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  }

  /** True when the doh header spells its key with flats ("Doh is Bb", "Doh is F"). */
  function flatKey(dohHeader) {
    var name = String(dohHeader || "").replace(/^Doh is\s*/i, "").trim();
    return /b$/.test(name) || name === "F";
  }

  var SYLLABLES = { d: "doh", r: "ray", m: "me", f: "fah", s: "soh", l: "lah", t: "te" };

  /** How a note is said: "soh", "high doh" (d'), "low te" (t,); a chromatic by its own name ("fe", "ta"). */
  function syllableName(solfa, octaveMark) {
    var name = SYLLABLES[solfa] || solfa;
    var mark = octaveMark || "";
    if (mark.indexOf("'") >= 0) return "high " + name;
    if (mark.indexOf(",") >= 0) return "low " + name;
    return name;
  }

  /** "d'", "t,": a note as the sheet writes it. */
  function written(n) { return (n.solfa || "") + (n.octaveMark || ""); }

  /** A mark's cents as the marks print them: "+6", "−48", "0". */
  function centsText(cents) {
    if (cents == null || !isFinite(cents)) return "";
    var c = Math.round(cents);
    return c > 0 ? "+" + c : c < 0 ? "−" + Math.abs(c) : "0";
  }

  /** How a mark is drawn: green in tune, ink close (dashed, with ~), grey off (never red), dashed grey not sung. */
  function markTone(status) { return status === "wrong" ? "off" : status; }

  /** A notes-graded take's marks, one per note sung, labelled as the screen draws them. */
  function noteMarks(grade, notes) {
    var out = [];
    ((grade && grade.notes) || []).forEach(function (g) {
      var n = notes[g.index];
      if (!n) return;
      out.push({ index: g.index, text: written(n), cents: g.status === "missed" ? "—" : centsText(g.cents), tone: markTone(g.status) });
    });
    return out;
  }

  // ── Warm up (board 6d) ──────────────────────────────────────────────────
  /** "3 min": a routine's length, in whole minutes (at least one). */
  function minutesLabel(seconds) { return Math.max(1, Math.round(seconds / 60)) + " min"; }

  /** "0:45", "1:00". */
  function clockLabel(seconds) {
    var s = Math.max(0, Math.round(seconds));
    var r = s % 60;
    return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
  }

  /** The routine's steps in order, each numbered and timed. */
  function warmUpSteps(w) {
    var at = 0;
    return (w.steps || []).map(function (s, i) {
      var view = Object.assign({}, s, { number: i + 1, clock: clockLabel(s.seconds), startsAt: at });
      at += s.seconds;
      return view;
    });
  }

  /** A breathing pattern laid out in time: in, hold (when it has one), out, `cycles` times. */
  function breathPhases(b) {
    var count = 60 / Math.max(1, b.countsPerMinute || 60), out = [], at = 0;
    for (var cycle = 1; cycle <= Math.max(1, b.cycles); cycle++) {
      [["in", b.inCounts], ["hold", b.holdCounts], ["out", b.outCounts]].forEach(function (pair) {
        var counts = pair[1];
        if (!(counts > 0)) return;
        out.push({ phase: pair[0], counts: counts, seconds: counts * count, cycle: cycle, startsAt: at });
        at += counts * count;
      });
    }
    return out;
  }

  function breathSeconds(b) { return breathPhases(b).reduce(function (s, p) { return s + p.seconds; }, 0); }

  /** Where a breathing guide is `t` seconds in: the phase, its count and the word to show. */
  function breathAt(b, t) {
    var count = 60 / Math.max(1, b.countsPerMinute || 60), phases = breathPhases(b);
    for (var i = 0; i < phases.length; i++) {
      var p = phases[i];
      if (t >= p.startsAt && t < p.startsAt + p.seconds) {
        return {
          phase: p.phase,
          count: Math.min(p.counts, Math.floor((t - p.startsAt) / count) + 1),
          cycle: p.cycle,
          word: p.phase === "in" ? "Breathe in" : p.phase === "hold" ? "Hold" : "Out on “sss”",
          done: false
        };
      }
    }
    return { phase: null, count: 0, cycle: Math.max(1, b.cycles), word: t < 0 ? "Ready" : "Done", done: t >= 0 };
  }

  /** The beat of rest between a guide's rounds. */
  var GUIDE_GAP_BEATS = 1;

  /**
   * A guide as the synth plays it: the pattern, then `stepSemitones` higher each round, `rounds` times, a beat of rest
   * between. The solfa stays (doh moves up with each round, which is the point).
   */
  function guideNotes(g) {
    var length = endBeat(g.notes), out = [];
    for (var r = 0; r < Math.max(1, g.rounds); r++) {
      var shift = r * g.stepSemitones, at = r * (length + GUIDE_GAP_BEATS);
      g.notes.forEach(function (n) { out.push(Object.assign({}, n, { pitchMidi: n.pitchMidi + shift, startBeat: n.startBeat + at })); });
    }
    return out;
  }

  function guideSeconds(g) { return endBeat(guideNotes(g)) * beatSeconds(g.tempoBpm); }

  /** The round being played `t` seconds in (1-based), for "Round 2 of 5". */
  function guideRoundAt(g, t) {
    var round = Math.floor(t / ((endBeat(g.notes) + GUIDE_GAP_BEATS) * beatSeconds(g.tempoBpm))) + 1;
    return Math.min(Math.max(1, g.rounds), Math.max(1, round));
  }

  /**
   * A siren's line: a point at each note's start and one at the end of each round's last note, so the voice slides
   * from note to note in one smooth line (pitch moves evenly in semitones); rounds are apart, a beat of silence
   * between. Returned per round so a player can stop the sound in the gaps.
   */
  function glideRounds(g) {
    var beat = beatSeconds(g.tempoBpm), length = endBeat(g.notes);
    var sorted = g.notes.slice().sort(function (a, b) { return a.startBeat - b.startBeat; }), rounds = [];
    for (var r = 0; r < Math.max(1, g.rounds); r++) {
      var shift = r * g.stepSemitones, at = r * (length + GUIDE_GAP_BEATS);
      var points = sorted.map(function (n) { return { t: (n.startBeat + at) * beat, midi: n.pitchMidi + shift }; });
      var last = sorted[sorted.length - 1];
      if (last) points.push({ t: (last.startBeat + last.durBeats + at) * beat, midi: last.pitchMidi + shift });
      rounds.push(points);
    }
    return rounds;
  }

  /** The pitch a glide sings `t` seconds in (straight lines in semitones between its points); null outside it. */
  function glideMidiAt(points, t) {
    if (!points.length || t < points[0].t || t > points[points.length - 1].t) return null;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      if (t <= b.t) return b.t > a.t ? a.midi + ((b.midi - a.midi) * (t - a.t)) / (b.t - a.t) : b.midi;
    }
    return points[points.length - 1].midi;
  }

  /** The guide's one round as the routine draws it (board 6d's little chart): each note's middle, high at the top. */
  function guideShape(g) {
    var notes = g.notes.slice().sort(function (a, b) { return a.startBeat - b.startBeat; });
    if (!notes.length) return [];
    var length = endBeat(notes) || 1;
    var pitches = notes.map(function (n) { return n.pitchMidi; });
    var lo = Math.min.apply(null, pitches), hi = Math.max.apply(null, pitches);
    return notes.map(function (n) {
      return { x: (n.startBeat + n.durBeats / 2) / length, y: hi > lo ? (hi - n.pitchMidi) / (hi - lo) : 0.5, solfa: written(n) };
    });
  }

  // ── The range finder (board 6d) ─────────────────────────────────────────
  /** How long each end of the range finder records: the worker wants a hold of a second or more in it. */
  var RANGE_TAKE_SECONDS = 6;

  function rangeTitle(end) { return end === "low" ? "Your lowest note" : "Your highest note"; }
  function rangeInstruction(end) {
    return end === "low"
      ? "Sing “ah” and slide down until it starts to feel heavy. Hold the last note that still feels easy."
      : "Sing “ah” and slide up until it starts to feel tight. Hold the last note that still feels easy.";
  }
  /** Doh's one tip while the range finder listens. */
  function rangeTip(end) {
    return end === "low"
      ? "Comfortable, not your very lowest. If it rumbles, come back up a note."
      : "Comfortable, not your very highest. If it squeezes, come back down a note.";
  }

  /** "A3, held 2.4 s": what the take just held. */
  function heardLine(heard) { return heard.name + ", held " + heard.seconds.toFixed(1) + " s"; }

  /** "G3 to D5" once both ends are measured. */
  function rangeHeadline(r) { return r.low && r.high ? r.low + " to " + r.high : null; }

  /** "With doh on C: s, up to r'". */
  function rangeSolfaLine(r) {
    if (!r.lowSolfa || !r.highSolfa) return null;
    var doh = String(r.dohHeader || "").replace(/^Doh is\s*/i, "") || "C";
    return "With doh on " + doh + ": " + r.lowSolfa + " up to " + r.highSolfa;
  }

  /** "Sits well for Alto": a guide for choir parts, not a label. */
  function voicePartLine(part) { return part ? "Sits well for " + part.charAt(0).toUpperCase() + part.slice(1) : null; }

  /** The keyboard under the range: whole octaves from the C at or below the low note to the B above the high one. */
  function rangeKeys(lowMidi, highMidi) {
    var lo = Math.min(lowMidi, highMidi), hi = Math.max(lowMidi, highMidi);
    var from = Math.floor(lo / 12) * 12, to = Math.max(from + 23, Math.floor(hi / 12) * 12 + 11), keys = [];
    for (var m = from; m <= to; m++) {
      var pc = m % 12;
      keys.push({ midi: m, black: [1, 3, 6, 8, 10].indexOf(pc) >= 0, lit: m >= lo && m <= hi, label: pc === 0 ? midiName(m) : null });
    }
    return keys;
  }

  // ── Pitch match (board 6b) ──────────────────────────────────────────────
  /** Each note of a set: its tone (played) and then its hold (sung, marked), in seconds from beat one. */
  function pitchSlots(ex) {
    var beat = beatSeconds(ex.tempoBpm);
    return ex.notes.map(function (n, i) {
      var tone = ex.backing[i];
      var toneStart = tone ? tone.startBeat * beat : n.startBeat * beat;
      var toneEnd = tone ? (tone.startBeat + tone.durBeats) * beat : toneStart;
      return { index: i, note: n, toneStart: toneStart, toneEnd: toneEnd, holdStart: n.startBeat * beat, holdEnd: (n.startBeat + n.durBeats) * beat };
    });
  }

  /** Where a set is `t` seconds after beat one: hearing a note's tone, holding it, or done. */
  function pitchMomentAt(slots, t) {
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i], hold = s.holdEnd - s.holdStart;
      if (t < s.toneStart) return { index: s.index, phase: "before", held: 0, holdSeconds: hold };
      if (t < s.toneEnd) return { index: s.index, phase: "tone", held: 0, holdSeconds: hold };
      if (t < s.holdEnd) return { index: s.index, phase: "hold", held: Math.max(0, t - s.holdStart), holdSeconds: hold };
    }
    var last = slots[slots.length - 1];
    return { index: last ? last.index : -1, phase: "done", held: 0, holdSeconds: last ? last.holdEnd - last.holdStart : 0 };
  }

  /** "soh · A4 · note 3 of 8". */
  function noteCaption(n, index, count, flats) {
    return syllableName(n.solfa, n.octaveMark) + " · " + midiName(n.pitchMidi, flats) + " · note " + (index + 1) + " of " + count;
  }

  /** A MIDI pitch, fractional, for a frequency (A4 = 440 Hz = 69). */
  function midiOf(freqHz) { return 69 + 12 * Math.log2(freqHz / 440); }

  /**
   * How far a sung frequency is from the target, in cents, with whole octaves taken out (a man on a woman's note is
   * not wrong, as the grader has it): −600 to 600.
   */
  function centsOff(freqHz, targetMidi) {
    var diff = (midiOf(freqHz) - targetMidi) * 100;
    return diff - 1200 * Math.round(diff / 1200);
  }

  /** The needle's colour: the grader's own windows, so the needle and the final mark agree. */
  function needleZone(cents) {
    if (cents == null || !isFinite(cents)) return "none";
    var a = Math.abs(cents);
    return a <= IN_TUNE_CENTS ? "in" : a <= CLOSE_CENTS ? "close" : "off";
  }

  /** The needle's lean in degrees: ±100 cents fills the dial's ±60°. */
  function needleAngle(cents) {
    if (cents == null || !isFinite(cents)) return 0;
    return (Math.max(-100, Math.min(100, cents)) / 100) * 60;
  }

  /** What the needle says, a word and what to do; flat or sharp is a direction, never an alarm. */
  function needleWords(cents, syllable) {
    var zone = needleZone(cents);
    if (zone === "none") return { title: "Listening…", hint: "Sing “ah” on " + syllable + " and hold it." };
    if (zone === "in") return { title: "In tune", hint: "Sing “ah” on " + syllable + " and keep the needle in the green." };
    if (zone === "off") return { title: "Not quite: find " + syllable + " again", hint: "Hear it once more, then slide until the needle settles." };
    return cents < 0
      ? { title: "A little flat", hint: "Think of the note a little higher, and keep the breath going." }
      : { title: "A little sharp", hint: "Ease down a touch, and keep the breath going." };
  }

  /** Joins names as a sentence does: "doh", "doh and te", "doh, me and te". */
  function joinNames(names) {
    if (names.length <= 1) return names[0] || "";
    return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  }
  function capital(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /**
   * The one suggestion under a marked set, drawn from the marks themselves (board 6b): which notes came in flat or
   * sharp, or were not heard, and what to try. Null when every note was spot on.
   */
  function pitchAdvice(grade, notes) {
    var flat = [], sharp = [], missed = [], practise = [];
    (grade.notes || []).forEach(function (g) {
      var n = notes[g.index];
      if (!n || g.status === "hit") return;
      var name = syllableName(n.solfa, n.octaveMark);
      if (practise.indexOf(written(n)) < 0) practise.push(written(n));
      if (g.status === "missed" || g.cents == null) missed.push(name);
      else if (g.cents < 0) flat.push(name);
      else sharp.push(name);
    });
    if (!practise.length) return null;
    var parts = [];
    if (flat.length) parts.push(joinNames(flat) + " came in flat");
    if (sharp.length) parts.push(joinNames(sharp) + " came in sharp");
    if (missed.length) parts.push(joinNames(missed) + (missed.length === 1 ? " wasn't" : " weren't") + " heard");
    var body = missed.length && !flat.length && !sharp.length
      ? "Sing out and hold each note for its four beats."
      : practise.length === 1
        ? "Hold just that one, slowly, with the tone."
        : "Hold just those " + (practise.length === 2 ? "two" : practise.length) + ", slowly, with the tones.";
    return { title: capital(parts.join("; ")), body: body, practise: practise };
  }

  // ── Intervals ───────────────────────────────────────────────────────────
  /** An interval's two notes as the screen says them: from doh, up or down, to the note asked. */
  function intervalParts(ex) {
    var a = ex.notes[0], b = ex.notes[1];
    if (!a || !b) return null;
    return { from: syllableName(a.solfa, a.octaveMark), to: syllableName(b.solfa, b.octaveMark), up: b.pitchMidi > a.pitchMidi, size: ex.group };
  }

  // ── Riffs & runs (board 6c) ─────────────────────────────────────────────
  /** A run as blocks you can read at a glance (pitch up, length across), one row per note it uses, highest first. */
  function runRoll(notes) {
    var beats = endBeat(notes) || 1, rows = [];
    notes.slice().sort(function (a, b) { return b.pitchMidi - a.pitchMidi; }).forEach(function (n) {
      if (!rows.some(function (r) { return r.midi === n.pitchMidi; })) rows.push({ label: written(n), midi: n.pitchMidi });
    });
    var blocks = notes.map(function (n, i) {
      var row = 0;
      for (var k = 0; k < rows.length; k++) if (rows[k].midi === n.pitchMidi) { row = k; break; }
      return { index: i, row: row, x: n.startBeat / beats, w: n.durBeats / beats, label: written(n) };
    });
    return { rows: rows, blocks: blocks, beats: beats };
  }

  /** Where a pitch sits on the roll's rows (fractional; between two rows in proportion to the semitones). */
  function rollRowOf(midi, rows) {
    if (!rows.length) return 0;
    if (midi >= rows[0].midi) return 0;
    for (var i = 1; i < rows.length; i++) {
      var hi = rows[i - 1], lo = rows[i];
      if (midi >= lo.midi) return i - 1 + (hi.midi - midi) / Math.max(1e-9, hi.midi - lo.midi);
    }
    return rows.length - 1;
  }

  /** The take's pitch line over the roll: across by beat (from the trace's seconds), down by row. Points outside it drop. */
  function traceOnRoll(trace, roll, tempo) {
    var beat = beatSeconds(tempo), out = [];
    (trace || []).forEach(function (p) {
      var x = p.t / beat / roll.beats;
      if (!(x >= 0 && x <= 1) || !isFinite(p.midi)) return;
      out.push({ x: x, y: rollRowOf(p.midi, roll.rows) });
    });
    return out;
  }

  /** A run's speeds, slowest first; an exercise without them is its own one speed. */
  function speedSteps(ex) {
    var speeds = ex.speeds && ex.speeds.length
      ? ex.speeds.slice().sort(function (a, b) { return a.percent - b.percent; })
      : [{
          percent: ex.speedPercent != null ? ex.speedPercent : 100,
          exerciseId: ex.id,
          tempoBpm: ex.tempoBpm,
          shortestNoteSeconds: ex.notes.reduce(function (m, n) { return Math.min(m, n.durBeats); }, Infinity) * beatSeconds(ex.tempoBpm),
          grader: ex.grader,
          bestScore: ex.bestScore
        }];
    return speeds.map(function (s) { return Object.assign({}, s, { label: s.percent + "%", passed: (s.bestScore || 0) >= PASS_SCORE }); });
  }

  /** "36 BPM · quick notes 0.42 s". */
  function speedCaption(s) { return s.tempoBpm + " BPM · quick notes " + s.shortestNoteSeconds.toFixed(2) + " s"; }

  /** The brackets under the stepper: which speeds are marked note by note and which by the run's shape. */
  function markingBands(steps) {
    var bands = [];
    steps.forEach(function (s, i) {
      var last = bands[bands.length - 1];
      if (last && last.grader === s.grader) last.to = i;
      else bands.push({ from: i, to: i, grader: s.grader, label: s.grader === "run" ? "Shape + landing note" : "Marked note by note" });
    });
    return bands.map(function (b) { return { from: b.from, to: b.to, label: b.label }; });
  }

  /** The speed to offer after a mark: the next one up when it passed, else none (sing this one again). */
  function nextSpeed(steps, percent, score) {
    if (score < PASS_SCORE) return null;
    var up = steps.slice().sort(function (a, b) { return a.percent - b.percent; }).filter(function (s) { return s.percent > percent; });
    return up[0] || null;
  }

  /**
   * The plain line under a run marked note by note (board 6c): which note to fix, and, when the next speed is marked
   * by shape, why.
   */
  function runAdvice(grade, notes, next) {
    var worst = null;
    function weight(w) { return w.status === "missed" ? 1000 : Math.abs(w.cents || 0); }
    (grade.notes || []).forEach(function (g) {
      var n = notes[g.index];
      if (!n || g.status === "hit") return;
      var cand = { name: syllableName(n.solfa, n.octaveMark), cents: g.cents, status: g.status };
      if (!worst || weight(cand) > weight(worst)) worst = cand;
    });
    var lead = !worst ? null
      : worst.status === "missed" ? capital(worst.name) + " wasn't heard."
        : capital(worst.name) + " ran a little " + ((worst.cents || 0) < 0 ? "flat" : "sharp") + ".";
    var rest = next
      ? (next.grader === "run"
        ? "Next is " + next.percent + "%: from there the notes are too quick to mark one by one, so we mark the run's shape and the doh it lands on."
        : "Next is " + next.percent + "%.")
      : lead ? "Slow down, hear it again, then sing it once more." : null;
    return { lead: lead, rest: rest };
  }

  function trimNumber(n) { return n % 1 === 0 ? String(n) : n.toFixed(1).replace(/\.0$/, ""); }

  /** A full-speed run's two lines (board 6c): followed in order, and the landing note. */
  function runShapeLines(run, landing) {
    var all = run.followed >= run.runNotes;
    var name = landing ? syllableName(landing.solfa, landing.octaveMark) : "the last note";
    var beats = landing ? landing.durBeats : 0;
    var held = beats > 0 ? (beats === 1 ? "the full beat" : "the full " + trimNumber(beats) + " beats") : "its length";
    var followed = {
      ok: all,
      title: all ? "Followed the run" : "Followed " + run.followed + " of " + run.runNotes + " notes",
      sub: all ? "All " + run.runNotes + " notes, in order, on time" : "Slow it down a step and find the notes you skipped"
    };
    var c = run.landingCents == null ? null : Math.round(run.landingCents);
    var land = run.landing === "hit"
      ? { ok: true, title: "Landed on " + name, sub: "In tune, held for " + held }
      : run.landing === "near"
        ? { ok: false, title: "Landed near " + name, sub: c == null ? "Close: settle it in tune" : Math.abs(c) + " cents " + (c < 0 ? "flat" : "sharp") + ": settle it in tune" }
        : run.landing === "wrong"
          ? { ok: false, title: "Missed " + name + " at the end", sub: "Hear the last note again, then land on it" }
          : { ok: false, title: "No " + name + " heard at the end", sub: "Hold the last note for " + held };
    return [followed, land];
  }

  /** The run to open on: the first not yet learned (marked 80 or more at full speed), else the first. */
  function firstOpenRun(exercises) {
    function learned(e) { var full = (e.speeds || []).filter(function (s) { return s.percent === 100; })[0]; return ((full && full.bestScore) || 0) >= PASS_SCORE; }
    return exercises.filter(function (e) { return !learned(e); })[0] || exercises[0] || null;
  }

  /**
   * A unit's runs as the list under the stepper shows them: learned (marked 80 or more at full speed), the one open,
   * started (marked at some speed), or new.
   */
  function unitRuns(exercises, current) {
    return exercises.filter(function (e) { return e.group === current.group; }).map(function (e) {
      var speeds = e.speeds || [], full = null;
      speeds.forEach(function (s) { if (s.percent === 100) full = s; });
      var state = e.code === current.code ? "current"
        : ((full && full.bestScore) || 0) >= PASS_SCORE ? "learned"
          : speeds.some(function (s) { return s.bestScore != null; }) || e.bestScore != null ? "started" : "new";
      return { id: e.id, code: e.code, title: e.title, solfa: e.notes.map(written).join(" "), state: state };
    });
  }

  // ── Rhythm ──────────────────────────────────────────────────────────────
  /** A rhythm drawn on a beat grid: each clap a block as long as it lasts, the pattern rounded up to whole bars. */
  function clapLayout(claps, beatsPerBar) {
    var per = Math.max(1, beatsPerBar || 4), end = endBeat(claps);
    var beats = Math.max(per, Math.ceil(end / per - 1e-9) * per), bars = [];
    for (var b = per; b < beats; b += per) bars.push(b / beats);
    return { blocks: claps.map(function (c, i) { return { index: i, x: c.startBeat / beats, w: c.durBeats / beats }; }), bars: bars, beats: beats };
  }

  /** How a clap is said in a rhythm's syllables (Kodály): ta for a beat, ti for half, ta-a for two. */
  function clapSyllable(d) {
    if (d >= 3.5) return "ta-a-a-a";
    if (d >= 2.5) return "ta-a-a";
    if (d >= 1.75) return "ta-a";
    if (d >= 1.25) return "ta-i";
    if (d >= 0.75) return "ta";
    return "ti";
  }

  /** Each clap's mark as the screen shows it: in time, close (how early or late) or off (not heard), never red. */
  function clapMarks(rhythm) {
    return (rhythm.claps || []).map(function (c) {
      var ms = c.errorMs == null ? null : Math.round(c.errorMs);
      var when = ms == null ? "" : ms === 0 ? "on the beat" : Math.abs(ms) + " ms " + (ms < 0 ? "early" : "late");
      return {
        index: c.index,
        tone: c.status,
        word: c.status === "hit" ? "In time" : c.status === "near" ? "Close" : "Off",
        detail: c.status === "missed" ? "not heard" : when
      };
    });
  }

  /** One line on how a rhythm went beyond the marks: the tempo kept, extra claps, a lean early or late. */
  function rhythmAdvice(rhythm) {
    if (rhythm.tempoRatio > 1.05) return "You sped up a little. Count the beats in your head as you clap.";
    if (rhythm.tempoRatio < 0.95) return "You slowed down a little. Keep the beat moving as you clap.";
    if (rhythm.extra > 0) return (rhythm.extra === 1 ? "One extra clap" : rhythm.extra + " extra claps") + " crept in. Clap only on the pattern.";
    var errors = (rhythm.claps || []).map(function (c) { return c.errorMs; }).filter(function (e) { return e != null; });
    if (errors.length >= 2) {
      var mean = errors.reduce(function (s, e) { return s + e; }, 0) / errors.length;
      if (mean > 40) return "Most claps came a touch late. Lean into each one.";
      if (mean < -40) return "Most claps came a touch early. Wait for each one.";
    }
    if (rhythm.missed > 0) return "Clap a little louder so every clap is heard.";
    return null;
  }

  window.NfPracticeModes = {
    MODE_IDS: MODE_IDS, WARM_UP_MINUTES: WARM_UP_MINUTES, MODE_TAIL_SEC: MODE_TAIL_SEC, IN_TUNE_CENTS: IN_TUNE_CENTS,
    CLOSE_CENTS: CLOSE_CENTS, PASS_SCORE: PASS_SCORE, TUNE_LEVEL: TUNE_LEVEL, GUIDE_GAP_BEATS: GUIDE_GAP_BEATS,
    RANGE_TAKE_SECONDS: RANGE_TAKE_SECONDS,
    hubModes: hubModes, modeTitle: modeTitle, modesHeading: modesHeading, modesDohLine: modesDohLine, progressStrip: progressStrip,
    beatSeconds: beatSeconds, passageSeconds: passageSeconds, takeSeconds: takeSeconds, firstSungPitch: firstSungPitch, noteDue: noteDue,
    takeSound: takeSound, hearVoices: hearVoices,
    midiName: midiName, flatKey: flatKey, syllableName: syllableName, written: written, centsText: centsText, markTone: markTone,
    noteMarks: noteMarks, minutesLabel: minutesLabel, clockLabel: clockLabel, warmUpSteps: warmUpSteps, breathPhases: breathPhases,
    breathSeconds: breathSeconds, breathAt: breathAt, guideNotes: guideNotes, guideSeconds: guideSeconds, guideRoundAt: guideRoundAt,
    glideRounds: glideRounds, glideMidiAt: glideMidiAt, guideShape: guideShape, rangeTitle: rangeTitle, rangeInstruction: rangeInstruction,
    rangeTip: rangeTip, heardLine: heardLine, rangeHeadline: rangeHeadline, rangeSolfaLine: rangeSolfaLine, voicePartLine: voicePartLine,
    rangeKeys: rangeKeys, pitchSlots: pitchSlots, pitchMomentAt: pitchMomentAt, noteCaption: noteCaption, midiOf: midiOf,
    centsOff: centsOff, needleZone: needleZone, needleAngle: needleAngle, needleWords: needleWords, pitchAdvice: pitchAdvice,
    intervalParts: intervalParts, runRoll: runRoll, rollRowOf: rollRowOf, traceOnRoll: traceOnRoll, speedSteps: speedSteps,
    speedCaption: speedCaption, markingBands: markingBands, nextSpeed: nextSpeed, runAdvice: runAdvice, runShapeLines: runShapeLines,
    unitRuns: unitRuns, firstOpenRun: firstOpenRun, clapLayout: clapLayout, clapSyllable: clapSyllable, clapMarks: clapMarks, rhythmAdvice: rhythmAdvice
  };
})();
