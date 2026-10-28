// node --test web-site/tests/*.test.mjs
// track.js on the page: events are kept in localStorage until the API has them (retried after a failure, dropped
// after a 400), go as one beacon per leave (pagehide and visibilitychange both fire for one), a signed-in browser's
// beacon carrying its token, and a later page load sends what was beaconed again under the same ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../assets/track.js", import.meta.url), "utf8");

function store(init = {}, { broken = false } = {}) {
  const m = new Map(Object.entries(init));
  if (broken) return { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** A JWT as the API issues it, for the parts track.js reads (sub, exp); the signature is never checked here. */
function jwt(sub, expSeconds = Date.now() / 1000 + 900) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor(expSeconds) })}.sig`;
}

/** One page load. `local`/`session` are shared between loads to stand for the same browser tab. */
function load({ local = store({ "nf.web.device": "device-0001" }), session = store(), status = () => 204, beaconOk = true } = {}) {
  const on = { win: {}, doc: {} };
  const beacons = [], fetches = [], intervals = [];
  const doc = { referrer: "", visibilityState: "visible", addEventListener: (t, f) => (on.doc[t] ||= []).push(f) };
  const win = {
    document: doc, innerWidth: 400,
    location: { hostname: "notefusion.studio", pathname: "/blog/x", href: "https://notefusion.studio/blog/x" },
    addEventListener: (t, f) => (on.win[t] ||= []).push(f),
  };
  win.self = win; win.top = win;
  const context = {
    window: win, document: doc, location: win.location, localStorage: local, sessionStorage: session,
    history: { pushState() {}, replaceState() {} }, crypto: { randomUUID: () => "uuid" },
    navigator: { onLine: true, sendBeacon: (url, blob) => { beacons.push({ url, blob }); return beaconOk; } },
    fetch: (url, init) => { fetches.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve({ status: status(fetches.length) }); },
    Blob, URL, Promise, Date, setTimeout, clearTimeout, atob,
    setInterval: (f, ms) => intervals.push({ f, ms }), clearInterval: () => {},
  };
  vm.runInNewContext(src, context);
  return {
    win, doc, beacons, fetches, local,
    signIn: (token) => local.setItem("nf.web.tokens", JSON.stringify({ accessToken: token, refreshToken: "r" })),
    signOut: () => local.removeItem("nf.web.tokens"),
    stored: () => JSON.parse(local.getItem("nf.web.events") || "[]"),
    leave: () => (on.win.pagehide || []).forEach((f) => f()),
    hide: () => { doc.visibilityState = "hidden"; (on.doc.visibilitychange || []).forEach((f) => f()); },
    show: () => { doc.visibilityState = "visible"; (on.doc.visibilitychange || []).forEach((f) => f()); },
    online: () => (on.win.online || []).forEach((f) => f()),
    minute: () => intervals.filter((i) => i.ms === 60000).forEach((i) => i.f()),
    events: () => beacons.filter((b) => b.url.endsWith("/api/web/events/beacon")),
    heartbeats: () => beacons.filter((b) => b.url.endsWith("/api/web/presence")),
  };
}
const settle = () => new Promise((r) => setImmediate(r));
const beaconBody = async (b) => JSON.parse(await b.blob.text());

test("an anonymous batch leaves as a beacon, after the leave hooks have added to it", async () => {
  const p = load();
  p.win.nfTrackOnLeave(() => p.win.nfTrack("blog_engagement", "pv=1;depth=75;active=42"));
  p.leave();

  assert.equal(p.fetches.length, 0);
  assert.equal(p.beacons.length, 1);
  assert.equal(p.beacons[0].url, "https://api.notefusion.studio/api/web/events/beacon");
  assert.match(p.beacons[0].blob.type, /^text\/plain/);   // a simple request: no preflight to lose
  const body = await beaconBody(p.beacons[0]);
  assert.equal(body.deviceId, "device-0001");
  assert.equal(body.token, undefined);
  assert.deepEqual(body.events.map((e) => [e.kind, e.name]), [["pageview", null], ["action", "blog_engagement"]]);
  assert.equal(body.events[1].detail, "pv=1;depth=75;active=42");
  for (const e of body.events) {
    assert.match(e.id, /^[A-Za-z0-9_-]{8,40}$/);
    assert.equal(typeof e.ageMs, "number");
    assert.equal(e.at, undefined); assert.equal(e.s, undefined); assert.equal(e.u, undefined);
  }
});

test("a signed-in browser's last batch goes as a beacon too, carrying its token", async () => {
  const local = store({ "nf.web.device": "device-0001" });
  const p = load({ local });
  p.signIn(jwt("user-1"));
  p.win.nfTrack("Saved sheet");
  p.leave();
  assert.equal(p.fetches.length, 0);
  assert.equal(p.beacons.length, 2);   // the pageview was a visitor's, the action the account's: one batch each
  const [anon, mine] = await Promise.all(p.beacons.map(beaconBody));
  assert.equal(anon.token, undefined);
  assert.equal(mine.token, JSON.parse(local.getItem("nf.web.tokens")).accessToken);
  assert.deepEqual(mine.events.map((e) => e.name), ["Saved sheet"]);
});

test("pagehide and visibilitychange for one leave send one beacon; leaving again after a return sends again", () => {
  const p = load();
  p.hide(); p.leave();
  assert.equal(p.events().length, 1);
  p.show();
  p.win.nfTrack("Played");
  p.hide();
  assert.equal(p.events().length, 2);
});

test("a tab in sight says it is still open every minute and on coming back, a hidden one says nothing", async () => {
  const p = load();
  p.minute();
  assert.equal(p.heartbeats().length, 1);
  const beat = JSON.parse(p.heartbeats()[0].blob);
  assert.deepEqual(Object.keys(beat).sort(), ["path", "visitorId"]);   // a browser id and a page, nothing else
  assert.equal(beat.path, "/blog/x");
  p.hide();
  p.minute();
  assert.equal(p.heartbeats().length, 1);                               // hidden: no heartbeat
  p.show();
  assert.equal(p.heartbeats().length, 2);                               // back: one at once
  assert.equal(p.stored().filter((e) => e.kind !== "pageview").length, 0); // never an event of its own
});

test("what was beaconed stays marked: this page never resends it, the next load does under the same ids", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const local = store({ "nf.web.device": "device-0001" }), session = store();
  const p = load({ local, session });
  p.win.nfTrack("Opened plans");
  p.leave();
  const sent = (await beaconBody(p.beacons[0])).events.map((e) => e.id);
  assert.equal(p.stored().length, 2);
  p.show();
  t.mock.timers.tick(5000); await settle();
  assert.equal(p.fetches.length, 0);                 // nothing new: the beaconed ones are not sent twice

  const next = load({ local, session });             // the next page in this tab
  t.mock.timers.tick(4000); await settle();
  assert.equal(next.fetches.length, 1);
  const ids = next.fetches[0].body.events.map((e) => e.id);
  assert.deepEqual(ids.slice(0, 2), sent);
  assert.equal(ids.length, 3);                       // with its own page view
  assert.equal(next.stored().length, 0);            // the 204 took them all out
});

test("a failed send keeps the batch and retries after 5 s, 30 s, then delivers and forgets it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const answers = [503, 0, 204];
  const p = load({ status: (n) => answers[n - 1] });
  t.mock.timers.tick(4000); await settle();
  assert.equal(p.fetches.length, 1);
  assert.equal(p.stored().length, 1);
  p.win.nfTrack("Played");                           // queued during the back-off: it waits for the retry
  t.mock.timers.tick(4999); await settle();
  assert.equal(p.fetches.length, 1);
  t.mock.timers.tick(1); await settle();
  assert.equal(p.fetches.length, 2);
  assert.deepEqual(p.fetches[1].body.events.map((e) => e.id), [p.fetches[0].body.events[0].id, p.stored()[1].id]);
  assert.equal(p.fetches[1].body.events[0].ageMs, 9000);   // its own age, counted at this send
  t.mock.timers.tick(29_999); await settle();
  assert.equal(p.fetches.length, 2);
  t.mock.timers.tick(1); await settle();
  assert.equal(p.fetches.length, 3);
  assert.equal(p.stored().length, 0);
});

test("coming back online retries at once; a 400 drops the batch for good", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const answers = [0, 400];
  const p = load({ status: (n) => answers[n - 1] });
  t.mock.timers.tick(4000); await settle();
  assert.equal(p.stored().length, 1);
  p.online(); await settle();
  assert.equal(p.fetches.length, 2);
  assert.equal(p.stored().length, 0);
});

test("more than 50 waiting go in further batches", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const p = load();
  for (let i = 0; i < 70; i++) p.win.nfTrack("Tap " + i);
  await settle();
  t.mock.timers.tick(1000); await settle();
  t.mock.timers.tick(1000); await settle();
  assert.deepEqual(p.fetches.map((f) => f.body.events.length).reduce((a, b) => a + b, 0), 71);
  assert.ok(p.fetches.every((f) => f.body.events.length <= 50));
  assert.equal(p.stored().length, 0);
});

test("an account's events never ride the next account's token, and go as the visitor's once it has signed out", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const p = load({ status: () => 0 });              // nothing gets through while the accounts change
  p.signIn(jwt("ada", 1_000_000 / 1000 + 900));
  p.win.nfTrack("Opened sheet");
  p.signOut();
  p.signIn(jwt("bayo", 1_000_000 / 1000 + 900));
  p.win.nfTrack("Played");
  const stored = p.stored();
  assert.deepEqual(stored.map((e) => e.u || null), [null, "ada", "bayo"]);
  p.leave();
  const bodies = await Promise.all(p.beacons.map(beaconBody));
  const byName = Object.fromEntries(bodies.flatMap((b) => b.events.map((e) => [e.name || "pageview", b.token ? JSON.parse(Buffer.from(b.token.split(".")[1], "base64url")).sub : null])));
  assert.deepEqual(byName, { pageview: null, "Opened sheet": null, Played: "bayo" });
});

test("nfTrackNow hands the queue over at once as a beacon, with the token still there", async () => {
  const p = load();
  p.signIn(jwt("ada"));
  await p.win.nfTrackNow("Signed out");
  p.signOut();
  const bodies = await Promise.all(p.beacons.map(beaconBody));
  const out = bodies.find((b) => b.events.some((e) => e.name === "Signed out"));
  assert.ok(out.token);
});

test("with storage refused the queue works in memory", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const p = load({ local: store({}, { broken: true }), session: store({}, { broken: true }) });
  p.win.nfTrack("Played");
  t.mock.timers.tick(4000); await settle();
  assert.equal(p.fetches.length, 1);
  assert.equal(p.fetches[0].body.events.length, 2);
  assert.equal(p.fetches[0].init.headers["X-Device-Id"], undefined);
});

test("a request still out when the page is left is beaconed too: the navigation may drop it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
  const p = load();
  p.win.nfTrack("Played");
  t.mock.timers.tick(4000);                          // the batch is in a request that has not answered yet
  assert.equal(p.fetches.length, 1);
  p.leave();
  assert.equal(p.beacons.length, 1);
  assert.deepEqual((await beaconBody(p.beacons[0])).events.map((e) => e.id), p.fetches[0].body.events.map((e) => e.id));
});
