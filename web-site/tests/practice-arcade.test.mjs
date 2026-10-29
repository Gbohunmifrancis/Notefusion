// node --test web-site/tests/*.test.mjs
// practice-arcade.js: the path as stops, the unit's banner, the day's quests, and the arcade's levels and their words
// (in step with the server's ladder in PracticeGames.cs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/practice-arcade.js", import.meta.url), "utf8"), { window });
const A = window.NfPracticeArcade;
const plain = (v) => JSON.parse(JSON.stringify(v));

function memory() {
  const kept = new Map();
  return { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)) };
}

test("a stage needs 80% right for the next level, and the bar fills toward that", () => {
  assert.equal(A.stageGoal(8), 7);
  assert.equal(A.stageGoal(10), 8);
  assert.equal(A.stageGoal(6), 5);
  assert.equal(A.toLevelUp([true, false, true], 10), 6);
  assert.equal(A.toLevelUp(Array(9).fill(true), 10), 0);
  assert.equal(A.stageFraction([true, true, true, true], 10), 0.5);
  assert.equal(A.stageFraction(Array(10).fill(true), 10), 1);
  assert.equal(A.runAfter(5, true), 6);
  assert.equal(A.runAfter(5, false), 0);
  assert.equal(A.startLevel("playful"), 1);
  assert.equal(A.startLevel("focused"), 3);
  assert.equal(A.startLevel(null), 3);
});

test("each level says what it brings, and every level after the named ones still brings more", () => {
  assert.equal(A.levelNews("which-note", 1), "Notes: m, s, d'");
  assert.equal(A.levelNews("which-note", 6), "New: fe");
  assert.equal(A.levelNews("which-note", 30), "Every note, played shorter");
  assert.equal(A.levelNews("staff", 2), "New keys: D and B♭");
  assert.equal(A.levelNews("staff", 9), "2 s a note");
  assert.equal(A.levelNews("hymn", 3), "4 hymns to pick from");
  assert.equal(A.levelNews("hymn", 4), "10 notes of each opening");
  const next = plain(A.comingNext("which-note", 7));
  assert.deepEqual(next.map((n) => n.level), [8, 9, null]);
  assert.equal(next[0].text, "New: se");
});

test("the words keep in step with the server's ladder", () => {
  const cs = readFileSync(new URL("../../src/NoteFusion.Application/Practice/Games/PracticeGames.cs", import.meta.url), "utf8");
  const ear = /EarLevels =\s*\[([\s\S]*?)\];/.exec(cs)[1];
  const levels = [...ear.matchAll(/\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  levels.forEach((notes, i) => assert.equal(A.levelNews("which-note", i + 1), (i === 0 ? "Notes: " : "New: ") + notes.join(", ")));
  assert.match(cs, /Math\.Max\(1\.5, 6\.0 - 0\.5 \* \(Math\.Max\(1, level\) - 1\)\)/);
  for (let l = 1; l <= 12; l++) assert.equal(A.staffSeconds(l), Math.max(1.5, 6 - 0.5 * (l - 1)));
  assert.match(cs, /var choices = l switch \{ <= 2 => 3, <= 4 => 4, <= 6 => 5, _ => 6 \};/);
  const scales = /ScaleLevels =\s*\[([\s\S]*?)\];/.exec(cs)[1];
  const scaleLevels = [...scales.matchAll(/\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  assert.equal(scaleLevels.length, 10);
  assert.equal(A.levelNews("which-scale", 1), "Scales: major and minor");
  assert.equal(A.levelNews("which-scale", 6), "New: Dorian and Mixolydian");
  assert.deepEqual(plain(A.SCALE_LEVELS), scaleLevels);
  assert.match(cs, /var tempo = Math\.Min\(200, 96 \+ 8 \* Math\.Max\(0, l - WhichScaleFullLevel\)\);/);
  assert.equal(A.levelNews("which-scale", 12), "Quicker: 112 beats a minute");
  assert.equal(A.scaleTempo(500), 200);
  assert.equal(A.comingNext("which-scale", 9)[2].text, "Every level after: quicker scales");
});

test("a game's level is kept in the browser, its best never falls, and a new game starts at the track's first", () => {
  const store = memory();
  assert.deepEqual(plain(A.recall("staff", "playful", store)), { level: 1, best: 1 });
  assert.deepEqual(plain(A.remember("staff", 5, store)), { level: 5, best: 5 });
  assert.deepEqual(plain(A.remember("staff", 4, store)), { level: 4, best: 5 });
  assert.deepEqual(plain(A.recall("staff", "playful", store)), { level: 4, best: 5 });
  assert.deepEqual(plain(A.recall("hymn", "focused", store)), { level: 3, best: 3 });
  const shut = { getItem() { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  assert.deepEqual(plain(A.recall("staff", null, shut)), { level: 3, best: 3 });
  assert.deepEqual(plain(A.remember("staff", 2, shut)), { level: 2, best: 2 });
});

test("the unit is drawn as stops down a winding path: done, now, locked, then the chest", () => {
  const stops = plain(A.pathStops({ drillIndex: 3, drillCount: 4 }));
  assert.deepEqual(stops.map((s) => s.kind), ["done", "done", "current", "locked", "chest"]);
  assert.deepEqual(stops.map((s) => s.offset), [0, 44, 72, 44, 0]);
  assert.deepEqual(plain(A.pathStops({ drillIndex: 0, drillCount: 4 })), []);
  assert.deepEqual(plain(A.pathStops(null)), []);
});

test("the unit's banner names its grade and unit in its grade's colour, Mastery in its own", () => {
  assert.deepEqual(plain(A.unitBanner({ grade: "Grade 3", unit: "Thirds", unitIndex: 3, unitCount: 5 })),
    { eyebrow: "GRADE 3 · UNIT 3 OF 5", title: "Thirds", tone: "orange", mastery: false });
  assert.equal(A.unitBanner({ grade: "Grade 5", unit: "x", unitIndex: 1 }).tone, "green");
  assert.equal(A.unitBanner({ grade: "Advanced 2", unit: "x", unitIndex: 1 }).tone, "cyan");
  const m = plain(A.unitBanner({ grade: "Mastery 12", unit: "Two phrases as one", unitIndex: 5, unitCount: 5 }));
  assert.deepEqual([m.tone, m.mastery, m.eyebrow], ["pink", true, "MASTERY 12 · UNIT 5 OF 5"]);
  assert.equal(A.unitBanner({ title: "Silent Night" }), null);
});

test("the quests' chip, each quest's bar, and the chest opened by a take", () => {
  const quests = { quests: [{ progress: 2, target: 2, done: true }, { progress: 1, target: 3, done: false }, { progress: 0, target: 1, done: false }], chestOpened: false };
  assert.deepEqual(plain(A.questsChip(quests)), { done: 1, total: 3, label: "Quests 1/3", open: false });
  assert.equal(A.questsChip(null), null);
  assert.deepEqual(plain(A.questProgress({ progress: 1, target: 3 })), { fraction: 1 / 3, text: "1/3" });
  assert.deepEqual(plain(A.questProgress({ progress: 5, target: 3 })), { fraction: 1, text: "3/3" });
  assert.equal(A.chestJustOpened({ chestOpened: false }, { chestOpened: true }), true);
  assert.equal(A.chestJustOpened({ chestOpened: true }, { chestOpened: true }), false);
  assert.equal(A.chestJustOpened(null, { chestOpened: false }), false);
});
