// The mirror of web-site/tests/practice-arcade.test.mjs (the path as stops, the unit's banner, the day's quests, the
// arcade's levels and their words, in step with the server's ladder in PracticeGames.cs), then the phone's own few.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as A from "./practiceArcade.ts";
import type { PracticeTrack } from "../api/types";

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** The web's `recall`/`remember` over a store, as the phone does them over AsyncStorage's raw strings. */
function memory() {
  const kept = new Map<string, string>();
  return { getItem: (k: string) => (kept.has(k) ? kept.get(k)! : null), setItem: (k: string, v: string) => void kept.set(k, String(v)) };
}
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
function recall(game: "staff" | "hymn", track: PracticeTrack | null, store: Store) {
  let raw: string | null = null;
  try { raw = store.getItem(A.storageKey(game)); } catch { raw = null; }
  return A.recallFrom(raw, track);
}
function remember(game: "staff" | "hymn", level: number, store: Store) {
  let raw: string | null = null;
  try { raw = store.getItem(A.storageKey(game)); } catch { raw = null; }
  const kept = A.rememberOver(raw, level);
  try { store.setItem(A.storageKey(game), JSON.stringify(kept)); } catch { /* kept for the visit */ }
  return kept;
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
  assert.equal(next[0]!.text, "New: se");
});

test("the words keep in step with the server's ladder", () => {
  const cs = readFileSync(new URL("../../../src/NoteFusion.Application/Practice/Games/PracticeGames.cs", import.meta.url), "utf8");
  const ear = /EarLevels =\s*\[([\s\S]*?)\];/.exec(cs)![1]!;
  const levels = [...ear.matchAll(/\[([^\]]*)\]/g)].map((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  levels.forEach((notes, i) => assert.equal(A.levelNews("which-note", i + 1), (i === 0 ? "Notes: " : "New: ") + notes.join(", ")));
  assert.match(cs, /Math\.Max\(1\.5, 6\.0 - 0\.5 \* \(Math\.Max\(1, level\) - 1\)\)/);
  for (let l = 1; l <= 12; l++) assert.equal(A.staffSeconds(l), Math.max(1.5, 6 - 0.5 * (l - 1)));
  assert.match(cs, /var choices = l switch \{ <= 2 => 3, <= 4 => 4, <= 6 => 5, _ => 6 \};/);
  const scales = /ScaleLevels =\s*\[([\s\S]*?)\];/.exec(cs)![1]!;
  const scaleLevels = [...scales.matchAll(/\[([^\]]*)\]/g)].map((m) => [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  assert.equal(scaleLevels.length, 10);
  assert.equal(A.levelNews("which-scale", 1), "Scales: major and minor");
  assert.equal(A.levelNews("which-scale", 6), "New: Dorian and Mixolydian");
  assert.deepEqual(plain(A.SCALE_LEVELS), scaleLevels);
  assert.match(cs, /var tempo = Math\.Min\(200, 96 \+ 8 \* Math\.Max\(0, l - WhichScaleFullLevel\)\);/);
  assert.equal(A.levelNews("which-scale", 12), "Quicker: 112 beats a minute");
  assert.equal(A.scaleTempo(500), 200);
  assert.equal(A.comingNext("which-scale", 9)[2]!.text, "Every level after: quicker scales");
  // The level-up and level-down marks are the server's.
  assert.match(cs, /LevelUpScore = 80;/);
  assert.match(cs, /LevelDownScore = 50;/);
  assert.equal(A.LEVEL_UP, 80);
  assert.equal(A.LEVEL_DOWN, 50);
});

test("a game's level is kept on the phone, its best never falls, and a new game starts at the track's first", () => {
  const store = memory();
  assert.deepEqual(plain(recall("staff", "playful", store)), { level: 1, best: 1 });
  assert.deepEqual(plain(remember("staff", 5, store)), { level: 5, best: 5 });
  assert.deepEqual(plain(remember("staff", 4, store)), { level: 4, best: 5 });
  assert.deepEqual(plain(recall("staff", "playful", store)), { level: 4, best: 5 });
  assert.deepEqual(plain(recall("hymn", "focused", store)), { level: 3, best: 3 });
  const shut = { getItem(): string | null { throw new Error("no"); }, setItem() { throw new Error("no"); } };
  assert.deepEqual(plain(recall("staff", null, shut)), { level: 3, best: 3 });
  assert.deepEqual(plain(remember("staff", 2, shut)), { level: 2, best: 2 });
  assert.equal(A.storageKey("which-note"), "nf.arcade.which-note");
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
  assert.equal(A.unitBanner({ grade: "Grade 5", unit: "x", unitIndex: 1 })!.tone, "green");
  assert.equal(A.unitBanner({ grade: "Advanced 2", unit: "x", unitIndex: 1 })!.tone, "cyan");
  const m = plain(A.unitBanner({ grade: "Mastery 12", unit: "Two phrases as one", unitIndex: 5, unitCount: 5 }))!;
  assert.deepEqual([m.tone, m.mastery, m.eyebrow], ["pink", true, "MASTERY 12 · UNIT 5 OF 5"]);
  assert.equal(A.unitBanner({ title: "Silent Night" }), null);
});

test("the quests' chip, each quest's bar, and the chest opened by a take", () => {
  const quests = { quests: [{ progress: 2, target: 2, done: true }, { progress: 1, target: 3, done: false }, { progress: 0, target: 1, done: false }], chestOpened: false };
  assert.deepEqual(plain(A.questsChip(quests as never)), { done: 1, total: 3, label: "Quests 1/3", open: false });
  assert.equal(A.questsChip(null), null);
  assert.deepEqual(plain(A.questProgress({ progress: 1, target: 3 })), { fraction: 1 / 3, text: "1/3" });
  assert.deepEqual(plain(A.questProgress({ progress: 5, target: 3 })), { fraction: 1, text: "3/3" });
  assert.equal(A.chestJustOpened({ chestOpened: false }, { chestOpened: true }), true);
  assert.equal(A.chestJustOpened({ chestOpened: true }, { chestOpened: true }), false);
  assert.equal(A.chestJustOpened(null, { chestOpened: false }), false);
});

// ── The phone's own ─────────────────────────────────────────────────────────

test("the kept level reads anything the store holds without breaking, and a level never falls under one", () => {
  assert.deepEqual(plain(A.recallFrom("not json", "playful")), { level: 1, best: 1 });
  assert.deepEqual(plain(A.recallFrom('{"level":0,"best":-2}', "focused")), { level: 3, best: 3 });
  assert.deepEqual(plain(A.recallFrom('{"level":6.7}', null)), { level: 6, best: 6 });
  assert.deepEqual(plain(A.recallFrom('{"level":4,"best":2}', null)), { level: 4, best: 4 });
  assert.deepEqual(plain(A.recallFrom("[1,2]", "playful")), { level: 1, best: 1 });
  assert.deepEqual(plain(A.rememberOver('{"level":9,"best":9}', 3)), { level: 3, best: 9 });
});

test("an older server's one-off deal and grade play as before: no level, no next level", () => {
  assert.equal(A.isArcadeDeal({ level: 4 }), true);
  assert.equal(A.isArcadeDeal({ level: null }), false);
  assert.equal(A.isArcadeDeal({}), false);
  assert.equal(A.isArcadeDeal(null), false);
  assert.equal(A.nextLevelOf({ nextLevel: 5 }), 5);
  assert.equal(A.nextLevelOf({ nextLevel: null }), null);
  assert.equal(A.nextLevelOf({}), null);
  assert.equal(A.nextLevelOf({ nextLevel: 0 }), null);
});

test("between stages: up, down or the same, said plainly", () => {
  assert.equal(A.levelChange(4, 5), "up");
  assert.equal(A.levelChange(4, 3), "down");
  assert.equal(A.levelChange(4, 4), "same");
  assert.equal(A.stageNote(4, 3, 10), "Back to level 3: a little gentler. You'll climb again.");
  assert.equal(A.stageNote(4, 4, 10), "Level 4 again: 8 right in a stage moves you up.");
  assert.equal(A.toLevelUpLine([true, true], 10, 4), "6 more to level 5");
  assert.equal(A.toLevelUpLine(Array(8).fill(true), 10, 4), "Level 5 next!");
  assert.equal(A.tileLevelLine({ level: 4, best: 4 }), "Level 4");
  assert.equal(A.tileLevelLine({ level: 4, best: 6 }), "Level 4 · best 6");
});

test("Doh stands beside START on the side with room, and the chest follows the snake", () => {
  assert.equal(A.dohSide(72), "left");
  assert.equal(A.dohSide(0), "left");
  assert.equal(A.dohSide(-44), "right");
  const stops = A.pathStops({ drillIndex: 6, drillCount: 8 });
  assert.deepEqual(stops.map((s) => s.offset), [0, 44, 72, 44, 0, -44, -72, -44, 0]);
  assert.equal(stops[5]!.kind, "current");
  assert.equal(A.dohSide(stops[5]!.offset), "right");
});

test("the quests card says the chest's XP, and says it opened once all three are done", () => {
  assert.deepEqual(A.chestWords({ chestOpened: false, chestXp: 20 }), { chest: "+20 XP", note: "Do all three today to open the chest." });
  const open = A.chestWords({ chestOpened: true, chestXp: 20 });
  assert.equal(open.chest, "Opened · +20 XP");
  assert.match(open.note, /^Chest opened!/);
});
