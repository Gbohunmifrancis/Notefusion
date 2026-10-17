// node --test web-site/tests/*.test.mjs
// sw.js shows a pushed "your sheet is ready" (or tells the app window in front instead), and a click opens the job.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

/** sw.js in a worker-shaped global: its listeners, its notifications, the windows it can see. */
function worker({ ua = CHROME, windows = [] } = {}) {
  const listeners = {}, shown = [], opened = [];
  const self = {
    navigator: { userAgent: ua },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting() {},
    registration: { showNotification: (title, options) => { shown.push({ title, options }); return Promise.resolve(); } },
    clients: {
      matchAll: (o) => { assert.equal(o.type, "window"); assert.equal(o.includeUncontrolled, true); return Promise.resolve(windows); },
      openWindow: (url) => { opened.push(url); return Promise.resolve(null); },
    },
  };
  vm.runInNewContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), { self, URL });
  async function fire(type, event) {
    let wait = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => { wait = p; } });
    await wait;
  }
  return { self, shown, opened, fire, S: self.NfSw };
}
function win(url, { visible = false, focused = false } = {}) {
  const w = { url, visibilityState: visible ? "visible" : "hidden", focused, sent: [], focusedNow: false };
  w.postMessage = (m) => w.sent.push(m);
  w.focus = () => { w.focusedNow = true; return Promise.resolve(w); };
  return w;
}
const ready = { title: "Your sheet is ready", body: "“Amazing Grace” is written out. Open it in NoteFusion.", tag: "nf-job-j1", url: "/app?job=j1", kind: "ready" };
const push = (payload) => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } });

test("a push with the tab closed shows the notification under the job's tag, with the app's icon", async () => {
  const w = worker();
  await w.fire("push", push(ready));
  assert.equal(w.shown.length, 1);
  assert.equal(w.shown[0].title, "Your sheet is ready");
  assert.equal(w.shown[0].options.tag, "nf-job-j1"); // the tag notify.js gives the tab's own notification
  assert.equal(w.shown[0].options.icon, "/assets/icon-192.png");
  assert.equal(w.shown[0].options.data.url, "/app?job=j1");
  assert.equal(w.shown[0].options.data.jobId, "j1");
});

test("with the web app in front and focused the page is told instead; a hidden one gets the notification", async () => {
  const front = win("https://notefusion.studio/app", { visible: true, focused: true });
  const w = worker({ windows: [front] });
  await w.fire("push", push(ready));
  assert.equal(w.shown.length, 0);
  assert.equal(front.sent[0].type, "nf-push");
  assert.equal(front.sent[0].jobId, "j1");

  const hidden = win("https://notefusion.studio/app", { visible: false });
  const h = worker({ windows: [hidden, win("https://notefusion.studio/blog/x", { visible: true, focused: true })] });
  await h.fire("push", push(ready));
  assert.equal(h.shown.length, 1);
  assert.equal(hidden.sent.length, 0);
});

test("Safari always shows it: it revokes a subscription whose pushes show nothing", async () => {
  const front = win("https://notefusion.studio/app", { visible: true, focused: true });
  const w = worker({ ua: SAFARI, windows: [front] });
  await w.fire("push", push(ready));
  assert.equal(w.shown.length, 1);
  assert.equal(front.sent.length, 1);
  assert.equal(w.S.mustAlwaysShow(CHROME), false);
  assert.equal(w.S.mustAlwaysShow("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), true);
  assert.equal(w.S.mustAlwaysShow("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0"), false);
});

test("an odd payload still shows something plain, and never opens another site", async () => {
  const w = worker();
  await w.fire("push", { data: null });
  assert.equal(w.shown[0].title, "NoteFusion");
  assert.equal(w.shown[0].options.data.url, "/app");
  const n = w.S.notification({ title: "x", url: "https://evil.example/app" });
  assert.equal(n.options.data.url, "/app");
  assert.equal(w.S.notification({ url: "//evil.example/app" }).options.data.url, "/app");
  assert.equal(w.S.jobOf("/app?job=a%2Fb"), "a/b");
  assert.equal(w.S.jobOf("/app"), null);
});

test("a click focuses an open web app and asks it to open the job; with none open it opens /app?job=", async () => {
  const sheet = win("https://notefusion.studio/app/sheet?s=tok"); // the shared-sheet page is not the app
  const app = win("https://notefusion.studio/app?view=library");
  const w = worker({ windows: [sheet, app] });
  let closed = false;
  await w.fire("notificationclick", { notification: { data: { url: "/app?job=j1", jobId: "j1", kind: "ready" }, close: () => { closed = true; } } });
  assert.ok(closed);
  assert.ok(app.focusedNow);
  assert.equal(app.sent[0].type, "nf-open");
  assert.equal(app.sent[0].jobId, "j1");
  assert.equal(sheet.sent.length, 0);
  assert.equal(w.opened.length, 0);

  const none = worker({ windows: [sheet] });
  await none.fire("notificationclick", { notification: { data: { url: "/app?job=j1" }, close() {} } });
  assert.deepEqual(none.opened, ["/app?job=j1"]);
});
