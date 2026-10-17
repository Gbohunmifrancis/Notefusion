// The post's words: Gemini writes it in Francis's voice (voice.md), the validator checks it, one revision is
// asked for if it fails, and a plain template from the story stands in when Gemini is not set up, not
// answering, or still wrong. A post that fails every check is not posted at all.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePost, MAX_LENGTH } from "./validate.mjs";
import { weightedLength } from "./xtext.mjs";
import { generate, DEFAULT_MODEL, FALLBACK_MODELS } from "./gemini.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VOICE = fs.readFileSync(path.join(HERE, "../voice.md"), "utf8");
const SCHEMA = { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] };

export function systemPrompt() {
  return [
    "You write posts for X (Twitter) for Francis, the founder of NoteFusion, in his own first-person voice.",
    "NoteFusion turns a sung, hummed or played tune into tonic solfa (movable doh) and staff notation, for choirs and church musicians.",
    "Follow the style guide and match the tone of its examples. Use only facts given in the story; never invent numbers, users, customers, quotes, results or plans.",
    "Answer with JSON: {\"text\": \"the post\"}.",
    "",
    VOICE,
  ].join("\n");
}

export function storyPrompt(story, { sceneAlt, allowLink }) {
  const link = allowLink && story.link ? story.link : null;
  return [
    `Write one post about this ${story.kind === "pr" ? "change that just shipped" : story.kind === "library" ? "batch of additions to the hymn library" : "part of the building journey"}.`,
    "",
    `Story: ${story.title}`,
    story.angle ? `Angle: ${story.angle}` : "",
    "",
    "Facts (the only facts you may use; leave out anything technical a choir director would not care about):",
    story.facts,
    "",
    `The post carries a screenshot: ${sceneAlt}`,
    "",
    "Rules:",
    `- At most ${MAX_LENGTH} characters, as X counts them (a link counts 23). Shorter is better.`,
    "- The first line is the hook: a concrete problem, moment or result, not an announcement.",
    "- 0 to 2 hashtags at the end, for example #buildinpublic and one topical tag. At most one emoji. No @mentions.",
    "- No hype words, no em-dash chains, no questions to farm replies, no thread markers.",
    link ? `- You may end with this link if it helps the reader: ${link}. No other link.` : "- No links at all, not even the website's name as a domain.",
  ].filter((l) => l !== "").join("\n");
}

const clean = (s) => String(s || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** A plain post from the story alone: the fallback. Null when even this cannot be made valid. */
export function templatePost(story, { allowLink = false } = {}) {
  const opts = { allowLink, facts: story.facts };
  const tags = "#buildinpublic";
  const candidates = [];
  if (story.fallback) candidates.push(story.fallback);
  if (story.kind === "library") candidates.push("More hymn tunes just landed in the NoteFusion library, each with its own page in tonic solfa and staff notation.\n\n" + tags + " #tonicsolfa");
  const title = String(story.title || "").replace(/^\s*[A-Z]{2,}:\s*/, "").replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.;:,]+$/, "");
  if (title) {
    const head = title.includes(":") ? "Shipped in NoteFusion. " : "Shipped in NoteFusion: "; // never two colons in a row
    const fits = (s) => weightedLength(`${head}${s}.\n\n${tags}`) <= MAX_LENGTH;
    let t = title;
    if (!fits(t)) {
      const words = t.split(" ");
      while (words.length && !fits(words.join(" ") + "…")) words.pop();
      t = words.length ? words.join(" ").replace(/[,;:]$/, "") + "…" : "";
    }
    if (t) candidates.push(`${head}${t}${t.endsWith("…") ? "" : "."}\n\n${tags}`);
  }
  for (const c of candidates) if (validatePost(c, opts).ok) return clean(c);
  return null;
}

/**
 * Writes the post. Resolves { text, source: "gemini"|"template", model?, attempts: [{ text, errors }] }, or
 * { text: null } when nothing valid could be written.
 */
export async function writePost(story, { apiKey, model, sceneAlt, allowLink = false, fetchImpl = fetch, sleep, log = () => {} }) {
  const opts = { allowLink, facts: story.facts };
  const attempts = [];
  if (apiKey) {
    const models = [...new Set([model || DEFAULT_MODEL, ...FALLBACK_MODELS])];
    const contents = [{ role: "user", parts: [{ text: storyPrompt(story, { sceneAlt, allowLink }) }] }];
    try {
      for (let round = 1; round <= 2; round++) {
        const out = await generate({ apiKey, models, system: systemPrompt(), contents, schema: SCHEMA, fetchImpl, sleep, log });
        const text = clean(out.value?.text);
        const v = validatePost(text, opts);
        attempts.push({ text, errors: v.errors, model: out.model });
        if (v.ok) return { text, source: "gemini", model: out.model, attempts };
        log(`Draft ${round} failed the checks: ${v.errors.join(" ")}`);
        contents.push(out.turn, { role: "user", parts: [{ text: `That post fails these checks:\n- ${v.errors.join("\n- ")}\nRewrite it so it passes every rule. Same JSON shape.` }] });
      }
    } catch (e) {
      log(`Gemini could not write the post: ${e.message}`);
      attempts.push({ text: null, errors: [e.message] });
    }
  } else {
    log("No GEMINI_API_KEY: using the template.");
  }
  const text = templatePost(story, { allowLink });
  return { text, source: text ? "template" : "none", attempts };
}
