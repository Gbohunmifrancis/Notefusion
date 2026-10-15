#!/usr/bin/env node
// Drafts the next blog post from content/blog/topics.yml with the Gemini API, checks it, and writes
// content/blog/<slug>.md. The blog-draft workflow runs it twice a week and opens a pull request;
// nothing is published until the founder merges.
//
//   GEMINI_API_KEY=… node tools/blog/draft.mjs [--topic SLUG] [--skip a,b] [--summary FILE] [--pr-body FILE]
//
// Environment: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-3.8-flash),
// GEMINI_MAX_OUTPUT_TOKENS (default 16384; thinking tokens count against it).
// --response FILE uses a saved API response instead of calling the API (for tests and dry runs).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { CONTENT_DIR, SITE_DIR } from "./lib/site.mjs";
import { loadAll, stringifyFrontMatter } from "./lib/content.mjs";
import { prepareHymn } from "./lib/render-hymns.mjs";
import { checkDraft } from "./lib/quality.mjs";
import { SYSTEM, buildUserPrompt, revisionPrompt } from "./lib/prompt.mjs";
import { generateJson, usageLine, DEFAULT_MODEL, GeminiError } from "./lib/gemini.mjs";
import { resolveSitePath } from "./check.mjs";
import { countWords } from "./lib/util.mjs";

export const TOPICS_FILE = path.join(CONTENT_DIR, "blog", "topics.yml");

export function loadTopics(file = TOPICS_FILE) {
  const doc = YAML.parse(fs.readFileSync(file, "utf8"));
  const topics = doc && Array.isArray(doc.topics) ? doc.topics : null;
  if (!topics) throw new Error("topics.yml must have a `topics:` list");
  const seen = new Set();
  topics.forEach((t, i) => {
    for (const k of ["slug", "keyword", "intent", "angle"]) if (!t[k] || typeof t[k] !== "string") throw new Error(`topics.yml, topic ${i + 1}: "${k}" is required`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.slug)) throw new Error(`topics.yml: "${t.slug}" is not a lowercase-hyphenated slug`);
    if (seen.has(t.slug)) throw new Error(`topics.yml: "${t.slug}" is listed twice`);
    seen.add(t.slug);
    if (t.links != null && (!Array.isArray(t.links) || t.links.some((l) => typeof l !== "string" || !l.startsWith("/")))) throw new Error(`topics.yml, ${t.slug}: "links" must be a list of site paths`);
  });
  return topics;
}

/** The first topic with no post (published or draft) and no open draft branch. */
export function pickTopic(topics, { existingSlugs, skip = [], only = null }) {
  if (only) {
    const t = topics.find((x) => x.slug === only);
    if (!t) throw new Error(`No topic "${only}" in topics.yml`);
    if (existingSlugs.has(only)) throw new Error(`content/blog/${only}.md already exists`);
    return t;
  }
  return topics.find((t) => !existingSlugs.has(t.slug) && !skip.includes(t.slug) && !t.skip) || null;
}

/** The model's JSON as a post: front matter + body, ready for content/blog/<slug>.md. */
export function toPost(data, { topic, date, model }) {
  const front = {
    title: String(data.title).trim(),
    description: String(data.description).trim(),
    date,
    author: "francis",
    tags: (data.tags || []).map((t) => String(t).trim().toLowerCase()),
    keyword: topic.keyword,
    faq: (data.faq || []).map((f) => ({ q: String(f.question).trim(), a: String(f.answer).trim() })),
    draft: false,
    drafted_with: model,
  };
  return { front, body: String(data.body).trim() + "\n", markdown: stringifyFrontMatter(front) + String(data.body).trim() + "\n" };
}

function draftFields(data, slug) {
  return { title: data.title, description: data.description, slug, tags: data.tags, faq: (data.faq || []).map((f) => ({ q: f.question, a: f.answer })), body: data.body };
}

function parseArgs(argv) {
  const out = { skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === "--topic") { out.topic = v; i++; }
    else if (a === "--skip") { out.skip = String(v || "").split(",").map((s) => s.trim()).filter(Boolean); i++; }
    else if (a === "--summary") { out.summary = v; i++; }
    else if (a === "--pr-body") { out.prBody = v; i++; }
    else if (a === "--response") { out.response = v; i++; }
    else if (a === "--date") { out.date = v; i++; }
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

/** The pull request's description: what was targeted, what it cost, what to check. */
export function prBody({ topic, post, model, calls, words, hymnsUsed, previewNote = true }) {
  const totals = calls.reduce((t, c) => {
    for (const k of ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"]) t[k] = (t[k] || 0) + (c.usage[k] || 0);
    return t;
  }, {});
  const rows = calls.map((c, i) => `| ${i === 0 ? "Draft" : "Revision"} | ${c.usage.promptTokenCount || 0} | ${c.usage.candidatesTokenCount || 0} | ${c.usage.thoughtsTokenCount || 0} | ${c.usage.totalTokenCount || 0} |`);
  return `Automatically drafted blog post. **Nothing is published until this is merged** — merging deploys it to notefusion.studio/blog/${topic.slug}.

**Target keyword:** ${topic.keyword}
**Intent:** ${topic.intent}
**Angle:** ${topic.angle}
**File:** \`content/blog/${topic.slug}.md\` (${words} words) — edit it on this branch, then run \`node tools/blog/build.mjs\` and commit the result. To drop the topic, close this PR and delete the branch (and mark the topic \`skip: true\` in topics.yml).
${hymnsUsed.length ? `**Hymns cited:** ${hymnsUsed.map((h) => `/hymns/${h}`).join(", ")}\n` : ""}
### Review checklist
- [ ] Every fact is correct (music theory, history, how NoteFusion works) — nothing invented
- [ ] It sounds like you: first person where natural, Nigerian / West African choir context
- [ ] The solfa examples make sense where they are used (they are rendered by NoteFusion's engine from the hymn data)
- [ ] Title (${post.front.title.length} chars) and description (${post.front.description.length} chars) read well in a search result
- [ ] The FAQ answers are right and worth having
- [ ] The links go where the text says

### Model and cost
Drafted with \`${model}\` via the Gemini API. Tokens used (see Google's Gemini API pricing page for the current rate):

| Call | Prompt | Output | Thinking | Total |
|---|---|---|---|---|
${rows.join("\n")}
| **All calls** | ${totals.promptTokenCount || 0} | ${totals.candidatesTokenCount || 0} | ${totals.thoughtsTokenCount || 0} | ${totals.totalTokenCount || 0} |
${previewNote ? `
### Preview
Pull requests opened by this workflow do not get a Vercel preview from the deploy workflow (it only deploys \`main\`). If Vercel's GitHub integration is connected, its preview link appears in the checks below. Otherwise preview locally: check out this branch and run \`python3 -m http.server -d web-site 8000\`, then open http://localhost:8000/blog/${topic.slug}/.
` : ""}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !args.response) {
    console.error("GEMINI_API_KEY is not set. Add it as a repository secret (Settings → Secrets and variables → Actions → New repository secret, name GEMINI_API_KEY) — see docs/BLOG.md.");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const maxOutputTokens = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 16384;
  const date = args.date || new Date().toISOString().slice(0, 10);

  const { posts, hymns } = loadAll({ includeDrafts: false });
  hymns.forEach(prepareHymn);
  const hymnsBySlug = new Map(hymns.map((h) => [h.slug, h]));
  const allPostSlugs = new Set(fs.readdirSync(path.join(CONTENT_DIR, "blog")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")));
  const topics = loadTopics();
  const topic = pickTopic(topics, { existingSlugs: allPostSlugs, skip: args.skip, only: args.topic });
  if (!topic) { console.log("Every topic in content/blog/topics.yml has a post or an open draft. Add topics to keep drafting."); process.exit(0); }
  console.log(`Topic: ${topic.slug} — "${topic.keyword}" (model ${model})`);
  // A required link to a post that is not published yet (an earlier topic still in review) is left out for now.
  const requiredLinks = (topic.links || []).filter((l) => {
    const ok = !!resolveSitePath(SITE_DIR, l);
    if (!ok) console.log(`(Not requiring ${l}: that page is not on the site yet.)`);
    return ok;
  });

  const tags = [...new Set(posts.flatMap((p) => p.tags))].sort();
  const user = buildUserPrompt({ topic: { ...topic, links: requiredLinks }, posts, hymns, tags });
  const ctx = { posts, hymnsBySlug, requiredLinks, linkExists: (h) => !!resolveSitePath(SITE_DIR, h) };
  const contents = [{ role: "user", parts: [{ text: user }] }];
  const calls = [];
  const call = async () => {
    if (args.response) {
      const saved = JSON.parse(fs.readFileSync(args.response, "utf8"));
      const r = saved[calls.length] || saved[saved.length - 1];
      calls.push({ usage: r.usage || {} });
      return { data: r.data, usage: r.usage || {}, content: { role: "model", parts: [{ text: JSON.stringify(r.data) }] } };
    }
    const r = await generateJson({ apiKey, model, system: SYSTEM, contents, maxOutputTokens, log: (m) => console.log(m) });
    calls.push({ usage: r.usage });
    console.log(`Gemini usage (${calls.length === 1 ? "draft" : "revision"}): ${usageLine(r.usage)}`);
    return r;
  };

  let r = await call();
  let problems = checkDraft(draftFields(r.data, topic.slug), ctx);
  if (problems.length) {
    console.log(`The draft needs fixing (${problems.length}):\n  - ${problems.join("\n  - ")}\nAsking for one revision.`);
    contents.push(r.content, { role: "user", parts: [{ text: revisionPrompt(problems) }] });
    r = await call();
    problems = checkDraft(draftFields(r.data, topic.slug), ctx);
  }
  if (problems.length) {
    console.error(`The draft still fails the quality checks, so no pull request is opened:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  if (r.data.slug && r.data.slug !== topic.slug) console.log(`(The model suggested the slug "${r.data.slug}"; using the topic's "${topic.slug}".)`);

  const post = toPost(r.data, { topic, date, model });
  const file = path.join(CONTENT_DIR, "blog", `${topic.slug}.md`);
  fs.writeFileSync(file, post.markdown);
  const words = countWords(post.body.replace(/```[\s\S]*?```/g, " "));
  const hymnsUsed = [...new Set([...post.body.matchAll(/^hymn:\s*([a-z0-9-]+)/gm)].map((m) => m[1]))];
  console.log(`Wrote ${path.relative(process.cwd(), file)}: "${post.front.title}" (${words} words, ${calls.length} call${calls.length === 1 ? "" : "s"}).`);
  const summary = { slug: topic.slug, title: post.front.title, keyword: topic.keyword, model, file: path.relative(process.cwd(), file), words, calls: calls.map((c) => c.usage) };
  if (args.summary) fs.writeFileSync(args.summary, JSON.stringify(summary, null, 2));
  if (args.prBody) fs.writeFileSync(args.prBody, prBody({ topic, post, model, calls, words, hymnsUsed }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e instanceof GeminiError ? `Drafting failed: ${e.message}` : `Drafting failed: ${e.stack || e.message}`);
    process.exit(1);
  });
}
