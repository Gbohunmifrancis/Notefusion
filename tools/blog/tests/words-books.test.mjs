// The words-books importer (import/words-books.mjs: the 1848 Book of Hymns, the 1846 Hymns for Christian Devotion): the
// books' text read into hymns, the metre their labels give a verse, authors named in full or the hymn left out, a hymn
// two books print given to the first, and the committed pages one syllable to a note of their tune.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseLutheran, lutheranLabel, creditLutheran } from "../import/lutheran-1927.mjs";
import { parseBook, parseOlney, parseNumbered, inferPattern, iambsOnTrochees, patternFor, authorOf, fitHymn, pickTune, tuneShape, offBeat, OFF_BEAT, METRES, BOOKS } from "../import/words-books.mjs";
import { fromLaterBook } from "../import/watts.mjs";
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

test("Olney Hymns: author, metre, title and verses, the margin's scripture and the capitals left out, each book from Hymn 1", () => {
  const text = `
BOOK I.
     ______
Hymn 1

   John Newton

   8,6,8,6

   ADAM. Gen 3:9


   On man, in his own image made,

   How much did GOD bestow?
   Rom 8:36

   The whole creation homage paid,

   And owned him LORD, below!


   He dwelt in Eden's garden, stored [3]

   With sweets for every sense;

   And there, with his descending LORD,

   He walked in confidence.
     ______

A
TABLE
   1 Adam                                          3

Hymn 1

   William Cowper

   8,8,8,8

   Walking with God
`;
  const [a, b] = parseOlney(text);
  assert.deepEqual([a.book, a.number, a.author, a.label, a.heading], [1, 1, "John Newton", "8,6,8,6", ["Adam. Gen 3:9"]]);
  assert.deepEqual(a.verses, [
    ["On man, in his own image made,", "How much did God bestow?", "The whole creation homage paid,", "And owned him Lord, below!"],
    ["He dwelt in Eden's garden, stored", "With sweets for every sense;", "And there, with his descending Lord,", "He walked in confidence."],
  ]);
  assert.deepEqual([b.book, b.number, b.author, b.verses.length], [2, 1, "William Cowper", 0]);
  assert.deepEqual(patternFor("8,6,8,6", 8), [8, 6, 8, 6, 8, 6, 8, 6]);
  assert.equal(patternFor("8,8,8,8a", 4), null);
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
  // Hymns for Christian Devotion's spellings.
  assert.deepEqual(patternFor("L. M. 6l.", 6), [8, 8, 8, 8, 8, 8]);
  assert.deepEqual(patternFor("8s. & 7s. M.", 4), [8, 7, 8, 7]);
  assert.deepEqual(patternFor("6s. & 4s. M.", 7), [6, 6, 4, 6, 6, 6, 4]);
  assert.deepEqual(patternFor("8s. 7s. & 4s.", 6), [8, 7, 8, 7, 4, 7]);
  assert.equal(patternFor("8s. & 7s. M. (Peculiar.)", 4), null);
  // The particular metres, and Hallelujah Metre's 8s halved when the book prints it in eight lines.
  assert.deepEqual(patternFor("C. P. M.", 6), [8, 8, 6, 8, 8, 6]);
  assert.deepEqual(patternFor("L. P. M.", 6), [8, 8, 8, 8, 8, 8]);
  assert.deepEqual(patternFor("H. M.", 6), [6, 6, 6, 6, 8, 8]);
  assert.deepEqual(patternFor("H. M.", 8), [6, 6, 6, 6, 4, 4, 4, 4]);
  assert.deepEqual(patternFor("L. M.", 8), [8, 8, 8, 8, 8, 8, 8, 8]);
  assert.deepEqual(patternFor("S. M.", 8), [6, 6, 8, 6, 6, 6, 8, 6]);
  assert.equal(patternFor("C. H. M.", 6), null);
});

test("a tune with a slur holds the words' syllable over it where its own words do; one with a note a syllable holds none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shape-"));
  const tune = { key: "C major", time: "4/4", melody: "C4:1 D4:1 E4:1 F4:.5 E4:.5 | D4:2 C4:2" };   // seven notes
  const page = (f, h) => fs.writeFileSync(path.join(dir, f), JSON.stringify({ tune: "t", ...h }));
  page("a.json", { setByMetre: true, underlay: "one two_ three four five six", verses: [{ lines: ["one two three", "four five six"] }] });
  page("b.json", { underlay: "Wake, my soul_, and sing out", verses: [{ lines: ["Wake, my soul,", "and sing out"] }] });
  page("c.json", { underlay: "Lord, we come to_ thee now", verses: [{ lines: ["Lord, we come to", "thee now"] }] });
  // Read off the tune's own words (never a page set by metre), whose lines must be the pattern's.
  assert.deepEqual(tuneShape("t", tune, [3, 3], dir), { holds: [[2, 1]] });
  assert.deepEqual(tuneShape("t", tune, [4, 2], dir), { holds: [[3, 1]] });
  assert.equal(tuneShape("t", tune, [5, 1], dir), null);
  assert.deepEqual(tuneShape("t", tune, [4, 3], dir), { holds: [] });
  // The new words are held at the same syllable, before their punctuation.
  assert.equal(fitHymn([["Come, my God,", "be near"]], [3, 2], {}, [[2, 1]]).underlay, "Come, my God_, be near");
  assert.equal(fitHymn([["Morning breaks", "and night"]], [3, 2], {}, [[0, 2]]).underlay, "Morn__-ing breaks and night");
});

test("a header spaced oddly is still a header, so its verses never run into the hymn before", () => {
  const book = `
495.              S. M.                      Watts.

1   Come, we that love the Lord,
      And let our joys be known;

496.              S. M. Patrick

1   Shine, mighty God, on Zion shine
`;
  const [a, b] = parseBook(book);
  assert.deepEqual([a.number, a.verses.length, b.number, b.label, b.author], [495, 1, 496, "S. M.", "Patrick"]);
});

test("an author is named in full with their dates, given as anonymous, or the hymn is left out", () => {
  assert.deepEqual(authorOf({ author: "C. Wesley" }).people, [{ name: "Charles Wesley", born: 1707, died: 1788, role: "Words" }]);
  assert.deepEqual(authorOf({ author: "Briggs' Coll" }), { people: [{ name: "Anonymous", traditional: true, role: "Words" }], from: "Briggs' Coll", altered: false });
  assert.match(authorOf({ author: "Breviary" }).why, /translation/);
  assert.match(authorOf({ author: "Peabody" }).why, /cannot name/);
  assert.match(authorOf({ author: "" }).why, /no author/);
  assert.deepEqual(authorOf({ author: "Tate & Brady" }).people.map((p) => p.name), ["Nahum Tate", "Nicholas Brady"]);
  assert.equal(authorOf({ author: "Miss Martineau, alt" }).altered, true);
  assert.equal(authorOf({ author: "L. H. Signourney" }).people[0].name, "Lydia Sigourney");   // the transcription's misprint
});

test("a hymn several books print is the first book's page, whichever ran last", () => {
  assert.equal(fromLaterBook({ setByMetre: true, importedFrom: "hymns-1846:12" }, BOOKS[1848].id), true);
  assert.equal(fromLaterBook({ setByMetre: true, importedFrom: "watts-1719:Psalm 117:2" }, BOOKS[1848].id), false);
  assert.equal(fromLaterBook({ importedFrom: "ohp:12" }, BOOKS[1846].id), false);
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
  const pages = allHymns.filter((h) => /^(hymns-18(48|46)|olney-1779):/.test(h.importedFrom || ""));
  assert.ok(pages.filter((h) => h.importedFrom.startsWith("olney-1779:")).length >= 250);
  assert.ok(pages.filter((h) => h.importedFrom.startsWith("hymns-1848:")).length >= 300);
  assert.ok(pages.filter((h) => h.importedFrom.startsWith("hymns-1846:")).length >= 400);
  const N = loadEngine();
  for (const h of pages) {
    assert.equal(h.setByMetre, true, h.slug);
    assert.equal(h.reviewed, false, h.slug);
    assert.equal(h.textPublishedBy, true, h.slug);
    assert.ok([1848, 1866, 1853, 1779].includes(h.textPublished), h.slug);
    assert.doesNotMatch(h.about[1], /\) \(/, h.slug);   // never "Sevens (7.7.7.7) (7.7.7.7)"
    assert.ok(Object.values(METRES).some((m) => [...m.tunes, ...(m.iambs || [])].includes(h.tune)), h.slug);
    assert.equal(N.syllabify(h.underlay).length, h.tuneData.parsed.notes.length, h.slug);
    // A syllable is held over a second note only where the tune has more notes than the metre has syllables.
    const syllables = h.metre.split(" ").map(Number).reduce((a, b) => a + b, 0);
    if (h.tuneData.parsed.notes.length === syllables) assert.doesNotMatch(h.underlay, /_/, h.slug);
    for (const p of h.text) assert.ok(p.traditional || p.died < 1955, `${h.slug}: ${p.name}`);
  }
});

test("John Brownlie's books: verses numbered I, II on lines of their own, the heading and whom the book names, the metre read off the lines", () => {
  const text = `*** START OF THE PROJECT GUTENBERG EBOOK X ***

                           HYMNS OF THE EARLY CHURCH




             O DEUS, EGO AMO TE

Attributed to Francis Xavier. Born at the Castle Xavier, near
Pampeluna, Spain, in 1506; died in 1552.


                                  I

  O God, I love Thee, not alone
    Because Thou savest me,
  And those who love not in return
    Are lost eternally.

                               {troparion}

                                  II

  Thou art mine own, O Christ; Thine arms
    Embraced me on the Cross;
  Thou didst endure the nails, the spear,
    The bitter shame and loss--
*** END OF THE PROJECT GUTENBERG EBOOK X ***
`;
  const [h] = parseNumbered(text);
  assert.deepEqual(h.heading, ["O Deus, Ego Amo Te"]);
  assert.equal(h.attribution, "Attributed to Francis Xavier");
  assert.equal(h.verses.length, 2);
  assert.equal(h.verses[1][3], "The bitter shame and loss —");
  assert.deepEqual(inferPattern(h.verses, {}), [8, 6, 8, 6]);
});

test("the committed Brownlie pages: traditional words translated by John Brownlie, the metre the lines sing", () => {
  const { allHymns } = loadAll({ includeDrafts: true });
  const pages = allHymns.filter((h) => /^brownlie-/.test(h.importedFrom || ""));
  assert.ok(pages.length >= 150);
  const N = loadEngine();
  for (const h of pages) {
    assert.deepEqual(h.text.map((p) => p.name), [h.text[0].name, "John Brownlie"], h.slug);
    assert.match(h.text[0].name, /^Traditional (Greek|Latin)$/, h.slug);
    assert.match(h.text[1].role, /^Translated/, h.slug);
    assert.match(h.about[1], /^The book printed the words without tunes\. They are in /, h.slug);
    assert.equal(N.syllabify(h.underlay).length, h.tuneData.parsed.notes.length, h.slug);
  }
});

test("the 1927 Lutheran book: number, metre, verses and who wrote it; a translation only with its translator", () => {
  const text = `*** START OF THE PROJECT GUTENBERG EBOOK X ***
INVITATION.


46

                                                                 C. M. 8 l

    I heard the voice of Jesus say,
      “Come unto Me and rest;
    Lay down, thou weary one, lay down
      Thy head upon My breast!”

    2. I heard the voice of Jesus say,
      “Behold, I freely give
    The living water; thirsty one,
      Stoop down and drink and live!”

                                                      H. Bonar, 1846.


47

                                                                 8, 7, 8, 7

    Alas, my God! my sins are great,
                              Nikolaus Herman, 1560; A. Crull, tr., a.
*** END OF THE PROJECT GUTENBERG EBOOK X ***`;
  const [a, b] = parseLutheran(text.replace("\n46\n", "\n1\n").replace("\n47\n", "\n2\n"));
  assert.deepEqual([a.label, a.author, a.verses.length, a.verses[1][0]], ["C. M. 8 l", "H. Bonar, 1846.", 2, "I heard the voice of Jesus say,"]);
  assert.deepEqual(lutheranLabel(a.label), { label: "C. M.", lines: "8" });
  assert.deepEqual(lutheranLabel("7, 6, 8 l"), { label: "7,6", lines: "8" });
  assert.deepEqual(lutheranLabel("6, 6, 6, 6, 8, 8 (H. M.)"), { label: "6,6,6,6,8,8", lines: undefined });
  assert.deepEqual(creditLutheran(a).people, [{ name: "Horatius Bonar", born: 1808, died: 1889, role: "Words" }]);
  assert.deepEqual(creditLutheran(b).people.map((p) => [p.name, p.role]), [["Nikolaus Herman", "Words"], ["August Crull", "Translated"]]);
  assert.match(creditLutheran({ author: "From the Latin of Bernard of Clairvaux; Paul Gerhardt, 1652." }).why, /cannot name|translator/);
  assert.match(creditLutheran({ author: "Paul Gerhardt, 1653." }).why, /translator/);
});

test("iambic words are never set to the trochaic 8.7 tunes", () => {
  const iambic = [["Alas, my God! my sins are great,", "My conscience doth upbraid me;", "And now I find that in my strait", "No man hath power to aid me."]];
  const trochaic = [["Love divine, all loves excelling,", "Joy of heaven to earth come down;", "Holy Father, thou hast taught me", "All thy faithful mercies crown."]];
  assert.equal(iambsOnTrochees(iambic, [8, 7, 8, 7]), true);
  assert.equal(iambsOnTrochees(trochaic, [8, 7, 8, 7]), false);
  assert.equal(iambsOnTrochees(iambic, [8, 6, 8, 6]), false);   // Common Metre's tunes are iambic
  // Eights and Sevens has iambic tunes of its own: such words go to them, never to the trochaic list.
  for (const slug of ["alas-my-god-my-sins-are-great", "o-god-whose-presence"]) assert.ok(METRES["8 7 8 7"].iambs.includes(pickTune(slug, "8 7 8 7", METRES["8 7 8 7"].iambs)));
});

test("anapaests and trochees are kept off the iambic tunes of the metres added later", () => {
  const lmd = [8, 8, 8, 8, 8, 8, 8, 8];
  const anapaests = [["Away with our sorrow and fear!", "We soon shall recover our home,", "The city of saints shall appear,", "The day of eternity come:", "From earth we shall quickly remove,", "And mount to our native abode,", "The house of our Father above,", "The palace of angels and God."]];
  const trochees = [["Deck thyself, my soul, with gladness,", "Leave the gloomy haunts of sadness,", "Come into the daylight's splendor,", "There with joy thy praises render", "Unto Him whose grace unbounded", "Hath this wondrous banquet founded;", "High o'er all the heavens He reigneth,", "Yet to dwell with thee He deigneth."]];
  const iambs = [["Let not the wise his wisdom boast,", "The mighty glory in his might,", "The rich in flattering riches trust,", "Which take their everlasting flight.", "The rush of numerous years bears down", "The most gigantic strength of man;", "And where is all his wisdom gone,", "When dust he turns to dust again?"]];
  assert.ok(offBeat(anapaests, lmd, {}) > OFF_BEAT);
  assert.ok(offBeat(trochees, lmd, {}) > OFF_BEAT);
  assert.ok(offBeat(iambs, lmd, {}) <= OFF_BEAT);
  for (const [key, m] of Object.entries(METRES)) if (m.iambic) assert.ok(!/^(7|11)/.test(key), key);
});

test("the committed Lutheran pages: everyone named in full and dated, a translator for every translation", () => {
  const { allHymns } = loadAll({ includeDrafts: true });
  const pages = allHymns.filter((h) => /^lutheran-1927:/.test(h.importedFrom || ""));
  assert.ok(pages.length >= 100);
  const N = loadEngine();
  for (const h of pages) {
    assert.equal(h.textPublished, 1927, h.slug);
    for (const p of h.text) assert.ok(p.traditional || p.died < 1955, `${h.slug}: ${p.name}`);
    if (/in (German|Latin|Norwegian|Swedish)\./.test(h.about[0])) assert.ok(h.text.some((p) => p.role === "Translated"), h.slug);
    assert.equal(N.syllabify(h.underlay).length, h.tuneData.parsed.notes.length, h.slug);
  }
});

test("Wesley's Collection: a hymn page read, and its writer only where the index's scans say so plainly", async () => {
  const { parseWesley, wesleyWriters, creditWesley, aboutWesley } = await import("../import/wesley-1780.mjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wesley-"));
  const page = (n, first) => `<TITLE>Hymn ${n}, "A Collection of Hymns..."</TITLE><BODY><H3>L.M.</H3>
<P>
1 ${first}<BR>
His faith by his obedience showed,<BR>
He with the harsh command complied,<BR>
And gave his Isaac back to God.
</BODY>`;
  fs.writeFileSync(path.join(dir, "jwg0286.html"), page(286, "ABRAHAM, when severely tried,"));
  fs.writeFileSync(path.join(dir, "jwg0331.html"), page(331, "AFFLICTED by a gracious God,"));
  fs.writeFileSync(path.join(dir, "jwg0112.html"), page(112, "A CHARGE to keep I have,"));
  fs.writeFileSync(path.join(dir, "jwg0224.html"), page(224, "I'LL praise my Maker, JEHOVAH, the great I AM,"));
  fs.writeFileSync(path.join(dir, "jwg0041.html"), page(41, "O GOD! our help, our ALL,"));
  const hymns = parseWesley(dir);
  assert.deepEqual(hymns.map((h) => [h.number, h.label, h.verses[0][0]]), [
    [41, "L.M.", "O God! our help, our all,"], [112, "L.M.", "A charge to keep I have,"],
    [224, "L.M.", "I'll praise my Maker, Jehovah, the great I AM,"], [286, "L.M.", "Abraham, when severely tried,"],
    [331, "L.M.", "Afflicted by a gracious God,"],
  ]);
  const scanA = "I.— INDEX TO THE HYMNS.\nAbraham, when severely tried . IT. 286\nAfflicted by a gracious God . . . . 331\nA charge to keep I have 112\n";
  const scanB = "FIRST LINE, AUTHOR, HYMN\nAbraham, when severely tried . . W. 286\nAMlicted by a gracious God , . . . . 331\n";
  const writers = wesleyWriters(hymns, [scanA, scanB]);
  assert.equal(writers.get(286), "W");                 // "IT." and "W." are the OCR's two readings of "W."
  assert.equal(writers.get(331), "C");                 // dots straight to the number: no name, so Charles
  assert.equal(writers.get(112), undefined);           // one scan, no dots: not plain enough
  assert.deepEqual(creditWesley({ writer: "W" }).people.map((p) => p.name), ["Charles Wesley", "John Wesley"]);
  assert.match(aboutWesley({ writer: "W", number: 286 }), /cannot say which of the two/);
  assert.match(creditWesley({ writer: null }).why, /do not say/);
});

test("the committed Wesley pages: the brothers' joint hymns say 'or', every underlay one syllable to a note", () => {
  const { allHymns } = loadAll({ includeDrafts: true });
  const pages = allHymns.filter((h) => /^wesley-1780:/.test(h.importedFrom || ""));
  assert.ok(pages.length >= 150);
  const N = loadEngine();
  for (const h of pages) {
    assert.equal(h.textPublished, 1780, h.slug);
    if (h.textOneOf) assert.deepEqual(h.text.map((p) => p.name), ["Charles Wesley", "John Wesley"], h.slug);
    assert.equal(N.syllabify(h.underlay).length, h.tuneData.parsed.notes.length, h.slug);
  }
});
