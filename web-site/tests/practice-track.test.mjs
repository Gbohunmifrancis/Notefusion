// node --test web-site/tests/*.test.mjs
// practice-track.js is how the Practice view tells Playful from Focused: the picker's words, stars, celebrations,
// the tuning line, the buddy and the stickers. The mobile copy (mobile/src/lib/practiceTrack.test.ts) has the same cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/practice-track.js", import.meta.url), "utf8"), { window });
const T = window.NfPracticeTrack;

const ray = { index: 1, name: "Ray", minXp: 100, nextLevelXp: 250, nextName: "Me", xpForNext: 100 };
const reward = (over = {}) => ({ xpGained: 15, xp: 115, levelUp: false, level: ray, streak: 1, newBadges: [], ...over });
const sticker = { code: "drills_10", title: "Ten drills", description: "", earned: true, earnedAtUtc: null, progress: 10, target: 10 };
const streak = (over) => ({ current: 0, best: 0, todayDone: false, atRisk: false, freezeAvailable: true, frozenYesterday: false, ...over });

test("the two tracks are offered as styles, Playful first, and never ask an age", () => {
  assert.deepEqual([...T.TRACK_OPTIONS.map((o) => o.track)], ["playful", "focused"]);
  assert.equal(T.TRACK_QUESTION, "How do you like to practise?");
  assert.equal(T.TRACK_OPTIONS[0].blurb, "Fun and games: short drills, stars and stickers");
  assert.equal(T.TRACK_OPTIONS[1].blurb, "For serious singers: harder lines, exact scores");
  for (const o of T.TRACK_OPTIONS) assert.doesNotMatch(`${o.title} ${o.blurb}`, /\b(age|kid|child|adult|old)\b/i);
  assert.equal(T.trackTitle("playful"), "Playful");
  assert.equal(T.trackTitle("focused"), "Focused");
});

test("stars: three from the server's good score, two from 50, and one for any marked take", () => {
  assert.equal(T.THREE_STAR_SCORE, 80);
  assert.equal(T.starsFor(100), 3);
  assert.equal(T.starsFor(80), 3);
  assert.equal(T.starsFor(79), 2);
  assert.equal(T.starsFor(50), 2);
  assert.equal(T.starsFor(49), 1);
  assert.equal(T.starsFor(0), 1);
});

test("each star count has its friendly word, and the hint never shows a number", () => {
  assert.equal(T.starWord(3), "Super!");
  assert.equal(T.starWord(2), "Nearly there");
  assert.equal(T.starWord(1), "Good try!");
  const marks = { hits: 2, near: 1, wrong: 1, missed: 0 };
  assert.equal(T.starHint(marks, 3), "You sang it beautifully.");
  assert.match(T.starHint(marks, 2), /So close/);
  assert.match(T.starHint(marks, 1), /Listen to it first/);
  assert.match(T.starHint({ hits: 0, near: 0, wrong: 0, missed: 5 }, 1), /couldn't hear you/);
  for (const s of [1, 2, 3]) assert.doesNotMatch(T.starHint(marks, s), /\d/);
});

test("Playful bursts for three stars, a level or a sticker; Focused keeps its toast for a level or a badge", () => {
  assert.equal(T.celebrationFor("playful", 90, reward()), "burst");
  assert.equal(T.celebrationFor("playful", 60, reward({ levelUp: true })), "burst");
  assert.equal(T.celebrationFor("playful", 30, reward({ newBadges: [sticker] })), "burst");
  assert.equal(T.celebrationFor("playful", 60, reward()), "toast");
  assert.equal(T.celebrationFor("playful", 60, reward({ xpGained: 0 })), "quiet");
  assert.equal(T.celebrationFor("focused", 100, reward()), "quiet");
  assert.equal(T.celebrationFor("focused", 40, reward({ newBadges: [sticker] })), "toast");
  assert.equal(T.celebrationFor("focused", 40, reward({ levelUp: true })), "toast");
  // No track chosen: as before the tracks, a line for anything earned.
  assert.equal(T.celebrationFor(null, 60, reward()), "toast");
  assert.equal(T.celebrationFor(null, 60, reward({ xpGained: 0 })), "quiet");
  assert.equal(T.celebrationFor(null, 60, null), "quiet");
});

test("Playful's reward line: a level beats a sticker beats the XP, and nothing earned says nothing", () => {
  assert.equal(T.playfulRewardLine(reward({ levelUp: true, newBadges: [sticker] })), "Hooray! You've reached Ray!");
  assert.equal(T.playfulRewardLine(reward({ newBadges: [sticker] })), "New sticker: Ten drills!");
  assert.equal(T.playfulRewardLine(reward({ streak: 3 })), "+15 XP and 3 days in a row!");
  assert.equal(T.playfulRewardLine(reward()), "+15 XP. Well sung!");
  assert.equal(T.playfulRewardLine(reward({ xpGained: 0 })), null);
  assert.equal(T.playfulRewardLine(null), null);
});

test("Focused's tuning line rounds the lean and calls it in tune within five cents", () => {
  assert.equal(T.tuningLine(0), "In tune overall");
  assert.equal(T.tuningLine(4.6), "5 cents sharp overall");
  assert.equal(T.tuningLine(-4.4), "In tune overall");
  assert.equal(T.tuningLine(-17.2), "17 cents flat overall");
  assert.equal(T.tuningLine(Number.NaN), "In tune overall");
});

test("the buddy speaks to today and the streak first, else the day's encouragement, the same all day", () => {
  assert.equal(T.buddyLine({ today: "2026-10-17", streak: streak({ current: 4, todayDone: true }) }), "4 days in a row. You're a star!");
  assert.equal(T.buddyLine({ today: "2026-10-17", streak: streak({ current: 1, todayDone: true }) }), "You sang today. Brilliant!");
  assert.equal(T.buddyLine({ today: "2026-10-17", streak: streak({ current: 3, atRisk: true }) }), "Sing today to keep your 3-day streak going!");
  const fresh = (day) => T.buddyLine({ today: day, streak: streak({}) });
  assert.equal(fresh("2026-10-17"), fresh("2026-10-17"));
  const week = new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"].map(fresh));
  assert.equal(week.size, 7);
});

test("a sticker's tilt is fixed per badge, within six degrees, and the same as the phone's", () => {
  assert.equal(T.stickerTilt("first_drill"), T.stickerTilt("first_drill"));
  for (const code of ["first_drill", "streak_3", "first_100", "drills_10", "first_part", "streak_7", "whole_part_80", "streak_30"]) {
    const t = T.stickerTilt(code);
    assert.ok(Number.isInteger(t) && t >= -6 && t <= 6, `${code}: ${t}`);
  }
});

test("the mobile copy has the same words (lock-step check)", () => {
  const ts = readFileSync(new URL("../../mobile/src/lib/practiceTrack.ts", import.meta.url), "utf8");
  for (const o of T.TRACK_OPTIONS) assert.ok(ts.includes(o.blurb), o.blurb);
  for (const w of ["Super!", "Nearly there", "Good try!", T.TRACK_QUESTION]) assert.ok(ts.includes(w), w);
});
