/* Practice on the web: the arithmetic and wording of the Practice view, apart from the page that draws it.
 *
 * How full the XP bar and the weekly ring are, what the streak card and a reward say, the seven day dots, the
 * drill's count-in and how long a take runs, and the plain sentence for anything that goes wrong. Every number
 * is the server's (C# Application/Practice, GET /api/practice/progress); nothing here scores a take.
 * The mobile copies are mobile/src/lib/practiceProgress.ts and lib/take.ts — keep them in step.
 *
 * Plain functions over plain objects; assets/practice-view.js draws the view. Loaded with it, on demand.
 */
(function () {
  "use strict";

  /** Recording runs on this long after the last note, so a held ending is not cut (mobile TAIL_SEC). */
  var TAIL_SEC = 1;
  var LETTERS = "SMTWTFS";

  function clamp01(v) { return typeof v === "number" && isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }

  /** How far through the current level `xp` is, 0–1 (full at the top level). */
  function levelFraction(level, xp) {
    if (!level || level.nextLevelXp == null) return 1;
    var span = level.nextLevelXp - level.minXp;
    return span > 0 ? clamp01((xp - level.minXp) / span) : 1;
  }

  /** How much of the weekly goal is done, 0–1. */
  function weeklyFraction(goal) { return goal && goal.target > 0 ? clamp01(goal.daysDone / goal.target) : 0; }

  /** "185 XP to Fah", or the top level's own line. */
  function nextLevelLine(level) { return level.nextName ? level.xpForNext + " XP to " + level.nextName : "Top of the ladder"; }

  /** "4-day streak", "1-day streak", "No streak yet". */
  function streakLabel(days) { return days > 0 ? days + "-day streak" : "No streak yet"; }

  /** The streak card's line: done, at risk, or none to keep. */
  function streakLine(streak) {
    return streak.todayDone ? "Done for today" : streak.atRisk ? "Sing today to keep it" : "Sing a drill to start one";
  }

  /** The week's one freeze: still there, or spent. */
  function freezeLine(streak) { return streak.freezeAvailable ? "Streak freeze ready this week" : "Freeze used this week"; }

  /** Earned badges first (newest first), then locked ones nearest to done. */
  function sortBadges(badges) {
    var earned = (badges || []).filter(function (b) { return b.earned; })
      .sort(function (a, b) { return String(b.earnedAtUtc || "").localeCompare(String(a.earnedAtUtc || "")); });
    var locked = (badges || []).filter(function (b) { return !b.earned; })
      .sort(function (a, b) { return badgeFraction(b) - badgeFraction(a); });
    return earned.concat(locked);
  }

  /** A badge's progress bar, 0–1 (full once earned). */
  function badgeFraction(b) { return b.earned ? 1 : clamp01(b.progress / Math.max(1, b.target)); }

  /**
   * The one line a marked take earns: a level-up beats a badge beats the XP. Null when it earned nothing to say
   * (the day's XP cap reached and nothing unlocked) — no toast for nothing.
   */
  function rewardMoment(reward) {
    if (!reward) return null;
    if (reward.levelUp) return { line: "Level up — you're now " + reward.level.name + "!", big: true };
    var badge = (reward.newBadges || [])[0];
    if (badge) return { line: "Badge earned: " + badge.title, big: true };
    if (!(reward.xpGained > 0)) return null;
    return { line: reward.streak > 1 ? "+" + reward.xpGained + " XP · " + streakLabel(reward.streak) : "+" + reward.xpGained + " XP", big: false };
  }

  /** The analytics a reward is worth: `level_up` and one `badge_earned` per badge, details as k=v;k=v. */
  function rewardEvents(reward) {
    if (!reward) return [];
    var out = [];
    if (reward.levelUp) out.push({ name: "level_up", detail: "level=" + reward.level.name + ";index=" + reward.level.index });
    (reward.newBadges || []).forEach(function (b) { out.push({ name: "badge_earned", detail: "badge=" + b.code }); });
    return out;
  }

  /** "M", "T", … for a `yyyy-mm-dd`, by the calendar alone (no time zone can move it). */
  function weekdayLetter(day) {
    var p = String(day).split("-").map(Number);
    return LETTERS[new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1)).getUTCDay()];
  }

  var DAY_WORDS = {
    done: "practised",
    frozen: "missed, kept by the streak freeze",
    missed: "missed",
    today: "today, not practised yet",
    none: "before your first practice"
  };
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  /** The last seven days as dots: { date, status, letter, label } — a tick for done, a snowflake for frozen. */
  function dayDots(days) {
    return (days || []).map(function (d) {
      var p = String(d.date).split("-").map(Number);
      var wd = WEEKDAYS[new Date(Date.UTC(p[0], (p[1] || 1) - 1, p[2] || 1)).getUTCDay()];
      var status = DAY_WORDS[d.status] ? d.status : "none";
      return { date: d.date, status: status, letter: weekdayLetter(d.date), label: wd + ": " + DAY_WORDS[status] };
    });
  }

  /** Drills still to be marked today, or null when the allowance is unknown. */
  function drillsLeft(allowance) { return allowance ? Math.max(0, allowance.limit - allowance.used) : null; }

  /**
   * "midnight", "1:30 am": when the drill allowance starts again, on this device's clock. `offsetMinutes` is
   * Date.getTimezoneOffset() at that moment (minutes behind UTC), passed in by the tests.
   */
  function resetTime(resetsAtUtc, offsetMinutes) {
    var t = resetsAtUtc ? Date.parse(resetsAtUtc) : NaN;
    if (!isFinite(t)) return null;
    var offset = typeof offsetMinutes === "number" ? offsetMinutes : new Date(t).getTimezoneOffset();
    var local = new Date(t - offset * 60000), h = local.getUTCHours(), m = local.getUTCMinutes();
    if (h === 0 && m === 0) return "midnight";
    return (h % 12 === 0 ? 12 : h % 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "am" : "pm");
  }

  /** "7 of 10 marked drills left today", or, once they are sung, a warm last word with when more come. */
  function allowanceLine(allowance, offsetMinutes) {
    var left = drillsLeft(allowance);
    if (left == null) return "";
    if (left > 0) return left + " of " + allowance.limit + " marked drills left today";
    var when = resetTime(allowance.resetsAtUtc, offsetMinutes);
    return "That's all " + allowance.limit + " of today's drills. Well sung! " + (when ? "More from " + when + "." : "More tomorrow.");
  }

  // ── The practice path (the server's: grades → units → drills; mobile lib/practiceProgress.ts) ──
  /** "Grade 2 · Unit 3 · 4 of 6", with "· Harder" or "· Easier" when the last take moved it; null without a place. */
  function pathLine(drill) {
    if (!drill || !drill.grade || !(drill.unitIndex > 0) || !(drill.drillCount > 0)) return null;
    var moved = drill.adjustment === "harder" ? " · Harder" : drill.adjustment === "easier" ? " · Easier" : "";
    return drill.grade + " · Unit " + drill.unitIndex + " · " + drill.drillIndex + " of " + drill.drillCount + moved;
  }

  /** How much of the unit is behind the singer, 0–1: the thin bar under the path line. */
  function unitFraction(drill) { return drill && drill.drillCount > 0 ? clamp01((drill.drillIndex - 1) / drill.drillCount) : 0; }

  /** The result's main button: on to the next drill, or the same one again when the path brings it back after a miss. */
  function nextAction(current, next, track) {
    var same = !!next && !!current && next.id === current.id;
    if (track === "playful") return { label: same ? "Try again!" : "Next one!", same: same };
    return { label: same ? "Try it again" : "Next drill", same: same };
  }

  function beatsPerBar(ts) { var p = String(ts || "4/4").split("/").map(Number); return p[0] && p[1] ? (p[0] * 4) / p[1] : 4; }
  function beatSec(tempo) { return 60 / Math.max(30, tempo || 0); }

  /**
   * The count-in before the singer: `leadInBeats` of clicks (8 = two bars of 4/4), the first note held through
   * the first bar of them as a pitch pipe. Its length in seconds is the server's own (DrillCatalogue.LeadInSeconds),
   * since the take is graded with that lead-in — mobile lib/take.leadInFor.
   */
  function leadIn(drill) {
    var beats = drill.leadInBeats > 0 ? drill.leadInBeats : 2 * beatsPerBar(drill.timeSignature);
    var first = (drill.notes || []).slice().sort(function (a, b) { return a.startBeat - b.startBeat; })[0];
    return {
      beats: beats,
      holdBeats: Math.min(beats, beatsPerBar(drill.timeSignature)),
      pitchMidi: first ? first.pitchMidi : 60,
      beatSec: beatSec(drill.tempoBpm),
      seconds: beats * beatSec(drill.tempoBpm)
    };
  }

  /** How long the drill itself runs, in seconds. */
  function partSeconds(notes, tempo) {
    var end = (notes || []).reduce(function (m, n) { return Math.max(m, n.startBeat + Math.max(0, n.durBeats)); }, 0);
    return end * beatSec(tempo);
  }

  /** When the take stops by itself: a second after the last note, never past what the server keeps. */
  function takeSeconds(drill) {
    var natural = leadIn(drill).seconds + partSeconds(drill.notes, drill.tempoBpm) + TAIL_SEC;
    return drill.maxTakeSeconds > 0 ? Math.min(drill.maxTakeSeconds, natural) : natural;
  }

  /** The note due `elapsed` seconds into the recording, or −1 (count-in, between notes, after the end). */
  function noteDueAt(notes, tempo, leadSec, elapsed) {
    var beat = (elapsed - leadSec) / beatSec(tempo);
    for (var i = 0; i < (notes || []).length; i++) {
      var n = notes[i];
      if (beat >= n.startBeat && beat < n.startBeat + n.durBeats) return i;
    }
    return -1;
  }

  /**
   * What a singer reads when a take could not be marked. `err` is the app's ApiError ({status, code, message});
   * its message is already plain (friendlyMessage), so only the cases this view says better are rewritten.
   */
  function gradeError(err) {
    var status = err && err.status, code = err && err.code;
    if (code === "PRACTICE_DAILY_LIMIT") return err.message || "That's today's marked drills done. Come back tomorrow for more.";
    if (status === 429) return "That's a lot of takes in a short time. Wait a minute, then sing it again.";
    if (status === 0 || status === undefined) return "Your take couldn't be sent. Check your connection and sing it again.";
    if (status >= 500) return "We couldn't mark your take just now. Please sing it again in a moment.";
    return (err && err.message) || "We couldn't mark your take. Please sing it again.";
  }

  /** What a singer reads when the microphone could not be opened (getUserMedia's error, by name). */
  function micError(err) {
    var name = err && err.name;
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
      return "NoteFusion needs your microphone to hear the drill. Allow it for this site (the icon by the address bar), then press Sing it again.";
    if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
      return "No microphone was found. Plug one in, or use your phone, and try again.";
    if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
      return "Another app is using the microphone. Close it and try again.";
    if (name === "Unsupported" || name === "NotSupportedError") return "This browser can't record audio. Try Chrome, Safari or Firefox.";
    return "We couldn't open the microphone. Please try again.";
  }

  window.NfPracticeProgress = {
    TAIL_SEC: TAIL_SEC,
    levelFraction: levelFraction, weeklyFraction: weeklyFraction, nextLevelLine: nextLevelLine,
    streakLabel: streakLabel, streakLine: streakLine, freezeLine: freezeLine,
    sortBadges: sortBadges, badgeFraction: badgeFraction, rewardMoment: rewardMoment, rewardEvents: rewardEvents,
    weekdayLetter: weekdayLetter, dayDots: dayDots, drillsLeft: drillsLeft, allowanceLine: allowanceLine, resetTime: resetTime,
    pathLine: pathLine, unitFraction: unitFraction, nextAction: nextAction,
    leadIn: leadIn, partSeconds: partSeconds, takeSeconds: takeSeconds, noteDueAt: noteDueAt,
    gradeError: gradeError, micError: micError
  };
})();
