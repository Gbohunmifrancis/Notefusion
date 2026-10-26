// node --test web-site/tests/*.test.mjs
// support.js's pure helpers: where a message comes from, which token it may carry, and when the button shows a dot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../assets/support.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(src, { window });
const { sourceOf, liveToken, hasUnread } = window.NfSupport;

const decode = (b64) => Buffer.from(b64, "base64").toString("binary");
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("the web app is 'web', everything else on the site is 'site'", () => {
  assert.equal(sourceOf("/app"), "web");
  assert.equal(sourceOf("/app/sheet"), "web");
  assert.equal(sourceOf("/apple"), "site");
  assert.equal(sourceOf("/hymns/abide-with-me"), "site");
  assert.equal(sourceOf(""), "site");
});

test("the chat carries the web app's token only while it is good for another minute", () => {
  const now = 1_000_000_000_000;
  assert.equal(liveToken({ accessToken: jwt({ exp: now / 1000 + 600 }) }, now, decode), jwt({ exp: now / 1000 + 600 }));
  assert.equal(liveToken({ accessToken: jwt({ exp: now / 1000 + 30 }) }, now, decode), null);
  assert.equal(liveToken({ accessToken: "not-a-jwt" }, now, decode), null);
  assert.equal(liveToken(null, now, decode), null);
});

test("a dot only for an answer newer than the last message shown", () => {
  const them = { fromAdmin: true, createdAtUtc: "2026-10-25T15:00:00Z" };
  const me = { fromAdmin: false, createdAtUtc: "2026-10-25T15:01:00Z" };
  assert.equal(hasUnread([me, them], null), true);
  assert.equal(hasUnread([me, them], "2026-10-25T15:00:00Z"), false);
  assert.equal(hasUnread([them, me], null), false);
  assert.equal(hasUnread([], null), false);
});

test("the reply-time line rounds up to a plain promise, and says 'a few hours' until there is enough to measure", () => {
  const { replyPromise } = window.NfSupport;
  assert.equal(replyPromise(null), "We usually reply within a few hours");
  assert.equal(replyPromise(undefined), "We usually reply within a few hours");
  assert.equal(replyPromise(3), "We typically reply in under 5 minutes");
  assert.equal(replyPromise(11), "We typically reply in under 15 minutes");
  assert.equal(replyPromise(45), "We typically reply in under an hour");
  assert.equal(replyPromise(61), "We typically reply in under 2 hours");
  assert.equal(replyPromise(60 * 30), "We typically reply within a day or two");
});

test("help search keeps the questions holding every word, in their order", () => {
  const { searchHelp, HELP } = window.NfSupport;
  assert.equal(searchHelp(HELP, "").length, HELP.length);
  assert.deepEqual([...searchHelp(HELP, "YouTube link").map((h) => h.q)], ["How do I transcribe a song from YouTube?"]);
  assert.ok(searchHelp(HELP, "  delete   ACCOUNT ").some((h) => h.q === "How do I delete my account?"));
  assert.equal(searchHelp(HELP, "zzzz").length, 0);
});
