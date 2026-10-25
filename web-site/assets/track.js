/* First-party analytics for notefusion.studio: page views, clicks and web-app actions, posted
   in small batches to the API's POST /api/web/events and read back on the admin dashboard.

   What leaves the browser: the page path (no query string), the referring site's host, a label
   for each clicked link or button, the link's destination, "mobile" or "desktop", and two random
   ids this script makes up and keeps in the browser's own storage, the browser's device id (the
   same one the web app sends, hashed by the API before it is stored), and for an action a short
   detail such as a checkout's error code or a script error's message, and on a page load's first
   page view the campaign tags of the link it came from (utm_*, ?ref=). No cookies, no screen size;
   the API reads the browser and system families and the country from the request, and keeps only those. When the web app has a session, the access token goes with the batch so the
   events are attached to the account; otherwise they are a visitor's.

   Other scripts call window.nfTrack("Saved sheet") to record an action, or
   window.nfTrack("Checkout failed", "HTTP 502") to record one with a detail. Before leaving the page
   on purpose (the checkout, signing out), call window.nfTrackNow(name, detail).then(go): it hands the
   queue over at once, so the event is not lost to the navigation.

   Nothing is lost on the way:
   - Every event gets its own id when it is made and is kept in localStorage (nf.web.events; in memory
     when storage is refused) until the API answers 2xx for it, or 400/413 (a batch it will never take).
     A 429, a 5xx or no connection keeps it and tries again after 5 s, 30 s, then every 2 min, as soon as
     the browser is back online, and on the next page load. The API keeps one event per id, so sending
     one twice is harmless; losing one is not.
   - Each event remembers its page session and the account signed in when it happened (the token's sub),
     and a batch is one session and one account: an event rides only its own account's live token, never
     the next account's; one whose account has signed out (or whose token has run out) goes as the
     visitor's. The web app sends its own "Signed out" with nfTrackNow before the tokens go, so what was
     pending leaves with the account still attached.
   - When the page is hidden or left (pagehide and visibilitychange both fire for one leave; it is handled
     once), the queue goes with navigator.sendBeacon (the one request a browser keeps through a navigation
     or a closed tab) to POST /api/web/events/beacon, as text/plain JSON so no preflight is needed, carrying
     the device id and, when signed in, the access token. What was beaconed stays in storage, marked: this
     page never sends it again, and drops it at its next delivered batch; a later page load that still
     finds it sends it once more under the same ids.
   - Events wait at most 7 days (the API dates an event by its age up to then) and at most 1000 are kept.
   A script with final figures to add (blog-track.js's time on the page) registers
   window.nfTrackOnLeave(fn): fn runs just before that batch is sent.

   Loaded with `module` defined (the tests), it only exports its pure pieces. */
(function () {
  "use strict";

  var MAX_KEPT = 1000, MAX_BATCH = 50, MAX_AGE_MS = 7 * 24 * 3600 * 1000, MAX_BODY = 60000;
  /** How long a batch in a request is left alone by other tabs before it counts as not sent. */
  var LEASE_MS = 30000;
  var BACKOFF_MS = [5000, 30000, 120000];
  var WIRE_FIELDS = ["id", "kind", "name", "path", "target", "referrer", "device", "detail"];
  /** Sent only when the page's link carried them, so the usual event costs nothing more. */
  var CAMPAIGN_FIELDS = ["utmSource", "utmMedium", "utmCampaign", "utmTerm", "utmContent", "ref"];

  /** Drops what is past keeping: events older than the API honours, then the oldest past MAX_KEPT. */
  function trim(events, now) {
    var kept = events.filter(function (e) { return e && e.id && now - e.at <= MAX_AGE_MS; });
    return kept.length > MAX_KEPT ? kept.slice(kept.length - MAX_KEPT) : kept;
  }
  /** Ready to send: not beaconed (b), and not in a request of the last LEASE_MS (f). */
  function ready(e, now) { return !e.b && !(e.f && now - e.f < LEASE_MS); }
  /** The next batch: the oldest ready event's session and account, and up to `max` more of the same, oldest first. */
  function nextBatch(events, now, max) {
    var first = null, out = [];
    for (var i = 0; i < events.length && out.length < max; i++) {
      var e = events[i];
      if (!ready(e, now)) continue;
      if (!first) first = e;
      if (e.s === first.s && (e.u || null) === (first.u || null)) out.push(e);
    }
    return out;
  }
  /** Milliseconds until something is ready to send: 0 now, a lease's end, or -1 for nothing to send. */
  function nextDue(events, now) {
    var due = -1;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (e.b) continue;
      var wait = ready(e, now) ? 0 : LEASE_MS - (now - e.f);
      if (due < 0 || wait < due) due = wait;
    }
    return due;
  }
  /** One stored event as the API reads it: its fields and how long it has waited, without the local bookkeeping. */
  function wire(e, now) {
    var out = {};
    WIRE_FIELDS.forEach(function (k) { out[k] = e[k] == null ? null : e[k]; });
    CAMPAIGN_FIELDS.forEach(function (k) { if (e[k] != null) out[k] = e[k]; });
    out.ageMs = Math.max(0, now - e.at);
    return out;
  }
  /** A page load: what an earlier page beaconed (and may have lost to the navigation) is sent again, same ids. */
  function reopen(events) {
    events.forEach(function (e) { delete e.b; });
    return events;
  }
  /** The account an access token names (its sub) and whether it is still good; read, not verified. Null when unreadable. */
  function readToken(raw, now, decode) {
    try {
      var part = String(raw).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      while (part.length % 4) part += "=";
      var claims = JSON.parse(decode(part));
      if (!claims || !claims.sub) return null;
      return { sub: String(claims.sub), live: !claims.exp || claims.exp * 1000 > now + 5000 };
    } catch (e) { return null; }
  }
  /** The token a batch made by account `u` may carry: only that account's own, and only while it is good. */
  function tokenFor(u, raw, now, decode) {
    if (!u || !raw) return null;
    var t = readToken(raw, now, decode);
    return t && t.live && t.sub === u ? raw : null;
  }
  /** A body's size in bytes as UTF-8. */
  function bytes(s) { return encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, "x").length; }
  /** The body for a batch, halving the batch until it fits the API's limit; the rest waits for the next one. */
  function fit(batch, make) {
    for (;;) {
      var body = JSON.stringify(make(batch));
      if (bytes(body) <= MAX_BODY || batch.length === 1) return { batch: batch, body: body };
      batch = batch.slice(0, Math.ceil(batch.length / 2));
    }
  }
  /** 2xx: stored. 400/413 (and any other refusal): never will be. 0 (no answer), 408, 429, 5xx: try again later. */
  function settled(status) { return status >= 200 && status < 500 && status !== 408 && status !== 429; }

  /**
   * The campaign tags of a page's query string (utm_source … utm_content, and ?ref= or its alias ?via=), as the event's
   * campaign fields: only those present, each at most 200 characters. Plain string work, so it runs anywhere.
   */
  var CAMPAIGN_PARAMS = { utm_source: "utmSource", utm_medium: "utmMedium", utm_campaign: "utmCampaign", utm_term: "utmTerm", utm_content: "utmContent", ref: "ref", via: "ref" };
  function campaignFrom(search) {
    var out = {};
    String(search || "").replace(/^\?/, "").split("&").forEach(function (pair) {
      var i = pair.indexOf("="), key = (i < 0 ? pair : pair.slice(0, i)).toLowerCase(), field = CAMPAIGN_PARAMS[key];
      if (!field || out[field]) return;
      var value;
      try { value = decodeURIComponent((i < 0 ? "" : pair.slice(i + 1)).replace(/\+/g, " ")).trim(); } catch (e) { return; }
      if (value) out[field] = value.slice(0, 200);
    });
    return out;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { trim: trim, nextBatch: nextBatch, nextDue: nextDue, wire: wire, fit: fit, reopen: reopen, readToken: readToken, tokenFor: tokenFor, settled: settled, campaignFrom: campaignFrom, MAX_KEPT: MAX_KEPT, MAX_BATCH: MAX_BATCH, LEASE_MS: LEASE_MS };
    return;
  }

  if (window.self !== window.top) return;

  var API = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:5080"
    : "https://api.notefusion.studio";
  var VISITOR_KEY = "nf.web.visitor", SESSION_KEY = "nf.web.session", TOKENS_KEY = "nf.web.tokens", EVENTS_KEY = "nf.web.events";

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
  function decode(b64) { return atob(b64); }
  function account() { var t = token(), r = t && readToken(t, Date.now(), decode); return r ? r.sub : null; }
  function device() { return window.innerWidth < 768 ? "mobile" : "desktop"; }
  function referrer() {
    try {
      if (!document.referrer) return null;
      var host = new URL(document.referrer).hostname;
      return host === location.hostname ? null : host;
    } catch (e) { return null; }
  }
  function path() { return location.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "") || "/"; }

  // ── The queue, in localStorage (shared by this site's tabs), or in memory once storage is refused ──
  var memory = [], inMemory = false;
  function read() {
    if (!inMemory) {
      try { var v = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { inMemory = true; }
    }
    return memory.slice();
  }
  function write(list) {
    list = trim(list, Date.now());
    if (!inMemory) {
      try { localStorage.setItem(EVENTS_KEY, JSON.stringify(list)); return; } catch (e) { inMemory = true; }
    }
    memory = list;
  }
  function idsOf(batch) { var ids = {}; batch.forEach(function (e) { ids[e.id] = true; }); return ids; }

  var timer = null, timerAt = 0, sending = null, failures = 0, retryAt = 0, firstPage = true, left = false;
  /** Ids this page beaconed: dropped at its next delivered batch, which shows the connection was there. */
  var beaconed = {};
  /** Ids in this page's request now: a leave beacons them too, since a navigation may drop that request. */
  var inFlight = {};

  /** Flushes in `ms`, unless a flush is already due sooner. */
  function schedule(ms) {
    var at = Date.now() + ms;
    if (timer && timerAt <= at) return;
    if (timer) clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(function () { timer = null; flush(); }, ms);
  }
  function afterwards() {
    var due = nextDue(read(), Date.now());
    if (due >= 0) schedule(Math.max(due, failures ? retryAt - Date.now() : 1000));
  }

  /**
   * Sends the next batch with fetch and keeps going while there is more. The promise settles when that
   * request is answered (or fails); it never rejects. Events leave storage only once the API has them.
   */
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (sending) return sending;
    var now = Date.now(), list = read(), batch = nextBatch(list, now, MAX_BATCH);
    if (!batch.length) return Promise.resolve();
    var sized = fit(batch, function (b) { return { visitorId: visitorId, sessionId: b[0].s, events: b.map(function (e) { return wire(e, now); }) }; });
    batch = sized.batch;
    var body = sized.body, ids = idsOf(batch);
    list.forEach(function (e) { if (ids[e.id]) e.f = now; });
    write(list);
    inFlight = ids;
    var headers = { "Content-Type": "application/json" };
    if (deviceId) headers["X-Device-Id"] = deviceId;
    var t = tokenFor(batch[0].u, token(), now, decode);
    if (t) headers.Authorization = "Bearer " + t;
    var req;
    try {
      req = fetch(API + "/api/web/events", { method: "POST", headers: headers, body: body, keepalive: true, mode: "cors", credentials: "omit" })
        .then(function (r) { return r.status; }, function () { return 0; });
    } catch (e) { req = Promise.resolve(0); }
    sending = req.then(function (status) {
      sending = null; inFlight = {};
      var ok = status >= 200 && status < 300;
      if (settled(status)) {
        var done = ok ? beaconed : {};
        if (ok) beaconed = {};
        write(read().filter(function (e) { return !ids[e.id] && !done[e.id]; }));
        failures = 0; retryAt = 0;
      } else {
        write(read().map(function (e) { if (ids[e.id]) delete e.f; return e; }));
        failures++;
        retryAt = Date.now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
      }
      afterwards();
    });
    return sending;
  }

  /**
   * Hands what is ready to navigator.sendBeacon, a batch at a time (the browser keeps about 64 KB of
   * beacons), and marks it beaconed. True when nothing ready is left behind.
   */
  function beacon() {
    if (!navigator.sendBeacon || navigator.onLine === false) return false;
    var now = Date.now(), list = read(), raw = token();
    list.forEach(function (e) { if (inFlight[e.id]) delete e.f; });
    for (var n = 0; n < 3; n++) {
      var batch = nextBatch(list, now, MAX_BATCH);
      if (!batch.length) break;
      var t = tokenFor(batch[0].u, raw, now, decode);
      var sized = fit(batch, function (b) {
        var payload = { visitorId: visitorId, sessionId: b[0].s, deviceId: deviceId, events: b.map(function (e) { return wire(e, now); }) };
        if (t) payload.token = t;
        return payload;
      });
      var ok = false;
      try { ok = navigator.sendBeacon(API + "/api/web/events/beacon", new Blob([sized.body], { type: "text/plain;charset=UTF-8" })); } catch (e) { ok = false; }
      if (!ok) break;
      sized.batch.forEach(function (e) { e.b = now; beaconed[e.id] = true; });
    }
    write(list);
    return !nextBatch(list, now, 1).length;
  }

  function push(kind, name, target, detail) {
    var now = Date.now();
    var e = { id: id(), kind: kind, name: name || null, path: path(), target: target || null, detail: detail || null, referrer: firstPage ? referrer() : null, device: device(), at: now, s: sessionId };
    if (firstPage && kind === "pageview") {
      var tags = campaignFrom(location.search);
      Object.keys(tags).forEach(function (k) { e[k] = tags[k]; });
    }
    var u = account();
    if (u) e.u = u;
    firstPage = false;
    var list = read();
    list.push(e);
    write(list);
    var waiting = list.filter(function (x) { return ready(x, now); }).length;
    if (waiting >= 20 && !failures) flush();
    else schedule(Math.max(4000, retryAt - now));
  }

  // What an earlier page beaconed, or left in a request, goes with this page's first batch.
  write(reopen(read()));
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

  var leaveHooks = [];
  /** The page is hidden or left: once per leave, however many of pagehide and visibilitychange say so. */
  function leave() {
    if (left) return;
    left = true;
    leaveHooks.forEach(function (fn) { try { fn(); } catch (e) { /* a hook never blocks the batch */ } });
    beacon();
  }
  function back() { left = false; }
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", back);
  document.addEventListener("visibilitychange", function () { document.visibilityState === "hidden" ? leave() : back(); });
  window.addEventListener("online", function () { failures = 0; retryAt = 0; flush(); });

  /** Runs `fn` each time the page is hidden or left, just before the batch is sent, so it can add final figures. */
  window.nfTrackOnLeave = function (fn) { if (typeof fn === "function") leaveHooks.push(fn); };

  window.nfTrack = function (name, detail) {
    if (name) push("action", String(name).slice(0, 120), null, detail == null ? null : String(detail).slice(0, 300));
  };

  /**
   * Records an action and hands the queue over straight away, for the moment just before the page is left
   * on purpose: as a beacon, which the browser keeps through the navigation (a keepalive fetch that needs a
   * CORS preflight is not reliably kept, which is how the checkout funnel came to show 1 "Checkout opened"
   * for 11 "Checkout started"). Without beacons, a fetch waited on for at most `maxWaitMs` (default 1200),
   * so a slow or blocked analytics call never holds the visitor back.
   */
  window.nfTrackNow = function (name, detail, maxWaitMs) {
    window.nfTrack(name, detail);
    if (beacon()) return Promise.resolve();
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
