// node --test web-site/tests/*.test.mjs
// /app's error reports (assets/errors.js): nothing without a DSN, nothing loaded until the site's own code throws,
// then Sentry's self-hosted bundle once, with no personal data, and the errors caught before it arrived.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const errors = read("../assets/errors.js");
const html = read("../app/index.html");
const ORIGIN = "https://notefusion.studio";

function run({ dsn = "https://key@o1.ingest.us.sentry.io/2", release = "abc1234" } = {}) {
  const listeners = {};
  const appended = [];
  const metas = { "nf-sentry-dsn": dsn, "nf-release": release };
  const window = {
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
  };
  const document = {
    querySelector: (sel) => {
      const name = /name="([^"]+)"/.exec(sel)[1];
      return name in metas ? { content: metas[name] } : null;
    },
    createElement: () => ({}),
    head: { appendChild: (el) => appended.push(el) },
  };
  vm.runInNewContext(errors, { window, document, location: { origin: ORIGIN }, Error, String });
  const fire = (type, e) => (listeners[type] || []).slice().forEach((fn) => fn(e));
  const sentryLoads = (calls) => {
    window.Sentry = {
      init: (o) => calls.push(["init", o]),
      captureException: (e) => calls.push(["capture", e.message]),
    };
    appended[0].onload();
  };
  return { listeners, appended, fire, sentryLoads };
}

const ownError = (message) => { const e = new Error(message); e.stack = `Error: ${message}\n    at x (${ORIGIN}/assets/app.js?v=48:10:5)`; return e; };

test("with no DSN nothing listens and nothing loads", () => {
  const r = run({ dsn: "" });
  assert.deepEqual(r.listeners, {});
  assert.equal(r.appended.length, 0);
});

test("with a DSN nothing loads until the site's own code throws", () => {
  const r = run();
  assert.equal(r.appended.length, 0);
  r.fire("error", { error: ownError("x is undefined"), filename: `${ORIGIN}/assets/app.js?v=48` });
  assert.equal(r.appended.length, 1);
  assert.equal(r.appended[0].src, "/assets/vendor/sentry-browser-11.4.0.min.js");
});

test("errors that are not ours never load it: another script's, a cross-origin 'Script error.', a non-Error rejection", () => {
  const r = run();
  const theirs = new Error("gsi failed"); theirs.stack = "Error: gsi failed\n    at y (https://accounts.google.com/gsi/client:1:1)";
  r.fire("error", { error: theirs, filename: "https://accounts.google.com/gsi/client" });
  r.fire("error", { error: null, message: "Script error.", filename: "" });
  r.fire("unhandledrejection", { reason: { code: "NETWORK_ERROR" } });
  r.fire("unhandledrejection", { reason: theirs });
  assert.equal(r.appended.length, 0);
});

test("the bundle loads once; it starts with no personal data and reports what was caught before it arrived", () => {
  const r = run();
  r.fire("error", { error: ownError("first"), filename: `${ORIGIN}/assets/app.js?v=48` });
  r.fire("unhandledrejection", { reason: ownError("second") });
  assert.equal(r.appended.length, 1);
  const calls = [];
  r.sentryLoads(calls);
  const [kind, options] = calls[0];
  assert.equal(kind, "init");
  assert.equal(options.dsn, "https://key@o1.ingest.us.sentry.io/2");
  assert.equal(options.release, "abc1234");
  assert.equal(options.sendDefaultPii, false);
  assert.deepEqual([...options.allowUrls], [ORIGIN]);
  assert.deepEqual(calls.slice(1), [["capture", "first"], ["capture", "second"]]);
  // Sentry's own handlers take over: ours are gone.
  assert.equal((r.listeners.error || []).length, 0);
  assert.equal((r.listeners.unhandledrejection || []).length, 0);
});

test("a report keeps the page but no query string, and of the headers only the browser's name", () => {
  const r = run();
  r.fire("error", { error: ownError("x"), filename: `${ORIGIN}/assets/app.js?v=48` });
  const calls = [];
  r.sentryLoads(calls);
  const { beforeSend, beforeBreadcrumb } = calls[0][1];
  const failed = beforeSend({ exception: { values: [{ type: "Error", value: "No account for ada@example.org" }] }, message: "to bob@example.com" });
  assert.equal(failed.exception.values[0].value, "No account for [email]");
  assert.equal(failed.message, "to [email]");
  assert.equal(beforeBreadcrumb({ category: "console", message: "signed in as ada@example.org" }).message, "signed in as [email]");
  const event = beforeSend({ request: {
    url: `${ORIGIN}/app?join=ABCD1234#sheet`, query_string: "join=ABCD1234",
    headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 14)", Referer: `${ORIGIN}/app?job=9` }, cookies: "a=b" } });
  assert.equal(event.request.url, `${ORIGIN}/app`);
  assert.deepEqual({ ...event.request.headers }, { "User-Agent": "Mozilla/5.0 (Linux; Android 14)" });
  assert.equal(event.request.query_string, undefined);
  assert.equal(event.request.cookies, undefined);
  const crumb = beforeBreadcrumb({ category: "fetch", data: { url: "https://api.notefusion.studio/api/library?folder=Choir", method: "GET" } });
  assert.equal(crumb.data.url, "https://api.notefusion.studio/api/library");
  assert.equal(crumb.data.method, "GET");
  const nav = beforeBreadcrumb({ category: "navigation", data: { from: "/app?join=ABCD1234", to: "/app?view=practice" } });
  assert.deepEqual([nav.data.from, nav.data.to], ["/app", "/app"]);
});

test("/app has the empty slots the deploy fills, and loads errors.js before any other script", () => {
  assert.match(html, /<meta name="nf-sentry-dsn" content="">/);
  assert.match(html, /<meta name="nf-release" content="">/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.match(scripts[0], /^\/assets\/errors\.js\?v=\d+$/);
  assert.ok(existsSync(new URL("../assets/vendor/sentry-browser-11.4.0.min.js", import.meta.url)));
});
