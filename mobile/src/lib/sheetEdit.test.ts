// The phone's "Fix a note": the same phrasings, sentences and cases as web-site/tests/sheet-edit.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { editSheet, readEdit, type SheetContext } from "./sheetEdit.ts";
import { deriveSolfa, dohPitchClass, parseKey } from "./solfa.ts";
import type { NoteEvent } from "../api/types";

// Amazing Grace as its hymn page publishes it, in G major, 3/4, labelled as the sheet shows it.
const PAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "web-site", "hymns", "amazing-grace", "index.html");
const hymn = JSON.parse(/<script type="application\/json" id="hymn-data">([\s\S]*?)<\/script>/.exec(readFileSync(PAGE, "utf8"))![1]!) as {
  notes: { pitchMidi: number; startBeat: number; durBeats: number }[];
};
const KEY = "G major", TS = "3/4";
const sheet: SheetContext = {
  dohPc: dohPitchClass(parseKey(KEY)!),
  timeSignature: TS,
  label: (notes) => deriveSolfa(notes, KEY, TS).notes,
};
const grace: NoteEvent[] = sheet.label(hymn.notes.map((n) => ({ ...n, degree: 0, solfa: "", octaveMark: "", conf: 1 })));
const solfa = (notes: NoteEvent[]) => notes.map((n) => n.solfa + n.octaveMark).join(" ");
const edit = (text: string) => editSheet(grace, sheet, text);
function ok(text: string) {
  const out = edit(text);
  if ("error" in out && out.error !== undefined) assert.fail(`${text}: ${out.error}`);
  return out as { notes: NoteEvent[]; said: string; from: number[] };
}
const error = (text: string) => {
  const out = edit(text);
  return "error" in out ? out.error : undefined;
};

test("the opening reads as the hymn book has it", () => {
  assert.equal(solfa(grace.slice(0, 8)), "s, d m d m r d l,");
});

test("make the second m an f: the m's own octave, every other note as it was", () => {
  const out = ok("make the second m an f");
  assert.equal(solfa(out.notes.slice(0, 8)), "s, d m d f r d l,");
  assert.equal(out.notes[4]!.pitchMidi, grace[4]!.pitchMidi + 1);
  assert.deepEqual(out.notes.map((n) => n.startBeat), grace.map((n) => n.startBeat));
  assert.equal(out.said, "Changed note 5 (bar 2) from m to f.");
  assert.equal(grace[4]!.solfa, "m");
});

test("the phrasings people use all say the same thing", () => {
  for (const text of ["Make the 2nd m an f.", "change the second m to f", "the second m should be f",
    "replace the second m with f", "turn the second m into fah", "the second me to f", "change note 5 to f"]) {
    assert.equal(ok(text).notes[4]!.solfa, "f", text);
  }
});

test("octave marks say which octave; without them the nearest one is taken", () => {
  const near = ok("change note 2 to s");
  assert.equal(near.notes[1]!.pitchMidi, grace[1]!.pitchMidi - 5);
  assert.equal(near.notes[1]!.solfa + near.notes[1]!.octaveMark, "s,");
  assert.equal(ok("change note 2 to s,").notes[1]!.pitchMidi, 62);
  assert.equal(ok("change note 2 to s, please").notes[1]!.pitchMidi, 62);
  const up = ok("change note 2 to m'");
  assert.equal(up.notes[1]!.pitchMidi, 67 + 4 + 12);
  assert.equal(up.notes[1]!.solfa + up.notes[1]!.octaveMark, "m'");
});

test("a bar narrows the count, and the last counts from the end", () => {
  const bar = ok("the first m in bar 2 to s");
  assert.equal(bar.notes[2]!.solfa, "m");
  assert.equal(bar.notes[4]!.solfa, "s");
  assert.equal(ok("change the s, in the pickup to l,").said, "Changed note 1 (the pickup) from s, to l,.");
  const last = ok("move the last d up an octave");
  const lastD = grace.map((n, i) => (n.solfa === "d" ? i : -1)).filter((i) => i >= 0).pop()!;
  assert.equal(last.notes[lastD]!.pitchMidi, grace[lastD]!.pitchMidi + 12);
  assert.match(last.said, /up an octave\.$/);
});

test("every one of a syllable, shifts, and deletes", () => {
  const every = ok("change every m to f");
  assert.ok(!every.notes.some((n) => n.solfa === "m"));
  assert.match(every.said, /^Changed \d+ m’s to f\.$/);
  assert.equal(ok("lower note 3 by a semitone").notes[2]!.pitchMidi, grace[2]!.pitchMidi - 1);
  assert.equal(ok("raise note 3 two semitones").notes[2]!.pitchMidi, grace[2]!.pitchMidi + 2);
  const gone = ok("delete note 3");
  assert.equal(gone.notes.length, grace.length - 1);
  assert.equal(gone.said, "Deleted note 3 (bar 1, m).");
  assert.deepEqual(ok("delete note 2").from.slice(0, 3), [0, 2, 3]);
});

test("what cannot be followed is said plainly, with how to put it", () => {
  assert.match(error("change the m to f")!, /^There are \d+ m’s\. Say which one, like “the second m”\.$/);
  assert.match(error("the 40th m to f")!, /^There are only \d+ m’s\.$/);
  assert.equal(error("change note 99 to f"), `There are only ${grace.length} notes.`);
  assert.equal(error("the first ta to t"), "There's no ta on this sheet.");
  assert.equal(error("the first d in bar 40 to r"), "There are no notes in bar 40.");
  assert.equal(error("move note 1 up 5 octaves"), "That would take note 1 (the pickup) off the keyboard.");
  assert.match(error("make it sound nicer")!, /^I couldn't tell which note you mean\. Try/);
  assert.match(error("make the second m nicer")!, /^I couldn't tell what to change it to\. Try/);
  assert.match(error("")!, /^Type a change to make\./);
  assert.equal(editSheet(grace, { ...sheet, dohPc: null }, "change note 2 to s").error, "This sheet has no key to name the notes from.");
});

test("the chromatics are their own syllables: la is flat lah, re sharp ray", () => {
  const read = readEdit("make the second m a la");
  assert.ok(read.ok);
  assert.deepEqual(read.change, { to: { syl: "la", marks: null } });
  const flat = ok("change note 8 to la");
  assert.equal(flat.notes[7]!.pitchMidi, grace[7]!.pitchMidi - 1);
  assert.equal(flat.notes[7]!.solfa, "la");
});
