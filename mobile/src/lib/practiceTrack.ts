/**
 * Practice tracks on the phone: the words and the choices that make the Practice screen Playful or Focused. Pure, so
 * it is unit-tested (practiceTrack.test.ts). The track is the server's (`PracticeProgress.track`, set with
 * `PUT /api/practice/track`); it picks the day's drill there and only the presentation here. XP, levels, streaks and
 * badges are the same rules on both tracks — nothing in this file scores anything.
 *
 * A track is a style, never an age: nothing here asks how old anyone is.
 */

import type { GradeResult, PracticeProgress, PracticeReward, PracticeStreak, PracticeTrack } from "../api/types";
import type { ArtName } from "../components/practice/art/svgs";

export interface TrackOption {
  track: PracticeTrack;
  title: string;
  blurb: string;
}

/** The picker's two choices, in the order shown. */
export const TRACK_OPTIONS: readonly TrackOption[] = [
  { track: "playful", title: "Playful", blurb: "Fun and games: short drills, stars and stickers" },
  { track: "focused", title: "Focused", blurb: "For serious singers: harder lines, exact scores" },
];

export const TRACK_QUESTION = "How do you like to practise?";

export function trackTitle(track: PracticeTrack): string {
  return track === "playful" ? "Playful" : "Focused";
}

// ── Stars (Playful) ──────────────────────────────────────────────────────────

/** A mark of this or more is three stars: the server's "good" score (C# `PracticeRules.GoodScore`). */
export const THREE_STAR_SCORE = 80;
/** A mark of this or more is two stars; anything sung and marked is at least one. */
export const TWO_STAR_SCORE = 50;

export type Stars = 1 | 2 | 3;

/** 1–3 stars for a 0–100 mark: every marked take earns one for having a go. */
export function starsFor(score: number): Stars {
  if (score >= THREE_STAR_SCORE) return 3;
  if (score >= TWO_STAR_SCORE) return 2;
  return 1;
}

/** The friendly word under the stars. */
export function starWord(stars: Stars): string {
  return stars === 3 ? "Super!" : stars === 2 ? "Nearly there" : "Good try!";
}

/** The line under the word: what to do next, never a number. */
export function starHint(grade: Pick<GradeResult, "hits" | "near" | "wrong" | "missed">, stars: Stars): string {
  if (stars === 3) return "You sang it beautifully.";
  const sung = grade.hits + grade.near + grade.wrong;
  if (sung === 0) return "I couldn't hear you that time. Sing up, and try again!";
  if (stars === 2) return "So close! Listen once more, then sing it again.";
  return "Listen to it first, then sing along with the notes.";
}

// ── Celebrations ─────────────────────────────────────────────────────────────

/**
 * How big a marked take's moment is: a confetti `burst` (Playful's three stars, a level, a badge or a path milestone),
 * a `toast` line, or `quiet`. Focused shows its marks and keeps the toast for a level, a badge or a milestone. The
 * screen drops the burst when the system asks for reduced motion.
 */
export type Celebration = "burst" | "toast" | "quiet";

export function celebrationFor(
  track: PracticeTrack | null,
  score: number,
  reward: PracticeReward | null | undefined,
  milestone = false,
): Celebration {
  const big = milestone || (!!reward && (reward.levelUp || reward.newBadges.length > 0));
  if (track === "playful") return big || starsFor(score) === 3 ? "burst" : reward && reward.xpGained > 0 ? "toast" : "quiet";
  if (track === "focused") return big ? "toast" : "quiet";
  return big || (reward && reward.xpGained > 0) ? "toast" : "quiet";
}

/**
 * The one line a reward is worth on Playful: a level beats a sticker beats the XP; null when it earned nothing to say.
 * (Focused and no track use `practiceProgress.rewardMoment`'s plain line.)
 */
export function playfulRewardLine(reward: PracticeReward | null | undefined): string | null {
  if (!reward) return null;
  if (reward.levelUp) return `Hooray! You've reached ${reward.level.name}!`;
  const badge = reward.newBadges[0];
  if (badge) return `New sticker: ${badge.title}!`;
  if (reward.xpGained <= 0) return null;
  return reward.streak > 1 ? `+${reward.xpGained} XP and ${reward.streak} days in a row!` : `+${reward.xpGained} XP. Well sung!`;
}

/**
 * What a screen reader hears when a take is marked: the stars and their word (Playful) or the score and verdict, then
 * the line it earned. The marks themselves are not a live region, and iOS reads no live region at all.
 */
export function gradeAnnouncement(
  playful: boolean,
  grade: Pick<GradeResult, "score" | "summary">,
  earned?: string | null,
): string {
  const stars = starsFor(grade.score);
  const head = playful ? `${stars} of 3 stars. ${starWord(stars)}` : `Score ${grade.score}. ${grade.summary}`;
  if (!earned) return head;
  return /[.!?]$/.test(head) ? `${head} ${earned}` : `${head}. ${earned}`;
}

// ── Focused's detail ─────────────────────────────────────────────────────────

/** The take's overall lean, for Focused: "In tune overall" within 5 cents, else "12 cents sharp overall". */
export function tuningLine(tuningCents: number): string {
  const c = Math.round(tuningCents);
  if (!Number.isFinite(c) || Math.abs(c) < 5) return "In tune overall";
  return `${Math.abs(c)} cents ${c > 0 ? "sharp" : "flat"} overall`;
}

// ── The practice buddy (Playful) ─────────────────────────────────────────────

const BUDDY_LINES = [
  "Ready? Listen first, then sing it back to me!",
  "Every singer starts with doh. Let's go!",
  "Sing it like you mean it!",
  "Little and often makes a great singer.",
  "Hum it first if you like. Then sing!",
  "I can't wait to hear you sing today!",
  "Stand tall, take a breath, and sing!",
];

/**
 * A gentle line from the practice buddy: about the streak or today when there is something to say, else one of a
 * few encouragements, the same all day (picked by the day's date).
 */
export function buddyLine(progress: Pick<PracticeProgress, "today" | "streak">): string {
  const { streak, today } = progress;
  if (streak.todayDone) return streak.current > 1 ? `${streak.current} days in a row. You're a star!` : "You sang today. Brilliant!";
  if (streak.atRisk) return `Sing today to keep your ${streak.current}-day streak going!`;
  return BUDDY_LINES[dayNumber(today) % BUDDY_LINES.length]!;
}

/** A sticker's tilt in degrees, -6 to 6, fixed per badge so the sheet of stickers looks hand-placed. */
export function stickerTilt(code: string): number {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return (h % 13) - 6;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : 0;
}

// ── The art (components/practice/Art, drawn by design/practice-art) ──────────

/**
 * Doh the doh bird's moods in Practice: Playful's buddy, the track picker, the empty and offline states, and the
 * warm-up's tips. Focused shows no buddy: one small Doh beside "More ways to practise" instead (one bird on screen).
 * Outside Practice Doh is only Home's suggestion card, the result toast and the empty Library (`components/doh`,
 * `lib/dohSuggestion`).
 */
export type MascotMood = "wave" | "sing" | "cheer" | "encourage" | "worried" | "sleepy" | "handoff";

export interface MascotScene {
  /** The track picker is open. */
  picking: boolean;
  /** A take is counting in, being sung, or being marked. */
  recording: boolean;
  /** The take just marked, if any. */
  grade?: Pick<GradeResult, "score" | "reward"> | null;
  /** Today's drill is here to sing. */
  hasDrill: boolean;
  /** Marked drills left today; null when not known. */
  drillsLeft: number | null;
}

/**
 * Which Doh to show: handing over in the picker, singing along while a take records, cheering a level-up or the
 * weekly goal met, encouraging a near miss (two stars), sleepy with no drill or the day's drills all sung, worried
 * while the streak is at risk, else waving hello.
 */
export function mascotMood(progress: Pick<PracticeProgress, "streak" | "weeklyGoal">, scene: MascotScene): MascotMood {
  if (scene.picking) return "handoff";
  if (scene.recording) return "sing";
  if (scene.grade?.reward?.levelUp || goalMetToday(progress)) return "cheer";
  if (scene.grade && starsFor(scene.grade.score) === 2) return "encourage";
  if (!scene.hasDrill || scene.drillsLeft === 0) return "sleepy";
  if (progress.streak.atRisk) return "worried";
  return "wave";
}

/** Doh's line for a mood; the waving Doh says the day's `buddyLine`. */
export function mascotLine(
  mood: MascotMood,
  progress: Pick<PracticeProgress, "today" | "streak" | "weeklyGoal">,
  scene: MascotScene,
): string {
  switch (mood) {
    case "sing":
      return "I'm listening. Sing out!";
    case "cheer":
      return scene.grade?.reward?.levelUp
        ? `Hooray! You've reached ${scene.grade.reward.level.name}!`
        : `${progress.weeklyGoal.daysDone} days this week. Weekly goal met!`;
    case "encourage":
      return "Nearly there! Listen once more and have another go.";
    case "sleepy":
      return scene.hasDrill ? "All sung for today. See you tomorrow!" : "No drill yet. Try again in a moment.";
    case "worried":
      return `Sing today to keep your ${progress.streak.current}-day streak going!`;
    case "handoff":
      return TRACK_QUESTION;
    default:
      return buddyLine(progress);
  }
}

function goalMetToday(progress: Pick<PracticeProgress, "streak" | "weeklyGoal">): boolean {
  const g = progress.weeklyGoal;
  return progress.streak.todayDone && g.target > 0 && g.daysDone >= g.target;
}

export function mascotArt(mood: MascotMood): ArtName {
  return `doh-${mood}`;
}

const LEVEL_ART: readonly ArtName[] = [
  "level-1-doh",
  "level-2-ray",
  "level-3-me",
  "level-4-fah",
  "level-5-soh",
  "level-6-lah",
  "level-7-te",
  "level-8-choir-ready",
];

/** A level's emblem, by its 0-based index (C# `PracticeRules.Levels`). */
export function levelArt(index: number): ArtName {
  return LEVEL_ART[Math.max(0, Math.min(LEVEL_ART.length - 1, Math.trunc(index) || 0))]!;
}

const BADGE_ART: Record<string, string> = {
  first_drill: "first-drill",
  streak_3: "three-in-a-row",
  first_100: "spot-on",
  drills_10: "ten-drills",
  first_part: "first-part",
  week_goal: "week-goal",
  streak_7: "seven-in-a-row",
  whole_part_80: "part-learned",
  streak_30: "month",
  // The Christmas season's sticker: all six carols sung while it is on, kept for good.
  carol_singer: "carol-singer",
  // The Halloween season's: all six on the Midnight path sung while it is on, kept for good.
  night_singer: "night-singer",
};

/** A badge's sticker, or its locked one; a code this build does not know shows the first drill's. */
export function badgeArt(code: string, earned: boolean): ArtName {
  return `badge-${BADGE_ART[code] ?? "first-drill"}${earned ? "" : "-locked"}` as ArtName;
}

/** The streak flame: out with no streak, at risk until today is sung, else lit. */
export function flameArt(streak: Pick<PracticeStreak, "current" | "atRisk">): ArtName {
  if (streak.current <= 0) return "flame-out";
  return streak.atRisk ? "flame-at-risk" : "flame-active";
}

/** The picture beside a reward's line: the new level's emblem, else the first new badge's sticker, else none. */
export function rewardArt(reward: PracticeReward | null | undefined): ArtName | null {
  if (!reward) return null;
  if (reward.levelUp) return levelArt(reward.level.index);
  const badge = reward.newBadges[0];
  return badge ? badgeArt(badge.code, true) : null;
}

export function starsArt(stars: Stars): ArtName {
  return `stars-${stars}`;
}

/** The burst's paper bits, in turn. */
export const CONFETTI_ART: readonly ArtName[] = [
  "confetti-quaver",
  "confetti-sparkle",
  "confetti-beamed",
  "confetti-dot",
  "confetti-sharp",
  "confetti-ribbon",
  "confetti-flat",
  "confetti-tri",
];

/** The Carol singer's burst (board d-christmas/03): snowflakes and quavers in place of the usual paper bits. */
export const SEASON_CONFETTI_ART: readonly ArtName[] = [
  "confetti-snowflake",
  "confetti-quaver",
  "confetti-snowflake",
  "confetti-beamed",
];

/** The Night Singer's burst (board j-halloween/03): bats and quavers in place of the usual paper bits. */
export const HALLOWEEN_CONFETTI_ART: readonly ArtName[] = [
  "confetti-bat",
  "confetti-quaver",
  "confetti-bat",
  "confetti-beamed",
];

/** A season's sticker burst. */
export function seasonConfettiArt(season: "christmas" | "halloween"): readonly ArtName[] {
  return season === "halloween" ? HALLOWEEN_CONFETTI_ART : SEASON_CONFETTI_ART;
}

export function trackArt(track: PracticeTrack): ArtName {
  return track === "playful" ? "track-playful" : "track-focused";
}
