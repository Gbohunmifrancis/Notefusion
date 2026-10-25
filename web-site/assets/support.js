/* Live support: the round chat button on every page of the website and the web app, and the chat it opens.
 *
 * The button is all that loads with a page (a few hundred bytes of work); the chat's styles (support.css) come on the
 * first tap. A signed-in person (the web app's token in nf.web.tokens) is known by their account, so their thread is the
 * same on the phone; anyone else is known by a random key this browser keeps (nf.support.key), sent as X-Support-Key,
 * and may leave a name and an email so we can answer if they leave. An answer arrives live while the chat is open
 * (GET /api/support/events), and by push to the web app and the phone when it is not.
 *
 * Pure helpers on window.NfSupport for the tests (web-site/tests/support.test.mjs).
 */
(function () {
  "use strict";

  var API = typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:5080" : "https://api.notefusion.studio";
  var KEY_STORE = "nf.support.key", HAS_STORE = "nf.support.has", SEEN_STORE = "nf.support.seen", TOKENS_KEY = "nf.web.tokens";
  var CSS = "/assets/support.css?v=1";

  // ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** "site" for the website, "web" for the web app (/app and below). */
  function sourceOf(path) { return /^\/app(\/|$)/.test(path || "") ? "web" : "site"; }

  /** The access token when it is still good for a minute, else null (the chat then speaks as a visitor). */
  function liveToken(tokens, nowMs, decode) {
    var t = tokens && tokens.accessToken;
    if (!t) return null;
    try {
      var claims = JSON.parse(decode(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return claims.exp && claims.exp * 1000 > nowMs + 60000 ? t : null;
    } catch (e) { return null; }
  }

  /** True when the newest message is an answer newer than the last one this browser has shown. */
  function hasUnread(messages, seenAtIso) {
    if (!messages || !messages.length) return false;
    var last = messages[messages.length - 1];
    return !!last.fromAdmin && (!seenAtIso || last.createdAtUtc > seenAtIso);
  }

  /** "14:05" today, or "Mon 14:05" before. */
  function when(iso, now) {
    var d = new Date(iso), n = now || new Date();
    var hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    return d.toDateString() === n.toDateString() ? hm : d.toLocaleDateString(undefined, { weekday: "short" }) + " " + hm;
  }

  window.NfSupport = { sourceOf: sourceOf, liveToken: liveToken, hasUnread: hasUnread, when: when };
  if (typeof document === "undefined" || window.top !== window) return;

  // ── Storage ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage refused */ } }
  function visitorKey() {
    var k = get(KEY_STORE);
    if (k) return k;
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    k = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    set(KEY_STORE, k);
    return k;
  }
  function token() {
    try { return liveToken(JSON.parse(get(TOKENS_KEY) || "null"), Date.now(), atob); } catch (e) { return null; }
  }
  function headers(json) {
    var h = { "X-Support-Key": visitorKey() };
    var t = token();
    if (t) h.Authorization = "Bearer " + t;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  // ── The button ───────────────────────────────────────────────────────────────────────────────────────────────────
  var CHAT_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg>';
  var button = document.createElement("button");
  button.type = "button";
  button.className = "nf-support-btn";
  button.setAttribute("aria-label", "Chat with NoteFusion");
  button.innerHTML = CHAT_ICON + '<span class="nf-support-dot" hidden></span>';
  // Inline so the button is right before support.css has loaded (it loads on the first tap).
  button.style.cssText = "position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:85;width:52px;height:52px;border-radius:50%;border:0;display:grid;place-items:center;cursor:pointer;color:#fff;background:#2563eb;box-shadow:0 10px 24px -8px rgba(37,99,235,.6)";
  function mount() { if (!button.isConnected) document.body.appendChild(button); place(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();

  /** Above the web app's tab bar and the blog's mini player when they are on screen. */
  function place() {
    var lift = 16;
    var bars = document.querySelectorAll(".tabbar, .mini-player");
    for (var i = 0; i < bars.length; i++) {
      var r = bars[i].getBoundingClientRect();
      if (r.height > 0 && getComputedStyle(bars[i]).position === "fixed" && r.bottom >= window.innerHeight - 2) lift = Math.max(lift, r.height + 12);
    }
    button.style.bottom = "calc(" + lift + "px + env(safe-area-inset-bottom))";
  }
  var placing = false;
  function placeSoon() {
    if (placing) return;
    placing = true;
    requestAnimationFrame(function () { placing = false; place(); });
  }
  window.addEventListener("resize", placeSoon);
  new MutationObserver(placeSoon).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });

  // Someone who has written before sees a dot for an answer they have not read.
  if (get(HAS_STORE)) {
    fetch(API + "/api/support/thread", { headers: headers(false) }).then(function (r) { return r.ok ? r.json() : null; }).then(function (t) {
      if (t && hasUnread(t.messages, get(SEEN_STORE))) button.querySelector(".nf-support-dot").hidden = false;
    }).catch(function () {});
  }

  // ── The chat ─────────────────────────────────────────────────────────────────────────────────────────────────────
  var panel = null, list = null, form = null, stream = null, poll = null, thread = null;

  button.addEventListener("click", function () { panel && !panel.hidden ? close() : open(); });
  if (/[?&]support=1(&|$)/.test(location.search)) setTimeout(open, 300);

  function loadCss() {
    if (document.querySelector('link[data-nf-support]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = CSS; l.setAttribute("data-nf-support", "");
    document.head.appendChild(l);
  }

  function build() {
    loadCss();
    panel = document.createElement("section");
    panel.className = "nf-support";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Chat with NoteFusion");
    panel.innerHTML =
      '<header class="nf-support-head"><div><strong>Chat with us</strong><span>We usually answer within a few hours.</span></div>' +
      '<button type="button" class="nf-support-x" aria-label="Close chat">&times;</button></header>' +
      '<div class="nf-support-list" aria-live="polite"></div>' +
      '<form class="nf-support-form">' +
      (token() ? "" : '<div class="nf-support-who"><input name="name" maxlength="80" placeholder="Your name (optional)" autocomplete="name">' +
        '<input name="email" type="email" maxlength="200" placeholder="Email (optional)" title="So we can answer if you leave" autocomplete="email"></div>') +
      '<div class="nf-support-row"><textarea name="body" rows="2" maxlength="2000" placeholder="Ask us anything, or tell us what went wrong" required></textarea>' +
      '<button type="submit" class="nf-support-send" aria-label="Send">Send</button></div>' +
      '<p class="nf-support-err" hidden></p></form>';
    document.body.appendChild(panel);
    list = panel.querySelector(".nf-support-list");
    form = panel.querySelector("form");
    panel.querySelector(".nf-support-x").addEventListener("click", close);
    form.addEventListener("submit", send);
    form.elements.namedItem("body").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) close(); });
  }

  function open() {
    if (!panel) build();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.querySelector(".nf-support-dot").hidden = true;
    refresh().then(listen);
    setTimeout(function () { form.elements.namedItem("body").focus(); }, 50);
    if (window.nfTrack) window.nfTrack("Support opened");
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    stop();
  }

  function render() {
    var messages = (thread && thread.messages) || [];
    var who = panel.querySelector(".nf-support-who");
    if (who) who.hidden = messages.length > 0;   // asked once, before the first message
    if (!messages.length) {
      list.innerHTML = '<p class="nf-support-hello">Hi! Ask a question or tell us about a problem, and a person from NoteFusion will answer here.</p>';
      return;
    }
    list.innerHTML = "";
    messages.forEach(function (m) {
      var row = document.createElement("div");
      row.className = "nf-support-msg" + (m.fromAdmin ? " is-them" : " is-me");
      var bubble = document.createElement("p");
      bubble.textContent = m.body;
      var meta = document.createElement("span");
      meta.textContent = (m.fromAdmin && m.adminName ? m.adminName + " · " : "") + when(m.createdAtUtc);
      row.appendChild(bubble);
      row.appendChild(meta);
      list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
    var last = messages[messages.length - 1];
    set(SEEN_STORE, last.createdAtUtc);
  }

  function refresh() {
    return fetch(API + "/api/support/thread", { headers: headers(false) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (t) { if (t) { thread = t; render(); } })
      .catch(function () {});
  }

  function field(name) { var el = form.elements.namedItem(name); return el ? el.value.trim() || null : null; }

  function send(e) {
    e.preventDefault();
    var body = form.elements.namedItem("body").value.trim();
    if (!body) return;
    var err = form.querySelector(".nf-support-err");
    err.hidden = true;
    form.querySelector(".nf-support-send").disabled = true;
    fetch(API + "/api/support/messages", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({
        body: body, source: sourceOf(location.pathname), path: location.pathname,
        name: field("name"), email: field("email")
      })
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (x) { throw new Error(x.message || "Couldn't send that. Try again."); });
      form.elements.namedItem("body").value = "";
      set(HAS_STORE, "1");
      if (window.nfTrack) window.nfTrack("Support message");
      return refresh().then(function () { if (!stream) listen(); });
    }).catch(function (x) {
      err.textContent = x.message || "Couldn't send that. Try again.";
      err.hidden = false;
    }).then(function () { form.querySelector(".nf-support-send").disabled = false; });
  }

  /** The thread's live stream while the chat is open; a GET every 10 s when a stream cannot be held. */
  function listen() {
    stop();
    if (!thread || !thread.conversationId || !window.fetch || !window.ReadableStream) { pollEvery(); return; }
    var ctl = new AbortController();
    stream = ctl;
    var h = headers(false);
    h.Accept = "text/event-stream";
    fetch(API + "/api/support/events" + (document.hidden ? "?away=true" : ""), { headers: h, signal: ctl.signal, cache: "no-store" })
      .then(function (r) {
        if (!r.ok || !r.body) throw new Error("no stream");
        var reader = r.body.getReader(), decoder = new TextDecoder(), buffer = "";
        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) { if (stream === ctl) { stream = null; listen(); } return; }
            buffer += decoder.decode(chunk.value, { stream: true });
            var parts = buffer.split("\n\n");
            buffer = parts.pop();
            parts.forEach(function (p) { if (/^event: message$/m.test(p)) refresh(); });
            return pump();
          });
        }
        return pump();
      })
      .catch(function () { if (stream === ctl) { stream = null; pollEvery(); } });
  }
  function pollEvery() { if (!poll && panel && !panel.hidden) poll = setInterval(refresh, 10000); }
  function stop() {
    if (stream) { var s = stream; stream = null; s.abort(); }
    if (poll) { clearInterval(poll); poll = null; }
  }
})();
