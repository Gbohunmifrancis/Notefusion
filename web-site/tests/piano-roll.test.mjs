// node --test web-site/tests/*.test.mjs
// piano-roll.js: the keys a sheet needs, the notes falling onto them, and the bar lines between.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/piano-roll.js", import.meta.url), "utf8"), { window });
const R = window.NfPianoRoll;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the keyboard runs from a C to a B, at least two octaves, across the width", () => {
  const keys = R.keyboard([62, 74], 280); // D4 to D5: C4 to B5
  const whites = keys.filter((k) => !k.black), blacks = keys.filter((k) => k.black);
  assert.equal(whites[0].midi, 60);
  assert.equal(Math.max(...keys.map((k) => k.midi)), 83);
  assert.equal(whites.length, 14);
  assert.equal(blacks.length, 10);
  assert.ok(Math.abs(whites.at(-1).x + whites.at(-1).w - 280) < 1e-9);
  // A sharp sits over the line between its two white keys.
  const cSharp = keys.find((k) => k.midi === 61), d = keys.find((k) => k.midi === 62);
  assert.ok(Math.abs(cSharp.x + cSharp.w / 2 - d.x) < 1e-9);
  // One octave of notes still gets two; a bass line keeps to the keys there are.
  assert.equal(R.keyboard([60, 64], 100).filter((k) => !k.black).length, 14);
  assert.ok(R.keyboard([22, 30], 100).every((k) => k.midi >= 21));
});

test("a note lands on its key as it sounds, falls from above before, and is gone once over", () => {
  const keys = R.keyboard([60, 72], 140);
  const tune = [{ notes: [{ pitchMidi: 60, startBeat: 0, durBeats: 1, solfa: "d", octaveMark: "" },
    { pitchMidi: 64, startBeat: 2, durBeats: 2, solfa: "m", octaveMark: "" },
    { pitchMidi: 72, startBeat: 12, durBeats: 1, solfa: "d", octaveMark: "'" }] }];
  // At beat 0, eight beats in sight over 400 px: 50 px a beat.
  const now = plain(R.bars(tune, keys, 0, 8, 400));
  assert.equal(now.length, 2); // the high d is twelve beats off
  assert.deepEqual([now[0].y, now[0].h, now[0].sounding, now[0].label], [350, 50, true, "d"]);
  assert.deepEqual([now[1].y, now[1].h, now[1].sounding], [200, 100, false]);
  const c = keys.find((k) => k.midi === 60);
  assert.equal(now[0].x, c.x + 1);
  // Half a beat in, the d has half a beat left on the keys; at beat 1 it is gone.
  assert.deepEqual(plain(R.bars(tune, keys, 0.5, 8, 400)).map((b) => [b.y, b.h]), [[375, 25], [225, 100]]);
  assert.equal(R.bars(tune, keys, 1, 8, 400).length, 1);
  // The octave mark is part of the label; a note above the top of the roll is cut at it.
  const late = plain(R.bars(tune, keys, 11, 8, 400));
  assert.deepEqual([late[0].label, late[0].y, late[0].h], ["d'", 300, 50]);
  assert.deepEqual(plain(R.bars(tune, keys, 5, 8, 400)).map((b) => [b.y, b.h]), [[0, 50]]);
});

test("the parts fall beside the tune, each with its voice; a note off the keys is left out", () => {
  const keys = R.keyboard([48, 72], 300);
  const voices = [{ notes: [{ pitchMidi: 67, startBeat: 0, durBeats: 1 }] }, { notes: [{ pitchMidi: 48, startBeat: 0, durBeats: 1 }, { pitchMidi: 30, startBeat: 0, durBeats: 1 }] }];
  assert.deepEqual(plain(R.bars(voices, keys, 0, 8, 400)).map((b) => [b.voice, b.midi]), [[0, 67], [1, 48]]);
});

test("bar lines: each bar's first beat in sight, the one sounding now on the keys", () => {
  assert.deepEqual(plain(R.barLines(3, 0, 6, 300)), [300, 150]);
  assert.deepEqual(plain(R.barLines(3, 1, 6, 300)), [200, 50]);
  assert.deepEqual(plain(R.barLines(4, 4, 8, 400)), [400, 200]);
});
