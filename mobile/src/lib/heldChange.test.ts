import { test } from "node:test";
import assert from "node:assert/strict";
import { createHolds, HOLD_MS, type Clock } from "./heldChange.ts";

/** A clock that only moves when told. */
function fakeClock() {
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let seq = 0;
  const clock: Clock = {
    set(fn, ms) {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clear(handle) {
      timers.delete(handle as number);
    },
  };
  function advance(ms: number) {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  }
  return { clock, advance, pending: () => timers.size };
}

function change() {
  const calls = { commit: 0, undo: 0 };
  return {
    calls,
    change: {
      commit: () => {
        calls.commit += 1;
      },
      undo: () => {
        calls.undo += 1;
      },
    },
  };
}

test("a held change is sent once its 6 s are up, and not before", () => {
  const { clock, advance } = fakeClock();
  const holds = createHolds(clock);
  const { calls, change: c } = change();
  const id = holds.hold(c);
  advance(HOLD_MS - 1);
  assert.equal(calls.commit, 0);
  assert.equal(holds.isHeld(id), true);
  advance(1);
  assert.deepEqual(calls, { commit: 1, undo: 0 });
  assert.equal(holds.isHeld(id), false);
});

test("Undo puts it back and nothing is ever sent", () => {
  const { clock, advance, pending } = fakeClock();
  const holds = createHolds(clock);
  const { calls, change: c } = change();
  const id = holds.hold(c);
  advance(3000);
  assert.equal(holds.undo(id), true);
  advance(HOLD_MS * 2);
  holds.flush();
  assert.deepEqual(calls, { commit: 0, undo: 1 });
  assert.equal(pending(), 0);
});

test("leaving the foreground sends every held change at once, each once", () => {
  const { clock, advance } = fakeClock();
  const holds = createHolds(clock);
  const a = change();
  const b = change();
  holds.hold(a.change);
  holds.hold(b.change);
  holds.flush();
  assert.equal(a.calls.commit, 1);
  assert.equal(b.calls.commit, 1);
  advance(HOLD_MS);
  holds.flush();
  assert.equal(a.calls.commit, 1);
  assert.equal(b.calls.commit, 1);
});

test("once sent it is too late to undo, and once undone it is never sent", () => {
  const { clock } = fakeClock();
  const holds = createHolds(clock);
  const sent = change();
  const sentId = holds.hold(sent.change);
  assert.equal(holds.commit(sentId), true);
  assert.equal(holds.undo(sentId), false);
  assert.equal(holds.commit(sentId), false);
  assert.deepEqual(sent.calls, { commit: 1, undo: 0 });

  const undone = change();
  const undoneId = holds.hold(undone.change);
  assert.equal(holds.undo(undoneId), true);
  assert.equal(holds.commit(undoneId), false);
  assert.deepEqual(undone.calls, { commit: 0, undo: 1 });
});

test("a send that fails or throws does not escape the holds", async () => {
  const { clock } = fakeClock();
  const holds = createHolds(clock);
  holds.hold({ commit: () => Promise.reject(new Error("offline")), undo: () => undefined });
  holds.hold({
    commit: () => {
      throw new Error("bad");
    },
    undo: () => undefined,
  });
  assert.doesNotThrow(() => holds.flush());
  await new Promise((r) => setTimeout(r, 0));
});
