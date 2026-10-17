/* NoteFusion's service worker: web push only. No caching, no fetch handler, nothing offline.
 *
 * Registered by assets/notify.js with scope /app/ when someone signed in turns notifications on. The API sends
 * a finished or failed transcription as {title, body, tag, url, kind}; this shows it with the tag the open tab
 * uses for its own notification ("nf-job-<jobId>"), so the same job is never on screen twice. While a NoteFusion
 * tab is in front and focused the page is told instead (it has the sheet, or will in a moment), except on
 * Safari, which revokes a subscription whose pushes do not all show a notification. A click focuses the web app
 * and asks it to open the job, or opens /app?job=<id> when no tab is left.
 *
 * Served from the site root with Cache-Control: no-cache (vercel.json), so a change reaches browsers on their
 * next visit. The decisions are plain functions on self.NfSw with node tests (web-site/tests/sw.test.mjs).
 */
"use strict";

var ICON = "/assets/icon-192.png";
var BADGE = "/assets/mark.png";

/** The job a link opens (/app?job=<id>); null for anything else. */
function jobOf(url) {
  var m = /[?&]job=([^&#]+)/.exec(String(url || ""));
  try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
}

/** A notification from a push's payload; anything missing or odd gets a plain default, and only site paths are opened. */
function notification(p) {
  p = p && typeof p === "object" ? p : {};
  var url = typeof p.url === "string" && /^\/(?!\/)/.test(p.url) ? p.url : "/app";
  var kind = p.kind === "failed" ? "failed" : p.kind === "ready" ? "ready" : null;
  return {
    title: typeof p.title === "string" && p.title ? p.title : "NoteFusion",
    options: {
      body: typeof p.body === "string" ? p.body : "",
      icon: ICON,
      badge: BADGE,
      tag: typeof p.tag === "string" && p.tag ? p.tag : undefined,
      data: { url: url, kind: kind, jobId: jobOf(url) }
    }
  };
}

/** The web app's own windows (/app), not the shared-sheet page under it or the rest of the site. */
function appClients(list) {
  return (list || []).filter(function (c) {
    try { var path = new URL(c.url).pathname; return path === "/app" || path === "/app/"; } catch (e) { return false; }
  });
}

/** Safari (macOS and iOS) revokes a push subscription when a push shows nothing; Chrome, Edge and Firefox allow it while the site is in front. */
function mustAlwaysShow(ua) {
  ua = String(ua || "");
  return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android)/.test(ua);
}

/** What a push does: tell the app window that is in front (if any), and show a system notification unless one is. */
function decide(windows, ua) {
  var front = windows.filter(function (c) { return c.visibilityState === "visible" && c.focused; })[0] || null;
  return { tell: front, show: !front || mustAlwaysShow(ua) };
}

function parse(data) {
  if (!data) return null;
  try { return data.json(); } catch (e) {
    try { return { body: data.text() }; } catch (x) { return null; }
  }
}

function windows() { return self.clients.matchAll({ type: "window", includeUncontrolled: true }); }

// A new version takes over at once: there is no cache or page state for an old one to keep consistent.
self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("push", function (event) {
  var n = notification(parse(event.data));
  event.waitUntil(windows().then(function (list) {
    var d = decide(appClients(list), self.navigator && self.navigator.userAgent);
    if (d.tell) {
      d.tell.postMessage({
        type: "nf-push", title: n.title, body: n.options.body, tag: n.options.tag,
        url: n.options.data.url, jobId: n.options.data.jobId, kind: n.options.data.kind
      });
    }
    if (d.show) return self.registration.showNotification(n.title, n.options);
  }));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var url = typeof data.url === "string" && /^\/(?!\/)/.test(data.url) ? data.url : "/app";
  event.waitUntil(windows().then(function (list) {
    var open = appClients(list), app = open.filter(function (c) { return c.focused; })[0] || open[0];
    // An open app is focused and asked to open the job, rather than reloaded: it may hold unsaved work.
    if (app) {
      var tell = function (c) { (c || app).postMessage({ type: "nf-open", url: url, jobId: data.jobId || jobOf(url), kind: data.kind || null }); };
      return Promise.resolve(app.focus ? app.focus() : app).then(tell, function () { tell(app); });
    }
    return self.clients.openWindow(url);
  }));
});

self.NfSw = { jobOf: jobOf, notification: notification, appClients: appClients, mustAlwaysShow: mustAlwaysShow, decide: decide };
