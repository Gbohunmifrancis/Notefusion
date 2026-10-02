/**
 * Sing-along takes: the count-in a chorister hears before singing a part, and the
 * target the server grades the take against. The lead-in is the part's first note
 * held for a bar (a pitch pipe), then a bar of clicks; both are rendered by the same
 * synth as the preview so the pitch reference is exactly the one the player uses.
 */

import type { GradeTarget, NoteEvent } from "../api/types";
import { beatSecOf, synthesizeVoicesWavBase64 } from "./synth";

function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  return num && den ? (num * 4) / den : 4;
}

export interface LeadIn {
  /** Base64 WAV: the starting note for a bar, then clicks for a bar. */
  wavBase64: string;
  /** Seconds from the start of the recording to the part's first beat. */
  seconds: number;
}

/** A bar of the starting note, a bar of clicks — what the singer hears before beat one. */
export function leadInFor(notes: readonly NoteEvent[], tempoBpm: number, timeSignature: string): LeadIn {
  const bar = beatsPerBar(timeSignature);
  const first = [...notes].sort((a, b) => a.startBeat - b.startBeat)[0];
  const pitch = first?.pitchMidi ?? 60;
  // The second "note" is silent (pitch 0 is skipped by the synth) but stretches the clip
  // to two bars, so the metronome keeps clicking through the count-in bar.
  const wavBase64 = synthesizeVoicesWavBase64(
    [{ notes: [{ pitchMidi: pitch, startBeat: 0, durBeats: bar, degree: 1, solfa: "", octaveMark: "", conf: 1 }, { pitchMidi: 0, startBeat: bar, durBeats: bar, degree: 1, solfa: "", octaveMark: "", conf: 1 }], gain: 0.9 }],
    tempoBpm,
    { metronome: true, beatsPerBar: bar },
  );
  return { wavBase64, seconds: 2 * bar * beatSecOf(tempoBpm) };
}

/** How long the part itself runs, in seconds. */
export function partSeconds(notes: readonly NoteEvent[], tempoBpm: number): number {
  const end = notes.reduce((m, n) => Math.max(m, n.startBeat + Math.max(0, n.durBeats)), 0);
  return end * beatSecOf(tempoBpm);
}

export function targetFor(notes: readonly NoteEvent[], tempoBpm: number, leadInSec: number): GradeTarget {
  return {
    notes: notes.map((n) => ({ pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats })),
    tempoBpm,
    leadInSec,
  };
}

/** The note due at `elapsed` seconds into the recording, or −1 between notes. */
export function noteDueAt(notes: readonly NoteEvent[], tempoBpm: number, leadInSec: number, elapsed: number): number {
  const beat = (elapsed - leadInSec) / beatSecOf(tempoBpm);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    if (beat >= n.startBeat && beat < n.startBeat + n.durBeats) return i;
  }
  return -1;
}
