// The Open Hymnal Project importer: the ABC reader on real scores from the hymnal (tests/fixtures/ohp,
// the melody voice of two scores), the conversion to the hymn format, and the gates that keep a hymn a
// draft or out of the repository altogether.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbc, readMusicLine, lyricTokens, parseKeyField, parseMeter, decodeAbc } from "../import/abc.mjs";
import { convertScore, parsePeople, firstYear, creditClauses, retextUnderlay, titleCase, toLines } from "../import/ohp.mjs";
import { runImport } from "../import/run.mjs";
import { loadEngine } from "../lib/solfa.mjs";
import { loadAll } from "../lib/content.mjs";
import { prepareHymn, renderHymn, creditLine } from "../lib/render-hymns.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures", "ohp");
const TO_GOD = fs.readFileSync(path.join(FIX, "To_God_Be_the_Glory-To_God_Be_the_Glory.abc"), "utf8");
const BENEATH = fs.readFileSync(path.join(FIX, "Beneath_The_Cross_Of_Jesus-St_Christopher.abc"), "utf8");
const N = loadEngine();
const name = (n) => n.solfa + n.octaveMark;

// ── The ABC reader ──────────────────────────────────────────────────────────
test("abc: keys, metres and the key signature's accidentals", () => {
  assert.deepEqual(parseKeyField("Ab % key signature").accidentals, { B: -1, E: -1, A: -1, D: -1 });
  assert.equal(parseKeyField("Dm").mode, "minor");
  assert.equal(parseKeyField("Dm").majorTonic, "F");
  assert.equal(parseKeyField("E dorian").majorTonic, "D");
  assert.throws(() => parseKeyField("FC"), /cannot read the key/);
  assert.deepEqual(parseMeter("3/4 % time"), { text: "3/4", beats: 3, unit: 4 });
  assert.equal(parseMeter("C|").text, "2/2");
  assert.equal(parseMeter("none"), null);
});

test("abc: notes, octaves, lengths, accidentals through the bar, chords, ties and broken rhythm", () => {
  const st = { key: parseKeyField("G"), unit: 1, barAcc: {}, broken: null, problems: [] };
  const ev = readMusicLine("D | G2 B/G/ | ^c d- | d3/4 e/4 [GBd]2 | A>B =F c' C, !fermata!z", st).filter((e) => e.type !== "bar");
  const notes = ev.filter((e) => e.type === "note");
  assert.deepEqual(notes.map((e) => e.midi), [62, 67, 71, 67, 73, 74, 74, 76, 74, 69, 71, 65, 84, 48]);
  assert.deepEqual(notes.map((e) => e.dur), [1, 2, .5, .5, 1, 1, .75, .25, 2, 1.5, .5, 1, 1, 1]);
  assert.equal(notes[5].tie, true); // d- ties into the next bar's d
  assert.equal(notes[9].chord, false);
  assert.equal(notes[8].chord, true); // [GBd]: the top note is the melody
  assert.equal(ev[ev.length - 1].type, "rest");
  // F is sharp in G; the natural (=F) holds only for its bar.
  assert.equal(readMusicLine("F =F F | F", { ...st, barAcc: {} }).filter((e) => e.type === "note").map((e) => e.midi).join(), "66,65,65,66");
});

test("abc: what it will not render is recorded, not guessed", () => {
  const st = { key: parseKeyField("C"), unit: 1, barAcc: {}, broken: null, problems: [] };
  readMusicLine("(3CDE F |: G A :| {g}c", st);
  assert.deepEqual(st.problems.sort(), ["grace notes left out", "repeat signs", "triplets"]);
});

test("abc: lyric tokens — hyphens, holds, skips, bar jumps, ~ and \\-", () => {
  const t = lyricTokens("1.~A- maz- ing * grace! life\\- im- part_ | how");
  assert.deepEqual(t, [
    { text: "1. A", joins: true }, { text: "maz", joins: true }, { text: "ing", joins: false }, { skip: true },
    { text: "grace!", joins: false }, { text: "life‑", joins: false }, { text: "im", joins: true }, { text: "part", joins: false }, { hold: true }, { bar: true }, { text: "how", joins: false },
  ]);
  assert.deepEqual(lyricTokens("3.~$1D$2~All praise"), [{ text: "3. All", joins: false }, { text: "praise", joins: false }]);
});

test("abc: a real score — To God Be the Glory's melody voice, verses and metadata", () => {
  const abc = parseAbc(TO_GOD);
  assert.equal(abc.melodyVoice, "S1V1");
  assert.equal(abc.meter.text, "3/4");
  assert.equal(abc.tempo, 120);
  assert.equal(abc.segments.length, 6);
  assert.deepEqual(abc.segments.map((s) => s.lyrics.length), [3, 3, 3, 1, 1, 1]); // three verses, then the refrain once
  assert.equal(abc.meta.COMPOSER, "Doane, William Howard (1832-1915)");
  assert.deepEqual(abc.problems, []);
});

// ── The conversion ──────────────────────────────────────────────────────────
test("ohp: people, years and credits are read only as the score gives them", () => {
  assert.deepEqual(parsePeople("Crosby, Fanny Jane (1820-1915)"), [{ name: "Fanny Jane Crosby", born: 1820, died: 1915 }]);
  assert.deepEqual(parsePeople("Wolder, David (?-1604)"), [{ name: "David Wolder", died: 1604 }]);
  assert.deepEqual(parsePeople("Prudentius, Aurelius Clemens (5th Century)")[0].lived, "5th century");
  assert.deepEqual(parsePeople("Penney, Brian L. (1951-)"), [{ name: "Brian L. Penney", born: 1951, living: true }]);
  assert.deepEqual(parsePeople("Jeater, William (1858-?)"), [{ name: "William Jeater", born: 1858 }]); // no death year: unverifiable, not living
  assert.equal(parsePeople("from Klug's Geistliche Lieder, Wittenberg, 1533")[0].traditional, true);
  assert.deepEqual(parsePeople("none"), []);
  assert.equal(firstYear("John Newton, 1779. last verse author unknown, before 1829."), 1779);
  assert.equal(firstYear("'Es ist das Heil' traditional German circa 1400 from Etlich Christlich Lider, Wittenberg, 1524."), 1524);
  assert.equal(firstYear("Ambrose of Milan, 4th Century. German version by M. Luther, 1543."), 400);
  const c = creditClauses(["Words: Fanny Crosby, 1875. Music and Setting: 'To God Be The Glory' William Howard Doane, 1875.", "copyright: public domain."]);
  assert.equal(firstYear(c.words), 1875);
  assert.match(c.music, /^'To God Be The Glory' William Howard Doane, 1875/);
  assert.equal(titleCase("Come Thou Fount Of Every Blessing"), "Come Thou Fount of Every Blessing");
  assert.equal(titleCase("old 100th"), "Old 100th");
});

test("ohp: To God Be the Glory converts with its semiquavers, every verse, the refrain once, and passes every gate", () => {
  const r = convertScore(TO_GOD, { base: "To_God_Be_the_Glory-To_God_Be_the_Glory", today: "2026-10-16" });
  assert.deepEqual(r.problems, []);
  assert.equal(r.copyright, null);
  assert.equal(r.hymn.draft, false);
  assert.equal(r.tune.key, "Ab major");
  assert.equal(r.tune.time, "3/4");
  assert.equal(r.tune.pickup, 1);
  assert.match(r.tune.melody, /Ab4:2 C5:\.75 Db5:\.25 \| Eb5:2 C5:\.75 Db5:\.25/); // "Praise the Lord, praise the Lord"
  assert.equal(N.syllabify(r.hymn.underlay).length, r.parsed.notes.length);
  assert.match(r.hymn.underlay, /^To God be the glor-y, great things He has done;/);
  assert.deepEqual(r.hymn.verses.map((v) => v.label || v.lines[0]), ["To God be the glory, great things He has done;", "Refrain", "O perfect redemption, the purchase of blood,", "Great things He has taught us, great things He has done,"]);
  assert.equal(r.hymn.verses[1].lines[0], "Praise the Lord, praise the Lord, Let the earth hear His voice!"); // 12 syllables, as the metre counts
  assert.deepEqual(r.hymn.text, [{ name: "Fanny Jane Crosby", born: 1820, died: 1915, role: "Words (1875)" }]);
  assert.equal(r.tune.musicPublished, 1875);
  assert.equal(r.hymn.source, "Open Hymnal Project");
  assert.equal(r.hymn.sourceUrl, "http://openhymnal.org/Lyrics/To_God_Be_the_Glory-To_God_Be_the_Glory.html");
  assert.match(r.hymn.credits, /Open Hymnal Project.*edited by Brian J\. Dumont; public domain/);
  assert.equal(r.tune.confidence, "imported, unchecked: every automatic check passed");
  assert.equal(r.hymn.reviewed, false);
  // The engine names the refrain's dotted rhythm: "m -,f | s" on "Praise the Lord".
  const lab = Array.from(N.label(r.parsed.notes, r.tune.key), name);
  const i = r.parsed.notes.findIndex((n) => n.durBeats === 0.25);
  assert.deepEqual(lab.slice(i - 1, i + 2), ["m", "f", "s"]);
});

test("ohp: a dotted tie (.-) keeps two notes, so each verse can sing them as it needs", () => {
  const r = convertScore(BENEATH, { base: "Beneath_The_Cross_Of_Jesus-St_Christopher", today: "2026-10-16" });
  assert.deepEqual(r.problems, []);
  assert.equal(N.syllabify(r.hymn.underlay).length, r.parsed.notes.length);
  assert.match(r.hymn.underlay, /From the burn-ing/);
});

test("ohp gates: no death year → a draft with the reason; a syllable short → a draft; a living writer or a licence → not imported", () => {
  const base = "To_God_Be_the_Glory-To_God_Be_the_Glory", today = "2026-10-16";
  const undated = convertScore(TO_GOD.replace("%OHCOMPOSER Doane, William Howard (1832-1915)", "%OHCOMPOSER Doane, William Howard"), { base, today });
  assert.equal(undated.hymn.draft, true);
  assert.equal(undated.copyright, null);
  assert.ok(undated.problems.some((p) => /William Howard Doane: public domain needs a death year before 1955/.test(p)), undated.problems.join(" | "));
  assert.match(undated.tune.reviewNotes, /^Held back: not provably public domain/);
  const noYear = convertScore(TO_GOD.replace("Words: Fanny Crosby, 1875.", "Words: Fanny Crosby."), { base, today });
  assert.ok(noYear.problems.includes("the score gives no year for the words"));
  const short = convertScore(TO_GOD.replace("w: 1.~To God be the glor- y,", "w: 1.~To God be the glory,"), { base, today });
  assert.equal(short.hymn.draft, true);
  assert.ok(short.problems.includes("the first verse has fewer syllables than notes in line 1"), short.problems.join(" | "));
  const long = convertScore(TO_GOD.replace("w: 1.~To God be the glor- y,", "w: 1.~To God be the glor- i- y,"), { base, today });
  assert.ok(long.problems.includes("verse 1 has more syllables than notes in line 1"), long.problems.join(" | "));
  const living = convertScore(TO_GOD.replace("Crosby, Fanny Jane (1820-1915)", "Penney, Brian L. (1951-)"), { base, today });
  assert.match(living.copyright, /Brian L\. Penney \(born 1951\) is living/);
  const late = convertScore(TO_GOD.replace("Doane, William Howard (1832-1915)", "Doane, William Howard (1832-1957)"), { base, today });
  assert.match(late.copyright, /died in 1957/);
  const licensed = convertScore(TO_GOD.replace("C: copyright: public domain.", "C: copyright: Words: Copyright 2009, Brian J. Dumont. These lyrics may be freely reproduced"), { base, today });
  assert.match(licensed.copyright, /not plain public domain/);
  const triplet = convertScore(TO_GOD.replace("| A E A | B E B | c2 c |", "| A E A | (3BcB E B | c2 c |"), { base, today });
  assert.ok(triplet.problems.some((p) => /triplets/.test(p)));
});

test("ohp: our own verse re-spelt under the score's syllables (has/hath, Savior/Saviour), or a clear refusal", () => {
  assert.equal(retextUnderlay("To God be the glor-y, great things He has done;", "To God be the glory, great things He hath done!"), "To God be the glor-y, great things He hath done!");
  assert.equal(retextUnderlay("Pass me not, O gen-tle Sav-ior,_", "Pass me not, O gentle Saviour,"), "Pass me not, O gen-tle Sav-iour,_");
  assert.equal(retextUnderlay("the life gate", "the life-gate"), "the life gate");
  assert.throws(() => retextUnderlay("A-maz-ing grace", "Wondrous grace"), /“Wondrous” where the score has “Amazing”/);
  assert.throws(() => retextUnderlay("one two", "one"), /1 words against the score's 2/);
});

test("ohp: the metre splits the words into lines; without it, punctuation before a capital does", () => {
  const w = (s) => s.split(" ").map((x) => ({ text: x.replace(/\|/g, ""), syllables: (x.match(/\|/g) || []).length + 1 }));
  assert.deepEqual(toLines(w("A|maz|ing grace! how sweet the sound, That saved a wretch like me!"), [8, 6]).lines, ["Amazing grace! how sweet the sound,", "That saved a wretch like me!"]);
  const free = toLines(w("Abide with me; fast falls the e|ven|tide; The dark|ness deep|ens;"), null);
  assert.equal(free.byMetre, false);
  assert.deepEqual(free.lines, ["Abide with me; fast falls the eventide;", "The darkness deepens;"]);
});

test("run: an import into a scratch copy — new hymn published, a words-only draft filled, a duplicate kept, copyright skipped", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nf-import-"));
  const src = path.join(root, "abc"), hymnsDir = path.join(root, "hymns"), tunesDir = path.join(hymnsDir, "tunes");
  fs.mkdirSync(src); fs.mkdirSync(tunesDir, { recursive: true });
  fs.writeFileSync(path.join(src, "Beneath_The_Cross_Of_Jesus-St_Christopher.abc"), BENEATH);
  fs.writeFileSync(path.join(src, "To_God_Be_the_Glory-To_God_Be_the_Glory.abc"), TO_GOD);
  fs.writeFileSync(path.join(src, "Modern-Hymn.abc"), TO_GOD.replace("T: To God Be The Glory", "T: A Modern Hymn").replace("Crosby, Fanny Jane (1820-1915)", "Penney, Brian L. (1951-)"));
  // Ours: To God Be the Glory with words only (as the site had it), and its empty tune.
  const repo = path.join(here, "..", "..", "..", "content", "hymns");
  const ours = JSON.parse(fs.readFileSync(path.join(repo, "to-god-be-the-glory.json"), "utf8"));
  fs.writeFileSync(path.join(hymnsDir, "to-god-be-the-glory.json"), JSON.stringify({ ...ours, underlay: "", draft: true }));
  fs.writeFileSync(path.join(tunesDir, "to-god-be-the-glory.json"), JSON.stringify({ name: "TO GOD BE THE GLORY", music: [{ name: "William Howard Doane", born: 1832, died: 1915, role: "Melody (1875)" }], musicPublished: 1875, key: null, time: null, tempo: null, pickup: 0, lineBars: 4, melody: null, reviewed: false }));
  const report = runImport({ src, today: "2026-10-16", hymnsDir, tunesDir, log: () => {}, reportPath: path.join(root, "report.json") });
  assert.deepEqual(report.published.map((p) => p.slug), ["beneath-the-cross-of-jesus"]);
  assert.deepEqual(report.filled.map((p) => p.slug), ["to-god-be-the-glory"]);
  assert.deepEqual(report.notImported.map((p) => p.title), ["A Modern Hymn"]);
  assert.ok(!fs.existsSync(path.join(hymnsDir, "a-modern-hymn.json")), "nothing of a hymn in copyright is written");
  const filled = JSON.parse(fs.readFileSync(path.join(hymnsDir, "to-god-be-the-glory.json"), "utf8"));
  assert.equal(filled.draft, false);
  assert.match(filled.underlay, /great things He hath done!/); // our verse, the score's syllables
  assert.deepEqual(filled.verses, ours.verses); // our words are kept
  const tune = JSON.parse(fs.readFileSync(path.join(tunesDir, "to-god-be-the-glory.json"), "utf8"));
  assert.equal(tune.source, "Open Hymnal Project");
  assert.match(tune.melody, /C5:\.75 Db5:\.25/);
  const added = JSON.parse(fs.readFileSync(path.join(hymnsDir, "beneath-the-cross-of-jesus.json"), "utf8"));
  assert.equal(added.importedFrom, "Beneath_The_Cross_Of_Jesus-St_Christopher");
  assert.equal(added.reviewed, false);
  // A second run changes nothing.
  const again = runImport({ src, today: "2026-10-17", hymnsDir, tunesDir, log: () => {}, reportPath: path.join(root, "report.json") });
  assert.equal(again.counts.published, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(hymnsDir, "beneath-the-cross-of-jesus.json"), "utf8")).updated, "2026-10-16");
  fs.rmSync(root, { recursive: true, force: true });
});

// ── The committed import ────────────────────────────────────────────────────
const { hymns, allHymns } = loadAll({ includeDrafts: true });
const published = hymns.filter((h) => !h.draft);

test("the import: well over a hundred published, every one unreviewed, with its source, licence and confidence", () => {
  const imported = allHymns.filter((h) => h.importedFrom);
  assert.ok(published.filter((h) => h.importedFrom).length >= 150);
  for (const h of imported) {
    assert.equal(h.reviewed, false, h.slug);
    assert.equal(h.tuneData.reviewed, false, h.slug);
    assert.equal(h.source, "Open Hymnal Project", h.slug);
    assert.match(h.sourceUrl, /^http:\/\/openhymnal\.org\/Lyrics\/.+\.html$/, h.slug);
    assert.match(h.licence, /^Public domain/, h.slug);
    // (A tune already on the site, note for note the same, keeps its own confidence.)
    if (h.tuneData.source === "Open Hymnal Project") assert.match(h.tuneData.confidence, /^imported, unchecked/, h.slug);
    if (h.draft) assert.match(h.reviewNotes, /^Held back: /, h.slug);
  }
  const report = JSON.parse(fs.readFileSync(path.join(here, "..", "import", "ohp-report.json"), "utf8"));
  assert.equal(report.counts.published + report.counts.drafts, imported.length);
});

test("the semiquaver hymns the half-beat grid could not show are published now", () => {
  for (const slug of ["to-god-be-the-glory", "blessed-assurance", "pass-me-not-o-gentle-saviour"]) {
    const h = published.find((x) => x.slug === slug);
    assert.ok(h, `${slug} is published`);
    assert.ok(h.tuneData.parsed.notes.some((n) => n.durBeats % 0.5 !== 0 || n.startBeat % 0.5 !== 0), `${slug} has quarter-beat notes`);
  }
  // To God Be the Glory's opening, as a hymn book prints it: s, s, l, t, d s, d r s, r m.
  const t = published.find((x) => x.slug === "to-god-be-the-glory").tuneData;
  assert.equal(Array.from(N.label(t.parsed.notes, t.key), name).slice(0, 11).join(" "), "s, s, l, t, d s, d r s, r m");
  assert.equal(N.keyHeader(t.key), "Doh is Ab");
});

test("every imported hymn page shows the credit line, linking the source and the credits page", () => {
  const sample = published.filter((h) => h.importedFrom).slice(0, 12).concat(published.filter((h) => h.slug === "to-god-be-the-glory"));
  for (const h of sample) {
    prepareHymn(h);
    const html = renderHymn(h, { hymns: published, posts: [] });
    const credit = /<p class="credit-line">([\s\S]*?)<\/p>/.exec(html);
    assert.ok(credit, `${h.slug} has a credit line`);
    assert.match(credit[1], /from the <a href="http:\/\/openhymnal\.org\/[^"]*" rel="noopener">Open Hymnal Project<\/a> \(public domain\), edited by Brian J\. Dumont; tune /, h.slug);
    assert.match(credit[1], /words by /, h.slug);
    assert.match(credit[1], /<a href="\/hymns\/credits">Sources and licences<\/a>/, h.slug);
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((d) => d["@type"] === "MusicComposition");
    assert.equal(ld.isBasedOn.publisher.name, "Open Hymnal Project", h.slug);
  }
  const tg = published.find((h) => h.slug === "to-god-be-the-glory");
  assert.equal(creditLine(tg).text, "Melody from the Open Hymnal Project (public domain), edited by Brian J. Dumont; tune TO GOD BE THE GLORY by William Howard Doane (1832–1915); words by Fanny Crosby (1820–1915).");
});
