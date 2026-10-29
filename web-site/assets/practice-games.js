/* The quick games beside the sung practice (board s-practice-fun/s3), the words and the arithmetic apart from the
 * screen that draws them (assets/practice-game-view.js) and the hub's row (assets/practice-view.js): the games' names
 * on each track, where a note and a key signature sit on the treble stave, what a round's verdict says, and the end.
 *
 * The server deals every round (GET /api/practice/games/{game}) and marks the answers that count
 * (POST /api/practice/games/grade); the page only says at once whether a tap was right, from the round's own answer.
 *
 * The mobile copy is mobile/src/lib/practiceGames.ts (tests: practiceGames.test.ts) — keep them in step.
 * Loaded with the Practice view, on demand.
 */
(function () {
  "use strict";

  var GAME_IDS = ["which-note", "staff", "hymn", "which-scale"];

  function gameTitle(id, track) {
    if (id === "staff") return track === "playful" ? "Note race" : "Staff to solfa";
    if (id === "which-scale") return "Which scale?";
    return id === "hymn" ? "Name that hymn" : "Which note?";
  }

  var GAME_LINES = {
    "which-note": function (playful) { return playful ? "Hear it, find it" : "Hear doh, then the note"; },
    staff: function (playful) { return playful ? "Quick! Name the note" : "Read the stave as solfa"; },
    hymn: function () { return "Hear the opening, pick it"; },
    "which-scale": function (playful) { return playful ? "Happy, sad or far away?" : "Hear a scale, name it"; }
  };

  /** The games in the hub's order, named for the track (Playful's race is "Note race"). */
  function gameTiles(track) {
    var playful = track === "playful";
    return GAME_IDS.map(function (id) { return { id: id, title: gameTitle(id, track), line: GAME_LINES[id](playful) }; });
  }

  /** What the game's opening card says before the first round. */
  function gameIntro(id, track) {
    if (id === "which-note") {
      return track === "playful"
        ? "Doh plays first, then another note. Tap where it sits on the ladder."
        : "You hear doh, then a note. Tap the note on the ladder. Doh's key changes every round.";
    }
    if (id === "staff") {
      return track === "playful"
        ? "A note lands on the stave. Tap its name, as many as you can in a minute."
        : "A note appears on the stave. Tap its solfa, as many as you can in 60 seconds. The key changes every ten notes.";
    }
    if (id === "which-scale") {
      return track === "playful"
        ? "A scale plays up and back down. Is it the happy major, the sad minor, or one from far away? Pick its name."
        : "A scale plays up and back down. Pick its name: major and minor first, then the pentatonics, the modes and the world's.";
    }
    return "A hymn's opening plays on the piano. Pick its name from three.";
  }

  // ── Which note? ─────────────────────────────────────────────────────────
  var SYLLABLE_NAMES = { d: "doh", r: "ray", m: "me", f: "fah", s: "soh", l: "lah", t: "te", "d'": "doh" };

  /** "soh" for "s"; the top doh is "doh" too; a note an octave off says so ("high ray", "low lah"); chromatics as they are. */
  function syllableName(syllable) {
    if (SYLLABLE_NAMES[syllable]) return SYLLABLE_NAMES[syllable];
    var base = String(syllable || "").replace(/[',]+$/, ""), name = SYLLABLE_NAMES[base] || base;
    return /'$/.test(syllable) ? "high " + name : /,$/.test(syllable) ? "low " + name : name;
  }

  var STEP_LINES = {
    r: "The second note of the scale.",
    m: "The third note of the scale.",
    f: "The fourth note of the scale.",
    s: "The fifth note of the scale.",
    l: "The sixth note of the scale.",
    t: "The seventh, just under doh.",
    "d'": "Doh again, an octave up.",
    "r'": "Ray, an octave up.",
    "m'": "Me, an octave up.",
    "t,": "Te below doh, leaning up to it.",
    "l,": "Lah below doh.",
    "s,": "Soh below doh.",
    de: "Doh raised a semitone.",
    ma: "Me lowered a semitone.",
    fe: "Fah raised a semitone, leaning to soh.",
    se: "Soh raised a semitone, leaning to lah.",
    ta: "Te lowered a semitone, leaning to lah."
  };

  function capitalise(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

  /** What a round says once it is answered: its title and one line under it. */
  function verdict(game, round, tapped) {
    var right = tapped === round.answer;
    if (game === "which-scale") {
      var named = function (code) { var sc = (round.scales || []).filter(function (x) { return x.code === code; })[0]; return sc ? sc.title : "That scale"; };
      return right ? { right: right, title: "That's it!", line: named(round.answer) } : { right: right, title: "Not this time", line: "It was " + named(round.answer).replace(/^The /, "the ") + "." };
    }
    if (game === "hymn") {
      var hit = (round.hymns || []).filter(function (h) { return h.slug === round.answer; })[0];
      var title = hit ? hit.title : "That hymn";
      return right ? { right: right, title: "That's it!", line: title } : { right: right, title: "Not this time", line: "It was " + title + "." };
    }
    var name = syllableName(round.answer);
    if (right) return { right: right, title: capitalise(name) + "!", line: game === "staff" ? round.noteName + " in " + round.doh + " major." : STEP_LINES[round.answer] || "" };
    return {
      right: right,
      title: "It was " + name,
      line: game === "staff" ? round.noteName + " is " + name + " when doh is " + round.doh + "." : "You tapped " + syllableName(tapped) + ". Listen to both again."
    };
  }

  /** Right answers in a row, read off the marks so far: the flame's number. */
  function comboOf(marks) {
    var run = 0;
    for (var i = marks.length - 1; i >= 0 && marks[i]; i--) run++;
    return run;
  }

  /** Which note? plays doh, then the note: one beat each with a breath between, at this tempo. */
  var EAR_TEMPO = 80;

  /** An arcade round's `noteSeconds` (shorter at the higher levels) sounds each note that long at EAR_TEMPO instead. */
  function earNotes(round) {
    if (round.dohMidi == null || round.noteMidi == null) return [];
    if (round.noteSeconds > 0) {
      var beats = round.noteSeconds * EAR_TEMPO / 60;
      return [
        { pitchMidi: round.dohMidi, startBeat: 0, durBeats: beats },
        { pitchMidi: round.noteMidi, startBeat: beats * 1.25, durBeats: beats }
      ];
    }
    return [
      { pitchMidi: round.dohMidi, startBeat: 0, durBeats: 1 },
      { pitchMidi: round.noteMidi, startBeat: 1.25, durBeats: 1.5 }
    ];
  }

  // ── Staff to solfa ──────────────────────────────────────────────────────
  /** E4, the treble stave's bottom line, as octave × 7 + letter (C = 0). */
  var BOTTOM_LINE = 4 * 7 + 2;

  /**
   * Where a note sits on the treble stave: half-spaces up from the bottom line (E4 = 0, F4 = 1, the top line F5 = 8,
   * G5 = 9 just over it). Null for a name it cannot read.
   */
  function staffStep(noteName) {
    var m = /^([A-G])([#b]?)(\d)$/.exec(noteName || "");
    if (!m) return null;
    return Number(m[3]) * 7 + "CDEFGAB".indexOf(m[1]) - BOTTOM_LINE;
  }

  /** The accidental a note's name carries (the key signature already shows it, so the note is drawn plain). */
  function accidentalOf(noteName) {
    var m = /^[A-G]([#b])\d$/.exec(noteName || "");
    return m ? m[1] : null;
  }

  /** The treble key signature: where each sharp (F C G D A E B) or flat (B E A D G C F) sits, as `staffStep` counts. */
  var SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4];
  var FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1];

  function keySignature(fifths) {
    if (fifths > 0) return SHARP_STEPS.slice(0, Math.min(7, fifths)).map(function (step) { return { sign: "#", step: step }; });
    if (fifths < 0) return FLAT_STEPS.slice(0, Math.min(7, -fifths)).map(function (step) { return { sign: "b", step: step }; });
    return [];
  }

  /** The race's clock: "0:37". */
  function clock(seconds) {
    var s = Math.max(0, Math.ceil(seconds));
    var r = s % 60;
    return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
  }

  // ── The end ─────────────────────────────────────────────────────────────
  /** The end card's big line: "8 of 10 right", or for the race "14 right". */
  function resultTitle(grade) {
    return grade.game === "staff" ? grade.right + " right" : grade.right + " of " + grade.rounds + " right";
  }

  /** The line under it: how the race went, or what the game earned and why it did not. */
  function resultLine(grade, perDay) {
    var how = grade.game === "staff" && grade.answered > 0 ? grade.score + "% of the " + grade.answered + " you answered. " : "";
    if (grade.counted && grade.reward) return how + "+" + grade.reward.xpGained + " XP";
    if (grade.notCounted === "few") return how + "Answer at least five notes for a race to count.";
    if (grade.notCounted === "daily") return how + "Played for fun: today's " + perDay + " games that earn XP are done.";
    return how.trim();
  }

  window.NfPracticeGames = {
    GAME_IDS: GAME_IDS, EAR_TEMPO: EAR_TEMPO,
    gameTiles: gameTiles, gameTitle: gameTitle, gameIntro: gameIntro, syllableName: syllableName, verdict: verdict,
    comboOf: comboOf, earNotes: earNotes, staffStep: staffStep, accidentalOf: accidentalOf, keySignature: keySignature,
    clock: clock, resultTitle: resultTitle, resultLine: resultLine
  };
})();
