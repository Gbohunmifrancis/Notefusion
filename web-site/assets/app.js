/* NoteFusion Web: sign in, paste a link, read the sheet, download it on Pro.
 *
 * Plain script, no build step, like the rest of this site. Talks to the C# API only —
 * never to the Python worker — with a bearer token kept in localStorage and one silent
 * refresh-and-retry on a 401, the same way web-admin's client does it.
 */
(function () {
  "use strict";

  var API =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? "http://localhost:5080"
      : "https://api.notefusion.studio";
  var TOKENS_KEY = "nf.web.tokens";
  var POLL_MS = 2000;
  var DEVICE_KEY = "nf.web.device";

  /** The browser's opaque id, sent as X-Device-Id so the free preview is metered per browser. */
  function deviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (e) { return "anonymous"; }
  }

  // ── Session ──────────────────────────────────────────────────────────────
  function tokens() {
    try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || "null"); } catch (e) { return null; }
  }
  function saveTokens(t) { try { localStorage.setItem(TOKENS_KEY, JSON.stringify(t)); } catch (e) { /* private mode */ } }
  /** First-party analytics (assets/track.js): the action shows on the admin dashboard against this account. */
  function track(name, detail) { try { if (window.nfTrack) window.nfTrack(name, detail); } catch (e) { /* never in the way */ } }
  /** For the step right before leaving the page: sent at once, and waited on briefly (see track.js). */
  function trackNow(name, detail) {
    try { if (window.nfTrackNow) return window.nfTrackNow(name, detail); } catch (e) { /* never in the way */ }
    return Promise.resolve();
  }
  function clearTokens() { try { localStorage.removeItem(TOKENS_KEY); } catch (e) { /* ignore */ } }

  function ApiError(status, body) {
    this.status = status;
    this.code = (body && body.code) || "UNKNOWN";
    this.message = friendlyMessage(status, this.code, body && body.message);
    this.details = (body && body.details) || null;
  }
  /**
   * What a person reads when something fails. The API's own messages for expected failures are
   * written for people and pass through; anything else (a server fault, a provider's reply, a
   * database or stack trace, a bare status) becomes a plain sentence. The console keeps the detail.
   */
  var TECHNICAL = /\b(exception|stack|sql|npgsql|postgres|database|db context|entity framework|null reference|object reference|timeout expired|returned \d{3}|status code|http \d{3}|\d{3} \(|bachs|paystack|flutterwave|squad|stripe|resend|traceback|internal server|[A-Z]{3,}_[A-Z_]{3,})/i;
  function friendlyMessage(status, code, message) {
    if (status === 0 || status === undefined) return "We couldn't reach NoteFusion. Check your connection and try again.";
    if (status === 401) return message && !TECHNICAL.test(message) ? message : "Please sign in again to continue.";
    if (status === 429) return "That's a lot of requests at once. Wait a moment and try again.";
    if (!message || status >= 500 || TECHNICAL.test(message)) {
      try { if (message) console.warn("[notefusion]", status, code, message); } catch (e) { /* ignore */ }
      if (/^BILLING_/.test(code || "")) return "We couldn't open the payment page just now. Please try again in a minute.";
      return "Something went wrong on our side. Please try again in a moment.";
    }
    return message;
  }

  var refreshing = null;
  /**
   * Swaps the refresh token for a new pair. Only the API saying no (400/401) ends the session, and
   * then only if no other tab has rotated the token meanwhile: that tab's new pair is used instead.
   * A network failure, a 5xx or a 429 says nothing about the token, so it is kept for the next try
   * and the request fails with a plain connection line. Rejects with status 401 when the session is over.
   */
  function refresh() {
    if (refreshing) return refreshing;
    var t = tokens();
    if (!t || !t.refreshToken) return Promise.reject(new ApiError(401, null));
    var sent = t.refreshToken;
    refreshing = fetch(API + "/api/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: sent })
    }).catch(function () { throw new ApiError(0, null); }).then(function (r) {
      if (r.status === 400 || r.status === 401) {
        var latest = tokens();
        if (latest && latest.refreshToken && latest.refreshToken !== sent) return latest;
        throw new ApiError(401, null);
      }
      if (!r.ok) throw new ApiError(r.status === 429 ? 429 : 0, null);
      return r.json().catch(function () { throw new ApiError(0, null); }).then(function (pair) {
        saveTokens({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
        return pair;
      });
    }).finally(function () { refreshing = null; });
    return refreshing;
  }
  /** After a refresh that failed: the session ends only when the API refused the token. */
  function refreshFailed(err) {
    if (err && err.status === 401) sessionEnded();
    throw err instanceof ApiError ? err : new ApiError(0, null);
  }

  function request(path, opts) {
    opts = opts || {};
    function send() {
      var headers = { "X-Device-Id": deviceId() };
      var body;
      if (opts.form) { body = opts.form; }
      else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
      if (!opts.anonymous) {
        var t = tokens();
        if (t && t.accessToken) headers.Authorization = "Bearer " + t.accessToken;
      }
      return fetch(API + path, { method: opts.method || "GET", headers: headers, body: body })
        .catch(function () { throw new ApiError(0, null); });
    }
    return send().then(function (r) {
      if (r.status === 401 && !opts.anonymous) {
        return refresh().then(send, refreshFailed);
      }
      return r;
    }).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (text) {
        var parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
        if (!r.ok) throw new ApiError(r.status, parsed);
        return parsed;
      });
    });
  }

  /**
   * A multipart upload that reports how much of it has gone up: fetch cannot, so this one request
   * goes over XMLHttpRequest. Same headers, same 401 refresh-and-retry and the same ApiError as
   * request(); opts.onProgress(fraction) is called as the bytes leave.
   */
  function upload(path, form, opts) {
    opts = opts || {};
    function send() {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", API + path);
        xhr.setRequestHeader("X-Device-Id", deviceId());
        if (!opts.anonymous) {
          var t = tokens();
          if (t && t.accessToken) xhr.setRequestHeader("Authorization", "Bearer " + t.accessToken);
        }
        if (opts.onProgress && xhr.upload) {
          xhr.upload.addEventListener("progress", function (e) { if (e.lengthComputable && e.total > 0) opts.onProgress(Math.min(1, e.loaded / e.total)); });
          xhr.upload.addEventListener("load", function () { opts.onProgress(1); });
        }
        xhr.onerror = xhr.onabort = xhr.ontimeout = function () { reject(new ApiError(0, null)); };
        xhr.onload = function () { resolve({ status: xhr.status, text: xhr.responseText || "" }); };
        xhr.send(form);
      });
    }
    return send().then(function (r) {
      if (r.status === 401 && !opts.anonymous) {
        return refresh().then(send, refreshFailed);
      }
      return r;
    }).then(function (r) {
      if (r.status === 204) return null;
      var parsed = null;
      try { parsed = r.text ? JSON.parse(r.text) : null; } catch (e) { parsed = null; }
      if (r.status < 200 || r.status >= 300) throw new ApiError(r.status, parsed);
      return parsed;
    });
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }
  function alertIn(el, kind, text) {
    el.className = "alert alert-" + kind;
    el.textContent = text;
    show(el);
  }
  function download(name, blob) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function base64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /** A button's content: an icon from the page's sprite and a label. */
  function label(btn, icon, text) { btn.innerHTML = '<svg class="ic"><use href="/assets/icons.svg#i-' + icon + '"/></svg>' + text; }
  function initial(name) { return (name || "?").trim().charAt(0).toUpperCase() || "?"; }
  /** "Good morning, Francis" — the time of day, and the first name when there is one. */
  function greeting(name) {
    var h = new Date().getHours();
    var part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    var first = (name || "").trim().split(/\s+/)[0];
    return first ? part + ", " + first : part;
  }
  /**
   * The account's photo, or the initial of the name when there is none. The initial and the brand
   * gradient stay until the photo has actually loaded, so a link that fails never leaves an empty
   * circle; the latest call wins if an earlier photo finishes loading after it.
   */
  function setAvatar(el, who) {
    var url = (who && who.profilePictureUrl) || "";
    el.textContent = initial(who && (who.fullName || who.email));
    if (url && el.dataset.photo === url && el.classList.contains("has-img")) return;
    el.dataset.photo = url;
    el.style.backgroundImage = "";
    el.classList.remove("has-img");
    if (!url) return;
    var img = new Image();
    img.onload = function () {
      if (el.dataset.photo !== url) return;
      el.style.backgroundImage = 'url("' + url + '")';
      el.classList.add("has-img");
    };
    img.src = url;
  }
  function safeName(text) { return (text || "notefusion").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "notefusion"; }

  // ── Sounds: short synthesised cues for the moments that matter ───────────
  var SOUNDS_KEY = "nf.web.sounds";
  var sfx = {
    ctx: null,
    enabled: function () { try { return localStorage.getItem(SOUNDS_KEY) !== "off"; } catch (e) { return true; } },
    set: function (on) { try { localStorage.setItem(SOUNDS_KEY, on ? "on" : "off"); } catch (e) { /* private mode */ } renderSoundsMenu(); },
    tone: function (freq, at, dur, gain, type) {
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || "sine"; o.frequency.setValueAtTime(freq, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(at); o.stop(at + dur + 0.02);
    },
    play: function (name) {
      if (!this.enabled()) return;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = this.ctx || new AC();
        if (this.ctx.state === "suspended") this.ctx.resume();
        var t = this.ctx.currentTime + 0.01, s = this;
        ({
          start: function () { s.tone(523, t, 0.12); s.tone(659, t + 0.12, 0.16); },
          stop: function () { s.tone(659, t, 0.12); s.tone(523, t + 0.12, 0.18); },
          ready: function () { s.tone(523, t, 0.14); s.tone(659, t + 0.13, 0.14); s.tone(784, t + 0.26, 0.3); },
          saved: function () { s.tone(880, t, 0.22, 0.1); },
          error: function () { s.tone(220, t, 0.25, 0.1, "triangle"); }
        })[name]();
      } catch (e) { /* a sound is a nicety */ }
    },
    /** Makes (or wakes) the context from a click, whatever the switch says, so a cue can play later from a hidden tab. */
    prime: function () {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = this.ctx || new AC();
        if (this.ctx.state === "suspended") this.ctx.resume();
      } catch (e) { /* a sound is a nicety */ }
    }
  };
  /** The account menu's switch and the settings page's switch say the same thing. */
  function renderSoundsMenu() {
    var on = String(sfx.enabled());
    $("menu-sounds").setAttribute("aria-checked", on);
    $("acct-sounds").setAttribute("aria-checked", on);
  }
  function toggleSounds() { sfx.set(!sfx.enabled()); if (sfx.enabled()) sfx.play("saved"); }
  $("menu-sounds").addEventListener("click", toggleSounds);
  $("acct-sounds").addEventListener("click", toggleSounds);

  // ── Theme: Light (the default), Dark, or the same as the device, remembered on this browser ──
  // (the page head applies it before paint)
  var THEME_KEY = "nf.web.theme";
  var darkQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function themePref() {
    var p = null;
    try { p = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    return p === "dark" || p === "system" ? p : "light";
  }
  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
  function applyTheme() {
    var pref = themePref(), next = pref === "system" ? (darkQuery && darkQuery.matches ? "dark" : "light") : pref;
    var root = document.documentElement;
    if (root.getAttribute("data-theme") !== next) {
      // Every colour transition would fire at once and smear the switch: off for the swap, back after a frame.
      var stop = document.createElement("style");
      stop.textContent = "*,*::before,*::after{transition:none!important}";
      document.head.appendChild(stop);
      root.setAttribute("data-theme", next);
      void root.offsetHeight;
      requestAnimationFrame(function () { requestAnimationFrame(function () { stop.remove(); }); });
    }
    var dark = next === "dark";
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", dark ? "#07090E" : "#F4F7FC");
    document.querySelectorAll("[data-theme-pref]").forEach(function (b) {
      var on = b.dataset.themePref === pref;
      b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on));
    });
    var t = $("auth-theme");
    t.innerHTML = '<svg class="ic"><use href="/assets/icons.svg#i-' + (dark ? "sun" : "moon") + '"/></svg>';
    t.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  function setThemePref(pref) {
    var wasDark = isDark();
    try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* private mode */ }
    applyTheme();
    if (isDark() !== wasDark) track(isDark() ? "Dark mode on" : "Dark mode off");
  }
  document.querySelectorAll("[data-theme-pref]").forEach(function (b) {
    b.addEventListener("click", function (e) { e.stopPropagation(); setThemePref(b.dataset.themePref); });
  });
  $("auth-theme").addEventListener("click", function () { setThemePref(isDark() ? "light" : "dark"); });
  // Following the device: a change there (sunset, a settings switch) follows here too.
  if (darkQuery) {
    var onDeviceTheme = function () { if (themePref() === "system") applyTheme(); };
    darkQuery.addEventListener ? darkQuery.addEventListener("change", onDeviceTheme) : darkQuery.addListener(onDeviceTheme);
  }
  applyTheme();
  renderSoundsMenu();

  // ── State ────────────────────────────────────────────────────────────────
  var me = null;          // { fullName, email }
  var sub = null;         // SubscriptionDto
  var current = null;     // { jobId, kind, source, result, savedId, shareToken, semitones }
  var pollTimer = null;
  var osmd = null;
  var C = window.NfChoir;
  var N = window.NfChords;
  var H = window.NfHymnbook;
  var P = window.NfParts;
  var NF = window.NfNotify;
  var guest = false;      // a visitor with a preview and no account
  var previewId = new URLSearchParams(location.search).get("preview");
  var player = null;      // the rehearsal player, made once the first result shows
  var hymnCells = [];     // solfa cells of the hymn layout, for the playback cursor
  var epoch = 0;          // bumped when the work on screen is dropped, so late replies are ignored
  var submitting = false; // an upload is on its way: a second drop or take waits for it
  var transposing = false;
  var choir = null;       // ChoirDto: the choir this account directs or sings in, once asked for

  // ── A choir invite: /app?join=CODE ───────────────────────────────────────
  // Kept across the sign-in (or the sign-up and its emailed code) so the join happens once signed in.
  var JOIN_KEY = "nf.web.join", JOIN_TTL = 24 * 60 * 60 * 1000;
  (function rememberInvite() {
    var code = new URLSearchParams(location.search).get("join");
    if (!code) return;
    try { localStorage.setItem(JOIN_KEY, JSON.stringify({ code: code.slice(0, 40), at: Date.now() })); } catch (e) { /* private mode: the join field still works */ }
  })();
  function pendingJoin() {
    try {
      var p = JSON.parse(localStorage.getItem(JOIN_KEY) || "null");
      return p && p.code && Date.now() - p.at < JOIN_TTL ? String(p.code) : null;
    } catch (e) { return null; }
  }
  function clearJoin() { try { localStorage.removeItem(JOIN_KEY); } catch (e) { /* ignore */ } }
  /** The address a director shares: the web app signs the singer in (or up), then joins them. */
  function inviteUrl(code) { return "https://notefusion.studio/app?join=" + encodeURIComponent(code); }

  // ── Auth view ────────────────────────────────────────────────────────────
  /**
   * Drops the sheet, the job being followed and anything playing or recording, so the next person
   * to sign in on this browser sees none of it, and a reply still on its way renders nothing.
   */
  function resetWork() {
    epoch++;
    stopPolling();
    current = null; keepPreviewJob = null; submitting = false; transposing = false;
    if (player) player.stop();
    cancelSinging(); cancelPracticeTake();
    closeTool(); closeFull();
    hide($("result")); hide($("progress"));
    ["lyrics", "save-title", "share-url"].forEach(function (id) { $(id).value = ""; });
    $("sheet").innerHTML = ""; $("sheet-parts").innerHTML = ""; osmd = null;
    hide($("app-alert"));
  }
  /** Signed out here or in another tab, or the session ran out: nothing of the account stays on screen. */
  function forgetAccount() {
    me = null; sub = null; libraryCache = null; libFolder = null; choir = null;
    stopPaymentWatch(); hide($("top-nav")); document.body.classList.remove("is-pro");
    $("recents-list").innerHTML = "";
  }
  /** The API refused the refresh token: back to the sign-in screen. */
  function sessionEnded() { clearTokens(); forgetAccount(); showAuth(); }

  /** Signing in is a screen of its own: the card and nothing else around it. */
  function showAuth() {
    resetWork();
    hide($("boot-skel")); hide($("view-app")); showAccountUi(false); show($("view-auth")); hide($("auth-back"));
    document.body.classList.add("guest", "auth-only"); hide($("topbar-signin")); closeDrawer(); hide($("onb"));
    if (new URLSearchParams(location.search).get("signup")) selectAuthTab("register");
    // Opened from a choir invite: say what happens after signing in, so the form is not a dead end.
    if (pendingJoin()) {
      $("auth-join").textContent = "You're invited to join a choir on NoteFusion. Sign in, or create a free account, and you'll join it straight after.";
      show($("auth-join"));
    } else hide($("auth-join"));
    // Not on taking over the first paint (assets/app-boot.js): whoever scrolled down to the password stays there.
    if (!document.documentElement.classList.contains("nf-boot")) window.scrollTo(0, 0);
  }
  function leaveAuth() { document.body.classList.remove("auth-only"); hide($("view-auth")); }
  var AUTH_COPY = {
    login: ["Welcome back", "Sign in to open your sheets on any device."],
    register: ["Create your account", "Free to start: 3 hummed or recorded transcriptions every week."],
    verify: ["Check your email", "One code and you're in."]
  };
  function showAuthForm(name) {
    ["login", "register", "verify"].forEach(function (f) { name === f ? show($("form-" + f)) : hide($("form-" + f)); });
    $("auth-title").textContent = AUTH_COPY[name][0]; $("auth-sub").textContent = AUTH_COPY[name][1];
    // Sign in and Create account are one choice; the code step is neither, so the tabs step aside.
    name === "verify" ? hide($("auth-tabs")) : show($("auth-tabs"));
    document.querySelectorAll("#auth-tabs [data-tab]").forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === name)); });
    hide($("auth-alert"));
  }
  /** "Just trying it out?": the 30-second preview, opened under the form. */
  function openTry() {
    show($("try-free")); hide($("try-open")); $("try-open").setAttribute("aria-expanded", "true");
    $("try-free").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  $("try-open").addEventListener("click", openTry);
  function selectAuthTab(name) { showAuthForm(name); }

  // ── Onboarding: three cards on the first visit, and from "How it works" ──
  var ONB_KEY = "nf.web.onboarded";
  var ONB = [
    { title: "Paste a link, hum, or upload",
      body: "A YouTube, Spotify or Apple Music link, a tune you hum into the mic, or a recording from your device. The first 30 seconds are free, no account.",
      art: '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-mic"/></svg>' },
    { title: "Solfa, staff, and the four parts",
      body: "The lead vocal is isolated and written out as movable-do solfa and staff notation. Pro adds alto, tenor and bass under the tune, the way a hymn arranger would.",
      art: '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-music"/></svg>' },
    { title: "Rehearse, transpose, share",
      body: "Play it back, loop a few bars, mute your part and sing against the others. Move the key to fit your singers, then share a link the choir can open.",
      art: '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-choir"/></svg>' }
  ];
  var onbIndex = 0;
  function onbSeen() { try { return !!localStorage.getItem(ONB_KEY); } catch (e) { return true; } }
  function onbMark() { try { localStorage.setItem(ONB_KEY, "1"); } catch (e) { /* private mode */ } }
  function renderOnb() {
    var slide = ONB[onbIndex], last = onbIndex === ONB.length - 1;
    $("onb-art").innerHTML = slide.art;
    $("onb-title").textContent = slide.title;
    $("onb-body").textContent = slide.body;
    var dots = $("onb-dots"); dots.innerHTML = "";
    ONB.forEach(function (_, i) { var d = document.createElement("span"); if (i === onbIndex) d.className = "on"; dots.appendChild(d); });
    onbIndex > 0 ? show($("onb-back")) : hide($("onb-back"));
    $("onb-next").textContent = last ? (me ? "Let's go" : "Try it free") : "Next";
  }
  function openOnb() { onbIndex = 0; renderOnb(); show($("onb")); $("onb-next").focus(); }
  function closeOnb(toTry) {
    onbMark(); hide($("onb"));
    var tryUrl = $("try-url");
    if (toTry && !me && tryUrl && !$("view-auth").classList.contains("hidden")) openTry();
  }
  /** First visit, signed out, no preview in the URL: show the cards once. */
  function maybeOnboard() { if (!onbSeen() && !previewId) openOnb(); }
  $("onb-next").addEventListener("click", function () { if (onbIndex < ONB.length - 1) { onbIndex++; renderOnb(); } else closeOnb(true); });
  $("onb-back").addEventListener("click", function () { if (onbIndex > 0) { onbIndex--; renderOnb(); } });
  $("onb-skip").addEventListener("click", function () { closeOnb(false); });
  $("onb").addEventListener("click", function (e) { if (e.target === $("onb")) closeOnb(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("onb").classList.contains("hidden")) closeOnb(false); });
  document.querySelectorAll(".how-link").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); openOnb(); }); });

  document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { showAuthForm(b.dataset.tab); }); });
  document.querySelectorAll("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var input = $(b.dataset.eye), showing = input.type === "text";
      input.type = showing ? "password" : "text";
      b.innerHTML = '<svg class="ic"><use href="/assets/icons.svg#i-' + (showing ? "eye" : "eye-off") + '"/></svg>';
      b.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });
  // The password rule, ticked off as it is met rather than refused after the fact.
  $("reg-password").addEventListener("input", function () { $("reg-password-hint").classList.toggle("ok", $("reg-password").value.length >= 8); });
  $("forgot").addEventListener("click", function () {
    var email = $("login-email").value.trim();
    if (!email) { alertIn($("auth-alert"), "info", "Type your email above, then press Forgot password."); $("login-email").focus(); return; }
    request("/api/auth/forgot-password", { method: "POST", anonymous: true, body: { email: email } })
      .then(function () { alertIn($("auth-alert"), "success", "If that address has an account, a reset link is on its way."); })
      .catch(function (err) { alertIn($("auth-alert"), "danger", err.message || "Could not send the reset email."); });
  });

  // ── Sign in with Google ──────────────────────────────────────────────────
  // The same OAuth web client the API validates ID tokens against (Google__ClientId). The
  // site's origin has to be listed under that client's authorised JavaScript origins in the
  // Google Cloud console, or the button renders and then refuses to sign anyone in.
  var GOOGLE_CLIENT_ID = "21738378819-3prjgka9cpf6c2l3si6q879vgm06kf6h.apps.googleusercontent.com";
  function onGoogleCredential(res) {
    if (!res || !res.credential) return;
    hide($("auth-alert"));
    request("/api/auth/google", { method: "POST", anonymous: true, body: { idToken: res.credential } })
      .then(function (out) { saveTokens({ accessToken: out.accessToken, refreshToken: out.refreshToken }); track("Signed in with Google"); return boot(); })
      .catch(function (err) { alertIn($("auth-alert"), "danger", err.message || "Google sign-in did not go through."); sfx.play("error"); });
  }
  function initGoogle() {
    if (!window.google || !google.accounts || !google.accounts.id) return;
    try {
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential, ux_mode: "popup", itp_support: true });
      ["google-btn-login", "google-btn-register"].forEach(function (id) {
        var slot = $(id); slot.innerHTML = "";
        // Google draws its own button at a fixed pixel width: the form's width on a phone, at most 400.
        var width = Math.max(240, Math.min(400, window.innerWidth - 48));
        google.accounts.id.renderButton(slot, { theme: "outline", size: "large", shape: "rectangular", text: "continue_with", width: width, logo_alignment: "center" });
        slot.closest("form").classList.add("has-google");
      });
    } catch (e) { googleRow(false); /* the forms work without it */ }
  }
  // The GSI tag is async: it either ran before this file (then google.accounts is here already) or its
  // load event is still to come. A listener, not an onload="" attribute, so the CSP needs no inline script.
  var gsiTag = document.getElementById("gsi-client");
  // The button's row is kept from the start, so the email fields do not jump down when Google's script arrives
  // (seconds later on a phone on 3G); it folds away only if that script cannot load or draw.
  function googleRow(on) { ["form-login", "form-register"].forEach(function (id) { $(id).classList.toggle("has-google", on); }); }
  if (gsiTag) {
    googleRow(true);
    gsiTag.addEventListener("load", initGoogle);
    // The page's load event waits for the async tag, so by then the script has either run or failed (blocked, offline).
    window.addEventListener("load", function () { if (!(window.google && google.accounts && google.accounts.id)) googleRow(false); });
  }
  if (window.google && google.accounts) initGoogle();

  $("form-login").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; hide($("auth-alert"));
    request("/api/auth/login", { method: "POST", anonymous: true, body: { email: $("login-email").value.trim(), password: $("login-password").value } })
      .then(function (res) {
        saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        track("Signed in");
        return boot();
      })
      .catch(function (err) { alertIn($("auth-alert"), "danger", err.message || "Could not sign in."); })
      .finally(function () { btn.disabled = false; });
  });

  $("form-register").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; hide($("auth-alert"));
    // One password field: the eye shows what was typed, so a second copy only slowed sign-up down.
    if ($("reg-password").value.length < 8) { alertIn($("auth-alert"), "danger", "Use at least 8 characters for the password."); btn.disabled = false; return; }
    request("/api/auth/register", { method: "POST", anonymous: true, body: { fullName: $("reg-name").value.trim(), email: $("reg-email").value.trim(), password: $("reg-password").value, source: "web" } })
      .then(function (res) {
        pendingEmail = (res && res.email) || $("reg-email").value.trim();
        track("Created account");
        $("verify-email-label").textContent = pendingEmail;
        showAuthForm("verify");
        alertIn($("auth-alert"), "success", "Almost there — enter the code we just emailed you.");
        $("verify-code").focus();
      })
      .catch(function (err) {
        var detail = err.details ? Object.keys(err.details).map(function (k) { return err.details[k].join(" "); }).join(" ") : "";
        alertIn($("auth-alert"), "danger", (err.message || "Could not create the account.") + (detail ? " " + detail : ""));
      })
      .finally(function () { btn.disabled = false; });
  });

  var pendingEmail = "";
  $("form-verify").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; hide($("auth-alert"));
    request("/api/auth/verify-email", { method: "POST", anonymous: true, body: { email: pendingEmail, code: $("verify-code").value.trim() } })
      .then(function (res) {
        saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        track("Verified email");
        showAuthForm("login");
        return boot();
      })
      .catch(function (err) { alertIn($("auth-alert"), "danger", err.message || "That code did not match."); })
      .finally(function () { btn.disabled = false; });
  });
  $("verify-resend").addEventListener("click", function () {
    request("/api/auth/resend-verification", { method: "POST", anonymous: true, body: { email: pendingEmail } })
      .then(function () { alertIn($("auth-alert"), "success", "A new code is on its way."); })
      .catch(function (err) { alertIn($("auth-alert"), "danger", err.message || "Could not resend the code."); });
  });

  // Guest → account: the sign-up screen on its own, with a way back to the preview that is waiting.
  function openAuth(tab) {
    hide($("view-app")); show($("view-auth"));
    document.body.classList.add("auth-only"); closeDrawer();
    guest ? show($("auth-back")) : hide($("auth-back"));
    showAuthForm(tab);
    window.scrollTo(0, 0);
  }
  $("auth-back").addEventListener("click", function () { leaveAuth(); show($("view-app")); });
  ["guest-signup", "guest-cta-signup"].forEach(function (id) { $(id).addEventListener("click", function () { openAuth("register"); }); });
  ["guest-signin", "guest-cta-signin"].forEach(function (id) { $(id).addEventListener("click", function () { openAuth("login"); }); });

  // The API is told first, while the tokens are still here to say whose session ends; its answer
  // (or none, after a few seconds) does not hold the sign-out up.
  var signingOut = false;
  $("signout").addEventListener("click", function () {
    if (signingOut) return;
    signingOut = true;
    var t = tokens();
    var told = t && t.refreshToken
      ? Promise.race([
          Promise.all([
            // Before the session goes: this browser stops getting this account's notifications.
            NF.pushOff(window, request, true),
            request("/api/auth/logout", { method: "POST", body: { refreshToken: t.refreshToken } }).catch(function () { /* best effort */ })
          ]),
          new Promise(function (resolve) { setTimeout(resolve, 3000); })
        ])
      : Promise.resolve();
    told.then(function () {
      signingOut = false;
      pushAskedFor = null;
      clearTokens(); forgetAccount(); clearCheckout(); showAuth();
    });
  });
  // Signed out in another tab: this one follows rather than carrying on with a session that is gone.
  window.addEventListener("storage", function (e) {
    if (e.key !== TOKENS_KEY && e.key !== null) return;
    if (tokens() || guest || document.body.classList.contains("auth-only")) return;
    forgetAccount(); showAuth();
  });

  // ── Views: transcribe / library / account ───────────────────────────────
  function setView(name) {
    var focusSearch = name === "search";
    if (focusSearch) name = "library";
    ["transcribe", "library", "account"].forEach(function (v) { v === name ? show($("view-" + v)) : hide($("view-" + v)); });
    document.querySelectorAll("#top-nav .top-link").forEach(function (b) { b.classList.toggle("on", b.dataset.view === name); });
    if (name === "library") loadLibrary().then(function () { if (focusSearch) $("lib-search").focus(); });
    if (name === "account") renderAccount();
    closeDrawer(); closeUserMenu();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll("#top-nav .top-link, .user-menu-item[data-view]").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });

  // The sidebar is a drawer on phones.
  function openDrawer() { document.body.classList.add("drawer-open"); $("drawer-backdrop").hidden = false; $("drawer-toggle").setAttribute("aria-expanded", "true"); }
  function closeDrawer() { document.body.classList.remove("drawer-open"); $("drawer-backdrop").hidden = true; $("drawer-toggle").setAttribute("aria-expanded", "false"); }
  $("drawer-toggle").addEventListener("click", function () { document.body.classList.contains("drawer-open") ? closeDrawer() : openDrawer(); });
  $("drawer-close").addEventListener("click", closeDrawer);
  $("drawer-backdrop").addEventListener("click", closeDrawer);

  // The photo in the top bar (phones) and the account chip (wide screens) open the same small menu.
  var accountTriggers = document.querySelectorAll(".account-trigger");
  function closeUserMenu() { hide($("user-menu")); accountTriggers.forEach(function (t) { t.setAttribute("aria-expanded", "false"); }); }
  accountTriggers.forEach(function (t) {
    t.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = $("user-menu").classList.contains("hidden");
      closeUserMenu();
      if (open) { show($("user-menu")); t.setAttribute("aria-expanded", "true"); }
    });
  });
  document.addEventListener("click", function (e) { if (!$("user-menu").contains(e.target)) closeUserMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeUserMenu(); });
  /** The account's way in (photo, chip, sidebar foot): there only while someone is signed in. */
  function showAccountUi(on) {
    ["topbar-avatar", "app-head", "side-foot"].forEach(function (id) { on ? show($(id)) : hide($(id)); });
    if (!on) closeUserMenu();
  }
  $("menu-plans").addEventListener("click", function () { closeUserMenu(); openUpgrade(); });
  $("menu-how").addEventListener("click", function (e) { e.preventDefault(); closeUserMenu(); closeDrawer(); openOnb(); });
  $("topbar-signin").addEventListener("click", function () { openAuth("login"); });
  $("recents-all").addEventListener("click", function () { setView("library"); });

  /** The saved sheets, fetched once and shared by the library, the account view and the sidebar. */
  function fetchLibrary(force) {
    var p = libraryCache && !force ? Promise.resolve(libraryCache) : request("/api/library").then(function (items) { libraryCache = items || []; return libraryCache; });
    return p.then(function (items) { renderRecents(items); return items; });
  }
  function renderRecents(items) {
    var list = $("recents-list"); list.innerHTML = "";
    (items || []).slice(0, 6).forEach(function (it) {
      var b = document.createElement("button"); b.type = "button"; b.className = "recent-item"; b.setAttribute("data-track", "Recent sheet"); b.textContent = it.title || "Untitled"; b.title = it.title || "Untitled";
      b.addEventListener("click", function () { openSaved(it.id); });
      list.appendChild(b);
    });
    (items && items.length) ? show($("recents")) : hide($("recents"));
  }

  var libraryCache = null;
  var libFolder = null; // the folder chip selected; null is "All"
  function foldersOf(items) {
    var seen = {};
    (items || []).forEach(function (it) { if (it.folder) seen[it.folder] = (seen[it.folder] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); }).map(function (name) { return { name: name, count: seen[name] }; });
  }
  /** Folder chips over the list, and the bar to share or rename the chosen folder. */
  function renderFolders(items) {
    var folders = foldersOf(items), box = $("lib-folders");
    if (libFolder && !folders.some(function (f) { return f.name === libFolder; })) libFolder = null;
    box.innerHTML = "";
    if (!folders.length) { hide(box); hide($("lib-folder-bar")); return; }
    [{ name: null, count: items.length }].concat(folders).forEach(function (f) {
      var chip = document.createElement("button"); chip.type = "button"; chip.className = "lib-chip" + (f.name === libFolder ? " on" : "");
      chip.setAttribute("role", "tab"); chip.setAttribute("aria-selected", String(f.name === libFolder)); chip.setAttribute("data-track", f.name ? "Folder chip" : "All folders chip");
      chip.textContent = (f.name || "All") + " · " + f.count;
      chip.addEventListener("click", function () { libFolder = f.name; renderFolders(libraryCache || []); filterLibrary(); });
      box.appendChild(chip);
    });
    show(box);
    if (libFolder) {
      $("lib-folder-name").textContent = libFolder;
      hide($("lib-folder-share-row"));
      show($("lib-folder-bar"));
    } else hide($("lib-folder-bar"));
  }
  function filterLibrary() {
    var q = $("lib-search").value.trim().toLowerCase();
    document.querySelectorAll("#lib-list .lib-item").forEach(function (card) {
      var match = (!q || card.dataset.title.indexOf(q) >= 0) && (!libFolder || card.dataset.folder === libFolder);
      card.classList.toggle("hidden", !match);
    });
  }
  /** Files a sheet: an existing folder, a new one, or none. */
  function fileSheet(it, value, select) {
    var name = value;
    if (value === "__new") {
      name = (window.prompt("Name the new folder (for example: Sunday choir, Easter service):", "") || "").trim();
      if (!name) { select.value = it.folder || ""; return; }
    }
    select.disabled = true;
    request("/api/library/" + it.id + "/folder", { method: "PUT", body: { folder: name || null } })
      .then(function () { it.folder = name || null; track("Filed sheet"); loadLibrary(false); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not move the sheet: " + (err.message || err)); select.value = it.folder || ""; })
      .finally(function () { select.disabled = false; });
  }
  $("lib-folder-share").addEventListener("click", function () {
    if (!libFolder) return;
    var btn = $("lib-folder-share"); btn.disabled = true;
    request("/api/library/folders/share", { method: "POST", body: { folder: libFolder } })
      .then(function (link) {
        $("lib-folder-url").value = link.url || ("https://notefusion.studio/app/sheet/?f=" + encodeURIComponent(link.token));
        show($("lib-folder-share-row")); $("lib-folder-url").select(); track("Shared folder"); libraryCache = null;
      })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not share the folder: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("lib-folder-copy").addEventListener("click", function () {
    var url = $("lib-folder-url").value;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { $("lib-folder-copy").textContent = "Copied"; setTimeout(function () { $("lib-folder-copy").textContent = "Copy"; }, 1500); }, function () { $("lib-folder-url").select(); });
  });
  $("lib-folder-stop").addEventListener("click", function () {
    if (!libFolder) return;
    request("/api/library/folders/share?folder=" + encodeURIComponent(libFolder), { method: "DELETE" })
      .then(function () { hide($("lib-folder-share-row")); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not stop sharing: " + (err.message || err)); });
  });
  $("lib-folder-rename").addEventListener("click", function () {
    if (!libFolder) return;
    var to = (window.prompt("Rename “" + libFolder + "” to:", libFolder) || "").trim();
    if (!to || to === libFolder) return;
    request("/api/library/folders", { method: "PUT", body: { from: libFolder, to: to } })
      .then(function () { libFolder = to; libraryCache = null; loadLibrary(true); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not rename the folder: " + (err.message || err)); });
  });

  function loadLibrary(force) {
    var list = $("lib-list"), empty = $("lib-empty"), skel = $("lib-skel");
    if (!libraryCache || force) { show(skel); hide(list); hide(empty); }
    return fetchLibrary(force).then(function (items) {
      hide(skel);
      list.innerHTML = "";
      if (!items.length) { show(empty); hide(list); return; }
      hide(empty); show(list);
      renderFolders(items);
      var folders = foldersOf(items);
      items.forEach(function (it) {
        var card = document.createElement("div"); card.className = "lib-item"; card.dataset.title = (it.title || "Untitled").toLowerCase(); card.dataset.folder = it.folder || "";
        var badge = document.createElement("span"); badge.className = "lib-key"; badge.textContent = String(it.key || "♪").replace(/\s*(major|minor)$/i, function (m) { return /minor/i.test(m) ? "m" : ""; }); card.appendChild(badge);
        var h = document.createElement("h3"); h.textContent = it.title || "Untitled"; card.appendChild(h);
        var m = document.createElement("div"); m.className = "meta";
        m.textContent = [it.key, it.tempoBpm ? it.tempoBpm + " BPM" : "", it.timeSignature, new Date(it.createdAtUtc).toLocaleDateString()].filter(Boolean).join(" · ") + (it.shareToken ? " · shared" : "") + (it.sharedWithChoir ? " · in the choir library" : "");
        card.appendChild(m);
        if (it.folder) { var tag = document.createElement("span"); tag.className = "lib-folder-tag"; tag.textContent = it.folder; card.appendChild(tag); }
        var a = document.createElement("div"); a.className = "actions";
        var file = document.createElement("select"); file.className = "lib-file"; file.setAttribute("aria-label", "Folder for " + (it.title || "Untitled"));
        [["", "No folder"]].concat(folders.map(function (f) { return [f.name, f.name]; })).concat([["__new", "New folder…"]]).forEach(function (o) {
          var opt = document.createElement("option"); opt.value = o[0]; opt.textContent = o[1]; file.appendChild(opt);
        });
        file.value = it.folder || "";
        file.addEventListener("change", function () { fileSheet(it, file.value, file); });
        var open = document.createElement("button"); open.className = "btn btn-primary btn-sm"; open.type = "button"; open.textContent = "Open";
        open.addEventListener("click", function () { openSaved(it.id); });
        var del = document.createElement("button"); del.className = "btn btn-ghost btn-sm btn-danger"; del.type = "button"; label(del, "trash", "Delete");
        del.addEventListener("click", function () {
          if (!confirm("Delete \u201c" + (it.title || "Untitled") + "\u201d from your library? This cannot be undone." +
            (isPro() ? " Deleting won't give back a song it used." : " Deleting won't give back the free transcription it used."))) return;
          del.disabled = true;
          request("/api/library/" + it.id, { method: "DELETE" }).then(function () { libraryCache = null; loadLibrary(true); refreshUsage(); })
            .catch(function (err) { alertIn($("app-alert"), "danger", "Could not delete: " + (err.message || err)); del.disabled = false; });
        });
        a.appendChild(open); a.appendChild(file);
        if (sub && sub.choirName) a.appendChild(choirShareButton(it));
        a.appendChild(del); card.appendChild(a);
        list.appendChild(card);
      });
      filterLibrary();
    }).catch(function (err) { hide(skel); show(empty); $("lib-empty-text").textContent = "Your library could not be loaded: " + (err.message || err); })
      .then(renderChoirLibrary);
  }

  // ── The choir's shared library ──────────────────────────────────────────
  /** "Share with choir" on one of the account's own sheets, or "In choir library" to take it out again. */
  function choirShareButton(it) {
    var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm";
    function paint() { b.textContent = it.sharedWithChoir ? "In choir library ✓" : "Share with choir"; b.title = it.sharedWithChoir ? "Take it out of the choir library" : "Share it with everyone in " + sub.choirName; }
    paint();
    b.addEventListener("click", function () {
      var on = !it.sharedWithChoir;
      b.disabled = true;
      request("/api/choirs/mine/sheets/" + encodeURIComponent(it.id), { method: on ? "PUT" : "DELETE" })
        .then(function () { it.sharedWithChoir = on; paint(); track(on ? "Shared with choir" : "Unshared from choir"); if (on) sfx.play("saved"); renderChoirLibrary(); })
        .catch(function (err) { alertIn($("app-alert"), "danger", "Could not share with your choir: " + (err.message || err)); })
        .finally(function () { b.disabled = false; });
    });
    return b;
  }
  /** The sheets the choir shared, under the account's own; only while the choir's plan runs. */
  function renderChoirLibrary() {
    var box = $("choir-lib");
    if (!sub || !sub.choirName) { hide(box); return; }
    $("choir-lib-name").textContent = sub.choirName;
    return request("/api/choirs/mine/sheets").then(function (items) {
      var list = $("choir-lib-list"); list.textContent = "";
      items = items || [];
      if (items.length) { hide($("choir-lib-empty")); show(list); } else { show($("choir-lib-empty")); hide(list); }
      items.forEach(function (it) {
        var card = document.createElement("div"); card.className = "lib-item";
        var badge = document.createElement("span"); badge.className = "lib-key"; badge.textContent = String(it.key || "♪").replace(/\s*(major|minor)$/i, function (m) { return /minor/i.test(m) ? "m" : ""; }); card.appendChild(badge);
        var h = document.createElement("h3"); h.textContent = it.title || "Untitled"; card.appendChild(h);
        var m = document.createElement("div"); m.className = "meta";
        var opening = (it.preview || []).map(function (n) { return (n.solfa || "") + (n.octaveMark || ""); }).join(" ");
        m.textContent = [it.mine ? "Shared by you" : "Shared by " + it.sharedBy, it.key, opening].filter(Boolean).join(" · ");
        card.appendChild(m);
        var a = document.createElement("div"); a.className = "actions";
        var open = document.createElement("button"); open.className = "btn btn-primary btn-sm"; open.type = "button"; open.textContent = "Open";
        open.addEventListener("click", function () { openChoirSheet(it.id); });
        a.appendChild(open);
        if (it.canUnshare) {
          var out = document.createElement("button"); out.className = "btn btn-ghost btn-sm"; out.type = "button"; out.textContent = "Take out";
          out.title = it.mine ? "It stays in your own library" : "It stays in " + it.sharedBy + "'s own library";
          out.addEventListener("click", function () {
            out.disabled = true;
            request("/api/choirs/mine/sheets/" + encodeURIComponent(it.id), { method: "DELETE" })
              .then(function () { track("Unshared from choir"); if (it.mine) libraryCache = null; return it.mine ? loadLibrary(true) : renderChoirLibrary(); })
              .catch(function (err) { alertIn($("app-alert"), "danger", "Could not take it out: " + (err.message || err)); out.disabled = false; });
          });
          a.appendChild(out);
        }
        card.appendChild(a);
        list.appendChild(card);
      });
      show(box);
    }).catch(function () { hide(box); });
  }
  /** A choir sheet, read-only, in the result view: saving it makes the singer's own copy, never touches the original. */
  function openChoirSheet(id) {
    stopPolling();
    var at = epoch;
    request("/api/choirs/mine/sheets/" + encodeURIComponent(id)).then(function (t) {
      if (at !== epoch) return;
      var result = {
        key: t.key, tempo: t.tempoBpm, timeSignature: t.timeSignature, notes: t.notes || [], musicXml: t.musicXml || "",
        overallConfidence: 1, parts: t.parts || null, partsMusicXml: t.partsMusicXml || "",
        chords: t.chords || null, chordsSource: t.chords && t.chords.length ? "heard" : null,
        solfaLines: C.renderLines(t.notes || [], C.keyHeader(t.key), t.timeSignature), source: null, hymn: t.hymn || null
      };
      current = { jobId: null, kind: "choir", source: null, result: result, startedAt: Date.now(), savedId: null, title: t.title, shareToken: null, lyrics: t.lyrics || "", semitones: 0 };
      setView("transcribe");
      hide($("progress"));
      $("sheet-parts").innerHTML = "";
      $("save-title").value = t.title || "";
      track("Opened choir sheet");
      showResult(result);
      $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (err) { if (at === epoch) alertIn($("app-alert"), "danger", "Could not open that sheet: " + (err.message || err)); });
  }
  $("lib-empty-go").addEventListener("click", function () { setView("transcribe"); selectSource("link"); $("link-url").focus(); });
  $("lib-search").addEventListener("input", filterLibrary);
  /** A saved sheet, opened into the same result view a fresh transcription uses. */
  function openSaved(id) {
    stopPolling();
    var at = epoch;
    request("/api/library/" + id).then(function (t) {
      if (at !== epoch) return; // signed out while it loaded
      var result = {
        key: t.key, tempo: t.tempoBpm, timeSignature: t.timeSignature, notes: t.notes || [], musicXml: t.musicXml || "",
        overallConfidence: t.overallConfidence || 0, parts: t.parts || null, partsMusicXml: t.partsMusicXml || "",
        chords: t.chords || null, chordsSource: t.chords && t.chords.length ? "heard" : null,
        solfaLines: C.renderLines(t.notes || [], C.keyHeader(t.key), t.timeSignature), source: null, hymn: t.hymn || null
      };
      current = { jobId: null, kind: "library", source: null, result: result, startedAt: Date.now(), savedId: t.id, title: t.title, shareToken: t.shareToken || null, lyrics: t.lyrics || "", semitones: 0 };
      setView("transcribe");
      hide($("progress"));
      $("sheet-parts").innerHTML = "";
      showResult(result);
      $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (err) { if (at === epoch) alertIn($("app-alert"), "danger", "Could not open that sheet: " + (err.message || err)); });
  }

  function renderAccount() {
    renderNotifySettings();
    $("acct-name").textContent = me ? (me.fullName || "—") : "—";
    setAvatar($("acct-avatar"), me);
    (me && me.profilePictureUrl) ? show($("acct-photo-remove")) : hide($("acct-photo-remove"));
    $("acct-email").textContent = me ? (me.email || "—") : "—";
    $("acct-plan").textContent = isPro() ? planLabel() : "Free plan";
    isPro() ? show($("acct-active")) : hide($("acct-active"));
    var badge = $("acct-badge"); badge.textContent = isPro() ? "Pro" : "Free"; badge.className = "pill " + (isPro() ? "pill-pro" : "pill-free");
    var u = usage();
    $("acct-usage-label").textContent = u ? u.label : "This month";
    $("acct-credits").textContent = u ? u.left + " of " + u.total + " left · " + (isPro() ? "resets " + resetDay() : freeNote(u).replace(/^R/, "r")) : "—";
    fillMeter($("acct-usage-fill"), u);
    $("acct-sub-note").textContent = isPro()
      ? periodLine() + (sub && (sub.isLifetime || sub.isGift) ? "" : " Nothing renews by itself; add time whenever you like.")
      : "Pro adds 20 songs a month, full songs up to six minutes, four-part harmony and every download format.";
    $("acct-upgrade-label").textContent = isPro() ? (sub && (sub.isLifetime || sub.isGift) ? "My membership" : "Add another month") : "See the plans";
    var since = me && (me.createdAtUtc || me.createdAt);
    $("acct-since").textContent = since ? new Date(since).toLocaleDateString(undefined, { year: "numeric", month: "short" }) : "—";
    fetchLibrary().then(function (items) { $("acct-saved").textContent = String(items.length); }, function () { $("acct-saved").textContent = "—"; });
    renderChoirPanel();
  }
  $("acct-upgrade").addEventListener("click", openUpgrade);

  // ── My choir (Account & settings) ───────────────────────────────────────
  /** The account's choir, as director or singer; null when it is in none (the API answers 404). */
  function fetchChoir() {
    return request("/api/choirs/mine").then(function (c) { choir = c; return c; }, function (err) {
      if (err && err.status === 404) { choir = null; return null; }
      throw err;
    });
  }
  function longDate(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : ""; }
  function renderChoirPanel() {
    return fetchChoir().then(function (c) {
      if (!c) { show($("choir-none")); hide($("choir-card")); return; }
      hide($("choir-none")); show($("choir-card"));
      var director = c.role === "director";
      $("choir-title").textContent = director ? c.name + " · you direct it" : c.name + " · directed by " + c.directorName;
      var st = $("choir-status"); st.textContent = c.isActive ? "Active" : "Ended"; st.className = "pill " + (c.isActive ? "pill-active" : "pill-ended");
      if (director) { show($("choir-rename-row")); if (document.activeElement !== $("choir-name")) $("choir-name").value = c.name; }
      else hide($("choir-rename-row"));
      $("choir-seats").textContent = c.seatsUsed + " of " + c.seatsTotal;
      fillMeter($("choir-seats-fill"), { left: c.seatsUsed, total: c.seatsTotal });
      $("choir-note").textContent = c.isActive
        ? "Pro for " + (director ? "you and " : "") + "every singer until " + longDate(c.currentPeriodEndUtc) + ". " + c.songCreditsRemaining + " of " + c.songCreditsTotal + " choir songs left this month."
        : "The choir's plan ended on " + longDate(c.currentPeriodEndUtc) + "." + (director ? " Renew it to give your singers Pro again." : " Ask your director to renew it.");
      if (director && c.inviteCode) {
        $("choir-invite-url").value = inviteUrl(c.inviteCode);
        $("choir-invite-code").textContent = c.inviteCode;
        show($("choir-invite-row"));
      } else hide($("choir-invite-row"));
      director && !c.isActive ? show($("choir-renew")) : hide($("choir-renew"));
      director ? hide($("choir-leave")) : show($("choir-leave"));
      if (director) loadChoirMembers(); else hide($("choir-members-row"));
    }).catch(function () { /* the panel keeps what it showed; the next visit asks again */ });
  }
  function loadChoirMembers() {
    request("/api/choirs/mine/members").then(function (list) {
      var ul = $("choir-members"); ul.textContent = "";
      (list || []).forEach(function (m) {
        var li = document.createElement("li");
        var name = document.createElement("span"); name.textContent = m.name || "A singer";
        var rm = document.createElement("button"); rm.type = "button"; rm.className = "btn btn-ghost btn-sm btn-danger"; rm.textContent = "Remove";
        rm.setAttribute("aria-label", "Remove " + (m.name || "this singer") + " from the choir");
        rm.addEventListener("click", function () {
          if (!confirm("Remove " + (m.name || "this singer") + " from the choir? They lose Pro through it, and the sheets they shared leave the choir library.")) return;
          rm.disabled = true;
          request("/api/choirs/mine/members/" + encodeURIComponent(m.userId), { method: "DELETE" })
            .then(function () { track("Removed choir singer"); renderChoirPanel(); })
            .catch(function (err) { alertIn($("app-alert"), "danger", "Could not remove the singer: " + (err.message || err)); rm.disabled = false; });
        });
        li.appendChild(name); li.appendChild(rm); ul.appendChild(li);
      });
      if (!list || !list.length) {
        var none = document.createElement("li"); none.className = "muted"; none.textContent = "No one has joined yet. Send your singers the invite link.";
        ul.appendChild(none);
      }
      show($("choir-members-row"));
    }).catch(function () { hide($("choir-members-row")); });
  }
  /** Joins with a code; once in, the account is Pro, so everything that shows the plan is read again. */
  function joinChoir(code) {
    $("choir-join-status").textContent = "";
    return request("/api/choirs/join", { method: "POST", body: { code: code } }).then(function (c) {
      choir = c;
      track("Joined choir");
      $("choir-join-code").value = "";
      return loadAccount().then(function () {
        setView("account");
        alertIn($("app-alert"), "success", "Welcome to " + c.name + ". You have Pro while the choir's plan runs, and its shared sheets are under Transcriptions.");
        sfx.play("saved");
      });
    }).catch(function (err) {
      var text = (err && err.message) || "We couldn't join that choir just now.";
      $("choir-join-status").textContent = text;
      alertIn($("app-alert"), "danger", "Could not join the choir: " + text);
    });
  }
  /** After signing in from an invite link: asked once, because an account sings in one choir. */
  function maybeJoinFromInvite() {
    var code = pendingJoin();
    dropParam("join");
    if (!code) return;
    clearJoin();
    if (!confirm("Join the choir with code " + code + "? You'll have Pro while its plan runs. An account can be in one choir at a time.")) return;
    joinChoir(code);
  }
  $("choir-join-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("choir-join-code").value.trim();
    // A pasted invite link works as well as the bare code.
    var fromLink = /[?&]join=([^&#\s]+)/.exec(code);
    if (fromLink) code = decodeURIComponent(fromLink[1]);
    if (!code) { $("choir-join-status").textContent = "Enter the code your choir director gave you."; return; }
    var btn = $("choir-join-btn"); btn.disabled = true;
    joinChoir(code).finally(function () { btn.disabled = false; });
  });
  $("choir-rename-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("choir-name").value.trim();
    if (!name || (choir && name === choir.name)) return;
    var btn = $("choir-name-save"); btn.disabled = true;
    request("/api/choirs/mine", { method: "PUT", body: { name: name } })
      .then(function (c) { choir = c; track("Renamed choir"); return loadAccount().then(renderChoirPanel); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not rename the choir: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("choir-invite-copy").addEventListener("click", function () {
    var url = $("choir-invite-url").value, btn = $("choir-invite-copy");
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
      track("Copied choir invite"); btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy link"; }, 1500);
    }, function () { $("choir-invite-url").select(); });
  });
  $("choir-invite-new").addEventListener("click", function () {
    if (!confirm("Make a new invite code? The old code and link stop working at once. Singers already in the choir stay in.")) return;
    request("/api/choirs/mine/invite", { method: "POST" })
      .then(function (c) { choir = c; track("New choir invite code"); renderChoirPanel(); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not make a new code: " + (err.message || err)); });
  });
  $("choir-leave").addEventListener("click", function () {
    if (!confirm("Leave the choir? You lose Pro through it, and the sheets you shared leave its library. They stay in yours.")) return;
    request("/api/choirs/leave", { method: "POST" })
      .then(function () { choir = null; track("Left choir"); libraryCache = null; return loadAccount().then(renderAccount); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not leave the choir: " + (err.message || err)); });
  });
  $("choir-plan-open").addEventListener("click", function () { openUpgrade(); });
  $("choir-renew").addEventListener("click", function () { openUpgrade(); });
  $("acct-photo").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var form = new FormData(); form.append("image", file, file.name);
    $("acct-photo-status").textContent = "Uploading…";
    request("/api/me/picture", { method: "POST", form: form })
      .then(function (profile) { return profile || request("/api/me"); })
      .then(function (profile) { me = profile; $("acct-photo-status").textContent = ""; renderWho(); renderAccount(); sfx.play("saved"); })
      .catch(function (err) { $("acct-photo-status").textContent = (err instanceof ApiError && err.message) || "We couldn't upload that photo. Please try again."; sfx.play("error"); })
      .finally(function () { e.target.value = ""; });
  });
  $("acct-photo-remove").addEventListener("click", function () {
    request("/api/me/picture", { method: "DELETE" })
      .then(function () { return request("/api/me"); })
      .then(function (profile) { me = profile; renderWho(); renderAccount(); })
      .catch(function (err) { $("acct-photo-status").textContent = err.message || "Could not remove the photo."; });
  });

  // ── Upgrade dialog ──────────────────────────────────────────────────────
  /**
   * The plans dialog. reason "limit" is the free allowance running out (the refusal after the last one):
   * the one-song purchase is then the option already chosen, since one more song is what was just asked for.
   */
  function openUpgrade(reason) {
    track("Opened plans");
    track("Plans viewed", "app"); // the checkout funnel's top step (CheckoutSteps in the API)
    if (isPro()) { renderMembership(); show($("upgrade-panel")); return; }
    $("upgrade-title-text").textContent = "Do more with NoteFusion";
    show($("upgrade-free")); hide($("upgrade-pro"));
    loadPlans($("upgrade-panel"), $("plans-standalone"), { single: true, singleFirst: reason === "limit", choir: true });
  }
  /** Pro through a choir alone: the plan shown is the choir's, renewed by its director. */
  function proViaChoir() { return !!(sub && sub.choirRole && String(sub.planCode || "").indexOf("choir_") === 0); }
  /** What a member's plan is called: the server's plan name, or the kind of access when nothing was bought. */
  function planLabel() {
    if (!sub) return "NoteFusion Pro";
    if (sub.isLifetime) return "NoteFusion Pro — Lifetime";
    if (sub.isGift) return "NoteFusion Pro — Complimentary";
    return sub.planName || "NoteFusion Pro";
  }
  /** One sentence on how long the membership runs. */
  function periodLine() {
    if (!sub) return "";
    if (sub.isLifetime) return "Yours for life; nothing renews.";
    var when = sub.currentPeriodEndUtc ? new Date(sub.currentPeriodEndUtc).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    if (sub.isGift) return when ? "A gift from the NoteFusion team, Pro until " + when + "." : "A gift from the NoteFusion team.";
    if (!when) return "Your membership is active.";
    return "Pro until " + when + ".";
  }
  function creditsLine() { return sub ? sub.songCreditsRemaining + " of " + sub.songCreditsTotal + " songs left · resets " + resetDay() : "—"; }
  /** The plans dialog for a member: the membership, with nothing for sale. */
  function renderMembership() {
    $("upgrade-title-text").textContent = "Your Pro membership";
    hide($("upgrade-free")); show($("upgrade-pro"));
    $("upgrade-pro-plan").textContent = planLabel();
    $("upgrade-pro-period").textContent = periodLine();
    $("upgrade-pro-credits").textContent = creditsLine();
    // A singer's Pro is the choir's: the director renews it, so a singer is shown it rather than offered more of it.
    var singer = proViaChoir() && sub.choirRole === "member";
    if (singer) $("upgrade-pro-period").textContent = "Pro through " + sub.choirName + ". " + periodLine() + " Your choir director renews it.";
    label($("upgrade-extend"), "plus", proViaChoir() ? (singer ? "Get Pro of my own" : "Add choir time") : "Add more Pro time");
    sub && sub.isLifetime ? hide($("upgrade-extend")) : show($("upgrade-extend"));
    hide($("plans-extend"));
  }
  $("upgrade-extend").addEventListener("click", function () {
    track("Opened plans to extend");
    track("Plans viewed", "app · extend");
    show($("plans-extend"));
    loadPlans($("upgrade-panel"), $("plans-extend"), { choir: true });
    $("plans-extend").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("upgrade-account").addEventListener("click", function () { hide($("upgrade-panel")); setView("account"); });
  /** The pricing page sends a plan id along: once signed in, open its checkout without another click. */
  function autoCheckout(planId) {
    request("/api/billing/plans").then(function (plans) {
      var plan = (plans || []).find(function (p) { return String(p.id) === String(planId) || p.code === planId; });
      if (!plan) return;
      checkout(plan, document.createElement("button"));
    }).catch(function () { /* the dialog is open; the user can pick a plan */ });
  }
  $("upgrade-close").addEventListener("click", function () { hide($("upgrade-panel")); });
  $("upgrade-panel").addEventListener("click", function (e) { if (e.target === $("upgrade-panel")) hide($("upgrade-panel")); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide($("upgrade-panel")); });
  $("acct-signout").addEventListener("click", function () { $("signout").click(); });

  // ── App view ─────────────────────────────────────────────────────────────
  function isPro() { return !!(sub && sub.isActive); }
  /** A free account's one four-part harmony, until it is used. The API decides; this mirrors it. */
  function freeHarmonyLeft() { return !isPro() && !!(sub && sub.freeHarmonyAvailable); }

  /**
   * What this month (Pro) or this week (free) has left, as numbers for the meters. A free account's meter is
   * this week's free hums and recordings (back every Friday 6pm WAT, `back` in the reader's time); the songs
   * it bought are counted apart (boughtLeft), since they never expire.
   */
  function usage() {
    if (!sub) return null;
    if (isPro()) return { label: "Songs this month", left: sub.songCreditsRemaining, total: sub.songCreditsTotal, unit: "left" };
    var f = window.NfFreeWeek.free(sub);
    return { label: "Free this week", left: f.left, total: f.total, unit: "left", back: f.back };
  }
  /** The free meter's second line: when they come back, and any bought songs beside them. */
  function freeNote(u) {
    var bought = boughtLeft();
    return "Resets " + u.back + (bought > 0 ? " · " + bought + " bought song" + (bought === 1 ? "" : "s") + " left" : "");
  }
  /** Pro's songs come back on the first of the month (UTC, as the API counts them): "1 Nov". */
  function resetDate() { var now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)); }
  function resetDay(month) { return resetDate().toLocaleDateString(undefined, { day: "numeric", month: month || "short", timeZone: "UTC" }); }
  /** A free account's bought songs not yet used: each one can be a whole linked song. */
  function boughtLeft() { return !isPro() && sub ? (sub.boughtTranscriptionsRemaining || 0) : 0; }
  function fillMeter(el, u) { el.style.width = u && u.total > 0 ? Math.max(0, Math.min(100, (u.left / u.total) * 100)) + "%" : "0%"; }

  function renderWho() {
    ["topbar-avatar-img", "chip-avatar", "menu-avatar"].forEach(function (id) { setAvatar($(id), me); });
    $("chip-name").textContent = me ? ((me.fullName || "").trim().split(/\s+/)[0] || me.email || "") : "";
    $("greeting").textContent = greeting(me && me.fullName);
    $("home-sub").textContent = "What are we writing out today?";
    document.body.classList.toggle("is-pro", isPro());
    isPro() ? show($("greeting-pro")) : hide($("greeting-pro"));
    $("menu-plans-label").textContent = isPro() ? "My membership" : "Plans & billing";
    // Until a kind is picked, a file is taken for a song only where songs are open (Pro, or a bought one left).
    if (!guest && !chosenKind()) selectKind(songsOpen() ? "song" : "hum");
    renderStudioCredits();
    $("menu-name").textContent = me ? (me.fullName || "") : "";
    $("menu-email").textContent = me ? (me.email || "") : "";
    var plan = $("menu-plan");
    plan.className = "pill " + (isPro() ? "pill-pro" : "pill-free");
    plan.textContent = isPro() ? "Pro" : "Free";
    // The sidebar's foot: one quiet line and a bar, not a card.
    var u = usage();
    $("usage-plan").textContent = u ? u.label : isPro() ? "Pro" : "Free plan";
    $("usage-left").textContent = u ? u.left + " of " + u.total + " left" : "";
    $("usage-note").textContent = isPro() ? "Resets " + resetDay() : u ? freeNote(u) : "";
    fillMeter($("usage-fill"), u);
  }

  /**
   * Asks again what is left: when a job is accepted (a running song holds its place), when it
   * finishes or fails (a failed one gives the place back), after a delete, and when the tab comes
   * back into view (a song may have finished elsewhere, or the month turned).
   */
  var usageAskedAt = 0;
  function refreshUsage() {
    if (guest || !tokens()) return;
    usageAskedAt = Date.now();
    var at = epoch;
    request("/api/billing/my-subscription").then(function (s) {
      if (at !== epoch || !s) return;
      sub = s; renderWho();
      if (!$("view-account").classList.contains("hidden")) renderAccount();
    }).catch(function () { /* the meter keeps what it showed; the next ask corrects it */ });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && sub && Date.now() - usageAskedAt > 30000) refreshUsage();
  });

  function loadAccount() {
    return Promise.all([
      request("/api/me").catch(function () { return null; }),
      request("/api/billing/my-subscription").catch(function () { return null; })
    ]).then(function (pair) { me = pair[0]; sub = pair[1]; renderWho(); });
  }

  function boot() {
    if (!tokens()) {
      if (previewId) { startGuest(); return Promise.resolve(); }
      showAuth(); return Promise.resolve();
    }
    leaveAuth(); show($("boot-skel"));
    return loadAccount().then(function () {
      // The API refused the session while the account loaded: the sign-in screen is already up.
      if (!tokens()) { showAuth(); return; }
      var wasGuest = guest;
      guest = false;
      hide($("boot-skel")); leaveAuth(); hide($("guest-bar")); show($("view-app")); show($("top-nav")); showAccountUi(true); setView("transcribe"); libraryCache = null;
      warmEngraver();
      document.body.classList.remove("guest"); hide($("topbar-signin")); show($("recents"));
      fetchLibrary().catch(function () { return []; });
      // Signed in from a choir invite (or already signed in when it was opened): join now.
      maybeJoinFromInvite();
      var upgradeTo = new URLSearchParams(location.search).get("upgrade");
      // Handled once: the checkout leaves this tab, and Back must not land on a page that starts it again.
      if (upgradeTo) dropParam("upgrade");
      if (upgradeTo && !isPro()) { openUpgrade(); if (upgradeTo !== "1") autoCheckout(upgradeTo); }
      // Back from checkout (the provider's return page adds ?paid=1), or a checkout started here not long ago.
      // Only the provider's return says a payment was made; otherwise the check runs out of sight.
      var paidReturn = !!new URLSearchParams(location.search).get("paid");
      if (paidReturn || readCheckout()) watchPayment(!paidReturn);
      // A notification's link (/app?job=<id>): the finished sheet, or why it failed.
      var jobToOpen = new URLSearchParams(location.search).get("job");
      if (jobToOpen) { dropParam("job"); openJob(jobToOpen); }
      syncPush();
      if (previewId) {
        // The preview that brought this person here is now theirs: the funnel's conversion.
        request("/api/preview/jobs/" + encodeURIComponent(previewId) + "/claim", { method: "POST" }).catch(function () { /* best effort */ });
        keepPreviewJob = previewId;
        if (wasGuest && current && current.result) { showResult(current.result); keepClaimedPreview(); }
        else if (!current) startJob({ jobId: previewId, stage: "transcribing" }, "preview");
      }
    }, function () { showAuth(); });
  }

  /** A visitor with a preview and no account: the app, read-only, with the sign-up card ready. */
  function startGuest() {
    guest = true;
    hide($("boot-skel")); leaveAuth(); show($("view-app")); show($("guest-bar")); hide($("upgrade-panel")); hide($("top-nav")); showAccountUi(false); setView("transcribe");
    warmEngraver();
    document.body.classList.add("guest"); show($("topbar-signin"));
    $("greeting").textContent = greeting(""); $("home-sub").textContent = "Your free preview is on its way. Create a free account to keep transcribing.";
    startJob({ jobId: previewId, stage: "transcribing" }, "preview");
  }

  // ── Submitting ───────────────────────────────────────────────────────────
  function linkHint(text) {
    $("link-hint").textContent = text;
    (/upload/i.test(text || "") ? show : hide)($("link-upload-row"));
  }
  $("link-upload").addEventListener("click", function () { linkHint(""); selectSource("upload", true); });
  /** "Switch to Upload" beside an alert that says a link could not be fetched. */
  function addUploadInstead(alertEl) {
    var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm";
    label(b, "upload", "Switch to Upload");
    b.addEventListener("click", function () { hide(alertEl); setView("transcribe"); selectSource("upload", true); });
    alertEl.appendChild(b);
  }
  // As soon as the box holds a song link, the API is asked what it is and how long it runs, and a
  // card under the form lets the person pick the part to transcribe (assets/rangepicker.js). The
  // selection is sent with the link; with no card (length unknown, lookup failed) the song is
  // transcribed from the start as before.
  var linkInfo = { url: null, card: null, timer: null, seq: 0, pending: false, sending: false, wanted: null };
  function clearLinkCard() {
    linkInfo.seq++; // an answer still on its way is for a link no longer in the box
    if (linkInfo.card) linkInfo.card.destroy();
    linkInfo.card = null; linkInfo.url = null; linkInfo.pending = false; $("link-section").innerHTML = "";
    syncLinkSubmit();
  }
  /** Transcribe waits while the song is being looked up and while a link is being sent. */
  function syncLinkSubmit() { $("link-submit").disabled = linkInfo.pending || linkInfo.sending; }
  /** The plain line about the limit, beside what is selected. */
  function allowanceLine(maxSeconds) {
    var fmt = window.NfRangePicker.formatTime;
    if (guest) return maxSeconds + " s preview — sign up for a minute, Pro for six";
    if (!isPro() && maxSeconds > 60 && boughtLeft() > 0) return "up to " + fmt(maxSeconds) + " — uses the song you bought";
    return isPro() || maxSeconds > 60 ? "up to " + fmt(maxSeconds) + " on Pro" : "up to " + fmt(maxSeconds) + " on a free account — Pro gets six minutes";
  }
  function lookupLink(now) {
    clearTimeout(linkInfo.timer);
    linkInfo.timer = setTimeout(function () {
      var found = window.NfSongLink.extract($("link-url").value.trim());
      if (!found) { clearLinkCard(); return; }
      if (found.url === linkInfo.url) return;
      clearLinkCard();
      linkInfo.url = found.url; linkInfo.pending = true; syncLinkSubmit();
      var seq = linkInfo.seq, host = $("link-section");
      var looking = document.createElement("p"); looking.className = "small studio-status link-looking"; looking.textContent = "Finding the song…"; host.appendChild(looking);
      request(guest ? "/api/preview/link/info" : "/api/transcriptions/link/info", { method: "POST", anonymous: guest, body: { url: found.url } })
        .then(function (info) {
          if (seq !== linkInfo.seq) return;
          host.innerHTML = "";
          linkInfo.card = window.NfRangePicker.card(host, info, { allowance: allowanceLine(info.maxSeconds) });
        })
        .catch(function (err) {
          if (seq !== linkInfo.seq) return;
          host.innerHTML = "";
          if (err.code === "TRANS_INVALID_LINK" || err.status === 422) { linkInfo.url = null; linkHint(err.message); return; }
          linkHint("We couldn't read the song's length just now. We'll transcribe it from the start.");
        })
        .then(function () {
          if (seq !== linkInfo.seq) return;
          linkInfo.pending = false; syncLinkSubmit();
          // Transcribe was pressed before the song was known: it goes on by itself only when there is
          // nothing to pick (length unknown, lookup failed); a picker waits for the person.
          var wanted = linkInfo.wanted === found.url; linkInfo.wanted = null;
          if (wanted && linkInfo.url === found.url && !(linkInfo.card && linkInfo.card.selection())) submitLink(found.url);
        });
    }, now ? 0 : 350);
  }
  window.NfSongLink.wire($("link-url"), $("link-paste"), linkHint, lookupLink);
  $("form-link").addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = $("link-url").value.trim();
    if (!raw) { linkHint("Paste a link to a YouTube video, a Spotify track or an Apple Music song."); $("link-url").focus(); return; }
    var found = window.NfSongLink.extract(raw);
    if (!found) { linkHint(window.NfSongLink.hint(raw)); $("link-url").focus(); return; }
    $("link-url").value = found.url; linkHint("");
    // The song's card comes first, so the part to transcribe is seen and picked before it is sent.
    if (linkInfo.url !== found.url || linkInfo.pending) { linkInfo.wanted = found.url; if (linkInfo.url !== found.url) lookupLink(true); return; }
    submitLink(found.url);
  });
  function submitLink(url) {
    var body = { url: url, mode: "melody", audioPreview: false };
    // The part of the song that was picked, when the card is showing for this very link.
    var section = linkInfo.card && linkInfo.url === url ? linkInfo.card.selection() : null;
    if (section) { body.startSeconds = section.startSeconds; body.endSeconds = section.endSeconds; }
    // Only when set: the sheet is then written in the keys pressed on a transposed keyboard.
    if (kbTranspose() !== 0) body.keyboardTranspose = kbTranspose();
    var meter = chosenMeter();
    if (meter) body.timeSignature = meter;
    sendLink(body);
  }
  /** The link as it was sent, kept so "Try again" on a job that never finishes can send the same again (`again`). */
  function sendLink(body, again) {
    sfx.prime(); // from the click that sent it: the chime for a job that finishes out of sight can play
    linkInfo.sending = true; syncLinkSubmit(); hide($("app-alert"));
    track(guest ? "Preview started (link)" : "Song link transcribed");
    if (!again && window.NfMeter) track(window.NfMeter.eventName(body.timeSignature));
    var following = !!pollTimer, before = current;
    request(guest ? "/api/preview/link" : "/api/transcriptions/link", { method: "POST", anonymous: guest, body: body })
      .then(function (job) {
        if (again && doneMeanwhile(before)) return;
        if (!again) { clearLinkCard(); $("link-url").value = ""; resetMeter(); }
        startJob(job, guest ? "preview" : "link", "link", function () { sendLink(body, true); });
      })
      .catch(function (err) {
        if (following) resetRetry();
        explain(err);
        if (/upload/i.test(err.message || "")) addUploadInstead($("app-alert"));
      })
      .finally(function () { linkInfo.sending = false; syncLinkSubmit(); });
  }

  // ── What is in the recording ─────────────────────────────────────────────
  // Until the picker is touched, a file is taken for a song with instruments (the voice is isolated,
  // the better road for anything with a band) and a take recorded here for a voice. Once someone
  // picks, that choice is kept on this browser for both.
  var KIND_KEY = "nf.web.uploadKind", CHOIR_BAND_KEY = "nf.web.choirBand", KB_KEY = "nf.web.kbTranspose";
  var KINDS = ["hum", "song", "choir", "chords"];
  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
  function chosenKind() { var k = stored(KIND_KEY); return KINDS.indexOf(k) >= 0 ? k : null; }
  function checkedKind() { var el = document.querySelector('input[name="upload-kind"]:checked'); return el ? el.value : "song"; }
  function selectKind(kind) { var el = document.querySelector('input[name="upload-kind"][value="' + kind + '"]'); if (el) el.checked = true; renderKindOptions(); }
  /** The kind a submission goes as: the person's choice, else the default for where the audio came from. */
  function uploadKind(fromMic) { var k = chosenKind() || (fromMic || !songsOpen() ? "hum" : "song"); selectKind(k); return k; }
  /**
   * Whether a recording with instruments is open to this account: Pro, or a free account with a bought song
   * left (the free weekly ones are hums and recordings). A guest's preview is as before.
   */
  function songsOpen() { return guest || !sub || isPro() || boughtLeft() > 0; }
  /** "Beats in a bar" (assets/meter.js): the meter to send, or null for Not sure. Not kept between songs. */
  function chosenMeter() { return window.NfMeter ? window.NfMeter.chosen($("meter")) : null; }
  function resetMeter() { if (window.NfMeter) window.NfMeter.reset($("meter")); }
  /** The keyboard's transpose setting, −11 to +11; 0 when it is off. */
  function kbTranspose() { var n = parseInt(stored(KB_KEY), 10); return n >= -11 && n <= 11 ? n : 0; }
  /** A choir with instruments behind it, and the keyboard's transpose, only where they apply (or are set). */
  function renderKindOptions() {
    var kind = checkedKind();
    kind === "choir" ? show($("choir-band-row")) : hide($("choir-band-row"));
    kind === "chords" || kbTranspose() !== 0 ? show($("kb-row")) : hide($("kb-row"));
  }
  (function () {
    var select = $("kb-transpose");
    [0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach(function (n) {
      var opt = document.createElement("option"); opt.value = String(n); opt.textContent = n > 0 ? "+" + n : n < 0 ? "\u2212" + -n : "0"; select.appendChild(opt);
    });
    select.value = String(kbTranspose());
    select.addEventListener("change", function () { store(KB_KEY, select.value); renderKindOptions(); });
    $("choir-band").checked = stored(CHOIR_BAND_KEY) === "1";
    $("choir-band").addEventListener("change", function () { store(CHOIR_BAND_KEY, $("choir-band").checked ? "1" : "0"); renderStudioCredits(); });
    if (chosenKind()) selectKind(chosenKind()); else renderKindOptions();
    document.querySelectorAll('input[name="upload-kind"]').forEach(function (r) {
      r.addEventListener("change", function () { store(KIND_KEY, r.value); renderKindOptions(); renderStudioCredits(); });
    });
  })();
  /**
   * What the next transcription from the tab showing costs, or null when it costs nothing: a chip
   * beside the work ("Uses 1 song · 16 of 20 left") and, behind (i), why. A Pro song is a link or a
   * recording with instruments; on a free account a hum or a recording without instruments to take out is
   * one of the week's free ones, and a song (a link, or a recording with instruments) is the one short link
   * preview or a bought song.
   */
  function studioCost() {
    if (!sub || guest) return null;
    var tab = document.querySelector(".source-tab[aria-selected=true]");
    var link = !!tab && tab.getAttribute("data-source") === "link", kind = checkedKind();
    var kept = ", and deleting its sheet doesn't give it back.";
    if (isPro()) {
      if (!link && kind !== "song" && !(kind === "choir" && $("choir-band").checked)) return null;
      var left = sub.songCreditsRemaining, total = sub.songCreditsTotal;
      return {
        text: left > 0 ? "Uses 1 song \u00b7 " + left + " of " + total + " left" : "No songs left until " + resetDay(),
        out: left <= 0,
        why: "Song links and recordings with instruments use one of your " + total + " songs a month. A song is used only when it finishes: one that fails costs nothing" + kept +
          " Hummed tunes, chords and unaccompanied choirs are free. Your songs reset on " + resetDay("long") + "."
      };
    }
    if (link) {
      var bought = boughtLeft();
      if (bought > 0) return { text: "Uses 1 bought song \u00b7 " + bought + " left", why: "A bought song transcribes up to six minutes of a linked song and never expires. It's used only when the song finishes: one that fails costs nothing" + kept };
      return sub.songCreditsRemaining > 0
        ? { text: "Free 1-minute preview", why: "A free account can try one song link: a preview of one minute of the song. It's used only when the preview finishes, so a link that fails costs nothing. Pro transcribes whole songs." }
        : { text: "Free preview used", out: true, why: "Your one free song-link preview has been used. Pro, or one bought song, transcribes whole songs; hums and recordings use your free transcriptions each week." };
    }
    var u = usage(), bought = boughtLeft();
    var weekly = "Hums and recordings use your " + u.total + " free transcriptions a week. They come back every Friday at 6pm West Africa Time" +
      (u.back !== window.NfFreeWeek.FALLBACK && u.back !== "Friday 6pm" ? " (" + u.back + " where you are)" : "") + ".";
    if (kind === "song" || (kind === "choir" && $("choir-band").checked)) {
      // A recording with instruments has its voice isolated first: a song, which the free weekly ones do not cover.
      return bought > 0
        ? { text: "Uses 1 bought song \u00b7 " + bought + " left", why: "A recording with instruments has its voice isolated first, so it's a song: a bought song or Pro pays for it. A bought song never expires and is used only when it finishes: one that fails costs nothing" + kept }
        : { text: "Songs need Pro or a bought song", out: true, why: "A recording with instruments has its voice isolated first, so it's a song: that takes Pro or a bought song. " + weekly + " Choose \u201cJust a voice\u201d (or untick \u201cInstruments are playing too\u201d) to use one of those." };
    }
    if (u.left > 0) return { text: "Uses 1 free \u00b7 " + u.left + " of " + u.total + " left this week", why: weekly + " One is used only when a transcription finishes: one that fails costs nothing" + kept };
    if (bought > 0) return { text: "Uses 1 bought song \u00b7 " + bought + " left", why: "This week's free transcriptions are used, so this one uses a song you bought, which never expires. " + weekly };
    return { text: "No free ones left until " + u.back, out: true, why: "You've used this week's " + u.total + " free transcriptions. " + weekly + " Buy just this song, or go Pro for unlimited." };
  }
  function renderStudioCredits() {
    var row = $("studio-cost");
    if (!row) return;
    var cost = studioCost();
    if (!cost) { hide(row); setCostInfo(false); return; }
    $("cost-chip").textContent = cost.text;
    $("cost-chip").classList.toggle("is-out", !!cost.out);
    $("cost-pop").textContent = cost.why;
    show(row);
  }
  function setCostInfo(open) {
    $("cost-pop").hidden = !open;
    $("cost-info").setAttribute("aria-expanded", String(open));
  }
  $("cost-info").addEventListener("click", function (e) { e.stopPropagation(); setCostInfo($("cost-pop").hidden); });
  document.addEventListener("click", function (e) { if (!$("cost-pop").hidden && !$("studio-cost").contains(e.target)) setCostInfo(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("cost-pop").hidden) { setCostInfo(false); $("cost-info").focus(); }
  });
  function submitAudio(file, name, fromMic, again, meter) {
    // One recording goes up at a time: a second drop or take while the first is uploading is ignored.
    if (submitting) return Promise.resolve();
    sfx.prime(); // from the click that sent it: the chime for a job that finishes out of sight can play
    // Read once: "Try again" sends the meter this recording went with, not what the box says now.
    if (!again) meter = chosenMeter();
    var kind = uploadKind(fromMic), song = kind === "song" || (kind === "choir" && $("choir-band").checked);
    var form = new FormData();
    form.append("audio", file, name);
    // A choir in parts keeps every voice; chords keep the harmony, with the top line as the tune; anything else is one line.
    form.append("mode", kind === "choir" ? "choir" : kind === "chords" ? "chords" : "melody");
    // A song with a band behind the voice (or the voices) is separated first; a hummed tune is not.
    form.append("separate", song ? "true" : "false");
    // The sheet in the keys pressed on a transposed keyboard: always sent for chords, otherwise only when set.
    if (kind === "chords" || kbTranspose() !== 0) form.append("keyboardTranspose", String(kbTranspose()));
    if (meter) form.append("timeSignature", meter);
    // The browser renders its own playback from the notes: the server's piano WAV (about
    // 10 MB and nine seconds of synthesis for a three-minute song) is not wanted here.
    form.append("audioPreview", "false");
    hide($("app-alert"));
    track(guest ? "Preview started (audio)" : song ? "Song uploaded" : kind === "choir" ? "Choir uploaded" : kind === "chords" ? "Chords uploaded" : "Tune uploaded");
    if (!again && window.NfMeter) track(window.NfMeter.eventName(meter));
    // The recording's own journey up is the first stage on the card, with a real percentage. When a
    // job is still being followed (Try again), that card is left alone and the button carries the count.
    var following = !!pollTimer, before = current;
    if (!following) {
      openProgress("Uploading your recording");
      setStage("uploading", "upload", null);
    }
    function onProgress(fraction) {
      if (following) $("p-retry-btn").textContent = "Sending again… " + Math.round(fraction * 100) + "%";
      else setPercent(fraction);
    }
    submitting = true;
    var at = epoch;
    return upload(guest ? "/api/preview" : "/api/transcriptions", form, { anonymous: guest, onProgress: onProgress })
      .then(function (job) {
        if (at !== epoch) return; // signed out while it went up
        submitting = false;
        if (again && doneMeanwhile(before)) return;
        if (!again) resetMeter();
        startJob(Object.assign({}, job, { stage: job.stage || "queued", fileName: fromMic ? null : name }), guest ? "preview" : "upload", "upload", function () { submitAudio(file, name, fromMic, true, meter); });
      })
      .catch(function (err) {
        if (at !== epoch) return;
        submitting = false;
        if (following) resetRetry();
        else { hide($("progress")); if (current && current.result) show($("result")); }
        explain(err);
      });
  }
  $("file-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    submitAudio(file, file.name);
    e.target.value = "";
  });
  // ── Where the music comes from: Record, Upload or a Song link, one panel at a time ──
  // The three used to stack in one block with the recording options between them; asking one thing
  // at a time is calmer, and the last choice is kept for the next visit.
  var SOURCE_KEY = "nf.web.source", SOURCES = ["record", "upload", "link"];
  function selectSource(name, focus) {
    if (SOURCES.indexOf(name) < 0) name = "record";
    SOURCES.forEach(function (s) {
      var tab = $("src-tab-" + s), on = s === name;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      $("src-" + s).hidden = !on;
    });
    // What is in the recording matters for a recording or a file, not for a link.
    $("kind-block").hidden = name === "link";
    // Until someone picks, the picker shows what this tab sends: a take as a voice, a file as a song.
    if (!chosenKind() && name !== "link") selectKind(name === "record" ? "hum" : "song");
    renderStudioCredits();
    try { localStorage.setItem(SOURCE_KEY, name); } catch (e) { /* private mode */ }
    if (focus) $("src-tab-" + name).focus();
  }
  document.querySelectorAll(".source-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { selectSource(tab.getAttribute("data-source")); track("Source: " + tab.getAttribute("data-source")); });
    tab.addEventListener("keydown", function (e) {
      var i = SOURCES.indexOf(tab.getAttribute("data-source"));
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        selectSource(SOURCES[(i + (e.key === "ArrowRight" ? 1 : SOURCES.length - 1)) % SOURCES.length], true);
      }
    });
  });
  selectSource((function () { try { return localStorage.getItem(SOURCE_KEY); } catch (e) { return null; } })() || "record");
  // A file dragged over the studio is an upload, whichever tab is showing.
  $("studio").addEventListener("dragenter", function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) selectSource("upload");
  });

  (function () {
    var drop = $("drop");
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) submitAudio(file, file.name);
    });
  })();

  // ── Record a tune in the browser ─────────────────────────────────────────
  // The same recording pop-up as the home page (assets/recorder.js): the level meter and the
  // clock while the microphone is open, then the take to listen back to. Nothing is sent
  // until it has been approved.
  $("rec-btn").addEventListener("click", function () {
    $("rec-status").textContent = "";
    window.NfRecorder.open({
      maxSeconds: guest ? 30 : 180, // a guest gets the same thirty seconds as on the home page
      track: track,
      sounds: function (name) { sfx.play(name); },
      onError: function (text, kind) { $("rec-status").textContent = kind === "short" ? text : text + " Upload a file instead."; },
      onTake: function (blob, name) { submitAudio(blob, name, true); }
    });
  });

  function explain(err) {
    var text = err.message || "Something went wrong.";
    if (err.code === "BILLING_SONG_PREVIEW_USED" || err.code === "BILLING_FREE_TIER_LIMIT" || err.code === "BILLING_SONG_NOT_FREE") {
      alertIn($("app-alert"), "info", text);
      openUpgrade("limit");
      return;
    }
    if (err.code === "BILLING_SONG_CREDITS_EXHAUSTED") { alertIn($("app-alert"), "info", text); return; }
    if (err.code === "PREVIEW_LIMIT_REACHED") { alertIn($("app-alert"), "info", text); openAuth("register"); return; }
    sfx.play("error");
    alertIn($("app-alert"), "danger", text);
  }

  // ── A job that finishes out of sight: a notification, a chime, the tab's title (assets/notify.js) ──
  function prefStore() { try { return window.localStorage; } catch (e) { return null; } }
  function trackPermission(answer) { track("Notify permission", answer === "default" ? "dismissed" : answer); }

  /**
   * A job settled. Someone looking at the page gets its own sound; someone in another tab or window gets the
   * chime (unless muted), "(1) Sheet ready" on the tab until they look, and a notification when that is on.
   */
  function announce(outcome, error) {
    var p = NF.prefs(prefStore());
    var todo = NF.plan({ away: NF.isAway(document), permission: NF.permission(window), notifyPref: p.notify, sound: p.sound });
    if (!todo.cue) { sfx.play(outcome === "failed" ? "error" : "ready"); return; }
    if (todo.chime) NF.chime(sfx.ctx, outcome);
    NF.cue(document, outcome);
    if (!todo.notify) return;
    var jobId = current.jobId, words = NF.message(outcome, NF.nameOf(current.source, current.fileName), error);
    // Through the push worker when there is one, under the job's tag: a push for this job that got here
    // first is replaced, not doubled. Its click comes back as an "nf-open" message (below).
    NF.showVia(window, {
      title: words.title, body: words.body, tag: NF.tag(jobId), jobId: jobId, kind: outcome === "failed" ? "failed" : "ready",
      url: "/app?job=" + encodeURIComponent(jobId),
      onOpen: function () { openedFromNotification(jobId, outcome); }
    }).then(function (note) {
      if (!note) return;
      track("Notified", outcome);
      // Looking at the tab closes it; if they already came back while it was being shown, it goes now.
      if (NF.cued()) NF.holdNote(note); else note.close();
    });
  }
  /** The sheet (or why it failed) is on the studio's page, unless another job has started since. */
  function openedFromNotification(jobId, outcome) {
    track("Notification opened", outcome);
    if (current && current.jobId === jobId) { if ($("view-transcribe").classList.contains("hidden")) setView("transcribe"); }
    else openJob(jobId);
  }

  // ── Web push: the notification when the tab is closed (assets/notify.js, /sw.js) ──
  var pushAskedFor = null; // the account this page has already saved its subscription for
  /** Notifications are on for a signed-in account: (re)subscribe this browser and tell the API, once per page and account. */
  function syncPush() {
    if (guest || !me || !tokens() || !NF.notifyOn(NF.permission(window), NF.prefs(prefStore()).notify)) return;
    var who = me.id || me.email || "me";
    if (pushAskedFor === who) return;
    pushAskedFor = who;
    NF.pushOn(window, request).then(function (state) { if (state !== "on") pushAskedFor = null; });
  }
  NF.onWorkerMessage(window, function (msg) {
    if (msg.type === "nf-open") { openedFromNotification(msg.jobId, msg.kind); return; }
    // A push while this page is in front: the job on the card is collected by asking now rather than at the next poll.
    if (current && current.jobId === msg.jobId) { if (pollTimer) { stopPolling(); poll(); } return; }
    if (!msg.jobId || guest || !tokens()) return;
    var said = msg.body && !TECHNICAL.test(msg.body) ? msg.body : msg.kind === "failed" ? "That could not be transcribed." : "Open it in NoteFusion.";
    alertIn($("app-alert"), msg.kind === "failed" ? "danger" : "info", msg.title + ". " + said);
    if (msg.kind !== "failed") {
      var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm";
      b.textContent = "Open it";
      b.addEventListener("click", function () { hide($("app-alert")); openJob(msg.jobId); });
      $("app-alert").appendChild(b);
    }
  });

  /**
   * Opens a job by its id, as a notification's click and /app?job=<id> do: the result if it finished, its
   * progress if not. Signed out, the id waits in the address until boot() can open it.
   */
  function openJob(jobId) {
    if (!jobId) return;
    if (guest || !tokens()) {
      try { var u = new URL(location.href); u.searchParams.set("job", jobId); history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch (e) { /* nothing depends on it */ }
      return;
    }
    if (current && current.jobId === jobId) { setView("transcribe"); return; }
    setView("transcribe");
    request("/api/transcriptions/jobs/" + encodeURIComponent(jobId)).then(function (job) {
      startJob({ jobId: jobId, stage: job && job.stage, queuePosition: job && job.queuePosition, source: job && job.source }, "job");
    }, function (err) {
      alertIn($("app-alert"), "info", err.status === 404 ? "That transcription isn't available any more." : err.message);
    });
  }
  // Looking at the tab again puts its own title and icon back (and closes a notification still showing).
  function backInView() { if (NF.cued() && !NF.isAway(document)) NF.clearCue(document); }
  document.addEventListener("visibilitychange", backInView);
  window.addEventListener("focus", backInView);

  /**
   * The chime plays on the page's AudioContext, which a browser lets start only from a click: the submit
   * made it; a guest who arrived from the home page has not clicked here yet, so the next click does.
   */
  function primeAudio() {
    sfx.prime();
    if (!sfx.ctx || sfx.ctx.state === "running") return;
    function once() {
      sfx.prime();
      document.removeEventListener("pointerdown", once, true);
      document.removeEventListener("keydown", once, true);
    }
    document.addEventListener("pointerdown", once, true);
    document.addEventListener("keydown", once, true);
  }

  /** The browser's answer, remembered: on when allowed, off when blocked; a prompt closed unanswered leaves it unasked. */
  function rememberAnswer(answer) {
    if (answer === "unsupported") return;
    trackPermission(answer);
    if (answer === "granted" || answer === "denied") NF.setNotify(prefStore(), answer === "granted");
    if (answer === "granted") { pushAskedFor = null; syncPush(); }
    renderNotifySettings();
  }
  // "Notify me when it's ready" on the progress card: the browser asks from this click, never on page load.
  $("p-notify-btn").addEventListener("click", function () {
    var btn = $("p-notify-btn");
    sfx.prime();
    btn.disabled = true;
    NF.request(window).then(function (answer) {
      btn.disabled = false;
      rememberAnswer(answer);
      $("p-notify").hidden = true;
      $("p-notify-status").textContent = answer === "granted" ? "We'll send you a notification when it's ready."
        : answer === "denied" ? "Notifications are blocked for this site in your browser. We'll still play a sound and mark this tab."
        : "";
    });
  });
  $("p-notify-no").addEventListener("click", function () {
    NF.setNotify(prefStore(), false);
    $("p-notify").hidden = true;
    $("p-notify-status").textContent = guest ? "" : "You can turn this on in Account & settings.";
    renderNotifySettings();
  });

  /** Account & settings: the notification switch says what the browser allows, the sound switch what was chosen. */
  function renderNotifySettings() {
    var perm = NF.permission(window), p = NF.prefs(prefStore()), sw = $("acct-notify");
    sw.setAttribute("aria-checked", String(NF.notifyOn(perm, p.notify)));
    sw.disabled = perm === "unsupported";
    $("acct-notify-sound").setAttribute("aria-checked", String(p.sound));
    var support = NF.pushSupport(window);
    var text = support === "home-screen" ? "On iPhone and iPad, add NoteFusion to your Home Screen to get these (Share, then Add to Home Screen). Here, the sound and the tab's title tell you when it's ready."
      : perm === "unsupported" ? "This browser can't show notifications. The sound and the tab's title still tell you when it's ready."
      : perm === "denied" ? "Notifications are blocked for this site in your browser's settings. Allow them there to turn this on; the sound and the tab's title still work."
      : support === "push" ? "For a transcription that finishes in another tab or window, or after you've closed this one."
      : "For a transcription that finishes while you're in another tab or window.";
    // The note is aria-live: written only when it changes.
    if ($("acct-notify-note").textContent !== text) $("acct-notify-note").textContent = text;
  }
  $("acct-notify").addEventListener("click", function () {
    var perm = NF.permission(window), p = NF.prefs(prefStore());
    if (NF.notifyOn(perm, p.notify)) { NF.setNotify(prefStore(), false); pushAskedFor = null; NF.pushOff(window, request); }
    else if (perm === "granted") { NF.setNotify(prefStore(), true); pushAskedFor = null; syncPush(); }
    else if (perm === "default") { sfx.prime(); NF.request(window).then(rememberAnswer); return; }
    renderNotifySettings(); // blocked: the note says where to allow it
  });
  $("acct-notify-sound").addEventListener("click", function () {
    var on = !NF.prefs(prefStore()).sound;
    NF.setSound(prefStore(), on);
    renderNotifySettings();
    if (on) { sfx.prime(); NF.chime(sfx.ctx, "ready"); } // what it will sound like
  });
  renderNotifySettings();

  // ── Polling ──────────────────────────────────────────────────────────────
  // The card says where the job really is: the recording going up, its place in the worker's
  // line, then the worker's own stages with a percentage. When nothing moves for a while it says
  // so; when the API cannot be reached it says that; after twelve minutes it offers to send again.
  var STAGE_ORDER = ["uploading", "queued", "fetching", "separating", "transcribing"];
  var STAGE_COPY = { uploading: "Uploading your recording", queued: "Waiting in line", fetching: "Fetching audio", separating: "Isolating the voice", transcribing: "Writing the solfa" };
  var STALL_MS = 90 * 1000, RETRY_AFTER_MS = 12 * 60 * 1000, OFFLINE_AFTER = 3;

  /** The progress card, blank: a title, no song art, the bar at zero and none of the warnings. */
  function openProgress(title) {
    $("save-title").value = "";
    closeTool(); closeFull();
    hide($("result"));
    show($("progress"));
    rise($("progress"));
    $("p-title").textContent = title;
    $("p-artist").textContent = "";
    hide($("p-thumb"));
    setPercent(0);
    $("p-status").textContent = "";
    hide($("p-slow")); hide($("p-offline")); hide($("p-retry"));
    resetRetry();
    $("p-notify").hidden = !NF.shouldAsk(NF.permission(window), NF.prefs(prefStore()).notify);
    $("p-notify-status").textContent = "";
  }
  function resetRetry() { $("p-retry-btn").textContent = "Try again"; $("p-retry-btn").disabled = false; }
  /**
   * True when the job that was being followed as a resend went out has finished since: its sheet is
   * showing and stays; the second copy is not followed. A job that failed meanwhile is replaced.
   */
  function doneMeanwhile(before) { return !!(before && current === before && before.result); }
  /** The stage a snapshot stands in. A job the API still calls pending, with no stage yet, is waiting in line. */
  function stageOf(job, fallback) {
    if (job.stage) return job.stage;
    return String(job.status || "").toLowerCase() === "pending" ? "queued" : fallback;
  }
  function setPercent(fraction) {
    var pct = Math.max(0, Math.min(100, Math.round((fraction || 0) * 100)));
    $("p-bar").style.width = Math.max(3, pct) + "%";
    $("p-pct").textContent = pct + "%";
  }

  /**
   * Follows a job the API accepted. `from` is where the audio came from ("upload", "link", or
   * nothing when unknown, as for a preview opened by its id); `retry` sends the same thing again.
   */
  function startJob(job, kind, from, retry) {
    stopPolling();
    current = { jobId: job.jobId, kind: kind, from: from || null, retry: retry || null, source: job.source || null, fileName: job.fileName || null, result: null, startedAt: Date.now(), savedId: null, shareToken: null, lyrics: "", semitones: 0, failures: 0, seen: "", seenAt: Date.now() };
    openProgress(kind === "link" ? "Reading the link…" : kind === "preview" ? "Making your free preview…" : "Transcribing your recording…");
    current.preview = kind === "preview";
    if (current.preview) previewId = job.jobId;
    setStage(stageOf(job, kind === "link" ? "fetching" : "transcribing"), current.from, job.queuePosition);
    primeAudio();
    poll();
    // A song (or a free transcription) still running holds its place in the count: the meter shows it at once.
    if (!guest && kind !== "preview") refreshUsage();
  }
  function stopPolling() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

  /** Lights the row and writes the plain line under the bar. A stage this page has no name for is the last one. */
  function setStage(stage, from, queuePosition) {
    if (STAGE_ORDER.indexOf(stage) < 0) stage = "transcribing";
    var idx = STAGE_ORDER.indexOf(stage);
    document.querySelectorAll("#p-stages .stage").forEach(function (el) {
      var i = STAGE_ORDER.indexOf(el.dataset.stage);
      el.classList.remove("on", "done");
      // A recording that was uploaded is never "fetched"; a link is never "uploaded".
      if (el.dataset.stage === "uploading") (from === "upload" ? show : hide)(el);
      if (el.dataset.stage === "fetching") (from === "upload" ? hide : show)(el);
      if (i < idx) el.classList.add("done");
      if (i === idx) el.classList.add("on");
    });
    var text = STAGE_COPY[stage];
    if (stage === "queued" && queuePosition > 0) text += " · " + queuePosition + " ahead";
    // Written only when it changes: the line is aria-live, and a poll that found nothing new should say nothing.
    if ($("p-status").textContent !== text) $("p-status").textContent = text;
  }

  /** The lines under the bar, from how long the job has sat still and how long it has run. */
  function reviewWait() {
    var now = Date.now();
    (now - current.seenAt >= STALL_MS ? show : hide)($("p-slow"));
    if (now - current.startedAt >= RETRY_AFTER_MS && current.retry) show($("p-retry"));
  }
  $("p-retry-btn").addEventListener("click", function () {
    if (!current || !current.retry) return;
    $("p-retry-btn").disabled = true; $("p-retry-btn").textContent = "Sending again…";
    current.retry(); // the old job is still followed until the new one is accepted
  });

  function poll() {
    if (!current) return;
    var jobId = current.jobId, at = epoch;
    /** The reply is still wanted: nobody signed out meanwhile and this is still the job on the card. */
    function wanted() { return at === epoch && (guest || !!tokens()) && !!current && current.jobId === jobId; }
    request((current.preview ? "/api/preview/jobs/" : "/api/transcriptions/jobs/") + encodeURIComponent(jobId), { anonymous: current.preview && guest }).then(function (job) {
      if (!wanted()) return;
      current.failures = 0; hide($("p-offline"));
      if (job.source) {
        current.source = job.source;
        $("p-title").textContent = job.source.title || "Untitled";
        $("p-artist").textContent = job.source.artist || "";
        if (job.source.thumbnailUrl) { $("p-thumb").src = job.source.thumbnailUrl; show($("p-thumb")); }
      }
      var stage = stageOf(job, "transcribing"), progress = job.progress || 0;
      setStage(stage, current.from, job.queuePosition);
      setPercent(progress);
      // Something moved: the stage, the bar or the line ahead. Otherwise the clock keeps running.
      var seen = stage + "|" + Math.round(progress * 100) + "|" + (job.queuePosition == null ? "" : job.queuePosition);
      if (seen !== current.seen) { current.seen = seen; current.seenAt = Date.now(); }
      var status = String(job.status || "").toLowerCase();
      if (status === "done" && job.result) {
        stopPolling();
        current.result = job.result;
        hide($("progress"));
        announce("ready");
        track(current && current.kind === "preview" ? "Preview ready" : "Sheet ready");
        showResult(job.result);
        keepClaimedPreview();
        if (!guest) loadAccount();
        return;
      }
      if (status === "failed") {
        stopPolling();
        hide($("progress"));
        var failed = job.error && !TECHNICAL.test(job.error) ? job.error
          : current.from === "link" ? "That link could not be transcribed." : "That could not be transcribed. Try a cleaner recording or a different link.";
        // A link that fails is most often a download YouTube refused: the way round is the file itself.
        if (current.from === "link" && !/upload/i.test(failed)) failed += " YouTube sometimes blocks our downloads; upload the audio file instead.";
        announce("failed", failed);
        alertIn($("app-alert"), "danger", failed);
        if (/upload/i.test(failed)) addUploadInstead($("app-alert"));
        // A failed job costs nothing: the place it held comes back.
        if (!guest) refreshUsage();
        return;
      }
      reviewWait();
      pollTimer = setTimeout(poll, POLL_MS);
    }).catch(function (err) {
      if (err.status === 401) { stopPolling(); return; }
      if (!wanted()) return;
      // Whatever the API or the network said stays in the console; the card gets one plain line.
      current.failures++;
      if (current.failures >= OFFLINE_AFTER) show($("p-offline"));
      reviewWait();
      pollTimer = setTimeout(poll, POLL_MS * 2);
    });
  }

  // ── Result ───────────────────────────────────────────────────────────────
  function providerName(p) { return { youtube: "YouTube", spotify: "Spotify", apple_music: "Apple Music" }[p] || p; }

  function showResult(result) {
    var src = result.source || current.source;
    $("r-title").textContent = src ? (src.title || "Untitled") : (current.title || "Your recording");
    $("r-artist").textContent = src ? (src.artist || "") : "";
    if (src && src.thumbnailUrl) { $("r-thumb").src = src.thumbnailUrl; show($("r-thumb")); } else hide($("r-thumb"));
    $("r-credit").textContent = src
      ? "Lead vocal transcribed from “" + (src.title || "Untitled") + "”" + (src.artist ? " by " + src.artist : "") + " (" + providerName(src.provider) + ")" + sectionNote(src) + " with NoteFusion."
      : "Transcribed with NoteFusion.";
    if (result.hymn) creditHymn($("r-credit"), result.hymn);
    var chips = $("r-chips");
    chips.innerHTML = "";
    [result.key, result.tempo + " BPM", result.timeSignature].forEach(function (text) {
      var c = document.createElement("span"); c.className = "chip"; c.textContent = text; chips.appendChild(c);
    });
    // No percentage: a plain note, and only when there is something to do (assets/confidence.js).
    // This page does not mark individual notes, so the note never points at highlights.
    var confNote = window.NfConfidence ? window.NfConfidence.note(result.overallConfidence, false) : null;
    if (confNote) alertIn($("r-confidence"), "info", confNote); else hide($("r-confidence"));
    var trunc = $("r-truncated");
    if (result.source && result.source.preview && result.source.notice) {
      alertIn(trunc, "info", result.source.notice);
    } else if (result.truncated && src && src.startSeconds != null) {
      alertIn(trunc, "info", "The part you picked was longer than " + (guest ? "30 seconds" : isPro() ? "six minutes" : "a minute") + ", so only its first " + (guest ? "30 seconds" : isPro() ? "six minutes" : "minute") + " transcribed.");
    } else if (result.truncated) {
      alertIn(trunc, "info", guest
        ? "Free preview: the first 30 seconds of " + formatSec(result.songDurationSec) + ". Create a free account for more."
        : isPro()
          ? "This song runs " + formatSec(result.songDurationSec) + "; the first six minutes were transcribed."
          : "Free preview: the first minute of a " + formatSec(result.songDurationSec) + " song. Upgrade to Pro for the whole song and the download.");
    } else hide(trunc);

    renderHymnAsk(result);
    renderDohAsk(result);
    renderSolfa(result);
    renderChords(result);
    $("lyrics").value = current.lyrics || "";
    setupRehearsal(result);
    setupSing(result);
    setupPractice(result);
    renderTranspose();
    renderSave();

    isPro() ? hide($("r-watermark")) : show($("r-watermark"));
    // One set of plans on the page at a time: the note under the downloads carries them while a
    // result is showing; the standalone panel is for the empty state and the Account view.
    isPro() ? hide($("r-upgrade")) : (renderUnlock(result), show($("r-upgrade")), loadPlans($("r-upgrade"), $("plans"), {}));
    renderVerdict();
    hide($("upgrade-panel"));
    // Four parts are written on request, never assumed: the tab appears once they exist (a saved
    // sheet that already carries them, or after "Write the four parts" below).
    hide($("r-parts"));
    var hasParts = P.hasParts(result);
    hasParts ? show($("tab-parts")) : hide($("tab-parts"));
    $("tab-parts").textContent = result.partsSource === "heard" ? "Parts as sung" : "Four parts";
    hasParts ? hide($("harmony")) : show($("harmony"));
    hide($("harmony-alert"));
    renderHarmonyOffer();
    if ($("r-staff").classList.contains("hidden") && $("r-solfa").classList.contains("hidden")) document.querySelector('.result-tabs [data-view="staff"]').click();
    [$("dl-pdf"), $("dl-xml"), $("dl-midi")].forEach(function (b) {
      var text = b.textContent.trim();
      b.innerHTML = (b.id === "dl-pdf" ? '<svg class="ic"><use href="/assets/icons.svg#i-download"/></svg>' : "") + text + (isPro() || b.id === "dl-pdf" ? "" : ' <svg class="ic lock"><use href="/assets/icons.svg#i-lock"/></svg>');
    });

    // A guest reads and rehearses; saving, sharing, transposing, singing and downloads are the account's.
    [$("save-section"), $("sing")].forEach(function (el) { guest ? hide(el) : show(el); });
    guest ? hide(document.getElementById("tr-apply").closest(".section")) : show(document.getElementById("tr-apply").closest(".section"));
    guest ? show($("guest-cta")) : hide($("guest-cta"));
    if (guest) { hide($("r-upgrade")); show($("r-watermark")); }

    show($("result"));
    rise($("result"));
    engrave(result.musicXml);
    showParts(result);
    syncActions();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * "Which doh is it?" When the worker was unsure of the doh it sends the other keys the voice fits
   * nearly as well, each with the notes and the sheet written in its scale: a note the singer left
   * between two tones becomes that key's tone rather than an accidental. Asked once, before saving,
   * so the answer is what gets saved; a sheet with parts is written against one key and is not asked.
   */
  function renderDohAsk(result) {
    var box = $("r-doh");
    var count = (result.notes || []).length;
    var alts = (result.keyAlternatives || []).filter(function (a) {
      return a.musicXml && a.pitches && a.pitches.length === count && C.keyHeader(a.key) !== C.keyHeader(result.key);
    });
    if (!current || current.savedId || current.dohAnswered || result.parts || !alts.length) { hide(box); return; }
    // A hymn on offer comes first: its version brings its own key, which settles the doh.
    if (H.ask(result, current) === "version") { hide(box); return; }
    box.innerHTML = "";
    var text = document.createElement("span");
    text.textContent = "Your tune fits more than one doh about as well. Which one did you sing in?";
    var row = document.createElement("span");
    row.className = "doh-choices";
    function choice(label, primary, onPick) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm " + (primary ? "btn-primary" : "btn-ghost");
      b.textContent = label;
      b.addEventListener("click", onPick);
      row.appendChild(b);
    }
    choice(C.keyHeader(result.key), true, function () { current.dohAnswered = true; hide(box); track("Kept doh"); });
    alts.forEach(function (alt) { choice(C.keyHeader(alt.key), false, function () { pickDoh(alt); }); });
    box.appendChild(text);
    box.appendChild(row);
    show(box);
  }

  function pickDoh(alt) {
    var r = current.result;
    var notes = C.label((r.notes || []).map(function (n, i) { return Object.assign({}, n, { pitchMidi: alt.pitches[i] }); }), alt.key);
    var chords = r.chords ? r.chords.map(function (ch) {
      return Object.assign({}, ch, { solfa: C.label([{ pitchMidi: 60 + ch.root, startBeat: 0 }], alt.key, [{ pitchMidi: 60 }])[0].solfa });
    }) : r.chords;
    current.dohAnswered = true;
    track("Chose another doh");
    var next = Object.assign({}, r, {
      key: alt.key, notes: notes, musicXml: alt.musicXml, chords: chords,
      solfaLines: C.renderLines(notes, C.keyHeader(alt.key), r.timeSignature)
    });
    current.result = next;
    showResult(next);
  }

  /**
   * "This sounds like Amazing Grace (hymnbook, 3/4). Use the hymnbook version?" The worker recognised a
   * hymn we hold (assets/hymnbook.js decides when to ask); Yes swaps the sheet to the published score in
   * the key that was sung, and saving then keeps the hymn's credit. A recognition-only match is named and
   * linked, with nothing to swap. Asked once, before saving, like the doh.
   */
  function renderHymnAsk(result) {
    var box = $("r-hymnbook");
    var what = current ? H.ask(result, current) : null;
    if (!what) { hide(box); return; }
    var m = result.hymnMatch;
    box.innerHTML = "";
    var text = document.createElement("span");
    text.appendChild(document.createTextNode("This sounds like "));
    var name = document.createElement("a");
    name.href = m.url; name.target = "_blank"; name.rel = "noopener";
    name.textContent = what === "version" ? H.label(m) : m.title;
    var em = document.createElement("em"); em.appendChild(name);
    text.appendChild(em);
    text.appendChild(document.createTextNode(what === "version" ? ". Use the hymnbook version?" : "."));
    var row = document.createElement("span");
    row.className = "doh-choices";
    function choice(label, primary, onPick) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm " + (primary ? "btn-primary" : "btn-ghost");
      b.textContent = label;
      b.addEventListener("click", onPick);
      row.appendChild(b);
    }
    if (what === "version") {
      choice("Yes", true, function () { pickHymn(m); });
      choice("No", false, function () { current.hymnAnswered = true; track("Kept transcription over hymnbook", m.slug); showResult(current.result); });
    } else {
      choice("Dismiss", false, function () { current.hymnAnswered = true; hide(box); });
    }
    box.appendChild(text);
    box.appendChild(row);
    show(box);
    if (!current.hymnShown) { current.hymnShown = true; track("Hymn recognised", m.slug); }
  }

  function pickHymn(match) {
    current.hymnAnswered = true;
    current.dohAnswered = true;
    // The first verse goes under the notes, unless words were typed already.
    if (!(current.lyrics || "").trim() && match.lyrics) current.lyrics = match.lyrics;
    track("Took hymnbook version", match.slug);
    var next = H.swap(current.result, match);
    current.result = next;
    showResult(next);
  }

  /** "Hymnbook version of “Amazing Grace”. Melody and words from …", with the hymn's page linked. */
  function creditHymn(el, hymn) {
    el.textContent = H.credit(hymn) + " ";
    if (hymn.url) {
      var a = document.createElement("a");
      a.href = hymn.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "See the hymn";
      el.appendChild(a);
    }
  }

  function formatSec(s) {
    s = Math.round(s || 0);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  /** ", 1:05–1:35 of 3:33" when a part of the song was picked; nothing otherwise. */
  function sectionNote(src) {
    if (!src || src.startSeconds == null || src.endSeconds == null) return "";
    var fmt = window.NfRangePicker.formatTime;
    return ", " + fmt(src.startSeconds) + "–" + fmt(src.endSeconds) + (src.durationSeconds ? " of " + fmt(src.durationSeconds) : "") + ",";
  }

  /**
   * The solfa lines, and under them the hymn-book layout once there are words. When chords were
   * heard, the layout is drawn whatever the words, with each chord over the bar it starts in: the
   * letter name with its root in solfa beneath ("F" over "d", "Dm" over "l").
   */
  function renderSolfa(result) {
    var lines = result.solfaLines && result.solfaLines.length > 1 ? result.solfaLines : C.renderLines(result.notes || [], C.keyHeader(result.key), result.timeSignature);
    var hasLyrics = !!(current.lyrics && current.lyrics.trim()), hasChords = N.has(result.chords);
    var solfa = $("r-solfa-text");
    solfa.innerHTML = "";
    (hasLyrics || hasChords ? lines.slice(0, 1) : lines).forEach(function (line, i) {
      var div = document.createElement("div");
      if (i === 0 && /^Doh is/i.test(line)) div.className = "doh";
      div.textContent = line;
      solfa.appendChild(div);
    });
    var hymn = $("r-hymn"); hymn.innerHTML = ""; hymnCells = [];
    if (hasChords) { hymnCells = N.renderGrid(hymn, N.grid(result.notes || [], current.lyrics, result.chords, result.timeSignature), hasLyrics); return; }
    if (!hasLyrics) return;
    var bpb = C.beatsPerBar(result.timeSignature);
    C.hymnRows(result.notes || [], current.lyrics, result.timeSignature).forEach(function (bars, r) {
      var table = document.createElement("table"); table.className = "hymn"; var tr = document.createElement("tr");
      bars.forEach(function (bar, b) {
        var td = document.createElement("td");
        bar.forEach(function (cell, c) {
          var span = document.createElement("span"); span.className = "cell";
          var bEl = document.createElement("b"); bEl.textContent = cell.solfa; var iEl = document.createElement("i"); iEl.textContent = cell.lyric;
          span.appendChild(bEl); span.appendChild(iEl); td.appendChild(span);
          hymnCells.push({ el: bEl, beat: (r * 4 + b) * bpb + c * 0.5 });
        });
        tr.appendChild(td);
      });
      table.appendChild(tr); hymn.appendChild(table);
    });
  }

  /** The progression as a list, when chords were heard; the row over the solfa is renderSolfa's. */
  function renderChords(result) {
    if (!N.has(result.chords)) { hide($("chords-card")); return; }
    N.renderList($("chord-list"), result.chords, result.tempo);
    result.chordsSource === "heard" ? show($("chords-heard")) : hide($("chords-heard"));
    show($("chords-card"));
  }

  $("lyrics").addEventListener("input", function () {
    if (!current || !current.result) return;
    current.lyrics = $("lyrics").value;
    renderSolfa(current.result);
  });
  $("lyrics").addEventListener("change", function () {
    if (!current || !current.savedId) return;
    request("/api/library/" + current.savedId + "/lyrics", { method: "PUT", body: { lyrics: $("lyrics").value } })
      .catch(function (err) { alertIn($("app-alert"), "danger", "The lyrics were not saved: " + (err.message || err)); });
  });

  // ── Rehearsal player ─────────────────────────────────────────────────────
  function rehearsalVoices(result) {
    // The tune is the soprano: the parts' own soprano when written (a man's tune sits an octave up
    // there, over the alto, tenor and bass written for it), the melody otherwise.
    var voices = [{ name: "soprano", notes: C.partReference(result.parts, result.notes), gain: 1 }];
    if (result.parts) { // the parts it has: Pro, or the free harmony
      C.VOICES.forEach(function (v) { if (v !== "soprano" && result.parts[v] && result.parts[v].notes) voices.push({ name: v, notes: result.parts[v].notes, gain: 0.8 }); });
    }
    return voices;
  }
  function setupRehearsal(result) {
    if (!player) {
      player = C.createPlayer();
      $("play").addEventListener("click", function () { player.toggle(); });
      $("restart").addEventListener("click", function () { player.stop(); player.play(); });
      $("rate").addEventListener("change", function () { player.setRate(parseFloat($("rate").value)); });
      ["loop-on", "loop-from", "loop-to"].forEach(function (id) { $(id).addEventListener("change", applyLoop); });
      $("backing-on").addEventListener("change", function () { player.setBackingOn($("backing-on").checked); });
      player.onTick(function (t) {
        label($("play"), t.playing ? "pause" : "play", t.playing ? "Pause" : "Play");
        var now = -1;
        for (var i = 0; i < hymnCells.length; i++) if (hymnCells[i].beat <= t.beat + 1e-6) now = i;
        hymnCells.forEach(function (c, i) { c.el.className = t.playing && i === now ? "now" : ""; });
        practiceTick(t);
      });
    }
    var voices = rehearsalVoices(result);
    player.load({ voices: voices, tempoBpm: result.tempo, timeSignature: result.timeSignature });
    // The song's own backing, when the worker isolated the voice: the solfa melody plays
    // over the instrumental, in time, instead of a piano on its own.
    var backing = $("backing-group");
    if (result.backingAudioBase64) {
      show(backing);
      player.setBacking(base64ToBytes(result.backingAudioBase64).buffer, result.beatOriginSec || 0);
      $("backing-on").checked = true; player.setBackingOn(true);
    } else { hide(backing); player.setBacking(null, 0); player.setBackingOn(false); }
    var bars = C.barCount(result.notes || [], result.timeSignature);
    $("loop-from").max = bars; $("loop-to").max = bars; $("loop-to").value = Math.min(4, bars); $("loop-from").value = 1; $("loop-on").checked = false;
    var box = $("voices"), hear = $("part-mix-voices");
    box.querySelectorAll("button").forEach(function (b) { b.remove(); });
    hear.innerHTML = "";
    mix = P.mixFor(voices.map(function (v) { return v.name; }));
    if (voices.length > 1) {
      show(box); show($("part-mix"));
      voices.forEach(function (v) {
        var name = v.name.charAt(0).toUpperCase() + v.name.slice(1);
        var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm on"; b.textContent = name.charAt(0);
        b.setAttribute("data-voice", v.name); b.setAttribute("aria-label", name);
        b.addEventListener("click", function () { mix = P.toggle(mix, v.name); applyMix(); });
        box.appendChild(b);
        // The same voice on the four-parts view: on/off, and Solo to hear it alone.
        var item = document.createElement("span"); item.className = "mix-voice"; item.setAttribute("data-voice", v.name);
        var on = document.createElement("button"); on.type = "button"; on.className = "mix-on"; on.setAttribute("aria-label", name);
        on.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-volume"/></svg><span></span>';
        on.querySelector("span").textContent = name;
        on.addEventListener("click", function () { mix = P.toggle(mix, v.name); applyMix(); });
        var solo = document.createElement("button"); solo.type = "button"; solo.className = "mix-solo"; solo.textContent = "Solo";
        solo.setAttribute("aria-label", "Hear only " + v.name);
        solo.addEventListener("click", function () { mix = P.solo(mix, v.name); applyMix(); track("Parts mix: solo"); });
        item.appendChild(on); item.appendChild(solo);
        hear.appendChild(item);
      });
      applyMix();
    } else { hide(box); hide($("part-mix")); }
  }
  /**
   * Which voices play (assets/parts.js): one state, drawn twice — the Hear row on the four-parts view
   * and the Voices group in Rehearse — so a voice muted in one is muted in the other.
   */
  var mix = {};
  function applyMix() {
    var alone = P.soloed(mix);
    Object.keys(mix).forEach(function (name) { player.setVoiceOn(name, !!mix[name]); });
    $("voices").querySelectorAll("button[data-voice]").forEach(function (b) {
      var on = !!mix[b.getAttribute("data-voice")];
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
      b.title = (on ? "Mute " : "Hear ") + b.getAttribute("data-voice");
    });
    $("part-mix-voices").querySelectorAll(".mix-voice").forEach(function (item) {
      var name = item.getAttribute("data-voice"), on = !!mix[name];
      var t = item.querySelector(".mix-on"), s = item.querySelector(".mix-solo");
      item.classList.toggle("is-off", !on);
      t.querySelector("use").setAttribute("href", on ? "/assets/icons.svg#i-volume" : "/assets/icons.svg#i-x");
      t.setAttribute("aria-pressed", String(on)); t.title = on ? "Playing: press to mute " + name : "Muted: press to hear " + name;
      s.classList.toggle("on", alone === name); s.setAttribute("aria-pressed", String(alone === name));
    });
  }
  function applyLoop() {
    if (!player) return;
    if ($("loop-on").checked) player.setLoopBars(parseInt($("loop-from").value, 10) || 1, parseInt($("loop-to").value, 10) || 1);
    else player.setLoopBars(null, null);
  }

  // ── Sing it: a take, marked note by note ─────────────────────────────────
  var sing = { voice: "soprano", recorder: null, stream: null, ctx: null, timer: null, stopAt: null, startedAt: 0, leadIn: 0, notes: [] };
  function singNotes() {
    var r = current.result;
    if (sing.voice !== "soprano" && isPro() && r.parts && r.parts[sing.voice]) return r.parts[sing.voice].notes || [];
    return r.notes || [];
  }
  function setupSing(result) {
    var box = $("sing-voices");
    box.querySelectorAll("button").forEach(function (b) { b.remove(); });
    var voices = ["soprano"].concat(isPro() && result.parts ? C.VOICES.filter(function (v) { return v !== "soprano" && result.parts[v]; }) : []);
    sing.voice = "soprano";
    voices.forEach(function (v) {
      var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm" + (v === sing.voice ? " on" : "");
      b.textContent = v === "soprano" ? "Tune" : v[0].toUpperCase() + v.slice(1);
      b.addEventListener("click", function () { sing.voice = v; box.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); }); });
      box.appendChild(b);
    });
    hide($("sing-result")); hide($("sing-live")); $("sing-status").textContent = "";
  }
  /** A bar of the starting note, then a bar of clicks, on the audio context's clock (at `rate`, 1 = the sheet's tempo). Returns the lead-in length. */
  function playLeadIn(ctx, notes, tempo, ts, rate) {
    var bpb = C.beatsPerBar(ts), beat = 60 / Math.max(30, tempo) / (rate || 1), t0 = ctx.currentTime + 0.05;
    var first = notes.slice().sort(function (a, b) { return a.startBeat - b.startBeat; })[0];
    // The starting note on the same piano the rehearsal player uses, held for the bar. The
    // piano is normally loaded by now (the player fetches it when the sheet is shown); if it
    // is not, the note starts when it arrives and still ends on the bar-line.
    var out = C.createPianoOutput(ctx), barEnd = t0 + bpb * beat;
    C.loadPiano(ctx).then(function () {
      var at = Math.max(t0, ctx.currentTime);
      if (barEnd - at > 0.05) C.pianoNote(ctx, out, first ? first.pitchMidi : 60, barEnd - at, at, 0.9);
    }, function () { /* no piano: the clicks still count the singer in */ });
    for (var i = 0; i < 2 * bpb; i++) {
      var at = t0 + i * beat, click = ctx.createOscillator(), cg = ctx.createGain();
      click.frequency.value = i % bpb === 0 ? 1500 : 1000; cg.gain.setValueAtTime(0.4, at); cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      click.connect(cg); cg.connect(ctx.destination); click.start(at); click.stop(at + 0.06);
    }
    return 2 * bpb * beat;
  }
  $("sing-start").addEventListener("click", function () {
    if (!current || !current.result) return;
    if (!isPro()) { pitchPro(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { $("sing-status").textContent = "This browser cannot record audio."; return; }
    var r = current.result, notes = singNotes();
    if (!notes.length) return;
    hide($("sing-result"));
    var at = epoch;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (stream) {
      if (at !== epoch) { stream.getTracks().forEach(function (t) { t.stop(); }); return; } // signed out meanwhile
      sing.stream = stream; sing.notes = notes;
      sing.ctx = new (window.AudioContext || window.webkitAudioContext)();
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      var chunks = [];
      sing.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      sing.recorder.addEventListener("dataavailable", function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      sing.recorder.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (at !== epoch) return; // a take cancelled by signing out is not sent
        var type = sing.recorder.mimeType || mime || "audio/webm";
        var blob = new Blob(chunks, { type: type });
        gradeTake(blob, type.indexOf("mp4") >= 0 ? "take.mp4" : "take.webm", notes, r.tempo, sing.leadIn);
      });
      sing.recorder.start();
      sing.startedAt = Date.now();
      sing.leadIn = playLeadIn(sing.ctx, notes, r.tempo, r.timeSignature);
      var beat = 60 / Math.max(30, r.tempo), end = notes.reduce(function (m, n) { return Math.max(m, n.startBeat + n.durBeats); }, 0) * beat;
      hide($("sing-start")); show($("sing-stop")); show($("sing-live"));
      sing.timer = setInterval(function () {
        var t = (Date.now() - sing.startedAt) / 1000, live = $("sing-live");
        if (t < sing.leadIn) { live.innerHTML = ""; live.textContent = (notes[0].solfa || "") + (notes[0].octaveMark || ""); var s = document.createElement("small"); s.textContent = "starting note… sing in " + Math.max(0, Math.ceil(sing.leadIn - t)); live.appendChild(s); return; }
        var b = (t - sing.leadIn) / beat, due = null;
        for (var i = 0; i < notes.length; i++) if (b >= notes[i].startBeat && b < notes[i].startBeat + notes[i].durBeats) due = notes[i];
        live.textContent = due ? (due.solfa || "") + (due.octaveMark || "") : "·"; var s2 = document.createElement("small"); s2.textContent = "sing!"; live.appendChild(s2);
      }, 100);
      sing.stopAt = setTimeout(stopSinging, (sing.leadIn + end + 1.0) * 1000);
      $("sing-status").textContent = "Recording…";
    }).catch(function (err) { $("sing-status").textContent = "Microphone access is needed to record a take (" + (err.message || err) + ")."; });
  });
  function stopSinging() {
    if (sing.timer) clearInterval(sing.timer); if (sing.stopAt) clearTimeout(sing.stopAt);
    sing.timer = null; sing.stopAt = null;
    hide($("sing-live")); hide($("sing-stop")); show($("sing-start"));
    if (sing.recorder && sing.recorder.state !== "inactive") { $("sing-status").textContent = "Marking your take…"; sing.recorder.stop(); }
    if (sing.ctx) { sing.ctx.close().catch(function () {}); sing.ctx = null; }
  }
  /** Signing out mid-take: the microphone is released and nothing is marked (resetWork bumps epoch first). */
  function cancelSinging() {
    stopSinging();
    $("sing-status").textContent = "";
    hide($("sing-result"));
  }
  $("sing-stop").addEventListener("click", stopSinging);
  function gradeTake(blob, name, notes, tempo, leadIn) {
    var at = epoch;
    var form = new FormData();
    form.append("audio", blob, name);
    form.append("target", JSON.stringify({ notes: notes.map(function (n) { return { pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats }; }), tempoBpm: tempo, leadInSec: leadIn }));
    track("Sang along");
    request("/api/transcriptions/grade", { method: "POST", form: form }).then(function (g) {
      if (at !== epoch) return;
      $("sing-status").textContent = "";
      $("sing-score").textContent = g.score; $("sing-score").style.color = g.score >= 80 ? "var(--success)" : g.score >= 50 ? "#B45309" : "var(--danger)";
      $("sing-summary").textContent = g.summary + (g.octaveShift ? " Sung " + (g.octaveShift > 0 ? "an octave up" : "an octave down") + " — that's fine." : "");
      var marks = $("sing-marks"); marks.innerHTML = "";
      (g.notes || []).forEach(function (m) {
        var n = notes[m.index]; if (!n) return;
        var el = document.createElement("span"); el.className = "mark " + m.status; el.textContent = (n.solfa || "") + (n.octaveMark || "");
        var s = document.createElement("small"); s.textContent = m.status === "missed" ? "—" : (m.cents == null ? "" : (m.cents > 0 ? "+" : "") + Math.round(m.cents)); el.appendChild(s);
        marks.appendChild(el);
      });
      show($("sing-result"));
    }).catch(function (err) { if (at === epoch) $("sing-status").textContent = "Could not mark the take: " + (err.message || err); });
  }

  // ── Learn my part (assets/practice.js) ───────────────────────────────────
  // One view over the rehearsal player: my part loud and the others soft, a few bars looped and
  // slowed down, then sung back and marked. Practising is free wherever the parts show; the marking
  // is Pro, as Sing it is. Leaving the view puts the player back the way Rehearse and Hear had it.
  var PR = window.NfPractice;
  var PRACTICE_PART_KEY = "nf.web.practice.part";
  var practice = { open: false, part: "soprano", balance: "balance", speed: 1, range: { from: 1, to: 1 }, pending: null, bars: 0, marks: null, nowBar: 0 };
  var prTake = { recorder: null, stream: null, ctx: null, timer: null, stopAt: null, cancelled: false };
  function rememberedPart() { try { return localStorage.getItem(PRACTICE_PART_KEY); } catch (e) { return null; } }
  function practiceNames() { return PR.partsOf(current && current.result ? current.result.parts : null); }
  /** The part's notes, labelled as the parts view labels them: from the soprano's doh (C.partReference). */
  function practiceNotes(name) {
    var r = current.result, ref = C.partReference(r.parts, r.notes || []);
    var notes = name === "soprano" ? ref : (r.parts && r.parts[name] && r.parts[name].notes) || [];
    return C.label(notes, r.key, ref);
  }
  function voiceName(v) { return v === "soprano" ? "Soprano (the tune)" : v.charAt(0).toUpperCase() + v.slice(1); }
  function setupPractice(result) {
    var box = $("practice");
    cancelPracticeTake();
    if (!P.hasParts(result)) { hide(box); syncActions(); return; }
    show(box);
    var names = practiceNames();
    practice.part = PR.choosePart(names, rememberedPart());
    practice.bars = player ? player.barCount() : C.barCount(result.notes || [], result.timeSignature);
    practice.range = PR.defaultRange(practice.bars); practice.pending = null; practice.marks = null;
    var seg = $("pr-parts"); seg.innerHTML = "";
    names.forEach(function (v) {
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("data-part", v);
      b.textContent = v.charAt(0).toUpperCase(); b.setAttribute("aria-label", voiceName(v)); b.title = voiceName(v);
      b.addEventListener("click", function () {
        if (prTake.recorder || practice.part === v) return;
        practice.part = v; practice.marks = null; hide($("pr-result"));
        try { localStorage.setItem(PRACTICE_PART_KEY, v); } catch (e) { /* private mode: chosen for this visit */ }
        track("Practice part", v);
        renderPractice(); applyPracticeMix();
      });
      seg.appendChild(b);
    });
    hide($("pr-result")); hide($("pr-live")); $("pr-status").textContent = "";
    isPro() ? hide($("pr-sing-lock")) : show($("pr-sing-lock")); // marking a take is Pro, as Sing it is
    renderPractice();
    syncActions();
  }
  function renderPractice() {
    if (!current || !current.result) return;
    $("pr-parts").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-part") === practice.part)); });
    $("pr-balance").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-balance") === practice.balance)); });
    $("pr-speed").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(parseFloat(b.getAttribute("data-speed")) === practice.speed)); });
    var rg = practice.range;
    $("pr-range").textContent = (rg.from === rg.to ? "Bar " + rg.from : "Bars " + rg.from + "–" + rg.to) + " of " + practice.bars;
    $("pr-whole").disabled = rg.from === 1 && rg.to === practice.bars;
    $("pr-hint").textContent = practice.pending != null ? "Now tap the last bar to loop." : "Tap a bar, then another, to loop the bars between them.";
    var strip = $("pr-bars"); strip.innerHTML = "";
    PR.bars(practiceNotes(practice.part), current.result.timeSignature, practice.bars).forEach(function (bar) {
      var b = document.createElement("button"); b.type = "button"; b.className = "pr-bar";
      var inside = bar.bar >= rg.from && bar.bar <= rg.to;
      if (inside) b.classList.add("in");
      if (bar.bar === practice.pending) b.classList.add("pending");
      if (bar.bar === practice.nowBar) b.classList.add("now");
      b.setAttribute("data-bar", bar.bar); b.setAttribute("aria-pressed", String(inside));
      var num = document.createElement("small"); num.textContent = bar.bar; b.appendChild(num);
      var line = document.createElement("span"); line.className = "pr-notes";
      if (!bar.notes.length) line.textContent = "–";
      bar.notes.forEach(function (x) {
        var el = document.createElement("i"); el.textContent = (x.note.solfa || "") + (x.note.octaveMark || "");
        var m = practice.marks && practice.marks[x.i];
        if (m) { el.className = "mk-" + m.status; el.title = m.status === "missed" ? "not sung" : m.status + (m.cents == null ? "" : " (" + (m.cents > 0 ? "+" : "") + Math.round(m.cents) + " cents)"); }
        line.appendChild(el);
      });
      b.appendChild(line);
      b.setAttribute("aria-label", "Bar " + bar.bar + (bar.notes.length ? ": " + bar.notes.map(function (x) { return (x.note.solfa || "") + (x.note.octaveMark || ""); }).join(" ") : ", rest"));
      b.addEventListener("click", function () {
        if (prTake.recorder) return;
        var next = PR.tapBar(practice.pending, bar.bar);
        practice.range = next.range; practice.pending = next.pending; practice.marks = null; hide($("pr-result"));
        if (practice.open) player.setLoopBars(practice.range.from, practice.range.to);
        if (next.pending == null) track("Practice loop set");
        renderPractice();
      });
      strip.appendChild(b);
    });
  }
  /** Every voice sounding, at the practice levels: my part at 1, the others by the balance. */
  function applyPracticeMix() {
    if (!player || !practice.open) return;
    var lv = PR.levels(practiceNames(), practice.part, practice.balance);
    Object.keys(lv).forEach(function (n) { player.setVoiceOn(n, true); player.setVoiceLevel(n, lv[n]); });
  }
  function enterPractice() {
    if (!player || !current || !current.result) return;
    practice.open = true;
    applyPracticeMix();
    player.setRate(practice.speed);
    player.setLoopBars(practice.range.from, practice.range.to);
    track("Practice started", practice.part);
  }
  function leavePractice() {
    cancelPracticeTake();
    if (!practice.open) return;
    practice.open = false; practice.nowBar = 0;
    if (!player) return;
    player.pause();
    practiceNames().forEach(function (n) { player.setVoiceLevel(n, 1); });
    applyMix();
    player.setRate(parseFloat($("rate").value) || 1);
    applyLoop();
  }
  /** The player's tick, while the view is open: its Play button and the bar sounding. */
  function practiceTick(t) {
    if (!practice.open) return;
    label($("pr-play"), t.playing ? "pause" : "play", t.playing ? "Pause" : "Play");
    var bar = t.playing ? Math.floor(t.beat / C.beatsPerBar(current.result.timeSignature) + 1e-6) + 1 : 0;
    if (bar === practice.nowBar) return;
    practice.nowBar = bar;
    $("pr-bars").querySelectorAll(".pr-bar").forEach(function (b) { b.classList.toggle("now", +b.getAttribute("data-bar") === bar); });
  }
  $("pr-balance").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () {
      practice.balance = b.getAttribute("data-balance");
      track("Practice balance", practice.balance);
      renderPractice(); applyPracticeMix();
    });
  });
  $("pr-speed").querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function () {
      if (prTake.recorder) return;
      practice.speed = parseFloat(b.getAttribute("data-speed")) || 1;
      if (practice.open) player.setRate(practice.speed);
      track("Practice speed", String(practice.speed));
      renderPractice();
    });
  });
  $("pr-whole").addEventListener("click", function () {
    if (prTake.recorder) return;
    practice.range = { from: 1, to: practice.bars }; practice.pending = null; practice.marks = null; hide($("pr-result"));
    if (practice.open) player.setLoopBars(1, practice.bars);
    renderPractice();
  });
  $("pr-play").addEventListener("click", function () { if (player && !prTake.recorder) player.toggle(); });

  /**
   * Sing it back: the starting note and a bar of clicks, then the singer alone while the bars go by.
   * The others drop out for the take on purpose: grade.py follows one pitch (pyin), and a piano coming
   * back into the microphone is a second one it would follow; it lines the take up by the count-in.
   */
  $("pr-sing").addEventListener("click", function () {
    if (!current || !current.result || prTake.recorder) return;
    if (!isPro()) { track("Practice sing (locked)"); pitchPro(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { $("pr-status").textContent = "This browser cannot record audio."; return; }
    var r = current.result, speed = practice.speed, rg = practice.range;
    var slice = PR.sliceBars(practiceNotes(practice.part), rg.from, rg.to, r.timeSignature);
    if (!slice.notes.length) { $("pr-status").textContent = "There is nothing to sing in these bars. Choose bars with notes in your part."; return; }
    var leadEstimate = 2 * C.beatsPerBar(r.timeSignature) * 60 / Math.max(30, r.tempo) / speed;
    if (PR.tooLong(slice, r.tempo, speed, leadEstimate)) { $("pr-status").textContent = "That is more than two minutes to sing. Loop fewer bars, or a faster speed, and try again."; return; }
    if (player) player.pause();
    hide($("pr-result"));
    practice.marks = null; renderPractice();
    var at = epoch;
    prTake.cancelled = false;
    $("pr-status").textContent = "";
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (stream) {
      if (at !== epoch || prTake.cancelled) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      prTake.stream = stream;
      prTake.ctx = new (window.AudioContext || window.webkitAudioContext)();
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      var chunks = [], rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined), leadIn = 0;
      prTake.recorder = rec;
      rec.addEventListener("dataavailable", function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      rec.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (at !== epoch || prTake.cancelled) return; // cancelled: nothing is sent
        var type = rec.mimeType || mime || "audio/webm";
        gradePractice(new Blob(chunks, { type: type }), type.indexOf("mp4") >= 0 ? "take.mp4" : "take.webm", slice, PR.gradeTarget(slice, r.tempo, speed, leadIn));
      });
      rec.start();
      var startedAt = Date.now();
      leadIn = playLeadIn(prTake.ctx, slice.notes, r.tempo, r.timeSignature, speed);
      var beat = 60 / Math.max(30, r.tempo) / speed;
      hide($("pr-sing")); show($("pr-stop")); show($("pr-live"));
      $("pr-status").textContent = "Recording…";
      track("Practice take started", practice.part);
      prTake.timer = setInterval(function () {
        var t = (Date.now() - startedAt) / 1000, live = $("pr-live"), first = slice.notes[0], small = document.createElement("small");
        if (t < leadIn) {
          live.textContent = (first.solfa || "") + (first.octaveMark || "");
          small.textContent = "starting note… sing in " + Math.max(0, Math.ceil(leadIn - t));
        } else {
          var b = (t - leadIn) / beat, due = null; // in the sheet's beats: `beat` is one at this speed
          slice.notes.forEach(function (n) { if (b >= n.startBeat && b < n.startBeat + n.durBeats) due = n; });
          live.textContent = due ? (due.solfa || "") + (due.octaveMark || "") : "·";
          small.textContent = "sing!";
        }
        live.appendChild(small);
      }, 100);
      prTake.stopAt = setTimeout(stopPracticeTake, (leadIn + PR.sliceSeconds(slice, r.tempo, speed) + PR.TAIL_SEC) * 1000);
    }).catch(function () { if (at === epoch && !prTake.cancelled) $("pr-status").textContent = "Allow the microphone for this site to record a take, then try again."; });
  });
  /** Ends the take; it is marked unless it was cancelled. */
  function stopPracticeTake() {
    if (prTake.timer) clearInterval(prTake.timer);
    if (prTake.stopAt) clearTimeout(prTake.stopAt);
    prTake.timer = null; prTake.stopAt = null;
    hide($("pr-live")); hide($("pr-stop")); show($("pr-sing"));
    var rec = prTake.recorder; prTake.recorder = null;
    if (rec && rec.state !== "inactive") { if (!prTake.cancelled) $("pr-status").textContent = "Marking your take…"; rec.stop(); }
    else if (prTake.stream) prTake.stream.getTracks().forEach(function (t) { t.stop(); });
    prTake.stream = null;
    if (prTake.ctx) { prTake.ctx.close().catch(function () {}); prTake.ctx = null; }
  }
  /** Closing the view or signing out mid-take: the microphone is released and nothing is sent. */
  function cancelPracticeTake() {
    prTake.cancelled = true;
    stopPracticeTake();
    $("pr-status").textContent = "";
  }
  $("pr-stop").addEventListener("click", stopPracticeTake);
  $("pr-again").addEventListener("click", function () { hide($("pr-result")); $("pr-sing").click(); });
  function gradePractice(blob, name, slice, target) {
    var at = epoch, part = practice.part, range = practice.range;
    var form = new FormData();
    form.append("audio", blob, name);
    form.append("target", JSON.stringify(target));
    request("/api/transcriptions/grade", { method: "POST", form: form }).then(function (g) {
      if (at !== epoch) return;
      $("pr-status").textContent = "";
      track("Practice take marked", String(g.score));
      // Marks belong to the part and bars they were sung against; a change meanwhile drops them.
      if (practice.part !== part || practice.range !== range) return;
      practice.marks = PR.marksByNote(g, slice);
      $("pr-score").textContent = g.score;
      $("pr-score").style.color = g.score >= 80 ? "var(--success)" : g.score >= 50 ? "var(--amber)" : "var(--danger)";
      $("pr-summary").textContent = g.summary + (g.octaveShift ? " Sung " + (g.octaveShift > 0 ? "an octave up" : "an octave down") + " — that's fine." : "");
      renderPractice();
      show($("pr-result"));
    }).catch(function (err) { if (at === epoch) $("pr-status").textContent = "Could not mark the take: " + (err.message || "please try again."); });
  }

  // ── Transpose for my choir ───────────────────────────────────────────────
  function renderTranspose() {
    var r = current.result, n = current.semitones || 0;
    $("tr-value").textContent = n > 0 ? "+" + n : String(n);
    $("tr-key").textContent = n === 0 ? r.key : r.key + " → " + C.shiftKeyName(r.key, n);
    // While a shift is on its way the button stays as it is, and so do the arrows.
    $("tr-apply").disabled = n === 0 || transposing;
    $("tr-down").disabled = $("tr-up").disabled = transposing;
    $("tr-apply").textContent = n === 0 ? "Choose a shift" : "Transpose to " + C.shiftKeyName(r.key, n);
    var table = $("ranges"); table.innerHTML = "";
    C.rangeReport(r.notes || [], isPro() ? r.parts : null, n).forEach(function (row) {
      var tr = document.createElement("tr");
      var a = document.createElement("td"); a.textContent = row.voice;
      var b = document.createElement("td"); b.textContent = C.pitchName(row.low) + " – " + C.pitchName(row.high);
      var c = document.createElement("td");
      c.className = row.status === "ok" ? "ok" : row.overBy > 2 ? "bad" : "warn";
      c.textContent = row.status === "ok" ? "comfortable" : row.status === "wide" ? "too wide" : row.overBy + (row.overBy === 1 ? " semitone" : " semitones") + " too " + row.status;
      tr.appendChild(a); tr.appendChild(b); tr.appendChild(c); table.appendChild(tr);
    });
  }
  $("tr-down").addEventListener("click", function () { if (!current || transposing) return; current.semitones = Math.max(-12, (current.semitones || 0) - 1); renderTranspose(); });
  $("tr-up").addEventListener("click", function () { if (!current || transposing) return; current.semitones = Math.min(12, (current.semitones || 0) + 1); renderTranspose(); });
  $("tr-apply").addEventListener("click", function () {
    if (!current || !current.result || !current.semitones || transposing) return;
    var r = current.result, n = current.semitones, owner = current, at = epoch;
    transposing = true;
    renderTranspose();
    var req = current.savedId
      ? request("/api/library/" + current.savedId + "/transpose", { method: "POST", body: { semitones: n } })
      : request("/api/transcriptions/transpose", { method: "POST", body: { key: r.key, semitones: n, notes: r.notes, musicXml: r.musicXml, parts: r.parts || null, partsMusicXml: r.partsMusicXml || null, chords: r.chords || null } });
    track("Transposed");
    req.then(function (moved) {
      if (at !== epoch) return; // signed out meanwhile
      transposing = false;
      if (current !== owner) { if (current && current.result) renderTranspose(); return; } // another sheet opened meanwhile
      current.semitones = 0;
      var next = Object.assign({}, r, {
        key: moved.key, notes: moved.notes || [], musicXml: moved.musicXml || "",
        parts: moved.parts || null, partsMusicXml: moved.partsMusicXml || "", chords: moved.chords || null,
        solfaLines: C.renderLines(moved.notes || [], C.keyHeader(moved.key), r.timeSignature)
      });
      current.result = next;
      $("sheet-parts").innerHTML = "";
      showResult(next);
    }).catch(function (err) {
      if (at !== epoch) return;
      transposing = false;
      if (current && current.result) renderTranspose();
      alertIn($("app-alert"), "danger", "Could not transpose: " + (err.message || err));
    });
  });

  // ── One screen at a time: focus mode, the framed sheet, the tools in pop-ups ──
  /** Restarts the one-off entrance on an element that is shown again (CSS .rise, reduced-motion aware). */
  function rise(el) { el.classList.remove("rise"); void el.offsetWidth; el.classList.add("rise"); }
  // While a job runs or a sheet is showing, the greeting and the studio fold away: the work is the page.
  function syncFocus() {
    var on = !$("progress").classList.contains("hidden") || !$("result").classList.contains("hidden");
    document.body.classList.toggle("is-focus", on);
  }
  new MutationObserver(syncFocus).observe($("progress"), { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(syncFocus).observe($("result"), { attributes: true, attributeFilter: ["class"] });
  /** Back to the studio for another one. The sheet is kept in the library (or is the guest's preview). */
  function newTranscription() {
    if (pollTimer) return; // a job still running keeps its card
    closeTool(); closeFull();
    hide($("result")); hide($("progress"));
    window.scrollTo({ top: 0, behavior: "smooth" });
    track("New transcription");
  }
  $("r-new").addEventListener("click", newTranscription);
  document.querySelectorAll(".nav-new").forEach(function (b) {
    b.addEventListener("click", function () { if (!$("result").classList.contains("hidden")) newTranscription(); });
  });

  // The sheet full screen: a long song reads top to bottom without the page around it.
  function openFull() {
    $("sheet-stage").classList.add("is-full"); document.body.classList.add("sheet-full");
    $("r-expand").setAttribute("aria-pressed", "true"); $("r-collapse").focus();
    track("Sheet full screen");
  }
  function closeFull() {
    if (!$("sheet-stage").classList.contains("is-full")) return;
    $("sheet-stage").classList.remove("is-full"); document.body.classList.remove("sheet-full");
    $("r-expand").setAttribute("aria-pressed", "false"); $("r-expand").focus();
  }
  $("r-expand").addEventListener("click", function () { $("sheet-stage").classList.contains("is-full") ? closeFull() : openFull(); });
  $("r-collapse").addEventListener("click", closeFull);

  // The tools, one at a time. A tool's panel is moved into the pop-up and back again, so everything
  // already wired to it (ids, handlers, state) keeps working unchanged.
  var TOOL_LOCKS = {
    harmony: ["Alto, tenor and bass, with Pro", "Pro writes all four parts under your tune the way a hymn arranger would, ready for your choir to rehearse."],
    sing: ["Sing it, with Pro", "Sing your part into the microphone and see every note come back marked: in tune, close, or off."]
  };
  var openToolId = null, toolReturn = null;
  function openTool(id, opener) {
    var panel = $(id); if (!panel) return;
    closeTool();
    openToolId = id; toolReturn = opener || null;
    $("tool-body").appendChild(panel);
    // The one free four-part harmony opens the real tool, not the locked preview.
    var locked = !!TOOL_LOCKS[id] && !guest && !isPro() && !(id === "harmony" && freeHarmonyLeft());
    $("tool-modal").querySelector(".tool-card").classList.toggle("is-locked", locked);
    if (locked) { $("tool-lock-title").textContent = TOOL_LOCKS[id][0]; $("tool-lock-text").textContent = TOOL_LOCKS[id][1]; show($("tool-lock")); }
    else hide($("tool-lock"));
    var h = panel.querySelector("h2");
    $("tool-modal").setAttribute("aria-label", h ? h.textContent.replace(/\s*Pro\s*$/, "").trim() : "Tool");
    show($("tool-modal"));
    if (id === "practice") enterPractice();
    var first = locked ? $("tool-unlock") : panel.querySelector("button:not([disabled]), input, select, textarea");
    (first || $("tool-close")).focus();
    track("Tool: " + id + (locked ? " (locked)" : ""));
  }
  function closeTool() {
    if (!openToolId) return;
    if (openToolId === "practice") leavePractice();
    var panel = $(openToolId);
    if (panel) $("tool-dock").appendChild(panel);
    openToolId = null;
    hide($("tool-modal"));
    if (toolReturn && toolReturn.focus) toolReturn.focus();
    toolReturn = null;
  }
  document.querySelectorAll(".result-actions .act[data-tool]").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-tool");
      // "Four parts" on a sheet that has them goes to the parts; the pop-up is only for writing them.
      if (id === "harmony" && current && P.action(current.result) === "show") { revealParts(); return; }
      openTool(id, b);
    });
  });
  $("tool-close").addEventListener("click", closeTool);
  $("tool-modal").addEventListener("click", function (e) { if (e.target === $("tool-modal")) closeTool(); });
  $("tool-unlock").addEventListener("click", function () { closeTool(); openUpgrade(); });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (openToolId) { closeTool(); return; }
    closeFull();
  });
  /**
   * A tool shows in the row only when its panel applies to this sheet (the result logic hides the rest).
   * "Four parts" always applies: it writes the parts, or shows the ones the sheet has.
   */
  function syncActions() {
    document.querySelectorAll(".result-actions .act[data-tool]").forEach(function (b) {
      var id = b.getAttribute("data-tool"), panel = $(id);
      var showsParts = id === "harmony" && !!current && P.action(current.result) === "show";
      b.hidden = !showsParts && (!panel || panel.classList.contains("hidden"));
    });
  }
  /** A Pro-only action, from anywhere: close the pop-up and bring the Pro card into view. */
  function pitchPro() {
    closeTool(); closeFull();
    if (guest) { openAuth("register"); return; }
    show($("r-upgrade"));
    $("r-upgrade").scrollIntoView({ behavior: "smooth", block: "start" });
    rise($("r-upgrade"));
  }
  document.querySelectorAll(".pro-tile").forEach(function (t) {
    t.addEventListener("click", function () { track("Pro preview: " + t.getAttribute("data-upgrade")); openUpgrade(); });
  });

  /** The frosted four-part preview, written from this sheet's own opening so it looks like theirs. */
  var SCALE = ["d", "r", "m", "f", "s", "l", "t"];
  function previewParts(result) {
    var notes = (result.notes || []).slice(0, 8);
    if (notes.length < 4) return;
    function step(sol, by) {
      var i = SCALE.indexOf(String(sol || "").charAt(0)); if (i < 0) return sol || "d";
      var j = i + by, mark = j < 0 ? "," : j > 6 ? "'" : "";
      return SCALE[((j % 7) + 7) % 7] + mark;
    }
    function row(by) { return notes.map(function (n, k) { return (by === 0 ? (n.solfa || "d") + (n.octaveMark || "") : step(n.solfa, by)) + (k % 2 ? " |" : " :"); }).join(" ").replace(/ [:|]$/, ""); }
    var rows = $("pro-satb").children;
    [0, -2, 2, -4].forEach(function (by, i) {
      if (!rows[i]) return;
      rows[i].innerHTML = "<em>" + "SATB".charAt(i) + "</em>";
      rows[i].appendChild(document.createTextNode(row(by)));
    });
  }

  // ── Pro, under the sheet: what this song is missing, in its own words ────
  // The plans used to sit under the downloads at the very bottom, past every tool, so most people never
  // saw them. They now follow the sheet, and a free preview of a longer song says how much is locked.
  function renderUnlock(result) {
    previewParts(result);
    var dur = result.songDurationSec || 0, heard = 60;
    var cut = !!result.truncated && dur > heard;
    cut ? show($("r-unlock-rest")) : hide($("r-unlock-rest"));
    if (cut) {
      // The Pro card below says what is locked, so the long notice above the sheet becomes one chip.
      hide($("r-truncated"));
      var chip = document.createElement("span"); chip.className = "chip chip-preview";
      chip.textContent = "Preview · 1:00 of " + formatSec(dur);
      $("r-chips").appendChild(chip);
      $("r-unlock-left").textContent = formatSec(dur - heard) + " more of this song";
      $("r-unlock-title").textContent = "Unlock the rest of this song";
      $("r-unlock-lead").textContent = "You've seen the first minute of " + formatSec(dur) + ". Pro writes out the whole song — every bar, with the alto, tenor and bass under it and a PDF without the mark.";
    } else {
      $("r-unlock-title").textContent = "Take this sheet to your choir";
      $("r-unlock-lead").textContent = "Pro adds the alto, tenor and bass under the tune, the PDF, MusicXML and MIDI with no watermark, and whole songs up to six minutes.";
    }
  }

  // ── How did it come out? Asked under every fresh transcription ──────────
  // One tap; "close" or "off" then asks what was off. The answer goes to the API as a "transcription"
  // verdict with the job id, so the engine's misses can be found again. Answered jobs are remembered on
  // this browser and not asked twice.
  var VERDICT_KEY = "nf.web.verdicts";
  function verdictsGiven() { try { return JSON.parse(localStorage.getItem(VERDICT_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function rememberVerdict(jobId, verdict) {
    var all = verdictsGiven(); all[jobId] = verdict;
    var ids = Object.keys(all); if (ids.length > 200) delete all[ids[0]];
    try { localStorage.setItem(VERDICT_KEY, JSON.stringify(all)); } catch (e) { /* private mode */ }
  }
  var verdictPick = null, issuePick = null;
  function renderVerdict() {
    var box = $("r-verdict");
    // Only a fresh job of a signed-in account: a guest cannot send it, and a saved sheet was judged already.
    if (guest || !current || !current.jobId || current.kind === "library") { hide(box); return; }
    verdictPick = null; issuePick = null;
    $("verdict-more").hidden = true; $("verdict-note").value = "";
    hide($("verdict-thanks"));
    box.querySelectorAll(".verdict, .issue").forEach(function (b) { b.setAttribute("aria-pressed", "false"); b.disabled = false; });
    var given = verdictsGiven()[current.jobId];
    if (given) {
      box.querySelector('.verdict[data-verdict="' + given + '"]').setAttribute("aria-pressed", "true");
      thankVerdict(given);
    }
    show(box);
  }
  function thankVerdict(v) {
    $("verdict-more").hidden = true;
    $("verdict-thanks").textContent = String(v) === "5"
      ? "Thank you — glad it came out right."
      : "Thank you. We use every one of these to make the next transcription better.";
    show($("verdict-thanks"));
  }
  function sendVerdict() {
    if (!current || !current.jobId || !verdictPick) return;
    var jobId = current.jobId, v = verdictPick, issue = issuePick, note = $("verdict-note").value.trim();
    $("verdict-send").disabled = true;
    request("/api/feedback", { method: "POST", body: {
      kind: "transcription", rating: Number(v), category: v === "5" ? null : issue, message: note || null,
      jobId: jobId, client: "web", screen: "Result"
    } }).then(function () {
      rememberVerdict(jobId, v);
      track("Transcription verdict", (v === "5" ? "spot on" : v === "3" ? "close" : "off") + (issue ? " · " + issue : ""));
      if (current && current.jobId === jobId) thankVerdict(v);
    }).catch(function () {
      alertIn($("app-alert"), "danger", "Couldn't send that just now. Please try again in a moment.");
    }).finally(function () { $("verdict-send").disabled = false; });
  }
  document.querySelectorAll("#r-verdict .verdict").forEach(function (b) {
    b.addEventListener("click", function () {
      verdictPick = b.getAttribute("data-verdict");
      document.querySelectorAll("#r-verdict .verdict").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
      hide($("verdict-thanks"));
      if (verdictPick === "5") { sendVerdict(); return; }
      $("verdict-more").hidden = false;
    });
  });
  document.querySelectorAll("#r-verdict .issue").forEach(function (b) {
    b.addEventListener("click", function () {
      issuePick = b.getAttribute("aria-pressed") === "true" ? null : b.getAttribute("data-issue");
      document.querySelectorAll("#r-verdict .issue").forEach(function (o) { o.setAttribute("aria-pressed", String(o.getAttribute("data-issue") === issuePick)); });
    });
  });
  $("verdict-send").addEventListener("click", sendVerdict);

  // ── Save & share ─────────────────────────────────────────────────────────
  function renderSave() {
    if (current.savedId) { hide($("save-form")); show($("saved")); $("saved-title").textContent = current.title || ""; renderShare(); }
    else {
      show($("save-form")); hide($("saved"));
      var src = current.result.source || current.source;
      if (!$("save-title").value) $("save-title").value = src ? (src.title + (src.artist ? " — " + src.artist : "")) : "My transcription";
    }
  }
  function renderShare() {
    if (current.shareToken) {
      $("share-url").value = "https://notefusion.studio/app/sheet/?s=" + encodeURIComponent(current.shareToken);
      show($("share-row")); $("share").textContent = "Share a link";
    } else hide($("share-row"));
  }
  /**
   * Saves the sheet on screen. `auto` is the preview someone just signed up to keep: it is saved for
   * them, with a note saying so, rather than waiting for a Save press that most never made (one in
   * fifty-two previews was ever saved).
   */
  function saveCurrent(auto) {
    if (!current || !current.result || current.savedId) return;
    var r = current.result, btn = $("save");
    btn.disabled = true;
    request("/api/library", { method: "POST", body: {
      title: $("save-title").value.trim() || "My transcription", key: r.key, tempoBpm: r.tempo, timeSignature: r.timeSignature,
      musicXml: r.musicXml, notes: r.notes, overallConfidence: r.overallConfidence, sourceJobId: current.jobId,
      lyrics: (current.lyrics || "").trim(), parts: r.parts || null, partsMusicXml: r.partsMusicXml || null,
      chords: r.chords || null, hymnSlug: r.hymn ? r.hymn.slug : null
    } }).then(function (saved) {
      sfx.play("saved");
      track("Saved sheet", auto ? "preview kept at sign-up" : null);
      if (auto) alertIn($("app-alert"), "success", "Your preview is saved to your library.");
      current.savedId = saved.id; current.title = saved.title; current.shareToken = saved.shareToken || null;
      libraryCache = null;
      renderSave();
      var dismissed = false; try { dismissed = localStorage.getItem("nf.web.appBanner") === "no"; } catch (e) { /* ignore */ }
      if (!dismissed) show($("app-banner"));
    }).catch(function (err) { alertIn($("app-alert"), "danger", "Could not save: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  }
  $("save").addEventListener("click", function () { saveCurrent(false); });
  /** The preview job a new account was created to keep; saved as soon as its result is on screen. */
  var keepPreviewJob = null;
  function keepClaimedPreview() {
    if (!keepPreviewJob || guest || !current || current.jobId !== keepPreviewJob || !current.result) return;
    keepPreviewJob = null;
    saveCurrent(true);
  }
  $("app-banner-dismiss").addEventListener("click", function () { hide($("app-banner")); try { localStorage.setItem("nf.web.appBanner", "no"); } catch (e) { /* ignore */ } });
  $("share").addEventListener("click", function () {
    if (!current || !current.savedId) return;
    var btn = $("share"); btn.disabled = true;
    request("/api/library/" + current.savedId + "/share", { method: "POST" })
      .then(function (link) { current.shareToken = link.token; renderShare(); $("share-url").select(); track("Shared sheet"); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not share: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("share-copy").addEventListener("click", function () {
    var url = $("share-url").value;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { $("share-copy").textContent = "Copied"; setTimeout(function () { $("share-copy").textContent = "Copy"; }, 1500); }, function () { $("share-url").select(); });
  });
  $("share-stop").addEventListener("click", function () {
    if (!current || !current.savedId) return;
    request("/api/library/" + current.savedId + "/share", { method: "DELETE" })
      .then(function () { current.shareToken = null; renderShare(); })
      .catch(function (err) { alertIn($("app-alert"), "danger", "Could not stop sharing: " + (err.message || err)); });
  });

  document.querySelectorAll(".result-tabs .tab[data-view]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".result-tabs .tab").forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      var view = tab.dataset.view;
      view === "staff" ? show($("r-staff")) : hide($("r-staff"));
      view === "solfa" ? show($("r-solfa")) : hide($("r-solfa"));
      view === "parts" ? show($("r-parts")) : hide($("r-parts"));
      if (view === "parts" && current && current.result && current.result.parts && !$("sheet-parts").childElementCount) {
        engraveInto($("sheet-parts"), current.result.partsMusicXml, true);
      }
    });
  });

  /**
   * The parts, on the sheet. The "Write the four parts" panel is in the tool pop-up when this runs from
   * there: the pop-up closes first, or hiding the panel left an empty card over the parts it had just
   * written, and the "Four parts" action kept opening that empty card.
   */
  function revealParts() {
    closeTool(); closeFull();
    show($("tab-parts")); hide($("harmony"));
    syncActions();
    document.querySelector('.result-tabs [data-view="parts"]').click();
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  /**
   * Four-part harmony, only when asked: the transcription is the one voice we heard, and alto,
   * tenor and bass are an arrangement written under it on request. A saved sheet keeps them.
   */
  /** The harmony card's label and note: "free once" for a free account that still has it. */
  function renderHarmonyOffer() {
    var free = freeHarmonyLeft();
    $("harmony-add").innerHTML = '<svg class="ic"><use href="/assets/icons.svg#i-plus"/></svg>' + (free ? "Write the four parts (1 free)" : "Write the four parts");
    $("harmony-free-note").classList.toggle("hidden", !free);
    // The "Four parts" action shows no lock while the free one is left.
    document.body.classList.toggle("has-free-harmony", free);
  }
  $("harmony-add").addEventListener("click", function () {
    var free = freeHarmonyLeft();
    track("Asked for harmony", free ? "free try" : null);
    if (guest) { openAuth("register"); return; }
    if (!isPro() && !free) { openUpgrade(); return; }
    if (!current || !current.result) return;
    var r = current.result, owner = current;
    if (P.hasParts(r)) { revealParts(); return; }
    var btn = $("harmony-add"), html = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Writing alto, tenor and bass…";
    hide($("harmony-alert"));
    request("/api/transcriptions/harmonise", { method: "POST", body: { key: r.key, tempoBpm: Math.round(r.tempo || 0), timeSignature: r.timeSignature, notes: r.notes || [] } })
      .then(function (written) {
        if (current !== owner || current.result !== r) return; // another sheet opened meanwhile
        // Said in the panel: it is in the pop-up, which covers the page's own alert.
        if (!written || !P.hasParts(written)) { alertIn($("harmony-alert"), "info", "The tune needs a few notes before parts can be written under it."); return; }
        r.parts = written.parts; r.partsMusicXml = written.partsMusicXml || "";
        // The free one is spent now: the next sheet's button goes to the plans.
        if (!isPro() && sub) { sub.freeHarmonyAvailable = false; track("Used free harmony"); }
        showParts(r); setupRehearsal(r); setupSing(r); setupPractice(r);
        revealParts();
        sfx.play("saved");
        if (current.savedId) {
          request("/api/library/" + current.savedId + "/parts", { method: "PUT", body: { parts: r.parts, partsMusicXml: r.partsMusicXml } })
            .catch(function (err) { alertIn($("app-alert"), "danger", "The parts were written but could not be kept with the saved sheet: " + (err.message || err)); });
        }
      })
      .catch(function (err) { alertIn($("harmony-alert"), "danger", "The parts could not be written: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; btn.innerHTML = html; renderHarmonyOffer(); });
  });

  /** Four-part harmony: the four solfa blocks and the SATB score, Pro only. */
  function showParts(result) {
    var parts = result.parts;
    $("sheet-parts").innerHTML = "";
    if (!parts) {
      show($("r-parts-locked")); hide($("r-parts-body")); hide($("dl-parts"));
      return;
    }
    // A free account sees the parts it wrote; the SATB MusicXML download stays Pro (gated below).
    hide($("r-parts-locked")); show($("r-parts-body")); show($("dl-parts"));
    var holder = $("r-parts-solfa");
    holder.innerHTML = "";
    ["soprano", "alto", "tenor", "bass"].forEach(function (name) {
      var part = parts[name];
      if (!part) return;
      var block = document.createElement("div"); block.className = "part";
      var h = document.createElement("h3"); h.textContent = name; block.appendChild(h);
      var pre = document.createElement("div"); pre.className = "solfa";
      var lines = part.solfaLines && part.solfaLines.length > 1 ? part.solfaLines : C.renderLines(C.label(part.notes || [], result.key, C.partReference(parts, result.notes)), "", result.timeSignature);
      lines.slice(1).forEach(function (line) { var d = document.createElement("div"); d.textContent = line; pre.appendChild(d); });
      block.appendChild(pre);
      holder.appendChild(block);
    });
  }

  /** OpenSheetMusicDisplay 2.1.2, the same bundle the app's engraver inlines. One pinned URL with its
   *  SRI hash (the CSP allows no other script CDN); a changed file is refused rather than run. */
  var OSMD_URL = "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.1.2/build/opensheetmusicdisplay.min.js";
  var OSMD_SRI = "sha384-12lItsNRZQLTAONzjzkiAB2oOKC7L9JPNqWBHro/ug0hLJZTmGxbr0V2JRt8KwC2";
  var osmdLoading = null;
  function ensureOsmd() {
    if (window.opensheetmusicdisplay) return Promise.resolve();
    if (osmdLoading) return osmdLoading;
    osmdLoading = new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = OSMD_URL; tag.async = true;
      tag.integrity = OSMD_SRI; tag.crossOrigin = "anonymous";
      tag.onload = resolve; tag.onerror = function () { tag.remove(); reject(new Error("failed " + OSMD_URL)); };
      document.head.appendChild(tag);
    }).catch(function (err) { osmdLoading = null; throw err; });
    return osmdLoading;
  }
  /** The engraver is ~320 KB: never on the sign-in screen (most first visits, on a phone). Once the app itself
   *  is open it loads while the phone is idle, so a sheet opened later is drawn at once. */
  var osmdWarmed = false;
  function warmEngraver() {
    if (osmdWarmed) return;
    osmdWarmed = true;
    var go = function () { ensureOsmd().catch(function () { /* reported where the sheet is drawn */ }); };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 1500);
  }

  /** jsPDF 2.5.1 (~95 KB) only when a PDF is asked for: one pinned URL with its SRI hash (the CSP allows it). */
  var JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  var JSPDF_SRI = "sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk";
  var jspdfLoading = null;
  function ensureJsPdf() {
    if (window.jspdf) return Promise.resolve();
    if (jspdfLoading) return jspdfLoading;
    jspdfLoading = new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = JSPDF_URL; tag.async = true;
      tag.integrity = JSPDF_SRI; tag.crossOrigin = "anonymous";
      tag.onload = resolve; tag.onerror = function () { tag.remove(); reject(new Error("the PDF library did not load; check your connection and try again")); };
      document.head.appendChild(tag);
    }).catch(function (err) { jspdfLoading = null; throw err; });
    return jspdfLoading;
  }

  function engrave(xml) {
    // The engraver takes a moment on a long sheet (and longer the first time, while it
    // loads): show the shape of a staff rather than an empty box.
    var skel = $("sheet-skel"); show(skel); $("sheet").classList.add("hidden");
    try { osmd = engraveInto($("sheet"), xml, false); }
    finally { hide(skel); $("sheet").classList.remove("hidden"); }
  }

  /** Engrave ``xml`` into ``container``; part names only make sense with more than one part. */
  function engraveInto(container, xml, partNames) {
    container.innerHTML = "";
    if (!xml) { container.textContent = "Nothing to engrave."; return null; }
    if (!window.opensheetmusicdisplay) {
      container.textContent = "Loading the engraver…";
      ensureOsmd().then(function () { engraveInto(container, xml, partNames); }, function () { container.textContent = "The staff engraver could not be loaded. The Tonic Solfa tab still works; check your connection and reload for the staff."; });
      return null;
    }
    try {
      var display = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
        backend: "svg", autoResize: true, drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false, drawPartNames: !!partNames, drawMeasureNumbers: true,
        autoBeam: true, autoBeamOptions: { beam_rests: false, maintain_stem_directions: false }
      });
      display.load(xml).then(function () { display.render(); }).catch(function (err) { container.textContent = "Could not draw the staff: " + err; });
      return display;
    } catch (err) { container.textContent = "Could not draw the staff: " + err; return null; }
  }

  // ── Downloads ────────────────────────────────────────────────────────────
  function gated(fn) {
    return function () {
      if (!current || !current.result) return;
      if (guest) { openAuth("register"); return; }
      if (!isPro()) { pitchPro(); return; }
      fn(current.result);
    };
  }
  function baseName() {
    var src = current && (current.result.source || current.source);
    return safeName(src ? (src.title + (src.artist ? "-" + src.artist : "")) : "notefusion-transcription");
  }

  $("dl-xml").addEventListener("click", gated(function (r) {
    download(baseName() + ".musicxml", new Blob([r.musicXml], { type: "application/vnd.recordare.musicxml+xml" }));
  }));
  $("dl-midi").addEventListener("click", gated(function (r) {
    if (!r.midiBase64) { alertIn($("app-alert"), "info", "No MIDI was produced for this transcription."); return; }
    var bytes = Uint8Array.from(atob(r.midiBase64), function (c) { return c.charCodeAt(0); });
    download(baseName() + ".mid", new Blob([bytes], { type: "audio/midi" }));
  }));
  $("dl-solfa").addEventListener("click", function () {
    if (!current || !current.result) return;
    var r = current.result, words = current.lyrics && current.lyrics.trim();
    // With chords, each row carries them over the tune (and the words); without, the plain lines and the words after.
    var text = N.has(r.chords)
      ? ((r.solfaLines || [])[0] || "") + "\n\n" + N.textRows(N.grid(r.notes || [], current.lyrics, r.chords, r.timeSignature), !!words).join("\n")
      : (r.solfaLines || []).join("\n") + (words ? "\n\n" + words : "");
    text += "\n\n" + $("r-credit").textContent + "\n";
    download(baseName() + "-solfa.txt", new Blob([text], { type: "text/plain" }));
  });
  $("dl-parts").addEventListener("click", gated(function (r) {
    if (!r.partsMusicXml) return;
    download(baseName() + "-satb.musicxml", new Blob([r.partsMusicXml], { type: "application/vnd.recordare.musicxml+xml" }));
  }));
  // The PDF is free with a NoteFusion mark; Pro removes it. It was the most-clicked locked button
  // (eleven people, two of them ten times each), so a dead end became the sheet they came for.
  $("dl-pdf").addEventListener("click", function () {
    if (!current || !current.result) return;
    if (guest) { openAuth("register"); return; }
    var btn = $("dl-pdf"); btn.disabled = true;
    track("Downloaded PDF", isPro() ? null : "free, watermarked");
    renderPdf(current.result, !isPro()).catch(function (err) { alertIn($("app-alert"), "danger", "Could not build the PDF: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });

  /**
   * The sheet as A4 pages. OSMD paginates onto canvases in a hidden stage; each becomes a
   * page image under a header (title, artist, key, tempo) and above a credit line, which is
   * how the song is acknowledged on paper.
   */
  /** A free sheet's mark: across each page, faint enough to read through, plus a line at the foot. */
  function watermarkPdf(doc, W, H) {
    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.1 }));
      doc.setFont("helvetica", "bold"); doc.setFontSize(46); doc.setTextColor(37, 99, 235);
      doc.text("NoteFusion", W / 2, H / 2, { align: "center", angle: 35 });
      if (doc.GState) doc.setGState(new doc.GState({ opacity: 1 }));
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(37, 99, 235);
      doc.text("Made with NoteFusion free · notefusion.studio · Pro removes this mark", W / 2, H - 4, { align: "center" });
    }
  }
  function renderPdf(result, watermark) {
    if (!window.opensheetmusicdisplay) return ensureOsmd().then(function () { return renderPdf(result, watermark); });
    if (!window.jspdf) return ensureJsPdf().then(function () { return renderPdf(result, watermark); });
    var stage = $("pdf-stage");
    stage.innerHTML = "";
    var src = result.source || current.source;
    var title = src ? (src.title || "Untitled") : "NoteFusion transcription";
    var subtitle = (src && src.artist ? src.artist + " · " : "") + result.key + " · " + result.tempo + " BPM · " + result.timeSignature;
    var engraver = new opensheetmusicdisplay.OpenSheetMusicDisplay(stage, {
      backend: "canvas", autoResize: false, pageFormat: "A4_P", drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false, drawPartNames: false,
      drawMeasureNumbers: true, autoBeam: true, pageBackgroundColor: "#FFFFFF"
    });
    return engraver.load(result.musicXml).then(function () {
      engraver.setPageFormat("A4_P");
      engraver.render();
      var canvases = Array.prototype.slice.call(stage.querySelectorAll("canvas"));
      if (!canvases.length) throw new Error("nothing was engraved");
      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      var W = 210, H = 297, margin = 12, header = 22, footer = 12;
      canvases.forEach(function (canvas, i) {
        if (i > 0) doc.addPage();
        doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
        doc.text(title, margin, margin + 6);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(93, 109, 130);
        doc.text(subtitle, margin, margin + 12);
        var avail = H - margin - header - footer - margin;
        var scale = Math.min((W - 2 * margin) / canvas.width, avail / canvas.height);
        var w = canvas.width * scale, h = canvas.height * scale;
        doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin + header, w, h);
        doc.setFontSize(8); doc.setTextColor(148, 163, 184);
        doc.text($("r-credit").textContent + "  ·  notefusion.studio", margin, H - margin + 2, { maxWidth: W - 2 * margin });
        doc.text(String(i + 1) + " / " + canvases.length, W - margin, H - margin + 2, { align: "right" });
      });
      // The solfa on its own page: the hymn-book layout when there are words.
      doc.addPage();
      doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
      doc.text(title, margin, margin + 6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(93, 109, 130);
      doc.text("Tonic Solfa · " + subtitle, margin, margin + 12);
      doc.setFont("courier", "normal"); doc.setFontSize(10); doc.setTextColor(15, 23, 42);
      var y = margin + 24;
      var lines = result.solfaLines && result.solfaLines.length > 1 ? result.solfaLines : C.renderLines(result.notes || [], C.keyHeader(result.key), result.timeSignature);
      var words = current.lyrics && current.lyrics.trim();
      doc.text(lines[0] || "", margin, y); y += 7;
      if (N.has(result.chords)) {
        // Chords, their solfa, the tune (and the words), row by row.
        N.textRows(N.grid(result.notes || [], current.lyrics, result.chords, result.timeSignature), !!words).forEach(function (line) {
          if (y > H - margin - 10) { doc.addPage(); y = margin + 8; }
          doc.text(line, margin, y); y += 4.5;
        });
      } else if (words) {
        C.hymnRows(result.notes || [], current.lyrics, result.timeSignature).forEach(function (bars) {
          var top = "", bottom = "";
          bars.forEach(function (bar) {
            top += "| "; bottom += "  ";
            bar.forEach(function (cell) {
              var w = Math.max(cell.solfa.length, cell.lyric.length, 2) + 1;
              top += cell.solfa + new Array(w - cell.solfa.length + 1).join(" ");
              bottom += cell.lyric + new Array(w - cell.lyric.length + 1).join(" ");
            });
          });
          top += "|";
          if (y > H - margin - 14) { doc.addPage(); y = margin + 8; }
          doc.text(top, margin, y); doc.setTextColor(93, 109, 130); doc.text(bottom, margin, y + 4); doc.setTextColor(15, 23, 42);
          y += 11;
        });
      } else {
        lines.slice(1).forEach(function (line) {
          if (y > H - margin - 10) { doc.addPage(); y = margin + 8; }
          doc.text(line, margin, y); y += 6;
        });
      }
      if (watermark) watermarkPdf(doc, W, H);
      doc.save(baseName() + ".pdf");
      stage.innerHTML = "";
    });
  }

  // ── Upgrade ──────────────────────────────────────────────────────────────
  var plansCache = null;
  var choirPlansCache = null;
  var singlePlansCache = null;
  /** A choir plan (a director's, seating singers): listed apart, at /api/billing/plans/choir. */
  function isChoirPlan(plan) { return !!(plan && plan.choirSeats); }
  /** The account directs a choir, running or lapsed: buying a choir plan adds time to it. */
  function leadsChoir() { return !!((sub && sub.choirRole === "director") || (choir && choir.role === "director")); }
  function isYearly(plan) { return plan.interval === "yearly" || plan.interval === 1; }
  function isLifetimePlan(plan) { return plan.interval === "lifetime" || plan.interval === 2; }
  /**
   * The one-song purchase: one more transcription, no membership (BillingInterval.Single). Listed apart, at
   * /api/billing/plans/single: an older copy of this page labels every plan in the main list "Monthly".
   */
  function isSinglePlan(plan) { return plan.interval === "single"; }
  /**
   * The plan picker: one tile per plan, the yearly one chosen to start with, and a single button that
   * says what will be charged. One payment covers one period, so the copy never promises a renewal.
   * opts.single lists the one-song purchase first, beside Pro (the plans dialog for a free account; never
   * the result page, whose offer is what Pro unlocks on that sheet); opts.singleFirst chooses it to start with.
   */
  function loadPlans(panel, grid, opts) {
    opts = opts || {};
    show(panel);
    if (!plansCache) { grid.innerHTML = ""; for (var i = 0; i < 2; i++) { var sk = document.createElement("div"); sk.className = "skel skel-plan"; grid.appendChild(sk); } }
    var p = plansCache ? Promise.resolve(plansCache) : request("/api/billing/plans").then(function (list) { plansCache = list; return list; });
    // The choir plans are listed apart by the API; a failure there leaves the Pro plans on sale.
    var pc = !opts.choir ? Promise.resolve([])
      : choirPlansCache ? Promise.resolve(choirPlansCache)
      : request("/api/billing/plans/choir").then(function (list) { choirPlansCache = list || []; return choirPlansCache; }, function () { return []; });
    // The one-song purchase, for a free account only; a failure there leaves Pro on sale.
    var ps = !(opts.single && !isPro()) ? Promise.resolve([])
      : singlePlansCache ? Promise.resolve(singlePlansCache)
      : request("/api/billing/plans/single").then(function (list) { singlePlansCache = list || []; return singlePlansCache; }, function () { return []; });
    Promise.all([p, pc, ps]).then(function (all) {
      var plans = all[0], choirPlans = (all[1] || []).slice().sort(function (a, b) { return a.amountMinor - b.amountMinor; });
      grid.innerHTML = "";
      grid.classList.add("plan-picker");
      // An API from before the split still lists it in the main list; either way it is shown as one song.
      var single = opts.single && !isPro() ? ((all[2] || []).find(isSinglePlan) || plans.find(isSinglePlan) || null) : null;
      plans = plans.filter(function (x) { return !isSinglePlan(x); });
      if (!plans.length && !single && !choirPlans.length) { grid.textContent = "No plan is available for your region yet."; return; }
      var monthly = plans.find(function (x) { return !isYearly(x) && !isLifetimePlan(x); });
      // Naira opens on the monthly plan: ₦60,000 as the first price anyone sees reads as a wall, while
      // ₦7,500 a month is a decision. Elsewhere the yearly saving leads, as before.
      var monthlyFirst = !!monthly && String(monthly.currency).toUpperCase() === "NGN";
      var ordered = plans.slice().sort(function (a, b) {
        var ya = isYearly(a) ? 1 : 0, yb = isYearly(b) ? 1 : 0;
        return monthlyFirst ? ya - yb : yb - ya;
      });
      // Just this song goes first: the smallest, simplest thing to buy, next to Pro.
      if (single) ordered.unshift(single);
      var chosen = single && (opts.singleFirst || !plans.length) ? single : ordered[single ? 1 : 0];
      // The choir plans come last, as the third option: one director pays and the whole choir is Pro.
      var choirMonthly = choirPlans.find(function (x) { return !isYearly(x); });
      ordered = ordered.concat(choirPlans);
      // A director renewing their choir starts on the choir plan; anyone else on what they would buy for themselves.
      if (!chosen || (choirPlans.length && leadsChoir())) chosen = choirPlans[0] || chosen;
      var options = document.createElement("div"); options.className = "plan-options"; options.setAttribute("role", "radiogroup"); options.setAttribute("aria-label", "Choose a plan");
      var cta = document.createElement("button"); cta.type = "button"; cta.className = "btn btn-primary btn-pay";
      function label(plan) { return isChoirPlan(plan) ? (isYearly(plan) ? "Choir · Yearly" : "Choir · Monthly") : isSinglePlan(plan) ? "Just this song" : isLifetimePlan(plan) ? "Lifetime" : isYearly(plan) ? "Yearly" : "Monthly"; }
      function per(plan) { return isSinglePlan(plan) || isLifetimePlan(plan) ? "once" : isYearly(plan) ? "a year" : "a month"; }
      var fine = document.createElement("p"); fine.className = "pay-fine";
      function renderCta() {
        cta.innerHTML = '<svg class="ic"><use href="/assets/icons.svg#i-lock"/></svg>';
        cta.appendChild(document.createTextNode(isSinglePlan(chosen)
          ? "Buy this song — " + money(chosen)
          : isChoirPlan(chosen)
            ? (leadsChoir() ? "Add choir time — " : "Start your choir — ") + money(chosen) + " " + per(chosen)
            : "Continue — " + money(chosen) + " " + per(chosen)));
        fine.innerHTML = '<svg class="ic"><use href="/assets/icons.svg#i-lock"/></svg>';
        fine.appendChild(document.createTextNode(isSinglePlan(chosen)
          ? "Secure checkout. One payment, one transcription that never expires. No subscription."
          : isChoirPlan(chosen)
            ? "Secure checkout. One payment covers the whole choir for the period; nothing renews without you. You'll get an invite link for your singers."
            : "Secure checkout. One payment covers the whole period; nothing renews without you."));
      }
      ordered.forEach(function (plan, index) {
        if (isChoirPlan(plan) && (index === 0 || !isChoirPlan(ordered[index - 1]))) {
          var head = document.createElement("p"); head.className = "plan-group muted small"; head.setAttribute("role", "presentation");
          head.textContent = "For choir directors — Pro for you and up to " + (plan.choirSeats || 25) + " singers, one shared library";
          options.appendChild(head);
        }
        var opt = document.createElement("button"); opt.type = "button"; opt.className = "plan-opt"; opt.setAttribute("role", "radio");
        var top = document.createElement("span"); top.className = "plan-opt-top";
        var name = document.createElement("span"); name.className = "plan-opt-name"; name.textContent = label(plan);
        top.appendChild(name);
        var base = isChoirPlan(plan) ? choirMonthly : monthly;
        var saving = isYearly(plan) && base ? Math.round(100 - (plan.amountMinor / (base.amountMinor * 12)) * 100) : 0;
        if (saving > 0) { var tag = document.createElement("span"); tag.className = "plan-opt-tag"; tag.textContent = "Save " + saving + "%"; top.appendChild(tag); }
        var price = document.createElement("span"); price.className = "plan-opt-price"; price.textContent = money(plan);
        var small = document.createElement("small"); small.textContent = isSinglePlan(plan) ? " once" : " / " + (isLifetimePlan(plan) ? "once" : isYearly(plan) ? "year" : "month"); price.appendChild(small);
        if (isSinglePlan(plan)) { var noSub = document.createElement("span"); noSub.className = "plan-opt-tag"; noSub.textContent = "No subscription"; top.appendChild(noSub); }
        var note = document.createElement("span"); note.className = "plan-opt-note";
        note.textContent = isSinglePlan(plan)
          ? "One more transcription, any recording or song link. No subscription."
          : isChoirPlan(plan)
            ? "Pro for you and up to " + (plan.choirSeats || 25) + " singers, 60 songs a month shared, one library" + (isYearly(plan) ? ", paid once a year" : "")
          : isYearly(plan)
            ? money({ amountMinor: Math.round(plan.amountMinor / 12), currency: plan.currency }) + " a month, paid once a year"
            : isLifetimePlan(plan) ? "Pay once, Pro for good" : "Pay month by month";
        var dot = document.createElement("span"); dot.className = "plan-opt-dot"; dot.setAttribute("aria-hidden", "true");
        opt.appendChild(dot); opt.appendChild(top); opt.appendChild(price); opt.appendChild(note);
        function select() {
          chosen = plan;
          options.querySelectorAll(".plan-opt").forEach(function (o) { var on = o === opt; o.classList.toggle("on", on); o.setAttribute("aria-checked", String(on)); });
          renderCta();
        }
        opt.addEventListener("click", select);
        options.appendChild(opt);
        if (plan === chosen) { opt.classList.add("on"); opt.setAttribute("aria-checked", "true"); } else opt.setAttribute("aria-checked", "false");
      });
      renderCta();
      cta.addEventListener("click", function () { checkout(chosen, cta); });
      grid.appendChild(options); grid.appendChild(cta); grid.appendChild(fine);
    }).catch(function () { grid.textContent = "Plans could not be loaded right now. Please try again in a moment."; });
  }

  function money(plan) {
    var amount = plan.amountMinor / 100;
    // narrowSymbol: "₦7,500", not "NGN 7,500", whatever the browser's own locale is.
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount); }
    catch (e) { return plan.currency + " " + amount.toFixed(2); }
  }

  /**
   * The checkout opens in this tab; client "web" has the provider's return page bring the browser back
   * to /app?paid=1 rather than to the app's deep link. What the membership was before leaving is kept,
   * so the return can tell a payment that landed from Pro that was already there.
   */
  /** Only the providers' hosted checkouts are followed: https on Paystack or Bachs, nothing else. */
  function trustedCheckout(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" && /(^|\.)(paystack\.com|paystack\.co|bachs\.io)$/i.test(u.hostname);
    } catch (e) { return false; }
  }
  function checkout(plan, btn) {
    btn.disabled = true;
    track("Checkout started", plan.id);
    request("/api/billing/checkout", { method: "POST", body: { planId: plan.id, client: "web" } })
      .then(function (session) {
        if (!session || !trustedCheckout(session.checkoutUrl)) throw new ApiError(502, { code: "BILLING_CHECKOUT_URL" });
        var provider = "";
        try { provider = new URL(session.checkoutUrl).hostname; } catch (e) { /* ignore */ }
        saveCheckout({
          planId: plan.id, startedAt: Date.now(), wasActive: isPro(), periodEnd: (sub && sub.currentPeriodEndUtc) || null,
          lifetime: !!(sub && sub.isLifetime), planCode: (sub && sub.planCode) || null, userId: (me && me.id) || null,
          // A one-song purchase lands as one more bought transcription, not as Pro; and the song link that
          // was refused is put back in the box on the way back, so the person carries on where they were.
          single: isSinglePlan(plan), bought: (sub && sub.boughtTranscriptionsTotal) || 0,
          link: isSinglePlan(plan) ? ($("link-url").value || "").trim() : "",
          // A choir plan lands as the choir's own period moving on, whatever the account's own Pro does.
          choir: isChoirPlan(plan), choirPeriodEnd: (sub && sub.choirPeriodEndUtc) || null
        });
        return trackNow("Checkout opened", provider).then(function () { location.assign(session.checkoutUrl); });
      })
      .catch(function (err) {
        // An earlier checkout turned out to be paid: nothing to buy, so this is the welcome, not an error.
        if (err instanceof ApiError && err.code === "BILLING_PAYMENT_ALREADY_RECEIVED") {
          var before = { wasActive: isPro(), periodEnd: (sub && sub.currentPeriodEndUtc) || null, single: isSinglePlan(plan), choir: isChoirPlan(plan) };
          return request("/api/billing/my-subscription").then(function (s) { paymentDone(s, before); })
            .catch(function () { alertIn($("app-alert"), "success", err.message); });
        }
        track("Checkout failed", (err instanceof ApiError ? err.code + " (HTTP " + err.status + ")" : (err && err.message) || "Network error") + " · app");
        alertIn($("app-alert"), "danger", (err instanceof ApiError && err.message) || "We couldn't open the payment page just now. Please try again in a minute.");
      })
      .finally(function () { btn.disabled = false; });
  }

  // ── Back from checkout: Pro unlocks the moment the payment lands ────────
  // The provider's webhook and the browser's return race each other, so the page asks the API to
  // confirm every few seconds for a minute, then quietly every 15 s for ten; failures are silent retries.
  var CHECKOUT_KEY = "nf.checkout";
  var CHECKOUT_TTL = 2 * 60 * 60 * 1000;
  var PAY_FAST_MS = 2500, PAY_FAST_FOR = 60 * 1000, PAY_SLOW_MS = 15000, PAY_SLOW_FOR = 10 * 60 * 1000;
  var payWatch = null;    // { snap, started, timer, busy, slow, quiet } while a payment is being confirmed
  var welcomeReturn = null;
  function readCheckout() {
    try {
      var snap = JSON.parse(localStorage.getItem(CHECKOUT_KEY) || "null");
      // Another account's checkout (a session that ended without Sign out leaves it behind) is not this one's.
      if (snap && snap.userId && me && me.id && snap.userId !== me.id) return null;
      return snap && Date.now() - snap.startedAt < CHECKOUT_TTL ? snap : null;
    } catch (e) { return null; }
  }
  function saveCheckout(snap) { try { localStorage.setItem(CHECKOUT_KEY, JSON.stringify(snap)); } catch (e) { /* private mode */ } }
  function clearCheckout() { try { localStorage.removeItem(CHECKOUT_KEY); } catch (e) { /* ignore */ } }
  function dropParam(name) {
    try {
      var url = new URL(location.href);
      if (!url.searchParams.has(name)) return;
      url.searchParams.delete(name);
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    } catch (e) { /* the address keeps it; nothing depends on that */ }
  }
  /** Active, and for someone who was already on Pro, something bought since the snapshot: more time, life, or a new plan. */
  function paymentLanded(s, snap) {
    // One song bought: the account's bought count moves on; Pro does not change.
    if (s && snap && snap.single) return (s.boughtTranscriptionsTotal || 0) > (snap.bought || 0);
    // A choir plan: the choir's period end moves on (a director may hold Pro of their own beside it).
    if (s && snap && snap.choir) {
      var choirEnd = s.choirPeriodEndUtc ? Date.parse(s.choirPeriodEndUtc) : 0, choirBefore = snap.choirPeriodEnd ? Date.parse(snap.choirPeriodEnd) : 0;
      return choirEnd > choirBefore;
    }
    if (!s || !s.isActive) return false;
    if (!snap || !snap.wasActive) return true;
    var end = s.currentPeriodEndUtc ? Date.parse(s.currentPeriodEndUtc) : 0, before = snap.periodEnd ? Date.parse(snap.periodEnd) : 0;
    return end > before || (s.isLifetime && !snap.lifetime) || (s.planCode || null) !== (snap.planCode || null);
  }
  function showPayToast(slow) {
    var toast = $("pay-toast");
    toast.classList.toggle("is-slow", slow);
    $("pay-toast-title").textContent = slow ? "Your payment is still being confirmed." : "Confirming your payment…";
    var single = !!(payWatch && payWatch.snap && payWatch.snap.single);
    $("pay-toast-sub").textContent = slow
      ? (single ? "Your song unlocks automatically the moment it lands — you can keep working." : "Pro unlocks automatically the moment it lands — you can keep working.")
      : "This usually takes a few seconds.";
    show(toast);
  }
  /** quiet: no "Confirming…" note, because nothing says a payment was made (Back from the provider, a later visit). */
  function watchPayment(quiet) {
    dropParam("paid");
    if (payWatch) {
      if (!quiet && payWatch.quiet) { payWatch.quiet = false; showPayToast(payWatch.slow); }
      checkPayment(); return;
    }
    payWatch = { snap: readCheckout(), started: Date.now(), timer: null, busy: false, slow: false, quiet: !!quiet };
    if (!quiet) showPayToast(false);
    checkPayment();
  }
  function stopPaymentWatch() {
    if (payWatch) clearTimeout(payWatch.timer);
    payWatch = null;
    hide($("pay-toast"));
  }
  function checkPayment() {
    var w = payWatch;
    if (!w || w.busy) return;
    w.busy = true; clearTimeout(w.timer);
    request("/api/billing/confirm", { method: "POST" })
      .catch(function (err) { if (err.status === 401) stopPaymentWatch(); return null; })
      .then(function (s) {
        w.busy = false;
        if (payWatch !== w) return;
        if (paymentLanded(s, w.snap)) { paymentDone(s, w.snap); return; }
        var age = Date.now() - w.started;
        if (age >= PAY_FAST_FOR && !w.slow) { w.slow = true; if (!w.quiet) showPayToast(true); }
        if (age < PAY_SLOW_FOR) w.timer = setTimeout(checkPayment, w.slow ? PAY_SLOW_MS : PAY_FAST_MS);
        else if (!w.reported) {
          // Watched for the full ten minutes and nothing landed: the dashboard's "never confirmed" step.
          w.reported = true;
          track("Payment not confirmed", w.quiet ? "came back without paying (abandoned?)" : "provider sent the browser back, no payment after 10 min");
        }
      });
  }
  /** The payment landed: the account shows Pro everywhere it shows the plan, then the welcome. */
  function paymentDone(s, snap) {
    if (snap && snap.single) { songBought(s, snap); return; }
    if (snap && snap.choir) { choirBought(s, snap); return; }
    stopPaymentWatch(); clearCheckout();
    sub = s;
    track(snap && snap.wasActive ? "Added Pro time" : "Went Pro");
    track("Payment confirmed", snap && snap.planId ? String(snap.planId) : null);
    renderWho();
    if (!$("view-account").classList.contains("hidden")) renderAccount();
    hide($("upgrade-panel")); hide($("r-upgrade")); hide($("r-watermark"));
    if (current && current.result) showResult(current.result);
    openProWelcome(snap);
  }
  /**
   * One song paid for: the counts move on everywhere they show, the link that was refused goes back in the
   * box, and the same pop-up says so in a sentence — nothing about Pro, which was not bought.
   */
  function songBought(s, snap) {
    stopPaymentWatch(); clearCheckout();
    sub = s;
    track("Bought one song");
    track("Payment confirmed", snap && snap.planId ? String(snap.planId) : null);
    renderWho();
    if (!$("view-account").classList.contains("hidden")) renderAccount();
    hide($("upgrade-panel")); hide($("app-alert"));
    var relink = !!(snap && snap.link && !$("link-url").value.trim());
    if (relink) {
      setView("transcribe"); selectSource("link");
      $("link-url").value = snap.link; lookupLink(true);
    }
    $("pro-welcome-title").textContent = "Your song is paid for";
    $("pro-welcome-plan").textContent = relink
      ? "Your link is back in the box. Press Transcribe to write out the whole song."
      : "One more transcription is ready: record, upload, or paste a song link.";
    hide($("pro-welcome-perks"));
    $("pro-welcome-go").textContent = "Transcribe it";
    welcomeReturn = document.activeElement;
    show($("pro-welcome"));
    $("pro-welcome-go").focus();
    sfx.play("saved");
  }
  /** A choir plan paid for: on to My choir, where the invite link for the singers is. */
  function choirBought(s, snap) {
    stopPaymentWatch(); clearCheckout();
    sub = s; choir = null;
    track(snap && snap.choirPeriodEnd ? "Added choir time" : "Started a choir");
    track("Payment confirmed", snap && snap.planId ? String(snap.planId) : null);
    renderWho();
    hide($("upgrade-panel"));
    setView("account");
    if (current && current.result) showResult(current.result);
    show($("pro-welcome-perks")); $("pro-welcome-go").textContent = "Invite your singers";
    $("pro-welcome-title").textContent = snap && snap.choirPeriodEnd ? "More choir time added" : "Your choir is ready";
    var when = s.choirPeriodEndUtc ? new Date(s.choirPeriodEndUtc).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    $("pro-welcome-plan").textContent = "Copy the invite link under My choir and send it to your singers." + (when ? " Pro for the whole choir until " + when + "." : "");
    welcomeReturn = $("choir-invite-copy");
    show($("pro-welcome"));
    $("pro-welcome-go").focus();
    sfx.play("saved");
  }
  function openProWelcome(snap) {
    show($("pro-welcome-perks")); $("pro-welcome-go").textContent = "Start using Pro";
    $("pro-welcome-title").textContent = snap && snap.wasActive ? "More Pro time added" : "Welcome to NoteFusion Pro";
    var when = sub.currentPeriodEndUtc ? new Date(sub.currentPeriodEndUtc).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    $("pro-welcome-plan").textContent = planLabel() + (sub.isLifetime ? " · Pro for life" : when ? " · Pro until " + when : "");
    welcomeReturn = document.activeElement;
    show($("pro-welcome"));
    $("pro-welcome-go").focus();
    sfx.play("saved");
  }
  function closeProWelcome() {
    hide($("pro-welcome"));
    if (welcomeReturn && welcomeReturn.focus && welcomeReturn !== document.body) welcomeReturn.focus();
    welcomeReturn = null;
  }
  $("pro-welcome-go").addEventListener("click", closeProWelcome);
  $("pro-welcome").addEventListener("click", function (e) { if (e.target === $("pro-welcome")) closeProWelcome(); });
  document.addEventListener("keydown", function (e) {
    if ($("pro-welcome").classList.contains("hidden")) return;
    if (e.key === "Escape") closeProWelcome();
    else if (e.key === "Tab") { e.preventDefault(); $("pro-welcome-go").focus(); } // its one control keeps the focus
  });
  $("pay-toast-close").addEventListener("click", function () { hide($("pay-toast")); });
  // Coming back to the tab is the likeliest moment for the payment to have landed.
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && payWatch) checkPayment(); });
  // Back from the provider's page out of the browser's cache: boot does not run again, so look here.
  window.addEventListener("pageshow", function (e) { if (e.persisted && me && readCheckout()) watchPayment(true); });

  boot();
  // The first paint was the page's own HTML (assets/app-boot.js); the screen boot() just set is the same one, so
  // app.css can stop drawing it from the boot classes. A form sent before this file arrived goes now.
  document.documentElement.classList.remove("nf-boot");
  var sentEarly = window.NfBoot && window.NfBoot.takeSubmit();
  if (sentEarly && sentEarly.requestSubmit) sentEarly.requestSubmit();
})();
