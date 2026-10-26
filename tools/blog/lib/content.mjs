// Loads and validates everything under content/: blog posts (Markdown + YAML front matter), authors,
// hymn texts and their tunes. A problem stops the build with the file's name and what is wrong.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { CONTENT_DIR } from "./site.mjs";
import { isIsoDate, slugify } from "./util.mjs";
import { loadEngine, parseMelody } from "./solfa.mjs";
import { OCCASION_NAMES } from "./collections.mjs";

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

/**
 * Someone with no known death year whose work was in print before 1850 is taken to have died before 1955:
 * they would have been over 105. Recorded as "activeBy" (the earliest year a source credits them with), never
 * as a made-up death year. The founder's rule for imported tunes (2026-10-16).
 */
export const PD_ACTIVE_BEFORE = 1850;

/**
 * Why a hymn is not (provably) in the public domain, as a list of reasons; empty when it is. Everyone
 * named (composer, arranger, author, translator) must have a death year before 1955 — or be an
 * anonymous or traditional source ("traditional": true) — and the words and the music must have been
 * first published before 1929. The build refuses to publish a hymn with any reason; the importer
 * uses the same test to keep a hymn as a draft.
 */
export function publicDomainProblems({ text = [], music = [], textPublished, musicPublished }) {
  const out = [];
  for (const p of [...text, ...music]) {
    if (!p || p.traditional) continue;
    const died = Number.isInteger(p.died) && p.died < PD_DIED_BEFORE;
    const activeEarly = !Number.isInteger(p.died) && Number.isInteger(p.activeBy) && p.activeBy < PD_ACTIVE_BEFORE;
    if (!died && !activeEarly) out.push(`${p.name}: public domain needs a death year before ${PD_DIED_BEFORE}, work in print before ${PD_ACTIVE_BEFORE} ("activeBy"), or "traditional": true for an anonymous source`);
  }
  if (!(Number.isInteger(textPublished) && textPublished < PD_PUBLISHED_BEFORE)) out.push(`"textPublished" must be a year before ${PD_PUBLISHED_BEFORE}`);
  if (!(Number.isInteger(musicPublished) && musicPublished < PD_PUBLISHED_BEFORE)) out.push(`"musicPublished" must be a year before ${PD_PUBLISHED_BEFORE}`);
  return out;
}

/**
 * The same test for a tune on its own (a tune page, with no words): everyone named in its music died
 * before 1955 (or is an anonymous or traditional source), and it was first published before 1929.
 */
export function tunePublicDomainProblems({ music = [], musicPublished }) {
  return publicDomainProblems({ music, musicPublished, textPublished: 0 });
}

function checkNames(file, people, what) {
  if (!Array.isArray(people) || !people.length) fail(file, `"${what}" must list who wrote it`);
  for (const p of people) {
    if (!p.name || !p.role) fail(file, `everyone in "${what}" needs a name and a role`);
    if (p.lived != null && typeof p.lived !== "string") fail(file, `${p.name}: "lived" is text, e.g. "5th century"`);
  }
}

/** The optional source fields of a hymn or tune taken from a published collection. */
function checkSource(file, x) {
  if (x.source == null) return;
  if (typeof x.source !== "string" || !x.source.trim()) fail(file, `"source" must name where the hymn comes from`);
  if (x.sourceUrl != null && !/^https?:\/\/\S+$/.test(x.sourceUrl)) fail(file, `"sourceUrl" must be a web address`);
  for (const k of ["licence", "credits"]) if (x[k] != null && (typeof x[k] !== "string" || !x[k].trim())) fail(file, `"${k}" must be text`);
}

export function loadTunes(dir = path.join(CONTENT_DIR, "hymns", "tunes")) {
  const tunes = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(dir, f);
    const t = JSON.parse(fs.readFileSync(file, "utf8"));
    t.slug = f.replace(/\.json$/, "");
    t.file = file;
    if (!t.name) fail(file, `"name" is required`);
    checkNames(file, t.music, "music");
    checkSource(file, t);
    if (t.melody) {
      const N = loadEngine();
      if (!N.parseKey(t.key)) fail(file, `"key" must be a key like "G major" or "A minor"`);
      if (!/^\d+\/(2|4|8)$/.test(String(t.time))) fail(file, `"time" must be a time signature like 3/4 or 6/8`);
      if (!(t.tempo > 0)) fail(file, `"tempo" (crotchets a minute) is required`);
      try { t.parsed = parseMelody(t.melody, { time: t.time, pickup: t.pickup || 0 }); }
      catch (e) { fail(file, `melody: ${e.message}`); }
    }
    // A tune with "draft" is a tune page of its own (/hymns/tunes/<slug>: a tune without words, e.g. from
    // CCEH); "draft": false publishes it, which needs its melody and the public-domain test for its music.
    if (t.draft != null) {
      if (typeof t.draft !== "boolean" || typeof t.reviewed !== "boolean") fail(file, `"draft" and "reviewed" must be true or false`);
      if (!isIsoDate(t.updated)) fail(file, `"updated" must be YYYY-MM-DD`);
      if (t.alsoKnownAs != null && (!Array.isArray(t.alsoKnownAs) || t.alsoKnownAs.some((x) => typeof x !== "string" || !x.trim()))) fail(file, `"alsoKnownAs" must be a list of text`);
      // A tune page names its occasions like a hand-made hymn (lib/collections.mjs OCCASIONS), what it is when it is
      // not a hymn tune ("form": "waltz theme"), and may say more about itself ("about", paragraphs).
      if (t.occasions != null && (!Array.isArray(t.occasions) || !t.occasions.length || t.occasions.some((x) => !OCCASION_NAMES.includes(x)))) fail(file, `"occasions" must be a list of: ${OCCASION_NAMES.join(", ")}`);
      if (t.form != null && (typeof t.form !== "string" || !/^[a-z][a-z ]*$/.test(t.form))) fail(file, `"form" names what the tune is, in lower case ("waltz theme")`);
      if (t.about != null && (!Array.isArray(t.about) || t.about.some((x) => typeof x !== "string" || !x.trim()))) fail(file, `"about" must be a list of paragraphs`);
      if (!t.draft) {
        if (!t.parsed) fail(file, `a published tune page needs its melody; keep it a draft until it has one`);
        const pd = tunePublicDomainProblems(t);
        if (pd.length) fail(file, pd[0]);
      }
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
    checkNames(file, h.text, "text");
    checkSource(file, h);
    for (const k of ["alsoKnownAs", "topics"]) if (h[k] != null && (!Array.isArray(h[k]) || h[k].some((x) => typeof x !== "string" || !x.trim()))) fail(file, `"${k}" must be a list of text`);
    if (h.category != null && (typeof h.category !== "string" || !h.category.trim())) fail(file, `"category" must be text`);
    // Words set by NoteFusion to a tune of their metre (import/watts.mjs): a page of its own, kept out of hymn
    // recognition (a hummed ST ANNE should be offered the words it is known by) and out of the app's pack.
    if (h.setByMetre != null && typeof h.setByMetre !== "boolean") fail(file, `"setByMetre" must be true or false`);
    // A words book gives only the year it was printed: the words were in print by then, not first published then.
    if (h.textPublishedBy != null && typeof h.textPublishedBy !== "boolean") fail(file, `"textPublishedBy" must be true or false`);
    // One of the writers named wrote the words, and the source cannot say which: the credit line says "or".
    if (h.textOneOf != null && typeof h.textOneOf !== "boolean") fail(file, `"textOneOf" must be true or false`);
    // The seasons and occasions a hymn without a category is sung at (lib/collections.mjs OCCASIONS).
    if (h.occasions != null && (!Array.isArray(h.occasions) || h.occasions.some((x) => !OCCASION_NAMES.includes(x)))) fail(file, `"occasions" must be a list of: ${OCCASION_NAMES.join(", ")}`);
    if (!Array.isArray(h.verses) || !h.verses.length || h.verses.some((v) => !Array.isArray(v.lines) || !v.lines.length)) fail(file, `"verses" must be a list of {lines: [...]}`);
    if (!h.draft) {
      // Public domain, strictly, for everything published; a draft may still be waiting for its facts.
      const pd = publicDomainProblems({ text: h.text, music: tune.music, textPublished: h.textPublished, musicPublished: tune.musicPublished });
      if (pd.length) fail(file, pd[0]);
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
