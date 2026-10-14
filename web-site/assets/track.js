/* First-party analytics for notefusion.studio: page views, clicks and web-app actions, posted
   in small batches to the API's POST /api/web/events and read back on the admin dashboard.

   What leaves the browser: the page path (no query string), the referring site's host, a label
   for each clicked link or button, the link's destination, "mobile" or "desktop", and two random
   ids this script makes up and keeps in the browser's own storage, the browser's device id (the
   same one the web app sends, hashed by the API before it is stored), and for an action a short
   detail such as a checkout's error code or a script error's message. No cookies, no user agent,
   no screen size. When the web app has a session, the access token goes with the batch so the
   events are attached to the account; otherwise they are a visitor's.

   Other scripts call window.nfTrack("Saved sheet") to record an action, or
   window.nfTrack("Checkout failed", "HTTP 502") to record one with a detail. Before leaving the page
   on purpose (the checkout), call window.nfTrackNow(name, detail).then(go): it sends at once and
   settles when the batch is delivered or after a short wait, so the event is not lost to the
   navigation. */
(function () {
  "use strict";
  if (window.self !== window.top) return;

  var API = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:5080"
    : "https://api.notefusion.studio";
  var VISITOR_KEY = "nf.web.visitor", SESSION_KEY = "nf.web.session", TOKENS_KEY = "nf.web.tokens";

  function id() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function keep(store, key) {
    try { var v = store.getItem(key); if (!v) { v = id(); store.setItem(key, v); } return v; } catch (e) { return id(); }
  }
  var visitorId = keep(localStorage, VISITOR_KEY);
  /** The web app's device id (app.js and preview.js read the same key), so pages and previews line up. */
  var deviceId = (function () {
    try {
      var d = localStorage.getItem("nf.web.device");
      if (!d) { d = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : id() + id(); localStorage.setItem("nf.web.device", d); }
      return d;
    } catch (e) { return null; }
  })();
  var sessionId = keep(sessionStorage, SESSION_KEY);

  function token() {
    try { var t = JSON.parse(localStorage.getItem(TOKENS_KEY) || "null"); return t && t.accessToken ? t.accessToken : null; } catch (e) { return null; }
  }
  function device() { return window.innerWidth < 768 ? "mobile" : "desktop"; }
  function referrer() {
    try {
      if (!document.referrer) return null;
      var host = new URL(document.referrer).hostname;
      return host === location.hostname ? null : host;
    } catch (e) { return null; }
  }
  function path() { return location.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "") || "/"; }

  var queue = [], timer = null, firstPage = true;

  /** Sends the queue. The promise settles when the batch is delivered (or fails); never rejects. */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return Promise.resolve();
    var now = Date.now();
    var batch = queue.splice(0, 50).map(function (e) { e.ageMs = now - e.at; delete e.at; return e; });
    var body = JSON.stringify({ visitorId: visitorId, sessionId: sessionId, events: batch });
    var headers = { "Content-Type": "application/json" };
    if (deviceId) headers["X-Device-Id"] = deviceId;
    var t = token();
    if (t) headers.Authorization = "Bearer " + t;
    try {
      return fetch(API + "/api/web/events", { method: "POST", headers: headers, body: body, keepalive: true, mode: "cors", credentials: "omit" })
        .then(function () { /* delivered */ }, function () { /* analytics never surfaces an error */ });
    } catch (e) { return Promise.resolve(); }
  }
  function push(kind, name, target, detail) {
    queue.push({ kind: kind, name: name || null, path: path(), target: target || null, detail: detail || null, referrer: firstPage ? referrer() : null, device: device(), at: Date.now() });
    firstPage = false;
    if (queue.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 4000);
  }

  push("pageview");

  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("a,button,[role='button'],input[type='submit']") : null;
    if (!el) return;
    // A list of the user's own things (sheet titles, folder names) names its items with
    // data-track-items on the list, so what they wrote never becomes the label.
    var group = el.closest("[data-track-items]");
    var name = el.getAttribute("data-track") || (group && group.getAttribute("data-track-items")) || el.getAttribute("aria-label") || (el.innerText || el.value || "").replace(/\s+/g, " ").trim();
    if (!name) return;
    var target = null;
    if (el.tagName === "A" && el.getAttribute("href")) {
      try { var u = new URL(el.getAttribute("href"), location.href); target = u.hostname === location.hostname ? u.pathname : u.hostname; } catch (err) { target = null; }
    }
    push("click", name.slice(0, 120), target);
  }, true);

  // The web app is one page that changes its view with pushState; count each view as a page.
  var lastUrl = location.href;
  function urlChanged() { if (location.href !== lastUrl) { lastUrl = location.href; push("pageview"); } }
  ["pushState", "replaceState"].forEach(function (fn) {
    var orig = history[fn];
    history[fn] = function () { var out = orig.apply(this, arguments); urlChanged(); return out; };
  });
  window.addEventListener("popstate", urlChanged);

  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });

  window.nfTrack = function (name, detail) {
    if (name) push("action", String(name).slice(0, 120), null, detail == null ? null : String(detail).slice(0, 300));
  };

  /**
   * Records an action and sends it straight away, for the moment just before the page is left on
   * purpose. A batch sent from pagehide rides a request the browser may drop mid-navigation (a
   * keepalive fetch that needs a CORS preflight is not reliably kept), which is how the checkout
   * funnel came to show 1 "Checkout opened" for 11 "Checkout started". Waits at most `maxWaitMs`
   * (default 1200), so a slow or blocked analytics call never holds the visitor back.
   */
  window.nfTrackNow = function (name, detail, maxWaitMs) {
    window.nfTrack(name, detail);
    return new Promise(function (resolve) {
      setTimeout(resolve, maxWaitMs == null ? 1200 : maxWaitMs);
      flush().then(resolve);
    });
  };

  // Script errors, so a broken page (the checkout above all) shows up on the dashboard. A few per page:
  // one fault often throws on every frame. "Script error." is a cross-origin script hiding its message
  // (an ad, an extension) and says nothing about this site, so it is left out.
  var errorsSent = 0;
  function pageError(message, where) {
    if (errorsSent >= 5 || !message || /^Script error\.?$/.test(message)) return;
    errorsSent++;
    push("action", "Page error", null, (String(message) + (where ? " @ " + where : "")).slice(0, 300));
  }
  window.addEventListener("error", function (e) {
    var file = e.filename ? e.filename.replace(location.origin, "").split("?")[0] : "";
    pageError(e.message, file ? file + ":" + e.lineno : "");
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    pageError(r && r.message ? r.message : String(r || "Unhandled rejection"), "promise");
  });
})();
