// node --test web-site/tests/*.test.mjs
// notify.js decides what the web app does when a job finishes while the person is in another tab: whether to
// show a notification, play the chime and mark the tab, which words to use, and when to offer "Notify me".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/notify.js", import.meta.url), "utf8"), { window });
const N = window.NfNotify;
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));

/** localStorage's shape, with the option of throwing like a private window or blocked site data. */
function memory(throws) {
  const m = new Map();
  return {
    getItem(k) { if (throws) throw new Error("SecurityError"); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (throws) throw new Error("SecurityError"); m.set(k, String(v)); },
  };
}

test("the browser's permission: unsupported without Notification, else its own answer", () => {
  assert.equal(N.permission({}), "unsupported");
  assert.equal(N.permission(null), "unsupported");
  const Notif = (p) => ({ Notification: { permission: p, requestPermission() {} } });
  assert.equal(N.permission(Notif("granted")), "granted");
  assert.equal(N.permission(Notif("denied")), "denied");
  assert.equal(N.permission(Notif("default")), "default");
  assert.equal(N.permission({ Notification: { permission: "granted" } }), "unsupported"); // no requestPermission
});

test("the answers are remembered; nothing remembered means never asked and the sound on", () => {
  const s = memory();
  same(N.prefs(s), { notify: null, sound: true });
  N.setNotify(s, true); N.setSound(s, false);
  same(N.prefs(s), { notify: "on", sound: false });
  N.setNotify(s, false); N.setSound(s, true);
  same(N.prefs(s), { notify: "off", sound: true });
});

test("storage that throws or is missing reads as never asked, and writing to it never throws", () => {
  for (const s of [memory(true), null]) {
    same(N.prefs(s), { notify: null, sound: true });
    assert.doesNotThrow(() => { N.setNotify(s, true); N.setSound(s, false); });
  }
});

test("'Notify me' is offered only while the browser can still ask and nobody said no here", () => {
  assert.equal(N.shouldAsk("default", null), true);
  assert.equal(N.shouldAsk("default", "on"), true);   // allowed once, then reset in the browser
  assert.equal(N.shouldAsk("default", "off"), false); // "No thanks"
  assert.equal(N.shouldAsk("granted", null), false);
  assert.equal(N.shouldAsk("denied", null), false);
  assert.equal(N.shouldAsk("unsupported", null), false);
});

test("notifications are on when the browser allows them and they were not switched off here", () => {
  assert.equal(N.notifyOn("granted", null), true); // allowed before this page asked
  assert.equal(N.notifyOn("granted", "on"), true);
  assert.equal(N.notifyOn("granted", "off"), false);
  assert.equal(N.notifyOn("denied", "on"), false);
  assert.equal(N.notifyOn("default", "on"), false);
  assert.equal(N.notifyOn("unsupported", "on"), false);
});

test("away is a hidden tab or a window that is not in front", () => {
  assert.equal(N.isAway({ visibilityState: "hidden", hasFocus: () => true }), true);
  assert.equal(N.isAway({ visibilityState: "visible", hasFocus: () => false }), true);
  assert.equal(N.isAway({ visibilityState: "visible", hasFocus: () => true }), false);
  assert.equal(N.isAway({ visibilityState: "visible" }), false);
  assert.equal(N.isAway(null), false);
});

test("someone looking gets nothing extra; someone away gets the cue, the chime unless muted, and the notification when on", () => {
  same(N.plan({ away: false, permission: "granted", notifyPref: "on", sound: true }), { notify: false, chime: false, cue: false });
  same(N.plan({ away: true, permission: "granted", notifyPref: "on", sound: true }), { notify: true, chime: true, cue: true });
  same(N.plan({ away: true, permission: "granted", notifyPref: "off", sound: true }), { notify: false, chime: true, cue: true });
  same(N.plan({ away: true, permission: "granted", notifyPref: null, sound: false }), { notify: true, chime: false, cue: true });
  // Blocked or unsupported (iOS Safari outside a home-screen app): the sound and the title still tell them.
  same(N.plan({ away: true, permission: "denied", notifyPref: "on", sound: true }), { notify: false, chime: true, cue: true });
  same(N.plan({ away: true, permission: "unsupported", notifyPref: null, sound: true }), { notify: false, chime: true, cue: true });
});

test("the name shown is the song's title, else the file's name without its extension; a take has none", () => {
  assert.equal(N.nameOf({ title: "Amazing Grace" }, "x.mp3"), "Amazing Grace");
  assert.equal(N.nameOf({ title: "  " }, "Choir rehearsal.m4a"), "Choir rehearsal");
  assert.equal(N.nameOf(null, "hymn.final.wav"), "hymn.final");
  assert.equal(N.nameOf(null, null), null);
  assert.equal(N.nameOf({}, ""), null);
});

test("the words: 'Your sheet is ready' with the name, or the app's own sentence when it failed", () => {
  same(N.message("ready", "Amazing Grace"), { title: "Your sheet is ready", body: "“Amazing Grace” is written out. Open it in NoteFusion." });
  same(N.message("ready", null), { title: "Your sheet is ready", body: "Open it in NoteFusion." });
  same(N.message("failed", "Abide with Me", "That link could not be transcribed."),
    { title: "Transcription didn't finish", body: "“Abide with Me”: That link could not be transcribed." });
  same(N.message("failed", null, null), { title: "Transcription didn't finish", body: "That could not be transcribed." });
});

test("the tab's title while away, and one tag per job so a notification never doubles", () => {
  assert.equal(N.tabTitle("ready"), "(1) Sheet ready — NoteFusion");
  assert.equal(N.tabTitle("failed"), "(1) Transcription didn't finish — NoteFusion");
  assert.equal(N.tag("abc-123"), "nf-job-abc-123");
  assert.equal(N.tag("abc-123"), N.tag("abc-123"));
  assert.notEqual(N.tag("a"), N.tag("b"));
});

test("the chime is two soft notes under a second: doh then soh, the other way round when it failed", () => {
  const made = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime(v) { if (v > this.peak) this.peak = v; }, peak: 0 });
  const ctx = {
    state: "running", currentTime: 10, destination: {},
    createOscillator() { const o = { frequency: { setValueAtTime(f) { o.freq = f; } }, connect() {}, start(at) { o.at = at; }, stop(at) { o.end = at; } }; made.push(o); return o; },
    createGain() { const g = { gain: param(), connect() {} }; made.gains = (made.gains || []).concat(g); return g; },
  };
  assert.equal(N.chime(ctx, "ready"), true);
  assert.equal(made.length, 2);
  assert.ok(made[0].freq < made[1].freq, "doh, then soh above it");
  assert.ok(Math.abs(made[1].freq / made[0].freq - 1.5) < 0.01, "a fifth apart");
  assert.ok(made[1].end - made[0].at < 1, "under a second");
  assert.ok(made.gains.every((g) => g.gain.peak <= 0.1), "quiet");
  made.length = 0;
  N.chime(ctx, "failed");
  assert.ok(made[0].freq > made[1].freq);
  assert.equal(N.chime(null, "ready"), false);
});

test("asking: the browser's answer, from a promise or (older Safari) a callback; none without Notification", async () => {
  assert.equal(await N.request({}), "unsupported");
  const modern = { Notification: { permission: "default", requestPermission: () => Promise.resolve("granted") } };
  assert.equal(await N.request(modern), "granted");
  const old = { Notification: { permission: "default", requestPermission: (cb) => { cb("denied"); } } };
  assert.equal(await N.request(old), "denied");
});

// ── Web push (the notification with the tab closed) ──────────────────────────

const pushWin = (over = {}) => ({
  navigator: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0", serviceWorker: {}, ...over.navigator },
  PushManager: function () {},
  Notification: { permission: "granted", requestPermission() {} },
  matchMedia: () => ({ matches: false }),
  ...over.win,
});

test("push support: a browser with a service worker, PushManager and Notification; iPhone Safari only from the Home Screen", () => {
  assert.equal(N.pushSupport(pushWin()), "push");
  assert.equal(N.pushSupport(pushWin({ win: { PushManager: undefined } })), "none");
  assert.equal(N.pushSupport(pushWin({ navigator: { serviceWorker: undefined } })), "none");
  assert.equal(N.pushSupport({}), "none");
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  assert.equal(N.pushSupport(pushWin({ navigator: { userAgent: iphone }, win: { PushManager: undefined, Notification: undefined } })), "home-screen");
  assert.equal(N.pushSupport(pushWin({ navigator: { userAgent: iphone, standalone: true } })), "push");
  assert.equal(N.pushSupport(pushWin({ navigator: { userAgent: iphone }, win: { matchMedia: () => ({ matches: true }) } })), "push");
  // iPadOS says it is a Mac; the touch points give it away.
  const ipad = pushWin({ navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 } });
  assert.equal(N.pushSupport(ipad), "home-screen");
  const mac = pushWin({ navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 } });
  assert.equal(N.pushSupport(mac), "push");
});

test("the API's base64url key becomes the bytes applicationServerKey takes, and is compared with a subscription's", () => {
  const bytes = Array.from({ length: 65 }, (_, i) => (i * 37 + 4) % 256);
  const key = Buffer.from(bytes).toString("base64url");
  assert.deepEqual(Array.from(N.keyBytes(key)), bytes);
  assert.deepEqual(Array.from(N.keyBytes(Buffer.from(bytes).toString("base64"))), bytes); // padded standard base64 too
  assert.equal(N.keyBytes(""), null);
  assert.equal(N.keyBytes("not a key!"), null);
  assert.equal(N.sameKey(new Uint8Array(bytes).buffer, key), true);
  const other = bytes.slice(); other[10] ^= 1;
  assert.equal(N.sameKey(new Uint8Array(other).buffer, key), false);
  assert.equal(N.sameKey(null, key), true, "a browser that does not say is not churned");
});

test("the subscription the API is sent: the endpoint and its two keys, nothing else", () => {
  same(N.subscriptionBody({ endpoint: "https://fcm.googleapis.com/fcm/send/x", expirationTime: null, keys: { p256dh: "BP", auth: "au" } }),
    { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "BP", auth: "au" } });
  assert.equal(N.subscriptionBody({ endpoint: "https://x" }), null);
  assert.equal(N.subscriptionBody(null), null);
});

/** A browser with a push worker: what the page registers, subscribes and tells the API. */
function fakeBrowser({ existingKey = null, permission = "granted" } = {}) {
  const calls = [];
  const key = Buffer.from(Array.from({ length: 65 }, (_, i) => i)).toString("base64url");
  let sub = existingKey ? fakeSub("https://fcm.googleapis.com/fcm/send/old", existingKey) : null;
  function fakeSub(endpoint, k) {
    return {
      endpoint, options: { applicationServerKey: new Uint8Array(Buffer.from(k, "base64url")).buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: "BPkey", auth: "authkey" } }),
      unsubscribe: () => { calls.push(["unsubscribe", endpoint]); sub = null; return Promise.resolve(true); },
    };
  }
  const reg = {
    active: {},
    pushManager: {
      getSubscription: () => Promise.resolve(sub),
      subscribe: (o) => {
        calls.push(["subscribe", o.userVisibleOnly, Buffer.from(o.applicationServerKey).toString("base64url")]);
        sub = fakeSub("https://fcm.googleapis.com/fcm/send/new", key);
        return Promise.resolve(sub);
      },
    },
  };
  const win = pushWin({
    navigator: { serviceWorker: {
      register: (url, o) => { calls.push(["register", url, o.scope]); return Promise.resolve(reg); },
      getRegistration: (scope) => Promise.resolve(scope === "/app/" ? reg : undefined),
    } },
    win: { Notification: { permission, requestPermission() {} } },
  });
  const api = (path, opts = {}) => {
    calls.push([opts.method || "GET", path, opts.body || null]);
    return Promise.resolve(path.endsWith("/key") ? { publicKey: key } : null);
  };
  return { win, api, calls, key };
}

test("turning push on registers the /app/ worker, subscribes with the API's key and saves the subscription", async () => {
  const b = fakeBrowser();
  assert.equal(await N.pushOn(b.win, b.api), "on");
  same(b.calls, [
    ["GET", "/api/push/web/key", null],
    ["register", "/sw.js", "/app/"],
    ["subscribe", true, b.key],
    ["POST", "/api/push/web/subscriptions", { endpoint: "https://fcm.googleapis.com/fcm/send/new", keys: { p256dh: "BPkey", auth: "authkey" } }],
  ]);
});

test("a subscription made with an old key is replaced; one made with this key is only saved again", async () => {
  const stale = fakeBrowser({ existingKey: Buffer.from([4, 1, 2]).toString("base64url") });
  assert.equal(await N.pushOn(stale.win, stale.api), "on");
  assert.ok(stale.calls.some((c) => c[0] === "unsubscribe" && c[1].endsWith("/old")));
  assert.ok(stale.calls.some((c) => c[0] === "DELETE" && c[2].endpoint.endsWith("/old")));
  assert.ok(stale.calls.some((c) => c[0] === "subscribe"));

  const again = fakeBrowser({ existingKey: fakeBrowser().key });
  assert.equal(await N.pushOn(again.win, again.api), "on");
  assert.ok(!again.calls.some((c) => c[0] === "subscribe" || c[0] === "unsubscribe"));
  assert.ok(again.calls.some((c) => c[0] === "POST" && c[2].endpoint.endsWith("/old")));
});

test("push stays off without permission, support or a key, and never throws", async () => {
  const blocked = fakeBrowser({ permission: "denied" });
  assert.equal(await N.pushOn(blocked.win, blocked.api), "unsupported");
  assert.equal(blocked.calls.length, 0);
  assert.equal(await N.pushOn({}, () => Promise.resolve(null)), "unsupported");
  const b = fakeBrowser();
  assert.equal(await N.pushOn(b.win, () => Promise.reject(new Error("WEBPUSH_OFF"))), "failed");
});

test("turning push off tells the API, then unsubscribes; signing out tells the API and keeps the browser's subscription", async () => {
  const old = "https://fcm.googleapis.com/fcm/send/old";
  const off = fakeBrowser({ existingKey: "BA" });
  await N.pushOff(off.win, off.api);
  same(off.calls, [["DELETE", "/api/push/web/subscriptions", { endpoint: old }], ["unsubscribe", old]]);

  const out = fakeBrowser({ existingKey: "BA" });
  await N.pushOff(out.win, out.api, true);
  same(out.calls, [["DELETE", "/api/push/web/subscriptions", { endpoint: old }]]);

  const none = fakeBrowser();
  await N.pushOff(none.win, none.api);
  assert.equal(none.calls.length, 0);
  await N.pushOff({}, none.api); // no support: nothing, and no throw
});
