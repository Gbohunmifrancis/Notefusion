/**
 * Sing-along takes: the count-in a chorister hears before singing a part, and the
 * target the server grades the take against. The count-in is at most five seconds
 * (lib/practice `leadInPlan`): the part's first note held (a pitch pipe), then clicks
 * that end on beat one; both are rendered by the same synth as the preview so the
 * pitch reference is exactly the one the player uses.
 */

import type { GradeTarget, NoteEvent } from "../api/types";
import { leadInPlan } from "./practice";
import { beatSecOf, synthesizeVoicesWavBase64 } from "./synth";

export interface LeadIn {
  /** Base64 WAV: the starting note, then clicks up to beat one. */
  wavBase64: string;
  /** Seconds from the start of the recording to the part's first beat. */
  seconds: number;
}

/** The starting note, then clicks to beat one — what the singer hears before singing, five seconds at most. */
export function leadInFor(notes: readonly NoteEvent[], tempoBpm: number, timeSignature: string): LeadIn {
  const plan = leadInPlan(tempoBpm, timeSignature);
  const first = [...notes].sort((a, b) => a.startBeat - b.startBeat)[0];
  const pitch = first?.pitchMidi ?? 60;
  // The second "note" is silent (pitch 0 is skipped by the synth) but stretches the clip
  // to the whole count-in, so the metronome keeps clicking up to beat one, its accent a
  // bar before it.
  const wavBase64 = synthesizeVoicesWavBase64(
    [{ notes: [{ pitchMidi: pitch, startBeat: 0, durBeats: plan.holdBeats, degree: 1, solfa: "", octaveMark: "", conf: 1 }, { pitchMidi: 0, startBeat: plan.holdBeats, durBeats: plan.beats - plan.holdBeats, degree: 1, solfa: "", octaveMark: "", conf: 1 }], gain: 0.9 }],
    tempoBpm,
    { metronome: true, beatsPerBar: plan.beatsPerBar, downbeat: plan.beats % plan.beatsPerBar },
  );
  return { wavBase64, seconds: plan.seconds };
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
