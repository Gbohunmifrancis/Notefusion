// node --test web-site/tests/*.test.mjs
// track.js's queue rules, as a module: what is kept, which events make the next batch, how an event goes on the
// wire, and which token a batch may carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../assets/track.js", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(src, { module });
const { trim, nextBatch, nextDue, wire, fit, reopen, readToken, tokenFor, settled, MAX_KEPT, LEASE_MS } = module.exports;

/** The module runs in its own realm: compare its objects by value. */
const plain = (x) => JSON.parse(JSON.stringify(x));
const DAY = 24 * 3600 * 1000;
const ev = (n, more = {}) => ({ id: "ev" + String(n).padStart(6, "0"), kind: "action", name: "A" + n, at: 1000 + n, s: "s1", ...more });
const decode = (b64) => Buffer.from(b64, "base64").toString("binary");
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

test("the queue keeps the newest 1000 and nothing older than 7 days", () => {
  const now = 10 * DAY;
  const many = Array.from({ length: MAX_KEPT + 5 }, (_, i) => ev(i, { at: now - 1000 + i }));
  const kept = trim(many, now);
  assert.equal(kept.length, MAX_KEPT);
  assert.equal(kept[0].id, many[5].id);
  assert.deepEqual(plain(trim([ev(1, { at: now - 7 * DAY - 1 }), ev(2, { at: now - 7 * DAY })], now).map((e) => e.id)), [ev(2).id]);
  assert.deepEqual(plain(trim([null, { kind: "x", at: now }, ev(3, { at: now })], now).map((e) => e.id)), [ev(3).id]);
});

test("a batch is one page session and one account, oldest first, at most the size asked", () => {
  const now = 100_000;
  const list = [ev(1, { b: 5 }), ev(2), ev(3, { u: "ada" }), ev(4), ev(5, { s: "s2" }), ev(6), ev(7, { f: now - 10 })];
  assert.deepEqual(plain(nextBatch(list, now, 50).map((e) => e.name)), ["A2", "A4", "A6"]);   // not beaconed, not in a live request
  assert.deepEqual(plain(nextBatch(list, now, 2).map((e) => e.name)), ["A2", "A4"]);
  assert.deepEqual(plain(nextBatch([ev(3, { u: "ada" }), ev(4), ev(8, { u: "ada" })], now, 50).map((e) => e.name)), ["A3", "A8"]);
  // A request that never came back lets go after the lease.
  assert.deepEqual(plain(nextBatch([ev(7, { f: now - LEASE_MS })], now, 50).map((e) => e.name)), ["A7"]);
  assert.equal(nextBatch([ev(1, { b: 5 })], now, 50).length, 0);
});

test("the next send is due now, when a lease ends, or never (only beaconed left)", () => {
  const now = 100_000;
  assert.equal(nextDue([ev(1)], now), 0);
  assert.equal(nextDue([ev(1, { f: now - 1000 })], now), LEASE_MS - 1000);
  assert.equal(nextDue([ev(1, { b: 1 })], now), -1);
  assert.equal(nextDue([], now), -1);
});

test("on the wire: the API's fields and the event's age at this send, none of the bookkeeping", () => {
  const e = { id: "abcdefgh", kind: "click", name: "Go", path: "/app", target: null, referrer: "x.com", device: "mobile", detail: undefined, at: 1000, s: "s1", u: "ada", b: 5, f: 6 };
  assert.deepEqual(plain(wire(e, 61_000)), { id: "abcdefgh", kind: "click", name: "Go", path: "/app", target: null, referrer: "x.com", device: "mobile", detail: null, ageMs: 60_000 });
  assert.equal(wire(e, 0).ageMs, 0);   // a clock set back never sends a negative age
});

test("a page load reopens what an earlier page beaconed", () => {
  assert.ok(reopen([ev(1, { b: 5 }), ev(2)]).every((e) => !("b" in e)));
});

test("a body over the limit is halved until it fits", () => {
  const big = Array.from({ length: 50 }, (_, i) => ev(i, { detail: "é".repeat(1000) }));   // two bytes a character
  const out = fit(big, (b) => ({ events: b }));
  assert.ok(out.batch.length < 50 && out.batch.length > 0);
  assert.ok(Buffer.byteLength(out.body) <= 60000);
  assert.equal(out.batch[0].id, big[0].id);
});

test("a batch carries only its own account's token, and only while it is good", () => {
  const now = 1_000_000;
  const good = jwt({ sub: "ada", exp: now / 1000 + 60 });
  assert.deepEqual(plain(readToken(good, now, decode)), { sub: "ada", live: true });
  assert.equal(readToken(jwt({ sub: "ada", exp: now / 1000 + 1 }), now, decode).live, false);   // about to run out
  assert.equal(readToken("not a token", now, decode), null);
  assert.equal(tokenFor("ada", good, now, decode), good);
  assert.equal(tokenFor("bayo", good, now, decode), null);
  assert.equal(tokenFor(null, good, now, decode), null);
  assert.equal(tokenFor("ada", null, now, decode), null);
});

test("2xx and refusals settle a batch; no answer, 408, 429 and 5xx are tried again", () => {
  for (const s of [200, 204, 400, 413]) assert.equal(settled(s), true, String(s));
  for (const s of [0, 408, 429, 500, 503]) assert.equal(settled(s), false, String(s));
});
