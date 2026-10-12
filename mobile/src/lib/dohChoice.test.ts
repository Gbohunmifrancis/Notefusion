import { test } from "node:test";
import assert from "node:assert/strict";
import type { KeyAlternative, NoteEvent } from "../api/types";
import { dohChoices as choices, writeInKey } from "./dohChoice.ts";
import { dohPitchClass, parseKey } from "./solfa.ts";

const dohOf = (key: string) => {
  const parsed = parseKey(key);
  return parsed ? dohPitchClass(parsed) : null;
};
const dohChoices = (key: string, notes: NoteEvent[], alternatives: KeyAlternative[] | null) =>
  choices(key, notes, alternatives, dohOf);

const note = (pitchMidi: number, startBeat: number): NoteEvent =>
  ({ pitchMidi, startBeat, durBeats: 1, degree: 1, solfa: "d", octaveMark: "", conf: 0.9 }) as NoteEvent;
const notes = [note(67, 0), note(65, 1), note(64, 2)];

test("an unsure doh offers the other dohs once each, never the sheet's own", () => {
  const offered = dohChoices("C major", notes, [
    { key: "G major", pitches: [67, 66, 64] },
    { key: "A minor", pitches: [67, 65, 64] }, // doh C: the sheet's own
    { key: "E minor", pitches: [67, 66, 64] }, // doh G again
    { key: "F major", pitches: [67, 65, 64] },
  ]);
  assert.deepEqual(offered.map((k) => k.key), ["G major", "F major"]);
});

test("nothing is offered without alternatives, or when they no longer match the notes", () => {
  assert.deepEqual(dohChoices("C major", notes, null), []);
  assert.deepEqual(dohChoices("C major", notes, [{ key: "G major", pitches: [67, 66] }]), []);
  assert.deepEqual(dohChoices("not a key", notes, [{ key: "G major", pitches: [67, 66, 64] }]), []);
});

test("choosing a doh writes its pitches and keeps the rhythm", () => {
  const written = writeInKey(notes, { key: "G major", pitches: [67, 66, 64] });
  assert.deepEqual(written.map((n) => n.pitchMidi), [67, 66, 64]);
  assert.deepEqual(written.map((n) => n.startBeat), [0, 1, 2]);
  assert.equal(written[0], notes[0]); // an unchanged note is the same note
});
