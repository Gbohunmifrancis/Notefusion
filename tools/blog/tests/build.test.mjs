// Builds the real content into a throwaway copy of web-site/ and checks what search engines and
// feed readers will see.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SITE_DIR, INDEXNOW_KEY } from "../lib/site.mjs";
import { writeSite } from "../build.mjs";
import { checkSite, staleFiles, xmlError, resolveSitePath } from "../check.mjs";
import { handWrittenEntries } from "../lib/sitemap-feed.mjs";
import { melodyToMusicXml } from "../lib/musicxml.mjs";
import { parseMelody } from "../lib/solfa.mjs";

let dir;
const read = (rel) => fs.readFileSync(path.join(dir, rel), "utf8");
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-build-"));
  fs.cpSync(SITE_DIR, dir, { recursive: true });
  writeSite({ siteDir: dir });
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("the committed site is what the build writes (the CI staleness check)", () => {
  assert.deepEqual(staleFiles(dir, SITE_DIR), []);
});

test("the built site passes the link, SEO and JSON-LD checks", () => {
  assert.deepEqual(checkSite(dir), []);
});

test("the sitemap keeps the hand-written pages and adds every post and hymn with lastmod", () => {
  const xml = read("sitemap.xml");
  assert.equal(xmlError(xml), null);
  for (const loc of ["https://notefusion.studio/", "https://notefusion.studio/privacy", "https://notefusion.studio/terms"]) assert.ok(xml.includes(`<loc>${loc}</loc>`), loc);
  assert.match(xml, /<loc>https:\/\/notefusion\.studio\/blog\/how-to-read-tonic-solfa<\/loc>\n\s*<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/notefusion\.studio\/hymns\/amazing-grace<\/loc>\n\s*<lastmod>/);
  assert.ok(!xml.includes("/blog/tag/"), "tag pages are noindex, so not in the sitemap");
  // Rebuilding from its own output does not duplicate or lose entries.
  assert.equal(handWrittenEntries(xml).length, 3);
});

test("the feed is RSS 2.0 with one item per post, absolute links inside", () => {
  const xml = read("blog/feed.xml");
  assert.equal(xmlError(xml), null);
  assert.match(xml, /<rss version="2.0"/);
  const items = [...xml.matchAll(/<item>/g)].length;
  assert.equal(items, fs.readdirSync(path.join(dir, "blog")).filter((d) => !["tag", "author", "page", "feed.xml", "index.html"].includes(d)).length);
  assert.match(xml, /<pubDate>\w{3}, \d{2} \w{3} \d{4} 12:00:00 \+0000<\/pubDate>/);
  assert.ok(!/href="\/[^/]/.test(xml), "links in content:encoded are absolute");
});

test("a post: one h1, canonical, Open Graph, BlogPosting + BreadcrumbList + FAQPage, the tracker", () => {
  const html = read("blog/how-to-read-tonic-solfa/index.html");
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/notefusion\.studio\/blog\/how-to-read-tonic-solfa">/);
  assert.match(html, /<meta property="og:type" content="article">/);
  const types = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])["@type"]);
  assert.deepEqual(types, ["BlogPosting", "BreadcrumbList", "FAQPage"]);
  assert.match(html, /<time datetime="2026-10-15">/);
  assert.match(html, /class="toc"/);
  assert.match(html, /\/assets\/track\.js/);
  assert.match(html, /href="\/app\?utm_source=blog"/);
});

test("a post's header: kicker, title, dek, then the byline with the read-count slot, before the body", () => {
  const html = read("blog/how-to-read-tonic-solfa/index.html");
  const header = html.slice(html.indexOf('<header class="post-header">'), html.indexOf("</header>", html.indexOf('<header class="post-header">')));
  assert.match(header, /<p class="kicker"><a href="\/blog\/tag\/tonic-solfa">Tonic Solfa<\/a><\/p>/);
  assert.match(header, /<p class="post-lede">Everything a new singer needs/);
  assert.match(header, /By <a href="\/blog\/author\/francis" rel="author">Francis<\/a>/);
  assert.match(header, /<span class="avatar avatar-initials avatar-48" aria-hidden="true">F<\/span>/);
  assert.match(header, /<span class="meta-reads" data-reads-path="\/blog\/how-to-read-tonic-solfa" aria-hidden="true"><\/span>/);
  assert.ok(html.indexOf('class="post-header"') < html.indexOf('class="post-body"'));
  // Shares as plain links, WhatsApp first; no third-party script.
  const share = html.slice(html.indexOf('class="share"'), html.indexOf("</section>", html.indexOf('class="share"')));
  assert.deepEqual([...share.matchAll(/data-track="Share: ([^"]+)"/g)].map((m) => m[1]), ["WhatsApp", "X", "Facebook", "copy link"]);
  assert.match(share, /href="https:\/\/wa\.me\/\?text=How%20to%20Read%20Tonic%20Solfa/);
  const external = [...html.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((m) => new URL(m[1]).hostname);
  assert.deepEqual(external, ["pagead2.googlesyndication.com"]);
  // Theme before paint, read counts and the tracker after; no inline script that runs.
  assert.match(html, /<meta name="viewport"[^>]*>\n<script src="\/assets\/theme-boot\.js\?v=\d+" data-default="system"><\/script>/);
  assert.match(html, /<script src="\/assets\/blog\.js\?v=\d+" defer><\/script>/);
  // The reading analytics run on track.js, so they load right after it.
  assert.match(html, /<script src="\/assets\/track\.js\?v=\d+" defer><\/script>\n<script src="\/assets\/blog-track\.js\?v=\d+" defer><\/script>/);
  assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>/g)].length, 0);
  const posting = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((d) => d["@type"] === "BlogPosting");
  assert.deepEqual(posting.author, { "@type": "Person", name: "Francis", jobTitle: "founder of NoteFusion", url: "https://notefusion.studio/blog/author/francis" });
});

test("the blog's front page: the newest post set large, the rest beside it, topics, the hymnal", () => {
  const html = read("blog/index.html");
  assert.match(html, /<article class="feature" aria-labelledby="feature-title">[\s\S]*?href="\/blog\/how-to-read-tonic-solfa"/);
  assert.match(html, /<section class="front-side"[\s\S]*?href="\/blog\/how-to-find-the-doh-of-a-song"/);
  assert.match(html, /<nav class="topics" aria-label="Topics"><a href="\/blog" aria-current="page">All<\/a>/);
  assert.match(html, /data-reads-path="\/blog\/how-to-find-the-doh-of-a-song" data-reads-format="compact"/);
  assert.match(html, /<section class="hymnal"[\s\S]*?href="\/hymns\/amazing-grace"/);
});

test("a hymn page: the engine's solfa as text, MusicComposition JSON-LD, the score as data", () => {
  const html = read("hymns/amazing-grace/index.html");
  assert.match(html, /<title>Amazing Grace — Tonic Solfa &amp; Sheet Music \(Doh is G\)<\/title>/);
  // The plain-text solfa is one unit per bar (so a phone wraps it at bar lines), its words under it;
  // read in order the bars are the line's text exactly.
  const firstLine = /<div class="solfa-line">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.equal([...firstLine.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => m[1]).join(""), "| s, - | d - - - m d | m - - - r - | d - - - l, - | s, - - - s, - |");
  assert.match(firstLine, /^<span class="solfa-bar"><code>\| s, - <\/code><span class="solfa-words">A-<\/span><\/span><span class="solfa-bar"><code>\| d - - - m d <\/code><span class="solfa-words">mazing<\/span>/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const comp = ld.find((d) => d["@type"] === "MusicComposition");
  assert.equal(comp.musicalKey, "G major");
  assert.equal(comp.lyricist[0].name, "John Newton");
  const data = JSON.parse(/<script type="application\/json" id="hymn-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(xmlError(data.musicXml), null);
  assert.equal(data.notes.length, 32);
});

test("the home page shows the newest posts between its markers", () => {
  const html = read("index.html");
  const block = html.slice(html.indexOf("<!-- blog-latest:start -->"), html.indexOf("<!-- blog-latest:end -->"));
  assert.match(block, /href="\/blog\/how-to-read-tonic-solfa"/);
  assert.equal(read(`${INDEXNOW_KEY}.txt`).trim(), INDEXNOW_KEY);
});

test("the checker catches broken links, missing ids and stale output", () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "nf-broken-"));
  fs.cpSync(dir, copy, { recursive: true });
  const f = path.join(copy, "blog", "index.html");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("</main>", '<a href="/blog/nope">x</a><a href="#missing">y</a></main>'));
  const errors = checkSite(copy);
  assert.ok(errors.some((e) => e.includes("broken link /blog/nope")), errors.join("\n"));
  assert.ok(errors.some((e) => e.includes("no id for #missing")));
  assert.deepEqual(staleFiles(dir, copy), ["blog/index.html (differs)"]);
  fs.rmSync(copy, { recursive: true, force: true });
});

test("clean URLs resolve like Vercel serves them", () => {
  assert.ok(resolveSitePath(dir, "/blog"));
  assert.ok(resolveSitePath(dir, "/hymns/amazing-grace?x=1#faq-title"));
  assert.ok(resolveSitePath(dir, "/privacy"));
  assert.equal(resolveSitePath(dir, "/nope"), null);
});

test("MusicXML: key, pickup measure, ties across the bar, lyric syllables", () => {
  const m = parseMelody("D4:1 | G4:2 B4:1 | D5:3~ | D5:2", { time: "3/4", pickup: 1 });
  const xml = melodyToMusicXml(m, { key: "G major", underlay: "A-maz-ing grace" });
  assert.equal(xmlError(xml), null);
  assert.match(xml, /<fifths>1<\/fifths><mode>major<\/mode>/);
  assert.match(xml, /<measure number="0" implicit="yes">/);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<syllabic>begin<\/syllabic><text>A<\/text>/);
  assert.match(xml, /<syllabic>end<\/syllabic><text>ing<\/text>/);
  const flat = melodyToMusicXml(parseMelody("Bb4:3", { time: "3/4" }), { key: "F major" });
  assert.match(flat, /<step>B<\/step><alter>-1<\/alter><octave>4<\/octave>/);
});
