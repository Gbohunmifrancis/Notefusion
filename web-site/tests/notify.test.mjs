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
