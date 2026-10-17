// The checks a post must pass before it can go out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePost, hashtagsIn } from "../lib/validate.mjs";

const GOOD = "Most altos learn their part by standing next to a stronger alto.\n\nLearn my part in NoteFusion plays your line loud and the others soft.\n\n#buildinpublic #choir";
const errorsOf = (t, o) => validatePost(t, o).errors.join(" | ");

test("a post in the house style passes", () => {
  const v = validatePost(GOOD, { facts: "Learn my part" });
  assert.equal(v.ok, true, v.errors.join("; "));
  assert.ok(v.length < 200);
});

test("too long as X counts it", () => {
  assert.match(errorsOf("x".repeat(261)), /261 characters .* most is 260/);
  assert.equal(validatePost("x".repeat(260)).ok, true);
  assert.match(errorsOf("🎵".repeat(131)), /262 characters/);
});

test("hashtags, emoji, em dashes and mentions are rationed", () => {
  assert.deepEqual(hashtagsIn("a #one b #two_2 c&#39; #3"), ["one", "two_2", "3"]);
  assert.match(errorsOf("Sing it #a #b #c"), /3 hashtags/);
  assert.match(errorsOf("Sing it 🎵🎶"), /2 emoji/);
  assert.equal(validatePost("Sing it 🎵").ok, true);
  assert.match(errorsOf("One — two — three"), /2 em dashes/);
  assert.equal(validatePost("One — two").ok, true);
  assert.match(errorsOf("Thanks @someone for the idea"), /mentions an account/);
});

test("hype words are refused, as whole words", () => {
  assert.match(errorsOf("A revolutionary way to read music"), /hype words: revolutionary/);
  assert.match(errorsOf("This is a Game-Changer for choirs"), /game-changer/);
  assert.match(errorsOf("Excited to announce Learn my part"), /excited to announce/);
  assert.equal(validatePost("The magician's choir").ok, true, "magic only as a whole word");
});

test("nothing internal leaks: addresses, hosts, config keys, tokens", () => {
  assert.match(errorsOf("Write to francis@example.com"), /email address/);
  assert.match(errorsOf("Served from 10.0.0.12 now"), /IP address/);
  assert.match(errorsOf("Try it on localhost first"), /local address/);
  assert.match(errorsOf("The API at api.notefusion.studio is faster"), /internal hostname/);
  assert.match(errorsOf("Moved to a bigger EC2 box"), /infrastructure hostname/);
  assert.match(errorsOf("Set Gemini__ApiKey and go"), /configuration key/);
  assert.match(errorsOf("NF_API_KEY is required"), /environment variable/);
  assert.match(errorsOf("key ghp_abcdefghijklmnop123"), /shaped like a key/);
  assert.match(errorsOf("id 3f9a8c7d6e5b4a3f9a8c7d6e5b4a3f9a8c7d"), /shaped like a token/);
});

test("links: none unless allowed, then only notefusion.studio, and only one", () => {
  assert.match(errorsOf("Try it: https://notefusion.studio"), /leave links out/);
  assert.match(errorsOf("Try notefusion.studio today"), /leave links out/, "a bare domain is a link to X");
  assert.equal(validatePost("Try it: https://notefusion.studio/hymns/identify", { allowLink: true }).ok, true);
  assert.match(errorsOf("Try it: https://example.com", { allowLink: true }), /not on notefusion\.studio/);
  assert.match(errorsOf("https://notefusion.studio and https://notefusion.studio/hymns", { allowLink: true }), /more than one link/);
});

test("numbers must come from the story", () => {
  const facts = "Bar lines that match the hymnbook: 3/4 and pickups detected, measured on a 448-take hymn corpus";
  assert.equal(validatePost("Amazing Grace is in 3/4. Measured on 448 takes.", { facts }).ok, true);
  assert.match(errorsOf("Now 95% accurate on 448 takes", { facts }), /numbers the story does not: 95/);
  assert.match(errorsOf("Used by 1,200 choirs", { facts: "Learn my part" }), /1200/);
  assert.equal(validatePost("#buildinpublic #web3 https://notefusion.studio/2026", { facts: "", allowLink: true }).ok, true, "hashtags and links are not claims");
});

test("empty is not a post", () => {
  assert.equal(validatePost("  ").ok, false);
  assert.equal(validatePost(null).ok, false);
});
