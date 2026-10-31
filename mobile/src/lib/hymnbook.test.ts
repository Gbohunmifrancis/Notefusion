import { test } from "node:test";
import assert from "node:assert/strict";
import type { HymnMatch, NoteEvent } from "../api/types";
import { findSettings, hymnbookSheet, hymnCreditLine, hymnLabel, hymnOffer, isPiece } from "./hymnbook.ts";
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

test("a famous piece that is not a hymn is offered as its published version", () => {
  const piece: HymnMatch = { ...match, slug: "piece-fur-elise", title: "Für Elise", tune: "", url: "", category: "piece", timeSignature: "3/8" };
  assert.equal(hymnOffer(piece, fresh), "version");
  assert.equal(hymnLabel(piece), "Für Elise (published, 3/8)");
  assert.ok(isPiece(piece));
  assert.ok(!isPiece(match));
  // A saved sheet's credit keeps only the slug: still a piece.
  assert.match(hymnCreditLine({ slug: "piece-fur-elise", title: "Für Elise", url: "", credit: "Für Elise by Ludwig van Beethoven (1770–1827)." }),
    /^Published version of “Für Elise”\. Für Elise by Ludwig van Beethoven/);
  assert.equal(hymnLabel(match), "Amazing Grace (hymnbook, 3/4)");
});

test("a hymn picked from those sung to the tune brings its words and its credit on the tune's notes", () => {
  const alas = { slug: "alas-and-did-my-saviour-bleed", title: "Alas! and Did My Saviour Bleed", url: "https://notefusion.studio/hymns/alas-and-did-my-saviour-bleed", credit: "Words by Isaac Watts.", lyrics: "A-las! and did" };
  const tune: HymnMatch = { ...match, slug: "tune-new-britain", title: "New Britain", lyrics: "", settings: [alas, { ...alas, slug: "x", title: "Another Hymn" }], settingsTotal: 2 };
  assert.deepEqual(findSettings(tune, "").length, 2);
  assert.deepEqual(findSettings(tune, "saviour ALAS").map((s) => s.slug), [alas.slug]);
  assert.deepEqual(findSettings(match, "anything"), []);
  const sheet = hymnbookSheet(tune, 96, alas)!;
  assert.equal(sheet.lyrics, "A-las! and did");
  assert.deepEqual(sheet.hymn, { slug: alas.slug, title: alas.title, url: alas.url, credit: alas.credit });
  assert.deepEqual(sheet.notes.map((n) => n.pitchMidi), match.notes!.map((n) => n.pitchMidi));
});
