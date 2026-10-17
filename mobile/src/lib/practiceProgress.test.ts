import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STREAK_EVENING_HOUR,
  addDays,
  levelFraction,
  nextLevelLine,
  reminderSlot,
  rewardEvents,
  rewardMoment,
  snapshotAfterTake,
  sortBadges,
  streakLabel,
  streakSnapshot,
  weekdayLetter,
  weeklyFraction,
} from "./practiceProgress.ts";
import type { PracticeBadge, PracticeLevel, PracticeReward, PracticeStreak } from "../api/types";

const ray: PracticeLevel = { index: 1, name: "Ray", minXp: 100, nextLevelXp: 250, nextName: "Me", xpForNext: 100 };
const top: PracticeLevel = { index: 7, name: "Choir-ready", minXp: 3000, nextLevelXp: null, nextName: null, xpForNext: 0 };

const reward = (over: Partial<PracticeReward> = {}): PracticeReward => ({
  xpGained: 15,
  xp: 115,
  levelUp: false,
  level: ray,
  streak: 1,
  newBadges: [],
  ...over,
});

const badge = (code: string, earned: boolean, progress: number, target: number, earnedAtUtc: string | null = null): PracticeBadge => ({
  code,
  title: code,
  description: "",
  earned,
  earnedAtUtc,
  progress,
  target,
});

const streak = (over: Partial<PracticeStreak>): PracticeStreak => ({
  current: 0,
  best: 0,
  todayDone: false,
  atRisk: false,
  freezeAvailable: true,
  frozenYesterday: false,
  ...over,
});

test("the XP bar fills through the level and is full at the top", () => {
  assert.equal(levelFraction(ray, 100), 0);
  assert.equal(levelFraction(ray, 175), 0.5);
  assert.equal(levelFraction(ray, 999), 1);
  assert.equal(levelFraction(top, 3500), 1);
  assert.equal(nextLevelLine(ray), "100 XP to Me");
  assert.equal(nextLevelLine(top), "Top of the ladder");
});

test("the weekly ring is days over the goal, held to 0–1", () => {
  assert.equal(weeklyFraction({ daysDone: 2, target: 5, weekStart: "2026-10-12" }), 0.4);
  assert.equal(weeklyFraction({ daysDone: 7, target: 5, weekStart: "2026-10-12" }), 1);
  assert.equal(weeklyFraction({ daysDone: 1, target: 0, weekStart: "2026-10-12" }), 0);
});

test("a level-up beats a badge beats XP, and nothing earned is no toast", () => {
  assert.deepEqual(rewardMoment(reward({ levelUp: true, newBadges: [badge("a", true, 1, 1)] })), {
    line: "Level up — you're now Ray!",
    big: true,
  });
  assert.deepEqual(rewardMoment(reward({ newBadges: [{ ...badge("streak_3", true, 3, 3), title: "Three in a row" }] })), {
    line: "Badge earned: Three in a row",
    big: true,
  });
  assert.deepEqual(rewardMoment(reward({ streak: 4 })), { line: "+15 XP · 4-day streak", big: false });
  assert.deepEqual(rewardMoment(reward()), { line: "+15 XP", big: false });
  assert.equal(rewardMoment(reward({ xpGained: 0 })), null);
  assert.equal(rewardMoment(null), null);
});

test("a reward is logged as a level-up and one event per badge", () => {
  assert.deepEqual(
    rewardEvents(reward({ levelUp: true, newBadges: [badge("first_drill", true, 1, 1), badge("first_100", true, 1, 1)] })).map((e) => e.name),
    ["level_up", "badge_earned", "badge_earned"],
  );
  assert.deepEqual(rewardEvents(reward()), []);
});

test("earned badges come first, newest first, then the nearest locked ones", () => {
  const sorted = sortBadges([
    badge("far", false, 1, 30),
    badge("old", true, 1, 1, "2026-10-01T10:00:00Z"),
    badge("near", false, 8, 10),
    badge("new", true, 1, 1, "2026-10-15T10:00:00Z"),
  ]);
  assert.deepEqual(sorted.map((b) => b.code), ["new", "old", "near", "far"]);
});

test("labels", () => {
  assert.equal(streakLabel(4), "4-day streak");
  assert.equal(streakLabel(0), "No streak yet");
  assert.equal(weekdayLetter("2026-10-17"), "S"); // a Saturday
  assert.equal(weekdayLetter("2026-10-12"), "M");
});

test("calendar days add across months and years", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("the streak is remembered as at risk today, or tomorrow once today is done", () => {
  assert.deepEqual(streakSnapshot({ today: "2026-10-17", streak: streak({ current: 4, atRisk: true }) }), {
    streak: 4,
    riskDay: "2026-10-17",
  });
  assert.deepEqual(streakSnapshot({ today: "2026-10-17", streak: streak({ current: 5, todayDone: true }) }), {
    streak: 5,
    riskDay: "2026-10-18",
  });
  assert.deepEqual(streakSnapshot({ today: "2026-10-17", streak: streak({}) }), { streak: 0, riskDay: null });
  assert.deepEqual(snapshotAfterTake(3, "2026-10-17"), { streak: 3, riskDay: "2026-10-18" });
});

const usual = { title: "Time to practise", body: "Play something." };

test("on the day the streak is at risk the one reminder is about it, in the evening", () => {
  const slot = reminderSlot("2026-10-17", 9, { streak: 4, riskDay: "2026-10-17" }, usual);
  assert.equal(slot.hour, STREAK_EVENING_HOUR);
  assert.equal(slot.body, "Keep your 4-day streak — today's drill takes 2 minutes.");
  assert.equal(slot.screen, "Practice");
  // An evening chosen later than seven keeps its hour.
  assert.equal(reminderSlot("2026-10-17", 21, { streak: 4, riskDay: "2026-10-17" }, usual).hour, 21);
});

test("every other day keeps the usual reminder at the chosen hour", () => {
  assert.deepEqual(reminderSlot("2026-10-18", 9, { streak: 4, riskDay: "2026-10-17" }, usual), {
    hour: 9,
    ...usual,
    screen: "Record",
  });
  assert.equal(reminderSlot("2026-10-17", 14, null, usual).screen, "Record");
  assert.equal(reminderSlot("2026-10-17", 14, { streak: 0, riskDay: "2026-10-17" }, usual).screen, "Record");
});
