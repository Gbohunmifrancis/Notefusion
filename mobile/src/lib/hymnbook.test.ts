import { test } from "node:test";
import assert from "node:assert/strict";
import type { HymnMatch, NoteEvent } from "../api/types";
import { hymnbookSheet, hymnCreditLine, hymnLabel, hymnOffer } from "./hymnbook.ts";
import { deriveSolfa } from "./solfa.ts";

const note = (pitchMidi: number, startBeat: number, durBeats: number): NoteEvent =>
  ({ pitchMidi, startBeat, durBeats, degree: 1, solfa: "", octaveMark: "", conf: 1 }) as NoteEvent;

// Amazing Grace's opening sung in A major, 3/4, the pickup on the last beat of the first bar.
const match: HymnMatch = {
  slug: "amazing-grace", title: "Amazing Grace", tune: "NEW BRITAIN", url: "https://notefusion.studio/hymns/amazing-grace",
  source: "NoteFusion", licence: "Public domain.", credit: "Tune NEW BRITAIN (traditional American melody); words by John Newton (1725–1807).",
  kind: "score", confidence: 0.7, key: "A major", timeSignature: "3/4", tempo: 72, pickup: 1,
  notes: [note(64, 2, 1), note(69, 3, 2), note(73, 5, 0.5), note(69, 5.5, 0.5)],
  solfaLines: ["Doh is A"], musicXml: "<hymn/>", lyrics: "A-maz-ing grace!",
};
const fresh = { saved: false, answered: false, hasParts: false };

test("a whole score is offered once, on a fresh sheet without parts", () => {
  assert.equal(hymnOffer(match, fresh), "version");
  assert.equal(hymnOffer(match, { ...fresh, answered: true }), null);
  assert.equal(hymnOffer(match, { ...fresh, saved: true }), null);
  assert.equal(hymnOffer(match, { ...fresh, hasParts: true }), null);
  assert.equal(hymnOffer(null, fresh), null);
});

test("a recognition-only match is named, never swapped", () => {
  const incipit: HymnMatch = { slug: "t", title: "Some Tune", tune: "", url: "https://example.org/t", source: "x", licence: "x", credit: "x", kind: "incipit", confidence: 0.6 };
  assert.equal(hymnOffer(incipit, fresh), "name");
  assert.equal(hymnbookSheet(incipit, 90), null);
});

test("Yes brings the hymn's notes, rhythm, meter, key, pace, words and credit", () => {
  const sheet = hymnbookSheet(match, 96)!;
  assert.equal(sheet.key, "A major");
  assert.equal(sheet.timeSignature, "3/4");
  assert.equal(sheet.tempo, 72);
  assert.equal(sheet.lyrics, "A-maz-ing grace!");
  assert.deepEqual(sheet.notes.map((n) => [n.pitchMidi, n.startBeat, n.durBeats]), [[64, 2, 1], [69, 3, 2], [73, 5, 0.5], [69, 5.5, 0.5]]);
  assert.deepEqual(sheet.hymn, { slug: "amazing-grace", title: "Amazing Grace", url: match.url, credit: match.credit });
  // The solfa engine reads it as the hymnbook does: doh is A, s, d m d.
  const derived = deriveSolfa(sheet.notes, sheet.key, sheet.timeSignature);
  assert.deepEqual(derived.notes.map((n) => n.solfa + n.octaveMark), ["s,", "d", "m", "d"]);
  assert.match(derived.solfaLines[0]!, /^Doh is A/);
  assert.equal(hymnbookSheet({ ...match, tempo: null }, 96)!.tempo, 96);
});

test("the prompt and the credit name the hymn", () => {
  assert.equal(hymnLabel(match), "Amazing Grace (hymnbook, 3/4)");
  assert.equal(hymnCreditLine({ slug: "s", title: "Amazing Grace", url: "u", credit: "Tune NEW BRITAIN." }), "Hymnbook version of “Amazing Grace”. Tune NEW BRITAIN.");
});
