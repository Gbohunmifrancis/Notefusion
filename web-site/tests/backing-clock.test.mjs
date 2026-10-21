// node --test web-site/tests/*.test.mjs
// backing-clock.js places a notation beat in the song's recording (the shared backing contract); choir.js's transport
// plays the notes on that clock. The mapping's cases mirror mobile/src/lib/backingClock.test.ts. The scheduling cases
// drive the transport the way the rehearsal player does (a tick every ~60 ms handing out the next 0.25 s) and prove
// that every note of the sheet, and of a loop, is played exactly once per pass, at its own beat, at 0.5, 0.75 and 1×.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
const context = vm.createContext({ window });
vm.runInContext(readFileSync(new URL("../assets/backing-clock.js", import.meta.url), "utf8"), context);
vm.runInContext(readFileSync(new URL("../assets/choir.js", import.meta.url), "utf8"), context);
const BC = window.NfBackingClock;
const C = window.NfChoir;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ""} ${a} ≠ ${b}`);

// ── The mapping ─────────────────────────────────────────────────────────────
test("without beat times a beat is the origin plus beats at the tempo", () => {
  const clock = { tempo: 72, beatOriginSec: 4.2, beatTimesSec: null };
  close(BC.audioTimeOfBeat(0, clock), 4.2);
  close(BC.audioTimeOfBeat(8, clock), 4.2 + (8 * 60) / 72);
  close(BC.audioTimeOfBeat(2.5, clock), 4.2 + (2.5 * 60) / 72);
  close(BC.audioTimeOfBeat(-1, clock), 4.2 - 60 / 72, "a pickup before beat 0");
  // An empty list, or none at all, is the same clock.
  close(BC.audioTimeOfBeat(8, { ...clock, beatTimesSec: [] }), 4.2 + (8 * 60) / 72);
  close(BC.audioTimeOfBeat(8, { tempo: 72, beatOriginSec: 4.2 }), 4.2 + (8 * 60) / 72);
  close(BC.audioTimeOfBeat(3, { tempo: 120 }), 1.5, "no origin is 0");
});

test("with beat times a beat is interpolated, and extrapolated before 0 and past the end", () => {
  // Beats 0–4 of a singer who pushes on: intervals 0.5, 0.6, 0.5, 0.6.
  const clock = { tempo: 100, beatOriginSec: 9, beatTimesSec: [1.0, 1.5, 2.1, 2.6, 3.2] };
  close(BC.audioTimeOfBeat(0, clock), 1.0, "the entries themselves; the origin is not used");
  close(BC.audioTimeOfBeat(2, clock), 2.1);
  close(BC.audioTimeOfBeat(4, clock), 3.2);
  close(BC.audioTimeOfBeat(2.5, clock), 2.35, "linear between entries");
  close(BC.audioTimeOfBeat(1.25, clock), 1.65);
  close(BC.audioTimeOfBeat(-1, clock), 0.5, "a pickup: on with the first interval");
  close(BC.audioTimeOfBeat(-0.5, clock), 0.75);
  close(BC.audioTimeOfBeat(5, clock), 3.8, "past the end: on with the last interval");
  close(BC.audioTimeOfBeat(6.5, clock), 4.7);
  // One entry: past it and before it at the tempo.
  close(BC.audioTimeOfBeat(2, { tempo: 120, beatTimesSec: [3] }), 4);
  close(BC.audioTimeOfBeat(-1, { tempo: 120, beatTimesSec: [3] }), 2.5);
});

test("beatOfAudioTime is the mapping's inverse, both ways and past both ends", () => {
  const clocks = [
    { tempo: 72, beatOriginSec: 4.2 },
    { tempo: 100, beatTimesSec: [1.0, 1.5, 2.1, 2.6, 3.2] },
    { tempo: 120, beatTimesSec: [3] },
  ];
  for (const clock of clocks) {
    for (let b = -2; b <= 8; b += 0.25) close(BC.beatOfAudioTime(BC.audioTimeOfBeat(b, clock), clock), b, `beat ${b}`);
  }
});

test("the balance keeps the louder side at full: 40 % is the backing at two-thirds", () => {
  assert.deepEqual({ ...BC.balanceGains(0.5) }, { solfa: 1, backing: 1 });
  assert.deepEqual({ ...BC.balanceGains(0) }, { solfa: 1, backing: 0 }, "all the way to Solfa: the piano alone");
  assert.deepEqual({ ...BC.balanceGains(1) }, { solfa: 0, backing: 1 }, "all the way to Backing: the band alone");
  const def = BC.balanceGains(BC.DEFAULT_BALANCE);
  assert.equal(BC.DEFAULT_BALANCE, 0.4);
  close(def.solfa, 1); close(def.backing, 2 / 3);
  const toBand = BC.balanceGains(0.75);
  close(toBand.solfa, 1 / 3); close(toBand.backing, 1);
  assert.deepEqual({ ...BC.balanceGains("nonsense") }, { ...def }, "anything else is the default");
  assert.deepEqual({ ...BC.balanceGains(7) }, { solfa: 0, backing: 1 }, "clamped");
});

// ── Scheduling ──────────────────────────────────────────────────────────────
// Abide with Me's first four bars in 4/4 (16 beats), with a held note, quavers, and an alto under two of them.
const NOTES = [
  [0, 1.5], [1.5, 0.5], [2, 2], [4, 3], [7, 1], [8, 1], [9, 0.5], [9.5, 0.5], [10, 2], [12, 2], [14, 2],
  [12, 1], [13, 1], // a second voice, sounding with the tune
];
const EVENTS = NOTES.map(([beat, dur], id) => ({ beat, dur, id })).sort((a, b) => a.beat - b.beat || a.id - b.id);
const END_BEAT = 16;
const CLOCKS = {
  tempo: { tempo: 72, beatOriginSec: 4.2, beatTimesSec: null },
  // The recording's own beats: a little rubato, and a pickup's worth of silence before beat 0.
  "beat times": { tempo: 72, beatOriginSec: 0, beatTimesSec: Array.from({ length: 17 }, (_, i) => 0.9 + i * 0.83 + 0.04 * Math.sin(i * 1.7)) },
};
const SPEEDS = [0.5, 0.75, 1];
const TICKS = [0.06, 0.071, 0.049, 0.083, 0.06, 0.055, 0.112]; // setInterval(60) as browsers run it, with a late one

/** Ticks a started transport like the player; `at(now)` may change it between ticks. Returns everything handed out. */
function drive(transport, { from, startAt = 0.05, until = 200, at, stopAfterWraps = Infinity }) {
  transport.start(from, startAt);
  const out = [];
  let now = 0, k = 0, wraps = 0;
  while (now < until) {
    if (at) at(now, transport);
    for (const d of transport.pull(now + 0.25)) {
      out.push(d);
      if (d.kind === "wrap") wraps++;
    }
    if (!transport.running() || wraps >= stopAfterWraps) break;
    now += TICKS[k++ % TICKS.length];
  }
  return out;
}
const A = (beat, clock) => BC.audioTimeOfBeat(beat, clock);

for (const [name, clock] of Object.entries(CLOCKS)) {
  for (const speed of SPEEDS) {
    test(`every note of the sheet plays once, at its own beat, at ${speed}× (${name})`, () => {
      const t = C.createTransport(EVENTS, END_BEAT, clock);
      t.setRate(speed);
      const start = 0.05;
      const out = drive(t, { from: 0, startAt: start });
      const notes = out.filter((d) => d.kind === "note");
      assert.deepEqual(notes.map((d) => d.event.id).sort((a, b) => a - b), EVENTS.map((e) => e.id).sort((a, b) => a - b), "each note exactly once");
      for (const d of notes) close(d.when, start + (A(d.event.beat, clock) - A(0, clock)) / speed, `note ${d.event.id}`);
      for (let i = 1; i < notes.length; i++) assert.ok(notes[i].when >= notes[i - 1].when, "in order");
      const end = out.at(-1);
      assert.equal(end.kind, "end");
      close(end.when, start + (A(END_BEAT, clock) - A(0, clock)) / speed, "ends with the last note");
      // The backing starts where beat 0 falls in the recording and runs at the speed.
      close(t.audioAt(start), A(0, clock));
      close(t.audioAt(start + 2), A(0, clock) + 2 * speed);
    });

    test(`from the middle, the backing starts at audioTimeOfBeat(from) and the notes before are not played (${speed}×, ${name})`, () => {
      const t = C.createTransport(EVENTS, END_BEAT, clock);
      t.setRate(speed);
      const out = drive(t, { from: 9, startAt: 1 });
      const ids = out.filter((d) => d.kind === "note").map((d) => d.event.id);
      assert.deepEqual(ids.sort((a, b) => a - b), EVENTS.filter((e) => e.beat >= 9).map((e) => e.id).sort((a, b) => a - b));
      close(t.audioAt(1), A(9, clock));
      close(t.beatAt(1), 9);
    });

    test(`every note of a loop plays once per pass, and the backing seeks back with it (${speed}×, ${name})`, () => {
      const t = C.createTransport(EVENTS, END_BEAT, clock);
      t.setRate(speed);
      t.setLoop(8, 12); // bar 3: beats 8 to 12
      const out = drive(t, { from: 8, startAt: 0.05, stopAfterWraps: 4 });
      const inLoop = EVENTS.filter((e) => e.beat >= 8 && e.beat < 12).map((e) => e.id);
      const passes = [[]];
      const starts = [0.05];
      for (const d of out) {
        if (d.kind === "wrap") { assert.equal(d.beat, 8); passes.push([]); starts.push(d.when); continue; }
        assert.equal(d.kind, "note");
        passes.at(-1).push(d);
      }
      passes.pop(); // the pass the drive stopped in
      assert.equal(passes.length, 4);
      const length = (A(12, clock) - A(8, clock)) / speed;
      passes.forEach((pass, p) => {
        assert.deepEqual(pass.map((d) => d.event.id), inLoop, `pass ${p + 1}: each note of the loop once, in order`);
        for (const d of pass) close(d.when, starts[p] + (A(d.event.beat, clock) - A(8, clock)) / speed);
        close(starts[p + 1] - starts[p], length, "a pass lasts the loop");
        // Just after the wrap the recording is back at the loop's first beat.
        close(t.audioAt(starts[p + 1] + 1e-6), A(8, clock) + 1e-6 * speed);
      });
    });
  }
}

test("a change of speed mid-play neither drops nor repeats a note, and the backing's place never jumps", () => {
  for (const clock of Object.values(CLOCKS)) {
    const t = C.createTransport(EVENTS, END_BEAT, clock);
    const changes = [[1.3, 0.75], [3.1, 0.5], [6.2, 1], [7.0, 0.75]];
    let next = 0;
    const out = drive(t, {
      from: 0,
      at: (now, tr) => { while (next < changes.length && now >= changes[next][0]) tr.setRate(changes[next++][1]); },
    });
    const notes = out.filter((d) => d.kind === "note");
    assert.deepEqual(notes.map((d) => d.event.id).sort((a, b) => a - b), EVENTS.map((e) => e.id).sort((a, b) => a - b));
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].when >= notes[i - 1].when - 1e-9, "still in order");
    for (let s = 0.05; s < out.at(-1).when; s += 0.01) assert.ok(Math.abs(t.audioAt(s + 0.005) - t.audioAt(s)) < 0.006, "continuous");
  }
});

test("a loop set while playing elsewhere moves to its start once what is queued has played", () => {
  const clock = CLOCKS.tempo;
  const t = C.createTransport(EVENTS, END_BEAT, clock);
  let set = false;
  const out = drive(t, { from: 0, stopAfterWraps: 2, at: (now, tr) => { if (!set && now > 0.5) { set = true; tr.setLoop(12, 16); } } });
  const ids = out.filter((d) => d.kind === "note").map((d) => d.event.id);
  for (const e of EVENTS) {
    const n = ids.filter((id) => id === e.id).length;
    // Bar 1's first notes were already queued; after that only the loop plays, twice through before the drive stops.
    if (e.beat >= 12) assert.ok(n >= 2, `loop note ${e.id} each pass`);
    else assert.ok(n <= 1, `note ${e.id} at most once`);
  }
  const wraps = out.filter((d) => d.kind === "wrap");
  assert.ok(wraps.every((w) => w.beat === 12));
});
