import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JOY_LINE,
  JOY_OPENING,
  NO_SEASON,
  SNOW,
  capOnDoh,
  capOnMark,
  carolsBuddyLine,
  carolsCard,
  carolsView,
  chimeSeconds,
  earnedCarolSinger,
  homeTitle,
  parseSeason,
  seasonFrom,
  seasonKey,
  serializeSeason,
  snowPlan,
  solfaLine,
  splashSeason,
  untilLabel,
} from "./season.ts";
import type { CarolStep, PracticeSeason } from "../api/types";

const ON = { christmas: true };

test("the flag as the phone keeps it: only an answer of true turns the season on, anything else is off", () => {
  assert.deepEqual(seasonFrom({ christmas: true }), ON);
  assert.deepEqual(seasonFrom({ christmas: false }), NO_SEASON);
  assert.deepEqual(seasonFrom({ christmas: "true" }), NO_SEASON);
  assert.deepEqual(seasonFrom(null), NO_SEASON);
  assert.deepEqual(seasonFrom("<html>"), NO_SEASON);
  assert.deepEqual(parseSeason(serializeSeason(ON)), ON);
  assert.deepEqual(parseSeason(serializeSeason(NO_SEASON)), NO_SEASON);
  assert.deepEqual(parseSeason(null), NO_SEASON);
  assert.deepEqual(parseSeason("{not json"), NO_SEASON);
  assert.deepEqual(parseSeason("null"), NO_SEASON);
});

test("a season is named by the year it starts in, so December and early January are one season", () => {
  assert.equal(seasonKey(new Date(2026, 11, 1)), "christmas-2026");
  assert.equal(seasonKey(new Date(2026, 11, 31, 23, 59)), "christmas-2026");
  assert.equal(seasonKey(new Date(2027, 0, 6)), "christmas-2026");
  assert.equal(seasonKey(new Date(2027, 10, 30)), "christmas-2027");
});

test("the splash: as today with the season off; the intro once a season; the cap alone after that", () => {
  const dec = new Date(2026, 11, 12);
  assert.equal(splashSeason(NO_SEASON, null, dec), "none");
  assert.equal(splashSeason(NO_SEASON, "christmas-2026", dec), "none");
  assert.equal(splashSeason(ON, null, dec), "intro");
  assert.equal(splashSeason(ON, "christmas-2026", dec), "capped");
  assert.equal(splashSeason(ON, "christmas-2026", new Date(2027, 0, 3)), "capped");
  // the next December plays it again
  assert.equal(splashSeason(ON, "christmas-2026", new Date(2027, 11, 2)), "intro");
});

test("the chime is Joy to the World: d' t l s on the splash, the whole line for the sticker", () => {
  assert.equal(solfaLine(JOY_OPENING), "d' t l s");
  assert.equal(solfaLine(JOY_LINE), "d' t l s f m r d");
  // a falling D major scale an octave above the carol's own D5, every note a semitone or tone below the last
  assert.deepEqual(JOY_LINE.map((n) => n.pitchMidi), [86, 85, 83, 81, 79, 78, 76, 74]);
  // crotchet, dotted quaver, semiquaver, dotted crotchet at 120: about 1.7 s, and the line under 4 s
  assert.deepEqual(JOY_OPENING.map((n) => n.durBeats), [1, 0.75, 0.25, 1.5]);
  assert.ok(Math.abs(chimeSeconds(JOY_OPENING) - 0.6 - 1.75) < 1e-9);
  assert.ok(chimeSeconds(JOY_LINE) < 4.5);
  for (let i = 1; i < JOY_LINE.length; i++) {
    const a = JOY_LINE[i - 1]!, b = JOY_LINE[i]!;
    assert.equal(b.startBeat, a.startBeat + a.durBeats, `note ${i} follows the one before`);
  }
});

test("snow: about fourteen slow flakes, 2–5 px and 30–60% white, none after 3 s, all gone by 6 s", () => {
  const plan = snowPlan(7, 280);
  assert.equal(plan.length, 14);
  assert.equal(plan.filter((f) => f.glyph).length, 2);
  for (const f of plan) {
    if (!f.glyph) assert.ok(f.size >= SNOW.minSize && f.size <= SNOW.maxSize, `dot ${f.size}`);
    else assert.ok(f.size >= SNOW.glyphMin && f.size <= SNOW.glyphMax, `glyph ${f.size}`);
    assert.ok(f.opacity >= 0.3 && f.opacity <= 0.6, `opacity ${f.opacity}`);
    assert.ok(f.speed >= 40 && f.speed <= 70, `speed ${f.speed}`);
    assert.equal(f.sway, 8);
    assert.ok(f.delay >= 0 && f.delay <= 3, `delay ${f.delay}`);
    assert.ok(f.delay + f.duration <= 6 + 1e-9, "gone by 6 s");
    assert.ok(f.x > 0 && f.x < 1);
    assert.ok(f.y >= -0.08 * 280 - 1 && f.y <= 0.45 * 280 + 1);
  }
  // seeded: the same sky every time, another seed another sky
  assert.deepEqual(snowPlan(7, 280), plan);
  assert.notDeepEqual(snowPlan(8, 280), plan);
});

test("the cap: a third larger on a header-sized mark, higher on Doh when he jumps", () => {
  assert.match(capOnMark(24), /scale\(1\.45\)/);
  assert.match(capOnMark(30), /scale\(1\.45\)/);
  assert.match(capOnMark(132), /scale\(1\.1\)/);
  assert.equal(capOnDoh("doh-wave"), "translate(84 60) rotate(-18) scale(.46)");
  assert.equal(capOnDoh("doh-cheer"), "translate(84 52) rotate(-18) scale(.46)");
});

test("the season's words: Home's question and the path's last day", () => {
  assert.equal(homeTitle(NO_SEASON), "What are we singing today?");
  assert.equal(homeTitle(ON), "What are we singing this Christmas?");
  assert.equal(untilLabel("2027-01-06"), "Until 6 January");
  assert.equal(untilLabel("2026-12-31"), "Until 31 December");
  assert.equal(untilLabel(null), null);
  assert.equal(untilLabel("6 Jan"), null);
});

const step = (index: number, title: string, carol: string, cue: string, detail: string, passed: boolean, bestScore: number | null = null): CarolStep =>
  ({ index, id: `carol-${index}@60`, title, carol, hymnSlug: "x", cue, detail, passed, bestScore });
const STEPS = (passed: number): CarolStep[] => [
  step(1, "Gloria warm-up", "Angels We Have Heard on High", "the Gloria warm-up", "one breath", passed >= 1, passed >= 1 ? 92 : null),
  step(2, "All the way down", "Joy to the World", "Joy to the World, all the way down", "d' t l s f m r d", passed >= 2, passed >= 2 ? 84 : null),
  step(3, "Sing in thirds", "Silent Night", "Silent Night, in thirds", "Doh is Bb · 4 notes", passed >= 3),
  step(4, "Sing along", "Silent Night", "Silent Night, sing along", "the first verse, with the words", passed >= 4),
  step(5, "Leap up to doh", "Hark! The Herald Angels Sing", "Hark! The Herald Angels Sing, leap up to doh", "s, d d t, d", passed >= 5),
  step(6, "Step up to soh", "The First Noel", "The First Noel, step up to soh", "m r d r m f s", passed >= 6),
];
const season = (passed: number): PracticeSeason => {
  const steps = STEPS(passed);
  return { season: "christmas", title: "Carols for Christmas", until: "2027-01-06", sung: passed, total: 6, next: steps.find((s) => !s.passed) ?? null, steps, badgeCode: "carol_singer" };
};

test("the hub's pine card: until when, six segments, how many sung and what is next", () => {
  const c = carolsCard(season(2));
  assert.equal(c.eyebrow, "Christmas · Until 6 January");
  assert.equal(c.title, "Carols for Christmas");
  assert.deepEqual(c.segments, [true, true, false, false, false, false]);
  assert.equal(c.sung, "2 of 6 sung");
  assert.equal(c.next, "Next: Silent Night, in thirds");
  assert.equal(c.action, "Continue");
  assert.equal(carolsCard(season(0)).action, "Start");
  const done = carolsCard(season(6));
  assert.equal(done.action, "Sing again");
  assert.equal(done.next, "All sung. The Carol singer sticker is yours.");
  assert.equal(carolsCard({ ...season(1), until: null }).eyebrow, "Christmas");
});

test("the carols path: the next drill open, the sung ones done, any one can be chosen again", () => {
  const v = carolsView(season(2));
  assert.equal(v.eyebrow, "Christmas · 2 of 6");
  assert.equal(v.open, 3);
  assert.deepEqual(v.rows.map((r) => r.state), ["done", "done", "open", "todo", "todo", "todo"]);
  assert.equal(v.rows[0]!.line, "Angels We Have Heard on High · one breath");
  assert.equal(v.rows[0]!.bestScore, 92);
  assert.equal(v.allSung, false);
  const again = carolsView(season(2), 1);
  assert.equal(again.open, 1);
  assert.deepEqual(again.rows.map((r) => r.state), ["open", "done", "todo", "todo", "todo", "todo"]);
  // a step that is not on the path falls back to the next one
  assert.equal(carolsView(season(2), 9).open, 3);
  const all = carolsView(season(6));
  assert.equal(all.allSung, true);
  assert.equal(all.open, 6);
});

test("Doh's word over the path follows the next drill, and the sticker is told by its code", () => {
  assert.equal(carolsBuddyLine(season(2)), "Joyful! Now sing under the tune, like the altos do.");
  assert.equal(carolsBuddyLine(season(5)), "Last one: step up to soh with The First Noel.");
  assert.equal(carolsBuddyLine(season(6)), "You sang all six carols. Merry Christmas!");
  assert.equal(earnedCarolSinger([{ code: "streak_3" }, { code: "carol_singer" }]), true);
  assert.equal(earnedCarolSinger([{ code: "streak_3" }]), false);
  assert.equal(earnedCarolSinger(null), false);
});
