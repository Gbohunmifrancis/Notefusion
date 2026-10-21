import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_HYMN, EXAMPLE_NOTICE, EXAMPLE_SUBTITLE, offerExample } from "./exampleSheet.ts";
import { hymnSheet, openingLine, parsePack } from "./hymnPack.ts";
import { deriveSolfa } from "./solfa.ts";

/** The website's hymn pack, the one the Hymns tab downloads (mobile/src/lib → the repository's web-site/). */
const PACK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "web-site", "hymns", "pack.json");

test("the bundled example is the hymn pack's own Amazing Grace: its notes, key, meter, tempo and words", () => {
  const pack = parsePack(readFileSync(PACK, "utf8"));
  assert.ok(pack, "the pack reads");
  const published = pack.hymns.find((h) => h.slug === EXAMPLE_HYMN.slug);
  assert.ok(published, "the pack holds Amazing Grace");
  const { verses: _verses, ...ours } = EXAMPLE_HYMN;
  const { verses: _theirs, occasions: _occasions, ...theirs } = published;
  assert.deepEqual(ours, theirs, "the example has drifted from web-site/hymns/pack.json: copy the entry again");
});

test("it opens as Amazing Grace is sung: doh G, 3/4, the pickup on soh below", () => {
  const sheet = hymnSheet(EXAMPLE_HYMN);
  assert.equal(sheet.key, "G major");
  assert.equal(sheet.timeSignature, "3/4");
  const labelled = deriveSolfa(sheet.notes, sheet.key, sheet.timeSignature).notes;
  assert.equal(openingLine(labelled), "s, d m d m r d l,");
  assert.ok(sheet.lyrics.startsWith("A-maz-ing"), "the words go under the notes, for the hymn layout");
});

test("it is offered until the first sheet exists, and says what it is", () => {
  assert.equal(offerExample(0), true);
  assert.equal(offerExample(1), false);
  assert.equal(offerExample(12), false);
  assert.equal(EXAMPLE_SUBTITLE, "An example — not in your Library");
  assert.match(EXAMPLE_NOTICE, /Record a tune/);
});
