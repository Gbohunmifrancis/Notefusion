// node --test web-site/tests/*.test.mjs
// practice-moments.js chooses the reward moments a marked take earns; moment-art.js draws them (played by moments.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/practice-moments.js", import.meta.url), "utf8"), { window });
const M = window.NfPracticeMoments;
const plain = (value) => JSON.parse(JSON.stringify(value));

const reward = (over = {}) => ({ xpGained: 15, xp: 115, levelUp: false, level: {}, streak: 4, newBadges: [], ...over });
const hits = (n, then = []) => [...Array.from({ length: n }, (_, i) => ({ index: i, status: "hit" })), ...then.map((status, i) => ({ index: n + i, status }))];
const grade = (over = {}) => ({ score: 70, notes: hits(2, ["near", "hit"]), reward: reward(), milestone: null, ...over });
const before = (over = {}) => ({
  streak: { current: 3, best: 3, todayDone: true, atRisk: false, freezeAvailable: true, frozenYesterday: false },
  weeklyGoal: { daysDone: 2, target: 5, weekStart: "2026-10-26" },
  ...over,
});
const pieces = (list) => plain(list).map((m) => m.piece);

test("Playful's stars come first, as many as the mark gives; Focused has none", () => {
  assert.deepEqual(plain(M.momentsFor("playful", before(), grade({ score: 85 })))[0], { piece: "stars", values: { stars: 3 } });
  assert.deepEqual(plain(M.momentsFor("playful", before(), grade({ score: 55 })))[0].values, { stars: 2 });
  assert.deepEqual(plain(M.momentsFor("playful", before(), grade({ score: 10 })))[0].values, { stars: 1 });
  assert.deepEqual(pieces(M.momentsFor("focused", before(), grade())), []);
  assert.deepEqual(pieces(M.momentsFor("playful", before(), null)), []);
});

test("one big moment at most, the biggest: a finished unit or grade, then the week's goal, then the day's streak", () => {
  const firstToday = before({ streak: { ...before().streak, todayDone: false } });
  const unit = { kind: "unit", title: "Unit 2 of Grade 1 complete" };
  assert.deepEqual(plain(M.momentsFor("focused", firstToday, grade({ milestone: unit }))), [{ piece: "musicbox", values: { label: "Unit done!" } }]);
  assert.equal(plain(M.momentsFor("focused", before(), grade({ milestone: { ...unit, kind: "grade" } })))[0].values.label, "Grade done!");
  // The day's first take that meets the week's goal: the ring, closing on today.
  const lastDay = before({ streak: firstToday.streak, weeklyGoal: { daysDone: 4, target: 5 } });
  assert.deepEqual(plain(M.momentsFor("focused", lastDay, grade())), [{ piece: "goal", values: { done: 5, target: 5 } }]);
  // Otherwise the day's first take extends the streak, to the count the server gave.
  assert.deepEqual(plain(M.momentsFor("focused", firstToday, grade())), [{ piece: "streak", values: { days: 4 } }]);
  // A goal already met this week is not met again.
  const metAlready = before({ streak: firstToday.streak, weeklyGoal: { daysDone: 5, target: 5 } });
  assert.deepEqual(pieces(M.momentsFor("focused", metAlready, grade())), ["streak"]);
  // A level or a badge is the 3D piece's moment: nothing else beside it, Playful's stars aside.
  assert.deepEqual(pieces(M.momentsFor("playful", firstToday, grade({ reward: reward({ levelUp: true }), milestone: unit }))), ["stars"]);
  assert.deepEqual(pieces(M.momentsFor("focused", firstToday, grade({ reward: reward({ newBadges: [{ code: "drills_10" }] }) }))), []);
});

test("a run of five in tune is a combo, perfect when it is the whole take; Doh cheers Playful's three stars", () => {
  assert.equal(M.longestRun(hits(3, ["near", "hit", "hit", "wrong", "missed"])), 3);
  assert.equal(M.longestRun([]), 0);
  assert.deepEqual(plain(M.momentsFor("focused", before(), grade({ notes: hits(6, ["near"]) })))[0], { piece: "combo", values: { run: 6, perfect: 0 } });
  assert.deepEqual(plain(M.momentsFor("focused", before(), grade({ notes: hits(8) })))[0].values, { run: 8, perfect: 1 });
  assert.deepEqual(pieces(M.momentsFor("focused", before(), grade({ notes: hits(4, ["near"]) }))), []);
  assert.deepEqual(pieces(M.momentsFor("playful", before(), grade({ score: 90 }))), ["stars", "doh"]);
  assert.deepEqual(pieces(M.momentsFor("playful", before(), grade({ score: 90, notes: hits(5) }))), ["stars", "combo"]);
  assert.deepEqual(pieces(M.momentsFor("focused", before(), grade({ score: 90 }))), []);
  assert.deepEqual(pieces(M.momentsFor("playful", before(), grade({ score: 60 }))), ["stars"]);
});

test("play-along's end: stars from the share right first time, a perfect run of five or more", () => {
  assert.deepEqual(plain(M.alongMoments({ played: 32, firstTime: 31, total: 32 })), [{ piece: "stars", values: { stars: 3 } }]);
  assert.deepEqual(plain(M.alongMoments({ played: 10, firstTime: 7, total: 10 }))[0].values, { stars: 2 });
  assert.deepEqual(plain(M.alongMoments({ played: 10, firstTime: 3, total: 10 }))[0].values, { stars: 1 });
  assert.deepEqual(pieces(M.alongMoments({ played: 8, firstTime: 8, total: 8 })), ["stars", "combo"]);
  assert.deepEqual(pieces(M.alongMoments({ played: 4, firstTime: 4, total: 4 })), ["stars"]);
  assert.deepEqual(plain(M.alongMoments(null)), []);
});

// A canvas that keeps what it is asked to do and fails on anything drawn at a number that is not one.
function recorder() {
  const calls = [];
  const gradient = { addColorStop: (at, color) => { assert.ok(at >= 0 && at <= 1 && !/NaN/.test(color), `stop ${at} ${color}`); } };
  const ctx = new Proxy({ globalAlpha: 1 }, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === "createLinearGradient" || name === "createRadialGradient") return (...args) => { args.forEach((a) => assert.ok(Number.isFinite(a), name)); return gradient; };
      return (...args) => {
        args.forEach((a) => { if (typeof a === "number") assert.ok(Number.isFinite(a), `${String(name)}(${args.join(", ")})`); });
        if (name === "arc" || name === "ellipse") assert.ok(args[2] >= 0, `${String(name)} radius ${args[2]}`);
        calls.push(name);
      };
    },
    set(target, name, value) {
      if (typeof value === "number") assert.ok(Number.isFinite(value), `${String(name)} = ${value}`);
      if (typeof value === "string" && /Style$/.test(name)) assert.doesNotMatch(value, /NaN|undefined/, `${String(name)} = ${value}`);
      target[name] = value;
      return true;
    },
  });
  return { ctx, calls };
}

test("every moment draws its whole run at any values it is handed, without a number that is not one", () => {
  const art = {};
  vm.runInNewContext(readFileSync(new URL("../assets/moment-art.js", import.meta.url), "utf8"), { window: art, Math, Promise });
  const P = art.NfMomentArt.PIECES;
  assert.deepEqual(Object.keys(P).sort(), ["combo", "doh", "goal", "musicbox", "stars", "streak"]);
  const cases = {
    stars: [{ stars: 1 }, { stars: 2 }, { stars: 3 }, {}],
    streak: [{ days: 1 }, { days: 2 }, { days: 365 }, {}],
    goal: [{ done: 5, target: 5 }, { done: 1, target: 1 }, { done: 2, target: 5 }, { done: 9, target: 3 }, {}],
    combo: [{ run: 5, perfect: 0 }, { run: 8, perfect: 1 }, { run: 32, perfect: 1 }, { run: 1 }, {}],
    musicbox: [{ label: "Unit done!" }, { label: "Grade done!" }, {}],
    doh: [{}],
  };
  for (const [name, piece] of Object.entries(P)) {
    assert.ok(piece.width > 0 && piece.height > 0 && piece.ms >= 2500 && piece.ms <= 4500, name);
    for (const values of cases[name]) {
      const { ctx, calls } = recorder();
      for (let t = 0; t <= piece.ms / 1000; t += 1 / 30) piece.draw(ctx, t, values);
      assert.ok(calls.filter((c) => c === "fill").length > 100, name);
      assert.equal(calls.filter((c) => c === "save").length, calls.filter((c) => c === "restore").length, `${name} saves and restores alike`);
    }
  }
});

test("the moments say what the page handed them: the streak's day, the run, the week's count, what was finished", () => {
  const art = {};
  vm.runInNewContext(readFileSync(new URL("../assets/moment-art.js", import.meta.url), "utf8"), { window: art, Math, Promise });
  const P = art.NfMomentArt.PIECES;
  const said = (name, values, t) => {
    const out = [];
    const { ctx } = recorder();
    const real = new Proxy(ctx, { get: (target, key) => (key === "fillText" ? (text) => out.push(text) : target[key]) });
    P[name].draw(real, t, values);
    return out;
  };
  assert.deepEqual(said("streak", { days: 12 }, 2.5), ["12", "day streak"]);
  assert.deepEqual(said("streak", { days: 1 }, 2.5), ["1", "day streak begun"]);
  assert.ok(said("combo", { run: 7, perfect: 0 }, 3).includes("×7"));
  assert.ok(said("combo", { run: 7, perfect: 0 }, 3).includes("On a roll!"));
  assert.ok(said("combo", { run: 6, perfect: 1 }, 3).includes("Perfect run!"));
  assert.deepEqual(said("goal", { done: 3, target: 5 }, 2.5), ["3", "of 5 days", "This week"]);
  assert.ok(said("goal", { done: 5, target: 5 }, 2.5).includes("Week goal met!"));
  assert.ok(said("musicbox", { label: "Grade done!" }, 3).includes("Grade done!"));
});
