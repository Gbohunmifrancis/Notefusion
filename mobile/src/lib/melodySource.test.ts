import { test } from "node:test";
import assert from "node:assert/strict";
import { runSliced, sourceKey, voicesSource, type VoicesSource } from "./melodySource.ts";

const note = (pitchMidi: number, startBeat: number) => ({ pitchMidi, startBeat, durBeats: 1, conf: 0.9 }) as never;
const tune = (tempoBpm = 90): VoicesSource => ({ voices: [{ notes: [note(60, 0), note(62, 1), note(64, 2)], gain: 1 }], tempoBpm });

test("the same recipe names the same clip, whatever object carries it", () => {
  assert.equal(sourceKey(tune()), sourceKey(tune()));
  assert.match(sourceKey(tune()), /^[0-9a-f]{16}$/);
});

test("anything the clip would sound different for names another clip", () => {
  const keys = new Set([
    sourceKey(tune()),
    sourceKey(tune(91)), // tempo
    sourceKey({ ...tune(), opts: { countInBars: 1 } }), // a count-in
    sourceKey({ voices: [{ ...tune().voices[0]!, gain: 0.8 }], tempoBpm: 90 }), // a part's level
    sourceKey({ voices: [{ notes: [note(60, 0), note(62, 1), note(65, 2)], gain: 1 }], tempoBpm: 90 }), // one note
    sourceKey({ voices: [...tune().voices, { notes: [note(48, 0)], gain: 0.8 }], tempoBpm: 90 }), // a part added
  ]);
  assert.equal(keys.size, 6);
});

/** A render that takes `ms` of work per step, `steps` times, and returns how many steps ran. */
function* busy(steps: number, ms: number): Generator<void, number, void> {
  for (let i = 0; i < steps; i++) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // work
    }
    yield;
  }
  return steps;
}

test("a long render gives the screen turns and finishes with its value", async () => {
  let turns = 0;
  const tick = setInterval(() => (turns += 1), 0);
  const value = await runSliced(busy(20, 5), () => false);
  clearInterval(tick);
  assert.equal(value, 20);
  assert.ok(turns >= 3, `the event loop ran ${turns} times during 100 ms of work`);
});

test("a render cancelled at its next turn gives nothing", async () => {
  let cancel = false;
  setTimeout(() => (cancel = true), 0);
  assert.equal(await runSliced(busy(50, 5), () => cancel), null);
});

test("voices with no notes are nothing to play, so no player is shown", () => {
  assert.equal(voicesSource([{ notes: [], gain: 1 }, { notes: [], gain: 0.8 }], 90), null);
  assert.equal(voicesSource([], 90), null);
  assert.deepEqual(voicesSource(tune().voices, 90), tune());
});
