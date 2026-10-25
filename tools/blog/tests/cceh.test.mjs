// The CCEH importer: the MIDI and Noteworthy readers on two real tunes from the Christian Classics Ethereal
// Hymnary (tests/fixtures/cceh: ITALIAN HYMN, with the tune in the soprano, and the tenor-lead setting of
// OLD HUNDREDTH), the melody voice chosen and checked by the incipit, the public-domain gate, de-duplication
// against our own tunes, the import run and the tune page it feeds.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { parseMidi } from "../import/midi.mjs";
import { readNwc, scoreBars } from "../import/nwc.mjs";
import { parseTunePage, parseCredit } from "../import/cceh-page.mjs";
import { chooseMelody, incipitDegrees, lineToMelody, writtenLength, skyline } from "../import/cceh-melody.mjs";
import { convertTune, datesTable, knownInCopyright } from "../import/cceh.mjs";
import { runImport, sameMelody, readIndex } from "../import/cceh-run.mjs";
import { parseMelody, loadEngine } from "../lib/solfa.mjs";
import { loadTunes } from "../lib/content.mjs";
import { prepareTune, renderTune, tuneMatcherEntry, tuneIndexItem } from "../lib/render-tunes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures", "cceh");
const read = (rel) => fs.readFileSync(path.join(FIX, rel));
const ITALIAN = { page: read("pages/x000002.htm").toString("latin1"), midi: read("files/000002a.mid"), nwc: read("nwc/000002a.nwc") };
const OLD100 = { page: read("pages/x000006.htm").toString("latin1"), midi: read("files/000006e.mid"), nwc: read("nwc/000006e.nwc") };
// Two scores saved by NoteWorthy Composer 1.70: GREENWELL (with its page and MIDI file) and ES IST EIN ROS.
const GREENWELL = { page: read("pages/x000433.htm").toString("latin1"), midi: read("files/000433a.mid"), nwc: read("nwc/000433a.nwc") };
const ROS = read("nwc/000584a.nwc");
const N = loadEngine();
const solfa = (melody, key, time, pickup) => Array.from(N.label(parseMelody(melody, { time, pickup }).notes, key), (n) => n.solfa);

// ── The readers ─────────────────────────────────────────────────────────────
test("midi: a real CCEH file — two staves of chords, its time and key signatures, Noteworthy's shortened notes", () => {
  const m = parseMidi(ITALIAN.midi);
  assert.equal(m.division, 192);
  assert.deepEqual(m.timeSigs.map((t) => `${t.num}/${t.den}`), ["3/4"]);
  assert.equal(m.keySigs[0].sf, -1); // one flat: F major
  const staves = m.tracks.filter((t) => t.notes.length);
  assert.equal(staves.length, 2);
  // A crotchet is written 1 beat and sounds 5/6 of it; the reader keeps what was played, the importer the written value.
  const first = staves[0].notes[0];
  assert.equal(first.start, 0);
  assert.equal(Math.round(((first.end - first.start) / m.division) * 1000) / 1000, 0.833);
  assert.equal(writtenLength(0.8333), 1);
  assert.equal(writtenLength(1.75), 2);
  assert.equal(writtenLength(2.75), 3);
  assert.equal(writtenLength(1.3333), 1.5);
  assert.equal(writtenLength(0.4896), 0.5);
  assert.equal(writtenLength(0.75), 0.75);
});

test("nwc: the Noteworthy score's bar lines, dots and time signature, which the MIDI file does not have", () => {
  const it = scoreBars(ITALIAN.nwc);
  assert.equal(`${it.num}/${it.den}`, "3/4");
  assert.equal(it.pickup, 0);
  assert.ok(it.bars.every((b) => b === 3), it.bars.join(" ")); // dotted minims and dotted crotchets add up
  assert.deepEqual(it.irregular, []);
  const old = scoreBars(OLD100.nwc);
  assert.equal(`${old.num}/${old.den}`, "2/2");
  assert.equal(old.pickup, 2); // a minim before the first bar line
  assert.equal(readNwc(Buffer.from("not a score")), null);
});

test("nwc 1.70: a later NoteWorthy layout read the same way — staves, bar lines, pickup, and notes where the MIDI file has them", () => {
  const staves = readNwc(GREENWELL.nwc);
  assert.deepEqual(staves.map((s) => s.name), ["Unnamed-000", "Unnamed-001"]);
  const g = scoreBars(GREENWELL.nwc);
  assert.equal(`${g.num}/${g.den}`, "3/4");
  assert.equal(g.pickup, 1); // one crotchet before the first bar line
  assert.deepEqual(g.bars, [1, 3, 3, 3, 3, 3, 3, 3, 2]);
  assert.deepEqual(g.irregular, []);
  assert.equal(g.timeChanges, false);
  // Every staff's notes start where the MIDI file's do (dotted quavers and semiquavers included), and end with it.
  const m = parseMidi(GREENWELL.midi);
  const tracks = m.tracks.filter((t) => t.notes.length);
  staves.forEach((s, i) => {
    let t = 0;
    const onsets = [];
    for (const e of s.events) { if (e.type === "note") onsets.push(t); if (e.dur) t += e.dur; }
    assert.deepEqual(onsets, [...new Set(tracks[i].notes.map((n) => n.start / m.division))].sort((a, b) => a - b), `staff ${i}`);
    assert.equal(t, 24);
  });
  // ES IST EIN ROS opens on a repeat sign and a full bar: no pickup, every bar whole but the last.
  const r = scoreBars(ROS);
  assert.equal(`${r.num}/${r.den}`, "4/4");
  assert.equal(r.pickup, 0);
  assert.deepEqual(r.bars, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3]);
  assert.deepEqual(r.irregular, []);
});

test("nwc 1.70: a damaged score is refused (null), never half read", () => {
  const plain = new Uint8Array(inflateSync(GREENWELL.nwc.subarray(6)));
  assert.equal(plain[45], 70);
  assert.ok(readNwc(plain), "the inflated score reads as the compressed one does");
  const changed = (f) => { const b = Uint8Array.from(plain); f(b); return b; };
  assert.equal(readNwc(plain.subarray(0, plain.length - 5)), null, "cut short");
  assert.equal(readNwc(plain.subarray(0, 600)), null, "cut short in the first staff");
  assert.equal(readNwc(GREENWELL.nwc.subarray(0, 300)), null, "compressed, cut short");
  assert.equal(readNwc(Buffer.concat([plain, Buffer.from([2, 0, 0, 0, 0])])), null, "bytes after the last staff");
  // A record type this reader does not know: the first staff's first record, a clef, made type 99.
  const first = Buffer.from(plain).indexOf("Standard\0", 0, "latin1") + 9 + 36;
  assert.deepEqual([plain[first], plain[first + 1]], [0, 0]);
  assert.equal(readNwc(changed((b) => { b[first] = 99; })), null, "an unknown record");
  assert.equal(readNwc(changed((b) => { b[first - 2] += 1; })), null, "one record too many counted");
  assert.equal(readNwc(changed((b) => { b[45] = 75; })), null, "another version (1.75)");
});

test("page: the tune's names, metre, incipits, credits and files are read as the page gives them", () => {
  const p = parseTunePage(ITALIAN.page);
  assert.equal(p.number, "000002");
  assert.equal(p.title, "Italian Hymn");
  assert.equal(p.metre, "6 6 4 6 6 6 4");
  assert.equal(p.incipit.doremi, "smdrdtd|drmfsfmr|smds");
  assert.deepEqual(p.otherNames, ["Moscow", "Trinity"]);
  assert.deepEqual(p.credits.map(({ raw, ...c }) => c), [{ name: "Felice de Giardini", year: 1769 }]);
  assert.deepEqual(p.files.filter((f) => f.kind === "midi").map((f) => f.href), ["000002a.mid", "000002b.mid", "000002c.mid"]);
  const o = parseTunePage(OLD100.page);
  assert.deepEqual(o.credits.map(({ raw, ...c }) => c), [
    { role: "attr. to", name: "Louis Bourgeois" },
    { book: "Genevan Psalter", year: 1551 },
    { role: "arr. for tenor lead", name: "John Dowland", born: 1562, died: 1626 },
  ]);
  assert.deepEqual(parseCredit({ text: "Mark Andrews, ©1931", html: "Mark Andrews, &copy;1931" }), { raw: "Mark Andrews, ©1931", copyright: true, name: "Mark Andrews", year: 1931 });
  assert.equal(parseCredit({ text: "Traditional", html: "Traditional" }).traditional, true);
  assert.equal(parseCredit({ text: "Anon.", html: "Anon." }).traditional, true);
  assert.equal(parseCredit({ text: "Netherlands folk song", html: "Netherlands folk song" }).traditional, true);
  assert.equal(parseCredit({ text: "Anon Composer, 1880-1960", html: "Anon Composer, 1880-1960" }).traditional, undefined, "a person with a life is never anonymous");
  assert.deepEqual(parseCredit({ text: "arr.", html: "arr." }), { raw: "arr.", role: "arr." });
  assert.deepEqual(parseCredit({ text: "tenor-lead arr., George Kirbye", html: "tenor-lead arr., George Kirbye" }), { raw: "tenor-lead arr., George Kirbye", role: "arr. for tenor lead", name: "George Kirbye" });
  assert.deepEqual(parseCredit({ text: "harm., ad., David Evans, 1927", html: "harm., ad., David Evans, 1927" }), { raw: "harm., ad., David Evans, 1927", role: "harm., ad.", year: 1927, name: "David Evans" });
  // A person beside a book: the tune's composer (or its publisher), the book where it was printed.
  assert.deepEqual(parseCredit({ text: "Joachim Neander, Glaub-und-Liebesubung, 1680", html: "Joachim Neander, <i>Glaub-und-Liebesubung</i>, 1680" }), { raw: "Joachim Neander, Glaub-und-Liebesubung, 1680", year: 1680, book: "Glaub-und-Liebesubung", name: "Joachim Neander" });
  assert.equal(parseCredit({ text: "Geistliche Kirchengesang, Cologne, 1623", html: "<i>Geistliche Kirchengesang</i>, Cologne, 1623" }).place, "Cologne");
});

// ── The melody voice ────────────────────────────────────────────────────────
test("melody: ITALIAN HYMN's tune is the top of the treble staff, note for note the incipit, barred by the score", () => {
  const m = parseMidi(ITALIAN.midi);
  const ch = chooseMelody(m, incipitDegrees("smdrdtd|drmfsfmr|smds"));
  assert.equal(ch.line.staff, 0);
  assert.equal(ch.line.part, "top");
  assert.equal(ch.match.distance, 0);
  assert.equal(ch.match.doh, 5); // F
  const mel = lineToMelody(ch.line, m, { doh: ch.match.doh, allLines: ch.candidates, score: scoreBars(ITALIAN.nwc) });
  assert.equal(mel.barsFrom, "score");
  assert.equal(mel.key, "F major");
  assert.equal(mel.time, "3/4");
  assert.equal(mel.pickup, 0);
  assert.match(mel.melody, /^C5:1 A4:1 F4:1 \| G4:1 F4:1 E4:1 \| F4:3 \| F4:1 G4:1 A4:1 \| Bb4:\.5 C5:\.5 Bb4:1 A4:1 \| G4:3 \|/);
  assert.deepEqual(solfa(mel.melody, mel.key, mel.time, mel.pickup).slice(0, 7), "s m d r d t d".split(" "));
  assert.deepEqual(mel.problems, []);
});

test("melody: a tenor-lead setting — the tune is the top of the bass staff, matched by the incipit and written an octave up", () => {
  const m = parseMidi(OLD100.midi);
  const deg = incipitDegrees("ddtlsdrm|mmmrdfmr");
  const ch = chooseMelody(m, deg);
  assert.equal(ch.line.staff, 1, "the lower staff");
  assert.equal(ch.line.part, "top", "its upper line, the tenor");
  assert.equal(ch.match.distance, 0);
  // The soprano is a descant here: it does not match the incipit.
  const soprano = ch.candidates.find((c) => c.staff === 0 && c.part === "top");
  assert.ok(soprano.match.distance > 2);
  const mel = lineToMelody(ch.line, m, { doh: ch.match.doh, allLines: ch.candidates, score: scoreBars(OLD100.nwc) });
  assert.equal(mel.shift, 12);
  assert.equal(mel.key, "G major");
  assert.equal(mel.pickup, 2);
  assert.match(mel.melody, /^G4:2 \| G4:1 F#4:1 E4:1 D4:1 \| G4:2 A4:2 \|/);
  assert.deepEqual(solfa(mel.melody, mel.key, mel.time, mel.pickup).slice(0, 8), "d d t l s d r m".split(" "));
});

test("melody: no voice matching the incipit means no melody, never the alto by default", () => {
  const m = parseMidi(ITALIAN.midi);
  const ch = chooseMelody(m, incipitDegrees("ddddrrrrmmmmffff"));
  assert.equal(ch.line, null);
  assert.match(ch.reason, /no voice in the MIDI file matches the incipit/);
  assert.match(chooseMelody(m, incipitDegrees("")).reason, /no usable incipit/);
  // A held top note is not interrupted by an inner voice moving under it.
  const notes = [{ pitch: 72, start: 0, end: 384 }, { pitch: 64, start: 0, end: 192 }, { pitch: 65, start: 192, end: 384 }, { pitch: 74, start: 384, end: 576 }];
  assert.deepEqual(skyline(notes).map((n) => n.pitch), [72, 74]);
  assert.deepEqual(skyline(notes, { top: false }).map((n) => n.pitch), [64, 65, 74]);
});

test("melody: without the score the bar lines are read off the rhythm, and the tune is held back to be checked", () => {
  const m = parseMidi(ITALIAN.midi);
  const ch = chooseMelody(m, incipitDegrees("smdrdtd|drmfsfmr|smds"));
  const mel = lineToMelody(ch.line, m, { doh: ch.match.doh, allLines: ch.candidates });
  assert.equal(mel.barsFrom, "rhythm");
  assert.equal(mel.pickup, 0);
  assert.ok(mel.problems.some((p) => /read off the rhythm/.test(p.text)));
});

test("melody: a 1.70 score bars GREENWELL as CCEH prints it — a one-beat pickup, where the rhythm alone guessed two", () => {
  const dates = datesTable();
  dates.add("William James Kirkpatrick", { born: 1838, died: 1921, from: "a test" });
  const r = convertTune({ page: GREENWELL.page, midi: GREENWELL.midi, midiHref: "000433a.mid", nwc: GREENWELL.nwc, nwcHref: "000433a.nwc", dates });
  assert.deepEqual(r.problems, []);
  assert.equal(r.tune.draft, false);
  assert.equal(r.tune.time, "3/4");
  assert.equal(r.tune.pickup, 1);
  assert.match(r.tune.melody, /^E4:1 \| Ab4:\.5 Ab4:\.5 Ab4:1 B4:1 \| B4:\.5 A4:\.5 A4:1 Ab4:1 \|/);
  assert.match(r.tune.reviewNotes, /bar lines are those of CCEH's Noteworthy score \(000433a\.nwc\)/);
  const m = parseMidi(GREENWELL.midi);
  const ch = chooseMelody(m, incipitDegrees(r.incipit.doremi));
  assert.equal(lineToMelody(ch.line, m, { doh: ch.match.doh, allLines: ch.candidates }).pickup, 2);
});

// ── The public-domain gate ──────────────────────────────────────────────────
const withDates = (entries) => { const d = datesTable(); for (const [n, x] of Object.entries(entries)) d.add(n, { ...x, from: "a test" }); return d; };
const ital = (page = ITALIAN.page, dates = withDates({ "Felice de Giardini": { born: 1716, died: 1796 } })) => convertTune({ page, midi: ITALIAN.midi, midiHref: "000002a.mid", nwc: ITALIAN.nwc, nwcHref: "000002a.nwc", dates });

test("gate: a dated composer and a year before 1929 publish, credited to CCEH with its licence", () => {
  const r = ital();
  assert.equal(r.refused, null);
  assert.deepEqual(r.problems, []);
  const t = r.tune;
  assert.equal(t.draft, false);
  assert.equal(t.source, "CCEH");
  assert.equal(t.sourceUrl, "https://www.ccel.org/cceh/0000/x000002.htm");
  assert.equal(t.scoreUrl, "https://www.ccel.org/cceh/0000/000002a.mid");
  assert.match(t.licence, /free to use in any manner/);
  assert.equal(t.reviewed, false);
  assert.equal(t.confidence, "imported, unchecked");
  assert.deepEqual(t.music, [{ name: "Felice de Giardini", born: 1716, died: 1796, role: "Music (1769)" }]);
  assert.equal(t.musicPublished, 1769);
  assert.equal(t.metre, "6 6 4 6 6 6 4");
  assert.deepEqual(t.alsoKnownAs, ["Moscow", "Trinity"]);
  assert.match(t.reviewNotes, /dates \(1716–1796\) are from a test/);
});

test("gate: a composer without a death year is a draft that says so; no year for the tune too", () => {
  // Dated 1869: too late for the pre-1850 rule, so without a death year the tune waits.
  const r = ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Felice de Giardini, 1869"), datesTable());
  assert.equal(r.refused, null);
  assert.equal(r.tune.draft, true);
  assert.ok(r.problems.some((p) => /Felice de Giardini: public domain needs a death year before 1955/.test(p)), r.problems.join(" | "));
  assert.match(r.tune.reviewNotes, /^Held back: /);
  const noYear = ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Felice de Giardini"));
  assert.ok(noYear.problems.includes("the page gives no year for the tune"));
});

test("gate: work in print before 1850 counts as a death before 1955 (activeBy), never as a made-up death year", () => {
  const r = ital(ITALIAN.page, datesTable());
  assert.equal(r.refused, null);
  assert.ok(!r.problems.some((p) => /Felice de Giardini/.test(p)), r.problems.join(" | "));
  const giardini = r.tune.music.find((p) => p.name === "Felice de Giardini");
  assert.equal(giardini.activeBy, 1769);
  assert.equal(giardini.died, undefined);
  assert.match(JSON.stringify(r.tune), /dated 1769, before 1850/, "the tune records why");
});

test("gate: a composer with no year of their own, above a book dated before 1850, takes the book's year (activeBy)", () => {
  // HOLY MANNA as CCEH credits it: "attr., William Moore" then "Columbian Harmony, 1825".
  const r = ital(ITALIAN.page.replace("Felice de Giardini, 1769", "attr., William Moore</dd><dd>Columbian Harmony, 1825"), datesTable());
  assert.equal(r.refused, null);
  assert.ok(!r.problems.some((p) => /William Moore/.test(p)), r.problems.join(" | "));
  const moore = r.tune.music.find((p) => p.name === "William Moore");
  assert.equal(moore.activeBy, 1825);
  assert.equal(moore.died, undefined);
  // An arranger's missing year is never filled from the tune's.
  const arr = ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Felice de Giardini, 1769</dd><dd>arr., Someone Undated"), datesTable());
  assert.equal(arr.tune.music.find((p) => p.name === "Someone Undated").activeBy, undefined);
});

test("gate: checked dates can correct a misspelt name, and give a disputed person a century instead of years", () => {
  const dates = datesTable();
  dates.add("Felice de Giardini", { born: 1716, died: 1796, correctName: "Felice Giardini", from: "a test" });
  const r = ital(ITALIAN.page, dates);
  assert.deepEqual(r.tune.music.map((p) => p.name), ["Felice Giardini"]);
  assert.match(r.tune.reviewNotes, /spells Felice Giardini as “Felice de Giardini”/);
  const disputed = datesTable();
  disputed.add("Felice de Giardini", { died: 1928, lived: "18th century", from: "a test" });
  const d = ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Felice de Giardini, 1869"), disputed);
  assert.equal(d.tune.draft, false, d.problems.join(" | "));
  assert.equal(d.tune.music[0].lived, "18th century");
  assert.match(d.tune.reviewNotes, /dates are uncertain/);
});

test("gate: Vaughan Williams, a death in 1955 or later, a © or a year after 1928 — refused, nothing copied", () => {
  // KINGSFOLD and SINE NOMINE as CCEH credits them: no dates on the page, but a known death in 1958.
  const rvw = ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Traditional English melody</dd><dd>arr., Ralph Vaughan Williams, 1906"));
  assert.match(rvw.refused, /Ralph Vaughan Williams died in 1958/);
  assert.ok(knownInCopyright("R. Vaughan Williams"));
  assert.ok(knownInCopyright("Vaughan Williams"));
  assert.equal(knownInCopyright("Samuel Sebastian Wesley"), null);
  assert.match(ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Jean Sibelius, 1899")).refused, /Jean Sibelius died in 1957/);
  assert.match(ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Anon Composer, 1880-1960")).refused, /died in 1960/);
  assert.match(ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Mark Andrews, &copy;1931")).refused, /copyright/);
  assert.match(ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Someone New, 1931")).refused, /first published in 1931, after 1928/);
  assert.match(ital(ITALIAN.page.replace("Felice de Giardini, 1769", "Felice de Giardini, 1769</dd><dd>arr., Someone Later, 1950")).refused, /arrangement is dated 1950/);
});

// ── De-duplication ──────────────────────────────────────────────────────────
test("dedupe: the same tune in another key is the same tune; another tune is not", () => {
  const ours = loadTunes();
  const r = ital();
  assert.equal(sameMelody(ours["italian-hymn"].parsed.notes, r.parsed.notes), 0, "ours is in G, CCEH's in F");
  assert.equal(sameMelody(ours["new-britain"].parsed.notes, r.parsed.notes), null);
  const up = r.parsed.notes.map((n) => ({ ...n, pitchMidi: n.pitchMidi + 5 }));
  assert.equal(sameMelody(up, r.parsed.notes), 0);
  // Another book's version — a passing note added, a note altered — is still the same tune.
  const variant = [...r.parsed.notes.slice(0, 5), { ...r.parsed.notes[4], pitchMidi: r.parsed.notes[4].pitchMidi + 2 }, ...r.parsed.notes.slice(5, 9), { ...r.parsed.notes[9], pitchMidi: r.parsed.notes[9].pitchMidi - 1 }, ...r.parsed.notes.slice(10)];
  const dv = sameMelody(variant, r.parsed.notes);
  assert.ok(dv !== null && dv <= 3, String(dv));
  // Two tunes that open alike and then part are different tunes: the same first 24 notes, then another line.
  const opening = r.parsed.notes.slice(0, 24);
  const parted = [...opening, ...r.parsed.notes.slice(24).map((x, i) => ({ ...x, pitchMidi: x.pitchMidi + [3, -2, 5, 1, -4][i % 5] }))];
  const same = [...opening, ...r.parsed.notes.slice(24)];
  assert.ok(r.parsed.notes.length >= 40, "the fixture is long enough to part after its opening");
  assert.equal(sameMelody(same, r.parsed.notes), 0);
  assert.equal(sameMelody(parted, r.parsed.notes), null);
  // No two different tunes in our library are taken for each other.
  for (const [a, b] of [["new-britain", "italian-hymn"], ["old-hundredth", "duke-street"], ["nicaea", "hyfrydol"]]) assert.equal(sameMelody(ours[a].parsed.notes, ours[b].parsed.notes), null, `${a} / ${b}`);
});

// ── The run ─────────────────────────────────────────────────────────────────
test("run: ours is kept where we have the tune, the new one written as a tune page, the report counts both", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-cceh-"));
  try {
    const tunesDir = path.join(dir, "tunes"), hymnsDir = path.join(dir, "hymns");
    fs.mkdirSync(tunesDir); fs.mkdirSync(hymnsDir);
    const real = path.join(here, "..", "..", "..", "content", "hymns", "tunes");
    fs.copyFileSync(path.join(real, "italian-hymn.json"), path.join(tunesDir, "italian-hymn.json"));
    assert.deepEqual(readIndex(FIX).map((e) => e.number), ["000002", "000006"]);
    const reportPath = path.join(dir, "report.json");
    const run = () => runImport({ cache: FIX, today: "2026-10-16", tunesDir, hymnsDir, reportPath, datesFile: path.join(dir, "no-dates.json"), log: () => {} });
    const rep = run();
    assert.equal(rep.counts.duplicates, 1);
    assert.equal(rep.duplicates[0].ours, "italian-hymn");
    // OLD HUNDREDTH: Louis Bourgeois has no dates in this library, but the Genevan Psalter of 1551 the page
    // dates the tune by is before 1850, so it publishes with him active by 1551.
    assert.equal(rep.counts.drafts, 0, JSON.stringify(rep.drafts));
    assert.ok(!rep.undatedPeople.some((p) => p.name === "Louis Bourgeois"));
    const t = JSON.parse(fs.readFileSync(path.join(tunesDir, "old-hundredth.json"), "utf8"));
    assert.equal(t.importedFrom, "cceh:000006");
    assert.equal(t.draft, false);
    assert.equal(t.music.find((p) => p.name === "Louis Bourgeois").activeBy, 1551);
    assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).counts.pages, 2);
    // Running again changes nothing.
    const before = fs.readFileSync(path.join(tunesDir, "old-hundredth.json"), "utf8");
    run();
    assert.equal(fs.readFileSync(path.join(tunesDir, "old-hundredth.json"), "utf8"), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run: a tune page that names no one for the music is rejected, never written as a draft", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-cceh-anon-"));
  try {
    const cache = path.join(dir, "cache");
    fs.cpSync(FIX, cache, { recursive: true });
    const page = path.join(cache, "pages", "x000006.htm");
    fs.writeFileSync(page, fs.readFileSync(page, "latin1").replace(/<dt><b>Author:<\/b><\/dt><dd>[^<]*<\/dd>\s*<dd><i>Genevan Psalter<\/i>, 1551<\/dd>/, ""), "latin1");
    const tunesDir = path.join(dir, "tunes");
    const hymnsDir = path.join(dir, "hymns");
    fs.mkdirSync(tunesDir);
    fs.mkdirSync(hymnsDir);
    const rep = runImport({ cache, today: "2026-10-17", tunesDir, hymnsDir, reportPath: path.join(dir, "report.json"), datesFile: path.join(dir, "no-dates.json"), log: () => {} });
    const anon = rep.rejected.find((x) => x.number === "000006");
    assert.ok(anon, JSON.stringify(rep.rejected));
    assert.equal(anon.reason, "the page names no composer or source for the tune");
    assert.ok(!rep.drafts.some((d) => d.number === "000006"));
    assert.ok(!fs.existsSync(path.join(tunesDir, "old-hundredth.json")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── The tune page and the content gate ──────────────────────────────────────
test("content: a published tune page must pass the public-domain test; a draft may wait for its facts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-tunes-"));
  try {
    const t = { ...ital().tune, updated: "2026-10-16" };
    fs.writeFileSync(path.join(dir, "italian-hymn.json"), JSON.stringify(t));
    assert.equal(loadTunes(dir)["italian-hymn"].draft, false);
    fs.writeFileSync(path.join(dir, "italian-hymn.json"), JSON.stringify({ ...t, music: [{ name: "Felice de Giardini", role: "Music (1769)" }] }));
    assert.throws(() => loadTunes(dir), /Felice de Giardini: public domain needs a death year/);
    fs.writeFileSync(path.join(dir, "italian-hymn.json"), JSON.stringify({ ...t, draft: true, music: [{ name: "Felice de Giardini", role: "Music (1769)" }] }));
    assert.equal(loadTunes(dir)["italian-hymn"].draft, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tune page: the solfa, the staff, the credit to CCEH and the composer, and the matcher's entry", () => {
  const t = prepareTune({ ...ital().tune, slug: "italian-hymn-cceh", updated: "2026-10-16", parsed: ital().parsed, title: "Italian Hymn" });
  const html = renderTune(t, { hymns: [], posts: [] });
  assert.match(html, /<h1>Italian Hymn: hymn tune in Tonic Solfa<\/h1>/);
  assert.match(html, /Melody from the <a href="https:\/\/www\.ccel\.org\/cceh\/0000\/x000002\.htm" rel="noopener">Christian Classics Ethereal Hymnary<\/a> \(CCEH, public domain\); tune ITALIAN HYMN by Felice de Giardini \(1716–1796\)\./);
  assert.match(html, /Doh is F/);
  assert.match(html, /<link rel="canonical" href="https:\/\/notefusion\.studio\/hymns\/tunes\/italian-hymn-cceh">/);
  assert.match(tuneIndexItem(t), /data-kind="tune"/);
  const e = tuneMatcherEntry(t);
  assert.equal(e.kind, "score");
  assert.equal(e.url, "https://notefusion.studio/hymns/tunes/italian-hymn-cceh");
  assert.equal(e.source, "Christian Classics Ethereal Hymnary");
  assert.equal(e.lyrics, "");
  assert.equal(e.checked, false);
  assert.deepEqual(e.notes.slice(0, 2), [[72, 0, 1], [69, 1, 1]]);
});
