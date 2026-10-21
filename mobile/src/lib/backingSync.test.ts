import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKING_WORDS,
  DEFAULT_BACKING_PREFS,
  DEFAULT_BALANCE,
  backToLabel,
  backingCanPlay,
  backingRows,
  balanceValueText,
  balanceVolumes,
  louderEnd,
  needsResync,
  parseBackingPrefs,
  rateKeepsBacking,
  showsBackingRows,
  stepBalance,
  warnsBeforeTranspose,
  type BackingFacts,
} from "./backingSync.ts";
import { SPEEDS } from "./practice.ts";

/** Rehearse's speed steps (components/result/usePractice RATE_STEPS). */
const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("the balance: the louder side at full, the other its share; 40 % is the solfa on top and the band at two-thirds", () => {
  assert.equal(DEFAULT_BALANCE, 0.4);
  assert.deepEqual(balanceVolumes(0), { solfa: 1, backing: 0 });
  const def = balanceVolumes(0.4);
  assert.equal(def.solfa, 1);
  near(def.backing, 2 / 3);
  assert.deepEqual(balanceVolumes(0.5), { solfa: 1, backing: 1 });
  const lean = balanceVolumes(0.8);
  near(lean.solfa, 0.25);
  assert.equal(lean.backing, 1);
  assert.deepEqual(balanceVolumes(1), { solfa: 0, backing: 1 });
  // Out of range or unreadable: clamped, or the default.
  assert.deepEqual(balanceVolumes(-3), { solfa: 1, backing: 0 });
  assert.deepEqual(balanceVolumes(Number.NaN), balanceVolumes(DEFAULT_BALANCE));
});

test("the louder end says so; the middle mark is even, so neither word stands out", () => {
  assert.equal(louderEnd(0), "solfa");
  assert.equal(louderEnd(0.4), "solfa");
  assert.equal(louderEnd(0.5), null);
  assert.equal(louderEnd(0.5000000001), null);
  assert.equal(louderEnd(0.6), "backing");
  assert.equal(louderEnd(1), "backing");
});

test("a screen reader hears 'backing 40 percent' and steps it by ten", () => {
  assert.equal(balanceValueText(0.4), "backing 40 percent");
  assert.equal(balanceValueText(1), "backing 100 percent");
  near(stepBalance(0.4, 1), 0.5);
  near(stepBalance(0.4, -1), 0.3);
  // A dragged value lands back on the tens.
  near(stepBalance(0.43, 1), 0.5);
  assert.equal(stepBalance(1, 1), 1);
  assert.equal(stepBalance(0, -1), 0);
});

test("the switch and the balance are remembered; anything unreadable is the default (on, 40 %)", () => {
  assert.deepEqual(DEFAULT_BACKING_PREFS, { on: true, balance: 0.4 });
  assert.deepEqual(parseBackingPrefs(null), DEFAULT_BACKING_PREFS);
  assert.deepEqual(parseBackingPrefs("not json"), DEFAULT_BACKING_PREFS);
  assert.deepEqual(parseBackingPrefs("null"), DEFAULT_BACKING_PREFS);
  assert.deepEqual(parseBackingPrefs(JSON.stringify({ on: false, balance: 0.7 })), { on: false, balance: 0.7 });
  assert.deepEqual(parseBackingPrefs(JSON.stringify({ balance: 4 })), { on: true, balance: 1 });
  assert.deepEqual(parseBackingPrefs(JSON.stringify({ on: "yes", balance: "x" })), DEFAULT_BACKING_PREFS);
});

test("the backing keeps its pitch at every speed Rehearse and Learn my part offer, 0.5 to 2", () => {
  for (const r of RATE_STEPS) assert.equal(rateKeepsBacking(r), true, `${r}×`);
  for (const r of SPEEDS) assert.equal(rateKeepsBacking(r), true, `Learn my part ${r}`);
  // A BPM moved far from the song's own pushes it past what a stretch can do: it sits out.
  assert.equal(rateKeepsBacking(0.25), false);
  assert.equal(rateKeepsBacking(2.5), false);
  assert.equal(rateKeepsBacking(Number.NaN), false);
});

test("the band is pulled back into step only past 40 ms", () => {
  assert.equal(needsResync(10.03, 10), false);
  assert.equal(needsResync(10.039, 10), false);
  assert.equal(needsResync(10.05, 10), true);
  assert.equal(needsResync(9.95, 10), true);
});

const UPLOAD: BackingFacts = {
  available: true,
  gone: false,
  fromLink: false,
  reopened: false,
  transposedBy: 0,
  hymnbook: false,
  originalKey: "Eb major",
};

test("what the dock shows: the switch and balance, the transposed line, the link lines, or nothing at all", () => {
  // An upload's backing, fresh or opened again: the switch and the balance (O1, O3/5).
  assert.deepEqual(backingRows(UPLOAD), { kind: "playable", freshLink: false });
  assert.deepEqual(backingRows({ ...UPLOAD, reopened: true }), { kind: "playable", freshLink: false });
  // Transposed: the switch greys, the line and the way back to the song's own key (O3/3).
  assert.deepEqual(backingRows({ ...UPLOAD, transposedBy: 2 }), { kind: "transposed", backTo: "Eb major" });
  assert.deepEqual(backingRows({ ...UPLOAD, transposedBy: -12 }), { kind: "transposed", backTo: "Eb major" });
  // Fresh from a link: it plays, with the muted line (O3/4).
  assert.deepEqual(backingRows({ ...UPLOAD, fromLink: true }), { kind: "playable", freshLink: true });
  // A link's sheet opened again: only the muted line, no switch.
  assert.deepEqual(backingRows({ ...UPLOAD, available: false, fromLink: true, reopened: true }), { kind: "linkLater" });
  assert.deepEqual(backingRows({ ...UPLOAD, available: false, fromLink: true, reopened: true, transposedBy: 3 }), { kind: "linkLater" });
  // A fresh link whose backing the server let go: the same line.
  assert.deepEqual(backingRows({ ...UPLOAD, fromLink: true, gone: true }), { kind: "linkLater" });
  // Every other sheet: nothing, the dock as it was (a hummed tune, an upload whose backing has gone, a hymnbook version).
  assert.deepEqual(backingRows({ ...UPLOAD, available: false }), { kind: "none" });
  assert.deepEqual(backingRows({ ...UPLOAD, gone: true }), { kind: "none" });
  assert.deepEqual(backingRows({ ...UPLOAD, available: false, fromLink: true }), { kind: "none" });
  assert.deepEqual(backingRows({ ...UPLOAD, hymnbook: true }), { kind: "none" });
  assert.equal(showsBackingRows({ kind: "none" }), false);
  assert.equal(showsBackingRows({ kind: "linkLater" }), true);
  assert.equal(backingCanPlay({ kind: "playable", freshLink: true }), true);
  assert.equal(backingCanPlay({ kind: "transposed", backTo: "Eb major" }), false);
});

test("the Transpose panel warns before moving a sheet with backing, but not on the way back to its key", () => {
  const playable = backingRows(UPLOAD);
  const moved = backingRows({ ...UPLOAD, transposedBy: 2 });
  assert.equal(warnsBeforeTranspose(playable, 0, 0), true);
  assert.equal(warnsBeforeTranspose(playable, 0, 2), true);
  assert.equal(warnsBeforeTranspose(moved, 2, 3), true);
  assert.equal(warnsBeforeTranspose(moved, 2, -2), false);
  assert.equal(warnsBeforeTranspose({ kind: "none" }, 0, 2), false);
  assert.equal(warnsBeforeTranspose({ kind: "linkLater" }, 0, 2), false);
});

test("the words are the boards'", () => {
  assert.equal(BACKING_WORDS.label, "Song backing");
  assert.equal(BACKING_WORDS.transposed, "The backing plays in the song's own key — it's off while the sheet is transposed.");
  assert.equal(BACKING_WORDS.linkLater, "Songs from a link don't keep their backing.");
  assert.equal(BACKING_WORDS.freshLink, "Plays while this sheet is open. Songs from a link don't keep their backing.");
  assert.equal(BACKING_WORDS.rehearse, "It follows the loop and the speed, and stays in the song's key.");
  assert.equal(BACKING_WORDS.beforeTranspose, "The song's backing can't move with it, so it will be off until you move it back.");
  assert.equal(backToLabel("Eb major"), "Back to Eb major");
});
