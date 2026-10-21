/**
 * The song's own clock: where a notation beat falls in the recording, so the solfa can play over the song's backing
 * (the band with the voice taken out) in step (boards o-backing O1–O3). Pure and import-free; the web's
 * `assets/backing-clock.js` is the same mapping, held to the same tests.
 *
 * The mapping (the shared contract):
 *   - with `beatTimesSec` (a non-empty array): entry i is the audio time of notation beat i, increasing; a beat between
 *     two entries is interpolated linearly, one before 0 (a pickup) extrapolated with the first interval, one past the
 *     last entry with the last interval;
 *   - without it: beatOriginSec + beat * 60 / tempo.
 *
 * A pass (the whole sheet, or a loop of bars) starts the backing at audioTimeOfBeat(fromBeat) and plays every note in
 * [fromBeat, toBeat) exactly once at its own beat on the same clock; at speed s the backing plays at rate s (its pitch
 * kept) and the notes follow the same scaled clock.
 *
 * The phone plays the solfa from a clip rendered ahead of time (lib/synth), not note by note, so the second half of
 * this file maps that clip's seconds to beats and to the backing's place: a sheet whose song has beat times has its
 * notes re-timed onto the song's clock before the clip is rendered, so the piano and the band never drift apart.
 */

export interface BeatClock {
  /** The tempo the backing was heard at (BPM): a beat is 60 / tempo seconds when there are no beat times. */
  tempo: number;
  /** Where beat 0 falls in the recording, in seconds. */
  beatOriginSec?: number | null;
  /** Entry i is the audio time (s) of notation beat i, increasing. Null or empty: beatOriginSec and tempo. */
  beatTimesSec?: readonly number[] | null;
}

/** A note as the clock needs it: where it starts and how long it lasts, in notation beats. */
export interface ClockNote {
  startBeat: number;
  durBeats: number;
}

/** A note on a pass's boundary counts once: start inside [from, to), give or take float dust. */
const EDGE = 1e-6;

function secondsPerBeat(clock: BeatClock): number {
  return 60 / (Number.isFinite(clock.tempo) && clock.tempo > 0 ? clock.tempo : 120);
}

/** The beat times when they are usable (finite and increasing), else null and the tempo stands. */
function beatTimes(clock: BeatClock): readonly number[] | null {
  const t = clock.beatTimesSec;
  if (!t || t.length === 0) return null;
  for (let i = 0; i < t.length; i++) {
    if (!Number.isFinite(t[i]!)) return null;
    if (i > 0 && !(t[i]! > t[i - 1]!)) return null;
  }
  return t;
}

/** True when the song carries its own beat times (a tempo that moves), not just an origin and a tempo. */
export function hasBeatTimes(clock: BeatClock | null | undefined): boolean {
  return !!clock && beatTimes(clock) !== null;
}

/** Where notation beat `beat` falls in the recording, in seconds. */
export function audioTimeOfBeat(beat: number, clock: BeatClock): number {
  const t = beatTimes(clock);
  if (!t) return (clock.beatOriginSec ?? 0) + beat * secondsPerBeat(clock);
  // One entry gives no interval to follow: the tempo carries on from it.
  if (t.length === 1) return t[0]! + beat * secondsPerBeat(clock);
  const last = t.length - 1;
  if (beat <= 0) return t[0]! + beat * (t[1]! - t[0]!);
  if (beat >= last) return t[last]! + (beat - last) * (t[last]! - t[last - 1]!);
  const i = Math.floor(beat);
  return t[i]! + (beat - i) * (t[i + 1]! - t[i]!);
}

/** The notation beat heard at `sec` in the recording: the inverse of `audioTimeOfBeat`. */
export function beatOfAudioTime(sec: number, clock: BeatClock): number {
  const t = beatTimes(clock);
  if (!t) return (sec - (clock.beatOriginSec ?? 0)) / secondsPerBeat(clock);
  if (t.length === 1) return (sec - t[0]!) / secondsPerBeat(clock);
  const last = t.length - 1;
  if (sec <= t[0]!) return (sec - t[0]!) / (t[1]! - t[0]!);
  if (sec >= t[last]!) return last + (sec - t[last]!) / (t[last]! - t[last - 1]!);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! <= sec) lo = mid;
    else hi = mid;
  }
  return lo + (sec - t[lo]!) / (t[lo + 1]! - t[lo]!);
}

// ── A pass: the notes to play from one beat to another, on the backing's clock ──────────────────────────────────

export interface PassNote {
  /** The note's index in the list handed in. */
  index: number;
  /** When it sounds, in seconds from the start of the pass, at the pass's speed. */
  atSec: number;
  /** How long it sounds, cut at the end of the pass so a loop never rings into its next turn. */
  durSec: number;
}

export interface PassPlan {
  /** Where the backing starts: audioTimeOfBeat(fromBeat). */
  backingStartSec: number;
  /** The backing's playback rate: the speed (its pitch kept). */
  backingRate: number;
  /** How long one pass lasts, in seconds at the speed. */
  lengthSec: number;
  /** Every note starting in [fromBeat, toBeat), once, in time order. */
  notes: PassNote[];
}

/**
 * One pass of the sheet (or of a loop) from `fromBeat` to `toBeat` at `speed`: where the backing starts, its rate,
 * and when each note sounds. Every note starting inside [fromBeat, toBeat) is in it exactly once and no other is; a
 * note sounds at (audioTimeOfBeat(its beat) − audioTimeOfBeat(fromBeat)) / speed, which is when the backing, started
 * at audioTimeOfBeat(fromBeat) at rate `speed`, reaches that beat.
 */
export function planPass(
  notes: readonly ClockNote[],
  clock: BeatClock,
  pass: { fromBeat: number; toBeat: number; speed: number },
): PassPlan {
  const speed = Number.isFinite(pass.speed) && pass.speed > 0 ? pass.speed : 1;
  const start = audioTimeOfBeat(pass.fromBeat, clock);
  const lengthSec = Math.max(0, (audioTimeOfBeat(pass.toBeat, clock) - start) / speed);
  const out: PassNote[] = [];
  notes.forEach((n, index) => {
    if (n.startBeat < pass.fromBeat - EDGE || n.startBeat >= pass.toBeat - EDGE) return;
    const at = (audioTimeOfBeat(n.startBeat, clock) - start) / speed;
    const end = (audioTimeOfBeat(n.startBeat + Math.max(0, n.durBeats), clock) - start) / speed;
    out.push({ index, atSec: Math.max(0, at), durSec: Math.max(0, Math.min(end, lengthSec) - Math.max(0, at)) });
  });
  out.sort((a, b) => a.atSec - b.atSec || a.index - b.index);
  return { backingStartSec: start, backingRate: speed, lengthSec, notes: out };
}

/**
 * The notes of a pass that start in the window [fromSec, toSec) of it: what a look-ahead scheduler queues on one tick.
 * Windows that meet end to end hand every note out exactly once.
 */
export function dueNotes(plan: PassPlan, fromSec: number, toSec: number): PassNote[] {
  return plan.notes.filter((n) => n.atSec >= fromSec && n.atSec < toSec);
}

// ── The phone's clip: the solfa rendered ahead of time, played by one player ────────────────────────────────────

/**
 * A beat as the song places it, counted in even beats of the clock's tempo from beat 0. Without beat times that is
 * the beat itself; with them it bends with the band (a beat the band played late comes later).
 */
export function songBeats(beat: number, clock: BeatClock): number {
  if (!hasBeatTimes(clock)) return beat;
  return (audioTimeOfBeat(beat, clock) - audioTimeOfBeat(0, clock)) / secondsPerBeat(clock);
}

/** The inverse of `songBeats`. */
export function beatOfSongBeats(even: number, clock: BeatClock): number {
  if (!hasBeatTimes(clock)) return even;
  return beatOfAudioTime(audioTimeOfBeat(0, clock) + even * secondsPerBeat(clock), clock);
}

/**
 * The notes re-timed onto the song's clock, for the clip the phone renders and the highlight that follows it: each
 * start and length in even beats of the clock's tempo, so a clip rendered from them at that tempo sounds every note
 * when the backing reaches it. Index for index with the notes handed in; the same array when the song has no beat
 * times (nothing to bend).
 */
export function onSongClock<T extends ClockNote>(notes: readonly T[], clock: BeatClock | null | undefined): readonly T[] {
  if (!clock || !hasBeatTimes(clock)) return notes;
  return notes.map((n) => {
    const start = songBeats(n.startBeat, clock);
    const end = songBeats(n.startBeat + Math.max(0, n.durBeats), clock);
    return { ...n, startBeat: start, durBeats: Math.max(0, end - start) };
  });
}

/**
 * Where a notation beat falls in the phone's clip, in seconds: `beatSec` is the clip's seconds per beat as it was
 * rendered (lib/synth `beatSecOf` of the tempo it was rendered at — slower in Learn my part).
 */
export function clipSecOfBeat(beat: number, clock: BeatClock | null | undefined, beatSec: number): number {
  return (clock ? songBeats(beat, clock) : beat) * beatSec;
}

/** The notation beat sounding at `sec` in the clip: the inverse of `clipSecOfBeat`. */
export function beatOfClipSec(sec: number, clock: BeatClock | null | undefined, beatSec: number): number {
  const even = beatSec > 0 ? sec / beatSec : 0;
  return clock ? beatOfSongBeats(even, clock) : even;
}

/**
 * Where the backing should be when the clip is at `clipSec`, and the rate it plays at while the clip plays at
 * `playerRate`. A clip rendered slower (Learn my part's 75 %) slows the backing with it; one rendered at the song's
 * tempo leaves it at the player's rate.
 */
export function backingTarget(
  clipSec: number,
  clock: BeatClock,
  beatSec: number,
  playerRate: number,
): { sec: number; rate: number } {
  const scale = beatSec > 0 ? secondsPerBeat(clock) / beatSec : 1;
  return { sec: audioTimeOfBeat(0, clock) + clipSec * scale, rate: playerRate * scale };
}
