// The mirror of web-site/tests/practice-moments.test.mjs: lib/practiceMoments.ts chooses the reward moments a take earns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alongMoments, longestRun, momentsFor } from "./practiceMoments.ts";

const reward = (over = {}) => ({ xpGained: 15, xp: 115, levelUp: false, level: {}, streak: 4, newBadges: [], ...over });
const hits = (n, then = []) => [...Array.from({ length: n }, (_, i) => ({ index: i, status: "hit" })), ...then.map((status, i) => ({ index: n + i, status }))];
const grade = (over = {}) => ({ score: 70, notes: hits(2, ["near", "hit"]), reward: reward(), milestone: null, ...over });
const before = (over = {}) => ({
  streak: { current: 3, best: 3, todayDone: true, atRisk: false, freezeAvailable: true, frozenYesterday: false },
  weeklyGoal: { daysDone: 2, target: 5, weekStart: "2026-10-26" },
  ...over,
});
const pieces = (list: { piece: string }[]) => list.map((m) => m.piece);

test("Playful's stars come first, as many as the mark gives; Focused has none", () => {
  assert.deepEqual((momentsFor("playful", before(), grade({ score: 85 })))[0], { piece: "stars", values: { stars: 3 } });
  assert.deepEqual((momentsFor("playful", before(), grade({ score: 55 })))[0].values, { stars: 2 });
  assert.deepEqual((momentsFor("playful", before(), grade({ score: 10 })))[0].values, { stars: 1 });
  assert.deepEqual(pieces(momentsFor("focused", before(), grade())), []);
  assert.deepEqual(pieces(momentsFor("playful", before(), null)), []);
});

test("one big moment at most, the biggest: a finished unit or grade, then the week's goal, then the day's streak", () => {
  const firstToday = before({ streak: { ...before().streak, todayDone: false } });
  const unit = { kind: "unit", title: "Unit 2 of Grade 1 complete" };
  assert.deepEqual((momentsFor("focused", firstToday, grade({ milestone: unit }))), [{ piece: "musicbox", values: { label: "Unit done!" } }]);
  assert.equal((momentsFor("focused", before(), grade({ milestone: { ...unit, kind: "grade" } })))[0].values.label, "Grade done!");
  // The day's first take that meets the week's goal: the ring, closing on today.
  const lastDay = before({ streak: firstToday.streak, weeklyGoal: { daysDone: 4, target: 5 } });
  assert.deepEqual((momentsFor("focused", lastDay, grade())), [{ piece: "goal", values: { done: 5, target: 5 } }]);
  // Otherwise the day's first take extends the streak, to the count the server gave.
  assert.deepEqual((momentsFor("focused", firstToday, grade())), [{ piece: "streak", values: { days: 4 } }]);
  // A goal already met this week is not met again.
  const metAlready = before({ streak: firstToday.streak, weeklyGoal: { daysDone: 5, target: 5 } });
  assert.deepEqual(pieces(momentsFor("focused", metAlready, grade())), ["streak"]);
  // A level or a badge is the 3D piece's moment: nothing else beside it, Playful's stars aside.
  assert.deepEqual(pieces(momentsFor("playful", firstToday, grade({ reward: reward({ levelUp: true }), milestone: unit }))), ["stars"]);
  assert.deepEqual(pieces(momentsFor("focused", firstToday, grade({ reward: reward({ newBadges: [{ code: "drills_10" }] }) }))), []);
});

test("a run of five in tune is a combo, perfect when it is the whole take; Doh cheers Playful's three stars", () => {
  assert.equal(longestRun(hits(3, ["near", "hit", "hit", "wrong", "missed"])), 3);
  assert.equal(longestRun([]), 0);
  assert.deepEqual((momentsFor("focused", before(), grade({ notes: hits(6, ["near"]) })))[0], { piece: "combo", values: { run: 6, perfect: 0 } });
  assert.deepEqual((momentsFor("focused", before(), grade({ notes: hits(8) })))[0].values, { run: 8, perfect: 1 });
  assert.deepEqual(pieces(momentsFor("focused", before(), grade({ notes: hits(4, ["near"]) }))), []);
  assert.deepEqual(pieces(momentsFor("playful", before(), grade({ score: 90 }))), ["stars", "doh"]);
  assert.deepEqual(pieces(momentsFor("playful", before(), grade({ score: 90, notes: hits(5) }))), ["stars", "combo"]);
  assert.deepEqual(pieces(momentsFor("focused", before(), grade({ score: 90 }))), []);
  assert.deepEqual(pieces(momentsFor("playful", before(), grade({ score: 60 }))), ["stars"]);
});

test("play-along's end: stars from the share right first time, a perfect run of five or more", () => {
  assert.deepEqual((alongMoments({ played: 32, firstTime: 31, total: 32 })), [{ piece: "stars", values: { stars: 3 } }]);
  assert.deepEqual((alongMoments({ played: 10, firstTime: 7, total: 10 }))[0].values, { stars: 2 });
  assert.deepEqual((alongMoments({ played: 10, firstTime: 3, total: 10 }))[0].values, { stars: 1 });
  assert.deepEqual(pieces(alongMoments({ played: 8, firstTime: 8, total: 8 })), ["stars", "combo"]);
  assert.deepEqual(pieces(alongMoments({ played: 4, firstTime: 4, total: 4 })), ["stars"]);
  assert.deepEqual((alongMoments(null)), []);
});
