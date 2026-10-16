// The posts from the API: fetching them at deploy time, leaving out one that cannot be built, the SEO
// overrides, and the catalogue the API reads back from the site.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SITE_DIR } from "../lib/site.mjs";
import { fetchPublished, postsFromApi, toPost } from "../lib/api-posts.mjs";
import { buildSite } from "../build.mjs";
import { loadAll } from "../lib/content.mjs";
import { prepareHymn } from "../lib/render-hymns.mjs";
import { urlsFromSitemaps } from "../indexnow.mjs";

const API = JSON.parse(fs.readFileSync(new URL("./fixtures/published.json", import.meta.url), "utf8"));
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => (typeof body === "string" ? JSON.parse(body) : body) });

test("the build reads GET /api/blog/published, waiting out an API that is still deploying", async () => {
  const calls = [];
  const answers = [reply(404, {}), reply(503, {}), reply(200, API)];
  const json = await fetchPublished({ apiUrl: "https://api.example/", waitSeconds: 60, fetchImpl: async (url) => { calls.push(url); return answers.shift(); }, sleep: async () => {} });
  assert.equal(json.posts.length, 2);
  assert.deepEqual(calls, Array(3).fill("https://api.example/api/blog/published"));
});

test("without an answer the build fails rather than publish a site without its blog", async () => {
  await assert.rejects(fetchPublished({ fetchImpl: async () => reply(503, {}), sleep: async () => {} }), /Could not read the blog posts: .* answered 503/);
  await assert.rejects(fetchPublished({ waitSeconds: 600, fetchImpl: async () => reply(401, {}), sleep: async () => {} }), /answered 401/);
  await assert.rejects(fetchPublished({ fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); }, sleep: async () => {} }), /ENOTFOUND/);
  await assert.rejects(fetchPublished({ fetchImpl: async () => reply(200, "not json{"), sleep: async () => {} }), /did not return JSON/);
});

test("a post the build cannot render is left out with the reason; the rest are built", () => {
  const { authors, hymns } = loadAll();
  hymns.forEach(prepareHymn);
  const hymnsBySlug = new Map(hymns.map((h) => [h.slug, h]));
  const broken = { ...API.posts[0], slug: "broken-post", title: "A Broken Post", body: "Intro.\n\n```solfa\nhymn: no-such-hymn\n```\n" };
  const noTags = { ...API.posts[0], slug: "no-tags", title: "No Tags", tags: [] };
  const { posts, skipped } = postsFromApi({ posts: [...API.posts, broken, noTags] }, { authors, hymnsBySlug });
  assert.deepEqual(posts.map((p) => p.slug), ["how-to-read-tonic-solfa", "how-to-find-the-doh-of-a-song"]);
  assert.deepEqual(skipped.map((s) => s.slug), ["broken-post", "no-tags"]);
  assert.match(skipped[0].reason, /no published hymn "no-such-hymn"/);
  assert.match(skipped[1].reason, /"tags" must be a list/);
});

test("an API post becomes the build's post: FAQ as q/a, no empty FAQ, the SEO overrides kept", () => {
  const p = toPost({ ...API.posts[0], faq: [], seoTitle: "Read Tonic Solfa in a Day | NoteFusion", seoDescription: "Short and sweet.", updated: "2026-11-01" });
  assert.equal(p.faq, null);
  assert.equal(p.updated, "2026-11-01");
  assert.equal(p.draft, false);
  assert.equal(p.seoTitle, "Read Tonic Solfa in a Day | NoteFusion");
  assert.deepEqual(toPost(API.posts[0]).faq[0], { q: API.posts[0].faq[0].question, a: API.posts[0].faq[0].answer });
});

test("the SEO title and description replace the defaults in the page's head", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-seo-"));
  fs.cpSync(SITE_DIR, dir, { recursive: true });
  try {
    const api = { posts: API.posts.map((p, i) => (i === 0 ? { ...p, seoTitle: "Read Tonic Solfa in a Day | NoteFusion", seoDescription: "Learn the seven syllables tonight." } : p)) };
    const { files } = buildSite({ siteDir: dir, api });
    const html = files.get("blog/how-to-read-tonic-solfa/index.html");
    assert.match(html, /<title>Read Tonic Solfa in a Day \| NoteFusion<\/title>/);
    assert.match(html, /<meta name="description" content="Learn the seven syllables tonight.">/);
    assert.match(html, /<meta property="og:title" content="Read Tonic Solfa in a Day \| NoteFusion">/);
    // The visible headline is still the post's title.
    assert.match(html, /<h1>How to Read Tonic Solfa: A Complete Beginner&#39;s Guide<\/h1>|<h1>How to Read Tonic Solfa: A Complete Beginner's Guide<\/h1>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the deploy build publishes the catalogue the API checks posts against", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-cat-"));
  fs.cpSync(SITE_DIR, dir, { recursive: true });
  try {
    const { files } = buildSite({ siteDir: dir, api: API });
    const cat = JSON.parse(files.get("blog/catalogue.json"));
    assert.deepEqual(cat.authors, ["francis"]);
    const grace = cat.hymns.find((h) => h.slug === "amazing-grace");
    assert.equal(grace.header, "Doh is G");
    assert.equal(grace.firstLine.solfa, "| s, - | d - - - m d | m - - - r - | d - - - l, - | s, - - - s, - |");
    assert.ok(grace.bars >= grace.firstLine.bars);
    for (const p of ["/", "/app", "/privacy", "/blog", "/hymns", "/hymns/amazing-grace", "/blog/how-to-read-tonic-solfa", "/blog/author/francis"]) assert.ok(cat.pages.includes(p), p);
    assert.ok(!cat.pages.some((p) => p.startsWith("/assets")));
    assert.ok(!buildSite({ siteDir: dir }).files.has("blog/catalogue.json"), "not written by the build from content/ alone");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("IndexNow is told about posts published from the console by comparing the live sitemap with the new one", () => {
  const url = (loc, lastmod) => `<url><loc>https://notefusion.studio${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  const live = `<urlset>${url("/", "2026-10-01")}${url("/blog", "2026-10-14")}${url("/blog/old-post", "2026-10-14")}${url("/blog/gone-post", "2026-10-01")}${url("/hymns/amazing-grace", "2026-10-15")}</urlset>`;
  const built = `<urlset>${url("/", "2026-10-02")}${url("/blog", "2026-10-16")}${url("/blog/old-post", "2026-10-14")}${url("/blog/new-post", "2026-10-16")}${url("/hymns/amazing-grace", "2026-10-15")}</urlset>`;
  assert.deepEqual(urlsFromSitemaps(live, built), [
    "https://notefusion.studio/blog",
    "https://notefusion.studio/blog/gone-post",
    "https://notefusion.studio/blog/new-post",
  ]);
  assert.deepEqual(urlsFromSitemaps("", built).length, 4, "no live sitemap: everything of ours is new");
});
