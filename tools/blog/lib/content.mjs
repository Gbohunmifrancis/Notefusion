// Loads and validates everything under content/: blog posts (Markdown + YAML front matter), authors,
// hymn texts and their tunes. A problem stops the build with the file's name and what is wrong.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CONTENT_DIR } from "./site.mjs";
import { isIsoDate, slugify } from "./util.mjs";
import { loadEngine, parseMelody } from "./solfa.mjs";

export function parseFrontMatter(src, file = "") {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error(`${file}: a post starts with front matter between two --- lines`);
  const data = YAML.parse(m[1]) ?? {};
  if (typeof data !== "object" || Array.isArray(data)) throw new Error(`${file}: the front matter is not a set of fields`);
  return { data, body: m[2] };
}

/** Front matter for a post, the same order every time (the drafter writes it, people edit it). */
export function stringifyFrontMatter(data) {
  const doc = new YAML.Document(data);
  return "---\n" + doc.toString({ lineWidth: 0 }) + "---\n";
}

function fail(file, msg) { throw new Error(`${path.relative(CONTENT_DIR, file)}: ${msg}`); }

// ── Authors ─────────────────────────────────────────────────────────────────
export function loadAuthors(dir = path.join(CONTENT_DIR, "authors")) {
  const authors = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const file = path.join(dir, f);
    const { data, body } = parseFrontMatter(fs.readFileSync(file, "utf8"), file);
    for (const k of ["name", "role", "short"]) if (!data[k]) fail(file, `"${k}" is required`);
    // A square photo for the byline and the author page, e.g. /assets/authors/francis.jpg (at least 192×192).
    // Without one, the pages show the author's initials.
    if (data.photo != null && (typeof data.photo !== "string" || !/^\/assets\/[\w./-]+\.(jpe?g|png|webp)$/.test(data.photo))) fail(file, `"photo" must be a path under /assets, e.g. /assets/authors/${f.replace(/\.md$/, "")}.jpg`);
    const id = f.replace(/\.md$/, "");
    authors[id] = { id, ...data, bio: body.trim(), url: `/blog/author/${id}` };
  }
  return authors;
}

// ── Posts ───────────────────────────────────────────────────────────────────
export const DESCRIPTION_MAX = 160;
/** The standfirst under a post's title; optional, the description stands in for it. */
export const DEK_MAX = 240;

export function validatePost(post, { file, authors, hymnSlugs }) {
  const d = post;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)) fail(file, `the file name must be a lowercase slug (got "${d.slug}")`);
  if (!d.title || typeof d.title !== "string") fail(file, `"title" is required`);
  if (!d.description || typeof d.description !== "string") fail(file, `"description" is required`);
  if (d.description.length > DESCRIPTION_MAX) fail(file, `"description" is ${d.description.length} characters; keep it to ${DESCRIPTION_MAX}`);
  if (d.dek != null && (typeof d.dek !== "string" || !d.dek.trim() || d.dek.length > DEK_MAX)) fail(file, `"dek" (the line under the title) must be text of at most ${DEK_MAX} characters`);
  if (!isIsoDate(d.date)) fail(file, `"date" must be YYYY-MM-DD`);
  if (d.updated != null && (!isIsoDate(d.updated) || d.updated < d.date)) fail(file, `"updated" must be YYYY-MM-DD, on or after "date"`);
  if (!authors[d.author]) fail(file, `"author" must be one of: ${Object.keys(authors).join(", ")}`);
  if (!Array.isArray(d.tags) || !d.tags.length || d.tags.some((t) => typeof t !== "string" || slugify(t) !== t)) fail(file, `"tags" must be a list of lowercase-hyphenated tags, e.g. [tonic-solfa, choir]`);
  if (d.faq != null) {
    if (!Array.isArray(d.faq)) fail(file, `"faq" must be a list of {q, a}`);
    d.faq.forEach((f, i) => { if (!f || typeof f.q !== "string" || typeof f.a !== "string" || !f.q.trim() || !f.a.trim()) fail(file, `faq ${i + 1} needs a "q" and an "a"`); });
  }
  if (d.cover != null) {
    const c = d.cover;
    if (!c.src || !c.alt || !(c.width > 0) || !(c.height > 0)) fail(file, `"cover" needs src, alt, width and height`);
  }
  if (d.hymns != null && (!Array.isArray(d.hymns) || d.hymns.some((h) => !hymnSlugs.has(h)))) fail(file, `"hymns" lists a hymn that does not exist`);
  if (typeof d.draft !== "boolean") fail(file, `"draft" must be true or false`);
}

export function loadPosts({ authors, hymnSlugs, dir = path.join(CONTENT_DIR, "blog"), includeDrafts = false }) {
  const posts = [];
  // Posts live in the API's database now (lib/api-posts.mjs); content/blog only holds a post kept as a file.
  const names = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const f of names.filter((f) => f.endsWith(".md")).sort()) {
    const file = path.join(dir, f);
    const { data, body } = parseFrontMatter(fs.readFileSync(file, "utf8"), file);
    const post = { draft: false, faq: null, ...data, slug: f.replace(/\.md$/, ""), body, file };
    validatePost(post, { file, authors, hymnSlugs });
    if (post.draft && !includeDrafts) continue;
    posts.push(post);
  }
  const titles = new Map();
  for (const p of posts) {
    const k = p.title.trim().toLowerCase();
    if (titles.has(k)) fail(p.file, `the title "${p.title}" is already used by ${titles.get(k)}`);
    titles.set(k, p.slug);
  }
  // Newest first; a tie goes to the slug, so the order never depends on the file system.
  return posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));
}

// ── Hymns ───────────────────────────────────────────────────────────────────
/** Public domain, strictly: everyone named died before 1955, and words and music were first published before 1929. */
export const PD_DIED_BEFORE = 1955, PD_PUBLISHED_BEFORE = 1929;

function checkPeople(file, people, what) {
  if (!Array.isArray(people) || !people.length) fail(file, `"${what}" must list who wrote it`);
  for (const p of people) {
    if (!p.name || !p.role) fail(file, `everyone in "${what}" needs a name and a role`);
    if (p.traditional) continue;
    if (!(Number.isInteger(p.died) && p.died < PD_DIED_BEFORE)) fail(file, `${p.name}: public domain needs a death year before ${PD_DIED_BEFORE} (or "traditional": true for an anonymous source)`);
  }
}

export function loadTunes(dir = path.join(CONTENT_DIR, "hymns", "tunes")) {
  const tunes = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(dir, f);
    const t = JSON.parse(fs.readFileSync(file, "utf8"));
    t.slug = f.replace(/\.json$/, "");
    t.file = file;
    if (!t.name) fail(file, `"name" is required`);
    checkPeople(file, t.music, "music");
    if (!(Number.isInteger(t.musicPublished) && t.musicPublished < PD_PUBLISHED_BEFORE)) fail(file, `"musicPublished" must be a year before ${PD_PUBLISHED_BEFORE}`);
    if (t.melody) {
      const N = loadEngine();
      if (!N.parseKey(t.key)) fail(file, `"key" must be a key like "G major" or "A minor"`);
      if (!/^\d+\/(2|4|8)$/.test(String(t.time))) fail(file, `"time" must be a time signature like 3/4 or 6/8`);
      if (!(t.tempo > 0)) fail(file, `"tempo" (crotchets a minute) is required`);
      try { t.parsed = parseMelody(t.melody, { time: t.time, pickup: t.pickup || 0 }); }
      catch (e) { fail(file, `melody: ${e.message}`); }
    }
    tunes[t.slug] = t;
  }
  return tunes;
}

export function loadHymns({ tunes, dir = path.join(CONTENT_DIR, "hymns"), includeDrafts = false }) {
  const N = loadEngine();
  const hymns = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(dir, f);
    const h = JSON.parse(fs.readFileSync(file, "utf8"));
    h.slug = f.replace(/\.json$/, "");
    h.file = file;
    for (const k of ["title", "tune", "description", "updated"]) if (!h[k]) fail(file, `"${k}" is required`);
    if (h.description.length > DESCRIPTION_MAX) fail(file, `"description" is ${h.description.length} characters; keep it to ${DESCRIPTION_MAX}`);
    if (!isIsoDate(h.updated)) fail(file, `"updated" must be YYYY-MM-DD`);
    if (typeof h.draft !== "boolean" || typeof h.reviewed !== "boolean") fail(file, `"draft" and "reviewed" must be true or false`);
    const tune = tunes[h.tune];
    if (!tune) fail(file, `no tune "${h.tune}" in content/hymns/tunes`);
    checkPeople(file, h.text, "text");
    if (!(Number.isInteger(h.textPublished) && h.textPublished < PD_PUBLISHED_BEFORE)) fail(file, `"textPublished" must be a year before ${PD_PUBLISHED_BEFORE}`);
    if (!Array.isArray(h.verses) || !h.verses.length || h.verses.some((v) => !Array.isArray(v.lines) || !v.lines.length)) fail(file, `"verses" must be a list of {lines: [...]}`);
    if (!h.draft) {
      if (!tune.parsed) fail(file, `the tune ${tune.name} has no melody yet; keep the hymn a draft until it has one`);
      const syllables = N.syllabify(h.underlay || "").length;
      if (syllables !== tune.parsed.notes.length) fail(file, `"underlay" has ${syllables} syllables (counting each "_") but ${tune.name} has ${tune.parsed.notes.length} notes`);
    }
    h.tuneData = tune;
    if (h.draft && !includeDrafts) continue;
    hymns.push(h);
  }
  return hymns.sort((a, b) => a.title.localeCompare(b.title));
}

/** Everything the build needs, validated. */
export function loadAll({ includeDrafts = false } = {}) {
  const authors = loadAuthors();
  const tunes = loadTunes();
  const allHymns = loadHymns({ tunes, includeDrafts: true });
  const hymns = allHymns.filter((h) => includeDrafts || !h.draft);
  const posts = loadPosts({ authors, hymnSlugs: new Set(hymns.map((h) => h.slug)), includeDrafts });
  return { authors, tunes, hymns, allHymns, posts };
}
