// The Watts importer (import/watts.mjs) and the sung syllables under it (import/syllables.mjs): the book's text read
// into hymns, each hymn's metre, the first verse fitted one syllable to a note, a tune that stays put, and pages set
// by metre kept out of hymn recognition and the app's pack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWatts, metreOf, underlayFor, pickTune, dohOf, TUNES } from "../import/watts.mjs";
import { fitLine, splitWord, vowelSyllables } from "../import/syllables.mjs";
import { hymnIndexJson } from "../lib/hymn-index.mjs";
import { loadAll } from "../lib/content.mjs";
import { loadEngine } from "../lib/solfa.mjs";

const BOOK = `
Hymn 1:1.
A new song to the Lamb that was slain.
Rev. 5. 6 8 9 10 12.

1 Behold the glories of the Lamb
Amidst his Father's throne
Prepare new honours for his name,
And songs before unknown.

2 [Let elders worship at his feet,
The church adore around,
With vials full of odours sweet,
And harps of sweeter sound.]

Hymn 1:2.
The deity and humanity of Christ.

1 Ere the blue heavens were stretch'd abroad,
From everlasting was the Word:
With God he was; the Word was God,
And must divinely be ador'd.

Doxologies.

1 Glory to the Father be,
`;

test("the book's text is read into hymns, verse by verse, brackets dropped, the doxologies left out", () => {
  const hymns = parseWatts(BOOK);
  assert.equal(hymns.length, 2);
  assert.deepEqual([hymns[0].book, hymns[0].number], [1, 1]);
  assert.deepEqual(hymns[0].heading, ["A new song to the Lamb that was slain.", "Rev. 5. 6 8 9 10 12."]);
  assert.equal(hymns[0].verses.length, 2);
  assert.equal(hymns[0].verses[1][0], "Let elders worship at his feet,");
  assert.equal(hymns[0].verses[1][3], "And harps of sweeter sound.");
  assert.equal(hymns[1].verses[0][0], "Ere the blue heavens were stretch'd abroad,");
});

test("a hymn's metre is read off its lines, and its first verse is laid one syllable to a note", () => {
  const [cm, lm] = parseWatts(BOOK);
  assert.equal(metreOf(cm.verses, {}).metre, "CM");
  assert.equal(metreOf(lm.verses, {}).metre, "LM");
  assert.equal(underlayFor(cm.verses[0], "CM", {}),
    "Be-hold the glo-ries of the Lamb A-midst his Fa-ther's throne Pre-pare new hon-ours for his name, And songs be-fore un-known.");
  // "heavens" sung as one syllable, as the old books print "heav'ns".
  assert.match(underlayFor(lm.verses[0], "LM", {}), /^Ere the blue heavens were stretch'd a-broad,/);
});

test("a line is fitted to its metre or refused, never forced", () => {
  assert.deepEqual(fitLine("Who stand on Zion's hill!", 6, {}).map((w) => w.join("-")), ["Who", "stand", "on", "Zi-on's", "hill!"]);
  assert.equal(fitLine("Who stand on Zion's hill!", 8, {}), null);
  assert.deepEqual(splitWord("Glorious,", {}), ["Glo", "ri", "ous,"]);
  assert.deepEqual(splitWord("glorious", { glorious: [3, 5] }), ["glo", "rious"]);   // how our hymns sing it wins
  assert.equal(vowelSyllables("loved"), 1);
  assert.equal(vowelSyllables("wanted"), 2);
});

test("a line is sung as the old books sang it: words run short, \"the\" run into a vowel, never a note with no vowel", () => {
  const sung = (line, n) => fitLine(line, n, {})?.map((w) => w.join("-")).join(" ") ?? null;
  assert.equal(sung("Calm on the listening ear of night", 8), "Calm on the lis-tening ear of night");     // "list'ning"
  assert.equal(sung("Has my guardian been, my guide:", 7), "Has my guar-dian been, my guide:");
  assert.equal(sung("Prayer before the eternal throne.", 7), "Prayer be-fore th'e-ter-nal throne.");
  assert.equal(sung("Th' eternal uncreated mind?", 8), "Th'e-ter-nal un-cre-at-ed mind?");          // printed "th' eternal"
  assert.equal(sung("The triumph of the cross", 5), null);                                           // never "triumph" as one
  assert.ok(splitWord("memorial", {}).every((p) => /[aeiouy]/.test(p)));
  for (const [word, n] of [["people", 2], ["millions", 2], ["breathes", 1], ["therefore", 2], ["loveliness", 3], ["journeying", 3], ["eyes", 1]]) {
    assert.equal(vowelSyllables(word), n, word);
  }
});

test("a footnote's mark and its text are not sung", () => {
  const [h] = parseWatts("Hymn 2:170.\nGod incomprehensible.\n\n1 Can creatures to perfection find [1]\nTh' eternal uncreated mind?\nOr can the largest stretch of thought\nMeasure and search his nature out?\n[1] Job 11:7.\n");
  assert.deepEqual(h.verses, [["Can creatures to perfection find", "Th' eternal uncreated mind?", "Or can the largest stretch of thought", "Measure and search his nature out?"]]);
});

test("a page keeps its tune from run to run, from its metre's list", () => {
  for (const metre of Object.keys(TUNES)) {
    const a = pickTune("behold-the-glories-of-the-lamb", metre);
    assert.ok(TUNES[metre].includes(a));
    assert.equal(pickTune("behold-the-glories-of-the-lamb", metre), a);
  }
  assert.equal(dohOf("Eb major"), "Eb");
  assert.equal(dohOf("F minor"), "Ab");
});

test("words set by metre are left out of hymn recognition", () => {
  const tuneData = { name: "ST ANNE", music: [{ name: "William Croft", role: "Tune" }], key: "C major", time: "4/4", tempo: 80, parsed: { notes: [{ pitchMidi: 60, startBeat: 0, durBeats: 1 }] } };
  const hymn = (slug, extra) => ({ slug, title: slug, tuneData, text: [{ name: "Isaac Watts", role: "Words" }], underlay: "O", draft: false, ...extra });
  const index = JSON.parse(hymnIndexJson([hymn("o-god-our-help"), hymn("behold-the-glories", { setByMetre: true })], [], [], []));
  assert.deepEqual(index.entries.map((e) => e.slug), ["o-god-our-help"]);
  // Never an entry, but one of the hymns sung to ST ANNE that a page matched to that tune is asked about.
  assert.deepEqual(index.settings["st anne"].map((row) => row[0]), ["o-god-our-help", "behold-the-glories"]);
});

const PSALMS = `
Psalm 23:2. C. M.
The same.

1. My Shepherd will supply my need,
Jehovah is his name;
In pastures fresh he makes me feed
Beside the living stream.

Psalm 122:1.
Going to church.
1 How did my heart rejoice to hear
My friends devoutly say,
"In Zion let us all appear,
"And keep the solemn day!"

Psalm 130.
Pardoning grace, 2 Cor. 12.
1 Peter 1. 3.

1 Out of the depths of doleful woe,
Doxology.
`;

test("the psalms are read part by part: a verse numbered '1.', a heading run into its first verse, a scripture reference", () => {
  const parts = parseWatts(PSALMS, "psalms");
  assert.deepEqual(parts.map((p) => [p.psalm, p.part]), [[23, 2], [122, 1], [130, null]]);
  assert.equal(parts[0].verses[0][0], "My Shepherd will supply my need,");
  assert.deepEqual(parts[1].heading, ["Going to church."]);
  assert.equal(parts[1].verses[0][0], "How did my heart rejoice to hear");
  assert.deepEqual(parts[2].heading, ["Pardoning grace, 2 Cor. 12.", "1 Peter 1. 3."]);
  assert.equal(parts[2].verses[0][0], "Out of the depths of doleful woe,");
  // In the hymns, a line "Psalm 147. 19 20." is the scripture under a heading, not a psalm.
  assert.equal(parseWatts("Hymn 1:3.\nThe Scriptures.\nPsalm 147. 19 20.\n\n1 God who in various methods told\n").length, 1);
});

test("the committed Watts pages: unreviewed, set by metre, each underlay one syllable to a note of its tune", () => {
  const { allHymns } = loadAll({ includeDrafts: true });
  const watts = allHymns.filter((h) => /^watts-17(07|19):/.test(h.importedFrom || ""));
  assert.ok(watts.filter((h) => h.importedFrom.startsWith("watts-1707:")).length >= 250);
  assert.ok(watts.filter((h) => h.importedFrom.startsWith("watts-1719:Psalm ")).length >= 250);
  const N = loadEngine();
  for (const h of watts) {
    assert.equal(h.setByMetre, true, h.slug);
    assert.equal(h.reviewed, false, h.slug);
    assert.equal(h.source, h.importedFrom.startsWith("watts-1707:") ? "Isaac Watts, Hymns and Spiritual Songs (1707)" : "Isaac Watts, The Psalms of David Imitated (1719)", h.slug);
    assert.match(h.licence, /^Public domain/, h.slug);
    assert.ok(Object.values(TUNES).flat().includes(h.tune), h.slug);
    assert.equal(N.syllabify(h.underlay).length, h.tuneData.parsed.notes.length, h.slug);
    assert.doesNotMatch(h.underlay, /_/, h.slug);
  }
});
