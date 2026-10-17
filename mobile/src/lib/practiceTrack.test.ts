import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFETTI_ART,
  THREE_STAR_SCORE,
  TRACK_OPTIONS,
  badgeArt,
  buddyLine,
  celebrationFor,
  flameArt,
  levelArt,
  mascotArt,
  mascotLine,
  mascotMood,
  playfulRewardLine,
  rewardArt,
  starHint,
  starWord,
  starsArt,
  starsFor,
  stickerTilt,
  trackArt,
  trackTitle,
  tuningLine,
  type MascotScene,
} from "./practiceTrack.ts";
import { ART } from "../components/practice/art/svgs.ts";
import type { PracticeLevel, PracticeReward, PracticeStreak } from "../api/types";

const ray: PracticeLevel = { index: 1, name: "Ray", minXp: 100, nextLevelXp: 250, nextName: "Me", xpForNext: 100 };

const reward = (over: Partial<PracticeReward> = {}): PracticeReward => ({
  xpGained: 15,
  xp: 115,
  levelUp: false,
  level: ray,
  streak: 1,
  newBadges: [],
  ...over,
});

const sticker = { code: "drills_10", title: "Ten drills", description: "", earned: true, earnedAtUtc: null, progress: 10, target: 10 };

const streak = (over: Partial<PracticeStreak>): PracticeStreak => ({
  current: 0,
  best: 0,
  todayDone: false,
  atRisk: false,
  freezeAvailable: true,
  frozenYesterday: false,
  ...over,
});

test("the two tracks are offered as styles, Playful first, and never ask an age", () => {
  assert.deepEqual(TRACK_OPTIONS.map((o) => o.track), ["playful", "focused"]);
  assert.equal(TRACK_OPTIONS[0]!.blurb, "Fun and games: short drills, stars and stickers");
  assert.equal(TRACK_OPTIONS[1]!.blurb, "For serious singers: harder lines, exact scores");
  for (const o of TRACK_OPTIONS) assert.doesNotMatch(`${o.title} ${o.blurb}`, /\b(age|kid|child|adult|old)\b/i);
  assert.equal(trackTitle("playful"), "Playful");
  assert.equal(trackTitle("focused"), "Focused");
});

test("stars: three from the server's good score, two from 50, and one for any marked take", () => {
  assert.equal(THREE_STAR_SCORE, 80);
  assert.equal(starsFor(100), 3);
  assert.equal(starsFor(80), 3);
  assert.equal(starsFor(79), 2);
  assert.equal(starsFor(50), 2);
  assert.equal(starsFor(49), 1);
  assert.equal(starsFor(0), 1);
});

test("each star count has its friendly word, and the hint never shows a number", () => {
  assert.equal(starWord(3), "Super!");
  assert.equal(starWord(2), "Nearly there");
  assert.equal(starWord(1), "Good try!");

  const marks = { hits: 2, near: 1, wrong: 1, missed: 0 };
  assert.equal(starHint(marks, 3), "You sang it beautifully.");
  assert.match(starHint(marks, 2), /So close/);
  assert.match(starHint(marks, 1), /Listen to it first/);
  assert.match(starHint({ hits: 0, near: 0, wrong: 0, missed: 5 }, 1), /couldn't hear you/);
  for (const s of [1, 2, 3] as const) assert.doesNotMatch(starHint(marks, s), /\d/);
});

test("Playful bursts for three stars, a level or a sticker; Focused keeps its toast for a level or a badge", () => {
  assert.equal(celebrationFor("playful", 90, reward()), "burst");
  assert.equal(celebrationFor("playful", 60, reward({ levelUp: true })), "burst");
  assert.equal(celebrationFor("playful", 30, reward({ newBadges: [sticker] })), "burst");
  assert.equal(celebrationFor("playful", 60, reward()), "toast");
  assert.equal(celebrationFor("playful", 60, reward({ xpGained: 0 })), "quiet");

  assert.equal(celebrationFor("focused", 100, reward()), "quiet");
  assert.equal(celebrationFor("focused", 40, reward({ newBadges: [sticker] })), "toast");
  assert.equal(celebrationFor("focused", 40, reward({ levelUp: true })), "toast");

  // No track chosen: as before the tracks, a line for anything earned.
  assert.equal(celebrationFor(null, 60, reward()), "toast");
  assert.equal(celebrationFor(null, 60, reward({ xpGained: 0 })), "quiet");
  assert.equal(celebrationFor(null, 60, null), "quiet");
});

test("Playful's reward line: a level beats a sticker beats the XP, and nothing earned says nothing", () => {
  assert.equal(playfulRewardLine(reward({ levelUp: true, newBadges: [sticker] })), "Hooray! You've reached Ray!");
  assert.equal(playfulRewardLine(reward({ newBadges: [sticker] })), "New sticker: Ten drills!");
  assert.equal(playfulRewardLine(reward({ streak: 3 })), "+15 XP and 3 days in a row!");
  assert.equal(playfulRewardLine(reward()), "+15 XP. Well sung!");
  assert.equal(playfulRewardLine(reward({ xpGained: 0 })), null);
  assert.equal(playfulRewardLine(null), null);
});

test("Focused's tuning line rounds the lean and calls it in tune within five cents", () => {
  assert.equal(tuningLine(0), "In tune overall");
  assert.equal(tuningLine(4.6), "5 cents sharp overall");
  assert.equal(tuningLine(-4.4), "In tune overall");
  assert.equal(tuningLine(-17.2), "17 cents flat overall");
  assert.equal(tuningLine(Number.NaN), "In tune overall");
});

test("the buddy speaks to today and the streak first, else the day's encouragement, the same all day", () => {
  assert.equal(buddyLine({ today: "2026-10-17", streak: streak({ current: 4, todayDone: true }) }), "4 days in a row. You're a star!");
  assert.equal(buddyLine({ today: "2026-10-17", streak: streak({ current: 1, todayDone: true }) }), "You sang today. Brilliant!");
  assert.equal(buddyLine({ today: "2026-10-17", streak: streak({ current: 3, atRisk: true }) }), "Sing today to keep your 3-day streak going!");

  const fresh = (day: string) => buddyLine({ today: day, streak: streak({}) });
  assert.equal(fresh("2026-10-17"), fresh("2026-10-17"));
  const week = new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map(fresh));
  assert.equal(week.size, 7);
});

test("a sticker's tilt is fixed per badge and stays within six degrees", () => {
  assert.equal(stickerTilt("first_drill"), stickerTilt("first_drill"));
  for (const code of ["first_drill", "streak_3", "first_100", "drills_10", "first_part", "week_goal", "streak_7", "whole_part_80", "streak_30"]) {
    const t = stickerTilt(code);
    assert.ok(Number.isInteger(t) && t >= -6 && t <= 6, `${code}: ${t}`);
  }
});

test("a path milestone is a burst on Playful and a toast otherwise, even when it earned no XP", () => {
  assert.equal(celebrationFor("playful", 85, reward({ xpGained: 0 }), true), "burst");
  assert.equal(celebrationFor(null, 85, reward({ xpGained: 0 }), true), "toast");
  assert.equal(celebrationFor("focused", 85, reward(), true), "toast");
  assert.equal(celebrationFor("focused", 85, reward(), false), "quiet");
});

// ── The art ──────────────────────────────────────────────────────────────────

const CODES = ["first_drill", "streak_3", "first_100", "drills_10", "first_part", "week_goal", "streak_7", "whole_part_80", "streak_30"];
const week = (daysDone: number) => ({ daysDone, target: 5, weekStart: "2026-10-12" });
const scene = (over: Partial<MascotScene> = {}): MascotScene => ({ picking: false, recording: false, grade: null, hasDrill: true, drillsLeft: 3, ...over });
const progress = (over: { streak?: Partial<PracticeStreak>; days?: number } = {}) => ({
  today: "2026-10-17",
  streak: streak(over.streak ?? {}),
  weeklyGoal: week(over.days ?? 2),
});

test("Doh's mood: hand-off in the picker, singing while recording, cheering a level or the goal met", () => {
  assert.equal(mascotMood(progress(), scene({ picking: true, recording: true })), "handoff");
  assert.equal(mascotMood(progress(), scene({ recording: true, grade: { score: 60, reward: null } })), "sing");
  assert.equal(mascotMood(progress(), scene({ grade: { score: 40, reward: reward({ levelUp: true }) } })), "cheer");
  assert.equal(mascotMood(progress({ streak: { current: 5, todayDone: true }, days: 5 }), scene()), "cheer");
  // the goal met but today not sung yet: the streak comes first
  assert.equal(mascotMood(progress({ streak: { current: 5, atRisk: true }, days: 5 }), scene()), "worried");
});

test("Doh's mood: encouraging a near miss, sleepy with no drill or none left, worried for the streak, else waving", () => {
  assert.equal(mascotMood(progress(), scene({ grade: { score: 65, reward: reward() } })), "encourage");
  assert.equal(mascotMood(progress(), scene({ grade: { score: 90, reward: reward() } })), "wave");
  assert.equal(mascotMood(progress(), scene({ grade: { score: 20, reward: reward() } })), "wave");
  assert.equal(mascotMood(progress(), scene({ hasDrill: false })), "sleepy");
  assert.equal(mascotMood(progress({ streak: { current: 2, todayDone: true } }), scene({ drillsLeft: 0 })), "sleepy");
  assert.equal(mascotMood(progress({ streak: { current: 3, atRisk: true } }), scene()), "worried");
  assert.equal(mascotMood(progress(), scene({ drillsLeft: null })), "wave");
});

test("Doh's lines follow the mood, and the waving Doh says the day's buddy line", () => {
  const p = progress({ streak: { current: 4, atRisk: true } });
  assert.equal(mascotLine("worried", p, scene()), "Sing today to keep your 4-day streak going!");
  assert.equal(mascotLine("cheer", p, scene({ grade: { score: 90, reward: reward({ levelUp: true }) } })), "Hooray! You've reached Ray!");
  assert.equal(mascotLine("cheer", progress({ days: 5 }), scene()), "5 days this week. Weekly goal met!");
  assert.equal(mascotLine("sleepy", p, scene({ hasDrill: false })), "No drill yet. Try again in a moment.");
  assert.equal(mascotLine("sleepy", p, scene({ drillsLeft: 0 })), "All sung for today. See you tomorrow!");
  assert.equal(mascotLine("wave", p, scene()), buddyLine(p));
  for (const line of ["sing", "encourage", "handoff"].map((m) => mascotLine(m as never, p, scene()))) assert.ok(line.length > 0);
});

test("every badge has a sticker and a locked one; Seven in a row and A week of practice have their own", () => {
  for (const code of CODES) {
    assert.ok(badgeArt(code, true) in ART, code);
    assert.ok(badgeArt(code, false) in ART, `${code} locked`);
    assert.equal(badgeArt(code, false), `${badgeArt(code, true)}-locked`);
  }
  assert.equal(new Set(CODES.map((c) => badgeArt(c, true))).size, CODES.length);
  assert.equal(badgeArt("streak_7", true), "badge-seven-in-a-row");
  assert.equal(badgeArt("week_goal", true), "badge-week-goal");
  assert.equal(badgeArt("a_badge_from_the_future", true), "badge-first-drill");
});

test("levels, flames, stars, moods, tracks and confetti all name art that exists", () => {
  for (let i = 0; i < 8; i++) assert.ok(levelArt(i) in ART, String(i));
  assert.equal(levelArt(7), "level-8-choir-ready");
  assert.equal(levelArt(-1), "level-1-doh");
  assert.equal(levelArt(42), "level-8-choir-ready");
  assert.equal(flameArt({ current: 0, atRisk: false }), "flame-out");
  assert.equal(flameArt({ current: 4, atRisk: true }), "flame-at-risk");
  assert.equal(flameArt({ current: 4, atRisk: false }), "flame-active");
  for (const s of [1, 2, 3] as const) assert.ok(starsArt(s) in ART);
  for (const m of ["wave", "sing", "cheer", "encourage", "worried", "sleepy", "handoff"] as const) assert.ok(mascotArt(m) in ART, m);
  assert.ok(trackArt("playful") in ART && trackArt("focused") in ART);
  assert.equal(CONFETTI_ART.length, 8);
  for (const c of CONFETTI_ART) assert.ok(c in ART, c);
  for (const n of ["doh-avatar", "freeze", "empty-no-drill", "empty-offline"]) assert.ok(n in ART, n);
  // Art.tsx sizes each picture from this viewBox (single-quoted in the phone's copy).
  for (const [n, xml] of Object.entries(ART)) assert.match(xml, /^<svg viewBox='0 0 [\d.]+ [\d.]+'>/, n);
});

test("a reward's picture: the new level's emblem, else the new badge's sticker, else none", () => {
  const te = { ...ray, index: 6, name: "Te" };
  assert.equal(rewardArt(reward({ levelUp: true, level: te, newBadges: [sticker] })), "level-7-te");
  assert.equal(rewardArt(reward({ newBadges: [sticker] })), "badge-ten-drills");
  assert.equal(rewardArt(reward()), null);
  assert.equal(rewardArt(null), null);
});
