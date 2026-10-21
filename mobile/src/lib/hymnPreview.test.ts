import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HYMN_PREVIEW, previewOpacity } from "./hymnPreview.ts";
import { parsePack } from "./hymnPack.ts";

/** The website's hymn pack, the one the Hymns tab downloads (mobile/src/lib → the repository's web-site/). */
const PACK = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "web-site", "hymns", "pack.json");

test("every preview row is the pack's own: title, first line, tune, key and time", () => {
  const pack = parsePack(readFileSync(PACK, "utf8"));
  assert.ok(pack, "the pack reads");
  for (const row of HYMN_PREVIEW) {
    const published = pack.hymns.find((h) => h.slug === row.slug);
    assert.ok(published, `the pack holds ${row.slug}`);
    const { slug, kind, title, firstLine, tune, key, time } = published;
    assert.deepEqual(row, { slug, kind, title, firstLine, tune, key, time }, `${row.slug} has drifted from web-site/hymns/pack.json`);
  }
});

test("the rows fade towards the foot: the first third whole, then fainter each row, never gone", () => {
  const n = HYMN_PREVIEW.length;
  const opacities = HYMN_PREVIEW.map((_, i) => previewOpacity(i, n));
  assert.equal(opacities[0], 1);
  assert.equal(opacities[1], 1);
  for (let i = 2; i < n; i++) assert.ok(opacities[i] < opacities[i - 1], `row ${i} is fainter than row ${i - 1}`);
  assert.ok(opacities[n - 1] >= 0.15);
  assert.equal(previewOpacity(0, 1), 1);
});
