import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canNudge,
  defaultRange,
  fitsWhole,
  formatClock,
  handleCentres,
  isWholeSong,
  moveEnd,
  moveStart,
  moveWindow,
  nudgeRange,
  sectionLabel,
  sectionOf,
  selectedLabel,
} from "./clipRange.ts";

test("clock: m:ss, h:mm:ss over an hour, floored to the second, never negative", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(30), "0:30");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(213.4), "3:33");
  assert.equal(formatClock(213.6), "3:33"); // the total agrees with the end thumb, which stops on whole seconds
  assert.equal(formatClock(59.9), "0:59");
  assert.equal(formatClock(360), "6:00");
  assert.equal(formatClock(3600), "1:00:00");
  assert.equal(formatClock(3725), "1:02:05");
  assert.equal(formatClock(-3), "0:00");
  assert.equal(formatClock(Number.NaN), "0:00");
});

test("default range is the first allowance, or the whole of a shorter song", () => {
  assert.deepEqual(defaultRange(213, 360), { start: 0, end: 213 });
  assert.deepEqual(defaultRange(213, 60), { start: 0, end: 60 });
  assert.deepEqual(defaultRange(213.7, 30), { start: 0, end: 30 });
  assert.equal(fitsWhole(213, 360), true);
  assert.equal(fitsWhole(213, 60), false);
  assert.equal(isWholeSong({ start: 0, end: 213 }, 213.7), true);
  assert.equal(isWholeSong({ start: 1, end: 213 }, 213), false);
});

test("start thumb: snaps, stays inside the song, keeps the window between 5 s and the allowance", () => {
  const song = 213;
  assert.deepEqual(moveStart({ start: 0, end: 60 }, 10.4, song, 60), { start: 10, end: 60 }); // inward: the window shrinks
  assert.deepEqual(moveStart({ start: 0, end: 60 }, 58, song, 60), { start: 58, end: 63 }); // too short: end follows
  assert.deepEqual(moveStart({ start: 0, end: 60 }, -5, song, 60), { start: 0, end: 60 });
  assert.deepEqual(moveStart({ start: 0, end: 60 }, 500, song, 60), { start: 208, end: 213 });
  assert.deepEqual(moveStart({ start: 100, end: 160 }, 90, song, 60), { start: 90, end: 150 });
  assert.deepEqual(moveStart({ start: 100, end: 160 }, 110, song, 360), { start: 110, end: 160 });
});

test("end thumb: snaps, stays inside the song, drags the start along past the cap", () => {
  const song = 213;
  assert.deepEqual(moveEnd({ start: 0, end: 60 }, 90.6, song, 60), { start: 31, end: 91 });
  assert.deepEqual(moveEnd({ start: 0, end: 60 }, 2, song, 60), { start: 0, end: 5 });
  assert.deepEqual(moveEnd({ start: 100, end: 160 }, 102, song, 60), { start: 97, end: 102 });
  assert.deepEqual(moveEnd({ start: 0, end: 60 }, 999, song, 60), { start: 153, end: 213 });
  assert.deepEqual(moveEnd({ start: 0, end: 60 }, 120, song, 360), { start: 0, end: 120 });
});

test("window keeps its length and stops at either end of the song", () => {
  assert.deepEqual(moveWindow({ start: 0, end: 60 }, 30.2, 213), { start: 30, end: 90 });
  assert.deepEqual(moveWindow({ start: 0, end: 60 }, -20, 213), { start: 0, end: 60 });
  assert.deepEqual(moveWindow({ start: 0, end: 60 }, 300, 213), { start: 153, end: 213 });
});

test("±5 s: one end moves five seconds by the handles' rules, the other following at the limits", () => {
  const song = 252;
  // The free preview's 1:00, from 0:45: the start back five moves the whole section (it is already the longest).
  assert.deepEqual(nudgeRange({ start: 45, end: 105 }, "start", -5, song, 60), { start: 40, end: 100 });
  // The start on five shortens it; the end back five shortens it; the end on five moves the whole section.
  assert.deepEqual(nudgeRange({ start: 45, end: 105 }, "start", 5, song, 60), { start: 50, end: 105 });
  assert.deepEqual(nudgeRange({ start: 45, end: 105 }, "end", -5, song, 60), { start: 45, end: 100 });
  assert.deepEqual(nudgeRange({ start: 45, end: 105 }, "end", 5, song, 60), { start: 50, end: 110 });
  // Never under five seconds: the other end is pushed along.
  assert.deepEqual(nudgeRange({ start: 45, end: 50 }, "start", 5, song, 60), { start: 50, end: 55 });
  assert.deepEqual(nudgeRange({ start: 45, end: 50 }, "end", -5, song, 60), { start: 40, end: 45 });
  // Held inside the song: from 0:02 the start stops at 0:00, and the end stops at the song's end.
  assert.deepEqual(nudgeRange({ start: 2, end: 62 }, "start", -5, song, 60), { start: 0, end: 60 });
  assert.deepEqual(nudgeRange({ start: 190, end: 250 }, "end", 5, song, 60), { start: 192, end: 252 });
});

test("±5 s: a step that would move nothing is off", () => {
  assert.equal(canNudge({ start: 0, end: 60 }, "start", -5, 252, 60), false);
  assert.equal(canNudge({ start: 0, end: 60 }, "start", 5, 252, 60), true);
  assert.equal(canNudge({ start: 192, end: 252 }, "end", 5, 252, 60), false);
  assert.equal(canNudge({ start: 192, end: 252 }, "end", -5, 252, 60), true);
  // A clip as short as its minimum can neither shrink nor move.
  assert.equal(canNudge({ start: 0, end: 3 }, "end", -5, 3, 60), false);
});

test("a clip shorter than five seconds is its own minimum window", () => {
  assert.deepEqual(defaultRange(3, 60), { start: 0, end: 3 });
  assert.deepEqual(moveStart({ start: 0, end: 3 }, 2, 3, 60), { start: 0, end: 3 });
});

test("labels", () => {
  assert.equal(sectionLabel(65, 95, 213), "1:05–1:35 of 3:33");
  assert.equal(selectedLabel({ start: 0, end: 213 }, 213.6), "Selected 3:33 of 3:33"); // the whole song reads as the whole song
  assert.equal(sectionLabel(65, 95, null), "1:05–1:35");
  assert.equal(selectedLabel({ start: 0, end: 30 }, 213), "Selected 0:30 of 3:33");
});

test("the credit's section: only when a part of the song was chosen", () => {
  assert.equal(sectionOf({ startSeconds: 65, endSeconds: 95, durationSeconds: 213 }), "1:05–1:35 of 3:33");
  assert.equal(sectionOf({ startSeconds: 65, endSeconds: 95, durationSeconds: null }), "1:05–1:35");
  assert.equal(sectionOf({ startSeconds: 0, endSeconds: 213, durationSeconds: 213.4 }), null);
  assert.equal(sectionOf({ startSeconds: null, endSeconds: null, durationSeconds: 213 }), null);
  assert.equal(sectionOf({}), null);
});

test("handles closer than one handle are spread apart, into the track's room at either end", () => {
  // Far enough apart: drawn at their marks.
  assert.deepEqual(handleCentres(40, 120, 300, 28), { start: 40, end: 120 });
  // Five seconds of a long song, mid-track: 9 px apart becomes 28, evenly.
  assert.deepEqual(handleCentres(100, 109, 300, 28), { start: 90.5, end: 118.5 });
  // At the start the end handle takes all the room; at the end, the start handle does.
  assert.deepEqual(handleCentres(0, 9, 300, 28), { start: 0, end: 28 });
  assert.deepEqual(handleCentres(291, 300, 300, 28), { start: 272, end: 300 });
  // Before the track is measured nothing moves.
  assert.deepEqual(handleCentres(0, 0, 0, 28), { start: 0, end: 0 });
});
