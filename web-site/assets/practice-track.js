/* Practice tracks on the web: the words and the choices that make the Practice view Playful or Focused.
 *
 * The track is the server's (`progress.track`, set with PUT /api/practice/track); it picks the day's drill there and
 * only the presentation here. XP, levels, streaks and badges are the same rules on both — nothing here scores.
 * A track is a style, never an age: nothing here asks how old anyone is.
 * The mobile copy is mobile/src/lib/practiceTrack.ts (tests: practiceTrack.test.ts) — keep them in step.
 *
 * Plain functions; assets/practice-view.js draws the view. Loaded with it, on demand.
 */
(function () {
  "use strict";

  /** The picker's two choices, in the order shown. */
  var TRACK_OPTIONS = [
    { track: "playful", title: "Playful", blurb: "Fun and games: short drills, stars and stickers" },
    { track: "focused", title: "Focused", blurb: "For serious singers: harder lines, exact scores" }
  ];
  var TRACK_QUESTION = "How do you like to practise?";

  function trackTitle(track) { return track === "playful" ? "Playful" : "Focused"; }

  // ── Stars (Playful) ──────────────────────────────────────────────────────
  /** A mark of this or more is three stars: the server's "good" score (C# PracticeRules.GoodScore). */
  var THREE_STAR_SCORE = 80;
  /** A mark of this or more is two stars; anything sung and marked is at least one. */
  var TWO_STAR_SCORE = 50;

  /** 1–3 stars for a 0–100 mark: every marked take earns one for having a go. */
  function starsFor(score) { return score >= THREE_STAR_SCORE ? 3 : score >= TWO_STAR_SCORE ? 2 : 1; }

  /** The friendly word under the stars. */
  function starWord(stars) { return stars === 3 ? "Super!" : stars === 2 ? "Nearly there" : "Good try!"; }

  /** The line under the word: what to do next, never a number. */
  function starHint(grade, stars) {
    if (stars === 3) return "You sang it beautifully.";
    var sung = grade.hits + grade.near + grade.wrong;
    if (sung === 0) return "I couldn't hear you that time. Sing up, and try again!";
    if (stars === 2) return "So close! Listen once more, then sing it again.";
    return "Listen to it first, then sing along with the notes.";
  }

  // ── Celebrations ─────────────────────────────────────────────────────────
  /**
   * How big a marked take's moment is: a confetti "burst" (Playful's three stars, a level or a badge), a "toast"
   * line, or "quiet". Focused shows its marks and keeps the toast for a level or a badge. The view drops the burst
   * when the reader asks for reduced motion.
   */
  function celebrationFor(track, score, reward) {
    var big = !!reward && (reward.levelUp || (reward.newBadges || []).length > 0);
    var earned = !!reward && reward.xpGained > 0;
    if (track === "playful") return big || starsFor(score) === 3 ? "burst" : earned ? "toast" : "quiet";
    if (track === "focused") return big ? "toast" : "quiet";
    return big || earned ? "toast" : "quiet";
  }

  /** Playful's line for a reward: a level beats a sticker beats the XP; null when it earned nothing to say. */
  function playfulRewardLine(reward) {
    if (!reward) return null;
    if (reward.levelUp) return "Hooray! You've reached " + reward.level.name + "!";
    var badge = (reward.newBadges || [])[0];
    if (badge) return "New sticker: " + badge.title + "!";
    if (!(reward.xpGained > 0)) return null;
    return reward.streak > 1 ? "+" + reward.xpGained + " XP and " + reward.streak + " days in a row!" : "+" + reward.xpGained + " XP. Well sung!";
  }

  // ── Focused's detail ─────────────────────────────────────────────────────
  /** The take's overall lean: "In tune overall" within 5 cents, else "12 cents sharp overall". */
  function tuningLine(tuningCents) {
    var c = Math.round(tuningCents);
    if (!isFinite(c) || Math.abs(c) < 5) return "In tune overall";
    return Math.abs(c) + " cents " + (c > 0 ? "sharp" : "flat") + " overall";
  }

  // ── The practice buddy (Playful) ─────────────────────────────────────────
  var BUDDY_LINES = [
    "Ready? Listen first, then sing it back to me!",
    "Every singer starts with doh. Let's go!",
    "Sing it like you mean it!",
    "Little and often makes a great singer.",
    "Hum it first if you like. Then sing!",
    "I can't wait to hear you sing today!",
    "Stand tall, take a breath, and sing!"
  ];

  function dayNumber(day) {
    var p = String(day).split("-").map(Number);
    var t = Date.UTC(p[0] || 1970, (p[1] || 1) - 1, p[2] || 1);
    return isFinite(t) ? Math.floor(t / 86400000) : 0;
  }

  /** The buddy's line: the streak or today when there is something to say, else the day's encouragement. */
  function buddyLine(progress) {
    var streak = progress.streak;
    if (streak.todayDone) return streak.current > 1 ? streak.current + " days in a row. You're a star!" : "You sang today. Brilliant!";
    if (streak.atRisk) return "Sing today to keep your " + streak.current + "-day streak going!";
    return BUDDY_LINES[((dayNumber(progress.today) % BUDDY_LINES.length) + BUDDY_LINES.length) % BUDDY_LINES.length];
  }

  /** A sticker's tilt in degrees, -6 to 6, fixed per badge so the sheet of stickers looks hand-placed. */
  function stickerTilt(code) {
    var h = 0;
    for (var i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
    return (h % 13) - 6;
  }

  window.NfPracticeTrack = {
    TRACK_OPTIONS: TRACK_OPTIONS, TRACK_QUESTION: TRACK_QUESTION, THREE_STAR_SCORE: THREE_STAR_SCORE, TWO_STAR_SCORE: TWO_STAR_SCORE,
    trackTitle: trackTitle, starsFor: starsFor, starWord: starWord, starHint: starHint, celebrationFor: celebrationFor,
    playfulRewardLine: playfulRewardLine, tuningLine: tuningLine, buddyLine: buddyLine, stickerTilt: stickerTilt
  };
})();
