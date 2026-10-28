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

test("keys a finger wide: never under the minimum, running past the screen when they must, two octaves only when they fit", () => {
  // Amazing Grace's range (D4 to E5) on a 360 px phone at 48 px a key: C4 to B5 is 14 keys, too wide to grow into.
  const keys = R.keyboard([62, 76], 360, 48);
  const whites = keys.filter((k) => !k.black);
  assert.ok(whites.every((k) => k.w === 48));
  assert.equal(R.span(keys), 14 * 48);
  // One octave of notes stays one octave when a second would not fit, and grows to two when it would.
  assert.equal(R.keyboard([60, 67], 360, 48).filter((k) => !k.black).length, 7);
  assert.equal(R.keyboard([60, 67], 800, 48).filter((k) => !k.black).length, 14);
  // A wide screen shares itself out: keys wider than the minimum, the keyboard exactly the screen.
  assert.ok(Math.abs(R.span(R.keyboard([60, 83], 1000, 48)) - 1000) < 1e-9);
});

test("a finger on a black key plays it; below the black keys, the white key under it", () => {
  const keys = R.keyboard([60, 71], 7 * 48, 48); // C4 to B4
  const at = (x, y) => R.keyAt(keys, x, y, 100)?.midi;
  assert.equal(at(48, 20), 61); // over the line between C and D, high up: C#
  assert.equal(at(48, 80), 62); // the same line low down: D's white key
  assert.equal(at(10, 80), 60);
  assert.equal(at(10, 20), 60); // no black key left of C#'s edge
  assert.equal(at(7 * 48 - 1, 50), 71);
  assert.equal(at(10, -5), undefined);
  assert.equal(at(10, 101), undefined);
});

test("each key's syllable in the sheet's key: G major's F# is t, its F has none", () => {
  const syl = (midi) => R.scaleSyllable(midi, 7);
  assert.deepEqual([67, 69, 71, 72, 74, 76, 78, 79].map(syl), ["d", "r", "m", "f", "s", "l", "t", "d"]);
  assert.equal(syl(77), "");
  // A minor's doh is C: its A is l.
  assert.equal(R.scaleSyllable(69, 0), "l");
});

test("the tune's span about to be played, the parts and the far notes left out", () => {
  const near = [
    { voice: 0, x: 100, w: 46, y: 300, h: 50 }, { voice: 0, x: 200, w: 46, y: 250, h: 30 },
    { voice: 1, x: 10, w: 46, y: 300, h: 50 }, { voice: 0, x: 400, w: 46, y: 0, h: 40 },
  ];
  assert.deepEqual(plain(R.tuneSpan(near, 400, 0.5)), { lo: 100, hi: 246 });
  assert.equal(R.tuneSpan([near[2], near[3]], 400, 0.5), null);
});

test("play along: a note at a time, the right note in any octave, right first time only without a wrong key before it", () => {
  const tune = [
    { pitchMidi: 67, startBeat: 0, durBeats: 1 }, { pitchMidi: 71, startBeat: 1, durBeats: 1 },
    { pitchMidi: 62, startBeat: 1, durBeats: 1 }, // a chord's lower note: the tune is its top
    { pitchMidi: 69, startBeat: 2, durBeats: 2 }, { pitchMidi: 0, startBeat: 4, durBeats: 1 },
  ];
  const a = R.along(tune);
  assert.equal(a.count, 3);
  assert.equal(a.target().pitchMidi, 67);
  assert.deepEqual(plain(a.press(55)), { kind: "right", note: tune[0], done: false }); // G3 for G4: any octave
  assert.equal(a.press(72).kind, "wrong");
  assert.equal(a.target().pitchMidi, 71); // a wrong key leaves the note waiting
  assert.equal(a.press(71).kind, "right");
  const last = a.press(69);
  assert.equal(last.done, true);
  assert.ok(a.done());
  assert.equal(a.press(69).kind, "done");
  assert.deepEqual(plain(a.score()), { played: 3, firstTime: 2, total: 3 });
  a.restart();
  assert.deepEqual(plain(a.score()), { played: 0, firstTime: 0, total: 3 });
  assert.equal(a.target().pitchMidi, 67);
  assert.equal(R.along([]).target(), null);
});
