import { test } from "node:test";
import assert from "node:assert/strict";
import { dohHeader, dohLetter, dohPitchClass, parseKey } from "./solfa.ts";

test("a major key's doh is its tonic as written", () => {
  assert.equal(dohLetter("F major"), "F");
  assert.equal(dohLetter("Bb major"), "Bb");
  assert.equal(dohLetter("F# major"), "F#");
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
  for (const key of ["Eb major", "Ab major", "Db major", "G minor", "F# major"]) {
    assert.equal(dohHeader(dohPitchClass(parseKey(key)!)), `Doh is ${dohLetter(key)}`);
  }
});
