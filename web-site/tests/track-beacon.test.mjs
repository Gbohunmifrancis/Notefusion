// node --test web-site/tests/*.test.mjs
// track.js on leaving the page: the leave hooks add their figures first, then an anonymous visitor's batch
// goes as a text/plain beacon carrying the device id; a signed-in browser's goes the usual way, with its token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../assets/track.js", import.meta.url), "utf8");

function store(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function load({ tokens = null } = {}) {
  const on = { win: {}, doc: {} };
  const beacons = [], fetches = [];
  const local = store({ "nf.web.device": "device-0001", ...(tokens ? { "nf.web.tokens": JSON.stringify(tokens) } : {}) });
  const doc = { referrer: "", visibilityState: "visible", addEventListener: (t, f) => (on.doc[t] ||= []).push(f) };
  const win = {
    document: doc, innerWidth: 400,
    location: { hostname: "notefusion.studio", pathname: "/blog/x", href: "https://notefusion.studio/blog/x" },
    addEventListener: (t, f) => (on.win[t] ||= []).push(f),
  };
  win.self = win; win.top = win;
  const context = {
    window: win, document: doc, location: win.location, localStorage: local, sessionStorage: store(),
    history: { pushState() {}, replaceState() {} }, crypto: { randomUUID: () => "uuid" },
    navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } },
    fetch: (url, init) => { fetches.push({ url, init }); return Promise.resolve(); },
    Blob, URL, Promise, setTimeout, clearTimeout,
  };
  vm.runInNewContext(src, context);
  return { win, beacons, fetches, leave: () => (on.win.pagehide || []).forEach((f) => f()) };
}

test("an anonymous batch leaves as a beacon, after the leave hooks have added to it", async () => {
  const p = load();
  p.win.nfTrackOnLeave(() => p.win.nfTrack("blog_engagement", "pv=1;depth=75;active=42"));
  p.leave();

  assert.equal(p.fetches.length, 0);
  assert.equal(p.beacons.length, 1);
  assert.equal(p.beacons[0].url, "https://api.notefusion.studio/api/web/events/beacon");
  assert.match(p.beacons[0].blob.type, /^text\/plain/);   // a simple request: no preflight to lose
  const body = JSON.parse(await p.beacons[0].blob.text());
  assert.equal(body.deviceId, "device-0001");
  assert.deepEqual(body.events.map((e) => [e.kind, e.name]), [["pageview", null], ["action", "blog_engagement"]]);
  assert.equal(body.events[1].detail, "pv=1;depth=75;active=42");
});

test("a signed-in browser's last batch keeps its token, so it goes the usual way", () => {
  const p = load({ tokens: { accessToken: "jwt" } });
  p.leave();
  assert.equal(p.beacons.length, 0);
  assert.equal(p.fetches.length, 1);
  assert.equal(p.fetches[0].url, "https://api.notefusion.studio/api/web/events");
  assert.equal(p.fetches[0].init.headers.Authorization, "Bearer jwt");
});
