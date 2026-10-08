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
   window.nfTrack("Checkout failed", "HTTP 502") to record one with a detail. */
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

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var now = Date.now();
    var batch = queue.splice(0, 50).map(function (e) { e.ageMs = now - e.at; delete e.at; return e; });
    var body = JSON.stringify({ visitorId: visitorId, sessionId: sessionId, events: batch });
    var headers = { "Content-Type": "application/json" };
    if (deviceId) headers["X-Device-Id"] = deviceId;
    var t = token();
    if (t) headers.Authorization = "Bearer " + t;
    try {
      fetch(API + "/api/web/events", { method: "POST", headers: headers, body: body, keepalive: true, mode: "cors", credentials: "omit" })
        .catch(function () { /* analytics never surfaces an error */ });
    } catch (e) { /* ignore */ }
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
    var name = el.getAttribute("data-track") || el.getAttribute("aria-label") || (el.innerText || el.value || "").replace(/\s+/g, " ").trim();
    if (!name) return;
    var target = null;
    if (el.tagName === "A" && el.getAttribute("href")) {
      try { var u = new URL(el.getAttribute("href"), location.href); target = u.hostname === location.hostname ? u.pathname + u.search : u.hostname; } catch (err) { target = null; }
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
