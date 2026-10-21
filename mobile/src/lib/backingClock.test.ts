import { test } from "node:test";
import assert from "node:assert/strict";
import {
  audioTimeOfBeat,
  backingTarget,
  beatOfAudioTime,
  beatOfClipSec,
  clipSecOfBeat,
  dueNotes,
  hasBeatTimes,
  onSongClock,
  planPass,
  songBeats,
  type BeatClock,
  type ClockNote,
} from "./backingClock.ts";

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not ${expected}`);

// Abide with Me as the band's take hears it (board O1): 72 BPM, 4/4, 16 bars, the band's beat 0 at 1.25 s.
const PLAIN: BeatClock = { tempo: 72, beatOriginSec: 1.25 };
// The same take with the band's own beat times: it pushes a little, then drags (0.80, 0.82, 0.86, … s a beat).
const BEATS: number[] = [];
{
  let t = 1.25;
  for (let i = 0; i <= 64; i++) {
    BEATS.push(Math.round(t * 1e6) / 1e6);
    t += 0.8 + 0.06 * Math.sin(i / 5);
  }
}
const MOVING: BeatClock = { tempo: 72, beatOriginSec: 1.25, beatTimesSec: BEATS };

/** Sixteen bars of 4/4: held notes, a bar of crotchets, two quavers sharing a beat, and a last held doh. */
function abide(): ClockNote[] {
  const rows: [number, number][][] = [
    [[0, 2], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 4]],
    [[0, 2], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 0.5], [3.5, 0.5]], [[0, 4]],
    [[0, 2], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 4]],
    [[0, 2], [2, 1], [3, 1]], [[0, 1], [1, 1], [2, 1], [3, 1]], [[0, 2], [2, 2]], [[0, 4]],
  ];
  const out: ClockNote[] = [];
  rows.forEach((bar, b) => bar.forEach(([at, dur]) => out.push({ startBeat: b * 4 + at, durBeats: dur })));
  return out;
}

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
});

test("with beat times a beat is read off them: between entries linearly, a pickup from the first interval, past the end from the last", () => {
  const clock: BeatClock = { tempo: 60, beatOriginSec: 99, beatTimesSec: [2, 3, 3.5, 4.5] };
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
  const broken: BeatClock = { tempo: 60, beatOriginSec: 1, beatTimesSec: [2, 2, 3] };
  assert.equal(hasBeatTimes(broken), false);
  near(audioTimeOfBeat(2, broken), 3);
});

test("beatOfAudioTime undoes audioTimeOfBeat everywhere: a pickup, between entries and past the end", () => {
  for (const clock of [PLAIN, MOVING, { tempo: 60, beatTimesSec: [4] } as BeatClock]) {
    for (const b of [-2, -0.5, 0, 0.25, 3, 7.5, 31.9, 64, 70.5]) near(beatOfAudioTime(audioTimeOfBeat(b, clock), clock), b, 1e-7);
  }
});

/**
 * Plays a pass the way a look-ahead scheduler does: ticks of `tick` seconds (not dividing the pass evenly), a note
 * queued when its time falls in the window, the loop wrapping to its start mid-tick. Returns how many times each note
 * was queued, and each pass's queue in order.
 */
function play(plan: ReturnType<typeof planPass>, passes: number, tick: number): { count: Map<number, number>; perPass: number[][] } {
  const count = new Map<number, number>();
  const perPass: number[][] = [];
  for (let p = 0; p < passes; p++) {
    const queued: number[] = [];
    let t = 0;
    while (t < plan.lengthSec) {
      const end = Math.min(t + tick, plan.lengthSec);
      for (const n of dueNotes(plan, t, end)) {
        queued.push(n.index);
        count.set(n.index, (count.get(n.index) ?? 0) + 1);
      }
      t = end;
    }
    perPass.push(queued);
  }
  return { count, perPass };
}

test("every note of the sheet is played exactly once per pass, in step with the backing, at 0.5, 0.75 and 1", () => {
  const notes = abide();
  const end = Math.max(...notes.map((n) => n.startBeat + n.durBeats));
  for (const clock of [PLAIN, MOVING]) {
    for (const speed of [0.5, 0.75, 1]) {
      const plan = planPass(notes, clock, { fromBeat: 0, toBeat: end, speed });
      assert.equal(plan.backingStartSec, audioTimeOfBeat(0, clock));
      assert.equal(plan.backingRate, speed);
      near(plan.lengthSec, (audioTimeOfBeat(end, clock) - audioTimeOfBeat(0, clock)) / speed);
      const { count, perPass } = play(plan, 1, 0.07);
      assert.equal(count.size, notes.length, `speed ${speed}: every note`);
      for (const [, c] of count) assert.equal(c, 1);
      assert.deepEqual(perPass[0], notes.map((_, i) => i), "in the sheet's order");
      // Each note sounds when the backing, started at beat 0's time and running at the speed, reaches its beat.
      for (const n of plan.notes) {
        near(plan.backingStartSec + n.atSec * plan.backingRate, audioTimeOfBeat(notes[n.index]!.startBeat, clock), 1e-9);
      }
    }
  }
});

test("a loop of bars 3–4 plays each of its notes exactly once per pass and none of the bars around it", () => {
  const notes = abide();
  const inLoop = notes.map((n, i) => (n.startBeat >= 8 && n.startBeat < 16 ? i : -1)).filter((i) => i >= 0);
  assert.equal(inLoop.length, 5, "bar 3's four crotchets and bar 4's held note");
  for (const clock of [PLAIN, MOVING]) {
    for (const speed of [0.5, 0.75, 1]) {
      const plan = planPass(notes, clock, { fromBeat: 8, toBeat: 16, speed });
      // The band goes back to its own bar 3: the song's beat 8.
      near(plan.backingStartSec, audioTimeOfBeat(8, clock));
      const { count, perPass } = play(plan, 3, 0.1);
      assert.deepEqual([...count.keys()].sort((a, b) => a - b), inLoop);
      for (const i of inLoop) assert.equal(count.get(i), 3, `note ${i} at ${speed}`);
      for (const q of perPass) assert.deepEqual(q, inLoop);
      // The note on the loop's end (bar 5's first) belongs to the next bar, not to this pass.
      assert.ok(!plan.notes.some((n) => notes[n.index]!.startBeat === 16));
      // A held note is cut at the loop's end, so it never rings into the next turn.
      for (const n of plan.notes) assert.ok(n.atSec + n.durSec <= plan.lengthSec + 1e-9);
    }
  }
});

test("a loop starting on a beat a float's dust away still takes its first note once", () => {
  const notes: ClockNote[] = [{ startBeat: 7.9999999999, durBeats: 1 }, { startBeat: 9, durBeats: 1 }, { startBeat: 11.99999999999, durBeats: 1 }];
  const plan = planPass(notes, PLAIN, { fromBeat: 8, toBeat: 12, speed: 0.75 });
  assert.deepEqual(plan.notes.map((n) => n.index), [0, 1]);
});

test("the clip on the song's clock: notes bend with the band, and the clip's place maps back to the band's", () => {
  const notes = abide();
  // Without beat times nothing bends: the same notes, and the clip's beat is the sheet's.
  assert.equal(onSongClock(notes, PLAIN), notes);
  assert.equal(onSongClock(notes, null), notes);
  near(clipSecOfBeat(8, PLAIN, 60 / 72), 8 * (60 / 72));
  near(songBeats(5, PLAIN), 5);
  // With them, each note starts where the band plays its beat.
  const bent = onSongClock(notes, MOVING);
  assert.equal(bent.length, notes.length);
  const spb = 60 / MOVING.tempo;
  bent.forEach((n, i) => {
    near(audioTimeOfBeat(0, MOVING) + n.startBeat * spb, audioTimeOfBeat(notes[i]!.startBeat, MOVING), 1e-9);
    near(n.startBeat + n.durBeats, songBeats(notes[i]!.startBeat + notes[i]!.durBeats, MOVING), 1e-9);
  });
  for (const clock of [null, PLAIN, MOVING]) {
    for (const b of [0, 3.5, 17, 40]) near(beatOfClipSec(clipSecOfBeat(b, clock, 0.6), clock, 0.6), b, 1e-7);
  }
});

test("the backing's place under the clip at every speed the phone plays: the player's rate, or a slower render", () => {
  const notes = abide();
  for (const clock of [PLAIN, MOVING]) {
    const bent = onSongClock(notes, clock);
    for (const speed of [0.5, 0.75, 1]) {
      // Rehearse: the clip rendered at the song's tempo, the player at `speed`.
      // Learn my part: the clip rendered `speed` times slower, the player at 1.
      for (const [beatSec, playerRate] of [[60 / 72, speed], [60 / (72 * speed), 1]] as const) {
        bent.forEach((n, i) => {
          const at = backingTarget(n.startBeat * beatSec, clock, beatSec, playerRate);
          near(at.sec, audioTimeOfBeat(notes[i]!.startBeat, clock), 1e-9);
          near(at.rate, speed, 1e-12);
        });
      }
    }
  }
});

test("the phone's loop: a clip played through bars 3–4 three times sounds each of their notes once per turn, the band under it", () => {
  const notes = abide();
  const inLoop = notes.map((n, i) => (n.startBeat >= 8 && n.startBeat < 16 ? i : -1)).filter((i) => i >= 0);
  for (const clock of [PLAIN, MOVING]) {
    const bent = onSongClock(notes, clock);
    for (const speed of [0.5, 0.75, 1]) {
      const beatSec = 60 / 72;
      const start = clipSecOfBeat(8, clock, beatSec);
      const end = clipSecOfBeat(16, clock, beatSec);
      const onsets = bent.map((n) => n.startBeat * beatSec);
      const count = new Map<number, number>();
      // The player's status ticks every 100 ms of wall time; the clip moves `speed` times that. At the loop's end it
      // goes back to the start, as useNotePlayer's A–B loop does.
      let pos = start;
      let turns = 0;
      while (turns < 3) {
        const next = Math.min(pos + 0.1 * speed, end);
        onsets.forEach((t, i) => {
          if (t >= pos && t < next) {
            count.set(i, (count.get(i) ?? 0) + 1);
            near(backingTarget(t, clock, beatSec, speed).sec, audioTimeOfBeat(notes[i]!.startBeat, clock), 1e-9);
          }
        });
        pos = next;
        if (pos >= end) {
          pos = start;
          turns++;
        }
      }
      assert.deepEqual([...count.keys()].sort((a, b) => a - b), inLoop);
      for (const i of inLoop) assert.equal(count.get(i), 3);
      // Going back, the band goes back to its own bar 3.
      near(backingTarget(start, clock, beatSec, speed).sec, audioTimeOfBeat(8, clock), 1e-9);
    }
  }
});
