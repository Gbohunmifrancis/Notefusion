import { test } from "node:test";
import assert from "node:assert/strict";
import { DOH_MS, IDLE_FOR_MS, TILT_GAP_MS, TILT_MS, idleSchedule } from "./dohMotion.ts";

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test("the board's timings: hop 480, blink 140, tilt 240 in and out over 1140, cheer 520, tap 300", () => {
  assert.equal(DOH_MS.hop, 480);
  assert.equal(DOH_MS.blink, 140);
  assert.equal(DOH_MS.tiltIn, 240);
  assert.equal(DOH_MS.tiltOut, 240);
  assert.equal(TILT_MS, 1140);
  assert.equal(DOH_MS.cheer, 520);
  assert.equal(DOH_MS.tap, 300);
});

test("idle moves all end within 30 s", () => {
  for (let seed = 1; seed < 50; seed++) {
    for (const m of idleSchedule(seeded(seed))) {
      assert.ok(m.at >= 0);
      assert.ok(m.at + (m.move === "tilt" ? TILT_MS : DOH_MS.blink) <= IDLE_FOR_MS, `${seed} ${m.move}@${m.at}`);
    }
  }
});

test("blinks come every 4 to 7 s, and tilts at most once every 10 s", () => {
  for (let seed = 1; seed < 50; seed++) {
    const moves = idleSchedule(seeded(seed));
    const tilts = moves.filter((m) => m.move === "tilt").map((m) => m.at);
    for (let i = 1; i < tilts.length; i++) assert.ok(tilts[i]! - tilts[i - 1]! >= TILT_GAP_MS, `${seed}`);
    const blinks = moves.filter((m) => m.move === "blink").map((m) => m.at);
    assert.ok(blinks[0]! >= 4000 && blinks[0]! <= 7000, `${seed} first blink ${blinks[0]}`);
    assert.ok(blinks.length >= 2, `${seed}`);
  }
});

test("no blink falls inside a tilt (the tilt has its own)", () => {
  for (let seed = 1; seed < 50; seed++) {
    const moves = idleSchedule(seeded(seed));
    const tilts = moves.filter((m) => m.move === "tilt").map((m) => m.at);
    for (const b of moves.filter((m) => m.move === "blink")) {
      assert.ok(!tilts.some((t) => b.at + DOH_MS.blink >= t && b.at <= t + TILT_MS), `${seed} blink@${b.at}`);
    }
  }
});

test("a Doh with nothing to lean toward only blinks", () => {
  assert.ok(idleSchedule(seeded(7), false).every((m) => m.move === "blink"));
});
