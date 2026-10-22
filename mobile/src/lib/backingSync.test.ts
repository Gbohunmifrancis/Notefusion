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
  NEW_DRIFT_WATCH,
  needsResync,
  parseBackingPrefs,
  rateKeepsBacking,
  showsBackingRows,
  solfaAtBackingRead,
  stepBalance,
  warnsBeforeTranspose,
  watchDrift,
  type BackingFacts,
  type DriftWatch,
} from "./backingSync.ts";
import { SPEEDS } from "./practice.ts";

/** Rehearse's speed steps (components/result/usePractice RATE_STEPS). */
const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("the balance: the backing its share and the solfa the rest, never adding up past full; 40 % is 0.6 : 0.4", () => {
  assert.equal(DEFAULT_BALANCE, 0.4);
  assert.deepEqual(balanceVolumes(0), { solfa: 1, backing: 0 });
  const def = balanceVolumes(0.4);
  near(def.solfa, 0.6);
  near(def.backing, 0.4);
  assert.deepEqual(balanceVolumes(0.5), { solfa: 0.5, backing: 0.5 });
  const lean = balanceVolumes(0.8);
  near(lean.solfa, 0.2);
  near(lean.backing, 0.8);
  assert.deepEqual(balanceVolumes(1), { solfa: 0, backing: 1 });
  for (let b = 0; b <= 1; b += 0.05) {
    const v = balanceVolumes(b);
    assert.ok(v.solfa + v.backing <= 1 + 1e-9, `${b}: the two add up past full`);
  }
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

test("before it starts, the band is put in step past 40 ms (a silent move)", () => {
  assert.equal(needsResync(10.03, 10), false);
  assert.equal(needsResync(10.039, 10), false);
  assert.equal(needsResync(10.05, 10), true);
  assert.equal(needsResync(9.95, 10), true);
});

/** The drift watch read every 250 ms from `start` with these drifts; the times (ms from start) it moved the band. */
function pulls(drifts: number[], start = 0): number[] {
  let watch: DriftWatch = NEW_DRIFT_WATCH;
  const at: number[] = [];
  drifts.forEach((d, i) => {
    const step = watchDrift(watch, d, start + i * 250);
    watch = step.watch;
    if (step.pull) at.push(i * 250);
  });
  return at;
}

test("while both play, the clocks' jitter never moves the band: under 80 ms, or past it for one reading only", () => {
  assert.deepEqual(pulls([0.05, -0.07, 0.06, 0.079, -0.05, 0.02, 0.07, -0.078]), []);
  assert.deepEqual(pulls([0.03, 0.12, 0.02, -0.11, 0.01, 0.13, 0.0, 0.09, 0.03]), [], "a lone reading past the limit is a jitter");
});

test("a drift that holds is pulled back once it has held 400 ms, then a small one waits 3 s before the next move", () => {
  // Past the limit from the second reading on: first move at 500 ms (held 250 ms, then 500 ms); it keeps drifting,
  // and the next move waits for the cooldown: 3.5 s.
  const drifting = [0.0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
  assert.deepEqual(pulls(drifting), [750, 3750]);
});

test("a big drift (a stall) is pulled back as soon as it has held, cooldown or not", () => {
  const stall = [0.0, 0.1, 0.1, 0.1, 0.0, 0.4, 0.4, 0.4];
  assert.deepEqual(pulls(stall), [750, 1750]);
  assert.equal(watchDrift(NEW_DRIFT_WATCH, Number.NaN, 0).pull, false, "an unreadable clock is no drift");
});

/**
 * The tick as useBacking reads it, both players in step unless `realDrift` says otherwise: the solfa, then the backing
 * `delays[i][0]` s later (the main thread busy), then the solfa again `delays[i][1]` s after that. `bracketed` false is
 * the old way: the solfa then the backing, compared as read. Returns when the band was moved.
 */
function busyPulls(delays: [number, number][], bracketed: boolean, realDrift = 0): number[] {
  let watch: DriftWatch = NEW_DRIFT_WATCH;
  const at: number[] = [];
  delays.forEach(([toBacking, toSolfa], i) => {
    const t = i * 0.25;
    const before = t;
    const backing = t + toBacking + realDrift;
    const after = t + toBacking + toSolfa;
    const clip = bracketed ? solfaAtBackingRead(before, after) : before;
    if (clip === null) return;
    const step = watchDrift(watch, backing - clip, i * 250);
    watch = step.watch;
    if (step.pull) at.push(i * 250);
  });
  return at;
}

test("a busy main thread is no drift: the backing is read between two reads of the solfa, and a far-apart pair is skipped", () => {
  // Dragging the balance: every read waits 60–300 ms on the main thread, the music in step all along.
  const dragging: [number, number][] = [[0.002, 0.002], [0.12, 0.09], [0.15, 0.11], [0.3, 0.2], [0.09, 0.1], [0.11, 0.13], [0.002, 0.003]];
  assert.ok(busyPulls(dragging, false).length > 0, "read back to back, the wait itself reads as a drift and moves the band");
  assert.deepEqual(busyPulls(dragging, true), [], "bracketed, the busy readings are skipped and the quiet ones agree");
  // A quiet phone: reads a few ms apart are compared, the solfa taken at their middle.
  near(solfaAtBackingRead(10, 10.004)!, 10.002);
  assert.equal(solfaAtBackingRead(10, 10.05), null, "50 ms apart: too far to compare");
  assert.equal(solfaAtBackingRead(10, 4), null, "went back (the A–B loop jumped): not a reading");
  assert.equal(solfaAtBackingRead(10, Number.NaN), null);
});

test("a real drift is still pulled back on a quiet phone, and once the busy moment passes", () => {
  const quiet: [number, number][] = Array.from({ length: 6 }, () => [0.003, 0.003]);
  assert.deepEqual(busyPulls(quiet, true, 0.12), [250 * 2], "past the limit from the first reading, held 400 ms by the third");
  const busyThenQuiet: [number, number][] = [[0.2, 0.2], [0.2, 0.2], [0.003, 0.003], [0.003, 0.003], [0.003, 0.003], [0.003, 0.003]];
  assert.deepEqual(busyPulls(busyThenQuiet, true, 0.12), [250 * 4]);
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
