// node --test web-site/tests/*.test.mjs
// hymnbook.js decides when the result view asks "Use the hymnbook version?" and what Yes swaps in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/choir.js", import.meta.url), "utf8"), { window });
vm.runInNewContext(readFileSync(new URL("../assets/hymnbook.js", import.meta.url), "utf8"), { window });
const H = window.NfHymnbook;
const C = window.NfChoir;

// Amazing Grace's opening as the worker sends it: in A major (sung a tone above the hymnbook's G), 3/4,
// the pickup on the last beat of the first bar.
const hymnNotes = [
  { pitchMidi: 64, startBeat: 2, durBeats: 1, degree: 5, solfa: "s", octaveMark: ",", conf: 1 },
  { pitchMidi: 69, startBeat: 3, durBeats: 2, degree: 1, solfa: "d", octaveMark: "", conf: 1 },
  { pitchMidi: 73, startBeat: 5, durBeats: 0.5, degree: 3, solfa: "m", octaveMark: "", conf: 1 },
  { pitchMidi: 69, startBeat: 5.5, durBeats: 0.5, degree: 1, solfa: "d", octaveMark: "", conf: 1 },
];
const match = {
  slug: "amazing-grace", title: "Amazing Grace", tune: "NEW BRITAIN", url: "https://notefusion.studio/hymns/amazing-grace",
  source: "NoteFusion", licence: "Public domain.", credit: "Tune NEW BRITAIN (traditional American melody); words by John Newton (1725–1807).",
  kind: "score", confidence: 0.7, key: "A major", timeSignature: "3/4", tempo: 72, pickup: 1,
  notes: hymnNotes, solfaLines: ["Doh is A"], musicXml: "<hymn/>", lyrics: "A-maz-ing grace!",
};
const heard = {
  key: "E major", tempo: 96, timeSignature: "4/4", musicXml: "<heard/>", overallConfidence: 0.6,
  notes: [{ pitchMidi: 64, startBeat: 0, durBeats: 1, degree: 1, solfa: "d", octaveMark: "", conf: 0.6 }],
  solfaLines: ["Doh is E"], chords: [{ startBeat: 0, durBeats: 4, root: 4, quality: "maj", bass: null, symbol: "E", solfa: "d" }],
  chordsSource: "heard", keyAlternatives: [{ key: "A major", pitches: [64], musicXml: "<a/>" }],
  backingAudioBase64: "bWlj", hasBacking: true, beatOriginSec: 1.2, beatTimesSec: [1.2, 1.8, 2.4], hymnMatch: match,
};

test("a whole score is offered once, on a fresh sheet without parts", () => {
  assert.equal(H.ask(heard, {}), "version");
  assert.equal(H.ask(heard, { hymnAnswered: true }), null);
  assert.equal(H.ask(heard, { savedId: "s1" }), null);
  assert.equal(H.ask({ ...heard, parts: { alto: {} } }, {}), null);
  assert.equal(H.ask({ ...heard, hymnMatch: null }, {}), null);
  assert.equal(H.ask(H.swap(heard, match), {}), null, "the version itself is never asked about again");
});

test("a recognition-only match is named, never swapped", () => {
  const incipit = { slug: "some-tune", title: "Some Tune", url: "https://example.org/t", kind: "incipit", credit: "x", confidence: 0.6 };
  assert.equal(H.ask({ ...heard, hymnMatch: incipit }, {}), "name");
});

test("the prompt names the hymn and its time signature", () => {
  assert.equal(H.label(match), "Amazing Grace (hymnbook, 3/4)");
});

test("Yes swaps notes, rhythm, time signature, key, score and solfa, and drops what the old beats carried", () => {
  const next = H.swap(heard, match);
  assert.equal(next.key, "A major");
  assert.equal(next.timeSignature, "3/4");
  assert.equal(next.tempo, 72);
  assert.equal(next.musicXml, "<hymn/>");
  assert.deepEqual(next.notes.map((n) => [n.pitchMidi, n.startBeat, n.durBeats]), [[64, 2, 1], [69, 3, 2], [73, 5, 0.5], [69, 5.5, 0.5]]);
  assert.equal(next.overallConfidence, 1, "published notes carry no doubt");
  assert.equal(next.chords, null);
  assert.equal(next.keyAlternatives, null);
  assert.equal(next.backingAudioBase64, "");
  assert.equal(next.hasBacking, false, "the song's backing does not follow the hymnbook's beats");
  assert.equal(next.beatOriginSec, 0);
  assert.equal(next.beatTimesSec, null);
  assert.deepEqual({ ...next.hymn }, { slug: "amazing-grace", title: "Amazing Grace", url: match.url, credit: match.credit });
  assert.equal(heard.key, "E major", "the transcription itself is untouched");
  // The solfa engine reads the swapped notes as the hymnbook does: s, | d - - m d | in 3/4, doh is A.
  const lines = C.renderLines(next.notes, C.keyHeader(next.key), next.timeSignature);
  assert.equal(lines[0], "Doh is A");
  assert.deepEqual(C.label(next.notes, next.key).map((n) => n.solfa + n.octaveMark), ["s,", "d", "m", "d"]);
});

test("the credit line names the hymn and its sources", () => {
  assert.equal(H.credit({ title: "Amazing Grace", credit: "Tune NEW BRITAIN." }), "Hymnbook version of “Amazing Grace”. Tune NEW BRITAIN.");
});

test("a famous piece that is not a hymn is offered as its published version", () => {
  const piece = { ...match, slug: "piece-fur-elise", title: "Für Elise", tune: "", url: "", category: "piece", timeSignature: "3/8" };
  assert.equal(H.ask({ hymnMatch: piece }, {}), "version");
  assert.equal(H.label(piece), "Für Elise (published, 3/8)");
  assert.equal(H.noun(piece), "published version");
  assert.equal(H.noun(match), "hymnbook version");
  const swapped = H.swap(heard, piece);
  assert.equal(swapped.hymn.category, "piece");
  assert.match(H.credit(swapped.hymn), /^Published version of “Für Elise”/);
  // A saved sheet's credit keeps only the slug: still a piece.
  assert.ok(H.isPiece({ slug: "piece-fur-elise", title: "Für Elise" }));
  assert.ok(!H.isPiece(match));
});

test("a hymn picked from those sung to the tune brings its words and its credit", () => {
  const tune = {
    ...match, slug: "tune-new-britain", title: "New Britain", url: "https://notefusion.studio/hymns/tunes/new-britain", lyrics: "",
    settings: [{ slug: "alas-and-did-my-saviour-bleed", title: "Alas! and Did My Saviour Bleed", url: "https://notefusion.studio/hymns/alas-and-did-my-saviour-bleed", credit: "Words by Isaac Watts.", lyrics: "A-las! and did" }],
    settingsTotal: 1,
  };
  assert.equal(H.settings(tune).length, 1);
  assert.equal(H.settings(match).length, 0);
  const s = H.findSetting(tune, "  alas! and did my saviour bleed ");
  assert.equal(s.slug, "alas-and-did-my-saviour-bleed");
  assert.equal(H.findSetting(tune, "Amazing Grace"), null);
  const swapped = H.swap(heard, tune, s);
  assert.deepEqual(JSON.parse(JSON.stringify(swapped.hymn)), { slug: s.slug, title: s.title, url: s.url, credit: s.credit });
  assert.deepEqual(swapped.notes.map((n) => n.pitchMidi), hymnNotes.map((n) => n.pitchMidi)); // the tune's own notes
});

test("the hymn a photographed page's words named is offered without asking", () => {
  const alas = { slug: "alas-and-did-my-saviour-bleed", title: "Alas! and Did My Saviour Bleed", url: "u", credit: "c", lyrics: "A-las!" };
  const tune = { ...match, slug: "tune-new-britain", title: "New Britain", settings: [alas], settingsTotal: 1 };
  assert.equal(H.chosen(tune), null);
  assert.equal(H.chosen({ ...tune, chosen: "alas-and-did-my-saviour-bleed" }).slug, alas.slug);
  assert.equal(H.chosen({ ...tune, chosen: "not-offered" }), null);
});
