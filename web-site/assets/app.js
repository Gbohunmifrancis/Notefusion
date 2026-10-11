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
  function refresh() {
    if (refreshing) return refreshing;
    var t = tokens();
    if (!t || !t.refreshToken) return Promise.reject(new ApiError(401, null));
    refreshing = fetch(API + "/api/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: t.refreshToken })
    }).then(function (r) {
      if (!r.ok) throw new ApiError(r.status, null);
      return r.json();
    }).then(function (pair) {
      saveTokens({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
      return pair;
    }).finally(function () { refreshing = null; });
    return refreshing;
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
        return refresh().then(send, function () { clearTokens(); showAuth(); throw new ApiError(401, null); });
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
        return refresh().then(send, function () { clearTokens(); showAuth(); throw new ApiError(401, null); });
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
  function label(btn, icon, text) { btn.innerHTML = '<svg class="ic"><use href="#i-' + icon + '"/></svg>' + text; }
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
    }
  };
  function renderSoundsMenu() {
    var on = sfx.enabled(), b = $("menu-sounds");
    b.setAttribute("aria-checked", String(on)); b.querySelector("span").textContent = on ? "Sounds on" : "Sounds off";
  }
  $("menu-sounds").addEventListener("click", function () { sfx.set(!sfx.enabled()); if (sfx.enabled()) sfx.play("saved"); });

  // ── Theme: light or dark, remembered on this browser (the page head applies it before paint) ──
  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
  function renderThemeMenu() {
    var b = $("menu-theme"), dark = isDark();
    b.setAttribute("aria-checked", String(dark)); b.querySelector("span").textContent = dark ? "Dark mode on" : "Dark mode";
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", dark ? "#08090C" : "#FFFFFF");
  }
  $("menu-theme").addEventListener("click", function () {
    var next = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("nf.web.theme", next); } catch (e) { /* private mode */ }
    renderThemeMenu();
    track(next === "dark" ? "Dark mode on" : "Dark mode off");
  });
  renderThemeMenu();
  renderSoundsMenu();

  // ── State ────────────────────────────────────────────────────────────────
  var me = null;          // { fullName, email }
  var sub = null;         // SubscriptionDto
  var current = null;     // { jobId, kind, source, result, savedId, shareToken, semitones }
  var pollTimer = null;
  var osmd = null;
  var C = window.NfChoir;
  var N = window.NfChords;
  var guest = false;      // a visitor with a preview and no account
  var previewId = new URLSearchParams(location.search).get("preview");
  var player = null;      // the rehearsal player, made once the first result shows
  var hymnCells = [];     // solfa cells of the hymn layout, for the playback cursor

  // ── Auth view ────────────────────────────────────────────────────────────
  /** Signing in is a screen of its own: the card and nothing else around it. */
  function showAuth() {
    hide($("boot-skel")); hide($("view-app")); hide($("who")); show($("view-auth")); hide($("auth-back"));
    document.body.classList.add("guest", "auth-only"); hide($("topbar-signin")); closeDrawer(); hide($("onb"));
    if (new URLSearchParams(location.search).get("signup")) selectAuthTab("register");
    window.scrollTo(0, 0);
  }
  function leaveAuth() { document.body.classList.remove("auth-only"); hide($("view-auth")); }
  var AUTH_COPY = { login: ["Welcome back!", "Sign in to continue"], register: ["Create your account", "Start your musical journey"], verify: ["Check your email", "One code and you're in"] };
  function showAuthForm(name) {
    ["login", "register", "verify"].forEach(function (f) { name === f ? show($("form-" + f)) : hide($("form-" + f)); });
    $("auth-title").textContent = AUTH_COPY[name][0]; $("auth-sub").textContent = AUTH_COPY[name][1];
    hide($("auth-alert"));
  }
  function selectAuthTab(name) { showAuthForm(name); }

  // ── Onboarding: three cards on the first visit, and from "How it works" ──
  var ONB_KEY = "nf.web.onboarded";
  var ONB = [
    { title: "Paste a link, hum, or upload",
      body: "A YouTube, Spotify or Apple Music link, a tune you hum into the mic, or a recording from your device. The first 30 seconds are free, no account.",
      art: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>' },
    { title: "Solfa, staff, and the four parts",
      body: "The lead vocal is isolated and written out as movable-do solfa and staff notation. Pro adds alto, tenor and bass under the tune, the way a hymn arranger would.",
      art: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' },
    { title: "Rehearse, transpose, share",
      body: "Play it back, loop a few bars, mute your part and sing against the others. Move the key to fit your singers, then share a link the choir can open.",
      art: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' }
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
    if (toTry && !me && tryUrl && !$("view-auth").classList.contains("hidden")) { tryUrl.focus(); tryUrl.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  /** First visit, signed out, no preview in the URL: show the cards once. */
  function maybeOnboard() { if (!onbSeen() && !previewId) openOnb(); }
  $("onb-next").addEventListener("click", function () { if (onbIndex < ONB.length - 1) { onbIndex++; renderOnb(); } else closeOnb(true); });
  $("onb-back").addEventListener("click", function () { if (onbIndex > 0) { onbIndex--; renderOnb(); } });
  $("onb-skip").addEventListener("click", function () { closeOnb(false); });
  $("onb").addEventListener("click", function (e) { if (e.target === $("onb")) closeOnb(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("onb").classList.contains("hidden")) closeOnb(false); });
  $("how-link").addEventListener("click", function (e) { e.preventDefault(); openOnb(); });

  document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { showAuthForm(b.dataset.tab); }); });
  document.querySelectorAll("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var input = $(b.dataset.eye), showing = input.type === "text";
      input.type = showing ? "password" : "text";
      b.innerHTML = '<svg class="ic"><use href="#i-' + (showing ? "eye" : "eye-off") + '"/></svg>';
      b.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });
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
      [["google-btn-login", "signin_with"], ["google-btn-register", "signup_with"]].forEach(function (pair) {
        var slot = $(pair[0]); slot.innerHTML = "";
        google.accounts.id.renderButton(slot, { theme: "outline", size: "large", shape: "pill", text: pair[1], width: 360, logo_alignment: "center" });
        slot.closest("form").classList.add("has-google");
      });
    } catch (e) { /* the forms work without it */ }
  }
  window.nfGoogleReady = initGoogle;
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
    if ($("reg-password").value !== $("reg-confirm").value) { alertIn($("auth-alert"), "danger", "The two passwords don't match."); btn.disabled = false; return; }
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

  $("signout").addEventListener("click", function () {
    var t = tokens();
    if (t && t.refreshToken) request("/api/auth/logout", { method: "POST", body: { refreshToken: t.refreshToken } }).catch(function () { /* best effort */ });
    clearTokens(); me = null; sub = null; libraryCache = null; stopPolling(); stopPaymentWatch(); clearCheckout(); hide($("top-nav")); document.body.classList.remove("is-pro"); showAuth();
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

  // The account chip opens a small menu.
  function closeUserMenu() { hide($("user-menu")); $("who").setAttribute("aria-expanded", "false"); }
  $("who").addEventListener("click", function (e) {
    e.stopPropagation();
    var open = $("user-menu").classList.contains("hidden");
    open ? show($("user-menu")) : hide($("user-menu"));
    $("who").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", function (e) { if (!$("user-menu").contains(e.target)) closeUserMenu(); });
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
      var b = document.createElement("button"); b.type = "button"; b.className = "recent-item"; b.textContent = it.title || "Untitled"; b.title = it.title || "Untitled";
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
      chip.setAttribute("role", "tab"); chip.setAttribute("aria-selected", String(f.name === libFolder));
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
        m.textContent = [it.key, it.tempoBpm ? it.tempoBpm + " BPM" : "", it.timeSignature, new Date(it.createdAtUtc).toLocaleDateString()].filter(Boolean).join(" · ") + (it.shareToken ? " · shared" : "");
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
          if (!confirm("Delete \u201c" + (it.title || "Untitled") + "\u201d from your library? This cannot be undone.")) return;
          del.disabled = true;
          request("/api/library/" + it.id, { method: "DELETE" }).then(function () { libraryCache = null; loadLibrary(true); })
            .catch(function (err) { alertIn($("app-alert"), "danger", "Could not delete: " + (err.message || err)); del.disabled = false; });
        });
        a.appendChild(open); a.appendChild(file); a.appendChild(del); card.appendChild(a);
        list.appendChild(card);
      });
      filterLibrary();
    }).catch(function (err) { hide(skel); show(empty); $("lib-empty-text").textContent = "Your library could not be loaded: " + (err.message || err); });
  }
  $("lib-empty-go").addEventListener("click", function () { setView("transcribe"); $("link-url").focus(); });
  $("lib-search").addEventListener("input", filterLibrary);
  /** A saved sheet, opened into the same result view a fresh transcription uses. */
  function openSaved(id) {
    stopPolling();
    request("/api/library/" + id).then(function (t) {
      var result = {
        key: t.key, tempo: t.tempoBpm, timeSignature: t.timeSignature, notes: t.notes || [], musicXml: t.musicXml || "",
        overallConfidence: t.overallConfidence || 0, parts: t.parts || null, partsMusicXml: t.partsMusicXml || "",
        chords: t.chords || null, chordsSource: t.chords && t.chords.length ? "heard" : null,
        solfaLines: C.renderLines(t.notes || [], C.keyHeader(t.key), t.timeSignature), source: null
      };
      current = { jobId: null, kind: "library", source: null, result: result, startedAt: Date.now(), savedId: t.id, title: t.title, shareToken: t.shareToken || null, lyrics: t.lyrics || "", semitones: 0 };
      setView("transcribe");
      hide($("progress"));
      $("sheet-parts").innerHTML = "";
      showResult(result);
      $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (err) { alertIn($("app-alert"), "danger", "Could not open that sheet: " + (err.message || err)); });
  }

  function renderAccount() {
    $("acct-name").textContent = me ? (me.fullName || "—") : "—";
    setAvatar($("acct-avatar"), me);
    (me && me.profilePictureUrl) ? show($("acct-photo-remove")) : hide($("acct-photo-remove"));
    $("acct-email").textContent = me ? (me.email || "—") : "—";
    $("acct-plan").textContent = isPro() ? planLabel() : "Free";
    var badge = $("acct-badge"); badge.textContent = isPro() ? "Pro" : "Free"; badge.className = "pill " + (isPro() ? "pill-pro" : "pill-free");
    isPro() ? hide($("acct-upsell")) : show($("acct-upsell"));
    $("acct-sub-note").textContent = isPro()
      ? "Thank you for supporting NoteFusion. " + periodLine() + " Receipts come by email."
      : "You don't have an active subscription. The free plan has unlimited hummed tunes and one 30-second song preview.";
    $("acct-credits").textContent = sub ? (isPro() ? sub.songCreditsRemaining + " of " + sub.songCreditsTotal + " songs left" : (sub.songCreditsRemaining > 0 ? "1 free song preview" : "Preview used")) : "—";
    var since = me && (me.createdAtUtc || me.createdAt);
    $("acct-since").textContent = since ? new Date(since).toLocaleDateString(undefined, { year: "numeric", month: "long" }) : "—";
    fetchLibrary().then(function (items) { $("acct-saved").textContent = String(items.length); }, function () { $("acct-saved").textContent = "—"; });
  }
  $("acct-upgrade").addEventListener("click", openUpgrade);
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
  function openUpgrade() {
    track("Opened plans");
    track("Plans viewed", "app"); // the checkout funnel's top step (CheckoutSteps in the API)
    if (isPro()) { renderMembership(); show($("upgrade-panel")); return; }
    $("upgrade-title-text").textContent = "Do more with NoteFusion";
    show($("upgrade-free")); hide($("upgrade-pro"));
    loadPlans($("upgrade-panel"), $("plans-standalone"));
  }
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
  function creditsLine() { return sub ? sub.songCreditsRemaining + " of " + sub.songCreditsTotal + " songs left this month" : "—"; }
  /** The plans dialog for a member: the membership, with nothing for sale. */
  function renderMembership() {
    $("upgrade-title-text").textContent = "Your Pro membership";
    hide($("upgrade-free")); show($("upgrade-pro"));
    $("upgrade-pro-plan").textContent = planLabel();
    $("upgrade-pro-period").textContent = periodLine();
    $("upgrade-pro-credits").textContent = creditsLine();
    sub && sub.isLifetime ? hide($("upgrade-extend")) : show($("upgrade-extend"));
    hide($("plans-extend"));
  }
  $("upgrade-extend").addEventListener("click", function () {
    track("Opened plans to extend");
    track("Plans viewed", "app · extend");
    show($("plans-extend"));
    loadPlans($("upgrade-panel"), $("plans-extend"));
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

  function renderWho() {
    $("who-name").textContent = me ? (me.fullName || me.email || "") : "";
    setAvatar($("who-avatar"), me);
    $("greeting").textContent = greeting(me && me.fullName);
    $("home-sub").textContent = isPro() ? "Thanks for being a Pro member. What are we writing out today?" : "What are we writing out today?";
    document.body.classList.toggle("is-pro", isPro());
    isPro() ? show($("greeting-pro")) : hide($("greeting-pro"));
    $("menu-plans-label").textContent = isPro() ? "My membership" : "View all plans";
    renderStudioCredits();
    $("menu-name").textContent = me ? (me.fullName || "") : "";
    $("menu-email").textContent = me ? (me.email || "") : "";
    var plan = $("who-plan");
    plan.className = "pill " + (isPro() ? "pill-pro" : "pill-free");
    plan.textContent = isPro() ? "Pro" : "Free";
    var credits = $("who-credits");
    if (sub) {
      credits.textContent = isPro()
        ? sub.songCreditsRemaining + " of " + sub.songCreditsTotal + " songs left this month"
        : (sub.songCreditsRemaining > 0 ? "1 free song preview" : "Preview used");
      show(credits);
    } else hide(credits);
    show($("who"));
  }

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
    show($("boot-skel"));
    return loadAccount().then(function () {
      var wasGuest = guest;
      guest = false;
      hide($("boot-skel")); leaveAuth(); hide($("guest-bar")); show($("view-app")); show($("top-nav")); setView("transcribe"); libraryCache = null;
      document.body.classList.remove("guest"); hide($("topbar-signin")); show($("recents"));
      fetchLibrary().catch(function () { return []; });
      var upgradeTo = new URLSearchParams(location.search).get("upgrade");
      // Handled once: the checkout leaves this tab, and Back must not land on a page that starts it again.
      if (upgradeTo) dropParam("upgrade");
      if (upgradeTo && !isPro()) { openUpgrade(); if (upgradeTo !== "1") autoCheckout(upgradeTo); }
      // Back from checkout (the provider's return page adds ?paid=1), or a checkout started here not long ago.
      // Only the provider's return says a payment was made; otherwise the check runs out of sight.
      var paidReturn = !!new URLSearchParams(location.search).get("paid");
      if (paidReturn || readCheckout()) watchPayment(!paidReturn);
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
    hide($("boot-skel")); leaveAuth(); show($("view-app")); show($("guest-bar")); hide($("upgrade-panel")); hide($("top-nav")); setView("transcribe");
    document.body.classList.add("guest"); show($("topbar-signin"));
    $("greeting").textContent = greeting(""); $("home-sub").textContent = "Your free preview is on its way. Try another tune while it comes.";
    startJob({ jobId: previewId, stage: "transcribing" }, "preview");
  }

  // ── Submitting ───────────────────────────────────────────────────────────
  function linkHint(text) { $("link-hint").textContent = text; }
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
    sendLink(body);
  }
  /** The link as it was sent, kept so "Try again" on a job that never finishes can send the same again (`again`). */
  function sendLink(body, again) {
    linkInfo.sending = true; syncLinkSubmit(); hide($("app-alert"));
    track(guest ? "Preview started (link)" : "Song link transcribed");
    var following = !!pollTimer, before = current;
    request(guest ? "/api/preview/link" : "/api/transcriptions/link", { method: "POST", anonymous: guest, body: body })
      .then(function (job) {
        if (again && doneMeanwhile(before)) return;
        if (!again) { clearLinkCard(); $("link-url").value = ""; }
        startJob(job, guest ? "preview" : "link", "link", function () { sendLink(body, true); });
      })
      .catch(function (err) { if (following) resetRetry(); explain(err); })
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
  function uploadKind(fromMic) { var k = chosenKind() || (fromMic ? "hum" : "song"); selectKind(k); return k; }
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
  /** What a song costs, said before it is spent: a link or a song with instruments uses one credit. */
  function renderStudioCredits() {
    var el = $("studio-credits");
    if (!el) return;
    if (!sub || !isPro()) { hide(el); return; }
    var left = sub.songCreditsRemaining, total = sub.songCreditsTotal;
    el.textContent = left > 0
      ? "A link or a recording with instruments uses 1 of your " + left + " songs left this month. Hummed tunes, chords and unaccompanied choirs are free."
      : "You've used all " + total + " songs this month. Hummed tunes, chords and unaccompanied choirs are still free; songs come back next month.";
    show(el);
  }
  function submitAudio(file, name, fromMic, again) {
    var kind = uploadKind(fromMic), song = kind === "song" || (kind === "choir" && $("choir-band").checked);
    var form = new FormData();
    form.append("audio", file, name);
    // A choir in parts keeps every voice; chords keep the harmony, with the top line as the tune; anything else is one line.
    form.append("mode", kind === "choir" ? "choir" : kind === "chords" ? "chords" : "melody");
    // A song with a band behind the voice (or the voices) is separated first; a hummed tune is not.
    form.append("separate", song ? "true" : "false");
    // The sheet in the keys pressed on a transposed keyboard: always sent for chords, otherwise only when set.
    if (kind === "chords" || kbTranspose() !== 0) form.append("keyboardTranspose", String(kbTranspose()));
    // The browser renders its own playback from the notes: the server's piano WAV (about
    // 10 MB and nine seconds of synthesis for a three-minute song) is not wanted here.
    form.append("audioPreview", "false");
    hide($("app-alert"));
    track(guest ? "Preview started (audio)" : song ? "Song uploaded" : kind === "choir" ? "Choir uploaded" : kind === "chords" ? "Chords uploaded" : "Tune uploaded");
    // The recording's own journey up is the first stage on the card, with a real percentage. When a
    // job is still being followed (Try again), that card is left alone and the button carries the count.
    var following = !!pollTimer, before = current;
    if (!following) {
      openProgress("Uploading your recording");
      setStage("uploading", "upload", null);
      $("progress").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    function onProgress(fraction) {
      if (following) $("p-retry-btn").textContent = "Sending again… " + Math.round(fraction * 100) + "%";
      else setPercent(fraction);
    }
    return upload(guest ? "/api/preview" : "/api/transcriptions", form, { anonymous: guest, onProgress: onProgress })
      .then(function (job) {
        if (again && doneMeanwhile(before)) return;
        startJob(Object.assign({}, job, { stage: job.stage || "queued" }), guest ? "preview" : "upload", "upload", function () { submitAudio(file, name, fromMic, true); });
      })
      .catch(function (err) {
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
    if (err.code === "BILLING_SONG_PREVIEW_USED" || err.code === "BILLING_FREE_TIER_LIMIT") {
      alertIn($("app-alert"), "info", text);
      openUpgrade();
      return;
    }
    if (err.code === "BILLING_SONG_CREDITS_EXHAUSTED") { alertIn($("app-alert"), "info", text); return; }
    if (err.code === "PREVIEW_LIMIT_REACHED") { alertIn($("app-alert"), "info", text); openAuth("register"); return; }
    sfx.play("error");
    alertIn($("app-alert"), "danger", text);
  }

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
    hide($("result"));
    show($("progress"));
    $("p-title").textContent = title;
    $("p-artist").textContent = "";
    hide($("p-thumb"));
    setPercent(0);
    $("p-status").textContent = "";
    hide($("p-slow")); hide($("p-offline")); hide($("p-retry"));
    resetRetry();
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
    current = { jobId: job.jobId, kind: kind, from: from || null, retry: retry || null, source: job.source || null, result: null, startedAt: Date.now(), savedId: null, shareToken: null, lyrics: "", semitones: 0, failures: 0, seen: "", seenAt: Date.now() };
    openProgress(kind === "link" ? "Reading the link…" : kind === "preview" ? "Making your free preview…" : "Transcribing your recording…");
    current.preview = kind === "preview";
    if (current.preview) previewId = job.jobId;
    setStage(stageOf(job, kind === "link" ? "fetching" : "transcribing"), current.from, job.queuePosition);
    $("progress").scrollIntoView({ behavior: "smooth", block: "center" });
    poll();
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
    var jobId = current.jobId;
    request((current.preview ? "/api/preview/jobs/" : "/api/transcriptions/jobs/") + encodeURIComponent(jobId), { anonymous: current.preview && guest }).then(function (job) {
      if (!current || current.jobId !== jobId) return;
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
        sfx.play("ready");
        track(current && current.kind === "preview" ? "Preview ready" : "Sheet ready");
        showResult(job.result);
        keepClaimedPreview();
        if (!guest) loadAccount();
        return;
      }
      if (status === "failed") {
        stopPolling();
        hide($("progress"));
        sfx.play("error");
        alertIn($("app-alert"), "danger", job.error && !TECHNICAL.test(job.error) ? job.error : "That could not be transcribed. Try a cleaner recording or a different link.");
        return;
      }
      reviewWait();
      pollTimer = setTimeout(poll, POLL_MS);
    }).catch(function (err) {
      if (err.status === 401) { stopPolling(); return; }
      if (!current || current.jobId !== jobId) return;
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
    $("r-title").textContent = src ? (src.title || "Untitled") : "Your recording";
    $("r-artist").textContent = src ? (src.artist || "") : "";
    if (src && src.thumbnailUrl) { $("r-thumb").src = src.thumbnailUrl; show($("r-thumb")); } else hide($("r-thumb"));
    $("r-credit").textContent = src
      ? "Lead vocal transcribed from “" + (src.title || "Untitled") + "”" + (src.artist ? " by " + src.artist : "") + " (" + providerName(src.provider) + ")" + sectionNote(src) + " with NoteFusion."
      : "Transcribed with NoteFusion.";
    var chips = $("r-chips");
    chips.innerHTML = "";
    [result.key, result.tempo + " BPM", result.timeSignature, Math.round((result.overallConfidence || 0) * 100) + "% confidence"].forEach(function (text) {
      var c = document.createElement("span"); c.className = "chip"; c.textContent = text; chips.appendChild(c);
    });
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

    renderSolfa(result);
    renderChords(result);
    $("lyrics").value = current.lyrics || "";
    setupRehearsal(result);
    setupSing(result);
    renderTranspose();
    renderSave();

    isPro() ? hide($("r-watermark")) : show($("r-watermark"));
    // One set of plans on the page at a time: the note under the downloads carries them while a
    // result is showing; the standalone panel is for the empty state and the Account view.
    isPro() ? hide($("r-upgrade")) : (show($("r-upgrade")), loadPlans($("r-upgrade"), $("plans")));
    hide($("upgrade-panel"));
    // Four parts are written on request, never assumed: the tab appears once they exist (a saved
    // sheet that already carries them, or after "Write the four parts" below).
    hide($("r-parts"));
    var hasParts = isPro() && !!result.parts;
    hasParts ? show($("tab-parts")) : hide($("tab-parts"));
    $("tab-parts").textContent = result.partsSource === "heard" ? "Parts as sung" : "Four parts";
    hasParts ? hide($("harmony")) : show($("harmony"));
    if ($("r-staff").classList.contains("hidden") && $("r-solfa").classList.contains("hidden")) document.querySelector('.result-tabs [data-view="staff"]').click();
    [$("dl-pdf"), $("dl-xml"), $("dl-midi")].forEach(function (b) {
      var text = b.textContent.trim();
      b.innerHTML = (b.id === "dl-pdf" ? '<svg class="ic"><use href="#i-download"/></svg>' : "") + text + (isPro() ? "" : ' <svg class="ic lock"><use href="#i-lock"/></svg>');
    });

    // A guest reads and rehearses; saving, sharing, transposing, singing and downloads are the account's.
    [$("save-section"), $("sing")].forEach(function (el) { guest ? hide(el) : show(el); });
    guest ? hide(document.getElementById("tr-apply").closest(".section")) : show(document.getElementById("tr-apply").closest(".section"));
    guest ? show($("guest-cta")) : hide($("guest-cta"));
    if (guest) { hide($("r-upgrade")); show($("r-watermark")); }

    show($("result"));
    engrave(result.musicXml);
    showParts(result);
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
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
    var voices = [{ name: "soprano", notes: result.notes || [], gain: 1 }];
    if (isPro() && result.parts) {
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
    var box = $("voices");
    box.querySelectorAll("button").forEach(function (b) { b.remove(); });
    if (voices.length > 1) {
      show(box);
      voices.forEach(function (v) {
        var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm on"; b.textContent = v.name[0].toUpperCase(); b.title = "Mute " + v.name;
        b.setAttribute("aria-pressed", "true");
        b.addEventListener("click", function () { var on = b.classList.toggle("on"); b.setAttribute("aria-pressed", String(on)); player.setVoiceOn(v.name, on); });
        box.appendChild(b);
      });
    } else hide(box);
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
  /** A bar of the starting note, then a bar of clicks, on the audio context's clock. Returns the lead-in length. */
  function playLeadIn(ctx, notes, tempo, ts) {
    var bpb = C.beatsPerBar(ts), beat = 60 / Math.max(30, tempo), t0 = ctx.currentTime + 0.05;
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
    if (!isPro()) { show($("r-upgrade")); $("r-upgrade").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { $("sing-status").textContent = "This browser cannot record audio."; return; }
    var r = current.result, notes = singNotes();
    if (!notes.length) return;
    hide($("sing-result"));
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (stream) {
      sing.stream = stream; sing.notes = notes;
      sing.ctx = new (window.AudioContext || window.webkitAudioContext)();
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      var chunks = [];
      sing.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      sing.recorder.addEventListener("dataavailable", function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      sing.recorder.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
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
  $("sing-stop").addEventListener("click", stopSinging);
  function gradeTake(blob, name, notes, tempo, leadIn) {
    var form = new FormData();
    form.append("audio", blob, name);
    form.append("target", JSON.stringify({ notes: notes.map(function (n) { return { pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats }; }), tempoBpm: tempo, leadInSec: leadIn }));
    track("Sang along");
    request("/api/transcriptions/grade", { method: "POST", form: form }).then(function (g) {
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
    }).catch(function (err) { $("sing-status").textContent = "Could not mark the take: " + (err.message || err); });
  }

  // ── Transpose for my choir ───────────────────────────────────────────────
  function renderTranspose() {
    var r = current.result, n = current.semitones || 0;
    $("tr-value").textContent = n > 0 ? "+" + n : String(n);
    $("tr-key").textContent = n === 0 ? r.key : r.key + " → " + C.shiftKeyName(r.key, n);
    $("tr-apply").disabled = n === 0;
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
  $("tr-down").addEventListener("click", function () { if (!current) return; current.semitones = Math.max(-12, (current.semitones || 0) - 1); renderTranspose(); });
  $("tr-up").addEventListener("click", function () { if (!current) return; current.semitones = Math.min(12, (current.semitones || 0) + 1); renderTranspose(); });
  $("tr-apply").addEventListener("click", function () {
    if (!current || !current.result || !current.semitones) return;
    var r = current.result, n = current.semitones, btn = $("tr-apply");
    btn.disabled = true;
    var req = current.savedId
      ? request("/api/library/" + current.savedId + "/transpose", { method: "POST", body: { semitones: n } })
      : request("/api/transcriptions/transpose", { method: "POST", body: { key: r.key, semitones: n, notes: r.notes, musicXml: r.musicXml, parts: r.parts || null, partsMusicXml: r.partsMusicXml || null, chords: r.chords || null } });
    track("Transposed");
    req.then(function (moved) {
      current.semitones = 0;
      var next = Object.assign({}, r, {
        key: moved.key, notes: moved.notes || [], musicXml: moved.musicXml || "",
        parts: moved.parts || null, partsMusicXml: moved.partsMusicXml || "", chords: moved.chords || null,
        solfaLines: C.renderLines(moved.notes || [], C.keyHeader(moved.key), r.timeSignature)
      });
      current.result = next;
      $("sheet-parts").innerHTML = "";
      showResult(next);
    }).catch(function (err) { alertIn($("app-alert"), "danger", "Could not transpose: " + (err.message || err)); btn.disabled = false; });
  });

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
      lyrics: (current.lyrics || "").trim(), parts: (isPro() && r.parts) ? r.parts : null, partsMusicXml: (isPro() && r.partsMusicXml) ? r.partsMusicXml : null,
      chords: r.chords || null
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

  function revealParts() {
    show($("tab-parts")); hide($("harmony"));
    document.querySelector('.result-tabs [data-view="parts"]').click();
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  /**
   * Four-part harmony, only when asked: the transcription is the one voice we heard, and alto,
   * tenor and bass are an arrangement written under it on request. A saved sheet keeps them.
   */
  $("harmony-add").addEventListener("click", function () {
    track("Asked for harmony");
    if (guest) { openAuth("register"); return; }
    if (!isPro()) { openUpgrade(); return; }
    if (!current || !current.result) return;
    var r = current.result;
    if (r.parts) { revealParts(); return; }
    var btn = $("harmony-add"), html = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Writing alto, tenor and bass…";
    request("/api/transcriptions/harmonise", { method: "POST", body: { key: r.key, tempoBpm: Math.round(r.tempo || 0), timeSignature: r.timeSignature, notes: r.notes || [] } })
      .then(function (written) {
        if (!written || !written.parts) { alertIn($("app-alert"), "info", "The tune needs a few notes before parts can be written under it."); return; }
        r.parts = written.parts; r.partsMusicXml = written.partsMusicXml || "";
        showParts(r); setupRehearsal(r); setupSing(r);
        revealParts();
        sfx.play("saved");
        if (current.savedId) {
          request("/api/library/" + current.savedId + "/parts", { method: "PUT", body: { parts: r.parts, partsMusicXml: r.partsMusicXml } })
            .catch(function (err) { alertIn($("app-alert"), "danger", "The parts were written but could not be kept with the saved sheet: " + (err.message || err)); });
        }
      })
      .catch(function (err) { alertIn($("app-alert"), "danger", "The parts could not be written: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; btn.innerHTML = html; });
  });

  /** Four-part harmony: the four solfa blocks and the SATB score, Pro only. */
  function showParts(result) {
    var parts = result.parts;
    $("sheet-parts").innerHTML = "";
    if (!isPro() || !parts) {
      show($("r-parts-locked")); hide($("r-parts-body")); hide($("dl-parts"));
      return;
    }
    hide($("r-parts-locked")); show($("r-parts-body")); show($("dl-parts"));
    var holder = $("r-parts-solfa");
    holder.innerHTML = "";
    ["soprano", "alto", "tenor", "bass"].forEach(function (name) {
      var part = parts[name];
      if (!part) return;
      var block = document.createElement("div"); block.className = "part";
      var h = document.createElement("h3"); h.textContent = name; block.appendChild(h);
      var pre = document.createElement("div"); pre.className = "solfa";
      var lines = part.solfaLines && part.solfaLines.length > 1 ? part.solfaLines : C.renderLines(C.label(part.notes || [], result.key, result.notes || []), "", result.timeSignature);
      lines.slice(1).forEach(function (line) { var d = document.createElement("div"); d.textContent = line; pre.appendChild(d); });
      block.appendChild(pre);
      holder.appendChild(block);
    });
  }

  /** OpenSheetMusicDisplay, from the first CDN that answers; the same bundle the app's engraver inlines. */
  var OSMD_URLS = [
    "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.1.2/build/opensheetmusicdisplay.min.js",
    "https://unpkg.com/opensheetmusicdisplay@2.1.2/build/opensheetmusicdisplay.min.js"
  ];
  var osmdLoading = null;
  function ensureOsmd() {
    if (window.opensheetmusicdisplay) return Promise.resolve();
    if (osmdLoading) return osmdLoading;
    osmdLoading = OSMD_URLS.reduce(function (chain, url) {
      return chain.catch(function () {
        return new Promise(function (resolve, reject) {
          var tag = document.createElement("script");
          tag.src = url; tag.async = true;
          tag.onload = resolve; tag.onerror = function () { tag.remove(); reject(new Error("failed " + url)); };
          document.head.appendChild(tag);
        });
      });
    }, Promise.reject()).catch(function (err) { osmdLoading = null; throw err; });
    return osmdLoading;
  }
  ensureOsmd().catch(function () { /* reported where the sheet is drawn */ });

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
      if (!isPro()) { show($("r-upgrade")); $("r-upgrade").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
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
  $("dl-pdf").addEventListener("click", gated(function (r) {
    var btn = $("dl-pdf"); btn.disabled = true;
    track("Downloaded PDF");
    renderPdf(r).catch(function (err) { alertIn($("app-alert"), "danger", "Could not build the PDF: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  }));

  /**
   * The sheet as A4 pages. OSMD paginates onto canvases in a hidden stage; each becomes a
   * page image under a header (title, artist, key, tempo) and above a credit line, which is
   * how the song is acknowledged on paper.
   */
  function renderPdf(result) {
    if (!window.opensheetmusicdisplay) return ensureOsmd().then(function () { return renderPdf(result); });
    if (!window.jspdf) return Promise.reject(new Error("the PDF library did not load; check your connection and reload"));
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
      doc.save(baseName() + ".pdf");
      stage.innerHTML = "";
    });
  }

  // ── Upgrade ──────────────────────────────────────────────────────────────
  var plansCache = null;
  function isYearly(plan) { return plan.interval === "yearly" || plan.interval === 1; }
  function isLifetimePlan(plan) { return plan.interval === "lifetime" || plan.interval === 2; }
  /**
   * The plan picker: one tile per plan, the yearly one chosen to start with, and a single button that
   * says what will be charged. One payment covers one period, so the copy never promises a renewal.
   */
  function loadPlans(panel, grid) {
    show(panel);
    if (!plansCache) { grid.innerHTML = ""; for (var i = 0; i < 2; i++) { var sk = document.createElement("div"); sk.className = "skel skel-plan"; grid.appendChild(sk); } }
    var p = plansCache ? Promise.resolve(plansCache) : request("/api/billing/plans").then(function (list) { plansCache = list; return list; });
    p.then(function (plans) {
      grid.innerHTML = "";
      grid.classList.add("plan-picker");
      if (!plans.length) { grid.textContent = "No plan is available for your region yet."; return; }
      var monthly = plans.find(function (x) { return !isYearly(x) && !isLifetimePlan(x); });
      var ordered = plans.slice().sort(function (a, b) { return (isYearly(b) ? 1 : 0) - (isYearly(a) ? 1 : 0); });
      var chosen = ordered[0];
      var options = document.createElement("div"); options.className = "plan-options"; options.setAttribute("role", "radiogroup"); options.setAttribute("aria-label", "Choose a plan");
      var cta = document.createElement("button"); cta.type = "button"; cta.className = "btn btn-primary btn-pay";
      function label(plan) { return isLifetimePlan(plan) ? "Lifetime" : isYearly(plan) ? "Yearly" : "Monthly"; }
      function per(plan) { return isLifetimePlan(plan) ? "once" : isYearly(plan) ? "a year" : "a month"; }
      function renderCta() {
        cta.innerHTML = '<svg class="ic"><use href="#i-lock"/></svg>';
        cta.appendChild(document.createTextNode("Continue — " + money(chosen) + " " + per(chosen)));
      }
      ordered.forEach(function (plan) {
        var opt = document.createElement("button"); opt.type = "button"; opt.className = "plan-opt"; opt.setAttribute("role", "radio");
        var top = document.createElement("span"); top.className = "plan-opt-top";
        var name = document.createElement("span"); name.className = "plan-opt-name"; name.textContent = label(plan);
        top.appendChild(name);
        var saving = isYearly(plan) && monthly ? Math.round(100 - (plan.amountMinor / (monthly.amountMinor * 12)) * 100) : 0;
        if (saving > 0) { var tag = document.createElement("span"); tag.className = "plan-opt-tag"; tag.textContent = "Save " + saving + "%"; top.appendChild(tag); }
        var price = document.createElement("span"); price.className = "plan-opt-price"; price.textContent = money(plan);
        var small = document.createElement("small"); small.textContent = " / " + (isLifetimePlan(plan) ? "once" : isYearly(plan) ? "year" : "month"); price.appendChild(small);
        var note = document.createElement("span"); note.className = "plan-opt-note";
        note.textContent = isYearly(plan)
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
      var fine = document.createElement("p"); fine.className = "pay-fine";
      fine.innerHTML = '<svg class="ic"><use href="#i-lock"/></svg>';
      fine.appendChild(document.createTextNode("Secure checkout. One payment covers the whole period; nothing renews without you."));
      grid.appendChild(options); grid.appendChild(cta); grid.appendChild(fine);
    }).catch(function () { grid.textContent = "Plans could not be loaded right now. Please try again in a moment."; });
  }

  function money(plan) {
    var amount = plan.amountMinor / 100;
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount); }
    catch (e) { return plan.currency + " " + amount.toFixed(2); }
  }

  /**
   * The checkout opens in this tab; client "web" has the provider's return page bring the browser back
   * to /app?paid=1 rather than to the app's deep link. What the membership was before leaving is kept,
   * so the return can tell a payment that landed from Pro that was already there.
   */
  function checkout(plan, btn) {
    btn.disabled = true;
    track("Checkout started", plan.id);
    request("/api/billing/checkout", { method: "POST", body: { planId: plan.id, client: "web" } })
      .then(function (session) {
        var provider = "";
        try { provider = new URL(session.checkoutUrl).hostname; } catch (e) { /* ignore */ }
        track("Checkout opened", provider);
        saveCheckout({
          planId: plan.id, startedAt: Date.now(), wasActive: isPro(), periodEnd: (sub && sub.currentPeriodEndUtc) || null,
          lifetime: !!(sub && sub.isLifetime), planCode: (sub && sub.planCode) || null, userId: (me && me.id) || null
        });
        location.assign(session.checkoutUrl);
      })
      .catch(function (err) {
        // An earlier checkout turned out to be paid: nothing to buy, so this is the welcome, not an error.
        if (err instanceof ApiError && err.code === "BILLING_PAYMENT_ALREADY_RECEIVED") {
          var before = { wasActive: isPro(), periodEnd: (sub && sub.currentPeriodEndUtc) || null };
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
    if (!s || !s.isActive) return false;
    if (!snap || !snap.wasActive) return true;
    var end = s.currentPeriodEndUtc ? Date.parse(s.currentPeriodEndUtc) : 0, before = snap.periodEnd ? Date.parse(snap.periodEnd) : 0;
    return end > before || (s.isLifetime && !snap.lifetime) || (s.planCode || null) !== (snap.planCode || null);
  }
  function showPayToast(slow) {
    var toast = $("pay-toast");
    toast.classList.toggle("is-slow", slow);
    $("pay-toast-title").textContent = slow ? "Your payment is still being confirmed." : "Confirming your payment…";
    $("pay-toast-sub").textContent = slow ? "Pro unlocks automatically the moment it lands — you can keep working." : "This usually takes a few seconds.";
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
  function openProWelcome(snap) {
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
})();
