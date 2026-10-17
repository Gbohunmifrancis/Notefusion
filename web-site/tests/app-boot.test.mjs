// node --test web-site/tests/*.test.mjs
// /app paints its own HTML first: app-boot.js picks the screen (sign-in form, or the app's shell with a session
// stored) by classes on <html>, holds a form sent before app.js arrives, and app/index.html stays in step with
// what app.js later writes, so taking over changes nothing on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const boot = read("../assets/app-boot.js");
const app = read("../assets/app.js");
const html = read("../app/index.html");

function classList(init) {
  const set = new Set(init);
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c), set };
}

function run({ search = "", items = {}, storageThrows = false, now = Date.now() } = {}) {
  const root = { classList: classList(["nf-boot"]) };
  const listeners = [];
  const localStorage = { getItem: (k) => (k in items ? items[k] : null) };
  const window = {};
  Object.defineProperty(window, "localStorage", { get() { if (storageThrows) throw new Error("SecurityError"); return localStorage; } });
  const document = { documentElement: root, addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
  const DateNow = { now: () => now };
  vm.runInNewContext(boot, { window, document, location: { search }, URLSearchParams, JSON, Date: DateNow });
  const submit = (target) => {
    let prevented = false;
    for (const l of listeners) if (l.type === "submit") l.fn({ target, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { classes: [...root.classList.set].filter((c) => c !== "nf-boot").sort(), root, listeners, submit, NfBoot: window.NfBoot };
}

test("signed out, the HTML's sign-in screen is the first paint", () => {
  assert.deepEqual(run().classes, []);
  assert.deepEqual(run({ search: "?job=123" }).classes, []);
});

test("a stored session paints the app's shell, never the form", () => {
  const tokens = JSON.stringify({ accessToken: "a", refreshToken: "r" });
  assert.deepEqual(run({ items: { "nf.web.tokens": tokens } }).classes, ["nf-in"]);
  // Signed in, a sign-up link or an invite shows no form either: app.js opens the app.
  assert.deepEqual(run({ items: { "nf.web.tokens": tokens }, search: "?signup=1&join=ABCD1234" }).classes, ["nf-in"]);
  // A guest's preview opens the app read-only, so it starts from the shell too.
  assert.deepEqual(run({ search: "?preview=job-1" }).classes, ["nf-in"]);
});

test("what app.js takes as no session is no session here", () => {
  assert.deepEqual(run({ items: { "nf.web.tokens": "null" } }).classes, []);
  assert.deepEqual(run({ items: { "nf.web.tokens": "{not json" } }).classes, []);
  assert.deepEqual(run({ storageThrows: true }).classes, []);
  assert.deepEqual(run({ search: "?preview=" }).classes, []);
});

test("a sign-up link paints Create account; an invite paints its note", () => {
  assert.deepEqual(run({ search: "?signup=1" }).classes, ["nf-signup"]);
  assert.deepEqual(run({ search: "?join=ABCD1234" }).classes, ["nf-join"]);
  const now = Date.parse("2026-10-17T12:00:00Z");
  const kept = (hoursAgo) => JSON.stringify({ code: "ABCD1234", at: now - hoursAgo * 3600 * 1000 });
  assert.deepEqual(run({ now, items: { "nf.web.join": kept(23) } }).classes, ["nf-join"]);
  assert.deepEqual(run({ now, items: { "nf.web.join": kept(25) } }).classes, []);
});

test("a form sent before app.js is held, then handed over once", () => {
  const r = run();
  assert.ok(r.listeners.some((l) => l.type === "submit" && l.capture === true));
  const form = { id: "form-login" };
  assert.equal(r.submit(form), true, "no page load while the page is still its own HTML");
  assert.equal(r.NfBoot.takeSubmit(), form);
  assert.equal(r.NfBoot.takeSubmit(), null);
  r.root.classList.remove("nf-boot");
  assert.equal(r.submit(form), false, "app.js's own handlers decide once it is in");
  assert.equal(r.NfBoot.takeSubmit(), null);
});

test("the storage keys and the invite's lifetime are app.js's", () => {
  assert.match(app, /var TOKENS_KEY = "nf\.web\.tokens";/);
  assert.match(app, /var JOIN_KEY = "nf\.web\.join", JOIN_TTL = 24 \* 60 \* 60 \* 1000;/);
  assert.match(app, /var previewId = new URLSearchParams\(location\.search\)\.get\("preview"\);/);
  assert.match(app, /if \(new URLSearchParams\(location\.search\)\.get\("signup"\)\) selectAuthTab\("register"\);/);
  // app.js ends the boot screen after boot() has set its own.
  assert.match(app, /boot\(\);\s*\n(?:\s*\/\/.*\n)*\s*document\.documentElement\.classList\.remove\("nf-boot"\);/);
});

test("app/index.html is the sign-in screen app.js would draw", () => {
  assert.match(html, /<html lang="en-GB" class="nf-boot">/);
  const head = html.slice(0, html.indexOf("</head>"));
  // Blocking, in <head>, before the stylesheets (so it need not wait for them).
  const tag = head.match(/<script src="\/assets\/app-boot\.js\?v=\d+"><\/script>/);
  assert.ok(tag, "app-boot.js is a plain blocking script in <head>");
  assert.ok(head.indexOf(tag[0]) < head.indexOf('rel="stylesheet"'));
  assert.match(html, /<section id="view-auth" class="auth-page">/, "the form is shown by the HTML, not by app.js");
  assert.match(html, /<section id="boot-skel" aria-hidden="true">/, "the shell a session paints is there from the start");
  // The Google button's row is kept from the first paint, so the email fields do not move when it arrives.
  assert.match(html, /<form id="form-login" class="auth-form has-google"/);
  assert.match(html, /<form id="form-register" class="auth-form has-google hidden"/);
  // The words app.js writes on taking over are the ones already painted.
  const copy = (name) => app.match(new RegExp(name + ': \\["([^"]+)", "([^"]+)"\\]')).slice(1);
  const [loginTitle, loginSub] = copy("login"), [regTitle, regSub] = copy("register");
  assert.ok(html.includes(`<span class="boot-login">${loginTitle}</span><span class="boot-signup">${regTitle}</span>`));
  assert.ok(html.includes(`<span class="boot-login">${loginSub}</span><span class="boot-signup">${regSub}</span>`));
  const joinNote = app.match(/\$\("auth-join"\)\.textContent = "([^"]+)";/)[1];
  assert.ok(html.includes(`<div id="auth-join" class="alert alert-info hidden" role="status">${joinNote}</div>`));
});
