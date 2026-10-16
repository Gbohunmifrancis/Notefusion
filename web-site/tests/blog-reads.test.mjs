// node --test web-site/tests/*.test.mjs
// blog.js fills the blog's read counts from GET /api/blog/reads. It exports its formatting when loaded as
// a module, and runs against the page otherwise; both are exercised here, the page with a stubbed API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../assets/blog.js", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(src, { module });
const { formatReads, readsLabel, normalisePath } = module.exports;

test("counts are written the way a reader expects", () => {
  assert.equal(formatReads(1), "1 read");
  assert.equal(formatReads(12), "12 reads");
  assert.equal(formatReads(1234), "1,234 reads");
  assert.equal(formatReads(1234567), "1,234,567 reads");
  assert.equal(formatReads(2345, true), "2.3k reads");
  assert.equal(formatReads(2399, true), "2.3k reads");     // rounded down: never overstated
  assert.equal(formatReads(2000, true), "2k reads");
  assert.equal(formatReads(12345, true), "12.3k reads");
  assert.equal(formatReads(123456, true), "123k reads");
  assert.equal(formatReads(1234567, true), "1.2m reads");
  assert.equal(formatReads(999, true), "999 reads");
});

test("a page never shows 0 reads: under five it is New, and a bad answer shows nothing", () => {
  assert.equal(readsLabel(0), "New");
  assert.equal(readsLabel(4), "New");
  assert.equal(readsLabel(5), "5 reads");
  assert.equal(readsLabel(2345, true), "2.3k reads");
  for (const bad of [undefined, null, "12", -1, NaN, Infinity]) assert.equal(readsLabel(bad), null);
});

test("paths are asked for the way the tracker records them", () => {
  assert.equal(normalisePath("/blog/how-to-read-tonic-solfa/"), "/blog/how-to-read-tonic-solfa");
  assert.equal(normalisePath("/Blog/X/index.html?utm=1#faq"), "/blog/x");
});

function slot(path, format) {
  const attrs = { "data-reads-path": path, "aria-hidden": "true" };
  if (format) attrs["data-reads-format"] = format;
  const classes = new Set();
  return {
    textContent: "",
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k) => { delete attrs[k]; },
    classList: { add: (c) => classes.add(c) },
    get ready() { return classes.has("is-ready") && !("aria-hidden" in attrs); },
  };
}

async function runPage(slots, respond) {
  const requests = [];
  const window = {
    location: { hostname: "notefusion.studio" },
    navigator: {},
    document: { querySelectorAll: (sel) => (sel === "[data-reads-path]" ? slots : []) },
    fetch: (url) => { requests.push(url); return respond(url); },
    setTimeout, clearTimeout, AbortController,
  };
  vm.runInNewContext(src, { window, setTimeout, clearTimeout });
  await new Promise((r) => setTimeout(r, 10));
  return requests;
}

test("the page asks once for every slot and fills each with its own count", async () => {
  const byline = slot("/blog/how-to-read-tonic-solfa");
  const listed = slot("/blog/how-to-read-tonic-solfa/", "compact");
  const fresh = slot("/blog/how-to-find-the-doh-of-a-song", "compact");
  const unknown = slot("/blog/not-in-the-answer");
  const requests = await runPage([byline, listed, fresh, unknown], async () => ({
    ok: true,
    json: async () => ({ "/blog/how-to-read-tonic-solfa": 2345, "/blog/how-to-find-the-doh-of-a-song": 3 }),
  }));

  assert.equal(requests.length, 1);
  assert.equal(requests[0], "https://api.notefusion.studio/api/blog/reads?paths=" +
    encodeURIComponent("/blog/how-to-read-tonic-solfa,/blog/how-to-find-the-doh-of-a-song,/blog/not-in-the-answer"));
  assert.equal(byline.textContent, "2,345 reads");
  assert.equal(listed.textContent, "2.3k reads");
  assert.equal(fresh.textContent, "New");
  assert.ok(byline.ready && listed.ready && fresh.ready);
  assert.equal(unknown.textContent, "");
  assert.ok(!unknown.ready, "a path the API did not answer for stays hidden");
});

test("an unreachable or failing API leaves every count hidden", async () => {
  for (const respond of [async () => { throw new TypeError("Failed to fetch"); }, async () => ({ ok: false, json: async () => ({}) })]) {
    const s = slot("/blog/how-to-read-tonic-solfa");
    await runPage([s], respond);
    assert.equal(s.textContent, "");
    assert.ok(!s.ready);
  }
});
