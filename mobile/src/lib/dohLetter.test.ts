import { test } from "node:test";
import assert from "node:assert/strict";
import { dohCells, dohHeader, dohLetter, dohPitchClass, KEY_CHOICES, parseKey } from "./solfa.ts";

test("a major key's doh is its tonic, spelled as its key signature spells it", () => {
  assert.equal(dohLetter("F major"), "F");
  assert.equal(dohLetter("Bb major"), "Bb");
  assert.equal(dohLetter("F# major"), "F#");
  // The API and the key picker write sharps.
  assert.equal(dohLetter("A# major"), "Bb");
  assert.equal(dohLetter("C# major"), "Db");
});

test("a minor key is la-based: its doh is the relative major's tonic", () => {
  assert.equal(dohLetter("D minor"), "F");
  assert.equal(dohLetter("A minor"), "C");
  assert.equal(dohLetter("C minor"), "Eb");
});

test("an unreadable key shows a dash", () => {
  assert.equal(dohLetter("H#"), "–");
});

test("the sheet's doh header is spelled like the doh tile", () => {
  assert.equal(dohHeader(10), "Doh is Bb");
  for (const key of [...KEY_CHOICES, "Eb major", "Ab major", "Db major"]) {
    assert.equal(dohHeader(dohPitchClass(parseKey(key)!)), `Doh is ${dohLetter(key)}`);
  }
});

test("the doh picker is the twelve dohs from C, spelled as the doh tile, the sheet's own key marked", () => {
  const major = dohCells("G major", "major");
  assert.deepEqual(major.map((c) => c.doh), ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]);
  assert.deepEqual(major.filter((c) => c.on).map((c) => c.doh), ["G"]);
  assert.equal(major[7]!.key, "G major");
  assert.equal(major[7]!.minorName, null);
  // The API writes sharps; the cell still reads as the signature spells it, and marks the same key.
  assert.deepEqual(dohCells("A# major", "major").filter((c) => c.on).map((c) => c.doh), ["Bb"]);
  assert.deepEqual(dohCells("Bb major", "major").filter((c) => c.on).map((c) => c.key), ["A# major"]);
  for (const mode of ["major", "minor"] as const) {
    for (const cell of dohCells("C major", mode)) assert.equal(dohLetter(cell.key), cell.doh, cell.key);
  }
});

test("in minor each doh is its la-based key, named as its relative major's signature spells it", () => {
  const minor = dohCells("G major", "minor");
  assert.equal(minor.some((c) => c.on), false);
  assert.deepEqual(
    minor.map((c) => c.minorName),
    ["A", "Bb", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"].map((t) => `${t} minor`),
  );
  assert.equal(minor[7]!.key, "E minor");
  assert.equal(minor[1]!.key, "A# minor");
  assert.deepEqual(dohCells("E minor", "minor").filter((c) => c.on).map((c) => c.doh), ["G"]);
  assert.deepEqual(dohCells("H#", "major").filter((c) => c.on), []);
});
