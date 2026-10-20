/**
 * The Practice screen's arithmetic and wording, apart from the screen: how full the XP bar and the weekly ring
 * are, what a reward says, and when a reminder should be about the streak. Pure, so it is unit-tested
 * (practiceProgress.test.ts). The numbers themselves — XP, levels, streaks — are the server's
 * (C# Application/Practice); nothing here scores a take.
 */

import type {
  Drill,
  DrillAllowance,
  PracticeBadge,
  PracticeLevel,
  PracticeProgress,
  PracticeReward,
  PracticeStreak,
  PracticeTrack,
  WeeklyGoal,
} from "../api/types";

/** How far through the current level `xp` is, 0–1 (full at the top level). */
export function levelFraction(level: PracticeLevel, xp: number): number {
  if (level.nextLevelXp == null) return 1;
  const span = level.nextLevelXp - level.minXp;
  return span > 0 ? clamp01((xp - level.minXp) / span) : 1;
}

/** How much of the weekly goal is done, 0–1. */
export function weeklyFraction(goal: WeeklyGoal): number {
  return goal.target > 0 ? clamp01(goal.daysDone / goal.target) : 0;
}

/** "12 XP to Ray", "1,250 XP to Soh", or the top level's own line. */
export function nextLevelLine(level: PracticeLevel): string {
  return level.nextName ? `${xpAmount(level.xpForNext)} to ${level.nextName}` : "Top of the ladder";
}

/** "12,450 XP": grouped by hand, as `price.formatPrice` is (Hermes may ignore toLocaleString's options). */
export function xpAmount(xp: number): string {
  return `${String(Math.round(xp)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} XP`;
}

/** "4-day streak", "1-day streak", "No streak yet" — or "No streak now" when an earlier one lapsed. */
export function streakLabel(days: number, best = 0): string {
  return days > 0 ? `${days}-day streak` : best > 0 ? "No streak now" : "No streak yet";
}

/** "Your best: 12 days" once a streak has lapsed (the best is kept); null before the first. */
export function bestStreakLine(streak: Pick<PracticeStreak, "current" | "best">): string | null {
  if (streak.current > 0 || !(streak.best > 0)) return null;
  return `Your best: ${streak.best} ${streak.best === 1 ? "day" : "days"}`;
}

/** The streak card's line under the count: today done, keep it going, or start one (again, after a lapse). */
export function streakLine(streak: Pick<PracticeStreak, "current" | "best" | "todayDone" | "atRisk">): string {
  if (streak.todayDone) return "Done for today";
  if (streak.atRisk) return "Sing today to keep it";
  const best = bestStreakLine(streak);
  return best ? `${best}. Start a new one today.` : "Sing a drill to start one";
}

/** Earned badges first (newest first), then locked ones nearest to done. */
export function sortBadges(badges: readonly PracticeBadge[]): PracticeBadge[] {
  const earned = badges.filter((b) => b.earned).sort((a, b) => (b.earnedAtUtc ?? "").localeCompare(a.earnedAtUtc ?? ""));
  const locked = badges
    .filter((b) => !b.earned)
    .sort((a, b) => b.progress / Math.max(1, b.target) - a.progress / Math.max(1, a.target));
  return [...earned, ...locked];
}

export type RewardMoment = {
  /** One line for the toast. */
  line: string;
  /** A level-up or a badge is worth a stronger tap than plain XP. */
  big: boolean;
};

/**
 * The one line a marked take earns: a level-up beats a badge beats the XP. Null when it earned nothing to say
 * (the day's XP cap reached and nothing unlocked) — no toast for nothing.
 */
export function rewardMoment(reward: PracticeReward | null | undefined): RewardMoment | null {
  if (!reward) return null;
  if (reward.levelUp) return { line: `Level up — you're now ${reward.level.name}!`, big: true };
  const badge = reward.newBadges[0];
  if (badge) return { line: `Badge earned: ${badge.title}`, big: true };
  if (reward.xpGained <= 0) return null;
  return {
    line: reward.streak > 1 ? `+${reward.xpGained} XP · ${streakLabel(reward.streak)}` : `+${reward.xpGained} XP`,
    big: false,
  };
}

/** The analytics events a reward is worth: `level_up` and one `badge_earned` per badge. */
export function rewardEvents(reward: PracticeReward | null | undefined): { name: string; params: Record<string, string | number> }[] {
  if (!reward) return [];
  const events: { name: string; params: Record<string, string | number> }[] = [];
  if (reward.levelUp) events.push({ name: "level_up", params: { level: reward.level.name, index: reward.level.index } });
  for (const b of reward.newBadges) events.push({ name: "badge_earned", params: { badge: b.code } });
  return events;
}

// ── The practice path ─────────────────────────────────────────────────────────
// The server's path (C# PracticePath): grades → units → drills. The same words on the web: assets/practice-progress.js.

/** "Grade 2 · Unit 3 · 4 of 6", with "· Harder" or "· Easier" when the last take moved it; null without a place. */
export function pathLine(drill: Pick<Drill, "grade" | "unitIndex" | "drillIndex" | "drillCount" | "adjustment">): string | null {
  if (!drill.grade || !(drill.unitIndex > 0) || !(drill.drillCount > 0)) return null;
  const moved = drill.adjustment === "harder" ? " · Harder" : drill.adjustment === "easier" ? " · Easier" : "";
  return `${drill.grade} · Unit ${drill.unitIndex} · ${drill.drillIndex} of ${drill.drillCount}${moved}`;
}

/** How much of the unit is behind the singer, 0–1: the thin bar under the path line. */
export function unitFraction(drill: Pick<Drill, "drillIndex" | "drillCount">): number {
  return drill.drillCount > 0 ? clamp01((drill.drillIndex - 1) / drill.drillCount) : 0;
}

/**
 * The result's main button, a verb that fits half the card: on to the next drill ("Continue", Playful's "Keep going!"),
 * or — when the path brings the same drill back after a miss — the same one again. `next` is null while it is still
 * loading (the button says "Continue" and loads it).
 */
export function nextAction(
  current: Pick<Drill, "id">,
  next: Pick<Drill, "id"> | null,
  track: PracticeTrack | null,
): { label: string; same: boolean } {
  const same = !!next && next.id === current.id;
  if (track === "playful") return { label: same ? "Try again!" : "Keep going!", same };
  return { label: same ? "Try it again" : "Continue", same };
}

/**
 * "midnight", "1:30 am": when the drill allowance starts again, on the phone's clock. `offsetMinutes` is
 * `Date.getTimezoneOffset()` at that moment (minutes behind UTC), passed in so the wording is testable.
 */
export function resetTime(resetsAtUtc: string | null | undefined, offsetMinutes?: number): string | null {
  const t = resetsAtUtc ? Date.parse(resetsAtUtc) : NaN;
  if (!Number.isFinite(t)) return null;
  const offset = offsetMinutes ?? new Date(t).getTimezoneOffset();
  const local = new Date(t - offset * 60_000);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  if (h === 0 && m === 0) return "midnight";
  return `${h % 12 === 0 ? 12 : h % 12}:${`${m}`.padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "7 of 10 marked drills left today", or, once they are sung, a warm last word with when more come. */
export function allowanceLine(allowance: DrillAllowance, offsetMinutes?: number): string {
  const left = Math.max(0, allowance.limit - allowance.used);
  if (left > 0) return `${left} of ${allowance.limit} marked drills left today`;
  const when = resetTime(allowance.resetsAtUtc, offsetMinutes);
  return `That's all ${allowance.limit} of today's drills. Well sung! ${when ? `More from ${when}.` : "More tomorrow."}`;
}

// ── Streak reminders ──────────────────────────────────────────────────────────

/** The hour a streak reminder waits for at the earliest: an evening nudge, the day's last chance. */
export const STREAK_EVENING_HOUR = 19;

/**
 * What the reminder needs to know of the streak, remembered on the device: its length and the next day it is
 * at risk on (`yyyy-mm-dd`, the phone's calendar), or null when there is no streak to keep.
 */
export interface StreakSnapshot {
  streak: number;
  riskDay: string | null;
}

/** The snapshot to remember from a progress read: at risk today, or tomorrow once today is done. */
export function streakSnapshot(progress: Pick<PracticeProgress, "today" | "streak">): StreakSnapshot {
  const { streak, today } = progress;
  if (streak.current <= 0) return { streak: 0, riskDay: null };
  if (streak.todayDone) return { streak: streak.current, riskDay: addDays(today, 1) };
  return { streak: streak.current, riskDay: streak.atRisk ? today : null };
}

/** The snapshot after a marked take today: the streak it reports, at risk from tomorrow. */
export function snapshotAfterTake(streak: number, today: string): StreakSnapshot {
  return streak > 0 ? { streak, riskDay: addDays(today, 1) } : { streak: 0, riskDay: null };
}

export interface ReminderSlot {
  hour: number;
  title: string;
  body: string;
  /** The screen a tap opens (`lib/notificationLink`). */
  screen: "Practice" | "Record";
}

/**
 * One day's reminder (still one a day): about the streak on the day it is at risk — in the evening, at the
 * chosen hour or 19:00, whichever is later — and the usual rotating nudge on every other day.
 */
export function reminderSlot(
  day: string,
  chosenHour: number,
  snapshot: StreakSnapshot | null,
  usual: { title: string; body: string },
): ReminderSlot {
  if (snapshot && snapshot.streak > 0 && snapshot.riskDay === day) {
    return {
      hour: Math.max(chosenHour, STREAK_EVENING_HOUR),
      title: "Your streak is waiting",
      body: `Keep your ${streakLabel(snapshot.streak)} — today's drill takes 2 minutes.`,
      screen: "Practice",
    };
  }
  return { hour: chosenHour, ...usual, screen: "Record" };
}

/** Local calendar date, `yyyy-mm-dd`. */
export function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** `yyyy-mm-dd` plus whole days, calendar arithmetic only (no time zone can move it). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) + days * 86_400_000);
  return `${t.getUTCFullYear()}-${`${t.getUTCMonth() + 1}`.padStart(2, "0")}-${`${t.getUTCDate()}`.padStart(2, "0")}`;
}

/** "M", "T", … for a `yyyy-mm-dd`. */
export function weekdayLetter(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return "SMTWTFS"[new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()]!;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
