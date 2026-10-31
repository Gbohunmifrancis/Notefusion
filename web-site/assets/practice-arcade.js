/* The game-coloured Practice on the web: the arithmetic and words of the path drawn as stops, the unit's banner, the
 * day's quests, and the arcade (the quick games played stage after stage, a level at a time, with no top). Pure, apart
 * from `remember`/`recall`, which keep each game's level in the browser (the server deals any level asked; the level is
 * this browser's to keep, never a reward). The server's ladder is PracticeGames.cs; the words here say what each level
 * brings, in step with it (tests: web-site/tests/practice-arcade.test.mjs). The phone's
 * lib/practiceArcade.ts is a port of it, with the same tests.
 * Loaded with the Practice view. Exposes window.NfPracticeArcade.
 */
(function () {
  "use strict";

  // ── The arcade ──────────────────────────────────────────────────────────
  /** A stage passed at this score deals the next level; under LEVEL_DOWN the one below. As the server's. */
  var LEVEL_UP = 80, LEVEL_DOWN = 50;

  /** The level each track starts a game at: Playful the gentlest, Focused where its one-off games were. */
  function startLevel(track) { return track === "playful" ? 1 : 3; }

  /** Right answers a stage needs to deal the next level. */
  function stageGoal(rounds) { return Math.ceil(rounds * LEVEL_UP / 100); }

  /** How many more right answers this stage needs for the next level (0 once it has them). */
  function toLevelUp(marks, rounds) {
    var right = (marks || []).filter(Boolean).length;
    return Math.max(0, stageGoal(rounds) - right);
  }

  /** The stage's bar toward the next level, 0–1. */
  function stageFraction(marks, rounds) {
    var goal = stageGoal(rounds);
    return goal ? Math.min(1, (marks || []).filter(Boolean).length / goal) : 0;
  }

  /** Right answers in a row across stages: the flame's number. */
  function runAfter(run, right) { return right ? run + 1 : 0; }

  var EAR_NEW = [["m", "s", "d'"], ["r", "f"], ["l", "t"], ["r'", "m'"], ["t,", "l,", "s,"], ["fe"], ["ta"], ["se"], ["de"], ["ma"]];
  var EAR_FULL = EAR_NEW.length;
  var STAFF_NEW = [null, "D and B♭", "A and E♭", "E and A♭, and ledger lines", "B and D♭, low C to top C", "F♯ and G♭"];
  var HYMN_CHOICES = [3, 3, 4, 4, 5, 5, 6];

  /** Which scale?'s levels, as the server brings them (PracticeGames.ScaleLevels), with each scale's short name. */
  var SCALE_NEW = [["major", "natural-minor"], ["harmonic-minor"], ["major-pentatonic", "minor-pentatonic"], ["blues"], ["melodic-minor"],
    ["dorian", "mixolydian"], ["phrygian", "lydian"], ["hijaz", "whole-tone"], ["japanese-in", "double-harmonic"], ["hungarian-minor", "locrian"]];
  var SCALE_NAMES = {
    "major": "major", "natural-minor": "minor", "harmonic-minor": "harmonic minor", "major-pentatonic": "major pentatonic",
    "minor-pentatonic": "minor pentatonic", "blues": "blues", "melodic-minor": "melodic minor", "dorian": "Dorian",
    "mixolydian": "Mixolydian", "phrygian": "Phrygian", "lydian": "Lydian", "hijaz": "Hijaz", "whole-tone": "whole-tone",
    "japanese-in": "Japanese in", "double-harmonic": "double harmonic", "hungarian-minor": "Hungarian minor", "locrian": "Locrian"
  };
  function scaleTempo(level) { return Math.min(200, 96 + 8 * Math.max(0, level - SCALE_NEW.length)); }

  function staffSeconds(level) { return Math.max(1.5, 6 - 0.5 * (Math.max(1, level) - 1)); }
  function hymnChoices(level) { return HYMN_CHOICES[Math.min(HYMN_CHOICES.length, Math.max(1, level)) - 1]; }
  function hymnNotes(level) { return level <= 2 ? null : Math.max(4, 12 - 2 * (level - 3)); }
  function seconds(s) { return (Math.round(s * 10) / 10) + " s"; }

  /** What a level brings, in a few words: "New: fe", "New keys: D and B♭", "5 hymns to pick from". */
  function levelNews(game, level) {
    var l = Math.max(1, level);
    if (game === "which-note") {
      if (l <= EAR_FULL) return (l === 1 ? "Notes: " : "New: ") + EAR_NEW[l - 1].join(", ");
      return "Every note, played shorter";
    }
    if (game === "which-scale") {
      if (l > SCALE_NEW.length) return "Quicker: " + scaleTempo(l) + " beats a minute";
      var names = SCALE_NEW[l - 1].map(function (c) { return SCALE_NAMES[c]; }).join(" and ");
      return (l === 1 ? "Scales: " : "New: ") + names;
    }
    if (game === "staff") {
      if (l === 1) return "Keys: C, G and F";
      if (l <= STAFF_NEW.length) return "New keys: " + STAFF_NEW[l - 1];
      return seconds(staffSeconds(l)) + " a note";
    }
    if (l <= 2) return hymnChoices(l) + " hymns to pick from";
    var choices = hymnChoices(l), before = hymnChoices(l - 1);
    return choices > before ? choices + " hymns to pick from" : hymnNotes(l) + " notes of each opening";
  }

  /** The next two levels' news, then what every level after brings: the level-up screen's "What's coming". */
  function comingNext(game, level) {
    var next = [{ level: level + 1, text: levelNews(game, level + 1) }, { level: level + 2, text: levelNews(game, level + 2) }];
    var after = game === "which-note" ? "Every level after: shorter notes, quicker ears"
      : game === "staff" ? "Every level after: less time on each note"
      : game === "which-scale" ? "Every level after: quicker scales"
      : "Every level after: less of each opening to go on";
    next.push({ level: null, text: after });
    return next;
  }

  // ── The level kept in this browser ──────────────────────────────────────
  function storageKey(game) { return "nf.arcade." + game; }

  /** The game's level and best here; a track's first level when none is kept (or storage is shut). */
  function recall(game, track, storage) {
    var start = startLevel(track), got = null;
    try { got = JSON.parse((storage || window.localStorage).getItem(storageKey(game)) || "null"); } catch (e) { got = null; }
    var level = got && got.level >= 1 ? Math.floor(got.level) : start;
    var best = got && got.best >= 1 ? Math.floor(got.best) : level;
    return { level: level, best: Math.max(best, level) };
  }

  /** Keeps a game's level and its best; the best never falls. */
  function remember(game, level, storage) {
    var store = storage || (typeof window !== "undefined" ? window.localStorage : null), was = null;
    try { was = JSON.parse(store.getItem(storageKey(game)) || "null"); } catch (e) { was = null; }
    var best = Math.max(level, was && was.best >= 1 ? was.best : level);
    try { store.setItem(storageKey(game), JSON.stringify({ level: level, best: best })); } catch (e) { /* private window: kept for the visit */ }
    return { level: level, best: best };
  }

  // ── The path as stops ───────────────────────────────────────────────────
  /** Stops snake left and right like a path, as sideways offsets in px from the middle. */
  var SNAKE = [0, 44, 72, 44, 0, -44, -72, -44];

  /**
   * The unit as stops down the path: the drills behind the singer done, the one offered now, those ahead locked, then the
   * unit's chest. Each stop with its sideways offset. Empty for a drill with no place on a path (a season's).
   */
  function pathStops(drill) {
    if (!drill || !(drill.drillCount > 0) || !(drill.drillIndex > 0)) return [];
    var stops = [];
    for (var i = 1; i <= drill.drillCount; i++) {
      stops.push({ kind: i < drill.drillIndex ? "done" : i === drill.drillIndex ? "current" : "locked", index: i });
    }
    stops.push({ kind: "chest", index: drill.drillCount + 1 });
    return stops.map(function (s, k) { s.offset = SNAKE[k % SNAKE.length]; return s; });
  }

  /** The unit's banner: "GRADE 3 · UNIT 2" over the unit's title, in its grade's colour (Mastery its own). */
  var TONES = ["green", "blue", "orange", "cyan", "pink"];
  function unitBanner(drill) {
    if (!drill || !drill.grade) return null;
    var mastery = /^Mastery /.test(drill.grade), n = parseInt(String(drill.grade).replace(/\D+/g, ""), 10) || 1;
    var tone = mastery ? "pink" : /^Advanced/.test(drill.grade) ? "cyan" : TONES[(n - 1) % 4];
    var eyebrow = drill.grade.toUpperCase() + (drill.unitIndex > 0 ? " · UNIT " + drill.unitIndex + (drill.unitCount > 0 ? " OF " + drill.unitCount : "") : "");
    return { eyebrow: eyebrow, title: drill.unit || drill.title, tone: tone, mastery: mastery };
  }

  // ── The day's quests ────────────────────────────────────────────────────
  /** "Quests 2/3", and whether the chest is open, for the top bar's chip. */
  function questsChip(quests) {
    if (!quests || !quests.quests || !quests.quests.length) return null;
    var done = quests.quests.filter(function (q) { return q.done; }).length;
    return { done: done, total: quests.quests.length, label: "Quests " + done + "/" + quests.quests.length, open: !!quests.chestOpened };
  }

  /** A quest's bar, 0–1, and its "2/3". */
  function questProgress(q) {
    return { fraction: q.target > 0 ? Math.min(1, q.progress / q.target) : 0, text: Math.min(q.progress, q.target) + "/" + q.target };
  }

  /** Whether a take opened the chest: none open before, open after. */
  function chestJustOpened(before, after) {
    return !!(after && after.chestOpened) && !(before && before.chestOpened);
  }

  window.NfPracticeArcade = {
    LEVEL_UP: LEVEL_UP, LEVEL_DOWN: LEVEL_DOWN, SCALE_LEVELS: SCALE_NEW,
    startLevel: startLevel, stageGoal: stageGoal, toLevelUp: toLevelUp, stageFraction: stageFraction, runAfter: runAfter,
    levelNews: levelNews, comingNext: comingNext, staffSeconds: staffSeconds, scaleTempo: scaleTempo, recall: recall, remember: remember,
    pathStops: pathStops, unitBanner: unitBanner, questsChip: questsChip, questProgress: questProgress, chestJustOpened: chestJustOpened
  };
})();
