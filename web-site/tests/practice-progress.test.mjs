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
  // A lapsed streak keeps its best (mirrors mobile lib/practiceProgress.test.ts).
  assert.equal(P.streakLabel(0, 30), "No streak now");
  assert.equal(P.bestStreakLine({ current: 0, best: 30 }), "Your best: 30 days");
  assert.equal(P.bestStreakLine({ current: 0, best: 1 }), "Your best: 1 day");
  assert.equal(P.bestStreakLine({ current: 3, best: 30 }), null);
  assert.equal(P.streakLine({ current: 0, best: 12, todayDone: false, atRisk: false }), "Your best: 12 days. Start a new one today.");
  assert.equal(P.streakLine({ current: 0, best: 0, todayDone: false, atRisk: false }), "Sing a drill to start one");
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

// ── The Christmas carols path: the same cases as mobile/src/lib/season.test.ts ──
const step = (index, title, carol, cue, detail, passed, bestScore = null) => ({ index, id: `carol-${index}@60`, title, carol, hymnSlug: "x", cue, detail, passed, bestScore });
const STEPS = (n) => [
  step(1, "Gloria warm-up", "Angels We Have Heard on High", "the Gloria warm-up", "one breath", n >= 1, n >= 1 ? 92 : null),
  step(2, "All the way down", "Joy to the World", "Joy to the World, all the way down", "d' t l s f m r d", n >= 2, n >= 2 ? 84 : null),
  step(3, "Sing in thirds", "Silent Night", "Silent Night, in thirds", "Doh is Bb · 4 notes", n >= 3),
  step(4, "Sing along", "Silent Night", "Silent Night, sing along", "the first verse, with the words", n >= 4),
  step(5, "Leap up to doh", "Hark! The Herald Angels Sing", "Hark! The Herald Angels Sing, leap up to doh", "s, d d t, d", n >= 5),
  step(6, "Step up to soh", "The First Noel", "The First Noel, step up to soh", "m r d r m f s", n >= 6),
];
const season = (n) => {
  const steps = STEPS(n);
  return { season: "christmas", title: "Carols for Christmas", until: "2027-01-06", sung: n, total: 6, next: steps.find((s) => !s.passed) ?? null, steps, badgeCode: "carol_singer" };
};

test("the carols card: until when, six segments, how many sung and what is next", () => {
  const c = P.carolsCard(season(2));
  assert.equal(c.eyebrow, "Christmas · Until 6 January");
  same(c.segments, [true, true, false, false, false, false]);
  assert.equal(c.sung, "2 of 6 sung");
  assert.equal(c.next, "Next: Silent Night, in thirds");
  assert.equal(c.action, "Continue");
  assert.equal(P.carolsCard(season(0)).action, "Start");
  assert.equal(P.carolsCard(season(6)).action, "Sing again");
  assert.equal(P.carolsCard(season(6)).next, "All sung. The Carol singer sticker is yours.");
  assert.equal(P.carolsCard({ ...season(1), until: null }).eyebrow, "Christmas");
  assert.equal(P.untilLabel("2026-12-31"), "Until 31 December");
  assert.equal(P.untilLabel("6 Jan"), null);
});

test("the carols path: the next drill open, the sung ones done, any one chosen again", () => {
  const v = P.carolsView(season(2), null);
  assert.equal(v.eyebrow, "Christmas · 2 of 6");
  assert.equal(v.open, 3);
  same(v.rows.map((r) => r.state), ["done", "done", "open", "todo", "todo", "todo"]);
  assert.equal(v.rows[0].line, "Angels We Have Heard on High · one breath");
  same(P.carolsView(season(2), 1).rows.map((r) => r.state), ["open", "done", "todo", "todo", "todo", "todo"]);
  assert.equal(P.carolsView(season(2), 9).open, 3);
  assert.equal(P.carolsView(season(6), null).allSung, true);
  assert.equal(P.carolsView(season(6), null).open, 6);
});

test("Doh's word over the path, the sticker by its code, and the Carol singer's line", () => {
  assert.equal(P.carolsBuddyLine(season(2)), "Joyful! Now sing under the tune, like the altos do.");
  assert.equal(P.carolsBuddyLine(season(5)), "Last one: step up to soh with The First Noel.");
  assert.equal(P.carolsBuddyLine(season(6)), "You sang all six carols. Merry Christmas!");
  assert.equal(P.earnedCarolSinger([{ code: "streak_3" }, { code: "carol_singer" }]), true);
  assert.equal(P.earnedCarolSinger([{ code: "streak_3" }]), false);
  assert.equal(P.earnedCarolSinger(null), false);
  assert.equal(P.solfaLine(P.JOY_LINE), "d' t l s f m r d");
  same(P.JOY_LINE.map((n) => n.pitchMidi), [86, 85, 83, 81, 79, 78, 76, 74]);
});

// ── The Halloween Midnight path: the same cases as mobile/src/lib/season.test.ts ──
const mstep = (index, code, title, carol, cue, detail, passed) => ({ index, id: `${code}@62`, title, carol, hymnSlug: "x", cue, detail, passed, bestScore: passed ? 90 : null });
const MIDNIGHT = (n) => [
  mstep(1, "midnight-king", "Mountain King run", "In the Hall of the Mountain King", "the Mountain King's tiptoe", "l, t, d r m d m", n >= 1),
  mstep(2, "midnight-toccata", "Toccata turn", "Toccata in D minor", "Bach's organ turn", "m r m r d t, l, se, l,", n >= 2),
  mstep(3, "midnight-climb", "The climb", "In the Hall of the Mountain King", "the Mountain King's climb", "m fe se l t se t", n >= 3),
  mstep(4, "midnight-waltz", "Skeleton waltz", "Danse Macabre", "the skeletons' waltz", "l l s s sa sa f f m", n >= 4),
  mstep(5, "midnight-march", "Marionette march", "Funeral March of a Marionette", "the Marionette's fall", "s t l se f m r d t,", n >= 5),
  mstep(6, "midnight-saints", "All Saints line", "All Saints (Darmstadt)", "All Saints, from the top doh down", "d' s l l s f m d", n >= 6),
];
const midnight = (n) => {
  const steps = MIDNIGHT(n);
  return { season: "halloween", title: "The Midnight path", until: "2026-11-01", sung: n, total: 6, next: steps.find((s) => !s.passed) ?? null, steps, badgeCode: "night_singer" };
};

test("the hub's pumpkin card: Halloween until 1 November, the first drill named as the first, then the next", () => {
  const first = P.seasonCard(midnight(0));
  assert.equal(first.season, "halloween");
  assert.equal(first.eyebrow, "Halloween · Until 1 November");
  assert.equal(first.title, "The Midnight path");
  assert.equal(first.body, "Six short drills from spooky songs: the Mountain King's tiptoe, Bach's organ turn, the skeletons' waltz, and All Saints to finish.");
  assert.equal(first.sung, "0 of 6 sung");
  assert.equal(first.next, "First: the Mountain King's tiptoe");
  assert.equal(first.action, "Start");
  assert.equal(P.seasonCard(midnight(2)).next, "Next: the Mountain King's climb");
  assert.equal(P.seasonCard(midnight(2)).action, "Continue");
  assert.equal(P.seasonCard(midnight(6)).next, "All sung. The Night Singer sticker is yours.");
  // The carols' card is as it was.
  assert.equal(P.seasonCard(season(0)).next, "Next: the Gloria warm-up");
  assert.equal(P.seasonCard(season(0)).season, "christmas");
});

test("the Midnight path: Halloween · n of 6, Doh's word by the next song, the Night Singer told by its code", () => {
  const v = P.seasonView(midnight(1));
  assert.equal(v.season, "halloween");
  assert.equal(v.eyebrow, "Halloween · 1 of 6");
  assert.equal(v.open, 2);
  assert.equal(v.rows[0].line, "In the Hall of the Mountain King · l, t, d r m d m");
  assert.equal(P.seasonBuddyLine(midnight(1)), "A perfect tiptoe! Now the organ's turn: m r m, quick as a wink.");
  assert.equal(P.seasonBuddyLine(midnight(0)), "Shh, tiptoe with me: the Mountain King's run, soft and short.");
  assert.equal(P.seasonBuddyLine(midnight(5)), "Last one, for All Saints' Day: sing it from the top doh down.");
  assert.equal(P.seasonBuddyLine(midnight(6)), "You sang all six on the Midnight path. Happy Halloween!");
  // a drill this build has no line for still gets one, by its cue
  const other = midnight(0);
  other.next = { ...other.next, id: "midnight-unknown@62", cue: "the open fifth" };
  assert.equal(P.seasonBuddyLine(other), "Next: the open fifth. Boo and I are listening!");
  assert.equal(P.earnedSeasonBadge([{ code: "night_singer" }], "night_singer"), true);
  assert.equal(P.earnedSeasonBadge([{ code: "carol_singer" }], "night_singer"), false);
});

test("each season's path has its own address and words", () => {
  assert.equal(P.seasonPathUrl("christmas"), "/api/practice/carols");
  assert.equal(P.seasonPathUrl("halloween"), "/api/practice/seasons/halloween");
  assert.equal(P.seasonOf("something-new"), "christmas");
  const w = P.seasonWords("halloween");
  assert.equal(w.pathTitle, "The Midnight path");
  assert.equal(w.sticker, "Night Singer");
  assert.equal(w.stickerBody, "You sang all six on the Midnight path. This sticker stays in your book after Halloween.");
  assert.equal(w.away, "The Midnight path is back next Halloween.");
  assert.equal(P.seasonWords("christmas").sticker, "Carol singer");
});

test("the Mountain King's tiptoe: l, t, d r m d m an octave up, quavers and a crotchet, each note short of its length", () => {
  assert.equal(P.solfaLine(P.KING_OPENING), "l, t, d r m d m");
  same(P.KING_OPENING.map((n) => n.pitchMidi), [71, 73, 74, 76, 78, 74, 78]);
  same(P.KING_OPENING.map((n) => n.startBeat), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  const last = P.KING_OPENING[P.KING_OPENING.length - 1];
  assert.equal(((last.startBeat + 1) * 60) / P.KING_BPM, 1.6);
  for (let i = 0; i + 1 < P.KING_OPENING.length; i++) {
    assert.ok(P.KING_OPENING[i].durBeats < P.KING_OPENING[i + 1].startBeat - P.KING_OPENING[i].startBeat, `note ${i} is detached`);
  }
});

/** The published Mountain King's first bars as the pack would hold them (B minor, from B3), labelled. */
function kingFromPack() {
  const steps = [
    [59, 0.5, "l", ","], [61, 0.5, "t", ","], [62, 0.5, "d", ""], [64, 0.5, "r", ""], [66, 0.5, "m", ""], [62, 0.5, "d", ""], [66, 1, "m", ""],
    [65, 0.5, "ma", ""], [61, 0.5, "t", ","], [65, 1, "ma", ""],
    [64, 0.5, "r", ""], [60, 0.5, "ta", ","], [64, 1, "r", ""],
    [59, 0.5, "l", ","], [61, 0.5, "t", ","],
  ];
  let at = 4;
  return steps.map(([pitchMidi, beats, solfa, octaveMark]) => {
    const n = { pitchMidi, startBeat: at, durBeats: beats, degree: 0, solfa, octaveMark, conf: 1 };
    at += beats;
    return n;
  });
}

test("the Night Singer's phrase: the pack's first phrase from its first note, where the chime sits, else the opening", () => {
  const phrase = P.kingPhrase(kingFromPack());
  assert.equal(phrase.length, P.KING_PHRASE_NOTES);
  assert.equal(P.phraseLine(phrase), "l, t, d r m d m · ma t, ma · r ta, r");
  assert.equal(P.stickerLine("halloween", phrase), "l, t, d r m d m · ma t, ma · r ta, r");
  // moved up an octave to start on B4 as the opening does, from beat 0, and played detached
  assert.equal(phrase[0].pitchMidi, 71);
  assert.equal(phrase[0].startBeat, 0);
  assert.ok(phrase.every((n) => n.durBeats <= 0.6 + 1e-9));
  const end = phrase[phrase.length - 1].startBeat + 1;
  assert.ok(Math.abs((end * 60) / P.KING_BPM - 3.2) < 1e-9);
  // no pack, or too short a tune: the opening
  same(P.kingPhrase(null), P.KING_OPENING);
  assert.equal(P.solfaLine(P.kingPhrase(kingFromPack().slice(0, 4))), "l, t, d r m d m");
  // Christmas's sticker line prints as it always did
  assert.equal(P.stickerLine("christmas", P.JOY_LINE), "d' t l s f m r d");
  // The pack's tune is found by its title, the engine labels it as the phone does
  assert.equal(P.mountainKing([{ title: "Abends" }, { title: "In the Hall of the Mountain King" }]).title, "In the Hall of the Mountain King");
  assert.equal(P.mountainKing([{ title: "Abends" }]), null);
  assert.equal(P.mountainKing(null), null);
});

test("the pack's notes, labelled by the web's solfa engine (choir.js), give the sticker's line", () => {
  const ctx = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL("../assets/choir.js", import.meta.url), "utf8"), ctx);
  const label = ctx.window.NfChoir.label;
  const raw = kingFromPack().map((n) => ({ pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats }));
  assert.equal(P.phraseLine(P.kingPhrase(label(raw, "B minor"))), "l, t, d r m d m · ma t, ma · r ta, r");
});
