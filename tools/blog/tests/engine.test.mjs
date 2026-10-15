// The blog's solfa comes from the engine (web-site/assets/choir.js), not from this tool: these tests
// check the wrapper hands the engine the right notes and lays out what it returns, and hand-check a
// few syllables a church musician would know by heart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseMelody, engineGrid, toLines, lineText, lineWords, scaleMelody, transposeInterval, spellPitch, parsePitch, ENGINE_PATH } from "../lib/solfa.mjs";

// An independent copy of the engine, loaded the way web-site/tests/choir.test.mjs loads it.
const window = {};
vm.runInNewContext(readFileSync(ENGINE_PATH, "utf8"), { window });
const Engine = window.NfChoir;

const AMAZING = "D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | D5:3~ | D5:2 B4:1 | D5:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:.5 G4:.5 | B4:2 A4:1 | G4:3~ | G4:2";
const AMAZING_WORDS = "A-maz-ing_ grace! how sweet the sound, That saved a_ wretch like me! I once was_ lost, but now am found; Was blind, but_ now I see.";
const name = (n) => n.solfa + n.octaveMark;

test("pitches parse to MIDI (C4 = 60)", () => {
  assert.equal(parsePitch("C4"), 60);
  assert.equal(parsePitch("F#4"), 66);
  assert.equal(parsePitch("Bb3"), 58);
  assert.throws(() => parsePitch("H4"));
});

test("a melody's bars must add up, and a pickup lands at the end of the first grid bar", () => {
  const m = parseMelody(AMAZING, { time: "3/4", pickup: 1 });
  assert.equal(m.offset, 2);
  assert.equal(m.notes[0].startBeat, 2);
  assert.equal(m.notes.length, 32); // the two tied pairs are one note each
  const me = m.notes.find((n) => n.pitchMidi === 74);
  assert.equal(me.durBeats, 5); // "me", D5 held over the bar line
  assert.throws(() => parseMelody("G4:1 A4:1 | B4:3", { time: "3/4" }), /bar 1 has 2 beats/);
  assert.throws(() => parseMelody("G4:.25 G4:2.75", { time: "3/4" }), /half beats/);
  assert.throws(() => parseMelody("D4:2 | G4:3", { time: "3/4", pickup: 1 }), /pickup bar has 2 beats/);
});

test("Amazing Grace's opening in G is the engine's solfa — s, d m d m r d l, s,", () => {
  const m = parseMelody(AMAZING, { time: "3/4", pickup: 1 });
  const g = engineGrid(m, { key: "G major", underlay: AMAZING_WORDS });
  // Exactly what the engine itself returns for these notes.
  const direct = Array.from(Engine.label(m.notes, "G major"), name);
  assert.deepEqual(g.labelled.map(name), direct);
  // And by hand: the hymn-book solfa every choir in G sings.
  assert.deepEqual(direct.slice(0, 9), ["s,", "d", "m", "d", "m", "r", "d", "l,", "s,"]);
  assert.equal(direct[15], "s"); // "me": the soh above doh, no octave mark
  assert.equal(g.header, "Doh is G");
});

test("the grid is the engine's hymnRows, laid out in hymn-book lines with the words", () => {
  const m = parseMelody(AMAZING, { time: "3/4", pickup: 1 });
  const g = engineGrid(m, { key: "G major", underlay: AMAZING_WORDS });
  const lines = toLines(g.bars, { lineBars: 4, pickup: 1 });
  assert.equal(lines.length, 4);
  assert.equal(lineText(lines[0]), "| s, - | d - - - m d | m - - - r - | d - - - l, - | s, - - - s, - |");
  assert.equal(lineWords(lines[0]), "Amazing grace! how sweet the sound, That");
  assert.equal(lineWords(lines[3]), "blind, but now I see.");
  // Cells straight from the engine (the pickup's empty cells trimmed).
  const raw = Engine.hymnRows(Engine.label(m.notes, "G major"), AMAZING_WORDS, "3/4", 1e6)[0];
  assert.deepEqual(g.bars[1].map((c) => c.solfa), Array.from(raw[1], (c) => c.solfa));
  assert.deepEqual(Array.from(raw[0].slice(0, 4), (c) => c.solfa), ["_", "_", "_", "_"]);
  assert.deepEqual(g.bars[0].map((c) => c.solfa), ["s,", "-"]);
});

test("moving the doh changes the header and none of the syllables", () => {
  const m = parseMelody(AMAZING, { time: "3/4", pickup: 1 });
  const g = engineGrid(m, { key: "G major" });
  const f = engineGrid(m, { key: "F major", transpose: transposeInterval("G major", "F major") });
  assert.equal(transposeInterval("G major", "F major"), -2);
  assert.equal(f.header, "Doh is F");
  assert.deepEqual(f.labelled.map(name), g.labelled.map(name));
  assert.equal(f.notes[0].pitchMidi, 60); // D4 down a tone is C4
});

test("scales: major from doh, minor la-based, harmonic minor's raised seventh is se", () => {
  const g = scaleMelody("G major");
  assert.deepEqual(engineGrid(g.melody, { key: "G major" }).labelled.map(name), ["d", "r", "m", "f", "s", "l", "t", "d'"]);
  assert.equal(g.words, "G A B C D E F♯ G");
  const a = scaleMelody("A minor");
  const ga = engineGrid(a.melody, { key: "A minor" });
  assert.equal(ga.header, "Doh is C");
  assert.deepEqual(ga.labelled.map(name), ["l,", "t,", "d", "r", "m", "f", "s", "l"]);
  const h = scaleMelody("A minor", { harmonic: true });
  assert.equal(engineGrid(h.melody, { key: "A minor" }).labelled.map(name)[6], "se");
  assert.equal(scaleMelody("F major").words, "F G A B♭ C D E F");
});

test("letter names are spelled the way the key signature spells them", () => {
  assert.deepEqual(spellPitch(70, "F major"), { letter: "B", alter: -1, octave: 4 });
  assert.deepEqual(spellPitch(66, "D major"), { letter: "F", alter: 1, octave: 4 });
  assert.deepEqual(spellPitch(61, "D minor"), { letter: "C", alter: 1, octave: 4 }); // leading note, not Db
  assert.deepEqual(spellPitch(63, "Bb major"), { letter: "E", alter: -1, octave: 4 });
});
