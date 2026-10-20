import { test } from "node:test";
import assert from "node:assert/strict";
import { leaveThrough, setLeaveGuard } from "./leaveGuard.ts";

test("with no guard, leaving goes at once", () => {
  setLeaveGuard(null);
  let went = false;
  leaveThrough(() => { went = true; });
  assert.equal(went, true);
});

test("a guard holds the move until the person agrees, and clearing it lets the next one through", () => {
  let ask: (() => void) | null = null;
  setLeaveGuard((proceed) => { ask = proceed; });
  let went = false;
  leaveThrough(() => { went = true; });
  assert.equal(went, false);
  assert.ok(ask);
  (ask as () => void)();
  assert.equal(went, true);

  setLeaveGuard(null);
  let again = false;
  leaveThrough(() => { again = true; });
  assert.equal(again, true);
});

test("a guard that says no never moves", () => {
  setLeaveGuard(() => { /* the person kept recording */ });
  let went = false;
  leaveThrough(() => { went = true; });
  assert.equal(went, false);
  setLeaveGuard(null);
});
