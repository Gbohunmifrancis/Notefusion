/* Which reward moments a marked take earns, and with what values (the moments: design/rive/moments, played by
 * assets/moments.js). Pure: the Practice view hands in the track, the progress as it stood before the take and the
 * grade; play-along hands in its score.
 *
 * A Playful take shows its stars first. Then one moment at most, the biggest the take earned: a level or a badge (the
 * 3D pieces the view already plays, so none here), a unit or grade finished (the music box), the week's goal met on the
 * day's first take (the ring), the day's first take (the streak), a run of five or more notes in tune (the combo), and
 * for Playful's three stars with nothing else, Doh cheering. Phones wait for a store build with the Rive player.
 * Plain script, no build step. Exposes window.NfPracticeMoments.
 */
(function () {
  "use strict";

  // Each piece's artboard (CSS px at full size) and how long it plays (ms): design/rive/moments/<piece>.luau's PERIOD.
  var PIECES = {
    stars: { width: 440, height: 240, ms: 3000 },
    streak: { width: 360, height: 360, ms: 3600 },
    goal: { width: 360, height: 380, ms: 3600 },
    combo: { width: 460, height: 230, ms: 3800 },
    musicbox: { width: 400, height: 440, ms: 4000 },
    doh: { width: 380, height: 420, ms: 3600 }
  };
  var RUN_AT_LEAST = 5;

  /** 1-3 stars for a mark, as practice-track.js gives them (80 and up three, 50 and up two). */
  function starsFor(score) { return score >= 80 ? 3 : score >= 50 ? 2 : 1; }

  /** The most notes in tune one after another in a take's marks ("hit"). */
  function longestRun(marks) {
    var best = 0, now = 0;
    (marks || []).forEach(function (m) { now = m && m.status === "hit" ? now + 1 : 0; if (now > best) best = now; });
    return best;
  }

  function moment(piece, values) { return { piece: piece, values: values || {} }; }

  /** The one big moment a take earned beside a level or badge (null: none, or the 3D piece plays). */
  function mainFor(track, before, grade) {
    var reward = grade && grade.reward;
    if (reward && (reward.levelUp || (reward.newBadges || []).length)) return null;
    if (grade && grade.milestone) return moment("musicbox", { label: grade.milestone.kind === "grade" ? "Grade done!" : "Unit done!" });
    var firstToday = !!(before && before.streak && !before.streak.todayDone);
    if (firstToday) {
      var goal = before.weeklyGoal;
      if (goal && goal.target > 0 && goal.daysDone < goal.target && goal.daysDone + 1 >= goal.target) {
        return moment("goal", { done: goal.daysDone + 1, target: goal.target });
      }
      if (reward && reward.streak >= 1) return moment("streak", { days: reward.streak });
    }
    var marks = (grade && grade.notes) || [], run = longestRun(marks);
    if (run >= RUN_AT_LEAST) return moment("combo", { run: run, perfect: run === marks.length ? 1 : 0 });
    if (track === "playful" && grade && starsFor(grade.score) === 3) return moment("doh");
    return null;
  }

  /**
   * The moments a marked take earns, in the order they play: Playful's stars, then the biggest of the rest.
   * track: "playful" | "focused" | null; before: the progress before the take (streak, weeklyGoal); grade: the mark.
   */
  function momentsFor(track, before, grade) {
    var out = [];
    if (!grade) return out;
    if (track === "playful") out.push(moment("stars", { stars: starsFor(grade.score) }));
    var main = mainFor(track, before, grade);
    if (main) out.push(main);
    return out;
  }

  /** Play-along's end: its stars from the share of notes right first time, and a perfect run of five or more. */
  function alongMoments(score) {
    if (!score || !score.total) return [];
    var share = score.firstTime / score.total;
    var out = [moment("stars", { stars: share >= 0.9 ? 3 : share >= 0.6 ? 2 : 1 })];
    if (score.firstTime === score.total && score.total >= RUN_AT_LEAST) out.push(moment("combo", { run: score.total, perfect: 1 }));
    return out;
  }

  window.NfPracticeMoments = { PIECES: PIECES, RUN_AT_LEAST: RUN_AT_LEAST, momentsFor: momentsFor, alongMoments: alongMoments, longestRun: longestRun };
})();
