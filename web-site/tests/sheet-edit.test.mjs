// node --test web-site/tests/*.test.mjs
// sheet-edit.js reads a correction typed in plain words and makes it; musicxml.js writes the edited sheet's staff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
for (const file of ["choir.js", "sheet-edit.js", "musicxml.js"]) {
  vm.runInNewContext(readFileSync(new URL(`../assets/${file}`, import.meta.url), "utf8"), { window });
}
const C = window.NfChoir, E = window.NfSheetEdit, X = window.NfMusicXml;

// Amazing Grace as its hymn page publishes it, in G major, 3/4, labelled as the result carries it.
const page = readFileSync(new URL("../hymns/amazing-grace/index.html", import.meta.url), "utf8");
const hymn = JSON.parse(/<script type="application\/json" id="hymn-data">([\s\S]*?)<\/script>/.exec(page)[1]);
const KEY = "G major", TS = "3/4";
const grace = C.label(hymn.notes.map((n) => ({ ...n, conf: 1 })), KEY);
const solfa = (notes) => notes.map((n) => n.solfa + n.octaveMark).join(" ");
// Objects made in the sandbox are of another realm: compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the opening reads as the hymn book has it", () => {
  assert.equal(solfa(grace.slice(0, 8)), "s, d m d m r d l,");
});

test("make the second m an f: the m's own octave, every other note as it was", () => {
  const out = E.edit(grace, KEY, TS, "make the second m an f");
  assert.equal(out.error, undefined);
  assert.equal(solfa(out.notes.slice(0, 8)), "s, d m d f r d l,");
  assert.equal(out.notes[4].pitchMidi, grace[4].pitchMidi + 1);
  assert.deepEqual(out.notes.map((n) => n.startBeat), grace.map((n) => n.startBeat));
  // Bars as the staff numbers them: the pickup (s,) is bar 0, so "m - - - r -" is bar 2.
  assert.equal(out.said, "Changed note 5 (bar 2) from m to f.");
  // The notes given are left as they were.
  assert.equal(grace[4].solfa, "m");
});

test("the phrasings people use all say the same thing", () => {
  for (const text of ["Make the 2nd m an f.", "change the second m to f", "the second m should be f",
    "replace the second m with f", "turn the second m into fah", "the second me to f", "change note 5 to f"]) {
    const out = E.edit(grace, KEY, TS, text);
    assert.equal(out.error, undefined, text);
    assert.equal(out.notes[4].solfa, "f", text);
  }
});

test("octave marks say which octave; without them the nearest one is taken", () => {
  // d (G4, the unmarked doh) to s: the nearest s is s, under it (D4), not s above (D5).
  const near = E.edit(grace, KEY, TS, "change note 2 to s");
  assert.equal(near.notes[1].pitchMidi, grace[1].pitchMidi - 5);
  assert.equal(near.notes[1].solfa + near.notes[1].octaveMark, "s,");
  const marked = E.edit(grace, KEY, TS, "change note 2 to s,");
  assert.equal(marked.notes[1].pitchMidi, 62);
  assert.equal(E.edit(grace, KEY, TS, "change note 2 to s, please").notes[1].pitchMidi, 62);
  const up = E.edit(grace, KEY, TS, "change note 2 to m'");
  assert.equal(up.notes[1].pitchMidi, 67 + 4 + 12);
  assert.equal(up.notes[1].solfa + up.notes[1].octaveMark, "m'");
});

test("a bar narrows the count, and the last counts from the end", () => {
  const bar = E.edit(grace, KEY, TS, "the first m in bar 2 to s");
  assert.equal(bar.notes[2].solfa, "m"); // bar 1's m untouched
  assert.equal(bar.notes[4].solfa, "s");
  const pickup = E.edit(grace, KEY, TS, "change the s, in the pickup to l,");
  assert.equal(pickup.said, "Changed note 1 (the pickup) from s, to l,.");
  const last = E.edit(grace, KEY, TS, "move the last d up an octave");
  const lastD = grace.map((n, i) => (n.solfa === "d" ? i : -1)).filter((i) => i >= 0).pop();
  assert.equal(last.notes[lastD].pitchMidi, grace[lastD].pitchMidi + 12);
  assert.match(last.said, /up an octave\.$/);
});

test("every one of a syllable, shifts, and deletes", () => {
  const every = E.edit(grace, KEY, TS, "change every m to f");
  assert.ok(!every.notes.some((n) => n.solfa === "m"));
  assert.match(every.said, /^Changed \d+ m’s to f\.$/);
  const lower = E.edit(grace, KEY, TS, "lower note 3 by a semitone");
  assert.equal(lower.notes[2].pitchMidi, grace[2].pitchMidi - 1);
  const raise = E.edit(grace, KEY, TS, "raise note 3 two semitones");
  assert.equal(raise.notes[2].pitchMidi, grace[2].pitchMidi + 2);
  const gone = E.edit(grace, KEY, TS, "delete note 3");
  assert.equal(gone.notes.length, grace.length - 1);
  assert.equal(gone.said, "Deleted note 3 (bar 1, m).");
});

test("what cannot be followed is said plainly, with how to put it", () => {
  assert.match(E.edit(grace, KEY, TS, "change the m to f").error, /^There are \d+ m’s\. Say which one, like “the second m”\.$/);
  assert.match(E.edit(grace, KEY, TS, "the 40th m to f").error, /^There are only \d+ m’s\.$/);
  assert.equal(E.edit(grace, KEY, TS, "change note 99 to f").error, `There are only ${grace.length} notes.`);
  assert.equal(E.edit(grace, KEY, TS, "the first ta to t").error, "There's no ta on this sheet.");
  assert.equal(E.edit(grace, KEY, TS, "the first d in bar 40 to r").error, "There are no notes in bar 40.");
  assert.equal(E.edit(grace, KEY, TS, "move note 1 up 5 octaves").error, "That would take note 1 (the pickup) off the keyboard.");
  assert.match(E.edit(grace, KEY, TS, "make it sound nicer").error, /^I couldn't tell which note you mean\. Try/);
  assert.match(E.edit(grace, KEY, TS, "make the second m nicer").error, /^I couldn't tell what to change it to\. Try/);
  assert.match(E.edit(grace, KEY, TS, "").error, /^Type a change to make\./);
});

test("the chromatics are their own syllables: la is flat lah, re sharp ray", () => {
  assert.deepEqual(plain(E.read("make the second m a la").change), { to: { syl: "la", marks: null } });
  const flat = E.edit(grace, KEY, TS, "change note 8 to la"); // l, (E4) to la, (Eb4)
  assert.equal(flat.notes[7].pitchMidi, grace[7].pitchMidi - 1);
  assert.equal(flat.notes[7].solfa, "la");
});

test("the edited sheet's staff: the pickup short, the last bar giving its beats back, ties over the bar line, the key's spelling", () => {
  const xml = X.build(grace, KEY, TS, 80);
  const bars = xml.split("<measure ").slice(1);
  const sums = bars.map((bar) => [...bar.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((a, m) => a + Number(m[1]), 0));
  // Amazing Grace enters on the third beat: a one-beat pickup, numbered 0, full bars from 1, and a last bar of two
  // beats ending on the final bar line, as the hymn book prints it.
  assert.match(bars[0], /^number="0" implicit="yes">/);
  assert.equal(sums[0], X.DIVISIONS);
  assert.ok(sums.slice(1, -1).every((sum) => sum === 3 * X.DIVISIONS));
  assert.equal(sums.at(-1), 2 * X.DIVISIONS);
  assert.doesNotMatch(bars.at(-1), /<rest/);
  assert.equal(xml.match(/light-heavy/g).length, 1);
  assert.match(bars.at(-1), /light-heavy/);
  assert.match(bars[1], /^number="1">/);
  assert.match(xml, /<fifths>1<\/fifths><mode>major<\/mode>/);
  assert.match(xml, /<beats>3<\/beats><beat-type>4<\/beat-type>/);
  assert.match(xml, /<per-minute>80<\/per-minute>/);
  // A note held over the bar line is one sound written as two tied heads.
  assert.equal(X.build([{ pitchMidi: 67, startBeat: 2, durBeats: 2 }], KEY, TS).match(/<tied type="(start|stop)"\/>/g).length, 2);
  // F# in G major has no accidental of its own; B♭ in F major is a flat, A# in E major a sharp.
  assert.deepEqual(plain(X.spell(66, X.keySignatureFor(7, "major"))), { letter: 3, octave: 4, alter: 1 });
  assert.equal(X.spell(70, X.keySignatureFor(5, "major")).alter, -1);
  assert.equal(X.spell(70, X.keySignatureFor(4, "major")).alter, 1);
  assert.equal(X.build([], KEY, TS), null);
});

test("the words under the staff stay with their notes through an edit, and through the next one", () => {
  const words = X.wordsFor(grace, hymn.musicXml);
  assert.equal(words.length, grace.length);
  assert.match(words[0], /<text>A<\/text>/);
  assert.match(words[1], /<text>maz<\/text>/);
  const gone = E.edit(grace, KEY, TS, "delete note 2");
  assert.deepEqual(plain(gone.from.slice(0, 3)), [0, 2, 3]);
  const xml = X.build(gone.notes, KEY, TS, 80, gone.from.map((k) => words[k]));
  const again = X.wordsFor(gone.notes, xml);
  assert.deepEqual(plain(again), plain(gone.from.map((k) => words[k])));
  assert.match(again[1], /<text>ing<\/text>/);
  // A note held over a bar line has its words once, under its first head.
  const held = X.build([{ pitchMidi: 67, startBeat: 2, durBeats: 2 }], KEY, TS, null, ['<lyric number="1"><text>Lo</text></lyric>']);
  assert.equal(held.match(/<lyric/g).length, 1);
  // A staff that cannot be paired note for note gives no words rather than the wrong ones.
  assert.equal(X.wordsFor(grace.slice(1), hymn.musicXml), null);
  assert.equal(X.wordsFor(grace, X.build(grace, KEY, TS)), null);
});
