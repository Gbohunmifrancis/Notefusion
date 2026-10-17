// The X client against a fake fetch: signed requests, the upload's multipart body, and a post that is never
// sent twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { xClient, XError, rateLimitReset } from "../lib/x-api.mjs";

const credentials = { apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts" };
const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => JSON.stringify(body) });

function fake(answers) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

test("the image goes to /2/media/upload as multipart, signed, and its alt text to /2/media/metadata", async () => {
  const f = fake([reply(200, { data: { id: "1880028106020515840", media_key: "3_1880028106020515840" } }), reply(200, { data: {} })]);
  const x = xClient({ credentials, fetchImpl: f.fetchImpl });
  const media = await x.uploadImage(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  assert.equal(media.id, "1880028106020515840");
  assert.equal(f.calls[0].url, "https://api.x.com/2/media/upload");
  assert.equal(f.calls[0].init.method, "POST");
  assert.match(f.calls[0].init.headers.Authorization, /^OAuth oauth_consumer_key="k", oauth_nonce="[0-9a-f]+", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1"/);
  const form = f.calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("media_category"), "tweet_image");
  assert.equal(form.get("media").type, "image/png");
  assert.equal(form.get("media").size, 4);

  assert.equal(await x.setAltText(media.id, "A phone showing Learn my part"), true);
  assert.equal(f.calls[1].url, "https://api.x.com/2/media/metadata");
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { id: "1880028106020515840", metadata: { alt_text: { text: "A phone showing Learn my part" } } });
});

test("an upload that fails on the server is tried once more; a refusal is not", async () => {
  const f = fake([reply(503, { title: "Service Unavailable" }), reply(200, { data: { id: "9" } })]);
  assert.equal((await xClient({ credentials, fetchImpl: f.fetchImpl }).uploadImage(Buffer.from("x"))).id, "9");
  const g = fake([reply(403, { title: "Forbidden", detail: "not permitted" })]);
  await assert.rejects(xClient({ credentials, fetchImpl: g.fetchImpl }).uploadImage(Buffer.from("x")), (e) => e.kind === "auth" && /not permitted/.test(e.message));
  assert.equal(g.calls.length, 1);
});

test("alt text that cannot be set does not stop the post", async () => {
  const f = fake([new TypeError("fetch failed")]);
  assert.equal(await xClient({ credentials, fetchImpl: f.fetchImpl }).setAltText("1", "x"), false);
});

test("a post is created with its media id", async () => {
  const f = fake([reply(201, { data: { id: "1445880548472328192", text: "hi" } })]);
  const { id } = await xClient({ credentials, fetchImpl: f.fetchImpl }).createPost("hi", ["1880028106020515840"]);
  assert.equal(id, "1445880548472328192");
  assert.equal(f.calls[0].url, "https://api.x.com/2/tweets");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { text: "hi", media: { media_ids: ["1880028106020515840"] } });
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/json");
});

test("a post is never retried: no answer, or a 5xx, is 'unknown'", async () => {
  for (const answer of [new Error("socket hang up"), reply(503, { title: "Service Unavailable" })]) {
    const f = fake([answer, reply(201, { data: { id: "2" } })]);
    await assert.rejects(xClient({ credentials, fetchImpl: f.fetchImpl }).createPost("hi"), (e) => e instanceof XError && e.kind === "unknown" && /may or may not have been posted/.test(e.message));
    assert.equal(f.calls.length, 1);
  }
});

test("a duplicate, a rate limit and a refusal are told apart", async () => {
  const dup = fake([reply(403, { detail: "You are not allowed to create a Tweet with duplicate content.", type: "about:blank", title: "Forbidden", status: 403 })]);
  await assert.rejects(xClient({ credentials, fetchImpl: dup.fetchImpl }).createPost("hi"), (e) => e.kind === "duplicate");

  const limited = fake([reply(429, { title: "Too Many Requests" }, { "x-rate-limit-reset": "1792252800" })]);
  await assert.rejects(xClient({ credentials, fetchImpl: limited.fetchImpl }).createPost("hi"), (e) => e.kind === "rate_limited" && e.resetAt === "2026-10-17T16:00:00.000Z");

  const auth = fake([reply(403, { title: "Forbidden", detail: "Your client app is not configured with the appropriate oauth1 app permissions for this endpoint." })]);
  await assert.rejects(xClient({ credentials, fetchImpl: auth.fetchImpl }).createPost("hi"), (e) => e.kind === "auth" && /permissions/.test(e.message));

  const bad = fake([reply(400, { errors: [{ message: "text too long" }] })]);
  await assert.rejects(xClient({ credentials, fetchImpl: bad.fetchImpl }).createPost("hi"), (e) => e.kind === "rejected");
});

test("the latest of the reset headers is when to come back", () => {
  assert.equal(rateLimitReset(new Headers({ "x-rate-limit-reset": "1792252800", "x-user-limit-24hour-reset": "1792256400" })), "2026-10-17T17:00:00.000Z");
  assert.equal(rateLimitReset(new Headers({})), null);
});
