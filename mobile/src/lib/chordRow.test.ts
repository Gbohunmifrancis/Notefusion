import { test } from "node:test";
import assert from "node:assert/strict";
import { chordRows } from "./chordRow.ts";

// Lines as renderSolfaLines writes them: 4/4 is eight half-beat cells a bar, four bars a line.
const FOUR_FOUR = [
  "Doh is C",
  "| d - r - m - f - | s - - - l - t - | d' - - - - - - - | d' - - - - - - - |",
  "| r' - - - m' - - - | f' - - - - - - - |",
];

test("each chord sits over the syllable at its beat; the header line stays empty", () => {
  const rows = chordRows(
    [
      { startBeat: 0, symbol: "C" },
      { startBeat: 2, symbol: "F" },
      { startBeat: 4, symbol: "G7" },
      { startBeat: 8, symbol: "C" },
    ],
    FOUR_FOUR,
    "4/4",
  );
  assert.equal(rows[0], "");
  assert.equal(rows[1].length, FOUR_FOUR[1].length);
  assert.equal(rows[1].indexOf("C"), FOUR_FOUR[1].indexOf("d"));
  assert.equal(rows[1].indexOf("F"), FOUR_FOUR[1].indexOf("m"));
  assert.equal(rows[1].indexOf("G7"), FOUR_FOUR[1].indexOf("s"));
  assert.equal(rows[1].lastIndexOf("C"), FOUR_FOUR[1].indexOf("d'"));
});

test("a later line continues the bar count", () => {
  const rows = chordRows([{ startBeat: 16, symbol: "Dm" }, { startBeat: 18, symbol: "Em" }, { startBeat: 20, symbol: "F" }], FOUR_FOUR, "4/4");
  assert.equal(rows[1].trim(), "");
  assert.equal(rows[2].length, FOUR_FOUR[2].length);
  assert.equal(rows[2].indexOf("Dm"), FOUR_FOUR[2].indexOf("r'"));
  assert.equal(rows[2].indexOf("Em"), FOUR_FOUR[2].indexOf("m'"));
  assert.equal(rows[2].indexOf("F"), FOUR_FOUR[2].indexOf("f'"));
});

test("a symbol that would overlap another, or run past its bar, is left out rather than cut", () => {
  const lines = ["Doh is C", "| d - r - | m - f - |"];
  const rows = chordRows(
    [
      { startBeat: 0, symbol: "Cmaj7" },
      { startBeat: 0.5, symbol: "Dm" },
      { startBeat: 1.5, symbol: "Em" },
      { startBeat: 3.5, symbol: "Bbm7" },
    ],
    lines,
    "2/4",
  );
  assert.equal(rows[1].length, lines[1].length);
  assert.equal(rows[1].indexOf("Cmaj7"), lines[1].indexOf("d"));
  assert.equal(rows[1].includes("Dm"), false);
  assert.equal(rows[1].indexOf("Em"), 8);
  assert.equal(lines[1][8], "-");
  assert.equal(rows[1].includes("B"), false);
});

test("6/8 bars are three quarter beats", () => {
  const lines = ["Doh is D", "| d r m f s l | d' - - - - - |"];
  const rows = chordRows([{ startBeat: 3, symbol: "G" }, { startBeat: 1.5, symbol: "A" }], lines, "6/8");
  assert.equal(rows[1].indexOf("G"), lines[1].indexOf("d'"));
  assert.equal(rows[1].indexOf("A"), lines[1].indexOf("f"));
});
