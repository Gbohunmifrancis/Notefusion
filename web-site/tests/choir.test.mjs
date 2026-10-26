// node --test web-site/tests/*.test.mjs
// choir.js is a plain browser script that sets window.NfChoir; it is run here in a bare
// context with only `window` defined, which is all its top level touches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/choir.js", import.meta.url), "utf8"), { window });
const { divisionsFor, keyHeader, label, partReference, renderLines, shiftKeyName } = window.NfChoir;

test("the doh header is spelled like the key signature", () => {
  assert.equal(keyHeader("A# major"), "Doh is Bb"); // doh 10, however the key was typed
  assert.equal(keyHeader("G minor"), "Doh is Bb"); // la-based: doh is the relative major's
  assert.equal(keyHeader("Eb major"), "Doh is Eb");
  assert.equal(keyHeader("Ab major"), "Doh is Ab");
  assert.equal(keyHeader("C# major"), "Doh is Db");
  assert.equal(keyHeader("F# major"), "Doh is F#");
});

// The hymn-book table: the lock-step contract. The same rows, with the same expected strings,
// are in tests/NoteFusion.Tests/Solfa/HymnBookSolfaTests.cs, server/tests/test_solfa.py and
// mobile/src/lib/solfa.test.ts. Change one and you change all four.
const HYMN_BOOK_CASES = [
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

const notesOf = (pitches) => pitches.map((pitchMidi, i) => ({ pitchMidi, startBeat: i, durBeats: 1 }));
const read = (labelled) => Array.from(labelled, (n) => n.solfa + n.octaveMark).join(" ");

for (const [key, pitches, expected] of HYMN_BOOK_CASES) {
  test(`${key} ${pitches.join(" ")} reads "${expected}"`, () => {
    assert.equal(read(label(notesOf(pitches), key)), expected);
  });
}

test("a part is marked from the melody's doh, not its own", () => {
  // Holy, Holy, Holy's opening with a bass under it: the bass's doh sits an octave under the tune's.
  const tune = notesOf([62, 62, 66, 66, 69, 69]);
  const bass = notesOf([50, 50, 47, 47, 45, 45]);
  assert.equal(read(label(bass, "D major", tune)), "d, d, l,, l,, s,, s,,");
});

test("written parts under a man's tune are marked from the soprano, which reads as the tune does", () => {
  // He sang D3 F#3 A3; the parts were written with the tune at a soprano's D4 F#4 A4.
  const tune = notesOf([50, 50, 54, 54, 57, 57]);
  const parts = { soprano: { notes: notesOf([62, 62, 66, 66, 69, 69]) }, bass: { notes: notesOf([50, 50, 47, 47, 45, 45]) } };
  const ref = partReference(parts, tune);
  assert.equal(read(label(tune, "D major")), "d d m m s s");
  assert.equal(read(label(parts.soprano.notes, "D major", ref)), "d d m m s s");
  assert.equal(read(label(parts.bass.notes, "D major", ref)), "d, d, l,, l,, s,, s,,");
  // No soprano (a choir heard without one, or no parts): the melody, as before.
  assert.equal(partReference({ bass: parts.bass }, tune), tune);
  assert.equal(partReference(null, tune), tune);
  assert.equal(partReference(null, undefined).length, 0);
});

test("Transpose names the new key as its signature spells it, as MusicalKey.cs and the phone do", () => {
  assert.equal(shiftKeyName("C major", 3), "Eb major");
  assert.equal(shiftKeyName("C major", -2), "Bb major");
  assert.equal(shiftKeyName("G major", 1), "Ab major");
  assert.equal(shiftKeyName("C major", 1), "Db major");
  assert.equal(shiftKeyName("G major", -1), "F# major");
  assert.equal(shiftKeyName("A minor", -1), "G# minor");
  assert.equal(shiftKeyName("A minor", 1), "Bb minor");
  assert.equal(shiftKeyName("C minor", 3), "Eb minor");
  assert.equal(shiftKeyName("Bb major", 2), "C major");
  assert.equal(shiftKeyName("not a key", 2), "not a key");
});

// Quarter beats: the same cases as the worker's tests/test_solfa_render.py and mobile lib/solfa.test.ts.
const line = (...notes) => notes.map(([startBeat, durBeats, solfa]) => ({ startBeat, durBeats, solfa, octaveMark: "" }));

test("a sheet on eighths keeps two cells a beat and one on sixteenths gets four", () => {
  assert.equal(divisionsFor(line([0, 1, "d"], [1, 0.5, "r"], [1.5, 2.5, "m"])), 2);
  assert.equal(divisionsFor(line([0, 0.75, "d"], [0.75, 0.25, "r"])), 4);
  assert.equal(divisionsFor(line([0, 0.25, "d"], [0.5, 0.5, "r"])), 4); // ends between
  assert.equal(divisionsFor([]), 2);
});

test("the grid gives sixteenths a cell each instead of a chord", () => {
  const lines = renderLines(line([0, 0.25, "d"], [0.25, 0.25, "r"], [0.5, 0.5, "m"], [1, 3, "f"]), "Doh is C", "4/4");
  assert.equal(lines[1], "| d r m - f - - - - - - - - - - - |");
  assert.equal(renderLines(line([0, 1, "d"], [1, 1, "r"], [2, 2, "m"]), "Doh is C", "4/4")[1], "| d - r - m - - - |");
});
