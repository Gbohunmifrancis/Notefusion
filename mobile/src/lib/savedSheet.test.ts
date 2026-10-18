import { test } from "node:test";
import assert from "node:assert/strict";
import { autoSavedLine, isUnopened, savedToastBody, takeKind } from "./savedSheet.ts";

test("the line under a fresh sheet's title names the kind of take", () => {
  assert.equal(takeKind({}), "Hummed");
  assert.equal(takeKind({ separated: true }), "Song");
  assert.equal(takeKind({ partsSource: "heard" }), "Choir");
  assert.equal(takeKind({ chordsSource: "heard" }), "Chords");
  assert.equal(takeKind({ separated: true, chordsSource: "heard" }), "Song", "a song's chords are its backing");
});

test("the first-open toast says what the sheet was filed as, and why when a hymn named it", () => {
  assert.equal(savedToastBody("Abide with Me", "Abide with Me"), 'As "Abide with Me", the hymn it matched');
  assert.equal(savedToastBody("Recording · Sun 17:10", null), 'As "Recording · Sun 17:10"');
  assert.equal(savedToastBody("My own name", "Abide with Me"), 'As "My own name"', "renamed since: not the hymn's name");
});

test("a sheet is unopened only while the server filed it and its owner has not opened it", () => {
  assert.equal(isUnopened({ savedAutomatically: true, openedAtUtc: null }), true);
  assert.equal(isUnopened({ savedAutomatically: true, openedAtUtc: "2026-10-18T17:42:00Z" }), false);
  assert.equal(isUnopened({ savedAutomatically: false }), false);
  assert.equal(isUnopened({}), false, "an older server's sheet");
});

test("the row's line is the time it was filed on the phone's clock", () => {
  const d = new Date(2026, 9, 18, 18, 42);
  assert.equal(autoSavedLine(d.toISOString()), "Saved automatically · 18:42");
});
