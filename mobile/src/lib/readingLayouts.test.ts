import { test } from "node:test";
import assert from "node:assert/strict";
import { firstBarOf, firstBarSyllables, firstHymnBar, layoutName, layoutsFor } from "./readingLayouts.ts";
import { deriveSolfa } from "./solfa.ts";
import { hymnRows } from "./choir.ts";

const note = (startBeat: number, pitchMidi: number, durBeats = 1) => ({
  pitchMidi,
  startBeat,
  durBeats,
  degree: 0,
  solfa: "",
  octaveMark: "",
  conf: 1,
});

// s, d d r | m - r d — doh G, the board's tune.
const tune = deriveSolfa(
  [note(0, 62), note(1, 67), note(2, 67), note(3, 69), note(4, 71, 2), note(6, 69), note(7, 67)],
  "G major",
  "4/4",
);

test("every layout is named; Hymn only with words", () => {
  assert.deepEqual(layoutsFor(false).map((l) => l.name), ["By bar", "Grid", "Curwen"]);
  assert.deepEqual(layoutsFor(true).map((l) => l.name), ["By bar", "Grid", "Curwen", "Hymn"]);
  for (const l of layoutsFor(true)) assert.ok(l.line.length > 0 && l.line.length <= 70, l.name);
  assert.equal(layoutName("bars"), "By bar");
  assert.equal(layoutName("curwen"), "Curwen");
});

test("By bar's sample is the first bar's syllables", () => {
  assert.equal(firstBarSyllables(tune.notes, "4/4"), "s,  d  d  r");
  assert.equal(firstBarSyllables(tune.notes, "3/4"), "s,  d  d");
  assert.equal(firstBarSyllables([], "4/4"), null);
});

test("Grid's and Curwen's samples are their own first bar, between bar lines", () => {
  assert.equal(firstBarOf(tune.solfaLines), "| s, - d - d - r - |");
  assert.equal(firstBarOf(tune.curwenLines), "| s, : d : d : r |");
  assert.equal(firstBarOf(["Doh is G"]), null);
  // A bar of rests is passed over for the first bar sung.
  assert.equal(firstBarOf(["Doh is G", "| _ _ _ _ _ _ _ _ | d - r - m - f - |"]), "| d - r - m - f - |");
});

test("Hymn's sample is the first bar sung, its words under it", () => {
  const rows = hymnRows(tune.notes, "A-ma-zing grace how sweet", "4/4");
  const bar = firstHymnBar(rows);
  assert.equal(bar?.solfa, "s,  d  d  r");
  assert.equal(bar?.words.split(" ").length, 4);
  assert.equal(firstHymnBar([]), null);
});
