// The drafter without the network: quality checks, topic choice, the prompt, and the Gemini call
// against a fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAll, parseFrontMatter } from "../lib/content.mjs";
import { prepareHymn } from "../lib/render-hymns.mjs";
import { checkDraft } from "../lib/quality.mjs";
import { SYSTEM, buildUserPrompt, catalogue } from "../lib/prompt.mjs";
import { generateJson, usageLine, GeminiError, DRAFT_SCHEMA, DEFAULT_MODEL } from "../lib/gemini.mjs";
import { loadTopics, pickTopic, toPost, prBody } from "../draft.mjs";
import { resolveSitePath } from "../check.mjs";
import { SITE_DIR } from "../lib/site.mjs";

const { posts, hymns } = loadAll();
hymns.forEach(prepareHymn);
const hymnsBySlug = new Map(hymns.map((h) => [h.slug, h]));
const linkExists = (h) => !!resolveSitePath(SITE_DIR, h);
const source = posts.find((p) => p.slug === "how-to-find-the-doh-of-a-song");
// A draft that passes: an existing post's text under a new slug and title.
const good = { title: "Finding the Doh: A Practical Guide for Choirs", description: source.description, slug: "finding-the-doh-guide", tags: ["tonic-solfa"], faq: source.faq, body: source.body };
const ctx = { posts, hymnsBySlug, requiredLinks: ["/blog/how-to-read-tonic-solfa"], linkExists };

test("a well-formed draft passes the quality checks", () => {
  assert.deepEqual(checkDraft(good, ctx), []);
});

test("the quality checks catch what a review should not have to", () => {
  const problems = (patch) => checkDraft({ ...good, ...patch }, ctx).join("\n");
  assert.match(problems({ title: "x".repeat(61) }), /title is 61 characters/);
  assert.match(problems({ description: "Too short." }), /description is 10 characters/);
  assert.match(problems({ slug: "how-to-read-tonic-solfa" }), /already exists/);
  assert.match(problems({ title: posts[0].title }), /already exists/);
  assert.match(problems({ body: "## One\n\nShort." }), /The body is \d+ words/);
  assert.match(problems({ body: "# A second h1\n\n" + good.body }), /top-level heading/);
  assert.match(problems({ body: good.body + "\n\n## Frequently asked questions\n\nNo." }), /faq field/);
  assert.match(problems({ body: good.body + "\n\nAs an AI language model I think solfa is great." }), /stock phrase/);
  assert.match(problems({ body: good.body + "\n\nTODO: add an example." }), /placeholder/);
  assert.match(problems({ body: good.body + "\n\nAbout 80% of choirs read solfa." }), /percentage/);
  assert.match(problems({ body: good.body + "\n\nStudies show that singers learn faster." }), /studies, research/);
  assert.match(problems({ body: good.body + "\n\n“This app changed our choir completely overnight,” said a director." }), /quotation attributed/);
  assert.match(problems({ body: good.body + "\n\nThe tune goes s, d m d m r d l, s, here." }), /Solfa written by hand/);
  assert.match(problems({ body: good.body.replace(/\(\/blog\/how-to-read-tonic-solfa\)/g, "(/hymns)") }), /Link to \/blog\/how-to-read-tonic-solfa/);
  assert.match(problems({ body: good.body.replace(/\]\(\/app\)/g, "](/hymns)") }), /Link to \/app/);
  assert.match(problems({ body: good.body + "\n\nSee [this](https://example.com)." }), /external link/);
  assert.match(problems({ body: good.body + "\n\nSee [this](/blog/not-a-post)." }), /does not exist/);
  assert.match(problems({ body: good.body + "\n\n```solfa\nhymn: not-a-hymn\n```" }), /does not build/);
  assert.match(problems({ faq: [{ q: "No question mark", a: "x" }] }), /FAQ has 1 questions/);
  // The bare scale is allowed in prose; it is not a hand-written example.
  assert.deepEqual(checkDraft({ ...good, body: good.body + "\n\nSing d r m f s l t d' slowly." }, ctx), []);
});

test("topics.yml is valid, has about forty topics, and its links point at the site or at other topics", () => {
  const topics = loadTopics();
  assert.ok(topics.length >= 35, `${topics.length} topics`);
  const slugs = new Set(topics.map((t) => t.slug));
  for (const t of topics) for (const l of t.links || []) {
    const future = l.startsWith("/blog/") && slugs.has(l.slice(6));
    assert.ok(linkExists(l) || future, `${t.slug}: ${l}`);
  }
});

test("the next topic is the first with no post and no open draft branch", () => {
  const topics = [{ slug: "a" }, { slug: "b" }, { slug: "c", skip: true }, { slug: "d" }];
  assert.equal(pickTopic(topics, { existingSlugs: new Set(["a"]) }).slug, "b");
  assert.equal(pickTopic(topics, { existingSlugs: new Set(["a"]), skip: ["b"] }).slug, "d");
  assert.equal(pickTopic(topics, { existingSlugs: new Set(["a", "b", "d"]) }), null);
  assert.equal(pickTopic(topics, { existingSlugs: new Set(), only: "c" }).slug, "c");
  assert.throws(() => pickTopic(topics, { existingSlugs: new Set(["a"]), only: "a" }), /already exists/);
});

test("the prompt carries the guardrails, the engine's own solfa, and the pages to link", () => {
  assert.match(SYSTEM, /Never invent facts/);
  assert.match(SYSTEM, /Never write solfa sequences yourself/);
  assert.match(SYSTEM, /la-based/);
  const cat = catalogue(hymns);
  assert.ok(cat.includes("| s, - | d - - - m d | m - - - r - | d - - - l, - | s, - - - s, - |"), "Amazing Grace's first line, as the engine writes it");
  const topic = loadTopics()[0];
  const user = buildUserPrompt({ topic, posts, hymns, tags: ["tonic-solfa"] });
  assert.ok(user.includes(topic.keyword));
  assert.ok(user.includes("- /hymns/amazing-grace — Amazing Grace in Tonic Solfa"));
  assert.ok(user.includes("- /blog/how-to-read-tonic-solfa — "));
});

test("the model's JSON becomes a post with valid front matter", () => {
  const topic = { slug: "x", keyword: "kw" };
  const post = toPost({ title: " T ", description: "D", tags: ["Tonic-Solfa"], faq: [{ question: "Q?", answer: "A." }], body: "Body" }, { topic, date: "2026-10-19", model: DEFAULT_MODEL });
  const { data, body } = parseFrontMatter(post.markdown);
  assert.equal(data.title, "T");
  assert.equal(data.author, "francis");
  assert.equal(data.date, "2026-10-19");
  assert.deepEqual(data.tags, ["tonic-solfa"]);
  assert.deepEqual(data.faq, [{ q: "Q?", a: "A." }]);
  assert.equal(data.draft, false);
  assert.equal(body, "Body\n");
});

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: "", headers: { get: (k) => (r.headers || {})[k.toLowerCase()] || null }, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}
const OK_BODY = { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify({ title: "T" }) }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 3000, thoughtsTokenCount: 800, totalTokenCount: 5000 }, modelVersion: "gemini-3.8-flash" };

test("Gemini: a JSON request with the schema, the key in a header, the answer parsed", async () => {
  const f = fakeFetch([{ status: 200, body: OK_BODY }]);
  const r = await generateJson({ apiKey: "k", system: "s", contents: [{ role: "user", parts: [{ text: "u" }] }], fetchImpl: f });
  assert.deepEqual(r.data, { title: "T" });
  assert.equal(r.usage.totalTokenCount, 5000);
  const { url, init } = f.calls[0];
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  assert.equal(init.headers["x-goog-api-key"], "k");
  assert.ok(!url.includes("key="), "the key is never in the URL");
  const sent = JSON.parse(init.body);
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(sent.generationConfig.responseSchema, DRAFT_SCHEMA);
  assert.equal(sent.generationConfig.temperature, 0.7);
  assert.equal(sent.systemInstruction.parts[0].text, "s");
  assert.equal(usageLine(r.usage), "prompt 1200 (cached 0), output 3000, thinking 800, total 5000");
});

test("Gemini: retries 429, 5xx or a dropped connection with a growing wait, then a clear error", async () => {
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  const ok = await generateJson({ apiKey: "k", system: "s", contents: [], fetchImpl: fakeFetch([{ status: 429, headers: { "retry-after": "3" }, body: {} }, { status: 200, body: OK_BODY }]), sleep });
  assert.deepEqual(ok.data, { title: "T" });
  assert.deepEqual(waits, [3000]);
  waits.length = 0;
  const busy = fakeFetch([{ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: { error: { message: "overloaded" } } }]);
  await assert.rejects(generateJson({ apiKey: "k", system: "s", contents: [], fetchImpl: busy, sleep }), /Gemini API error 503: overloaded/);
  assert.equal(busy.calls.length, 5);
  assert.deepEqual(waits, [15_000, 30_000, 60_000, 60_000]);
  const recovers = await generateJson({ apiKey: "k", system: "s", contents: [], fetchImpl: fakeFetch([{ status: 503, body: {} }, { status: 503, body: {} }, { status: 200, body: OK_BODY }]), sleep });
  assert.deepEqual(recovers.data, { title: "T" });
  await assert.rejects(generateJson({ apiKey: "k", system: "s", contents: [], attempts: 2, fetchImpl: fakeFetch([new Error("ECONNRESET"), new Error("ECONNRESET")]), sleep }), /Could not reach the Gemini API/);
  const f = fakeFetch([{ status: 400, body: { error: { message: "bad model" } } }]);
  await assert.rejects(generateJson({ apiKey: "k", system: "s", contents: [], fetchImpl: f, sleep }), /400: bad model .*GEMINI_MODEL/);
  assert.equal(f.calls.length, 1, "a 400 is not retried");
});

test("Gemini: a cut-off, blocked or non-JSON answer is an error, not a post", async () => {
  const run = (body) => generateJson({ apiKey: "k", system: "s", contents: [], fetchImpl: fakeFetch([{ status: 200, body }]) });
  await assert.rejects(run({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }), /MAX_TOKENS.*GEMINI_MAX_OUTPUT_TOKENS/);
  await assert.rejects(run({ promptFeedback: { blockReason: "SAFETY" } }), /blocked the prompt: SAFETY/);
  await assert.rejects(run({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "not json" }] } }] }), GeminiError);
  await assert.rejects(generateJson({ apiKey: "", system: "s", contents: [] }), /GEMINI_API_KEY is not set/);
});

test("the pull request body shows the keyword, the checklist and the token usage", () => {
  const topic = loadTopics()[0];
  const body = prBody({ topic, post: { front: { title: "A title", description: "A description" } }, model: "gemini-3.8-flash", words: 1500, hymnsUsed: ["amazing-grace"],
    calls: [{ usage: { promptTokenCount: 100, candidatesTokenCount: 200, thoughtsTokenCount: 50, totalTokenCount: 350 } }, { usage: { promptTokenCount: 300, candidatesTokenCount: 200, thoughtsTokenCount: 0, totalTokenCount: 500 } }] });
  assert.ok(body.includes(`**Target keyword:** ${topic.keyword}`));
  assert.match(body, /- \[ \] Every fact is correct/);
  assert.match(body, /\| \*\*All calls\*\* \| 400 \| 400 \| 50 \| 850 \|/);
  assert.match(body, /Nothing is published until this is merged/);
});
