import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accidentalOf,
  clock,
  comboOf,
  earNotes,
  gameTiles,
  gameTitle,
  keySignature,
  resultLine,
  resultTitle,
  staffStep,
  syllableName,
  verdict,
} from "./practiceGames.ts";
import type { PracticeGameGrade, PracticeGameRound } from "../api/types";

const round = (over: Partial<PracticeGameRound>): PracticeGameRound => ({
  index: 0,
  answer: "s",
  choices: ["d", "r", "m", "f", "s", "l", "t", "d'"],
  doh: "D",
  key: "D major",
  fifths: 2,
  dohMidi: 62,
  noteMidi: 69,
  noteName: null,
  tempoBpm: null,
  timeSignature: null,
  notes: null,
  hymns: null,
  ...over,
});

test("the games are named for the track: Playful races notes", () => {
  assert.deepEqual(gameTiles("focused").map((t) => t.title), ["Which note?", "Staff to solfa", "Name that hymn"]);
  assert.deepEqual(gameTiles("playful").map((t) => t.title), ["Which note?", "Note race", "Name that hymn"]);
  assert.equal(gameTitle("staff", null), "Staff to solfa");
  assert.deepEqual(gameTiles(null).map((t) => t.icon), ["intervals", "staff", "hymns"]);
});

test("a note sits on the treble stave in half-spaces from the bottom line", () => {
  assert.equal(staffStep("E4"), 0);
  assert.equal(staffStep("F#4"), 1);
  assert.equal(staffStep("B4"), 4);
  assert.equal(staffStep("C5"), 5);
  assert.equal(staffStep("F5"), 8);
  assert.equal(staffStep("G5"), 9);
  assert.equal(staffStep("Bb4"), 4);
  assert.equal(staffStep("H4"), null);
  assert.equal(accidentalOf("F#4"), "#");
  assert.equal(accidentalOf("Bb4"), "b");
  assert.equal(accidentalOf("C5"), null);
});

test("the key signature sits where a treble stave prints it", () => {
  assert.deepEqual(keySignature(0), []);
  // F#5 on the top line, then C#5 in the third space, G#5 over the stave.
  assert.deepEqual(keySignature(3), [{ sign: "#", step: 8 }, { sign: "#", step: 5 }, { sign: "#", step: 9 }]);
  // Bb4 on the middle line, Eb5 in the top space, Ab4 in the second space.
  assert.deepEqual(keySignature(-3), [{ sign: "b", step: 4 }, { sign: "b", step: 7 }, { sign: "b", step: 3 }]);
  assert.deepEqual(keySignature(-7).map((k) => k.step), [4, 7, 3, 6, 2, 5, 1]);
});

test("a round's verdict names the note heard, and what a wrong tap was", () => {
  assert.deepEqual(verdict("which-note", round({}), "s"), { right: true, title: "Soh!", line: "The fifth note of the scale." });
  assert.deepEqual(verdict("which-note", round({}), "m"), { right: false, title: "It was soh", line: "You tapped me. Listen to both again." });
  assert.equal(verdict("which-note", round({ answer: "d'" }), "d'").title, "Doh!");

  const staff = round({ answer: "m", noteName: "F#4", doh: "D", dohMidi: null, noteMidi: 66 });
  assert.deepEqual(verdict("staff", staff, "m"), { right: true, title: "Me!", line: "F#4 in D major." });
  assert.equal(verdict("staff", staff, "r").line, "F#4 is me when doh is D.");

  const hymn = round({
    answer: "amazing-grace",
    hymns: [
      { slug: "abide-with-me", title: "Abide with Me", firstLine: null },
      { slug: "amazing-grace", title: "Amazing Grace", firstLine: "Amazing grace! how sweet the sound" },
    ],
  });
  assert.deepEqual(verdict("hymn", hymn, "amazing-grace"), { right: true, title: "That's it!", line: "Amazing Grace" });
  assert.equal(verdict("hymn", hymn, "abide-with-me").line, "It was Amazing Grace.");
  assert.equal(syllableName("t"), "te");
});

test("the combo is the run of right answers at the end", () => {
  assert.equal(comboOf([]), 0);
  assert.equal(comboOf([true, true, false]), 0);
  assert.equal(comboOf([false, true, true, true]), 3);
});

test("which note plays doh, a breath, then the note", () => {
  assert.deepEqual(earNotes(round({})).map((n) => [n.pitchMidi, n.startBeat]), [[62, 0], [69, 1.25]]);
  assert.deepEqual(earNotes(round({ dohMidi: null })), []);
});

test("the race's clock counts down whole seconds", () => {
  assert.equal(clock(60), "1:00");
  assert.equal(clock(36.2), "0:37");
  assert.equal(clock(-3), "0:00");
});

test("the end card says how many were right and what it earned, or why it earned nothing", () => {
  const grade = (over: Partial<PracticeGameGrade>): PracticeGameGrade => ({
    game: "which-note",
    dealId: "which-note:f:00000001",
    score: 80,
    right: 8,
    answered: 10,
    rounds: 10,
    marks: [],
    counted: true,
    notCounted: null,
    reward: { xpGained: 8, xp: 108, levelUp: false, level: { index: 1, name: "Ray", minXp: 100, nextMinXp: 250, nextName: "Me", xpToNext: 142 }, streak: 2, newBadges: [] },
    ...over,
  });
  assert.equal(resultTitle(grade({})), "8 of 10 right");
  assert.equal(resultLine(grade({}), 6), "+8 XP");
  const race = grade({ game: "staff", right: 14, answered: 16, rounds: 40, score: 88 });
  assert.equal(resultTitle(race), "14 right");
  assert.equal(resultLine(race, 6), "88% of the 16 you answered. +8 XP");
  assert.equal(resultLine(grade({ counted: false, notCounted: "daily", reward: null }), 6), "Played for fun: today's 6 games that earn XP are done.");
  assert.equal(
    resultLine(grade({ game: "staff", counted: false, notCounted: "few", reward: null, answered: 3, score: 100 }), 6),
    "100% of the 3 you answered. Answer at least five notes for a race to count.",
  );
});
