#!/usr/bin/env node
// Builds the blog and hymn pages into web-site/ from content/ and, with --api, from the API's posts:
//   web-site/blog/**, web-site/hymns/**   (wholly generated: rebuilt from scratch every time)
//   web-site/sitemap.xml                  (blog and hymn entries rebuilt, hand-written ones kept)
//   web-site/index.html                   (only the "Latest from the blog" block between its markers)
//   web-site/<IndexNow key>.txt
//   web-site/blog/catalogue.json          (--api only: hymns, pages and authors for the API's checks)
//   server/app/data/hymn_index.json       (the worker's hymn matcher: every published hymn's melody; only
//                                          when building web-site/ itself, never a --site copy)
//
// Blog posts live in the API's database and are written and published in the admin console. The deploy
// workflow runs this with --api, so the posts are rendered at deploy time and never committed. Without
// --api the build reads content/ alone (hymns, authors, and any post still kept as a file): that output is
// what is committed, and `node check.mjs` fails CI when it is stale.
//
//   node tools/blog/build.mjs                       build content/ into web-site/ (what is committed)
//   node tools/blog/build.mjs --api [URL]           also the live posts from URL (default $BLOG_API_URL,
//                                                   else https://api.notefusion.studio); the deploy does this
//   node tools/blog/build.mjs --api --api-wait 900  keep asking an API that is not answering for up to 900 s
//   node tools/blog/build.mjs --site DIR            build into a copy of web-site/ (check.mjs does)
//   node tools/blog/build.mjs --drafts              include draft posts and hymns (for a local preview only)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SITE_DIR, ORIGIN, PAGE_SIZE, INDEXNOW_KEY } from "./lib/site.mjs";
import { loadAll } from "./lib/content.mjs";
import { writeFile } from "./lib/util.mjs";
import { preparePosts, renderPost, renderBlogIndex, renderTag, renderAuthor, renderHomeStrip, blogPagePath, HOME_START, HOME_END } from "./lib/render-blog.mjs";
import { prepareHymn, renderHymn, renderHymnIndex, renderHymnCredits } from "./lib/render-hymns.mjs";
import { handWrittenEntries, sitemapXml, feedXml } from "./lib/sitemap-feed.mjs";
import { DEFAULT_API_URL, fetchPublished, postsFromApi } from "./lib/api-posts.mjs";
import { catalogueJson, sitePages } from "./lib/catalogue.mjs";
import { hymnIndexJson, HYMN_INDEX_PATH } from "./lib/hymn-index.mjs";

/** Newest first; a tie goes to the slug, so the order never depends on where a post came from. */
function byDate(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug); }

/**
 * Builds every page in memory: { files: Map(relativePath → content), hymnIndex, summary }; `hymnIndex` is
 * the worker's server/app/data/hymn_index.json (lib/hymn-index.mjs). `api` is the answer of
 * GET /api/blog/published (or null for content/ alone): its posts join any kept in content/blog, and win
 * on a slug or title they share.
 */
export function buildSite({ siteDir = SITE_DIR, includeDrafts = false, api = null } = {}) {
  const { authors, hymns, posts: filePosts } = loadAll({ includeDrafts });
  hymns.forEach(prepareHymn);
  const hymnsBySlug = new Map(hymns.map((h) => [h.slug, h]));
  let posts = filePosts, skipped = [];
  if (api) {
    const fromApi = postsFromApi(api, { authors, hymnsBySlug });
    skipped = fromApi.skipped;
    const taken = new Set(fromApi.posts.flatMap((p) => [p.slug, "title:" + p.title.trim().toLowerCase()]));
    posts = [...fromApi.posts, ...filePosts.filter((p) => !taken.has(p.slug) && !taken.has("title:" + p.title.trim().toLowerCase()))].sort(byDate);
  }
  preparePosts(posts, { hymnsBySlug, authors });

  const files = new Map();
  const put = (urlPath, html) => files.set(urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "") + "/index.html", html);

  // Blog
  const pages = Math.max(1, Math.ceil(posts.length / PAGE_SIZE));
  // The blog's hymnal teaser leads with the hymns encoded and checked by hand, then the imported ones.
  const hymnal = [...hymns.filter((h) => !h.importedFrom), ...hymns.filter((h) => h.importedFrom)];
  for (let n = 1; n <= pages; n++) put(blogPagePath(n), renderBlogIndex(posts, { pageNo: n, pages, hymns: hymnal }));
  for (const p of posts) put(p.url, renderPost(p, { posts, authors, hymnsBySlug }));
  const tags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  for (const t of tags) put(`/blog/tag/${t}`, renderTag(t, posts.filter((p) => p.tags.includes(t)), { allPosts: posts }));
  for (const a of Object.values(authors)) put(a.url, renderAuthor(a, posts.filter((p) => p.author === a.id)));
  files.set("blog/feed.xml", feedXml(posts, authors));

  // Hymns
  put("/hymns", renderHymnIndex(hymns));
  put("/hymns/credits", renderHymnCredits(hymns));
  for (const h of hymns) put(`/hymns/${h.slug}`, renderHymn(h, { hymns, posts }));

  // Sitemap: what was there by hand, then the blog and the hymns.
  const newest = (dates) => dates.sort().pop();
  const generated = [
    ...Array.from({ length: pages }, (_, i) => ({ loc: ORIGIN + blogPagePath(i + 1), lastmod: newest(posts.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE).map((p) => p.modified)), changefreq: "weekly", priority: i === 0 ? "0.8" : "0.4" })),
    ...posts.map((p) => ({ loc: ORIGIN + p.url, lastmod: p.modified, changefreq: "monthly", priority: "0.7" })),
    ...Object.values(authors).map((a) => ({ loc: ORIGIN + a.url, lastmod: newest(posts.filter((p) => p.author === a.id).map((p) => p.modified)), changefreq: "monthly", priority: "0.3" })),
    { loc: ORIGIN + "/hymns", lastmod: newest(hymns.map((h) => h.updated)), changefreq: "weekly", priority: "0.8" },
    { loc: ORIGIN + "/hymns/credits", lastmod: newest(hymns.map((h) => h.updated)), changefreq: "monthly", priority: "0.3" },
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
  if (api) files.set("blog/catalogue.json", catalogueJson({ hymns, authors, pages: sitePages(siteDir, [...files.keys()]) }));
  return { files, hymnIndex: hymnIndexJson(hymns), summary: { posts: posts.length, hymns: hymns.length, tags: tags.length, pages: files.size, skipped } };
}

/**
 * Writes a build into `siteDir`, clearing the generated folders first so a deleted post disappears, and the
 * hymn index to `indexPath` (the worker's copy when building web-site/ itself; nowhere for a --site copy).
 */
export function writeSite({ siteDir = SITE_DIR, includeDrafts = false, api = null, indexPath = siteDir === SITE_DIR && !includeDrafts ? HYMN_INDEX_PATH : null } = {}) {
  const { files, hymnIndex, summary } = buildSite({ siteDir, includeDrafts, api });
  for (const dir of ["blog", "hymns"]) fs.rmSync(path.join(siteDir, dir), { recursive: true, force: true });
  for (const [rel, content] of files) writeFile(path.join(siteDir, rel), content);
  if (indexPath) writeFile(indexPath, hymnIndex);
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--site");
  const siteDir = i >= 0 ? path.resolve(args[i + 1]) : SITE_DIR;
  const includeDrafts = args.includes("--drafts");
  if (includeDrafts && siteDir === SITE_DIR) {
    console.error("--drafts is for a local preview: build into a copy with --site DIR, never into web-site/ itself.");
    process.exit(2);
  }
  const a = args.indexOf("--api");
  const w = args.indexOf("--api-wait");
  try {
    let api = null;
    if (a >= 0) {
      const next = args[a + 1];
      const apiUrl = next && !next.startsWith("--") ? next : process.env.BLOG_API_URL || DEFAULT_API_URL;
      api = await fetchPublished({ apiUrl, waitSeconds: w >= 0 ? Number(args[w + 1]) || 0 : 0, log: (m) => console.log(m) });
      console.log(`Read ${api.posts.length} live post${api.posts.length === 1 ? "" : "s"} from ${apiUrl} (version ${api.version || "?"}).`);
    }
    const s = writeSite({ siteDir, includeDrafts, api });
    for (const k of s.skipped) console.log(`::warning::Left out /blog/${k.slug}: ${k.reason.replace(/\n/g, " ")}`);
    console.log(`Built ${s.posts} posts, ${s.hymns} hymns and ${s.tags} tag pages (${s.pages} files) into ${path.relative(process.cwd(), siteDir) || "."}`);
  } catch (e) {
    console.error(`Build failed: ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
