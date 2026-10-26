// The 1848 Book of Hymns importer (import/hymns-1848.mjs): the book's text read into hymns, the metre its labels give a
// verse, authors named in full or the hymn left out, and the committed pages one syllable to a note of their tune.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBook, patternFor, authorOf, fitHymn, pickTune, METRES } from "../import/hymns-1848.mjs";
import { loadAll } from "../lib/content.mjs";
import { loadEngine } from "../lib/solfa.mjs";

const BOOK = `
23.                               L. M.                     Frothingham.

                        For Spiritual Influences.


  1 O God, whose presence glows in all
    Within, around us, and above!
    Thy word we bless, Thy name we call,
    Whose word is Truth, whose name is Love.

  2 That truth be with the heart believed
    Of all who seek this sacred place;
    With power proclaimed, in peace received,--
    Our spirit's light, Thy spirit's grace.




27.                               P. M.                       Anonymous.

                           "Teach Us To Pray."


  1     Teach us to pray!
    O Father, we look up to Thee,
    And this our one request shall be,
        Teach us to pray!

                               SUPPLEMENT.


480.                           6 & 4s. M.                     *Anonymous.

                               Invocation.


  1 Come, Thou almighty King!
`;

test("the book's text is read into hymns: number, metre, author, heading, verses; a line ending in a dash stays a line", () => {
  const [a, b, c] = parseBook(BOOK);
  assert.deepEqual([a.number, a.label, a.author, a.altered, a.heading], [23, "L. M.", "Frothingham", false, ["For Spiritual Influences."]]);
  assert.equal(a.verses.length, 2);
  assert.equal(a.verses[1].length, 4);
  assert.equal(a.verses[1][2], "With power proclaimed, in peace received, —");
  assert.deepEqual([b.number, b.label, b.author, b.verses[0][0]], [27, "P. M.", "Anonymous", "Teach us to pray!"]);
  assert.deepEqual([c.number, c.author, c.altered], [480, "Anonymous", true]);
});

test("a metre label and a verse's length give its syllables per line, or nothing for a particular metre", () => {
  assert.deepEqual(patternFor("C. M.", 4), [8, 6, 8, 6]);
  assert.deepEqual(patternFor("C.M.", 8), [8, 6, 8, 6, 8, 6, 8, 6]);
  assert.deepEqual(patternFor("7s. M.", 6), [7, 7, 7, 7, 7, 7]);
  assert.deepEqual(patternFor("8 & 7s. M.", 8), [8, 7, 8, 7, 8, 7, 8, 7]);
  assert.deepEqual(patternFor("6 & 4s. M.", 7), [6, 6, 4, 6, 6, 6, 4]);
  assert.deepEqual(patternFor("8, 7, & 4s. M.", 6), [8, 7, 8, 7, 4, 7]);
  assert.equal(patternFor("P. M.", 4), null);
  assert.equal(patternFor("C. M.", 5), null);
});

test("an author is named in full with their dates, given as anonymous, or the hymn is left out", () => {
  assert.deepEqual(authorOf({ author: "C. Wesley" }).person, { name: "Charles Wesley", born: 1707, died: 1788, role: "Words" });
  assert.deepEqual(authorOf({ author: "Briggs' Coll" }), { person: { name: "Anonymous", traditional: true, role: "Words" }, from: "Briggs' Coll" });
  assert.match(authorOf({ author: "Breviary" }).why, /translation/);
  assert.match(authorOf({ author: "Peabody" }).why, /cannot name/);
  assert.match(authorOf({ author: "" }).why, /no author/);
});

test("a hymn is fitted to its metre, verse for verse, or refused; its tune stays put", () => {
  const [a] = parseBook(BOOK);
  assert.equal(fitHymn(a.verses, [8, 8, 8, 8], {}).underlay.split(" ")[0], "O");
  assert.match(fitHymn(a.verses, [8, 6, 8, 6], {}).why, /sing as|cannot be sung/);
  assert.match(fitHymn([["one", "two"], ["one"]], [8, 8], {}).why, /different lengths/);
  for (const pattern of Object.keys(METRES)) assert.equal(pickTune("o-god-whose-presence", pattern), pickTune("o-god-whose-presence", pattern));
});

test("the committed pages: set by metre, in print by the book's year, each underlay one syllable to a note of its tune", () => {
  const { allHymns } = loadAll({ includeDrafts: true });
  const pages = allHymns.filter((h) => h.importedFrom?.startsWith("hymns-1848:"));
  assert.ok(pages.length >= 300);
  const N = loadEngine();
  for (const h of pages) {
    assert.equal(h.setByMetre, true, h.slug);
    assert.equal(h.reviewed, false, h.slug);
    assert.equal(h.textPublishedBy, true, h.slug);
    assert.ok([1848, 1866].includes(h.textPublished), h.slug);
    assert.ok(Object.values(METRES).some((m) => m.tunes.includes(h.tune)), h.slug);
    assert.equal(N.syllabify(h.underlay).length, h.tuneData.parsed.notes.length, h.slug);
    assert.doesNotMatch(h.underlay, /_/, h.slug);
    for (const p of h.text) assert.ok(p.traditional || p.died < 1955, `${h.slug}: ${p.name}`);
  }
});
