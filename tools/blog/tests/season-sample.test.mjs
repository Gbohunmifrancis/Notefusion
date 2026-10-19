// The website's Halloween sample sheet, as render-home.mjs writes it (the built page and the engraving file are checked
// in web-site/tests/season.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHomeSheet, HALLOWEEN_SAMPLE_TUNE } from "../lib/render-home.mjs";
import { prepareTune } from "../lib/render-tunes.mjs";
import { parseMelody } from "../lib/solfa.mjs";

/** The Mountain King's opening bars as content/hymns would publish them (B minor, from B3), prepared as build.mjs does. */
function king() {
  const t = {
    slug: HALLOWEEN_SAMPLE_TUNE, name: "IN THE HALL OF THE MOUNTAIN KING", title: "In the Hall of the Mountain King",
    music: [{ name: "Edvard Grieg", died: 1907 }], key: "B minor", time: "4/4", tempo: 138, pickup: 0, lineBars: 2,
    melody: "B3:.5 C#4:.5 D4:.5 E4:.5 F#4:.5 D4:.5 F#4:1 | E#4:.5 C#4:.5 E#4:1 E4:.5 C4:.5 E4:1",
  };
  t.parsed = parseMelody(t.melody, { time: t.time, pickup: 0 });
  return prepareTune(t);
}

test("the Halloween sample: the Mountain King's first bar in its own template, only once the tune is published", () => {
  const amazing = { slug: "amazing-grace", title: "Amazing Grace", view: king().view };
  const without = renderHomeSheet(amazing, null);
  assert.doesNotMatch(without, /season-sheet-halloween/);
  const sheet = renderHomeSheet(amazing, null, king());
  const tpl = /<template id="season-sheet-halloween">([\s\S]*?)<\/template>/.exec(sheet);
  assert.ok(tpl, "the template");
  const fig = tpl[1];
  assert.match(fig, /<p class="sheet-title" id="sheet-title-halloween">In the Hall of the Mountain King<\/p>/);
  assert.match(fig, /<span>Doh is D<\/span><span>B minor<\/span><span>4\/4<\/span>/);
  // One bar, no words: l, t, d r m d m (the crotchet held), in the engine's own grid.
  const cells = [...fig.matchAll(/<b>(.*?)<\/b>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
  assert.deepEqual(cells, ["l,", "t,", "d", "r", "m", "d", "m", "-"]);
  assert.doesNotMatch(fig, /<i>/);
  assert.match(fig, /<img src="\/assets\/sample-staff-mountain-king\.svg" width="613" height="88" alt="The same bar on the treble staff in B minor">/);
  assert.match(fig, /The first bar, as NoteFusion writes it<span class="sheet-foot-more">: la-based minor, two quavers to a beat<\/span>\./);
  assert.match(fig, /<a href="\/hymns\/tunes\/in-the-hall-of-the-mountain-king">Open the whole tune<\/a>/);
  assert.match(sheet, /from content\/hymns\/amazing-grace and in-the-hall-of-the-mountain-king\./);
});

