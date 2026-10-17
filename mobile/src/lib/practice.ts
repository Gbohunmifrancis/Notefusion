/**
 * "Learn my part": the practise view's arithmetic, apart from the screen that draws it.
 *
 * A singer picks their part (remembered on the device), hears it loud with the others soft, alone,
 * or all equal, loops a few bars, slows them down, and sings them back to be marked. Grading takes
 * the part's notes for just the looped bars, moved to start at beat 0 and stretched by the
 * slow-down, so the grade endpoint needs nothing new: the take is a count-in and then the singer
 * alone, and the target is exactly what they were asked to sing.
 *
 * Mirrors web-site/assets/practice.js — keep the two in step (their tests match).
 */

import type { GradeResult, GradeStatus, GradeTarget, NoteEvent, TranscriptionPart } from "../api/types";
import type { VoiceName } from "./choir";

export type Balance = "balance" | "alone" | "equal";

export const PRACTICE_VOICES: readonly VoiceName[] = ["soprano", "alto", "tenor", "bass"];
/** How loud the other parts are under yours in the balanced mix (yours is 1). */
export const OTHERS_LEVEL = 0.25;
export const SPEEDS: readonly number[] = [0.5, 0.75, 1];
/** A take is at most 120 s on the worker (GRADE_MAX_SECONDS); this leaves room for the tail. */
const MAX_TAKE_SEC = 110;
/** Recording runs on this long after the last bar, so a held ending is not cut. */
export const TAIL_SEC = 1;
/** The worker refuses a target note shorter than this (MIN_NOTE_BEATS). */
const MIN_NOTE_BEATS = 1 / 16;

function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  return num && den ? (num * 4) / den : 4;
}
function beatSec(tempo: number): number {
  return 60 / Math.max(30, tempo || 0);
}

/** The parts a singer can practise, tune first: the soprano (the tune) always, the others the sheet has. */
export function partsOf(parts: Partial<Record<VoiceName, TranscriptionPart>> | null | undefined): VoiceName[] {
  return PRACTICE_VOICES.filter((v) => v === "soprano" || (parts?.[v]?.notes.length ?? 0) > 0);
}

/** The remembered part when this sheet has it, else the tune. */
export function choosePart(available: readonly VoiceName[], remembered: string | null | undefined): VoiceName {
  return (available as readonly string[]).includes(remembered ?? "") ? (remembered as VoiceName) : (available[0] ?? "soprano");
}

/** Each part's level in the mix: yours at 1; the others soft ("balance"), silent ("alone") or at 1 ("equal"). */
export function levels(names: readonly VoiceName[], mine: VoiceName, balance: Balance): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of names) out[n] = n === mine || balance === "equal" ? 1 : balance === "alone" ? 0 : OTHERS_LEVEL;
  return out;
}

/** Where the loop starts out: the whole tune when it is short, else the first phrase (four bars). */
export function defaultRange(barCount: number): { from: number; to: number } {
  const bars = Math.max(1, barCount || 1);
  return { from: 1, to: bars <= 8 ? bars : 4 };
}

/**
 * Choosing the bars by tapping two of them. The first tap loops that bar alone and waits; the
 * second makes the range between the two, whichever order they came in.
 */
export function tapBar(pending: number | null, bar: number): { range: { from: number; to: number }; pending: number | null } {
  if (pending == null) return { range: { from: bar, to: bar }, pending: bar };
  return { range: { from: Math.min(pending, bar), to: Math.max(pending, bar) }, pending: null };
}

export interface BarSlice {
  /** The notes of the bars, the first bar starting at beat 0. */
  notes: NoteEvent[];
  /** Each sliced note's index in the part, so a mark lands on the note the singer sees. */
  index: number[];
  /** The bars' length in beats. */
  beats: number;
}

/**
 * The notes of bars from..to (1-based, inclusive), moved so the first bar starts at beat 0. A note
 * is in the range when it starts inside it; one held past the last bar-line is cut there.
 */
export function sliceBars(notes: readonly NoteEvent[], from: number, to: number, timeSignature: string): BarSlice {
  const bpb = beatsPerBar(timeSignature);
  const start = (from - 1) * bpb;
  const end = to * bpb;
  const out: NoteEvent[] = [];
  const index: number[] = [];
  notes.forEach((n, i) => {
    if (!(n.pitchMidi > 0) || n.startBeat < start - 1e-6 || n.startBeat >= end - 1e-6) return;
    const dur = Math.min(n.durBeats, end - n.startBeat);
    if (dur < MIN_NOTE_BEATS) return;
    out.push({ ...n, startBeat: n.startBeat - start, durBeats: dur });
    index.push(i);
  });
  return { notes: out, index, beats: end - start };
}

/** Seconds the sliced bars take at this speed (1 = the sheet's tempo). */
export function sliceSeconds(slice: BarSlice, tempo: number, speed: number): number {
  return (slice.beats * beatSec(tempo)) / (speed || 1);
}

/** True when a take of these bars (count-in included) would be longer than the worker marks. */
export function tooLong(slice: BarSlice, tempo: number, speed: number, leadInSec: number): boolean {
  return leadInSec + sliceSeconds(slice, tempo, speed) + TAIL_SEC > MAX_TAKE_SEC;
}

/**
 * The GradeTarget for a take of the sliced bars: beats stretched by 1 / speed at the sheet's tempo
 * (floored at 30 BPM as every player here is), so a take sung at half speed is judged at half speed.
 */
export function gradeTarget(slice: BarSlice, tempo: number, speed: number, leadInSec: number): GradeTarget {
  const s = speed || 1;
  return {
    notes: slice.notes.map((n) => ({ pitchMidi: n.pitchMidi, startBeat: n.startBeat / s, durBeats: n.durBeats / s })),
    tempoBpm: Math.min(300, Math.max(30, tempo || 0)),
    leadInSec,
  };
}

/** The grade's marks by index into the part's notes. */
export function marksByNote(
  grade: Pick<GradeResult, "notes"> | null | undefined,
  slice: BarSlice,
): Record<number, { status: GradeStatus; cents: number | null }> {
  const out: Record<number, { status: GradeStatus; cents: number | null }> = {};
  for (const m of grade?.notes ?? []) {
    const i = slice.index[m.index];
    if (i != null) out[i] = { status: m.status, cents: m.cents };
  }
  return out;
}

/** The part's notes bar by bar, for the strip a singer taps; every bar is listed. */
export function bars(
  notes: readonly NoteEvent[],
  timeSignature: string,
  barCount: number,
): { bar: number; notes: { i: number; note: NoteEvent }[] }[] {
  const bpb = beatsPerBar(timeSignature);
  const out: { bar: number; notes: { i: number; note: NoteEvent }[] }[] = [];
  for (let b = 1; b <= barCount; b++) out.push({ bar: b, notes: [] });
  notes.forEach((n, i) => {
    if (!(n.pitchMidi > 0)) return;
    const b = Math.min(barCount, Math.floor(n.startBeat / bpb + 1e-6) + 1);
    if (b >= 1) out[b - 1]!.notes.push({ i, note: n });
  });
  return out;
}

/**
 * The tempo the phone renders a slowed practice at. The piano is synthesised, so slower is just
 * the notes played slower — no time-stretching, so no warble — at the synth's own 30 BPM floor.
 */
export function practiceTempo(tempo: number, speed: number): number {
  return Math.max(30, tempo || 0) * speed;
}

/** The speeds that stay above the synth's 30 BPM floor (every one, for any tempo from 60 up). */
export function speedsFor(tempo: number): number[] {
  return SPEEDS.filter((s) => s === 1 || practiceTempo(tempo, s) >= 30);
}
