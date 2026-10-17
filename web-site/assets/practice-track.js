/* Practice tracks on the web: the words and the choices that make the Practice view Playful or Focused.
 *
 * The track is the server's (`progress.track`, set with PUT /api/practice/track); it picks the day's drill there and
 * only the presentation here. XP, levels, streaks and badges are the same rules on both — nothing here scores.
 * A track is a style, never an age: nothing here asks how old anyone is.
 * The mobile copy is mobile/src/lib/practiceTrack.ts (tests: practiceTrack.test.ts) — keep them in step.
 *
 * Plain functions, and which picture of the Practice art goes where; assets/practice-view.js draws the view.
 * Loaded with it, on demand.
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
   * How big a marked take's moment is: a confetti "burst" (Playful's three stars, a level, a badge or a path
   * milestone), a "toast" line, or "quiet". Focused shows its marks and keeps the toast for a level, a badge or a
   * milestone. The view drops the burst when the reader asks for reduced motion.
   */
  function celebrationFor(track, score, reward, milestone) {
    var big = !!milestone || (!!reward && (reward.levelUp || (reward.newBadges || []).length > 0));
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

  // ── The art (assets/practice-art, drawn by design/practice-art) ──────────
  /**
   * Doh the doh bird's mood: handing over in the picker, singing along while a take records, cheering a level-up or
   * the weekly goal met, encouraging a near miss (two stars), sleepy with no drill or the day's drills all sung,
   * worried while the streak is at risk, else waving hello. Doh lives inside Practice only; Focused shows no buddy.
   * scene: { picking, recording, grade ({ score, reward } or null), hasDrill, drillsLeft (null: not known) }
   */
  function mascotMood(progress, scene) {
    if (scene.picking) return "handoff";
    if (scene.recording) return "sing";
    if ((scene.grade && scene.grade.reward && scene.grade.reward.levelUp) || goalMetToday(progress)) return "cheer";
    if (scene.grade && starsFor(scene.grade.score) === 2) return "encourage";
    if (!scene.hasDrill || scene.drillsLeft === 0) return "sleepy";
    if (progress.streak.atRisk) return "worried";
    return "wave";
  }

  function goalMetToday(progress) {
    var g = progress.weeklyGoal;
    return !!progress.streak.todayDone && g.target > 0 && g.daysDone >= g.target;
  }

  /** Doh's line for a mood; the waving Doh says the day's buddyLine. */
  function mascotLine(mood, progress, scene) {
    switch (mood) {
      case "sing": return "I'm listening. Sing out!";
      case "cheer":
        return scene.grade && scene.grade.reward && scene.grade.reward.levelUp
          ? "Hooray! You've reached " + scene.grade.reward.level.name + "!"
          : progress.weeklyGoal.daysDone + " days this week. Weekly goal met!";
      case "encourage": return "Nearly there! Listen once more and have another go.";
      case "sleepy": return scene.hasDrill ? "All sung for today. See you tomorrow!" : "No drill yet. Try again in a moment.";
      case "worried": return "Sing today to keep your " + progress.streak.current + "-day streak going!";
      case "handoff": return TRACK_QUESTION;
      default: return buddyLine(progress);
    }
  }

  function mascotArt(mood) { return "doh-" + mood; }

  var LEVEL_ART = ["level-1-doh", "level-2-ray", "level-3-me", "level-4-fah", "level-5-soh", "level-6-lah", "level-7-te", "level-8-choir-ready"];
  /** A level's emblem, by its 0-based index (C# PracticeRules.Levels). */
  function levelArt(index) { return LEVEL_ART[Math.max(0, Math.min(LEVEL_ART.length - 1, Math.trunc(index) || 0))]; }

  var BADGE_ART = {
    first_drill: "first-drill", streak_3: "three-in-a-row", first_100: "spot-on", drills_10: "ten-drills", first_part: "first-part",
    week_goal: "week-goal", streak_7: "seven-in-a-row", whole_part_80: "part-learned", streak_30: "month"
  };
  /** A badge's sticker, or its locked one; a code this build does not know shows the first drill's. */
  function badgeArt(code, earned) {
    return "badge-" + (Object.prototype.hasOwnProperty.call(BADGE_ART, code) ? BADGE_ART[code] : "first-drill") + (earned ? "" : "-locked");
  }

  /** The streak flame: out with no streak, at risk until today is sung, else lit. */
  function flameArt(streak) { return streak.current <= 0 ? "flame-out" : streak.atRisk ? "flame-at-risk" : "flame-active"; }

  /** The picture beside a reward's line: the new level's emblem, else the first new badge's sticker, else none. */
  function rewardArt(reward) {
    if (!reward) return null;
    if (reward.levelUp) return levelArt(reward.level.index);
    var badge = (reward.newBadges || [])[0];
    return badge ? badgeArt(badge.code, true) : null;
  }

  function starsArt(stars) { return "stars-" + stars; }
  function trackArt(track) { return track === "playful" ? "track-playful" : "track-focused"; }

  /** The burst's paper bits, in turn. */
  var CONFETTI_ART = ["confetti-quaver", "confetti-sparkle", "confetti-beamed", "confetti-dot", "confetti-sharp", "confetti-ribbon", "confetti-flat", "confetti-tri"];

  window.NfPracticeTrack = {
    TRACK_OPTIONS: TRACK_OPTIONS, TRACK_QUESTION: TRACK_QUESTION, THREE_STAR_SCORE: THREE_STAR_SCORE, TWO_STAR_SCORE: TWO_STAR_SCORE,
    trackTitle: trackTitle, starsFor: starsFor, starWord: starWord, starHint: starHint, celebrationFor: celebrationFor,
    playfulRewardLine: playfulRewardLine, tuningLine: tuningLine, buddyLine: buddyLine, stickerTilt: stickerTilt,
    mascotMood: mascotMood, mascotLine: mascotLine, mascotArt: mascotArt, levelArt: levelArt, badgeArt: badgeArt,
    flameArt: flameArt, rewardArt: rewardArt, starsArt: starsArt, trackArt: trackArt, CONFETTI_ART: CONFETTI_ART
  };
})();
