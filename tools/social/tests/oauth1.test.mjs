// OAuth 1.0a signing against X's documented example.
// https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
import { test } from "node:test";
import assert from "node:assert/strict";
import { percentEncode, signatureBaseString, sign, authorizationHeader } from "../lib/oauth1.mjs";

const DOC = {
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  timestamp: "1318622958",
};
const params = {
  status: "Hello Ladies + Gentlemen, a signed OAuth request!",
  oauth_consumer_key: DOC.consumerKey, oauth_nonce: DOC.nonce, oauth_signature_method: "HMAC-SHA1",
  oauth_timestamp: DOC.timestamp, oauth_token: DOC.token, oauth_version: "1.0",
};

test("percent-encoding is RFC 3986", () => {
  assert.equal(percentEncode("Ladies + Gentlemen"), "Ladies%20%2B%20Gentlemen");
  assert.equal(percentEncode("An encoded string!"), "An%20encoded%20string%21");
  assert.equal(percentEncode("Dogs, Cats & Mice"), "Dogs%2C%20Cats%20%26%20Mice");
  assert.equal(percentEncode("☃"), "%E2%98%83");
  assert.equal(percentEncode("(*'~-._)"), "%28%2A%27~-._%29");
});

test("the documented base string and signature (api.x.com)", () => {
  const base = signatureBaseString("POST", "https://api.x.com/1.1/statuses/update.json?include_entities=true", params);
  assert.equal(base, "POST&https%3A%2F%2Fapi.x.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521");
  assert.equal(sign(base, DOC.consumerSecret, DOC.tokenSecret), "Ls93hJiZbQ3akF3HF3x1Bz8/zU4=");
});

test("the classic example on api.twitter.com gives the long-published signature", () => {
  const base = signatureBaseString("POST", "https://api.twitter.com/1.1/statuses/update.json?include_entities=true", params);
  assert.equal(sign(base, DOC.consumerSecret, DOC.tokenSecret), "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
});

test("the Authorization header carries every oauth_ field, encoded and sorted, with the signature", () => {
  const h = authorizationHeader({
    method: "POST", url: "https://api.x.com/1.1/statuses/update.json?include_entities=true",
    params: { status: params.status }, nonce: DOC.nonce, timestamp: DOC.timestamp,
    credentials: { apiKey: DOC.consumerKey, apiSecret: DOC.consumerSecret, accessToken: DOC.token, accessTokenSecret: DOC.tokenSecret },
  });
  assert.equal(h, 'OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", oauth_signature="Ls93hJiZbQ3akF3HF3x1Bz8%2FzU4%3D", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1318622958", oauth_token="370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb", oauth_version="1.0"');
});

test("a fresh nonce and timestamp each time when none is given", () => {
  const credentials = { apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts" };
  const a = authorizationHeader({ method: "POST", url: "https://api.x.com/2/tweets", credentials });
  const b = authorizationHeader({ method: "POST", url: "https://api.x.com/2/tweets", credentials });
  assert.notEqual(/oauth_nonce="([^"]+)"/.exec(a)[1], /oauth_nonce="([^"]+)"/.exec(b)[1]);
  assert.ok(Math.abs(Number(/oauth_timestamp="(\d+)"/.exec(a)[1]) - Date.now() / 1000) < 5);
});
