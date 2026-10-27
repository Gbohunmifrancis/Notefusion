import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ascendingFlags,
  deriveSolfa,
  divisionsFor,
  partReference,
  referenceDoh,
  renderCurwenLines,
  renderSolfaLines,
} from "./solfa.ts";
import type { NoteEvent } from "../api/types.ts";

// The hymn-book table: the lock-step contract. The same rows, with the same expected strings,
// are in tests/NoteFusion.Tests/Solfa/HymnBookSolfaTests.cs, server/tests/test_solfa.py and
// web-site/tests/choir.test.mjs. Change one and you change all four.
const HYMN_BOOK_CASES: readonly (readonly [string, number[], string])[] = [
  // A chromatic is named for where it goes: a semitone up is sharpened, a semitone down flattened.
  ["C major", [60, 61, 62], "d de r"],
  ["C major", [62, 61, 60], "r ra d"],
  ["C major", [60, 61, 60], "d ra d"], // upper neighbour: it falls back, so ra
  ["C major", [64, 63, 64], "m re m"], // lower neighbour: it rises back, so re
  ["C major", [67, 66, 67], "s fe s"],
  ["C major", [69, 68, 69], "l se l"],
  ["C major", [69, 70, 69], "l ta l"],
  ["C major", [71, 70, 69], "t ta l"],
  ["C major", [67, 68, 67], "s la s"],
  // Anything else — the last note, a leap, a tone — takes the default: de ma fe se ta.
  ["C major", [60, 61], "d de"],
  ["C major", [62, 63], "r ma"],
  ["C major", [65, 66], "f fe"],
  ["C major", [67, 68], "s se"],
  ["C major", [71, 70], "t ta"],
  ["C major", [60, 66, 60], "d fe d"],
  ["C major", [67, 70, 67], "s ta s"],
  ["C major", [72, 68, 65], "d' se f"],
  ["C major", [63, 65], "ma f"],
  ["C major", [70, 72], "ta d'"],
  ["C major", [61, 59], "de t,"],
  ["C major", [66, 64], "fe m"],
  ["C major", [62, 61, 61, 60], "r ra ra d"],
  ["C major", [62, 61, 61, 62], "r de de r"],
  // The held hymns' bars, as the books print them.
  ["F major", [67, 66, 67, 69, 70, 67], "r de r m f r"], // What a Friend, bar 9
  ["Db major", [70, 68, 67, 68], "l s fe s"], // It Is Well, bar 7
  ["D major", [68, 66, 64, 69, 74], "fe m r s d'"], // Crown Him, bar 6
  ["G major", [76, 74, 73, 74], "l s fe s"], // All Hail, bar 9
  ["C major", [72, 67, 69, 66, 67], "d' s l fe s"], // O God Our Help, bar 4
  ["D major", [71, 68, 69, 71, 69, 68, 69], "l fe s l s fe s"], // Thine Be the Glory, bars 14-15
  // La-based minor: se stays the leading note to lah, fe the melodic minor's raised fah.
  ["A minor", [69, 71, 72, 74, 76, 77, 80, 81, 80, 77, 76], "l, t, d r m f se l se f m"],
  ["A minor", [76, 78, 80, 81], "m fe se l"],
  // The unmarked octave starts at the doh at or below the middle note.
  ["D major", [62, 62, 66, 66, 69, 69, 71, 71, 71, 69, 66], "d d m m s s l l l s m"], // Holy, Holy, Holy
  ["G major", [62, 67, 71, 67, 71, 69, 67, 64, 62], "s, d m d m r d l, s,"], // Amazing Grace
  ["C major", [67, 64, 69, 67, 72, 72, 71, 72], "s m l s d' d' t d'"], // St Anne
  ["Bb major", [65, 67, 65, 62], "s l s m"], // Silent Night
  // ...and in a minor key, at the doh at or below a minor third above it: lah stays under doh.
  ["A minor", [57, 59, 60, 59, 57, 56, 57], "l, t, d t, l, se, l,"],
  ["A minor", [57, 59, 60, 62, 64, 62, 60, 59, 57], "l, t, d r m r d t, l,"],
];

for (const [key, pitches, expected] of HYMN_BOOK_CASES) {
  test(`${key} ${pitches.join(" ")} reads "${expected}"`, () => {
    const notes = pitches.map((pitchMidi, i) => ({
      pitchMidi,
      startBeat: i,
      durBeats: 1,
      degree: 0,
      solfa: "",
      octaveMark: "",
      conf: 1,
    }));
    const labelled = deriveSolfa(notes, key, "4/4").notes;
    assert.equal(labelled.map((n) => n.solfa + n.octaveMark).join(" "), expected);
  });
}

test("the unmarked doh is the doh at or below the middle note", () => {
  assert.equal(referenceDoh([60], 5, "major"), 53); // F3, not the nearer F4
  assert.equal(referenceDoh([64, 67, 69, 71, 72], 0, "major"), 60);
  assert.equal(referenceDoh([57, 59, 60, 59, 57, 56, 57], 0, "minor"), 60); // lah stays under doh
  assert.equal(referenceDoh([], 5, "major"), 53);
  assert.equal(referenceDoh([127], 0, "minor"), 120);
  assert.equal(referenceDoh([3], 10, "major"), 10);
});

test("written parts under a man's tune are marked from the soprano, which reads as the tune does", () => {
  const notesOf = (pitches: number[]) =>
    pitches.map((pitchMidi, i) => ({ pitchMidi, startBeat: i, durBeats: 1, degree: 0, solfa: "", octaveMark: "", conf: 1 }));
  // He sang D3 F#3 A3; the parts were written with the tune at a soprano's D4 F#4 A4.
  const tune = notesOf([50, 50, 54, 54, 57, 57]);
  const soprano = notesOf([62, 62, 66, 66, 69, 69]);
  const parts = { soprano: { notes: soprano, solfaLines: [] }, bass: { notes: notesOf([50, 47, 45]), solfaLines: [] } };
  assert.equal(partReference(parts, tune), soprano);
  assert.equal(referenceDoh(partReference(parts, tune).map((n) => n.pitchMidi), 2, "major"), 62);
  assert.equal(referenceDoh(tune.map((n) => n.pitchMidi), 2, "major"), 50); // the tune's own doh, an octave under
  // No soprano (a choir heard without one, or no parts): the melody, as before.
  assert.equal(partReference({ bass: parts.bass }, tune), tune);
  assert.equal(partReference(null, tune), tune);
});

test("a chromatic is named for where it goes, otherwise the hymn-book default", () => {
  assert.equal(ascendingFlags([60, 61, 60], 0)[1], false); // d ra d
  assert.equal(ascendingFlags([64, 63, 64], 0)[1], true); // m re m
  assert.equal(ascendingFlags([67, 66, 67], 5)[1], true); // What a Friend bar 9: r de r
  assert.deepEqual([61, 63, 66, 68, 70].map((p) => ascendingFlags([p], 0)[0]), [true, false, true, true, false]);
  assert.deepEqual(ascendingFlags([], 0), []);
});

// Quarter beats: the same cases as the worker's tests/test_solfa_render.py.
const line = (...notes: [number, number, string][]): NoteEvent[] =>
  notes.map(([startBeat, durBeats, solfa]) => ({
    pitchMidi: 60, startBeat, durBeats, degree: 1, solfa, octaveMark: "", conf: 1,
  }));

test("a sheet on eighths keeps two cells a beat and one on sixteenths gets four", () => {
  assert.equal(divisionsFor(line([0, 1, "d"], [1, 0.5, "r"], [1.5, 2.5, "m"])), 2);
  assert.equal(divisionsFor(line([0, 0.75, "d"], [0.75, 0.25, "r"])), 4);
  assert.equal(divisionsFor(line([0, 0.25, "d"], [0.5, 0.5, "r"])), 4); // ends between
  assert.equal(divisionsFor([]), 2);
});

test("the grid gives sixteenths a cell each instead of a chord", () => {
  const lines = renderSolfaLines(line([0, 0.25, "d"], [0.25, 0.25, "r"], [0.5, 0.5, "m"], [1, 3, "f"]), "Doh is C", "4/4");
  assert.equal(lines[1], "| d r m - f - - - - - - - - - - - |");
});

test("curwen writes quarters within their half", () => {
  const four = line([0, 0.25, "d"], [0.25, 0.25, "r"], [0.5, 0.25, "m"], [0.75, 0.25, "f"], [1, 3, "s"]);
  assert.equal(renderCurwenLines(four, "Doh is C")[1], "| d,r . m,f : s : - : - |");
  const dotted = line([0, 0.75, "d"], [0.75, 0.25, "r"], [1, 3, "m"]);
  assert.equal(renderCurwenLines(dotted, "Doh is C")[1], "| d . ,r : m : - : - |");
  const snap = line([0, 0.25, "d"], [0.25, 0.75, "r"], [1, 0.5, "m"], [1.5, 0.25, "f"], [1.75, 2.25, "s"]);
  assert.equal(renderCurwenLines(snap, "Doh is C")[1], "| d,r : m . f,s : - : - |");
  // A sheet on eighths reads exactly as it always has.
  const eighths = line([0, 1, "d"], [1, 0.5, "r"], [1.5, 0.5, "m"], [2, 2, "f"]);
  assert.equal(renderCurwenLines(eighths, "Doh is C")[1], "| d : r . m : f : - |");
});

test("the lyric grid gives sixteenths a cell each at the sheet's divisions", async () => {
  const { hymnRows } = await import("./choir.ts");
  const notes = line([0, 0.25, "d"], [0.25, 0.25, "r"], [0.5, 0.5, "m"], [1, 3, "f"]);
  const bar = hymnRows(notes, "a b c d", "4/4", 4, divisionsFor(notes))[0]![0]!;
  assert.deepEqual(bar.slice(0, 5).map((c) => [c.solfa, c.lyric]), [["d", "a"], ["r", "b"], ["m", "c"], ["-", ""], ["f", "d"]]);
});
