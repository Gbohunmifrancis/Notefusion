#!/usr/bin/env node
// Builds the blog and hymn pages into web-site/ from content/ and, with --api, from the API's posts:
//   web-site/blog/**, web-site/hymns/**   (wholly generated: rebuilt from scratch every time; tune pages at /hymns/tunes/<slug>,
//                                          the hum-to-find page at /hymns/identify, the seasons and occasions at
//                                          /hymns/occasions/<slug>, writers and composers at /hymns/people/<slug>,
//                                          the first lines at /hymns/first-lines)
//   web-site/hymns/**/<slug>-tonic-solfa.pdf  (each hymn's and tune page's printable solfa, lib/render-pdf.mjs;
//                                          built with the pages but never committed: web-site/.gitignore)
//   web-site/sitemap.xml                  (blog and hymn entries rebuilt, hand-written ones kept)
//   web-site/index.html                   (only the sample sheet and "Latest from the blog" blocks between their markers)
//   web-site/<IndexNow key>.txt
//   web-site/assets/icons.svg             (the Lucide icon sprite every page uses; icons.mjs, + its licence)
//   web-site/blog/catalogue.json          (--api only: hymns, pages and authors for the API's checks)
//   web-site/hymns/pack.json              (the app's offline hymn pack, + pack-version.json; lib/hymn-pack.mjs)
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
import { prepareHymn, renderHymn, renderHymnIndex, renderHymnCredits, hymnName } from "./lib/render-hymns.mjs";
import { prepareTune, renderTune } from "./lib/render-tunes.mjs";
import { renderIdentify, IDENTIFY_PATH, IDENTIFY_UPDATED } from "./lib/render-identify.mjs";
import { occasionPages, collectPeople, peopleAddresses, PEOPLE_ADDRESSES_PATH, firstLineEntries } from "./lib/collections.mjs";
import { renderOccasion, renderOccasionsHub, renderPerson, renderPeopleHub, renderFirstLines, OCCASIONS_PATH, PEOPLE_PATH, FIRST_LINES_PATH } from "./lib/render-collections.mjs";
import { buildSolfaPdf, hymnPdfItem, tunePdfItem, pdfPath } from "./lib/render-pdf.mjs";
import { handWrittenEntries, sitemapXml, feedXml } from "./lib/sitemap-feed.mjs";
import { DEFAULT_API_URL, fetchPublished, postsFromApi } from "./lib/api-posts.mjs";
import { catalogueJson, sitePages } from "./lib/catalogue.mjs";
import { hymnIndexJson, HYMN_INDEX_PATH } from "./lib/hymn-index.mjs";
import { hymnPackFiles, PACK_PATH, PACK_VERSION_PATH } from "./lib/hymn-pack.mjs";
import { spriteSvg, licenseText } from "./icons.mjs";
import { renderHomeSheet, SHEET_START, SHEET_END, SAMPLE_HYMN, SEASON_SAMPLE_HYMN, HALLOWEEN_SAMPLE_TUNE } from "./lib/render-home.mjs";

/** Pages under /hymns that a hymn's slug must never take. */
const RESERVED_HYMN_PATHS = ["/hymns/credits", IDENTIFY_PATH, "/hymns/tunes", OCCASIONS_PATH, PEOPLE_PATH, FIRST_LINES_PATH];

/** Newest first; a tie goes to the slug, so the order never depends on where a post came from. */
function byDate(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug); }

/**
 * Builds every page in memory: { files: Map(relativePath → content), hymnIndex, summary }; `hymnIndex` is
 * the worker's server/app/data/hymn_index.json (lib/hymn-index.mjs). `api` is the answer of
 * GET /api/blog/published (or null for content/ alone): its posts join any kept in content/blog, and win
 * on a slug or title they share.
 */
export function buildSite({ siteDir = SITE_DIR, includeDrafts = false, api = null } = {}) {
  const { authors, hymns, tunes, posts: filePosts } = loadAll({ includeDrafts });
  hymns.forEach(prepareHymn);
  // Tune pages: tunes without words (CCEH), published when "draft" is false.
  const tunePages = Object.values(tunes).filter((t) => t.draft != null && t.parsed && (includeDrafts || !t.draft)).map(prepareTune).sort((a, b) => a.view.title.localeCompare(b.view.title));
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

  // Hymns, and the ways into them: seasons and occasions, writers and composers, first lines.
  const occasions = occasionPages(hymns, tunePages);
  // Each person's page stays where it was first published (lib/collections.mjs collectPeople).
  const addressesPath = path.join(siteDir, PEOPLE_ADDRESSES_PATH);
  const addresses = fs.existsSync(addressesPath) ? JSON.parse(fs.readFileSync(addressesPath, "utf8")) : {};
  const people = collectPeople(hymns, tunePages, { addresses });
  files.set(PEOPLE_ADDRESSES_PATH, JSON.stringify(peopleAddresses(people, addresses), null, 2) + "\n");
  const personByKey = new Map(people.map((p) => [p.key, p]));
  const firstLines = firstLineEntries(hymns);
  for (const h of hymns) if (RESERVED_HYMN_PATHS.includes(`/hymns/${h.slug}`)) throw new Error(`the hymn ${h.slug} clashes with the page /hymns/${h.slug}`);
  put("/hymns", renderHymnIndex(hymns, tunePages, { occasions }));
  put("/hymns/credits", renderHymnCredits(hymns, tunePages));
  put(IDENTIFY_PATH, renderIdentify({ hymns, tunes: tunePages }));
  put(OCCASIONS_PATH, renderOccasionsHub(occasions));
  for (const o of occasions) put(o.url, renderOccasion(o, { occasions }));
  put(PEOPLE_PATH, renderPeopleHub(people));
  for (const p of people) put(p.url, renderPerson(p, { people }));
  put(FIRST_LINES_PATH, renderFirstLines(firstLines));
  for (const h of hymns) put(`/hymns/${h.slug}`, renderHymn(h, { hymns, posts, occasions, personByKey }));
  for (const t of tunePages) put(t.view.url, renderTune(t, { hymns, posts, personByKey }));
  // The printable solfa next to each hymn and tune page, built by writeSite (pdf-lib is asynchronous).
  const named = (list) => list.filter((p) => !p.traditional).map((p) => p.name);
  const pdfs = [
    ...hymns.map((h) => ({ rel: pdfPath(`/hymns/${h.slug}`).slice(1), item: hymnPdfItem(h, { name: hymnName(h), writers: named([...h.text, ...h.tuneData.music]) }) })),
    ...tunePages.map((t) => ({ rel: pdfPath(t.view.url).slice(1), item: tunePdfItem(t, { makers: named(t.music) }) })),
  ];
  // The app's offline hymn pack: every published hymn and tune page in one download.
  const pack = hymnPackFiles(hymns, tunePages);
  files.set(PACK_PATH, pack.pack);
  files.set(PACK_VERSION_PATH, pack.version);

  // Sitemap: what was there by hand, then the blog and the hymns.
  const newest = (dates) => dates.sort().pop();
  const generated = [
    ...Array.from({ length: pages }, (_, i) => ({ loc: ORIGIN + blogPagePath(i + 1), lastmod: newest(posts.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE).map((p) => p.modified)), changefreq: "weekly", priority: i === 0 ? "0.8" : "0.4" })),
    ...posts.map((p) => ({ loc: ORIGIN + p.url, lastmod: p.modified, changefreq: "monthly", priority: "0.7" })),
    ...Object.values(authors).map((a) => ({ loc: ORIGIN + a.url, lastmod: newest(posts.filter((p) => p.author === a.id).map((p) => p.modified)), changefreq: "monthly", priority: "0.3" })),
    { loc: ORIGIN + "/hymns", lastmod: newest([...hymns.map((h) => h.updated), ...tunePages.map((t) => t.updated)]), changefreq: "weekly", priority: "0.8" },
    { loc: ORIGIN + IDENTIFY_PATH, lastmod: IDENTIFY_UPDATED, changefreq: "monthly", priority: "0.8" },
    { loc: ORIGIN + "/hymns/credits", lastmod: newest([...hymns.map((h) => h.updated), ...tunePages.map((t) => t.updated)]), changefreq: "monthly", priority: "0.3" },
    { loc: ORIGIN + OCCASIONS_PATH, lastmod: newest(occasions.flatMap((o) => o.hymns.map((h) => h.updated))), changefreq: "monthly", priority: "0.6" },
    ...occasions.map((o) => ({ loc: ORIGIN + o.url, lastmod: newest(o.hymns.map((h) => h.updated)), changefreq: "monthly", priority: "0.6" })),
    { loc: ORIGIN + PEOPLE_PATH, lastmod: newest(people.flatMap((p) => p.works.map((w) => w.item.updated))), changefreq: "monthly", priority: "0.5" },
    ...people.map((p) => ({ loc: ORIGIN + p.url, lastmod: newest(p.works.map((w) => w.item.updated)), changefreq: "monthly", priority: "0.5" })),
    { loc: ORIGIN + FIRST_LINES_PATH, lastmod: newest(hymns.map((h) => h.updated)), changefreq: "monthly", priority: "0.6" },
    ...hymns.map((h) => ({ loc: `${ORIGIN}/hymns/${h.slug}`, lastmod: h.updated, changefreq: "monthly", priority: "0.7" })),
    ...tunePages.map((t) => ({ loc: ORIGIN + t.view.url, lastmod: t.updated, changefreq: "monthly", priority: "0.5" })),
  ];
  const sitemapPath = path.join(siteDir, "sitemap.xml");
  const kept = fs.existsSync(sitemapPath) ? handWrittenEntries(fs.readFileSync(sitemapPath, "utf8")) : [];
  files.set("sitemap.xml", sitemapXml([...kept, ...generated]));

  // The home page's strip of newest posts and its sample sheet.
  const homePath = path.join(siteDir, "index.html");
  const between = (html, start, end, block, what) => {
    const a = html.indexOf(start), b = html.indexOf(end);
    if (a < 0 || b < a) throw new Error(`web-site/index.html has no ${start} … ${end} block for ${what}`);
    return html.slice(0, a) + block + html.slice(b + end.length);
  };
  const sample = hymnsBySlug.get(SAMPLE_HYMN);
  if (!sample) throw new Error(`the home page's sample sheet needs the hymn ${SAMPLE_HYMN}`);
  // The Christmas season's sample (Silent Night), inert until assets/season.js swaps it in while the switch is on.
  const seasonSample = hymnsBySlug.get(SEASON_SAMPLE_HYMN);
  if (!seasonSample) throw new Error(`the home page's Christmas sample needs the hymn ${SEASON_SAMPLE_HYMN}`);
  // The Halloween season's sample (the Mountain King's first bar), once the tune is published; until then there is none
  // and the season keeps the year-round sample.
  const halloweenSample = tunePages.find((t) => t.slug === HALLOWEEN_SAMPLE_TUNE && !t.draft) ?? hymnsBySlug.get(HALLOWEEN_SAMPLE_TUNE) ?? null;
  let home = fs.readFileSync(homePath, "utf8");
  home = between(home, HOME_START, HOME_END, renderHomeStrip(posts), "the latest posts");
  home = between(home, SHEET_START, SHEET_END, renderHomeSheet(sample, seasonSample, halloweenSample), "the sample sheet");
  files.set("index.html", home);

  files.set(`${INDEXNOW_KEY}.txt`, INDEXNOW_KEY + "\n");
  files.set("assets/icons.svg", spriteSvg());
  files.set("assets/icons-LICENSE.txt", licenseText());
  if (api) files.set("blog/catalogue.json", catalogueJson({ hymns, authors, pages: sitePages(siteDir, [...files.keys()]) }));
  // The worker's hymn index: published hymns, then published tune pages (tunes without words), then incipits.
  const indexTunes = tunePages.filter((t) => !t.draft);
  return {
    files, pdfs, hymnIndex: hymnIndexJson(hymns, undefined, indexTunes),
    summary: { posts: posts.length, hymns: hymns.length, tunes: tunePages.length, tags: tags.length, occasions: occasions.length, people: people.length, firstLines: firstLines.length, pages: files.size, skipped },
  };
}

/**
 * Writes a build into `siteDir`, clearing the generated folders first so a deleted post disappears, and the
 * hymn index to `indexPath` (the worker's copy when building web-site/ itself; nowhere for a --site copy).
 *
 * Then the PDFs (`pdfs: false` leaves them out). They are built here, with the pages, on every build: locally,
 * in check.mjs (which checks every one) and in the deploy. They are never committed (web-site/.gitignore): a few
 * hundred binary files that change whenever a hymn, the layout or a font does would grow the repository with
 * every edit, and a PDF is rebuilt from the same content and code as its page, so it cannot go stale.
 */
export async function writeSite({ siteDir = SITE_DIR, includeDrafts = false, api = null, indexPath = siteDir === SITE_DIR && !includeDrafts ? HYMN_INDEX_PATH : null, pdfs = true } = {}) {
  const { files, pdfs: jobs, hymnIndex, summary } = buildSite({ siteDir, includeDrafts, api });
  for (const dir of ["blog", "hymns"]) fs.rmSync(path.join(siteDir, dir), { recursive: true, force: true });
  for (const [rel, content] of files) writeFile(path.join(siteDir, rel), content);
  if (indexPath) writeFile(indexPath, hymnIndex);
  summary.pdfs = 0;
  if (pdfs) for (const j of jobs) { writeFile(path.join(siteDir, j.rel), await buildSolfaPdf(j.item)); summary.pdfs++; }
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
    const s = await writeSite({ siteDir, includeDrafts, api });
    for (const k of s.skipped) console.log(`::warning::Left out /blog/${k.slug}: ${k.reason.replace(/\n/g, " ")}`);
    console.log(`Built ${s.posts} posts, ${s.hymns} hymns, ${s.tunes} tune pages, ${s.occasions} occasion pages, ${s.people} people pages, ${s.firstLines} first lines and ${s.tags} tag pages (${s.pages} files), and ${s.pdfs} PDFs into ${path.relative(process.cwd(), siteDir) || "."}`);
  } catch (e) {
    console.error(`Build failed: ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
