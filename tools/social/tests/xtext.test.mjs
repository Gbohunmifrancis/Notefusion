// X's weighted length (twitter-text v3 rules): what decides whether a post fits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { weightedLength, findUrls, emojiIn } from "../lib/xtext.mjs";

test("plain Latin text counts one per character, punctuation and em dash included", () => {
  assert.equal(weightedLength("Doh is Bb"), 9);
  assert.equal(weightedLength("a — b “quoted” ‘x’ done"), 23);
  assert.equal(weightedLength("…"), 2, "the ellipsis is outside the light ranges");
  assert.equal(weightedLength("café crème"), 10);
  assert.equal(weightedLength("café"), 4, "NFC: e + combining acute is one character");
});

test("CJK and other heavy characters count two", () => {
  assert.equal(weightedLength("音楽"), 4);
  assert.equal(weightedLength("♪"), 2);
});

test("an emoji counts two, however many code points it is made of", () => {
  assert.equal(weightedLength("🎵"), 2);
  assert.equal(weightedLength("👩‍👩‍👧‍👦"), 2, "a ZWJ family");
  assert.equal(weightedLength("👍🏾"), 2, "with a skin tone");
  assert.equal(weightedLength("🇳🇬"), 2, "a flag");
  assert.deepEqual(emojiIn("Sing 🎶 and 🇳🇬!"), ["🎶", "🇳🇬"]);
  assert.deepEqual(emojiIn("plain #text 3/4 ©"), []);
});

test("every link counts 23, bare domains included, trailing punctuation not", () => {
  assert.equal(weightedLength("https://notefusion.studio"), 23);
  assert.equal(weightedLength("https://notefusion.studio/hymns/identify/a/very/long/path/that/goes/on"), 23);
  assert.equal(weightedLength("See notefusion.studio."), 4 + 23 + 1);
  assert.deepEqual(findUrls("Try notefusion.studio/hymns, then x.com.").map((u) => u.url), ["notefusion.studio/hymns", "x.com"]);
  assert.deepEqual(findUrls("an email a@b.com is not a link, nor is e.g. or 3.5"), []);
});

test("a full-length post", () => {
  assert.equal(weightedLength("x".repeat(280)), 280);
  assert.equal(weightedLength("x".repeat(250) + " https://notefusion.studio/hymns"), 274);
});
