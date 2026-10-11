import { test } from "node:test";
import assert from "node:assert/strict";
import { dohHeader, dohLetter, dohPitchClass, KEY_CHOICES, parseKey } from "./solfa.ts";

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
