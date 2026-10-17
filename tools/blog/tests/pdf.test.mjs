// The printable solfa (lib/render-pdf.mjs): it builds, prints the page's own solfa and words, carries its
// metadata, stays small and on at most two pages, and comes out the same every time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAll } from "../lib/content.mjs";
import { prepareHymn, hymnName } from "../lib/render-hymns.mjs";
import { prepareTune } from "../lib/render-tunes.mjs";
import { lineText } from "../lib/solfa.mjs";
import { buildSolfaPdf, hymnPdfItem, tunePdfItem, pdfText, pdfInfo, pdfPath, balance, PDF_MAX_PAGES } from "../lib/render-pdf.mjs";

const { hymns, tunes } = loadAll();
const bySlug = new Map(hymns.map((h) => [h.slug, h]));
const hymnItem = (slug) => {
  const h = prepareHymn(bySlug.get(slug));
  return hymnPdfItem(h, { name: hymnName(h), writers: [...h.text, ...h.tuneData.music].filter((p) => !p.traditional).map((p) => p.name) });
};

test("the PDF sits next to its page, named for search", () => {
  assert.equal(pdfPath("/hymns/amazing-grace"), "/hymns/amazing-grace/amazing-grace-tonic-solfa.pdf");
  assert.equal(pdfPath("/hymns/tunes/euclid"), "/hymns/tunes/euclid/euclid-tonic-solfa.pdf");
});

test("Amazing Grace: one A4 page, its title, the doh and time, and the page's solfa line for line", async () => {
  const item = hymnItem("amazing-grace");
  const bytes = await buildSolfaPdf(item);
  assert.ok(bytes.length < 60 * 1024, `${bytes.length} bytes`);
  const info = await pdfInfo(bytes);
  assert.equal(info.title, "Amazing Grace in Tonic Solfa");
  assert.equal(info.author, "NoteFusion");
  assert.equal(info.pages, 1);
  assert.match(info.subject, /Doh is G, 3\/4/);
  assert.match(info.keywords, /Amazing Grace tonic solfa, .*tonic solfa, .*pdf, doh is g, NEW BRITAIN, John Newton/);
  const [page] = await pdfText(bytes);
  assert.equal(page[0], "Amazing Grace");
  assert.equal(page[1], "Doh is G · 3/4Tune: NEW BRITAIN");
  // Each line of solfa is the page's own text (lineText, as "The solfa line by line" prints it), the first
  // bar being "| s, - " — the octave mark drawn small and low, but the same characters.
  const solfaLines = page.filter((l) => l.startsWith("| "));
  assert.deepEqual(solfaLines, item.view.lines.map(lineText));
  assert.ok(solfaLines[0].startsWith("| s, - | d - - - m d |"));
  assert.ok(page.some((l) => l.startsWith("A-mazing")), "the words of the first verse under the bars");
  assert.ok(page.includes("The other verses"));
  assert.ok(page.some((l) => l.includes("’Twas grace that taught my heart to fear,")));
  assert.ok(page.some((l) => l.startsWith("Tune NEW BRITAIN by Edwin O. Excell (1851–1921); words by John Newton (1725–1807).")));
  assert.ok(page.some((l) => l.includes("notefusion.studio/hymns/amazing-grace — hear it and sing along")));
  assert.ok(page.some((l) => l.includes("NoteFusion")));
});

test("the same hymn gives the same file, byte for byte", async () => {
  const a = await buildSolfaPdf(hymnItem("silent-night"));
  const b = await buildSolfaPdf(hymnItem("silent-night"));
  assert.ok(Buffer.from(a).equals(Buffer.from(b)));
});

test("a long hymn goes on to a second page and no further; a minor-key hymn keeps the engine's doh", async () => {
  const long = await buildSolfaPdf(hymnItem("if-god-himself-be-for-me"));
  const info = await pdfInfo(long);
  assert.ok(info.pages <= PDF_MAX_PAGES);
  const text = (await pdfText(long)).flat();
  assert.ok(text.some((l) => /^Page 1 of 2/.test(l) || l.includes("Page 1 of 2")));
  const minor = hymnItem("o-come-o-come-emmanuel");
  assert.match(minor.view.key, /minor/);
  const [page] = await pdfText(await buildSolfaPdf(minor));
  assert.ok(page[1].startsWith(`${minor.view.header} · ${minor.view.time}`));
  assert.ok(page.includes(lineText(minor.view.lines[0])));
});

test("a tune page's PDF: the solfa without words", async () => {
  const t = prepareTune(Object.values(tunes).find((x) => x.draft === false && x.parsed));
  const bytes = await buildSolfaPdf(tunePdfItem(t, { makers: [] }));
  assert.equal((await pdfInfo(bytes)).title, `${t.view.title} (hymn tune) in Tonic Solfa`);
  const [page] = await pdfText(bytes);
  assert.ok(page.includes(lineText(t.view.lines[0])));
  assert.ok(!page.includes("The other verses"));
});

test("a character the fonts cannot draw stops the build instead of printing a box", async () => {
  const item = { ...hymnItem("amazing-grace"), title: "Amazing Grace ☃" };
  await assert.rejects(buildSolfaPdf(item), /has no "☃"/);
});

test("verses are split across columns so the tallest is as short as it can be", () => {
  assert.deepEqual(balance([10, 10, 10, 10], 2, 100), [2, 2]);
  assert.deepEqual(balance([30, 10, 10, 10], 2, 100), [1, 3]);
  assert.deepEqual(balance([10, 10, 10], 3, 100), [1, 1, 1]);
  assert.deepEqual(balance([60, 60], 2, 50), [2, 0], "nothing fits: left to the caller");
});
