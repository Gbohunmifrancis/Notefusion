// The Gemini API's generateContent over plain fetch (Node 22 has it; no SDK). Asks for JSON that
// matches a schema, retries a rate limit, a server error or a dropped connection with a growing
// wait (Gemini's "high demand" 503s can last a few minutes), and otherwise fails with a sentence that says what happened. The API key goes in the x-goog-api-key
// header and is never logged.

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** The post the model returns. OpenAPI-style schema, as generateContent's responseSchema takes it. */
export const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING", description: "The post title, at most 60 characters, with the target keyword in it naturally." },
    description: { type: "STRING", description: "Meta description, 120-155 characters, a plain sentence that makes a reader want to click." },
    slug: { type: "STRING", description: "lowercase-words-joined-by-hyphens" },
    tags: { type: "ARRAY", items: { type: "STRING" }, description: "1-4 lowercase-hyphenated tags" },
    faq: {
      type: "ARRAY",
      description: "4-6 questions a reader would search for, with short direct answers",
      items: { type: "OBJECT", properties: { question: { type: "STRING" }, answer: { type: "STRING" } }, required: ["question", "answer"], propertyOrdering: ["question", "answer"] },
    },
    body: { type: "STRING", description: "The article in Markdown, without the title and without the FAQ" },
  },
  required: ["title", "description", "slug", "tags", "faq", "body"],
  propertyOrdering: ["title", "description", "slug", "tags", "faq", "body"],
};

export class GeminiError extends Error {}

function defaultSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function retryDelayMs(res, attempt) {
  const h = res && res.headers && res.headers.get && res.headers.get("retry-after");
  const s = h && /^\d+$/.test(h) ? Number(h) : null;
  return Math.min(60_000, s != null ? s * 1000 : 15_000 * 2 ** (attempt - 1));
}

/**
 * One generateContent call. `contents` is the conversation ([{role, parts}]); returns
 * { data, usage, modelVersion, content } where `content` is the model's turn exactly as sent back,
 * to append when asking for a revision.
 */
export async function generateJson({ apiKey, model = DEFAULT_MODEL, system, contents, schema = DRAFT_SCHEMA, temperature = 0.7, maxOutputTokens = 16384, attempts = 5, fetchImpl = fetch, sleep = defaultSleep, log = () => {} }) {
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set.");
  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature, maxOutputTokens },
  });
  let res = null, json = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let networkError = null;
    try {
      res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body });
    } catch (e) { networkError = e; res = null; }
    const retryable = networkError || res.status === 429 || res.status >= 500;
    if (retryable && attempt < attempts) {
      const wait = retryDelayMs(res, attempt);
      log(`Gemini ${networkError ? `connection failed (${networkError.message})` : `answered ${res.status}`}; trying again in ${Math.round(wait / 1000)} s (attempt ${attempt + 1} of ${attempts}).`);
      await sleep(wait);
      continue;
    }
    if (networkError) throw new GeminiError(`Could not reach the Gemini API: ${networkError.message}`);
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) {
      const msg = json && json.error && json.error.message ? json.error.message : res.statusText;
      const hint = res.status === 400 || res.status === 404 ? ` (is GEMINI_MODEL "${model}" a current model id?)` : res.status === 401 || res.status === 403 ? " (check the GEMINI_API_KEY secret)" : res.status === 429 ? " (rate limit or quota: try again later)" : "";
      throw new GeminiError(`Gemini API error ${res.status}: ${msg}${hint}`);
    }
    break;
  }
  if (!json) throw new GeminiError("The Gemini API returned a response that is not JSON.");
  if (json.promptFeedback && json.promptFeedback.blockReason) throw new GeminiError(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
  const cand = json.candidates && json.candidates[0];
  if (!cand || !cand.content || !Array.isArray(cand.content.parts)) throw new GeminiError("Gemini returned no candidate.");
  if (cand.finishReason && cand.finishReason !== "STOP") {
    const hint = cand.finishReason === "MAX_TOKENS" ? " — raise GEMINI_MAX_OUTPUT_TOKENS (thinking tokens count against it)" : "";
    throw new GeminiError(`Gemini stopped early: ${cand.finishReason}${hint}.`);
  }
  const text = cand.content.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new GeminiError(`Gemini's answer is not the JSON that was asked for (${e.message}).`); }
  return { data, usage: json.usageMetadata || {}, modelVersion: json.modelVersion || model, content: { role: "model", parts: cand.content.parts } };
}

/** A one-line account of a call's tokens, for the job log and the pull request. */
export function usageLine(u) {
  const n = (k) => (Number.isFinite(u[k]) ? u[k] : 0);
  return `prompt ${n("promptTokenCount")} (cached ${n("cachedContentTokenCount")}), output ${n("candidatesTokenCount")}, thinking ${n("thoughtsTokenCount")}, total ${n("totalTokenCount")}`;
}
