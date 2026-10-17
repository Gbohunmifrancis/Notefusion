/**
 * Practice tracks on the phone: the words and the choices that make the Practice screen Playful or Focused. Pure, so
 * it is unit-tested (practiceTrack.test.ts). The track is the server's (`PracticeProgress.track`, set with
 * `PUT /api/practice/track`); it picks the day's drill there and only the presentation here. XP, levels, streaks and
 * badges are the same rules on both tracks — nothing in this file scores anything.
 *
 * A track is a style, never an age: nothing here asks how old anyone is.
 */

import type { GradeResult, PracticeProgress, PracticeReward, PracticeTrack } from "../api/types";

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
 * How big a marked take's moment is: a confetti `burst` (Playful's three stars, a level or a badge), a `toast` line,
 * or `quiet`. Focused shows its marks and keeps the toast for a level or a badge. The screen drops the burst when the
 * system asks for reduced motion.
 */
export type Celebration = "burst" | "toast" | "quiet";

export function celebrationFor(
  track: PracticeTrack | null,
  score: number,
  reward: PracticeReward | null | undefined,
): Celebration {
  const big = !!reward && (reward.levelUp || reward.newBadges.length > 0);
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
