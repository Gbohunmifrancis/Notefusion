import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAB_DOCKED_CENTRE,
  TAB_DOCKED_SIDE,
  TAB_DOCK_FONT_SCALE,
  dockedExtraRoom,
  tabBarLayout,
  tabBarTop,
} from "./tabBarLayout.ts";

test("below 1.3x the bar floats as before, its labels capped at 1.2x", () => {
  for (const scale of [0.85, 1, 1.15, 1.2, 1.29]) {
    assert.deepEqual(tabBarLayout(scale), { docked: false, height: 64, labelMaxScale: 1.2 });
  }
});

test("from 1.3x the bar docks: 72 tall, the labels growing to 1.5x", () => {
  for (const scale of [TAB_DOCK_FONT_SCALE, 1.5, 2]) {
    assert.deepEqual(tabBarLayout(scale), { docked: true, height: 72, labelMaxScale: 1.5 });
  }
});

test("docked on a 360 dp phone, each labelled cell is 72 dp: room for Practice at 18 px (71.8)", () => {
  const cell = (360 - TAB_DOCKED_CENTRE - 2 * TAB_DOCKED_SIDE) / 4;
  assert.equal(cell, 72);
  assert.ok(cell >= 71.8);
});

test("the floating bar's top: 64 tall, at least 8 off the bottom, lifted 4", () => {
  assert.equal(tabBarTop(1, 0), 76);
  assert.equal(tabBarTop(1, 24), 92);
  assert.equal(tabBarTop(1, 34), 102);
});

test("the docked bar's top: 72 over the safe area", () => {
  assert.equal(tabBarTop(1.5, 0), 72);
  assert.equal(tabBarTop(1.5, 34), 106);
});

test("a tab adds room only where the docked bar stands higher, and never below 1.3x", () => {
  assert.equal(dockedExtraRoom(1, 34), 0);
  assert.equal(dockedExtraRoom(1.2, 34), 0);
  // No inset: the docked bar is lower than the floating one, so nothing is added.
  assert.equal(dockedExtraRoom(1.5, 0), 0);
  assert.equal(dockedExtraRoom(1.5, 4), 0);
  // An inset the floating bar sat on: 4 dp more.
  assert.equal(dockedExtraRoom(1.5, 8), 4);
  assert.equal(dockedExtraRoom(1.5, 34), 4);
  assert.equal(dockedExtraRoom(1.5, 48), 4);
});
