import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STREAK_EVENING_HOUR,
  addDays,
  allowanceLine,
  levelFraction,
  nextAction,
  pathLine,
  resetTime,
  unitBarFraction,
  unitFraction,
  unitLine,
  nextLevelLine,
  reminderSlot,
  rewardEvents,
  rewardMoment,
  snapshotAfterTake,
  sortBadges,
  bestStreakLine,
  streakLabel,
  streakLine,
  streakSnapshot,
  weekdayLetter,
  weeklyFraction,
  xpAmount,
} from "./practiceProgress.ts";
import type { Drill, PracticeBadge, PracticeLevel, PracticeReward, PracticeStreak } from "../api/types";

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
  assert.equal(nextLevelLine({ ...ray, xpForNext: 1250 }), "1,250 XP to Me");
  assert.equal(nextLevelLine(top), "Top of the ladder");
  assert.equal(xpAmount(12450), "12,450 XP");
  assert.equal(xpAmount(40), "40 XP");
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
  assert.equal(streakLabel(0, 30), "No streak now");
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

// ── The practice path ─────────────────────────────────────────────────────────

const place = (over: Partial<Pick<Drill, "grade" | "unitIndex" | "drillIndex" | "drillCount" | "adjustment">> = {}) => ({
  grade: "Grade 2",
  unitIndex: 3,
  drillIndex: 4,
  drillCount: 6,
  adjustment: "steady" as const,
  ...over,
});

test("the path line names the grade, the unit and the drill, and says when the last take moved it", () => {
  assert.equal(pathLine(place()), "Grade 2 · Unit 3 · 4 of 6");
  assert.equal(pathLine(place({ adjustment: "easier" })), "Grade 2 · Unit 3 · 4 of 6 · Easier");
  assert.equal(pathLine(place({ adjustment: "harder", grade: "Advanced 1" })), "Advanced 1 · Unit 3 · 4 of 6 · Harder");
  assert.equal(pathLine(place({ grade: "" })), null);
  assert.equal(pathLine(place({ unitIndex: 0 })), null);
});

test("beside the unit bar, the path line without the grade the eyebrow already says", () => {
  assert.equal(unitLine(place()), "Unit 3 · 4 of 6");
  assert.equal(unitLine(place({ adjustment: "easier" })), "Unit 3 · 4 of 6 · Easier");
  assert.equal(unitLine(place({ adjustment: "harder", grade: "Advanced 1" })), "Unit 3 · 4 of 6 · Harder");
  assert.equal(unitLine(place({ grade: "" })), null);
  assert.equal(unitLine(place({ unitIndex: 0 })), null);
});

test("the unit bar fills with the drills behind the singer", () => {
  assert.equal(unitFraction(place({ drillIndex: 1, drillCount: 4 })), 0);
  assert.equal(unitFraction(place({ drillIndex: 3, drillCount: 4 })), 0.5);
  assert.equal(unitFraction(place({ drillIndex: 9, drillCount: 4 })), 1);
  assert.equal(unitFraction(place({ drillCount: 0 })), 0);
});

test("the phone's unit bar starts a tenth in for the drill in hand and fills the rest with the drills behind", () => {
  assert.equal(unitBarFraction(place({ drillIndex: 1, drillCount: 4 })), 0.1);
  assert.equal(unitBarFraction(place({ drillIndex: 3, drillCount: 4 })), 0.55);
  assert.equal(unitBarFraction(place({ drillIndex: 4, drillCount: 6 })), 0.55);
  assert.equal(unitBarFraction(place({ drillIndex: 9, drillCount: 4 })), 1);
  assert.equal(unitBarFraction(place({ drillCount: 0 })), 0);
});

test("the main button moves on, or says try again when the path brings the same drill back", () => {
  assert.deepEqual(nextAction({ id: "a@60" }, { id: "b@62" }, null), { label: "Continue", same: false });
  assert.deepEqual(nextAction({ id: "a@60" }, { id: "a@60" }, "focused"), { label: "Try it again", same: true });
  assert.deepEqual(nextAction({ id: "a@60" }, null, "playful"), { label: "Keep going!", same: false });
  assert.deepEqual(nextAction({ id: "a@60~gentle" }, { id: "a@60~gentle" }, "playful"), { label: "Try again!", same: true });
});

test("the allowance counts down, then says warmly when more come, on the phone's clock", () => {
  const lagosMidnight = "2026-10-17T23:00:00Z";
  assert.equal(allowanceLine({ used: 3, limit: 10, resetsAtUtc: lagosMidnight }, -60), "7 of 10 marked drills left today");
  assert.equal(allowanceLine({ used: 10, limit: 10, resetsAtUtc: lagosMidnight }, -60), "That's all 10 of today's drills. Well sung! More from midnight.");
  // The same moment on a phone set to UTC is 11 pm.
  assert.equal(resetTime(lagosMidnight, 0), "11:00 pm");
  assert.equal(resetTime("2026-10-18T00:30:00Z", 0), "12:30 am");
  assert.equal(resetTime("2026-10-18T13:05:00Z", 0), "1:05 pm");
  assert.equal(allowanceLine({ used: 12, limit: 10, resetsAtUtc: null }), "That's all 10 of today's drills. Well sung! More tomorrow.");
  assert.equal(resetTime("not a time"), null);
});

test("a lapsed streak says the best kept, never 'No streak yet'", () => {
  const lapsed = { current: 0, best: 30, todayDone: false, atRisk: false };
  assert.equal(bestStreakLine(lapsed), "Your best: 30 days");
  assert.equal(bestStreakLine({ current: 0, best: 1 }), "Your best: 1 day");
  assert.equal(bestStreakLine({ current: 4, best: 30 }), null);
  assert.equal(bestStreakLine({ current: 0, best: 0 }), null);
  assert.equal(streakLine(lapsed), "Your best: 30 days. Start a new one today.");
  assert.equal(streakLine({ ...lapsed, best: 0 }), "Sing a drill to start one");
  assert.equal(streakLine({ current: 3, best: 30, todayDone: false, atRisk: true }), "Sing today to keep it");
  assert.equal(streakLine({ current: 3, best: 30, todayDone: true, atRisk: false }), "Done for today");
});
