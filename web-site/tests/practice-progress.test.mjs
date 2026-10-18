// node --test web-site/tests/*.test.mjs
// practice-progress.js is the Practice view's arithmetic and wording: the XP bar, the weekly ring, the seven day
// dots, what a reward says, the drill's count-in and how long a take runs. The mobile copy
// (mobile/src/lib/practiceProgress.test.ts, lib/take.ts) has the same cases where they overlap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
// practice.js first, as the app page loads it: the count-in's plan (leadInPlan) is its.
const context = vm.createContext({ window });
vm.runInContext(readFileSync(new URL("../assets/practice.js", import.meta.url), "utf8"), context);
vm.runInContext(readFileSync(new URL("../assets/practice-progress.js", import.meta.url), "utf8"), context);
const P = window.NfPracticeProgress;
// Objects made in the vm context have its Object prototype: compare them as plain data.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

const ray = { index: 1, name: "Ray", minXp: 100, nextLevelXp: 250, nextName: "Me", xpForNext: 100 };
const top = { index: 7, name: "Choir-ready", minXp: 3000, nextLevelXp: null, nextName: null, xpForNext: 0 };
const reward = (over = {}) => ({ xpGained: 15, xp: 115, levelUp: false, level: ray, streak: 1, newBadges: [], ...over });
const badge = (code, earned, progress, target, earnedAtUtc = null) => ({ code, title: code, description: "", earned, earnedAtUtc, progress, target });
const streak = (over) => ({ current: 0, best: 0, todayDone: false, atRisk: false, freezeAvailable: true, frozenYesterday: false, ...over });
const note = (pitchMidi, startBeat, durBeats) => ({ pitchMidi, startBeat, durBeats, solfa: "d", octaveMark: "" });
// The server's drill: d r m f s in Eb at 80 BPM, each a beat and the last held for two, 8 beats of count-in.
const drill = {
  tempoBpm: 80, timeSignature: "4/4", leadInBeats: 8, maxTakeSeconds: 14.5,
  notes: [note(63, 0, 1), note(65, 1, 1), note(67, 2, 1), note(68, 3, 1), note(70, 4, 2)],
};

test("the XP bar fills through the level and is full at the top", () => {
  assert.equal(P.levelFraction(ray, 100), 0);
  assert.equal(P.levelFraction(ray, 175), 0.5);
  assert.equal(P.levelFraction(ray, 999), 1);
  assert.equal(P.levelFraction(ray, 50), 0);
  assert.equal(P.levelFraction(top, 3500), 1);
  assert.equal(P.nextLevelLine(ray), "100 XP to Me");
  assert.equal(P.nextLevelLine(top), "Top of the ladder");
});

test("the weekly ring is days over the goal, held to 0–1", () => {
  assert.equal(P.weeklyFraction({ daysDone: 2, target: 5, weekStart: "2026-10-12" }), 0.4);
  assert.equal(P.weeklyFraction({ daysDone: 7, target: 5, weekStart: "2026-10-12" }), 1);
  assert.equal(P.weeklyFraction({ daysDone: 1, target: 0, weekStart: "2026-10-12" }), 0);
});

test("a level-up beats a badge beats XP, and nothing earned is no toast", () => {
  same(P.rewardMoment(reward({ levelUp: true, newBadges: [badge("a", true, 1, 1)] })), { line: "Level up — you're now Ray!", big: true });
  same(P.rewardMoment(reward({ newBadges: [{ ...badge("streak_3", true, 3, 3), title: "Three in a row" }] })), { line: "Badge earned: Three in a row", big: true });
  same(P.rewardMoment(reward({ streak: 4 })), { line: "+15 XP · 4-day streak", big: false });
  same(P.rewardMoment(reward()), { line: "+15 XP", big: false });
  assert.equal(P.rewardMoment(reward({ xpGained: 0 })), null);
  assert.equal(P.rewardMoment(null), null);
});

test("a reward is logged as a level-up and one event per badge", () => {
  same(P.rewardEvents(reward({ levelUp: true, newBadges: [badge("first_drill", true, 1, 1), badge("first_100", true, 1, 1)] })), [
    { name: "level_up", detail: "level=Ray;index=1" },
    { name: "badge_earned", detail: "badge=first_drill" },
    { name: "badge_earned", detail: "badge=first_100" },
  ]);
  same(P.rewardEvents(reward()), []);
  same(P.rewardEvents(null), []);
});

test("earned badges come first, newest first, then the nearest locked ones", () => {
  const sorted = P.sortBadges([
    badge("far", false, 1, 30),
    badge("old", true, 1, 1, "2026-10-01T10:00:00Z"),
    badge("near", false, 8, 10),
    badge("new", true, 1, 1, "2026-10-15T10:00:00Z"),
  ]);
  same(sorted.map((b) => b.code), ["new", "old", "near", "far"]);
  assert.equal(P.badgeFraction(badge("x", false, 6, 7)), 6 / 7);
  assert.equal(P.badgeFraction(badge("x", false, 0, 0)), 0);
  assert.equal(P.badgeFraction(badge("x", true, 1, 1)), 1);
});

test("the streak card says done, at risk, or how to start, and whether the freeze is left", () => {
  assert.equal(P.streakLabel(4), "4-day streak");
  assert.equal(P.streakLabel(0), "No streak yet");
  assert.equal(P.streakLine(streak({ current: 6, todayDone: true })), "Done for today");
  assert.equal(P.streakLine(streak({ current: 6, atRisk: true })), "Sing today to keep it");
  assert.equal(P.streakLine(streak({})), "Sing a drill to start one");
  assert.equal(P.freezeLine(streak({ freezeAvailable: true })), "Streak freeze ready this week");
  assert.equal(P.freezeLine(streak({ freezeAvailable: false })), "Freeze used this week");
});

test("the seven days are dots with their weekday letter, by the calendar alone", () => {
  assert.equal(P.weekdayLetter("2026-10-17"), "S"); // a Saturday
  assert.equal(P.weekdayLetter("2026-10-12"), "M");
  same(P.dayDots([
    { date: "2026-10-12", status: "done", xp: 15 },
    { date: "2026-10-13", status: "frozen", xp: 0 },
    { date: "2026-10-14", status: "missed", xp: 0 },
    { date: "2026-10-17", status: "today", xp: 0 },
    { date: "2026-10-18", status: "something new", xp: 0 },
  ]), [
    { date: "2026-10-12", status: "done", letter: "M", label: "Monday: practised" },
    { date: "2026-10-13", status: "frozen", letter: "T", label: "Tuesday: missed, kept by the streak freeze" },
    { date: "2026-10-14", status: "missed", letter: "W", label: "Wednesday: missed" },
    { date: "2026-10-17", status: "today", letter: "S", label: "Saturday: today, not practised yet" },
    { date: "2026-10-18", status: "none", letter: "S", label: "Sunday: before your first practice" },
  ]);
  same(P.dayDots(null), []);
});

test("the allowance line counts down and says when the day's drills are done", () => {
  assert.equal(P.allowanceLine({ used: 1, limit: 5 }), "4 of 5 marked drills left today");
  assert.equal(P.allowanceLine({ used: 5, limit: 5 }), "That's all 5 of today's drills. Well sung! More tomorrow.");
  assert.equal(P.allowanceLine({ used: 7, limit: 5 }), "That's all 5 of today's drills. Well sung! More tomorrow.");
  assert.equal(P.allowanceLine(null), "");
  assert.equal(P.drillsLeft({ used: 3, limit: 20 }), 17);
});

test("the count-in is practice.js's five-second plan with the first note to hold, whatever leadInBeats says", () => {
  // 80 BPM: two beats of the note and a bar of clicks, 4.5 s — not the drill's eight beats (older apps' two bars).
  same(P.leadIn(drill), { beats: 6, holdBeats: 2, beatsPerBar: 4, pitchMidi: 63, beatSec: 0.75, seconds: 4.5 });
  same(P.leadIn({ ...drill, leadInBeats: undefined, timeSignature: "3/4", tempoBpm: 60 }), { beats: 5, holdBeats: 2, beatsPerBar: 3, pitchMidi: 63, beatSec: 1, seconds: 5 });
  same(P.leadIn({ ...drill, tempoBpm: 60 }), { beats: 5, holdBeats: 1, beatsPerBar: 4, pitchMidi: 63, beatSec: 1, seconds: 5 });
});

test("a take stops a second after the last note, never past what the server keeps", () => {
  assert.equal(P.partSeconds(drill.notes, drill.tempoBpm), 4.5);
  assert.equal(P.takeSeconds(drill), 4.5 + 4.5 + 1);
  assert.equal(P.takeSeconds({ ...drill, maxTakeSeconds: 8 }), 8);
});

test("the note due follows the beat after the count-in", () => {
  assert.equal(P.noteDueAt(drill.notes, 80, 6, 3), -1); // counting in
  assert.equal(P.noteDueAt(drill.notes, 80, 6, 6.1), 0);
  assert.equal(P.noteDueAt(drill.notes, 80, 6, 6 + 0.75 * 2.5), 2);
  assert.equal(P.noteDueAt(drill.notes, 80, 6, 6 + 0.75 * 5.5), 4); // the held last note
  assert.equal(P.noteDueAt(drill.notes, 80, 6, 6 + 0.75 * 6.1), -1);
});

test("failures read as plain sentences", () => {
  const limit = P.gradeError({ status: 403, code: "PRACTICE_DAILY_LIMIT", message: "That's your 5 marked drills for today. Well sung! Come back tomorrow for more." });
  assert.equal(limit, "That's your 5 marked drills for today. Well sung! Come back tomorrow for more.");
  assert.match(P.gradeError({ status: 429, code: "UNKNOWN" }), /Wait a minute/);
  assert.match(P.gradeError({ status: 0, code: "UNKNOWN" }), /connection/);
  assert.match(P.gradeError(new Error("boom")), /connection/);
  assert.match(P.gradeError({ status: 503, code: "TRANSCRIPTION_UNAVAILABLE", message: "x" }), /in a moment/);
  assert.equal(P.gradeError({ status: 400, code: "PRACTICE_DRILL_UNKNOWN", message: "That drill isn't available any more." }), "That drill isn't available any more.");
  assert.match(P.micError({ name: "NotAllowedError" }), /Allow it for this site/);
  assert.match(P.micError({ name: "NotFoundError" }), /No microphone/);
  assert.match(P.micError({ name: "NotReadableError" }), /Another app/);
  assert.match(P.micError({ name: "Unsupported" }), /can't record/);
  assert.match(P.micError({ name: "NotSupportedError" }), /can't record/);
  assert.match(P.micError(null), /couldn't open the microphone/);
});

// ── The practice path (mobile practiceProgress.test.ts has the same cases) ──
const place = (over = {}) => ({ grade: "Grade 2", unitIndex: 3, drillIndex: 4, drillCount: 6, adjustment: "steady", ...over });

test("the path line names the grade, the unit and the drill, and says when the last take moved it", () => {
  assert.equal(P.pathLine(place()), "Grade 2 · Unit 3 · 4 of 6");
  assert.equal(P.pathLine(place({ adjustment: "easier" })), "Grade 2 · Unit 3 · 4 of 6 · Easier");
  assert.equal(P.pathLine(place({ adjustment: "harder", grade: "Advanced 1" })), "Advanced 1 · Unit 3 · 4 of 6 · Harder");
  assert.equal(P.pathLine(place({ grade: "" })), null);
  assert.equal(P.pathLine({ id: "steps-up@60" }), null); // an older server's drill: no line
});

test("the unit bar fills with the drills behind the singer", () => {
  assert.equal(P.unitFraction(place({ drillIndex: 1, drillCount: 4 })), 0);
  assert.equal(P.unitFraction(place({ drillIndex: 3, drillCount: 4 })), 0.5);
  assert.equal(P.unitFraction(place({ drillIndex: 9, drillCount: 4 })), 1);
  assert.equal(P.unitFraction(place({ drillCount: 0 })), 0);
});

test("the main button moves on, or says try again when the path brings the same drill back", () => {
  same(P.nextAction({ id: "a@60" }, { id: "b@62" }, null), { label: "Next drill", same: false });
  same(P.nextAction({ id: "a@60" }, { id: "a@60" }, "focused"), { label: "Try it again", same: true });
  same(P.nextAction({ id: "a@60" }, null, "playful"), { label: "Next one!", same: false });
  same(P.nextAction({ id: "a@60~gentle" }, { id: "a@60~gentle" }, "playful"), { label: "Try again!", same: true });
});

test("the allowance counts down, then says warmly when more come, on the device's clock", () => {
  const lagosMidnight = "2026-10-17T23:00:00Z";
  assert.equal(P.allowanceLine({ used: 3, limit: 10, resetsAtUtc: lagosMidnight }, -60), "7 of 10 marked drills left today");
  assert.equal(P.allowanceLine({ used: 10, limit: 10, resetsAtUtc: lagosMidnight }, -60), "That's all 10 of today's drills. Well sung! More from midnight.");
  assert.equal(P.resetTime(lagosMidnight, 0), "11:00 pm");
  assert.equal(P.resetTime("2026-10-18T00:30:00Z", 0), "12:30 am");
  assert.equal(P.resetTime("2026-10-18T13:05:00Z", 0), "1:05 pm");
  assert.equal(P.allowanceLine({ used: 12, limit: 10 }), "That's all 10 of today's drills. Well sung! More tomorrow.");
  assert.equal(P.resetTime("not a time"), null);
});
