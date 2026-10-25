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
