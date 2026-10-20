import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoSavedLine,
  choirToast,
  filedToast,
  folderNamed,
  isUnopened,
  offlineToast,
  savedToastBody,
  takeKind,
  worthAListenLine,
} from "./savedSheet.ts";

test("a filed sheet with doubtful notes says how many are worth a listen", () => {
  assert.equal(worthAListenLine(1), "1 note worth a listen");
  assert.equal(worthAListenLine(2), "2 notes worth a listen");
  assert.equal(worthAListenLine(12), "12 notes worth a listen");
});

test("a move to a folder says where the sheets went, or that they left their folder", () => {
  assert.equal(filedToast(1, "Sunday choir"), "Moved to Sunday choir");
  assert.equal(filedToast(3, "Sunday choir"), "3 sheets moved to Sunday choir");
  assert.equal(filedToast(1, null), "Taken out of its folder");
  assert.equal(filedToast(2, null), "2 sheets taken out of their folders");
});

test("sharing with the choir says it was shared, or taken back out", () => {
  assert.equal(choirToast(1, true), "Shared with your choir");
  assert.equal(choirToast(4, true), "4 sheets shared with your choir");
  assert.equal(choirToast(1, false), "Taken out of the choir library");
  assert.equal(choirToast(2, false), "2 sheets taken out of the choir library");
});

test("keeping a sheet offline says it is on the phone, or no longer", () => {
  assert.equal(offlineToast(true), "Kept on this phone for offline use");
  assert.equal(offlineToast(false), "No longer kept on this phone");
});

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

test("a new folder's name finds an existing folder in any case, in that folder's spelling", () => {
  const folders = ["Easter service", "Sunday choir"];
  assert.equal(folderNamed("sunday choir", folders), "Sunday choir");
  assert.equal(folderNamed("  SUNDAY CHOIR ", folders), "Sunday choir");
  assert.equal(folderNamed(" Harvest ", folders), "Harvest");
  assert.equal(folderNamed("Sunday", folders), "Sunday");
});
