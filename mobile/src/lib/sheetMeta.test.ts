import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryRowLine, parseUtc, savedWhen, sheetMetaLine } from "./sheetMeta.ts";

// Local dates: the line is read on the phone's calendar. 18 Oct 2026 is a Sunday.
const now = new Date(2026, 9, 18, 9, 41);

test("saved today, yesterday, a weekday this week, else the date", () => {
  assert.equal(savedWhen(new Date(2026, 9, 18, 0, 5), now), "today");
  assert.equal(savedWhen(new Date(2026, 9, 17, 23, 50), now), "yesterday");
  assert.equal(savedWhen(new Date(2026, 9, 13, 12), now), "Tuesday");
  assert.equal(savedWhen(new Date(2026, 9, 11, 12), now), "11 Oct");
  assert.equal(savedWhen(new Date(2025, 11, 25, 12), now), "25 Dec 2025");
});

test("the actions sheet's line: tempo, meter, when it was saved", () => {
  const saved = new Date(2026, 9, 11, 10).toISOString();
  assert.equal(sheetMetaLine({ tempoBpm: 71.6, timeSignature: "4/4", createdAtUtc: saved }, now), "72 BPM · 4/4 · saved 11 Oct");
  assert.equal(sheetMetaLine({ tempoBpm: 90, timeSignature: "3/4", createdAtUtc: "nonsense" }, now), "90 BPM · 3/4");
});

test("a Library row's line: when, the folder on All only, the tempo in the same words", () => {
  const sunday = new Date(2026, 9, 18, 8).toISOString();
  const row = { tempoBpm: 71.6, createdAtUtc: sunday, folder: "Easter service" };
  assert.equal(libraryRowLine(row, true, now), "Today · Easter service · 72 BPM");
  assert.equal(libraryRowLine(row, false, now), "Today · 72 BPM");
  assert.equal(libraryRowLine({ ...row, folder: null, createdAtUtc: new Date(2026, 9, 11, 10).toISOString() }, true, now), "11 Oct · 72 BPM");
  // A date with no zone is the API's UTC, read on the phone's calendar like the rest.
  assert.equal(libraryRowLine({ ...row, createdAtUtc: sunday.replace(/Z$/, "") }, false, now), "Today · 72 BPM");
});

test("the API's dates are UTC, with or without a zone", () => {
  assert.equal(parseUtc("2026-10-18T10:00:00"), Date.parse("2026-10-18T10:00:00Z"));
  assert.equal(parseUtc("2026-10-18T10:00:00Z"), Date.parse("2026-10-18T10:00:00Z"));
  assert.equal(parseUtc("2026-10-18T10:00:00.123+01:00"), Date.parse("2026-10-18T09:00:00.123Z"));
});
