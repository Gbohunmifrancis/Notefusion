/* Live support: the round chat button on every page of the website and the web app, and the panel it opens: Home (send
 * us a message, with how quickly we typically reply, read off real answers by GET /api/support/info; the help questions
 * with a search; our X), Messages (the chat) and Help (every question, searchable), on a tab bar.
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
  var CSS = "/assets/support.css?v=2";
  var X_URL = "https://x.com/NoteFusion";

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

  /** The line under "Send us a message", from the typical reply time in minutes (null until there is enough to say). */
  function replyPromise(minutes) {
    if (minutes == null || !(minutes >= 0)) return "We usually reply within a few hours";
    var steps = [5, 10, 15, 30];
    for (var i = 0; i < steps.length; i++) if (minutes <= steps[i]) return "We typically reply in under " + steps[i] + " minutes";
    if (minutes <= 60) return "We typically reply in under an hour";
    if (minutes <= 24 * 60) return "We typically reply in under " + Math.ceil(minutes / 60) + " hours";
    return "We typically reply within a day or two";
  }

  /** The help questions matching a search (every word, in the question or its answer), in their order. */
  function searchHelp(items, text) {
    var words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(function (it) {
      var hay = (it.q + " " + it.a).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  /** The help questions: every answer says what NoteFusion does today. */
  var HELP = [
    { q: "What can NoteFusion turn into notation?",
      a: "Humming, singing, an instrument, a choir singing in parts, chords, or a song from a link. You get Tonic Solfa and staff notation, and you can play it back, transpose it and share it." },
    { q: "How many free transcriptions do I get?",
      a: "Three a week from recordings and uploads, read for up to three minutes each. They come back every Friday at 17:00 UTC (6pm in Nigeria). A song from a link, or a recording with the voice taken out of the band, needs Pro or a one-song purchase." },
    { q: "How do I transcribe a song from YouTube?",
      a: "Paste a YouTube, Spotify or Apple Music link, pick the part of the song you want, and we take the singer's voice out of the band and write it down. Pro includes 20 songs a month; on a free account you can buy one song at a time." },
    { q: "What does Pro include?",
      a: "Twenty songs a month from links or with the voice taken out of the band, recordings up to six minutes, a faster queue, and marking when you sing your part back in Practice. The choir plan makes up to 25 singers Pro." },
    { q: "Why are some notes wrong?",
      a: "Record one voice or one instrument at a time, close to the microphone in a quiet room. For a song, paste its link instead of recording a speaker. If the key is off, choose another doh: the notes are written again in that key." },
    { q: "Can it recognise a hymn I hum?",
      a: "Yes. When your tune matches a hymn in our library, we offer you the hymnbook version, words and all. You can also hum on the Hum to find a hymn page without an account." },
    { q: "Can I change the key?",
      a: "Yes. Picking a new doh only renames the notes, the movable-doh way. To move the notes for your choir, use Transpose on the sheet." },
    { q: "How do I save, print or share a sheet?",
      a: "Finished transcriptions go to your Library. Open one to download a PDF, export MusicXML for MuseScore or Sibelius, or share a link anyone can open." },
    { q: "How do I pay?",
      a: "On the website, Nigeria pays in naira through Paystack and everywhere else in US dollars by card, and a membership never renews by itself: buy again to add more time. In the Android app, Google Play handles it." },
    { q: "How do I delete my account?",
      a: "In the app: Profile, Settings, Delete account. On the web, use notefusion.studio/delete-account. Your account and every saved sheet are removed for good." }
  ];

  window.NfSupport = { sourceOf: sourceOf, liveToken: liveToken, hasUnread: hasUnread, when: when, replyPromise: replyPromise,
    searchHelp: searchHelp, HELP: HELP };
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

  // ── The panel ────────────────────────────────────────────────────────────────────────────────────────────────────
  var panel = null, list = null, form = null, stream = null, poll = null, thread = null, view = "home", info = null;

  button.addEventListener("click", function () { panel && !panel.hidden ? close() : open(); });
  if (/[?&]support=1(&|$)/.test(location.search)) setTimeout(function () { open("messages"); }, 300);

  function loadCss() {
    if (document.querySelector('link[data-nf-support]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = CSS; l.setAttribute("data-nf-support", "");
    document.head.appendChild(l);
  }

  function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

  var ICON = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    messages: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    out: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
  };
  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + "</svg>";
  }

  function build() {
    loadCss();
    panel = document.createElement("section");
    panel.className = "nf-support";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Chat with NoteFusion");
    panel.innerHTML =
      // Home
      '<div class="nf-support-view" data-view="home">' +
      '<div class="nf-support-top"><button type="button" class="nf-support-x" aria-label="Close">&times;</button></div>' +
      '<div class="nf-support-scroll">' +
      '<button type="button" class="nf-support-card nf-support-start" data-go="messages"><span><strong class="nf-support-start-title">Send us a message</strong>' +
      '<span class="nf-support-promise">We usually reply within a few hours</span></span>' + icon("chevron", 22) + '</button>' +
      '<div class="nf-support-card nf-support-faq"><label class="nf-support-search">' + icon("search") +
      '<input type="search" placeholder="Search for help" aria-label="Search for help" enterkeyhint="search"></label>' +
      '<ul class="nf-support-qs"></ul></div>' +
      '<a class="nf-support-card nf-support-follow" href="' + X_URL + '" target="_blank" rel="noopener">Follow us on X for the latest updates' + icon("out") + '</a>' +
      '</div></div>' +
      // Messages
      '<div class="nf-support-view" data-view="messages" hidden>' +
      '<header class="nf-support-head"><div><strong>Chat with us</strong><span class="nf-support-promise">We usually reply within a few hours</span></div>' +
      '<button type="button" class="nf-support-x" aria-label="Close chat">&times;</button></header>' +
      '<div class="nf-support-list" aria-live="polite"></div>' +
      '<form class="nf-support-form">' +
      (token() ? "" : '<div class="nf-support-who"><input name="name" maxlength="80" placeholder="Your name (optional)" autocomplete="name">' +
        '<input name="email" type="email" maxlength="200" placeholder="Email (optional)" title="So we can answer if you leave" autocomplete="email"></div>') +
      '<div class="nf-support-row"><textarea name="body" rows="2" maxlength="2000" placeholder="Ask us anything, or tell us what went wrong" required></textarea>' +
      '<button type="submit" class="nf-support-send" aria-label="Send">Send</button></div>' +
      '<p class="nf-support-err" hidden></p></form></div>' +
      // Help
      '<div class="nf-support-view" data-view="help" hidden>' +
      '<header class="nf-support-head"><div><strong>Help</strong></div><button type="button" class="nf-support-x" aria-label="Close">&times;</button></header>' +
      '<div class="nf-support-scroll"><label class="nf-support-search">' + icon("search") +
      '<input type="search" placeholder="Search for help" aria-label="Search for help" enterkeyhint="search"></label>' +
      '<div class="nf-support-answers"></div>' +
      '<p class="nf-support-none" hidden>Nothing here matches. Send us a message and we\u2019ll answer you.</p>' +
      '<button type="button" class="nf-support-card nf-support-still" data-go="messages"><span><strong>Still need help?</strong>' +
      '<span>Send us a message</span></span>' + icon("chevron", 22) + '</button></div></div>' +
      // Tabs
      '<nav class="nf-support-tabs" aria-label="Support">' +
      '<button type="button" data-tab="home">' + icon("home", 22) + '<span>Home</span></button>' +
      '<button type="button" data-tab="messages">' + icon("messages", 22) + '<span>Messages</span></button>' +
      '<button type="button" data-tab="help">' + icon("help", 22) + '<span>Help</span></button></nav>';
    document.body.appendChild(panel);
    list = panel.querySelector(".nf-support-list");
    form = panel.querySelector("form");
    panel.querySelectorAll(".nf-support-x").forEach(function (x) { x.addEventListener("click", close); });
    panel.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { show(b.getAttribute("data-tab")); }); });
    panel.querySelectorAll("[data-go]").forEach(function (b) { b.addEventListener("click", function () { show(b.getAttribute("data-go")); }); });
    form.addEventListener("submit", send);
    form.elements.namedItem("body").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) close(); });

    // Home's four questions open in Help; typing in Home's search carries on in Help.
    var qs = panel.querySelector(".nf-support-qs");
    HELP.slice(0, 4).forEach(function (it, i) {
      var li = document.createElement("li");
      li.innerHTML = '<button type="button"><span>' + esc(it.q) + "</span>" + icon("chevron", 18) + "</button>";
      li.firstChild.addEventListener("click", function () { show("help"); renderHelp("", i); });
      qs.appendChild(li);
    });
    var homeSearch = panel.querySelector('[data-view="home"] input[type="search"]');
    var helpSearch = panel.querySelector('[data-view="help"] input[type="search"]');
    homeSearch.addEventListener("input", function () {
      helpSearch.value = homeSearch.value;
      homeSearch.value = "";
      show("help");
      renderHelp(helpSearch.value);
      helpSearch.focus();
    });
    helpSearch.addEventListener("input", function () { renderHelp(helpSearch.value); });
    renderHelp("");
  }

  function renderHelp(text, openIndex) {
    var box = panel.querySelector(".nf-support-answers");
    var found = searchHelp(HELP, text);
    box.innerHTML = "";
    found.forEach(function (it) {
      var d = document.createElement("details");
      d.className = "nf-support-answer";
      d.innerHTML = "<summary><span>" + esc(it.q) + "</span>" + icon("chevron", 18) + "</summary><p>" + esc(it.a) + "</p>";
      if (openIndex != null && HELP.indexOf(it) === openIndex) d.open = true;
      d.addEventListener("toggle", function () { if (d.open && window.nfTrack) window.nfTrack("Support help opened"); });
      box.appendChild(d);
    });
    panel.querySelector(".nf-support-none").hidden = found.length > 0;
  }

  /** Home's first card: "Send us a message", or the conversation to carry on once there is one. */
  function renderHome() {
    var messages = (thread && thread.messages) || [];
    var title = panel.querySelector(".nf-support-start-title");
    var line = panel.querySelector(".nf-support-start .nf-support-promise");
    if (messages.length) {
      var last = messages[messages.length - 1];
      title.textContent = "Continue the conversation";
      line.textContent = (last.fromAdmin ? "" : "You: ") + (last.body.length > 60 ? last.body.slice(0, 60) + "\u2026" : last.body);
    } else {
      title.textContent = "Send us a message";
      line.textContent = replyPromise(info && info.typicalReplyMinutes);
    }
  }

  function show(next) {
    view = next;
    panel.querySelectorAll(".nf-support-view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== next; });
    panel.querySelectorAll("[data-tab]").forEach(function (b) {
      var on = b.getAttribute("data-tab") === next;
      b.classList.toggle("is-on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    if (next === "messages") {
      render();
      setTimeout(function () { form.elements.namedItem("body").focus(); }, 50);
    }
  }

  function open(start) {
    if (!panel) build();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    var unread = !button.querySelector(".nf-support-dot").hidden;
    button.querySelector(".nf-support-dot").hidden = true;
    show(start || (unread ? "messages" : "home"));
    refresh().then(listen);
    if (!info) {
      fetch(API + "/api/support/info").then(function (r) { return r.ok ? r.json() : null; }).then(function (x) {
        if (!x) return;
        info = x;
        panel.querySelectorAll(".nf-support-head .nf-support-promise").forEach(function (el) { el.textContent = replyPromise(x.typicalReplyMinutes); });
        renderHome();
      }).catch(function () {});
    }
    if (window.nfTrack) window.nfTrack("Support opened");
  }

  function close() {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    stop();
  }

  function render() {
    renderHome();
    if (view !== "messages") return;
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
