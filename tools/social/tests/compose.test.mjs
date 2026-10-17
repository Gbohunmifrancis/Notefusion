// Writing the post: Gemini first, one revision when it fails the checks, the template when Gemini is not
// there or still wrong. A fake fetch stands in for Gemini.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { writePost, templatePost, storyPrompt, systemPrompt } from "../lib/compose.mjs";
import { validatePost } from "../lib/validate.mjs";
import { generate, DEFAULT_MODEL } from "../lib/gemini.mjs";

const BACKLOG = JSON.parse(fs.readFileSync(new URL("../backlog.json", import.meta.url), "utf8")).items;
const STORY = { id: "pr:105", kind: "pr", prs: [105], title: "Learn my part, Hum to find a hymn", facts: "Learn my part, Hum to find a hymn\n\nLoop a few bars and slow them to 50% or 75%." };
const GOOD = "Most altos learn their part by standing next to a stronger alto.\n\nLearn my part plays your line loud and the others soft, and slows it to 75%.\n\n#buildinpublic #choir";

function gemini(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), key: init.headers["x-goog-api-key"] });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    const { status = 200, text, headers = {} } = a;
    const body = status === 200
      ? { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: JSON.stringify({ text }) }] }, finishReason: "STOP" }], modelVersion: "m" }
      : { error: { message: "busy" } };
    return { ok: status === 200, status, statusText: "", headers: new Headers(headers), text: async () => JSON.stringify(body) };
  };
  return { calls, fetchImpl };
}
const noSleep = async () => {};

test("every backlog fallback passes the checks on its own", () => {
  for (const b of BACKLOG) {
    const facts = `${b.title}\n${b.angle}\n${b.facts.join("\n")}`;
    const v = validatePost(b.fallback, { facts });
    assert.equal(v.ok, true, `${b.id}: ${v.errors.join("; ")}`);
  }
});

test("the template turns a PR title into a plain post, cut at a word when long", () => {
  assert.equal(templatePost(STORY), "Shipped in NoteFusion: Learn my part, Hum to find a hymn.\n\n#buildinpublic");
  const long = { ...STORY, title: "A very long title ".repeat(20).trim(), facts: "x" };
  const t = templatePost(long);
  assert.match(t, /…\n\n#buildinpublic$/);
  assert.ok(validatePost(t).ok);
  assert.equal(templatePost({ ...STORY, title: "CCEH: 20 more hymn tunes", facts: "CCEH: 20 more hymn tunes" }), "Shipped in NoteFusion: 20 more hymn tunes.\n\n#buildinpublic");
  assert.equal(templatePost({ ...STORY, title: "Set Gemini__ApiKey", facts: "" }), null, "a title that leaks is not posted");
});

test("no API key: the template, and no request", async () => {
  const { calls, fetchImpl } = gemini([]);
  const out = await writePost(STORY, { apiKey: "", fetchImpl, sceneAlt: "a phone" });
  assert.equal(out.source, "template");
  assert.equal(calls.length, 0);
});

test("a good draft is used as written", async () => {
  const { calls, fetchImpl } = gemini([{ text: GOOD }]);
  const out = await writePost(STORY, { apiKey: "k", fetchImpl, sceneAlt: "Learn my part on a phone" });
  assert.equal(out.source, "gemini");
  assert.equal(out.text, GOOD);
  assert.equal(calls[0].key, "k");
  assert.match(calls[0].url, new RegExp(`models/${DEFAULT_MODEL}:generateContent$`));
  assert.match(calls[0].body.systemInstruction.parts[0].text, /Example posts/);
  assert.match(calls[0].body.contents[0].parts[0].text, /Learn my part on a phone/);
  assert.match(calls[0].body.contents[0].parts[0].text, /No links at all/);
});

test("a draft that fails the checks gets one revision, with the reasons", async () => {
  const { calls, fetchImpl } = gemini([{ text: "A revolutionary update used by 5,000 choirs! #a #b #c" }, { text: GOOD }]);
  const out = await writePost(STORY, { apiKey: "k", fetchImpl, sceneAlt: "x" });
  assert.equal(out.source, "gemini");
  assert.equal(out.attempts.length, 2);
  const followUp = calls[1].body.contents;
  assert.equal(followUp.length, 3);
  assert.equal(followUp[1].role, "model");
  assert.match(followUp[2].parts[0].text, /3 hashtags[\s\S]*hype words: revolutionary[\s\S]*numbers the story does not: 5000/);
});

test("still failing after the revision: the template", async () => {
  const bad = { text: "x".repeat(300) };
  const { fetchImpl } = gemini([bad, { ...bad }]);
  const out = await writePost(STORY, { apiKey: "k", fetchImpl, sceneAlt: "x" });
  assert.equal(out.source, "template");
  assert.equal(out.attempts.length, 2);
});

test("rate limits and server errors are retried, then the fallback model; a refused key is not", async () => {
  const slept = [];
  const { calls, fetchImpl } = gemini([{ status: 429, headers: { "retry-after": "2" } }, { status: 503 }, { status: 500 }, { text: GOOD }]);
  const out = await writePost(STORY, { apiKey: "k", model: "gemini-test", fetchImpl, sleep: async (ms) => slept.push(ms), sceneAlt: "x" });
  assert.equal(out.source, "gemini");
  assert.deepEqual(calls.map((c) => c.url.match(/models\/(.+):/)[1]), ["gemini-test", "gemini-test", "gemini-test", "gemini-flash-latest"]);
  assert.deepEqual(slept, [2000, 15000]);

  const refused = gemini([{ status: 403 }]);
  const out2 = await writePost(STORY, { apiKey: "bad", fetchImpl: refused.fetchImpl, sleep: noSleep, sceneAlt: "x" });
  assert.equal(out2.source, "template");
  assert.equal(refused.calls.length, 1);
});

test("a dropped connection counts as retryable", async () => {
  const { calls, fetchImpl } = gemini([new TypeError("fetch failed"), { text: GOOD }]);
  const out = await generate({ models: ["m1"], apiKey: "k", system: "s", contents: [], schema: {}, fetchImpl, sleep: noSleep });
  assert.equal(out.value.text, GOOD);
  assert.equal(calls.length, 2);
});

test("the prompt offers a link only when links are allowed and the story has one", () => {
  const story = { ...STORY, link: "https://notefusion.studio/hymns/identify" };
  assert.match(storyPrompt(story, { sceneAlt: "x", allowLink: true }), /may end with this link .*hymns\/identify/);
  assert.match(storyPrompt(story, { sceneAlt: "x", allowLink: false }), /No links at all/);
  assert.match(systemPrompt(), /never invent numbers/);
});
