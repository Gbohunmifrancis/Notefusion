// Gemini generateContent over REST, as the API's GeminiClient does it: the key in x-goog-api-key, JSON out
// against a schema. A rate limit, a server error or no answer is tried again (Retry-After wins, capped), then
// the next model in the list; a refused key, a blocked prompt or a reply cut short is not retried anywhere.
export const DEFAULT_MODEL = "gemini-3.8-flash"; // the API's Blog default (src/NoteFusion.Application/Blog/BlogSettings.cs)
export const FALLBACK_MODELS = ["gemini-flash-latest"];
const BASE = "https://generativelanguage.googleapis.com/v1beta/";

export class GeminiError extends Error {
  constructor(message, { retryable = false, retryAfterMs = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfter(headers) {
  const v = headers?.get?.("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/** One request to one model. Resolves the parsed JSON answer. */
export async function generateOnce({ apiKey, model, system, contents, schema, temperature = 0.8, maxOutputTokens = 4096, fetchImpl = fetch, timeoutMs = 90_000 }) {
  let res;
  try {
    res = await fetchImpl(`${BASE}models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature, maxOutputTokens },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new GeminiError(`Gemini did not answer: ${e.name}`, { retryable: true });
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* below */ }
  if (!res.ok) {
    const msg = String(json?.error?.message || res.statusText || "").slice(0, 200);
    const retryable = res.status === 429 || res.status >= 500;
    throw new GeminiError(`Gemini (${model}) answered ${res.status}: ${msg}`, { retryable, retryAfterMs: retryAfter(res.headers) });
  }
  if (!json) throw new GeminiError("Gemini returned a response that is not JSON.");
  if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
  const cand = json.candidates?.[0];
  if (!cand?.content?.parts) throw new GeminiError("Gemini returned no candidate.");
  if (cand.finishReason && cand.finishReason !== "STOP") throw new GeminiError(`Gemini stopped early: ${cand.finishReason}.`);
  const answer = cand.content.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
  try {
    return { value: JSON.parse(answer), model: json.modelVersion || model, turn: { role: "model", parts: [{ text: answer }] } };
  } catch {
    throw new GeminiError("Gemini's answer is not the JSON asked for.");
  }
}

/**
 * The request against each model in turn: up to `tries` attempts on a retryable failure (waits 5, 15, 30 s
 * unless Retry-After says otherwise, at most 60 s), then the next model.
 */
export async function generate({ models, tries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {}, ...req }) {
  const waits = [5_000, 15_000, 30_000];
  let last;
  for (const model of models) {
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return await generateOnce({ ...req, model });
      } catch (e) {
        last = e;
        log(`${model} attempt ${attempt}: ${e.message}`);
        if (!e.retryable) throw e;
        if (attempt < tries) await sleep(Math.min(60_000, e.retryAfterMs ?? waits[attempt - 1] ?? 30_000));
      }
    }
  }
  throw last;
}
