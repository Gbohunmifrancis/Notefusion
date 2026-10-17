// OAuth 1.0a (HMAC-SHA1) request signing for the X API, user context, with node:crypto.
// https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
//
// Only query-string and application/x-www-form-urlencoded parameters are signed. A JSON or multipart body is
// not part of the signature (X's v2 endpoints take one or the other), so callers pass `params` only for those.
import crypto from "node:crypto";

/** RFC 3986 percent-encoding, as OAuth 1.0a requires (encodeURIComponent leaves !'()* alone). */
export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** The signature base string: METHOD&encoded-url&encoded-sorted-params. */
export function signatureBaseString(method, url, params) {
  const u = new URL(url);
  const all = [];
  for (const [k, v] of u.searchParams) all.push([k, v]);
  for (const [k, v] of Object.entries(params)) all.push([k, v]);
  const pairs = all
    .map(([k, v]) => [percentEncode(k), percentEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
  return [method.toUpperCase(), percentEncode(base), percentEncode(pairs)].join("&");
}

export function sign(baseString, consumerSecret, tokenSecret) {
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || "")}`;
  return crypto.createHmac("sha1", key).update(baseString).digest("base64");
}

/**
 * The Authorization header for one request.
 * @param {{ method: string, url: string, params?: Record<string,string>, credentials: { apiKey: string, apiSecret: string,
 *   accessToken: string, accessTokenSecret: string }, nonce?: string, timestamp?: string|number }} req
 */
export function authorizationHeader({ method, url, params = {}, credentials, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce ?? crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  const base = signatureBaseString(method, url, { ...params, ...oauth });
  oauth.oauth_signature = sign(base, credentials.apiSecret, credentials.accessTokenSecret);
  return "OAuth " + Object.keys(oauth).sort().map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`).join(", ");
}
