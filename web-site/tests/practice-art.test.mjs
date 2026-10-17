// node --test web-site/tests/*.test.mjs
// The Practice art: which picture practice-track.js picks (Doh's mood and line, emblems, stickers, the flame, the
// reward's picture), that every picture it can name is a file in assets/practice-art, and that those files and the
// phone's copy (mobile/src/components/practice/art/svgs.ts) are what design/practice-art/build.mjs draws today.
// The mobile copy of the choices is mobile/src/lib/practiceTrack.ts (tests: practiceTrack.test.ts) — same cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { stale } from "../../design/practice-art/build.mjs";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/practice-track.js", import.meta.url), "utf8"), { window });
const T = window.NfPracticeTrack;
const ART_DIR = new URL("../assets/practice-art/", import.meta.url);
const has = (name) => existsSync(new URL(`${name}.svg`, ART_DIR));

const CODES = ["first_drill", "streak_3", "first_100", "drills_10", "first_part", "week_goal", "streak_7", "whole_part_80", "streak_30"];
const ray = { index: 1, name: "Ray", minXp: 100, nextLevelXp: 250, nextName: "Me", xpForNext: 100 };
const reward = (over = {}) => ({ xpGained: 15, xp: 115, levelUp: false, level: ray, streak: 1, newBadges: [], ...over });
const streak = (over) => ({ current: 0, best: 0, todayDone: false, atRisk: false, freezeAvailable: true, frozenYesterday: false, ...over });
const scene = (over = {}) => ({ picking: false, recording: false, grade: null, hasDrill: true, drillsLeft: 3, ...over });
const progress = (over = {}) => ({ today: "2026-10-17", streak: streak(over.streak || {}), weeklyGoal: { daysDone: over.days ?? 2, target: 5, weekStart: "2026-10-12" } });

test("the art files and the phone's copy are what design/practice-art draws", () => {
  assert.deepEqual(stale(), []);
});

test("Doh's mood: hand-off in the picker, singing while recording, cheering a level or the goal met", () => {
  assert.equal(T.mascotMood(progress(), scene({ picking: true, recording: true })), "handoff");
  assert.equal(T.mascotMood(progress(), scene({ recording: true, grade: { score: 60, reward: null } })), "sing");
  assert.equal(T.mascotMood(progress(), scene({ grade: { score: 40, reward: reward({ levelUp: true }) } })), "cheer");
  assert.equal(T.mascotMood(progress({ streak: { current: 5, todayDone: true }, days: 5 }), scene()), "cheer");
  assert.equal(T.mascotMood(progress({ streak: { current: 5, atRisk: true }, days: 5 }), scene()), "worried");
});

test("Doh's mood: encouraging a near miss, sleepy with no drill or none left, worried for the streak, else waving", () => {
  assert.equal(T.mascotMood(progress(), scene({ grade: { score: 65, reward: reward() } })), "encourage");
  assert.equal(T.mascotMood(progress(), scene({ grade: { score: 90, reward: reward() } })), "wave");
  assert.equal(T.mascotMood(progress(), scene({ grade: { score: 20, reward: reward() } })), "wave");
  assert.equal(T.mascotMood(progress(), scene({ hasDrill: false })), "sleepy");
  assert.equal(T.mascotMood(progress({ streak: { current: 2, todayDone: true } }), scene({ drillsLeft: 0 })), "sleepy");
  assert.equal(T.mascotMood(progress({ streak: { current: 3, atRisk: true } }), scene()), "worried");
  assert.equal(T.mascotMood(progress(), scene({ drillsLeft: null })), "wave");
});

test("Doh's lines follow the mood, and the waving Doh says the day's buddy line", () => {
  const p = progress({ streak: { current: 4, atRisk: true } });
  assert.equal(T.mascotLine("worried", p, scene()), "Sing today to keep your 4-day streak going!");
  assert.equal(T.mascotLine("cheer", p, scene({ grade: { score: 90, reward: reward({ levelUp: true }) } })), "Hooray! You've reached Ray!");
  assert.equal(T.mascotLine("cheer", progress({ days: 5 }), scene()), "5 days this week. Weekly goal met!");
  assert.equal(T.mascotLine("sleepy", p, scene({ hasDrill: false })), "No drill yet. Try again in a moment.");
  assert.equal(T.mascotLine("sleepy", p, scene({ drillsLeft: 0 })), "All sung for today. See you tomorrow!");
  assert.equal(T.mascotLine("wave", p, scene()), T.buddyLine(p));
});

test("every badge has a sticker and a locked one; Seven in a row and A week of practice have their own", () => {
  for (const code of CODES) {
    assert.ok(has(T.badgeArt(code, true)), code);
    assert.ok(has(T.badgeArt(code, false)), `${code} locked`);
    assert.equal(T.badgeArt(code, false), `${T.badgeArt(code, true)}-locked`);
  }
  assert.equal(new Set(CODES.map((c) => T.badgeArt(c, true))).size, CODES.length);
  assert.equal(T.badgeArt("streak_7", true), "badge-seven-in-a-row");
  assert.equal(T.badgeArt("week_goal", true), "badge-week-goal");
  assert.equal(T.badgeArt("a_badge_from_the_future", true), "badge-first-drill");
});

test("levels, flames, stars, moods, tracks and confetti all name art that exists", () => {
  for (let i = 0; i < 8; i++) assert.ok(has(T.levelArt(i)), String(i));
  assert.equal(T.levelArt(7), "level-8-choir-ready");
  assert.equal(T.levelArt(-1), "level-1-doh");
  assert.equal(T.levelArt(42), "level-8-choir-ready");
  assert.equal(T.flameArt({ current: 0, atRisk: false }), "flame-out");
  assert.equal(T.flameArt({ current: 4, atRisk: true }), "flame-at-risk");
  assert.equal(T.flameArt({ current: 4, atRisk: false }), "flame-active");
  for (const s of [1, 2, 3]) assert.ok(has(T.starsArt(s)));
  for (const m of ["wave", "sing", "cheer", "encourage", "worried", "sleepy", "handoff"]) assert.ok(has(T.mascotArt(m)), m);
  assert.ok(has(T.trackArt("playful")) && has(T.trackArt("focused")));
  assert.equal(T.CONFETTI_ART.length, 8);
  for (const c of T.CONFETTI_ART) assert.ok(has(c), c);
  for (const n of ["doh-avatar", "freeze", "empty-no-drill", "empty-offline"]) assert.ok(has(n), n);
});

test("a reward's picture: the new level's emblem, else the new badge's sticker, else none", () => {
  const sticker = { code: "drills_10", title: "Ten drills", description: "", earned: true, earnedAtUtc: null, progress: 10, target: 10 };
  assert.equal(T.rewardArt(reward({ levelUp: true, level: { ...ray, index: 6, name: "Te" }, newBadges: [sticker] })), "level-7-te");
  assert.equal(T.rewardArt(reward({ newBadges: [sticker] })), "badge-ten-drills");
  assert.equal(T.rewardArt(reward()), null);
  assert.equal(T.rewardArt(null), null);
});

test("the art files are lean SVG with nothing that runs and nothing fetched", () => {
  const files = readdirSync(ART_DIR).filter((f) => f.endsWith(".svg"));
  assert.ok(files.length >= 50);
  for (const f of files) {
    const svg = readFileSync(new URL(f, ART_DIR), "utf8");
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+">/, f);
    assert.doesNotMatch(svg, /<script|\son\w+=|href=|<image|@import|>\s+</i, f);
    assert.ok(svg.length < 6 * 1024, `${f}: ${svg.length} bytes`);
  }
});

test("Choir-ready is violet and no gold is left in the art (gold is Pro's alone)", () => {
  const choir = readFileSync(new URL("level-8-choir-ready.svg", ART_DIR), "utf8");
  assert.match(choir, /#8B5CF6/);
  const golds = /#(F5B544|FFD36B|FFE08A|FFE7A3|E59A12|BF7408|C77A0A|F59E0B|FBBF24|D99A2B|FFD27A)\b/i;
  for (const f of readdirSync(ART_DIR)) {
    // The only amber kept: Doh's beak and feet (a bird's, not a reward's) and, on Focused's scene, the one note
    // marked "close" in the app's own close-mark amber.
    const svg = readFileSync(new URL(f, ART_DIR), "utf8");
    const judged = /^(doh-|empty-|track-)/.test(f) ? svg.replace(/#F5B544|#D99A2B/gi, "") : svg;
    assert.doesNotMatch(judged, golds, f);
  }
});
