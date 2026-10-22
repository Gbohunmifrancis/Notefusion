// node --test web-site/tests/*.test.mjs
// backing-clock.js places a notation beat in the song's recording (the shared backing contract); choir.js's transport
// plays the notes on that clock. The mapping's cases are mobile/src/lib/backingClock.test.ts's, number for number. The
// scheduling cases drive the transport the way the rehearsal player does (a tick every ~60 ms handing out the next
// 0.25 s) over the phone's sixteen bars of Abide with Me, and prove that every note of the sheet, and of a loop, is
// played exactly once per pass, at its own beat, at 0.5, 0.75 and 1×.
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
const { audioTimeOfBeat, beatOfAudioTime, hasBeatTimes } = BC;
const near = (actual, expected, eps = 1e-9, msg = "") => assert.ok(Math.abs(actual - expected) <= eps, `${msg} ${actual} is not ${expected}`);

// Abide with Me as the band's take hears it (board O1): 72 BPM, 4/4, 16 bars, the band's beat 0 at 1.25 s.
const PLAIN = { tempo: 72, beatOriginSec: 1.25 };
// The same take with the band's own beat times: it pushes a little, then drags (0.80, 0.82, 0.86, … s a beat).
const BEATS = [];
{
  let t = 1.25;
  for (let i = 0; i <= 64; i++) {
    BEATS.push(Math.round(t * 1e6) / 1e6);
    t += 0.8 + 0.06 * Math.sin(i / 5);
  }
}
const MOVING = { tempo: 72, beatOriginSec: 1.25, beatTimesSec: BEATS };

/** Sixteen bars of 4/4: held notes, a bar of crotchets, two quavers sharing a beat, and a last held doh. */
function abide() {
  const rows = [
    [[0, 2], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 4]],
    [[0, 2], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 0.5], [3.5, 0.5]], [[0, 4]],
    [[0, 2], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 4]],
    [[0, 2], [2, 1], [3, 1]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 4]],
  ];
  const out = [];
  rows.forEach((bar, b) => bar.forEach(([at, dur]) => out.push({ startBeat: b * 4 + at, durBeats: dur })));
  return out;
}

// ── The mapping (the phone's cases) ─────────────────────────────────────────
test("without beat times a beat is beatOriginSec + beat * 60 / tempo, a pickup and past the end included", () => {
  near(audioTimeOfBeat(0, PLAIN), 1.25);
  near(audioTimeOfBeat(8, PLAIN), 1.25 + 8 * (60 / 72));
  // A beat's pickup sits a beat before beat 0.
  near(audioTimeOfBeat(-1, PLAIN), 1.25 - 60 / 72);
  // Past the last note the tempo simply carries on.
  near(audioTimeOfBeat(100, PLAIN), 1.25 + 100 * (60 / 72));
  // No origin: beat 0 is the start of the recording.
  near(audioTimeOfBeat(4, { tempo: 120 }), 2);
  assert.equal(hasBeatTimes(PLAIN), false);
  assert.equal(hasBeatTimes({ tempo: 72, beatTimesSec: [] }), false);
  assert.equal(hasBeatTimes({ tempo: 72, beatTimesSec: null }), false);
});

test("with beat times a beat is read off them: between entries linearly, a pickup from the first interval, past the end from the last", () => {
  const clock = { tempo: 60, beatOriginSec: 99, beatTimesSec: [2, 3, 3.5, 4.5] };
  assert.equal(hasBeatTimes(clock), true);
  // The entries themselves; beatOriginSec and tempo are not used.
  near(audioTimeOfBeat(0, clock), 2);
  near(audioTimeOfBeat(2, clock), 3.5);
  near(audioTimeOfBeat(3, clock), 4.5);
  // Between entries.
  near(audioTimeOfBeat(0.5, clock), 2.5);
  near(audioTimeOfBeat(1.5, clock), 3.25);
  near(audioTimeOfBeat(2.25, clock), 3.75);
  // A pickup: before beat 0 the first interval (1 s) carries back.
  near(audioTimeOfBeat(-1, clock), 1);
  near(audioTimeOfBeat(-0.5, clock), 1.5);
  // Past the last entry the last interval (1 s) carries on.
  near(audioTimeOfBeat(4, clock), 5.5);
  near(audioTimeOfBeat(5.5, clock), 7);
  // A single entry has no interval of its own: the tempo carries on from it.
  near(audioTimeOfBeat(2, { tempo: 60, beatTimesSec: [4] }), 6);
  near(audioTimeOfBeat(-1, { tempo: 60, beatTimesSec: [4] }), 3);
});

test("beat times that are not increasing are not used: the tempo stands", () => {
  const broken = { tempo: 60, beatOriginSec: 1, beatTimesSec: [2, 2, 3] };
  assert.equal(hasBeatTimes(broken), false);
  near(audioTimeOfBeat(2, broken), 3);
});

test("beatOfAudioTime undoes audioTimeOfBeat everywhere: a pickup, between entries and past the end", () => {
  for (const clock of [PLAIN, MOVING, { tempo: 60, beatTimesSec: [4] }]) {
    for (const b of [-2, -0.5, 0, 0.25, 3, 7.5, 31.9, 64, 70.5]) near(beatOfAudioTime(audioTimeOfBeat(b, clock), clock), b, 1e-7);
  }
});

test("the balance never adds up past full: the backing its share, the solfa the rest; 40 % is 0.6 : 0.4", () => {
  assert.deepEqual({ ...BC.balanceGains(0.5) }, { solfa: 0.5, backing: 0.5 });
  assert.deepEqual({ ...BC.balanceGains(0) }, { solfa: 1, backing: 0 }, "all the way to Solfa: the piano alone");
  assert.deepEqual({ ...BC.balanceGains(1) }, { solfa: 0, backing: 1 }, "all the way to Backing: the band alone");
  const def = BC.balanceGains(BC.DEFAULT_BALANCE);
  assert.equal(BC.DEFAULT_BALANCE, 0.4);
  near(def.solfa, 0.6); near(def.backing, 0.4);
  const toBand = BC.balanceGains(0.75);
  near(toBand.solfa, 0.25); near(toBand.backing, 0.75);
  for (let x = 0; x <= 1; x += 0.05) { const g = BC.balanceGains(x); assert.ok(g.solfa + g.backing <= 1 + 1e-9, String(x)); }
  assert.deepEqual({ ...BC.balanceGains("nonsense") }, { ...def }, "anything else is the default");
  assert.deepEqual({ ...BC.balanceGains(7) }, { solfa: 0, backing: 1 }, "clamped");
});

/** The drift watch read every 250 ms with these drifts; the times (ms from the start) it moved the band. */
function pulls(drifts) {
  let watch = { overSince: null, lastPullAt: null };
  const at = [];
  drifts.forEach((d, i) => { const step = BC.watchDrift(watch, d, i * 250); watch = step.watch; if (step.pull) at.push(i * 250); });
  return at;
}

test("while both play, the clocks' jitter never moves the band (mobile backingSync's watchDrift, same cases)", () => {
  assert.deepEqual(pulls([0.05, -0.07, 0.06, 0.079, -0.05, 0.02, 0.07, -0.078]), []);
  assert.deepEqual(pulls([0.03, 0.12, 0.02, -0.11, 0.01, 0.13, 0.0, 0.09, 0.03]), [], "a lone reading past the limit is a jitter");
});

test("a drift that holds moves the band after 400 ms, a small one again only after 3 s, a stall at once", () => {
  assert.deepEqual(pulls([0.0, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]), [750, 3750]);
  assert.deepEqual(pulls([0.0, 0.1, 0.1, 0.1, 0.0, 0.4, 0.4, 0.4]), [750, 1750]);
  assert.equal(BC.watchDrift({ overSince: null, lastPullAt: null }, NaN, 0).pull, false, "an unreadable clock is no drift");
});

// ── Scheduling: choir.js's transport on that clock ──────────────────────────
const NOTES = abide();
const EVENTS = NOTES.map((n, id) => ({ beat: n.startBeat, dur: n.durBeats, id }));
const END_BEAT = Math.max(...NOTES.map((n) => n.startBeat + n.durBeats));
const SPEEDS = [0.5, 0.75, 1];
const TICKS = [0.06, 0.071, 0.049, 0.083, 0.06, 0.055, 0.112]; // setInterval(60) as browsers run it, with a late one
const ids = (list) => list.map((d) => d.event.id);

/** Ticks a started transport like the player; `at(now)` may change it between ticks. Returns everything handed out. */
function drive(transport, { from, startAt = 0.05, until = 400, at, stopAfterWraps = Infinity }) {
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

for (const [name, clock] of [["tempo", PLAIN], ["beat times", MOVING]]) {
  for (const speed of SPEEDS) {
    test(`every note of the sheet is played exactly once, at its own beat, in step with the backing at ${speed}× (${name})`, () => {
      const t = C.createTransport(EVENTS, END_BEAT, clock);
      t.setRate(speed);
      const start = 0.05;
      const out = drive(t, { from: 0, startAt: start });
      const notes = out.filter((d) => d.kind === "note");
      assert.deepEqual(ids(notes), EVENTS.map((e) => e.id), "each note exactly once, in the sheet's order");
      // Each note sounds when the backing, started at beat 0's place and running at the speed, reaches its beat.
      for (const d of notes) near(audioTimeOfBeat(0, clock) + (d.when - start) * speed, audioTimeOfBeat(d.event.beat, clock), 1e-9, `note ${d.event.id}`);
      const end = out.at(-1);
      assert.equal(end.kind, "end");
      near(end.when, start + (audioTimeOfBeat(END_BEAT, clock) - audioTimeOfBeat(0, clock)) / speed, 1e-9, "ends with the last note");
      // The backing starts at audioTimeOfBeat(0) and runs at the speed.
      near(t.audioAt(start), audioTimeOfBeat(0, clock));
      near(t.audioAt(start + 2), audioTimeOfBeat(0, clock) + 2 * speed);
    });

    test(`from the middle, the backing starts at audioTimeOfBeat(from) and no earlier note plays (${speed}×, ${name})`, () => {
      const t = C.createTransport(EVENTS, END_BEAT, clock);
      t.setRate(speed);
      const out = drive(t, { from: 22, startAt: 1 });
      assert.deepEqual(ids(out.filter((d) => d.kind === "note")), EVENTS.filter((e) => e.beat >= 22).map((e) => e.id));
      near(t.audioAt(1), audioTimeOfBeat(22, clock));
      near(t.beatAt(1), 22, 1e-7);
    });

    test(`a loop of bars 3–4 plays each of its notes exactly once per pass and none of the bars around it (${speed}×, ${name})`, () => {
      const inLoop = EVENTS.filter((e) => e.beat >= 8 && e.beat < 16).map((e) => e.id);
      assert.equal(inLoop.length, 5, "bar 3's four crotchets and bar 4's held note");
      const t = C.createTransport(EVENTS, END_BEAT, clock);
      t.setRate(speed);
      t.setLoop(8, 16);
      const out = drive(t, { from: 8, startAt: 0.05, stopAfterWraps: 3 });
      const passes = [[]], starts = [0.05];
      for (const d of out) {
        if (d.kind === "wrap") { assert.equal(d.beat, 8); passes.push([]); starts.push(d.when); continue; }
        assert.equal(d.kind, "note");
        passes.at(-1).push(d);
      }
      passes.pop(); // the pass the drive stopped in
      assert.equal(passes.length, 3);
      const length = (audioTimeOfBeat(16, clock) - audioTimeOfBeat(8, clock)) / speed;
      passes.forEach((pass, p) => {
        assert.deepEqual(ids(pass), inLoop, `pass ${p + 1}: each note of the loop once, in order`);
        for (const d of pass) near(audioTimeOfBeat(8, clock) + (d.when - starts[p]) * speed, audioTimeOfBeat(d.event.beat, clock), 1e-9);
        near(starts[p + 1] - starts[p], length, 1e-9, "a pass lasts the loop");
        // The band goes back to its own bar 3 with each wrap: the song's beat 8.
        near(t.audioAt(starts[p + 1] + 1e-6), audioTimeOfBeat(8, clock) + 1e-6 * speed, 1e-9);
      });
      // The note on the loop's end (bar 5's first) belongs to the next bar, not to the loop.
      assert.ok(!out.some((d) => d.kind === "note" && d.event.beat === 16));
    });
  }
}

test("a loop starting on a beat a float's dust away still takes its first note once a pass", () => {
  const events = [{ beat: 7.9999999999, dur: 1, id: 0 }, { beat: 9, dur: 1, id: 1 }, { beat: 11.99999999999, dur: 1, id: 2 }];
  const t = C.createTransport(events, 13, PLAIN);
  t.setRate(0.75);
  t.setLoop(8, 12);
  const out = drive(t, { from: 8, stopAfterWraps: 2 });
  // Each whole pass: the note a dust before beat 8 is the loop's first, the one a dust before 12 belongs to the next bar.
  const passes = [[]];
  for (const d of out) { if (d.kind === "wrap") passes.push([]); else passes.at(-1).push(d.event.id); }
  passes.pop();
  assert.deepEqual(passes, [[0, 1], [0, 1]]);
});

test("a change of speed mid-play neither drops nor repeats a note, and the backing's place never jumps", () => {
  for (const clock of [PLAIN, MOVING]) {
    const t = C.createTransport(EVENTS, END_BEAT, clock);
    const changes = [[1.3, 0.75], [3.1, 0.5], [6.2, 1], [7.0, 0.75], [20.4, 0.5]];
    let next = 0;
    const out = drive(t, { from: 0, at: (now, tr) => { while (next < changes.length && now >= changes[next][0]) tr.setRate(changes[next++][1]); } });
    const notes = out.filter((d) => d.kind === "note");
    assert.deepEqual(ids(notes), EVENTS.map((e) => e.id));
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].when >= notes[i - 1].when - 1e-9, "still in order");
    for (let s = 0.05; s < out.at(-1).when; s += 0.01) assert.ok(Math.abs(t.audioAt(s + 0.005) - t.audioAt(s)) < 0.006, "continuous");
  }
});

test("a loop set while playing elsewhere moves to its start once what is queued has played", () => {
  const t = C.createTransport(EVENTS, END_BEAT, PLAIN);
  let set = false;
  const out = drive(t, { from: 0, stopAfterWraps: 2, at: (now, tr) => { if (!set && now > 0.5) { set = true; tr.setLoop(48, 52); } } });
  const got = out.filter((d) => d.kind === "note").map((d) => d.event.id);
  for (const e of EVENTS) {
    const n = got.filter((id) => id === e.id).length;
    // Bar 1's first notes were already queued; after that only the loop plays, twice through before the drive stops.
    if (e.beat >= 48 && e.beat < 52) assert.ok(n >= 2, `loop note ${e.id} each pass`);
    else assert.ok(n <= 1, `note ${e.id} at most once`);
  }
  assert.ok(out.filter((d) => d.kind === "wrap").every((w) => w.beat === 48));
});
