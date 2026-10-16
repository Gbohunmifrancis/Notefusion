// Sanity checks on the hymn data: the opening phrase of some of the best-known tunes, as the engine
// labels the committed notes and as a tonic solfa hymn book prints it. A failure means a wrong note
// in content/hymns/tunes (or a change in the engine) — check the book before "fixing" the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAll } from "../lib/content.mjs";
import { loadEngine } from "../lib/solfa.mjs";

const { allHymns } = loadAll({ includeDrafts: true });
const bySlug = new Map(allHymns.map((h) => [h.slug, h]));
const N = loadEngine();

/** The engine's names for the first `count` notes of a hymn's tune: with octave marks, and without. */
function opening(slug, count) {
  const h = bySlug.get(slug);
  assert.ok(h, `no hymn ${slug}`);
  const t = h.tuneData;
  assert.ok(t.parsed, `${slug} has no melody`);
  const labelled = Array.from(N.label(t.parsed.notes, t.key), (n) => ({ ...n })).slice(0, count);
  return { marked: labelled.map((n) => n.solfa + n.octaveMark), bare: labelled.map((n) => n.solfa), hymn: h };
}

// slug, notes, the hymn book's solfa for them, the engine's (octave marks included), the doh.
const OPENINGS = [
  // "Ho-ly, ho-ly, ho-ly! Lord God Al-might-y!" — 'Lord' is one note held two beats.
  ["holy-holy-holy", 11, "d d m m s s l l l s m", "d, d, m, m, s, s, l, l, l, s, m,", "Doh is D"],
  // "What a friend we have in Je-sus"
  ["what-a-friend-we-have-in-jesus", 8, "s s l s m d d l", "s s l s m d d l,", "Doh is F"],
  // "A-bide with me; fast falls the ev-en-tide"
  ["abide-with-me", 10, "m m r d s l s s f m", "m m r d s l s s f m", "Doh is Eb"],
  // "When peace, like a riv-er, at-tend-eth my way" (pickup on 'When'; 'tend' over fah-lah)
  ["it-is-well-with-my-soul", 12, "s s f m m r m f l s f m", "s, s, f, m, m, r, m, f, l, s, f, m,", "Doh is Db"],
  // "Guide me, O Thou great Je-ho-vah"
  ["guide-me-o-thou-great-jehovah", 10, "s l s d d t d r m r", "s, l, s, d d t, d r m r", "Doh is G"],
  // "O God, our help in a-ges past"
  ["o-god-our-help-in-ages-past", 8, "s m l s d d t d", "s, m, l, s, d d t, d", "Doh is C"],
  // "Hark! the her-ald an-gels sing"
  ["hark-the-herald-angels-sing", 8, "s d d t d m m r", "s, d d t, d m m r", "Doh is F"],
  // "Je-sus loves me! this I know"
  ["jesus-loves-me", 7, "s m m r m s s", "s, m, m, r, m, s, s,", "Doh is Eb"],
  // "The Church's one foun-da-tion"
  ["the-churchs-one-foundation", 7, "m m m f m m r", "m m m f m m r", "Doh is D"],
];

for (const [slug, count, book, engine, doh] of OPENINGS) {
  test(`${slug}: the opening is ${book} in a solfa hymn book, and the engine says so`, () => {
    const o = opening(slug, count);
    // Published or held back while the engine's hymn-book spelling lands, the tune must be there.
    assert.ok(o.hymn.tuneData.parsed, `${slug} has its melody`);
    assert.equal(N.keyHeader(o.hymn.tuneData.key), doh);
    // The syllables a hymn book prints (it marks octaves from its own middle doh, so compare bare names).
    assert.deepEqual(o.bare, book.split(" "));
    // Exactly what the engine writes, octave marks included. The engine puts the unmarked octave
    // around the doh nearest the tune's middle note, so a tune that sits around soh (Holy, Holy,
    // Holy; It Is Well; Jesus Loves Me) comes out with commas where a hymn book prints none.
    assert.deepEqual(o.marked, engine.split(" "));
  });
}

test("a draft whose tune already has a melody has one syllable per note, ready to publish", () => {
  const ready = allHymns.filter((h) => h.draft && h.tuneData.parsed && h.underlay);
  assert.ok(ready.length >= 1, "Rock of Ages is a draft with its melody");
  for (const h of ready) assert.equal(N.syllabify(h.underlay).length, h.tuneData.parsed.notes.length, h.slug);
});

test("every hymn and tune is unreviewed until checked against a book, and says how sure it is", () => {
  for (const h of allHymns) {
    assert.equal(typeof h.reviewed, "boolean", h.slug);
    if (h.tuneData.confidence !== undefined) assert.ok(String(h.tuneData.confidence).trim(), h.tuneData.slug);
  }
  const added = allHymns.filter((h) => h.updated >= "2026-10-16");
  assert.ok(added.length >= 20);
  for (const h of added) {
    assert.equal(h.reviewed, false, h.slug);
    assert.equal(h.tuneData.reviewed, false, h.tuneData.slug);
    assert.ok(h.tuneData.confidence, `${h.tuneData.slug} records its confidence`);
    assert.ok(h.tuneData.reviewNotes, `${h.tuneData.slug} says what to check`);
  }
});
