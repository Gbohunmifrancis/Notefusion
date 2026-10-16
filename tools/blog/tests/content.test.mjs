import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontMatter, stringifyFrontMatter, loadTunes, loadHymns, loadAll, loadAuthors } from "../lib/content.mjs";
import { renderMarkdown } from "../lib/markdown.mjs";
import { prepareHymn } from "../lib/render-hymns.mjs";

test("front matter: fields, lists, nested FAQ, and the body after it", () => {
  const src = `---\ntitle: "A: title"\ndate: "2026-10-15"\ntags: [tonic-solfa, choir]\nfaq:\n  - q: "Why?"\n    a: "Because."\ndraft: false\n---\nHello **world**\n`;
  const { data, body } = parseFrontMatter(src);
  assert.equal(data.title, "A: title");
  assert.equal(data.date, "2026-10-15"); // stays a string, never a Date
  assert.deepEqual(data.tags, ["tonic-solfa", "choir"]);
  assert.deepEqual(data.faq, [{ q: "Why?", a: "Because." }]);
  assert.equal(data.draft, false);
  assert.equal(body, "Hello **world**\n");
  assert.throws(() => parseFrontMatter("no front matter"), /front matter/);
});

test("front matter written by the drafter reads back the same", () => {
  const data = { title: "It's: \"quoted\"", description: "x", date: "2026-10-15", tags: ["a"], faq: [{ q: "Q?", a: "A: yes" }], draft: false };
  assert.deepEqual(parseFrontMatter(stringifyFrontMatter(data) + "body").data, data);
});

function tmpContent(tune, hymn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-hymns-"));
  fs.mkdirSync(path.join(dir, "tunes"));
  fs.writeFileSync(path.join(dir, "tunes", "t.json"), JSON.stringify(tune));
  fs.writeFileSync(path.join(dir, "h.json"), JSON.stringify(hymn));
  return dir;
}
const TUNE = { name: "T", music: [{ name: "Composer", born: 1800, died: 1870, role: "Melody" }], musicPublished: 1850, key: "C major", time: "4/4", tempo: 90, pickup: 0, melody: "C4:1 D4:1 E4:1 F4:1 | G4:4", reviewed: false };
const HYMN = { title: "H", tune: "t", text: [{ name: "Writer", born: 1800, died: 1880, role: "Words" }], textPublished: 1860, description: "d", underlay: "One two three four five", verses: [{ lines: ["One"] }], updated: "2026-10-15", reviewed: false, draft: false };

test("public domain is strict: everyone died before 1955 and both were published before 1929", () => {
  const ok = tmpContent(TUNE, HYMN);
  assert.equal(loadHymns({ tunes: loadTunes(path.join(ok, "tunes")), dir: ok }).length, 1);
  const late = tmpContent(TUNE, { ...HYMN, text: [{ name: "Writer", born: 1900, died: 1960, role: "Words" }] });
  assert.throws(() => loadHymns({ tunes: loadTunes(path.join(late, "tunes")), dir: late }), /death year before 1955/);
  const published = tmpContent(TUNE, { ...HYMN, textPublished: 1931 });
  assert.throws(() => loadHymns({ tunes: loadTunes(path.join(published, "tunes")), dir: published }), /before 1929/);
  const tuneLate = tmpContent({ ...TUNE, music: [{ name: "C", born: 1890, died: 1958, role: "Melody" }] }, HYMN);
  assert.throws(() => loadTunes(path.join(tuneLate, "tunes")), /death year before 1955/);
  const anon = tmpContent({ ...TUNE, music: [{ name: "Traditional", traditional: true, role: "Melody" }] }, HYMN);
  assert.equal(loadTunes(path.join(anon, "tunes")).t.music[0].traditional, true);
});

test("a hymn's words must have one syllable per note", () => {
  const dir = tmpContent(TUNE, { ...HYMN, underlay: "One two three four" });
  assert.throws(() => loadHymns({ tunes: loadTunes(path.join(dir, "tunes")), dir }), /4 syllables .* 5 notes/);
});

test("a hymn without a melody can only be a draft", () => {
  const dir = tmpContent({ ...TUNE, melody: null, key: null, time: null, tempo: null }, HYMN);
  assert.throws(() => loadHymns({ tunes: loadTunes(path.join(dir, "tunes")), dir }), /no melody yet/);
  const draft = tmpContent({ ...TUNE, melody: null }, { ...HYMN, draft: true });
  assert.equal(loadHymns({ tunes: loadTunes(path.join(draft, "tunes")), dir: draft }).length, 0);
});

test("the committed content loads and every published hymn has a melody that fits its words", () => {
  const { hymns, posts, allHymns } = loadAll();
  assert.ok(hymns.length >= 7);
  assert.ok(allHymns.length >= 12, "at least twelve hymns seeded (drafts included)");
  assert.ok(posts.length >= 2);
  for (const h of hymns) {
    prepareHymn(h);
    assert.ok(h.view.lines.length > 0, h.slug);
    assert.match(h.view.header, /^Doh is [A-G][b#]?$/);
  }
});

test("markdown: one h1 per page (none in the body), heading ids, solfa blocks from the engine", () => {
  const { hymns } = loadAll();
  hymns.forEach(prepareHymn);
  const hymnsBySlug = new Map(hymns.map((h) => [h.slug, h]));
  const r = renderMarkdown("## Two words\n\n## Two words\n\n```solfa\nhymn: amazing-grace\nbars: 1-2\n```\n\n[app](/app)", { hymnsBySlug });
  assert.match(r.html, /<h2 id="two-words">/);
  assert.match(r.html, /<h2 id="two-words-2">/);
  assert.match(r.html, /<span class="doh">Doh is G<\/span>/);
  assert.match(r.html, /<b>s,<\/b><i>A-<\/i>/);
  assert.deepEqual(r.hymnsUsed, ["amazing-grace"]);
  assert.deepEqual(r.links, ["/app"]);
  assert.throws(() => renderMarkdown("# Title in body", { hymnsBySlug }), /only h1/);
  assert.throws(() => renderMarkdown("```solfa\nhymn: no-such-hymn\n```", { hymnsBySlug }), /no published hymn/);
  assert.throws(() => renderMarkdown("```solfa\nhymn: amazing-grace\nbars: 1-99\n```", { hymnsBySlug }), /has bars 1-17/);
  assert.throws(() => renderMarkdown("![x](/a.png)", { hymnsBySlug }), /size/);
});

test("markdown: callouts, pull quotes and captioned figures", () => {
  const hymnsBySlug = new Map();
  const callout = renderMarkdown("> [!TIP]\n> Start with [the basics](/blog/x).", { hymnsBySlug }).html;
  assert.match(callout, /^<aside class="callout callout-tip"><p class="callout-label">Tip<\/p><p>Start with <a href="\/blog\/x">the basics<\/a>.<\/p>\n<\/aside>/);
  const note = renderMarkdown("> [!NOTE]\n>\n> A whole paragraph.", { hymnsBySlug }).html;
  assert.match(note, /class="callout callout-note"><p class="callout-label">Note<\/p>\n?<p>A whole paragraph.<\/p>/);
  assert.match(renderMarkdown("> Solfa is a map of the tune.", { hymnsBySlug }).html, /^<blockquote class="pull-quote"><p>Solfa is a map of the tune.<\/p>/);
  const fig = renderMarkdown('![A choir](/assets/blog/c.jpg "1200x675 | The choir at practice")', { hymnsBySlug }).html;
  assert.equal(fig.trim(), '<figure class="post-figure"><img src="/assets/blog/c.jpg" alt="A choir" width="1200" height="675" loading="lazy" decoding="async"><figcaption>The choir at practice</figcaption></figure>');
  assert.doesNotMatch(renderMarkdown('![A](/a.jpg "10x10")', { hymnsBySlug }).html, /<p>|figcaption/);
});

test("authors: an optional photo under /assets; posts: an optional dek", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-authors-"));
  const write = (front) => fs.writeFileSync(path.join(dir, "ada.md"), `---\nname: Ada\nrole: writer\nshort: Ada writes.\n${front}---\nBio.\n`);
  write("photo: /assets/authors/ada.jpg\n");
  assert.equal(loadAuthors(dir).ada.photo, "/assets/authors/ada.jpg");
  write("photo: https://example.com/ada.jpg\n");
  assert.throws(() => loadAuthors(dir), /"photo" must be a path under \/assets/);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(loadAll().posts.every((p) => p.dek == null || (p.dek.length > 0 && p.dek.length <= 240)));
});
