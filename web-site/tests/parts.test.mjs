// node --test web-site/tests/*.test.mjs
// parts.js decides what the "Four parts" action does and which voices the player sounds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/parts.js", import.meta.url), "utf8"), { window });
const P = window.NfParts;
// Objects made in the vm context have its Object prototype: compare them as plain data.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
const VOICES = ["soprano", "alto", "tenor", "bass"];
const note = { pitchMidi: 60, startBeat: 2, durBeats: 1 };

test("a sheet without parts offers to write them; one with parts goes straight to them", () => {
  assert.equal(P.action({ parts: null }), "write");
  assert.equal(P.action({}), "write");
  // An empty object is not parts: the offer must not disappear behind it.
  assert.equal(P.action({ parts: {} }), "write");
  assert.equal(P.action({ parts: { alto: { notes: [] } } }), "write");
  assert.equal(P.action({ parts: { soprano: { notes: [note] }, alto: { notes: [note] } } }), "show");
});

test("every voice starts on, and muting one leaves the others sounding", () => {
  const mix = P.mixFor(VOICES);
  same(mix, { soprano: true, alto: true, tenor: true, bass: true });
  const noAlto = P.toggle(mix, "alto");
  same(noAlto, { soprano: true, alto: false, tenor: true, bass: true });
  same(P.toggle(noAlto, "alto"), mix);
  assert.equal(P.soloed(noAlto), null);
});

test("solo hears one voice alone, and asking again brings all four back", () => {
  const mix = P.mixFor(VOICES);
  const tenor = P.solo(mix, "tenor");
  same(tenor, { soprano: false, alto: false, tenor: true, bass: false });
  assert.equal(P.soloed(tenor), "tenor");
  same(P.solo(tenor, "bass"), { soprano: false, alto: false, tenor: false, bass: true });
  same(P.solo(tenor, "tenor"), mix);
});

test("muting the last voice sounding brings every voice back instead of silence", () => {
  const alone = P.solo(P.mixFor(VOICES), "bass");
  same(P.toggle(alone, "bass"), P.mixFor(VOICES));
});

test("one voice alone is not a solo", () => {
  assert.equal(P.soloed(P.mixFor(["soprano"])), null);
});
