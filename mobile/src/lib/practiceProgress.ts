/**
 * The Practice screen's arithmetic and wording, apart from the screen: how full the XP bar and the weekly ring
 * are, what a reward says, and when a reminder should be about the streak. Pure, so it is unit-tested
 * (practiceProgress.test.ts). The numbers themselves — XP, levels, streaks — are the server's
 * (C# Application/Practice); nothing here scores a take.
 */

import type { PracticeBadge, PracticeLevel, PracticeProgress, PracticeReward, WeeklyGoal } from "../api/types";

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

/** "12 XP to Ray", or the top level's own line. */
export function nextLevelLine(level: PracticeLevel): string {
  return level.nextName ? `${level.xpForNext} XP to ${level.nextName}` : "Top of the ladder";
}

/** "4-day streak", "1-day streak", "No streak yet". */
export function streakLabel(days: number): string {
  return days > 0 ? `${days}-day streak` : "No streak yet";
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
