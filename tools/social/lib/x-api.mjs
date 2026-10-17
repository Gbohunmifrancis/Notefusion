// The three X API v2 calls a post needs, signed with OAuth 1.0a user context (lib/oauth1.mjs):
//   POST /2/media/upload    the screenshot, one multipart request (media + media_category=tweet_image)
//   POST /2/media/metadata  its alt text
//   POST /2/tweets          the post, with the media id
// https://docs.x.com/x-api/media/upload-media · https://docs.x.com/x-api/posts/create-post
//
// Uploading is invisible until a post uses it, so an upload is tried twice. Creating a post is NEVER retried:
// a request that may have reached X (a timeout, a dropped connection, a 5xx) is reported as `unknown`, and the
// caller records the story as spent so a later run cannot post it twice.
import { authorizationHeader } from "./oauth1.mjs";

export const X_API = "https://api.x.com";

export class XError extends Error {
  /** kind: rate_limited | duplicate | auth | rejected | unknown */
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** When the limit lifts, from x-rate-limit-reset (or the 24-hour user limit's reset), as an ISO date. */
export function rateLimitReset(headers) {
  const get = (h) => (headers && typeof headers.get === "function" ? headers.get(h) : headers?.[h]);
  const secs = [get("x-user-limit-24hour-reset"), get("x-app-limit-24hour-reset"), get("x-rate-limit-reset")]
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  return secs.length ? new Date(Math.max(...secs) * 1000).toISOString() : null;
}

function describe(body) {
  if (!body) return "";
  const e = body.errors?.[0] || body;
  return [e.title, e.detail || e.message].filter(Boolean).join(": ").slice(0, 300);
}

async function readJson(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return { detail: text.slice(0, 300) }; }
}

/**
 * @param {{ credentials: { apiKey, apiSecret, accessToken, accessTokenSecret }, fetchImpl?: typeof fetch,
 *   baseUrl?: string, timeoutMs?: number, log?: (s: string) => void }} opts
 */
export function xClient({ credentials, fetchImpl = fetch, baseUrl = X_API, timeoutMs = 60_000, log = () => {} }) {
  const signed = (method, path, init) => {
    const url = baseUrl + path;
    const headers = { ...(init.headers || {}), Authorization: authorizationHeader({ method, url, credentials }) };
    return fetchImpl(url, { ...init, method, headers, signal: AbortSignal.timeout(timeoutMs) });
  };

  async function uploadImage(bytes, { mimeType = "image/png", filename = "shot.png" } = {}) {
    let last;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const form = new FormData();
      form.append("media", new Blob([bytes], { type: mimeType }), filename);
      form.append("media_category", "tweet_image");
      let res;
      try {
        res = await signed("POST", "/2/media/upload", { body: form });
      } catch (e) {
        last = new XError("unknown", `The media upload did not answer: ${e.message}`);
        log(`Upload attempt ${attempt} failed: ${e.message}`);
        continue;
      }
      const body = await readJson(res);
      if (res.ok && body?.data?.id) return { id: String(body.data.id), mediaKey: body.data.media_key };
      if (res.status === 429) throw new XError("rate_limited", "X rate-limited the media upload.", { resetAt: rateLimitReset(res.headers) });
      if (res.status === 401 || res.status === 403) throw new XError("auth", `X refused the media upload (${res.status}): ${describe(body)}`, { status: res.status });
      last = new XError(res.status >= 500 ? "unknown" : "rejected", `X refused the media upload (${res.status}): ${describe(body)}`, { status: res.status });
      if (res.status < 500) throw last;
      log(`Upload attempt ${attempt} got ${res.status}.`);
    }
    throw last;
  }

  /** Alt text is good manners, not essential: a failure here is logged and the post goes out without it. */
  async function setAltText(mediaId, text) {
    try {
      const res = await signed("POST", "/2/media/metadata", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: String(text).slice(0, 1000) } } }),
      });
      if (!res.ok) { log(`Alt text not set (${res.status}): ${describe(await readJson(res))}`); return false; }
      return true;
    } catch (e) {
      log(`Alt text not set: ${e.message}`);
      return false;
    }
  }

  /** One attempt, never repeated. Resolves { id } or throws an XError whose kind says whether it may have posted. */
  async function createPost(text, mediaIds = []) {
    const payload = { text };
    if (mediaIds.length) payload.media = { media_ids: mediaIds };
    let res;
    try {
      res = await signed("POST", "/2/tweets", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch (e) {
      throw new XError("unknown", `X did not answer the post request (${e.message}); it may or may not have been posted.`);
    }
    const body = await readJson(res);
    if ((res.status === 201 || res.status === 200) && body?.data?.id) return { id: String(body.data.id) };
    const detail = describe(body);
    if (res.status === 429) throw new XError("rate_limited", "X rate-limited the post.", { resetAt: rateLimitReset(res.headers) });
    if (res.status === 403 && /duplicate/i.test(detail)) throw new XError("duplicate", `X refused a duplicate post: ${detail}`);
    if (res.status === 401 || res.status === 403) throw new XError("auth", `X refused the post (${res.status}): ${detail}`, { status: res.status });
    if (res.status >= 500) throw new XError("unknown", `X answered ${res.status} to the post; it may or may not have been posted. ${detail}`, { status: res.status });
    throw new XError("rejected", `X refused the post (${res.status}): ${detail}`, { status: res.status });
  }

  return { uploadImage, setAltText, createPost };
}
