#!/usr/bin/env node
// Builds the blog and hymn pages into web-site/ from content/:
//   web-site/blog/**, web-site/hymns/**   (wholly generated: rebuilt from scratch every time)
//   web-site/sitemap.xml                  (blog and hymn entries rebuilt, hand-written ones kept)
//   web-site/index.html                   (only the "Latest from the blog" block between its markers)
//   web-site/<IndexNow key>.txt
// The output is committed, so Vercel stays a plain static deploy and a pull request shows exactly
// what will go live. `node check.mjs` fails CI when the committed output is stale.
//
//   node tools/blog/build.mjs                 build into web-site/
//   node tools/blog/build.mjs --site DIR      build into a copy of web-site/ (check.mjs does)
//   node tools/blog/build.mjs --drafts        include draft posts and hymns (for a local preview only)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR, ORIGIN, PAGE_SIZE, INDEXNOW_KEY } from "./lib/site.mjs";
import { loadAll } from "./lib/content.mjs";
import { writeFile } from "./lib/util.mjs";
import { preparePosts, renderPost, renderBlogIndex, renderTag, renderAuthor, renderHomeStrip, blogPagePath, HOME_START, HOME_END } from "./lib/render-blog.mjs";
import { prepareHymn, renderHymn, renderHymnIndex } from "./lib/render-hymns.mjs";
import { handWrittenEntries, sitemapXml, feedXml } from "./lib/sitemap-feed.mjs";

/** Builds every page in memory: { files: Map(relativePath → content), summary }. */
export function buildSite({ siteDir = SITE_DIR, includeDrafts = false } = {}) {
  const { authors, hymns, posts } = loadAll({ includeDrafts });
  hymns.forEach(prepareHymn);
  const hymnsBySlug = new Map(hymns.map((h) => [h.slug, h]));
  preparePosts(posts, { hymnsBySlug });

  const files = new Map();
  const put = (urlPath, html) => files.set(urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "") + "/index.html", html);

  // Blog
  const pages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  for (let n = 1; n <= pages; n++) put(blogPagePath(n), renderBlogIndex(posts, { pageNo: n, pages, hymns }));
  for (const p of posts) put(p.url, renderPost(p, { posts, authors, hymnsBySlug }));
  const tags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  for (const t of tags) put(`/blog/tag/${t}`, renderTag(t, posts.filter((p) => p.tags.includes(t))));
  for (const a of Object.values(authors)) put(a.url, renderAuthor(a, posts.filter((p) => p.author === a.id)));
  files.set("blog/feed.xml", feedXml(posts, authors));

  // Hymns
  put("/hymns", renderHymnIndex(hymns));
  for (const h of hymns) put(`/hymns/${h.slug}`, renderHymn(h, { hymns, posts }));

  // Sitemap: what was there by hand, then the blog and the hymns.
  const newest = (dates) => dates.sort().pop();
  const generated = [
    ...Array.from({ length: pages }, (_, i) => ({ loc: ORIGIN + blogPagePath(i + 1), lastmod: newest(posts.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE).map((p) => p.modified)), changefreq: "weekly", priority: i === 0 ? "0.8" : "0.4" })),
    ...posts.map((p) => ({ loc: ORIGIN + p.url, lastmod: p.modified, changefreq: "monthly", priority: "0.7" })),
    ...Object.values(authors).map((a) => ({ loc: ORIGIN + a.url, lastmod: newest(posts.filter((p) => p.author === a.id).map((p) => p.modified)), changefreq: "monthly", priority: "0.3" })),
    { loc: ORIGIN + "/hymns", lastmod: newest(hymns.map((h) => h.updated)), changefreq: "weekly", priority: "0.8" },
    ...hymns.map((h) => ({ loc: `${ORIGIN}/hymns/${h.slug}`, lastmod: h.updated, changefreq: "monthly", priority: "0.7" })),
  ];
  const sitemapPath = path.join(siteDir, "sitemap.xml");
  const kept = fs.existsSync(sitemapPath) ? handWrittenEntries(fs.readFileSync(sitemapPath, "utf8")) : [];
  files.set("sitemap.xml", sitemapXml([...kept, ...generated]));

  // The home page's strip of newest posts.
  const homePath = path.join(siteDir, "index.html");
  const home = fs.readFileSync(homePath, "utf8");
  const a = home.indexOf(HOME_START), b = home.indexOf(HOME_END);
  if (a < 0 || b < a) throw new Error(`web-site/index.html has no ${HOME_START} … ${HOME_END} block for the latest posts`);
  files.set("index.html", home.slice(0, a) + renderHomeStrip(posts) + home.slice(b + HOME_END.length));

  files.set(`${INDEXNOW_KEY}.txt`, INDEXNOW_KEY + "\n");
  return { files, summary: { posts: posts.length, hymns: hymns.length, tags: tags.length, pages: files.size } };
}

/** Writes a build into `siteDir`, clearing the generated folders first so a deleted post disappears. */
export function writeSite({ siteDir = SITE_DIR, includeDrafts = false } = {}) {
  const { files, summary } = buildSite({ siteDir, includeDrafts });
  for (const dir of ["blog", "hymns"]) fs.rmSync(path.join(siteDir, dir), { recursive: true, force: true });
  for (const [rel, content] of files) writeFile(path.join(siteDir, rel), content);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--site");
  const siteDir = i >= 0 ? path.resolve(args[i + 1]) : SITE_DIR;
  const includeDrafts = args.includes("--drafts");
  if (includeDrafts && siteDir === SITE_DIR) {
    console.error("--drafts is for a local preview: build into a copy with --site DIR, never into web-site/ itself.");
    process.exit(2);
  }
  try {
    const s = writeSite({ siteDir, includeDrafts });
    console.log(`Built ${s.posts} posts, ${s.hymns} hymns and ${s.tags} tag pages (${s.pages} files) into ${path.relative(process.cwd(), siteDir) || "."}`);
  } catch (e) {
    console.error(`Build failed: ${e.message}`);
    process.exit(1);
  }
}
