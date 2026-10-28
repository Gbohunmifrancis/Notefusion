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
  var DEVICE_KEY = "nf.web.device";

  /** The browser's opaque id, sent as X-Device-Id so the free preview is metered per browser. */
  function deviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (e) { return "anonymous"; }
  }
  /** The browser's IANA time zone, sent as X-Time-Zone so practice days (streaks, the daily drill) are the singer's own. */
  var TIME_ZONE = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })();
  /** The headers every API call carries: the device, and the time zone when the browser names one. */
  function baseHeaders() {
    var h = { "X-Device-Id": deviceId() };
    if (TIME_ZONE) h["X-Time-Zone"] = TIME_ZONE;
    return h;
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
    lastFailure = { code: failCode(this), at: Date.now() };
  }
  /** The last API failure, so an error put on screen a moment later is counted with its code. */
  var lastFailure = null;
  /** A failure as the analytics detail carries it: the API's code and status, "network", or "error"; never its words. */
  function failCode(err) {
    if (!(err instanceof ApiError)) return "error";
    return err.status ? err.code + " (HTTP " + err.status + ")" : "network";
  }
  /** An error put on screen: counted by where it showed and the API's code just behind it, never what it said. */
  function trackShown(where) {
    var recent = lastFailure && Date.now() - lastFailure.at < 3000 ? lastFailure.code : null;
    track("Error shown", where + (recent ? " · " + recent : ""));
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
      var headers = baseHeaders();
      var body;
      if (opts.form) { body = opts.form; }
      else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }
      if (!opts.anonymous) {
        var t = tokens();
        if (t && t.accessToken) headers.Authorization = "Bearer " + t.accessToken;
      }
      // keepalive: a request that must reach the API even if the page is being left (a deferred delete).
      return fetch(API + path, { method: opts.method || "GET", headers: headers, body: body, keepalive: !!opts.keepalive })
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
  /** A GET of bytes rather than JSON (a song's backing): the same headers, token refresh and ApiError as request(). */
  function requestBytes(path) {
    function send() {
      var headers = baseHeaders(), t = tokens();
      if (t && t.accessToken) headers.Authorization = "Bearer " + t.accessToken;
      return fetch(API + path, { headers: headers }).catch(function () { throw new ApiError(0, null); });
    }
    return send().then(function (r) {
      return r.status === 401 ? refresh().then(send, refreshFailed) : r;
    }).then(function (r) {
      if (r.ok) return r.arrayBuffer();
      return r.json().catch(function () { return null; }).then(function (body) { throw new ApiError(r.status, body); });
    });
  }

  /**
   * A multipart upload that reports how much of it has gone up: fetch cannot, so this one request
   * goes over XMLHttpRequest. Same headers, same 401 refresh-and-retry and the same ApiError as
   * request(); opts.onProgress(fraction) is called as the bytes leave.
   */
  var uploadsInFlight = 0; // the page asks before closing while one is still sending (beforeunload, below)
  function upload(path, form, opts) {
    opts = opts || {};
    function send() {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        uploadsInFlight++;
        // A connection that stops moving gives up after 45 s of no progress instead of hanging on one percentage.
        var lastMove = Date.now(), watch = setInterval(function () { if (Date.now() - lastMove > 45000) xhr.abort(); }, 5000);
        xhr.addEventListener("loadend", function () { uploadsInFlight--; clearInterval(watch); });
        if (xhr.upload) {
          xhr.upload.addEventListener("progress", function () { lastMove = Date.now(); });
          xhr.upload.addEventListener("load", function () { clearInterval(watch); });
        }
        xhr.open("POST", API + path);
        var base = baseHeaders();
        Object.keys(base).forEach(function (k) { xhr.setRequestHeader(k, base[k]); });
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
  /** How the page scrolls to something: smoothly, unless the device asks for less motion (then it jumps). */
  function glide() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"; }
  function alertIn(el, kind, text) {
    if (kind === "danger") trackShown(el.id || "alert");
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
  function label(btn, icon, text) { btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-' + icon + '"/></svg>' + text; }
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
    t.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-' + (dark ? "sun" : "moon") + '"/></svg>';
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
  var follow = null;      // the job being followed: its event stream and timers (see "Following a job")
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
    stopFollowing();
    current = null; keepPreviewJob = null; submitting = false; transposing = false;
    if (player) { player.stop(); player.setBacking(null); }
    cancelSinging(); cancelPracticeTake();
    closeTool(); closeFull();
    hide($("result")); hide($("progress"));
    ["lyrics", "save-title", "share-url"].forEach(function (id) { $(id).value = ""; });
    $("sheet").innerHTML = ""; $("sheet-parts").innerHTML = ""; osmd = null;
    hide($("app-alert"));
  }
  /** Signed out here or in another tab, or the session ran out: nothing of the account stays on screen. */
  function forgetAccount() {
    me = null; sub = null; libraryCache = null; libFolder = null; choir = null; pendingDelete = null; dropToast();
    founderNotes = null; renderFounder(); closeDialog(); resetChoirPanel(); forgetOffer();
    stopPaymentWatch(); hide($("top-nav")); showTabbar(false); document.body.classList.remove("is-pro");
    $("recents-list").innerHTML = "";
    hide($("practice-chip")); hide($("practice-slot")); hide($("season-carols")); if (window.NfPracticeView) window.NfPracticeView.reset();
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
    showPickedPlan();
    // Not on taking over the first paint (assets/app-boot.js): whoever scrolled down to the password stays there.
    if (!document.documentElement.classList.contains("nf-boot")) window.scrollTo(0, 0);
  }
  /**
   * Sent here by a plan on the pricing page (?upgrade=<plan id>, or "choir"): the form names it at the price its card
   * showed (an offer's, with &offer=), and says its checkout (the choir plans) opens straight after; the form used to
   * say only "Free to start", and the pick seemed lost. Named at once, priced when the public prices answer.
   */
  function showPickedPlan() {
    var q = new URLSearchParams(location.search), want = q.get("upgrade"), offerKey = q.get("offer");
    var note = $("auth-plan"), choirPick = want === "choir";
    if (!want || want === "1" || pendingJoin()) { hide(note); return; }
    function say(plan, offered) {
      var price = plan ? money(offered ? { amountMinor: offered, currency: plan.currency } : plan) : null;
      var span = !plan || isSinglePlan(plan) ? "" : isYearly(plan) ? " for a year" : " for a month";
      note.textContent = choirPick
        ? "You picked the choir plan" + (price ? ", " + price + " a month," : "") + " for you and up to 25 singers. Create your account or sign in, and the choir plans open next."
        : "You picked " + (plan ? (isSinglePlan(plan) ? "one song" : isYearly(plan) ? "Pro Yearly" : "Pro Monthly") + ", " + price + span + (offered ? " at the offer's price" : "") : "a plan") +
          ". Create your account or sign in, and its secure checkout opens next.";
    }
    say(null, null);
    show(note);
    var offerAsk = offerKey ? request("/api/offers/current?key=" + encodeURIComponent(offerKey), { anonymous: true }).catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([request("/api/billing/public-plans", { anonymous: true }), offerAsk]).then(function (got) {
      var p = got[0] || {}, offer = got[1] && got[1].offer;
      var plan = choirPick
        ? (p.choir || []).filter(function (x) { return !isYearly(x); })[0]
        : (p.plans || []).concat(p.single ? [p.single] : [], p.choir || []).filter(function (x) { return String(x.id) === want || x.code === want; })[0];
      if (!plan) return;
      var priced = offer && Date.parse(offer.endsAtUtc) > Date.now() && (offer.plans || []).filter(function (x) { return x && String(x.planId) === String(plan.id); })[0];
      var offered = priced && Number(priced.offerAmountMinor) > 0 && Number(priced.offerAmountMinor) < plan.amountMinor ? Number(priced.offerAmountMinor) : null;
      say(plan, offered);
    }).catch(function () { /* the plan stays named, unpriced */ });
  }
  function leaveAuth() {
    if (authLayer) { NfBack.done(authLayer); authLayer = null; }
    document.body.classList.remove("auth-only"); hide($("view-auth"));
  }
  var AUTH_COPY = {
    login: ["Welcome back", "Sign in to open your sheets on any device."],
    register: ["Create your account", "Free to start: 3 hummed or recorded transcriptions every week. We'll email you a code to confirm your address."],
    verify: ["Check your email", "One code and you're in."]
  };
  function showAuthForm(name) {
    ["login", "register", "verify"].forEach(function (f) { name === f ? show($("form-" + f)) : hide($("form-" + f)); });
    $("auth-title").textContent = AUTH_COPY[name][0]; $("auth-sub").textContent = AUTH_COPY[name][1];
    // Sign in and Create account are one choice; the code step is neither, so the tabs step aside.
    name === "verify" ? hide($("auth-tabs")) : show($("auth-tabs"));
    document.querySelectorAll("#auth-tabs [data-tab]").forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.tab === name)); });
    hide($("auth-alert")); clearFieldErrors();
  }
  /** "Just trying it out?": the 30-second preview, opened under the form. */
  function openTry() {
    show($("try-free")); hide($("try-open")); $("try-open").setAttribute("aria-expanded", "true");
    $("try-free").scrollIntoView({ behavior: glide(), block: "start" });
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

  /** The address typed under one tab is there under the other: someone who meant the other form types it once. */
  function carryEmail(to) {
    var from = $(to === "register" ? "login-email" : "reg-email"), into = $(to === "register" ? "reg-email" : "login-email");
    if (!into.value.trim() && from.value.trim()) into.value = from.value.trim();
  }
  document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { carryEmail(b.dataset.tab); showAuthForm(b.dataset.tab); }); });
  document.querySelectorAll("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var input = $(b.dataset.eye), showing = input.type === "text";
      input.type = showing ? "password" : "text";
      b.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-' + (showing ? "eye" : "eye-off") + '"/></svg>';
      b.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });
  // The password rule, ticked off as it is met rather than refused after the fact: a dash until then, a tick once
  // met, so it reads without the colour.
  $("reg-password").addEventListener("input", function () {
    var met = $("reg-password").value.length >= 8, hint = $("reg-password-hint");
    hint.classList.toggle("ok", met);
    hint.querySelector("use").setAttribute("href", "/assets/icons.svg#i-" + (met ? "check" : "minus"));
  });
  $("forgot").addEventListener("click", function () {
    var email = $("login-email").value.trim(), btn = $("forgot");
    if (!email) { alertIn($("auth-alert"), "info", "Type your email above, then press Forgot password."); $("login-email").focus(); return; }
    if (emailProblem(email)) { stopForm(emailProblem(email), "login-email"); return; }
    if (btn.disabled) return; // one email per press: repeated taps sent one each
    btn.disabled = true;
    request("/api/auth/forgot-password", { method: "POST", anonymous: true, body: { email: email } })
      .then(function () {
        track("Asked for a password reset");
        alertIn($("auth-alert"), "success", "If that address has an account, a reset link is on its way.");
        $("auth-alert").scrollIntoView({ block: "nearest", behavior: glide() }); // asked from under the password, it may be out of sight
      })
      .catch(function (err) { track("Password reset request failed", failCode(err)); alertIn($("auth-alert"), "danger", err.message || "Could not send the reset email."); })
      .finally(function () { btn.disabled = false; });
  });

  // ── Sign in with Google ──────────────────────────────────────────────────
  // The same OAuth web client the API validates ID tokens against (Google__ClientId). The
  // site's origin has to be listed under that client's authorised JavaScript origins in the
  // Google Cloud console, or the button renders and then refuses to sign anyone in.
  var GOOGLE_CLIENT_ID = "21738378819-3prjgka9cpf6c2l3si6q879vgm06kf6h.apps.googleusercontent.com";
  /**
   * A brand-new account (the code just confirmed, or a Google account made a moment ago) is greeted once, at the foot
   * of the screen, rather than landing on the studio without a word.
   */
  function welcome() { if (me && !guest) showToast("You're in. Welcome to NoteFusion."); }
  function welcomeIfNew() {
    var made = me && Date.parse(me.createdAtUtc || me.createdAt || "");
    if (made && Date.now() - made < 10 * 60 * 1000) welcome();
  }
  var googleBusy = false; // Google's popup can hand back a credential twice; one sign-in at a time
  function onGoogleCredential(res) {
    if (!res || !res.credential || googleBusy) return;
    googleBusy = true;
    hide($("auth-alert"));
    request("/api/auth/google", { method: "POST", anonymous: true, body: { idToken: res.credential } })
      .then(function (out) { saveTokens({ accessToken: out.accessToken, refreshToken: out.refreshToken }); track("Signed in with Google"); return boot().then(welcomeIfNew); })
      .catch(function (err) {
        track("Sign-in failed", "google · " + failCode(err));
        // The server's "token is invalid or has expired" is plumbing; the person only needs to try again.
        var text = /token/i.test(err.message || "") ? "Google sign-in didn't finish. Please try again." : (err.message || "Google sign-in did not go through.");
        alertIn($("auth-alert"), "danger", text); sfx.play("error");
      })
      .finally(function () { googleBusy = false; });
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

  /**
   * What is missing or mistyped, said before anything is sent: the server's answer to a blank or broken email was
   * "One or more validation errors occurred." Returns the sentence, or null when the form can go.
   */
  var EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function emailProblem(value) {
    if (!value) return "Enter your email address.";
    return EMAIL_SHAPE.test(value) ? null : "That email address looks incomplete. Check it reads like you@example.com.";
  }
  function stopForm(text, field) {
    if (field) { fieldError(field, text); $(field).focus(); }
    else alertIn($("auth-alert"), "danger", text);
  }
  /**
   * A problem with one field is said under that field, where the eye is: with the keyboard up and the field centred,
   * the alert above both forms had scrolled out of sight. `action` (a button) may follow the words. The line goes
   * once the field is typed in again.
   */
  function fieldError(field, text, action) {
    var input = $(field), id = field + "-error";
    clearFieldError(field);
    var line = document.createElement("p");
    line.className = "field-error"; line.id = id; line.setAttribute("role", "alert");
    line.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-info"/></svg>';
    var words = document.createElement("span"); words.textContent = text + (action ? " " : "");
    if (action) words.appendChild(action);
    line.appendChild(words);
    input.closest(".field").appendChild(line);
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", ((input.getAttribute("aria-describedby") || "") + " " + id).trim());
  }
  function clearFieldError(field) {
    var input = $(field), line = $(field + "-error");
    if (line) line.remove();
    input.removeAttribute("aria-invalid");
    var rest = (input.getAttribute("aria-describedby") || "").split(" ").filter(function (x) { return x && x !== field + "-error"; }).join(" ");
    rest ? input.setAttribute("aria-describedby", rest) : input.removeAttribute("aria-describedby");
  }
  /**
   * The button says what it is doing while the request is out ("Signing in…"), then reads as before: on a slow
   * connection a button that only faded looked like a tap that missed.
   */
  function waitLabel(btn, text) {
    var was = btn.textContent;
    btn.textContent = text;
    return function () { btn.textContent = was; };
  }
  var AUTH_FIELDS = ["login-email", "login-password", "reg-name", "reg-email", "reg-password", "verify-code"];
  function clearFieldErrors() { AUTH_FIELDS.forEach(clearFieldError); }
  AUTH_FIELDS.forEach(function (f) { $(f).addEventListener("input", function () { clearFieldError(f); }); });
  // A mistyped address is said as soon as the field is left, not after the whole form is sent; an empty one waits.
  ["login-email", "reg-email"].forEach(function (f) {
    $(f).addEventListener("blur", function () {
      var value = $(f).value.trim(), bad = value && emailProblem(value);
      if (bad) fieldError(f, bad);
    });
  });
  /** Wrong passwords in a row for the address typed: from the second, the line under the field offers the reset. */
  var loginMisses = 0;
  $("login-email").addEventListener("input", function () { loginMisses = 0; });

  $("form-login").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    var bad = emailProblem($("login-email").value.trim());
    if (bad) { stopForm(bad, "login-email"); return; }
    if (!$("login-password").value) { stopForm("Enter your password.", "login-password"); return; }
    btn.disabled = true; hide($("auth-alert")); clearFieldErrors();
    var restore = waitLabel(btn, "Signing in…");
    request("/api/auth/login", { method: "POST", anonymous: true, body: { email: $("login-email").value.trim(), password: $("login-password").value } })
      .then(function (res) {
        saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        track("Signed in");
        return boot();
      })
      .catch(function (err) {
        track("Sign-in failed", "password · " + failCode(err));
        // The password was right but the address was never confirmed, and a fresh code is on its way:
        // straight to the code boxes, as the phone does, rather than an error with nowhere to type it.
        if (err.code === "AUTH_EMAIL_NOT_VERIFIED") { openVerify($("login-email").value.trim(), "login"); return; }
        var reset = null;
        if (err.code === "AUTH_INVALID_CREDENTIALS" && ++loginMisses >= 2) {
          reset = document.createElement("button");
          reset.type = "button"; reset.className = "btn-link"; reset.textContent = "Forgot your password?";
          reset.addEventListener("click", function () { $("forgot").click(); });
        }
        fieldError("login-password", err.message || "Could not sign in.", reset);
      })
      .finally(function () { btn.disabled = false; restore(); });
  });
  var verifyFrom = "register"; // the form the code step came from, which "Wrong address? Change it" returns to
  /**
   * The code step says once, under its heading, where the code went and why (no alert above saying it again): a new
   * account's code, or a fresh one for an address that was never confirmed.
   */
  var VERIFY_NOTE = {
    register: ["We emailed a six-digit code to ", ". Enter it to finish creating your account."],
    login: ["This address isn't confirmed yet, so we've emailed a new six-digit code to ", ". Enter it to finish setting up your account."]
  };
  function openVerify(email, from) {
    pendingEmail = email; verifyFrom = from || "register";
    var words = VERIFY_NOTE[verifyFrom] || VERIFY_NOTE.register, note = $("verify-note"), who = document.createElement("strong");
    who.id = "verify-email-label"; who.textContent = pendingEmail;
    note.textContent = "";
    note.appendChild(document.createTextNode(words[0])); note.appendChild(who); note.appendChild(document.createTextNode(words[1]));
    showAuthForm("verify");
    resendCooldown();
    $("verify-code").focus();
  }
  /**
   * A code was just sent: the server sends no other for a minute (and said nothing when asked), so "Send it again"
   * counts the minute down instead of promising a code that never came.
   */
  var resendTimer = null;
  function resendCooldown() {
    var btn = $("verify-resend"), until = Date.now() + 60000;
    clearInterval(resendTimer);
    function tick() {
      var left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = "Send it again"; return; }
      btn.disabled = true; btn.textContent = "Send it again in 0:" + String(left).padStart(2, "0");
    }
    tick(); resendTimer = setInterval(tick, 1000);
  }

  $("form-register").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; hide($("auth-alert")); clearFieldErrors();
    if (!$("reg-name").value.trim()) { stopForm("Enter your name.", "reg-name"); btn.disabled = false; return; }
    var badEmail = emailProblem($("reg-email").value.trim());
    if (badEmail) { stopForm(badEmail, "reg-email"); btn.disabled = false; return; }
    // One password field: the eye shows what was typed, so a second copy only slowed sign-up down.
    if ($("reg-password").value.length < 8) { stopForm("Use at least 8 characters for the password.", "reg-password"); btn.disabled = false; return; }
    var restore = waitLabel(btn, "Creating your account…");
    request("/api/auth/register", { method: "POST", anonymous: true, body: { fullName: $("reg-name").value.trim(), email: $("reg-email").value.trim(), password: $("reg-password").value, source: "web" } })
      .then(function (res) {
        track("Created account");
        openVerify((res && res.email) || $("reg-email").value.trim(), "register");
      })
      .catch(function (err) {
        track("Sign-up failed", failCode(err));
        // The checks above catch what the validator would; its own words ("'Full Name' must not be empty.") stay out.
        if (err.code === "USER_EMAIL_EXISTS" || err.code === "AUTH_DISPOSABLE_EMAIL") { fieldError("reg-email", err.message); return; }
        if (err.code === "AUTH_PASSWORD_WEAK") { fieldError("reg-password", err.message); return; }
        alertIn($("auth-alert"), "danger", err.details ? "Check your name, email and password, then try again." : (err.message || "Could not create the account."));
      })
      .finally(function () { btn.disabled = false; restore(); });
  });

  var pendingEmail = "";
  $("form-verify").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    if (!/^\d{6}$/.test($("verify-code").value.replace(/\s+/g, ""))) { stopForm("Enter the 6-digit code from the email.", "verify-code"); return; }
    btn.disabled = true; hide($("auth-alert")); clearFieldErrors();
    var restore = waitLabel(btn, "Checking the code…");
    request("/api/auth/verify-email", { method: "POST", anonymous: true, body: { email: pendingEmail, code: $("verify-code").value.replace(/\s+/g, "") } })
      .then(function (res) {
        saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        track("Verified email");
        showAuthForm("login");
        return boot().then(welcome);
      })
      .catch(function (err) { track("Email code failed", failCode(err)); fieldError("verify-code", err.message || "That code did not match."); })
      .finally(function () { btn.disabled = false; restore(); });
  });
  $("verify-resend").addEventListener("click", function () {
    if ($("verify-resend").disabled) return;
    resendCooldown();
    request("/api/auth/resend-verification", { method: "POST", anonymous: true, body: { email: pendingEmail } })
      .then(function () { alertIn($("auth-alert"), "success", "A new code is on its way."); })
      .catch(function (err) { alertIn($("auth-alert"), "danger", err.message || "Could not resend the code."); });
  });
  // A mistyped address: back to the form it was typed in, everything else still filled, the address ready to fix.
  $("verify-change").addEventListener("click", function () {
    $("verify-code").value = "";
    showAuthForm(verifyFrom);
    var email = $(verifyFrom === "login" ? "login-email" : "reg-email");
    email.focus(); email.select();
  });

  // Guest → account: the sign-up screen on its own, with a way back to the preview that is waiting.
  var authLayer = null; // a guest's sign-up screen: the browser's Back returns to the preview, as "Back to your preview" does
  function openAuth(tab) {
    if (guest && !authLayer && window.NfBack) authLayer = NfBack.push(function () { authLayer = null; leaveAuth(); show($("view-app")); });
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
    // Sent now, with the tokens still here: what this account did before signing out stays its own.
    trackNow("Signed out");
    flushDelete(); // a sheet deleted a moment ago goes while the session is still here to send it
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

  // ── Views: transcribe / library / practice / account ────────────────────
  var viewNow = "transcribe";
  // The view the address asked for, read before boot settles on the studio (which clears it from the address).
  var viewAsked = new URLSearchParams(location.search).get("view");
  function setView(name) {
    var focusSearch = name === "search";
    if (focusSearch) name = "library";
    if (name === "practice" && (guest || !tokens())) name = "transcribe"; // practice is for a signed-in account
    if (name !== viewNow) track("Opened view", name);
    viewNow = name;
    try {
      // The view rides in the address, so a reload (or a shared link) opens it again.
      var url = new URL(location.href);
      name === "transcribe" ? url.searchParams.delete("view") : url.searchParams.set("view", name);
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    } catch (e) { /* the address keeps the old view; nothing depends on it */ }
    ["transcribe", "library", "practice", "account"].forEach(function (v) { v === name ? show($("view-" + v)) : hide($("view-" + v)); });
    // A phone's top bar names the section (app.css, under 641 px); Home keeps the logo's name.
    var section = { library: "Library", practice: "Practice", account: "Account" }[name] || "";
    $("topbar-title").textContent = section;
    $("topbar-title").parentNode.classList.toggle("has-title", !!section);
    // The nav says where you are, to the eye and to a screen reader; Search lights itself, not Library.
    var navOn = focusSearch ? "search" : name;
    // The phone's tab bar has no Search (the Library's own box is it) and no Account (the photo, top right).
    document.querySelectorAll("#top-nav .top-link, #tabbar [data-view]").forEach(function (b) {
      var on = b.dataset.view === (b.closest("#tabbar") ? name : navOn);
      b.classList.toggle("on", on);
      on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
    });
    if (name === "library") loadLibrary().then(function () { if (focusSearch) $("lib-search").focus(); });
    if (name === "account") renderAccount();
    name === "practice" ? openPracticeView() : leavePracticeView();
    closeDrawer(); closeUserMenu();
    window.scrollTo({ top: 0, behavior: glide() });
  }
  /** A view chosen in the nav or the menu is a step the browser's Back undoes (assets/back.js). */
  function goView(name) {
    var from = viewNow;
    if (window.NfBack && (name === "search" ? "library" : name) !== from) NfBack.push(function () { setView(from); });
    setView(name);
    // A screen reader hears the new view's heading (Search goes to its field instead): on a phone, the top bar's.
    var h = name !== "search" && document.querySelector("#view-" + viewNow + " h1");
    if (h && h.offsetParent === null) h = $("topbar-title");
    if (h && h.offsetParent !== null) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
  }
  document.querySelectorAll("#top-nav .top-link, .user-menu-item[data-view], #tabbar [data-view]").forEach(function (b) { b.addEventListener("click", function () { goView(b.dataset.view); }); });
  /** The phone's tab bar (app.css shows it under 641 px): a signed-in account's, never a guest's or the sign-in screen's. */
  function showTabbar(on) { document.body.classList.toggle("has-tabbar", on); }

  // The sidebar is a drawer on phones.
  // Opening it moves focus into it; closing it (Escape too) hands focus back to the menu button. Closed, it is out of
  // the tab order altogether (app.css), not just slid off the screen.
  function openDrawer() {
    document.body.classList.add("drawer-open"); $("drawer-backdrop").hidden = false; $("drawer-toggle").setAttribute("aria-expanded", "true");
    var first = document.querySelector("#top-nav:not(.hidden) .top-link.on") || $("drawer-close");
    setTimeout(function () { first.focus({ preventScroll: true }); }, 0);
  }
  function closeDrawer() {
    var wasOpen = document.body.classList.contains("drawer-open");
    document.body.classList.remove("drawer-open"); $("drawer-backdrop").hidden = true; $("drawer-toggle").setAttribute("aria-expanded", "false");
    if (wasOpen && $("side").contains(document.activeElement)) $("drawer-toggle").focus({ preventScroll: true });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.classList.contains("drawer-open")) closeDrawer(); });
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
    // The logo is the app's home (the studio) for a signed-in account, as the Home tab is; the site's for anyone else.
    appLogos.forEach(function (a) { a.setAttribute("href", on ? "/app" : "/"); });
  }
  var appLogos = document.querySelectorAll(".topbar .brand, .side-head .brand");
  appLogos.forEach(function (a) {
    a.addEventListener("click", function (e) {
      if (a.getAttribute("href") !== "/app" || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      goView("transcribe");
    });
  });
  $("menu-plans").addEventListener("click", function () { closeUserMenu(); openUpgrade(); });
  $("menu-how").addEventListener("click", function (e) { e.preventDefault(); closeUserMenu(); closeDrawer(); openOnb(); });
  $("topbar-signin").addEventListener("click", function () { openAuth("login"); });
  $("recents-all").addEventListener("click", function () { setView("library"); });

  // ── Practice (assets/practice-view.js): the daily drill, the streak, XP and badges ──
  // The view's script, its arithmetic and its stylesheet load the first time it is opened, never with the
  // app; the home chip needs only the numbers, asked for once the app is up and the phone is idle.
  var PRACTICE_ASSETS = ["/assets/practice-view.css?v=14", "/assets/practice-progress.js?v=10", "/assets/practice-track.js?v=6", "/assets/practice-modes.js?v=4", "/assets/practice-games.js?v=1", "/assets/practice-view.js?v=18"];
  var assetLoads = {};
  /** One stylesheet or script, once per page; a failed one is tried again next time. Scripts run in the order asked. */
  function loadAsset(url) {
    if (!assetLoads[url]) {
      assetLoads[url] = new Promise(function (resolve, reject) {
        var css = /\.css(\?|$)/.test(url), tag = document.createElement(css ? "link" : "script");
        if (css) { tag.rel = "stylesheet"; tag.href = url; } else { tag.src = url; tag.async = false; }
        tag.onload = resolve;
        tag.onerror = function () { tag.remove(); delete assetLoads[url]; reject(new Error("failed " + url)); };
        document.head.appendChild(tag);
      });
    }
    return assetLoads[url];
  }
  var practiceViewOpen = false;
  /** What the Practice view opens on, once: "season" from the home's season link (the carols, the Midnight path), else the hub. */
  var practiceOpensOn = null;
  function openPracticeView() {
    practiceViewOpen = true;
    var at = epoch, root = $("practice-root"), opensOn = practiceOpensOn;
    practiceOpensOn = null;
    var go = function () {
      if (at !== epoch || !practiceViewOpen) return;
      window.NfPracticeView.open(root, { request: request, track: track, choir: C, onProgress: renderPracticeChip, loadAsset: loadAsset, mark: markSpan, show: opensOn });
    };
    if (window.NfPracticeView) { go(); return; }
    Promise.all(PRACTICE_ASSETS.map(loadAsset)).then(go, function () {
      if (at !== epoch || !practiceViewOpen) return;
      root.innerHTML = "";
      var card = document.createElement("div"); card.className = "card";
      var p = document.createElement("p"); p.textContent = "Practice didn't load. Check your connection and try again.";
      var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost"; label(b, "restart", "Try again");
      b.addEventListener("click", openPracticeView);
      card.appendChild(p); card.appendChild(b); root.appendChild(card);
    });
  }
  function leavePracticeView() {
    practiceViewOpen = false;
    if (window.NfPracticeView) window.NfPracticeView.leave();
  }
  /**
   * The home chip: the streak and the XP, a tap from today's drill (the phone's Home chip); "Start practising" for an
   * account that has not practised yet. It fills the place the slot held from the first paint.
   */
  function renderPracticeChip(p) {
    var chip = $("practice-chip");
    hide($("practice-slot"));
    if (!p || !p.streak || !p.level) { hide(chip); hide($("season-carols")); return; }
    var start = !p.xp && !p.streak.current && !p.streak.best;
    chip.classList.toggle("is-start", start);
    chip.classList.toggle("is-on", p.streak.current > 0);
    $("practice-chip-streak").textContent = p.streak.current;
    var xp = String(Math.round(p.xp)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); // "12,450", as Practice writes it
    $("practice-chip-xp").textContent = xp + " XP";
    chip.setAttribute("aria-label", start ? "Start practising: open Practice" : "Practice: " + p.streak.current + "-day streak, " + xp + " XP, level " + p.level.name);
    show(chip);
    renderSeasonCarols(p);
  }
  /**
   * The season's path, while its season is on for this account (the progress carries it): one link under the
   * greeting to the path in Practice, in the season's tint — pine "Sing the carols · 2 of 6" (board d-christmas/06),
   * pumpkin "The Midnight path · 2 of 6" (board j-halloween/06).
   */
  var SEASON_CSS = "/assets/season.css?v=4";
  function renderSeasonCarols(p) {
    var link = $("season-carols"), season = p && p.season;
    if (!season) { hide(link); return; }
    var halloween = season.season === "halloween";
    loadAsset(SEASON_CSS).then(function () {
      link.classList.toggle("season-halloween", halloween);
      link.classList.toggle("season-christmas", !halloween);
      $("season-carols-icon").setAttribute("href", halloween ? "/assets/icons.svg#i-ghost" : "/assets/icons.svg#i-snowflake");
      $("season-carols-text").textContent = (halloween ? season.title : "Sing the carols") + " · " + season.sung + " of " + season.total;
      link.setAttribute("aria-label", season.title + ": " + season.sung + " of " + season.total + " sung. Open " + (halloween ? "the Midnight path" : "the carols") + " in Practice");
      link.setAttribute("data-season-path", halloween ? "halloween" : "christmas");
      show(link);
    }, function () { hide(link); });
  }
  /** The home's question, in the season's words while one is on (assets/season.js says so). */
  function homeQuestion() {
    var S = window.NfSeason;
    return S && S.christmas ? "What are we singing this Christmas?" : S && S.halloween ? "What are we singing this Halloween?" : "What are we writing out today?";
  }
  document.addEventListener("nf-season", function () { if (me && !guest) $("home-sub").textContent = homeQuestion(); });
  $("season-carols").addEventListener("click", function () {
    track($("season-carols").getAttribute("data-season-path") === "halloween" ? "Season: midnight path link" : "Season: carols link");
    practiceOpensOn = "season"; setView("practice");
  });
  function loadPracticeChip() {
    var at = epoch;
    var go = function () {
      if (at !== epoch || guest || !tokens()) return;
      request("/api/practice/progress").then(function (p) { if (at === epoch) renderPracticeChip(p); }, function () { if (at === epoch) hide($("practice-slot")); /* no chip; the menu still leads there */ });
    };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 3000 }); else setTimeout(go, 1200);
  }
  $("practice-chip").addEventListener("click", function () { track("Practice chip"); setView("practice"); });

  /** The saved sheets, fetched once and shared by the library, the account view and the sidebar. */
  function fetchLibrary(force) {
    var p = libraryCache && !force ? Promise.resolve(libraryCache) : request("/api/library").then(function (items) {
      // A sheet deleted a moment ago is still on the server until its Undo runs out: it stays out of the list.
      libraryCache = (items || []).filter(function (x) { return !pendingDelete || x.id !== pendingDelete.it.id; });
      return libraryCache;
    });
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
    closeFolderMenu(false);
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
  /** A saved sheet's opening notes in solfa ("s, d m d m r d l,"), from the preview every read carries; "" without one. */
  function openingSolfa(it) { return (it.preview || []).map(function (n) { return (n.solfa || "") + (n.octaveMark || ""); }).join(" "); }
  /** "18 Oct" this year, "20 Dec 2025" before it: in the reader's own order. */
  function shortDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var opts = { day: "numeric", month: "short" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString(undefined, opts);
  }
  /** Search text as people type it: no accents ("noel" finds "Noël"), no case, punctuation as spaces. */
  function fold(text) {
    return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  /**
   * A Library action's failure, said in the Library (an alert under its heading), not in the studio's alert, which
   * sits inside the hidden Transcribe view; elsewhere it falls back to that one.
   */
  function libAlert(text) {
    var box = viewNow === "library" ? $("lib-alert") : $("app-alert");
    alertIn(box, "danger", text);
    if (box.scrollIntoView) box.scrollIntoView({ block: "nearest" });
  }
  function filterLibrary() {
    var words = fold($("lib-search").value).split(" ").filter(Boolean), shown = 0;
    document.querySelectorAll("#lib-list .lib-item").forEach(function (card) {
      // Every word typed, anywhere in the title, the folder or the key.
      var match = words.every(function (w) { return card.dataset.search.indexOf(w) >= 0; }) && (!libFolder || card.dataset.folder === libFolder);
      card.classList.toggle("hidden", !match);
      if (match) shown++;
    });
    // A date's heading only over sheets still shown (inside a folder and while searching too).
    document.querySelectorAll("#lib-list .lib-group-h").forEach(function (gh) {
      gh.classList.toggle("hidden", !document.querySelector('#lib-list .lib-item[data-group="' + gh.dataset.group + '"]:not(.hidden)'));
    });
    // A search that hides every sheet says so, rather than leaving an empty page.
    var none = $("lib-no-match");
    if (none) {
      none.textContent = words.length ? "No sheets match \u201c" + $("lib-search").value.trim() + "\u201d. Try fewer words, or clear the search." : "No sheets in this folder.";
      none.hidden = shown > 0 || !document.querySelector("#lib-list .lib-item");
    }
  }
  /**
   * A tap anywhere on a sheet's card opens it (the title is the biggest target there is); the card's own controls and
   * its ⋯ menu keep their jobs, and a tap that only closed that menu opens nothing. Keyboards and screen readers use
   * Open (in the ⋯ menu on the account's own sheets).
   */
  function opensOnTap(card, open) {
    card.addEventListener("click", function (e) {
      if (e !== sheetMenuClosedBy && !e.target.closest("button, select, a, input, label, .lib-menu")) open();
    });
  }
  /**
   * A folder's name, asked in the app's own dialog (it was the browser's prompt): `title` and `action` say what it is
   * for, `name` is what the field starts with, `onName(name)` gets the trimmed name and `onCancel` runs when none is given.
   */
  var folderAsk = null;
  function askFolderName(opts) {
    folderAsk = opts;
    $("folder-dialog-title").textContent = opts.title;
    $("folder-save").textContent = opts.action;
    clearFieldError("folder-input");
    $("folder-input").value = opts.name || "";
    openDialog("folder-dialog", "folder-input", function () {
      var asked = folderAsk; folderAsk = null;
      if (asked && !asked.given && asked.onCancel) asked.onCancel();
    });
    $("folder-input").select();
  }
  $("folder-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var asked = folderAsk, name = $("folder-input").value.trim();
    if (!asked) return;
    if (!name) { fieldError("folder-input", "Give the folder a name."); $("folder-input").focus(); return; }
    asked.given = true;
    closeDialog();
    asked.onName(name);
  });
  $("folder-input").addEventListener("input", function () { clearFieldError("folder-input"); });
  /** Files a sheet: an existing folder, a new one ("__new" asks its name), or none (null). */
  function fileSheet(it, value) {
    if (value === "__new") {
      askFolderName({ title: "New folder", action: "Create", onName: function (name) { fileSheet(it, name); } });
      return;
    }
    var name = value;
    request("/api/library/" + it.id + "/folder", { method: "PUT", body: { folder: name || null } })
      .then(function () {
        it.folder = name || null; track("Filed sheet");
        // Drawn again, the card's ⋯ is a new button: the keyboard goes back to it, unless it went somewhere meanwhile.
        loadLibrary(false).then(function () {
          var card = sheetCard(it.id), more = card && !card.classList.contains("hidden") && card.querySelector(".lib-card-more");
          if (more && (!document.activeElement || document.activeElement === document.body)) more.focus({ preventScroll: true });
        });
      }, function (err) { libAlert("Could not move the sheet: " + (err.message || err)); });
  }
  $("lib-folder-share").addEventListener("click", function () {
    if (!libFolder) return;
    var btn = $("lib-folder-share"); btn.disabled = true;
    request("/api/library/folders/share", { method: "POST", body: { folder: libFolder } })
      .then(function (link) {
        $("lib-folder-url").value = link.url || ("https://notefusion.studio/app/sheet/?f=" + encodeURIComponent(link.token));
        show($("lib-folder-share-row")); $("lib-folder-url").select(); track("Shared folder"); libraryCache = null;
      })
      .catch(function (err) { libAlert("Could not share the folder: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("lib-folder-copy").addEventListener("click", function () {
    var url = $("lib-folder-url").value;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { $("lib-folder-copy").textContent = "Copied"; setTimeout(function () { $("lib-folder-copy").textContent = "Copy"; }, 1500); }, function () { $("lib-folder-url").select(); });
  });
  // ── The folder's ⋯ menu: Rename, and Stop sharing once a link is out (board m-ux-medium W3c) ──
  // A menu button: Enter, Space or a tap opens it on its first item, the arrows move between items, and Escape, Tab or a
  // tap outside closes it (Escape hands the focus back to ⋯).
  function folderMenuItems() {
    return Array.prototype.filter.call($("lib-folder-menu").querySelectorAll("[role=menuitem]"), function (b) { return !b.hidden; });
  }
  function openFolderMenu() {
    var shared = !$("lib-folder-share-row").classList.contains("hidden");
    $("lib-folder-stop").hidden = !shared; $("lib-folder-stop-sep").hidden = !shared;
    show($("lib-folder-menu")); $("lib-folder-more").setAttribute("aria-expanded", "true");
    folderMenuItems()[0].focus();
  }
  function closeFolderMenu(focusBack) {
    if ($("lib-folder-menu").classList.contains("hidden")) return;
    hide($("lib-folder-menu")); $("lib-folder-more").setAttribute("aria-expanded", "false");
    if (focusBack) $("lib-folder-more").focus();
  }
  $("lib-folder-more").addEventListener("click", function (e) {
    e.stopPropagation();
    $("lib-folder-menu").classList.contains("hidden") ? openFolderMenu() : closeFolderMenu(true);
  });
  $("lib-folder-menu").addEventListener("keydown", function (e) {
    var items = folderMenuItems(), at = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); items[e.key === "Home" ? 0 : items.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFolderMenu(true); }
    else if (e.key === "Tab") closeFolderMenu(false);
  });
  document.addEventListener("click", function (e) { if (!$("lib-folder-menu").contains(e.target)) closeFolderMenu(false); });
  $("lib-folder-stop").addEventListener("click", function () {
    closeFolderMenu(true);
    if (!libFolder) return;
    // The link dies for everyone who has it, and sharing again makes a new one: asked first, like a delete.
    if (!confirm("Stop sharing \u201c" + libFolder + "\u201d? Everyone with the link loses it, and sharing again makes a new link.")) return;
    request("/api/library/folders/share?folder=" + encodeURIComponent(libFolder), { method: "DELETE" })
      .then(function () { hide($("lib-folder-share-row")); })
      .catch(function (err) { libAlert("Could not stop sharing: " + (err.message || err)); });
  });
  $("lib-folder-rename").addEventListener("click", function () {
    closeFolderMenu(true);
    if (!libFolder) return;
    var from = libFolder;
    askFolderName({ title: "Rename “" + from + "”", action: "Rename", name: from, onName: function (to) {
      if (to === from) return;
      request("/api/library/folders", { method: "PUT", body: { from: from, to: to } })
        .then(function () {
          // Renamed in the list as it stands, without a reload to the skeleton.
          (libraryCache || []).forEach(function (x) { if (x.folder === from) x.folder = to; });
          libFolder = to; loadLibrary(false);
        })
        .catch(function (err) { libAlert("Could not rename the folder: " + (err.message || err)); });
    } });
  });

  // ── A sheet's ⋯ menu (board n-ux-low V2a): Open, Move to a folder…, Share with the choir (in one), Delete ──
  // The folder's menu's ways: Enter, Space or a tap opens it on its first item, the arrows move between items, and
  // Escape, Tab or a tap outside closes it (Escape hands the focus back to ⋯). "Move to a folder…" turns the same menu
  // into the folders, then New folder….
  var sheetMenu = null; // { el, more, it } while one is open
  var sheetMenuClosedBy = null; // the tap that closed it, which opens nothing else (opensOnTap)
  function sheetCard(id) {
    return Array.prototype.filter.call(document.querySelectorAll("#lib-list .lib-item"), function (c) { return c.dataset.id === String(id); })[0];
  }
  /** How the tune opens, in solfa, as the phone's rows show it, then the key and a short date ("18 Oct"). */
  function sheetMeta(it) {
    return [openingSolfa(it), it.key, shortDate(it.createdAtUtc)].filter(Boolean).join(" · ") + (it.shareToken ? " · shared" : "") + (it.sharedWithChoir ? " · in the choir library" : "");
  }
  function sheetMenuItems() { return sheetMenu ? Array.prototype.slice.call(sheetMenu.el.querySelectorAll("[role^=menuitem]")) : []; }
  function closeSheetMenu(focusBack) {
    var m = sheetMenu;
    if (!m) return;
    sheetMenu = null;
    m.el.remove(); m.more.setAttribute("aria-expanded", "false"); m.more.removeAttribute("aria-controls");
    if (focusBack) m.more.focus();
  }
  function openSheetMenu(card, more, it) {
    closeFolderMenu(false);
    var el = document.createElement("span"); el.className = "lib-menu lib-sheet-menu"; el.id = "lib-sheet-menu";
    el.setAttribute("role", "menu"); el.setAttribute("aria-label", it.title || "Untitled");
    el.addEventListener("keydown", function (e) {
      var items = sheetMenuItems(), at = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
      else if (e.key === "Home" || e.key === "End") { e.preventDefault(); items[e.key === "Home" ? 0 : items.length - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSheetMenu(true); }
      else if (e.key === "Tab") closeSheetMenu(false);
    });
    card.appendChild(el);
    sheetMenu = { el: el, more: more, it: it };
    more.setAttribute("aria-expanded", "true"); more.setAttribute("aria-controls", el.id);
    sheetMenuMain(it);
  }
  function menuItem(text, onPick, opts) {
    var b = document.createElement("button"); b.type = "button"; b.textContent = text;
    b.setAttribute("role", opts && opts.checked != null ? "menuitemradio" : "menuitem");
    if (opts && opts.checked != null) {
      b.setAttribute("aria-checked", String(opts.checked));
      if (opts.checked) b.insertAdjacentHTML("beforeend", '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-check"/></svg>');
    }
    if (opts && opts.danger) b.className = "danger";
    b.addEventListener("click", onPick);
    return b;
  }
  function menuSep() { var s = document.createElement("span"); s.className = "lib-menu-sep"; s.setAttribute("role", "separator"); return s; }
  /** The menu's items, the keyboard on the first, the whole menu on screen (above the tab bar). */
  function fillSheetMenu(items) {
    var el = sheetMenu.el; el.textContent = "";
    items.forEach(function (x) { el.appendChild(x); });
    sheetMenuItems()[0].focus({ preventScroll: true });
    if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }
  function sheetMenuMain(it) {
    var items = [
      menuItem("Open", function () { closeSheetMenu(false); openSaved(it.id); }),
      menuItem("Move to a folder…", function () { sheetMenuFolders(it); })
    ];
    if (sub && sub.choirName) items.push(menuItem(it.sharedWithChoir ? "Take it out of the choir library" : "Share with " + sub.choirName, function () { closeSheetMenu(true); shareWithChoir(it); }));
    items.push(menuSep(), menuItem("Delete", function () { closeSheetMenu(false); deleteSheet(it); }, { danger: true }));
    fillSheetMenu(items);
  }
  /** The folders as a short list (the sheet's own ticked, and No folder to take it out of one), then New folder…. */
  function sheetMenuFolders(it) {
    var items = (it.folder ? [null] : []).concat(foldersOf(libraryCache).map(function (f) { return f.name; })).map(function (name) {
      return menuItem(name || "No folder", function () {
        closeSheetMenu(true);
        if (name !== (it.folder || null)) fileSheet(it, name);
      }, { checked: name === (it.folder || null) });
    });
    if (items.length) items.push(menuSep());
    items.push(menuItem("New folder…", function () { closeSheetMenu(true); fileSheet(it, "__new"); }));
    fillSheetMenu(items);
  }
  // A tap anywhere else closes it; seen first (capture), so the folder's ⋯ and a card's own tap find it closed.
  document.addEventListener("click", function (e) {
    if (sheetMenu && !sheetMenu.el.contains(e.target) && !sheetMenu.more.contains(e.target)) { sheetMenuClosedBy = e; closeSheetMenu(false); }
  }, true);
  function sheetMore(card, it) {
    var more = document.createElement("button"); more.type = "button"; more.className = "lib-card-more";
    more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false"); more.setAttribute("aria-label", "More for " + (it.title || "Untitled"));
    more.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
    more.addEventListener("click", function () {
      if (sheetMenu && sheetMenu.more === more) closeSheetMenu(true);
      else openSheetMenu(card, more, it);
    });
    return more;
  }

  function loadLibrary(force) {
    var list = $("lib-list"), empty = $("lib-empty"), skel = $("lib-skel");
    if (!libraryCache || force) { show(skel); hide(list); hide(empty); }
    return fetchLibrary(force).then(function (items) {
      hide(skel);
      closeSheetMenu(false);
      list.innerHTML = "";
      libEmptyState(false);
      if (!items.length) { show(empty); hide(list); return; }
      hide(empty); show(list);
      renderFolders(items);
      // Under Today, This week and Earlier, on the reader's own calendar (board n-ux-low V2b).
      window.NfLibraryGroups.group(items).forEach(function (g) {
        var gh = document.createElement("h2"); gh.className = "lib-group-h"; gh.dataset.group = g.key; gh.textContent = g.title; list.appendChild(gh);
        g.items.forEach(function (it) {
          var card = document.createElement("div"); card.className = "lib-item"; card.dataset.id = it.id; card.dataset.search = fold([it.title || "Untitled", it.folder, it.key].join(" ")); card.dataset.folder = it.folder || ""; card.dataset.group = g.key;
          var badge = document.createElement("span"); badge.className = "lib-key"; badge.textContent = String(it.key || "♪").replace(/\s*(major|minor)$/i, function (m) { return /minor/i.test(m) ? "m" : ""; }); card.appendChild(badge);
          // A level under its date's h2, as the choir's cards are under the choir's own.
          var h = document.createElement("h3"); h.textContent = it.title || "Untitled"; card.appendChild(h);
          var m = document.createElement("div"); m.className = "meta"; m.textContent = sheetMeta(it); card.appendChild(m);
          if (it.folder) { var tag = document.createElement("span"); tag.className = "lib-folder-tag"; tag.textContent = it.folder; card.appendChild(tag); }
          // Its key, title, opening, key and date, and folder; everything else is behind ⋯, and a tap opens it.
          card.appendChild(sheetMore(card, it));
          opensOnTap(card, function () { openSaved(it.id); });
          list.appendChild(card);
        });
      });
      filterLibrary();
    }).catch(function (err) { hide(skel); show(empty); libEmptyState(true, err); })
      .then(renderChoirLibrary);
  }

  // ── A short note at the foot of the screen, with at most one action (board m-ux-medium W3b) ──
  // One at a time: a new note ends the one before, and that one's end runs (a deferred delete is sent).
  var toast = { timer: null, onEnd: null, onAction: null };
  function showToast(text, opts) {
    finishToast();
    opts = opts || {};
    $("app-toast-text").textContent = text;
    var btn = $("app-toast-action");
    btn.hidden = !opts.action;
    btn.textContent = opts.action || "";
    toast.onEnd = opts.onEnd || null; toast.onAction = opts.onAction || null;
    show($("app-toast"));
    toast.timer = setTimeout(finishToast, opts.ms || 4000);
  }
  /** Takes the note away without running its end (the action ran, or the account is gone). */
  function dropToast() {
    clearTimeout(toast.timer); toast.timer = null; toast.onEnd = null; toast.onAction = null;
    var had = $("app-toast").contains(document.activeElement);
    hide($("app-toast"));
    return had;
  }
  /** Its time is up (or another note takes its place): it goes, and its end runs. */
  function finishToast() {
    if (!toast.timer) return;
    var end = toast.onEnd;
    // The keyboard's place was the note's button: it lands on the Library's search rather than on nothing.
    if (dropToast() && viewNow === "library") $("lib-search").focus({ preventScroll: true });
    if (end) end();
  }
  $("app-toast-action").addEventListener("click", function () { var act = toast.onAction; dropToast(); if (act) act(); });

  // ── Delete, then Undo (board m-ux-medium W3b) ──────────────────────────────
  // The card goes at once and a note says so for 6 s with Undo; the DELETE goes when the note ends, or at once when
  // the page is hidden or left (fetch keepalive: an Undo that never ran leaves nothing to take back). No browser confirm.
  var pendingDelete = null; // { it, index, done }
  function deleteSheet(it) {
    var list = libraryCache || [], index = list.indexOf(it);
    var pd = { it: it, index: index < 0 ? list.length : index, done: false };
    showToast("Deleted “" + (it.title || "Untitled") + "”", {
      action: "Undo", ms: 6000,
      onAction: function () { undoDelete(pd); },
      onEnd: function () { sendDelete(pd); }
    });
    pendingDelete = pd;
    libraryCache = list.filter(function (x) { return x.id !== it.id; });
    loadLibrary(false);
    track("Deleted sheet");
    $("app-toast-action").focus({ preventScroll: true });
  }
  function sendDelete(pd) {
    if (pd.done) return;
    pd.done = true;
    if (pendingDelete === pd) pendingDelete = null;
    request("/api/library/" + pd.it.id, { method: "DELETE", keepalive: true })
      .then(function () { refreshUsage(); renderChoirLibrary(); })
      .catch(function (err) { restoreSheet(pd); libAlert("Could not delete: " + (err.message || err)); });
  }
  function undoDelete(pd) {
    if (pd.done) return;
    pd.done = true;
    if (pendingDelete === pd) pendingDelete = null;
    track("Undid delete");
    restoreSheet(pd).then(function () {
      // Back where it was, and the keyboard with it (on its ⋯, where Delete was).
      var open = sheetCard(pd.it.id);
      if (open && open.querySelector(".lib-card-more")) open.querySelector(".lib-card-more").focus({ preventScroll: true });
    });
  }
  function restoreSheet(pd) {
    if (!libraryCache) return loadLibrary(true);
    if (!libraryCache.some(function (x) { return x.id === pd.it.id; })) libraryCache.splice(Math.min(pd.index, libraryCache.length), 0, pd.it);
    return loadLibrary(false);
  }
  /** The page is being hidden or left: a delete still waiting on its Undo goes now. */
  function flushDelete() {
    if (!pendingDelete) return;
    var pd = pendingDelete;
    if (dropToast() && viewNow === "library") $("lib-search").focus({ preventScroll: true });
    sendDelete(pd);
  }
  window.addEventListener("pagehide", flushDelete);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flushDelete(); });

  // ── The choir's shared library ──────────────────────────────────────────
  /**
   * The ⋯ menu's "Share with <choir>" on one of the account's own sheets, or "Take it out of the choir library": the
   * card's line says which it is now, and a note says it was done.
   */
  function shareWithChoir(it) {
    var on = !it.sharedWithChoir;
    request("/api/choirs/mine/sheets/" + encodeURIComponent(it.id), { method: on ? "PUT" : "DELETE" })
      .then(function () {
        it.sharedWithChoir = on;
        var card = sheetCard(it.id);
        if (card) card.querySelector(".meta").textContent = sheetMeta(it);
        track(on ? "Shared with choir" : "Unshared from choir"); if (on) sfx.play("saved");
        showToast(on ? "Shared with " + ((sub && sub.choirName) || "your choir") : "Taken out of the choir library");
        renderChoirLibrary();
      })
      .catch(function (err) { libAlert("Could not share with your choir: " + (err.message || err)); });
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
        m.textContent = [it.mine ? "Shared by you" : "Shared by " + it.sharedBy, it.key, openingSolfa(it)].filter(Boolean).join(" · ");
        card.appendChild(m);
        var a = document.createElement("div"); a.className = "actions";
        var open = document.createElement("button"); open.className = "btn btn-primary btn-sm"; open.type = "button"; open.textContent = "Open";
        open.setAttribute("aria-label", "Open " + (it.title || "Untitled"));
        open.addEventListener("click", function () { openChoirSheet(it.id); });
        opensOnTap(card, function () { openChoirSheet(it.id); });
        a.appendChild(open);
        if (it.canUnshare) {
          var out = document.createElement("button"); out.className = "btn btn-ghost btn-sm"; out.type = "button"; out.textContent = "Take out";
          out.title = it.mine ? "It stays in your own library" : "It stays in " + it.sharedBy + "'s own library";
          out.addEventListener("click", function () {
            out.disabled = true;
            request("/api/choirs/mine/sheets/" + encodeURIComponent(it.id), { method: "DELETE" })
              .then(function () { track("Unshared from choir"); if (it.mine) libraryCache = null; return it.mine ? loadLibrary(true) : renderChoirLibrary(); })
              .catch(function (err) { libAlert("Could not take it out: " + (err.message || err)); out.disabled = false; });
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
    stopFollowing(); rememberJob(null);
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
      $("result").scrollIntoView({ behavior: glide(), block: "start" });
    }).catch(function (err) { if (at === epoch) libAlert("Could not open that sheet: " + (err.message || err)); });
  }
  // To the microphone: what every account can do for free (a song link never is on a free account).
  /**
   * The Library's empty card says one of two things: nothing saved yet (its button to the microphone), or that the list
   * did not load (its button asks again, rather than sending someone off to record).
   */
  var libFailed = false;
  function libEmptyState(failed, err) {
    libFailed = failed;
    $("lib-empty-text").textContent = failed
      ? "Your library didn't load. " + ((err && err.message) || "Check your connection and try again.")
      : "Nothing here yet. Every tune you transcribe lands here by itself, and in the app.";
    label($("lib-empty-go"), failed ? "restart" : "plus", failed ? "Try again" : "New transcription");
  }
  $("lib-empty-go").addEventListener("click", function () {
    if (libFailed) { loadLibrary(true); return; }
    setView("transcribe"); selectSource("record"); $("rec-btn").focus();
  });
  $("lib-search").addEventListener("input", filterLibrary);
  /** A saved sheet, opened into the same result view a fresh transcription uses. */
  function openSaved(id) {
    stopFollowing(); rememberJob(null);
    var at = epoch;
    request("/api/library/" + id).then(function (t) {
      if (at !== epoch) return; // signed out while it loaded
      var result = {
        key: t.key, tempo: t.tempoBpm, timeSignature: t.timeSignature, notes: t.notes || [], musicXml: t.musicXml || "",
        overallConfidence: t.overallConfidence || 0, parts: t.parts || null, partsMusicXml: t.partsMusicXml || "",
        chords: t.chords || null, chordsSource: t.chords && t.chords.length ? "heard" : null,
        solfaLines: C.renderLines(t.notes || [], C.keyHeader(t.key), t.timeSignature), source: null, hymn: t.hymn || null,
        // The song's backing, kept with an upload's sheet (fetched apart: loadBacking); where its beats fall in it.
        hasBacking: t.hasBacking === true, beatOriginSec: t.beatOriginSec || 0, beatTimesSec: t.beatTimesSec || null
      };
      current = { jobId: null, kind: "library", source: null, result: result, startedAt: Date.now(), savedId: t.id, title: t.title, shareToken: t.shareToken || null, lyrics: t.lyrics || "", semitones: 0,
        transposedBy: t.transposedBy || 0, fromLink: t.fromLink === true };
      resultReturnView = viewNow;
      track("Opened saved sheet");
      setView("transcribe");
      hide($("progress"));
      $("sheet-parts").innerHTML = "";
      showResult(result);
      $("result").scrollIntoView({ behavior: glide(), block: "start" });
    }).catch(function (err) { if (at === epoch) libAlert("Could not open that sheet: " + (err.message || err)); });
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
    var play = playBilled();
    var soon = !play && !proViaChoir() ? daysLeft() : null, ended = lapsedOn();
    $("acct-sub-note").textContent = isPro()
      ? periodLine() + (play ? " " + playLine() : sub && (sub.isLifetime || sub.isGift) ? ""
        : soon !== null ? " " + (soon < 1 ? "That's today" : soon === 1 ? "That's tomorrow" : "That's in " + soon + " days") + ": add time to keep it."
        : " Nothing renews by itself; add time whenever you like.")
      : play ? playLine()
      : (ended ? "Your Pro ended on " + longDate(ended) + ". " : "") + "Pro adds 20 songs a month, full songs up to six minutes, four-part harmony and every download format.";
    $("acct-upgrade-label").textContent = play ? (sub.paymentIssue ? "Fix it in Google Play" : "Manage in Google Play")
      : isPro() ? (sub && (sub.isLifetime || sub.isGift) ? "My membership" : "Add another month") : "See the plans";
    var since = me && (me.createdAtUtc || me.createdAt);
    // The month spelled out, as the plan's and the choir's dates on Account are ("October 2026", "20 October 2026").
    $("acct-since").textContent = since ? new Date(since).toLocaleDateString(undefined, { year: "numeric", month: "long" }) : "—";
    fetchLibrary().then(function (items) { $("acct-saved").textContent = String(items.length); }, function () { $("acct-saved").textContent = "—"; });
    renderChoirPanel();
    // The Account group (board m-ux-medium W3d): an account that signs in with Google has no password to change.
    $("acct-name-val").textContent = me ? (me.fullName || "—") : "—";
    $("acct-email-val").textContent = me ? (me.email || "—") : "—";
    var google = !!me && me.hasPassword === false;
    google ? hide($("acct-password-row")) : show($("acct-password-row"));
    google ? show($("acct-password-google")) : hide($("acct-password-google"));
    loadEmailPrefs();
  }

  // ── Account: the name, the password, the founder's notes (board m-ux-medium W3d) ──
  // One small dialog each for the name and the password (and the Library's folder name): focus goes in and stays in,
  // Escape, Cancel, a tap outside or the browser's Back close it, and the focus goes back to what opened it.
  // `onClose` runs once it has closed, however it closed.
  var dialogOpen = null, dialogReturn = null, dialogClosed = null;
  function openDialog(id, focusId, onClose) {
    dialogReturn = document.activeElement; dialogOpen = id; dialogClosed = onClose || null;
    show($(id));
    $(focusId).focus();
  }
  function closeDialog() {
    if (!dialogOpen) return;
    hide($(dialogOpen)); dialogOpen = null;
    if (dialogReturn && dialogReturn.focus && document.contains(dialogReturn)) dialogReturn.focus({ preventScroll: true });
    dialogReturn = null;
    var after = dialogClosed; dialogClosed = null;
    if (after) after();
  }
  ["name-dialog", "password-dialog", "folder-dialog"].forEach(function (id) {
    var el = $(id);
    el.addEventListener("click", function (e) { if (e.target === el || e.target.closest("[data-close]")) closeDialog(); });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeDialog(); return; }
      if (e.key !== "Tab") return;
      var items = Array.prototype.filter.call(el.querySelectorAll("button, input"), function (x) { return !x.disabled && x.offsetParent !== null; });
      var at = items.indexOf(document.activeElement), next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 ? 0 : at + 1);
      e.preventDefault(); items[next].focus();
    });
    backLayer(el, function () { return !el.classList.contains("hidden"); }, closeDialog);
  });
  $("acct-name-row").addEventListener("click", function () {
    clearFieldError("name-input");
    $("name-input").value = (me && me.fullName) || "";
    openDialog("name-dialog", "name-input");
    $("name-input").select();
  });
  $("name-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("name-input").value.trim();
    clearFieldError("name-input");
    if (!name) { fieldError("name-input", "Enter your name."); $("name-input").focus(); return; }
    if (me && name === me.fullName) { closeDialog(); return; }
    var btn = $("name-save"), done = waitLabel(btn, "Saving…");
    btn.disabled = true;
    request("/api/me", { method: "PUT", body: { fullName: name } })
      .then(function (profile) {
        me = profile || Object.assign({}, me, { fullName: name });
        renderWho(); renderAccount(); closeDialog();
        showToast("Saved"); track("Changed name");
      })
      .catch(function (err) { fieldError("name-input", (err && err.message) || "We couldn't save that just now. Please try again."); $("name-input").focus(); })
      .finally(function () { done(); btn.disabled = false; });
  });
  function renderNewPasswordHint() {
    var met = $("pw-new").value.length >= 8, hint = $("pw-new-hint");
    hint.classList.toggle("ok", met);
    hint.querySelector("use").setAttribute("href", "/assets/icons.svg#i-" + (met ? "check" : "minus"));
  }
  $("pw-new").addEventListener("input", renderNewPasswordHint);
  $("acct-password-row").addEventListener("click", function () {
    ["pw-current", "pw-new"].forEach(function (id) { clearFieldError(id); $(id).value = ""; $(id).type = "password"; });
    renderNewPasswordHint();
    openDialog("password-dialog", "pw-current");
  });
  $("password-form").addEventListener("submit", function (e) {
    e.preventDefault();
    clearFieldError("pw-current"); clearFieldError("pw-new");
    var current = $("pw-current").value, next = $("pw-new").value;
    if (!current) { fieldError("pw-current", "Enter the password you use now."); $("pw-current").focus(); return; }
    if (next.length < 8) { fieldError("pw-new", "Your new password needs at least 8 characters."); $("pw-new").focus(); return; }
    var btn = $("password-save"), done = waitLabel(btn, "Updating…");
    btn.disabled = true;
    request("/api/auth/change-password", { method: "POST", body: { currentPassword: current, newPassword: next } })
      .then(function (pair) {
        // Every other session ended with the old password; the pair that came back is this one's.
        if (pair && pair.accessToken) saveTokens({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
        closeDialog(); showToast("Password updated"); track("Changed password");
      })
      .catch(function (err) {
        var onNew = err && (err.code === "AUTH_PASSWORD_WEAK" || (err.details && (err.details.NewPassword || err.details.newPassword)));
        var field = onNew ? "pw-new" : "pw-current";
        fieldError(field, (err && err.message) || "We couldn't change it just now. Please try again.");
        $(field).focus();
      })
      .finally(function () { done(); btn.disabled = false; });
  });
  /** "Notes and offers from NoteFusion" (the founder's notes and the occasional offer, by email): the account's choice
   * (EmailOptOut), read when Account opens; null until then. */
  var founderNotes = null;
  function renderFounder() {
    var s = $("acct-founder");
    s.disabled = founderNotes === null;
    s.setAttribute("aria-checked", String(!!founderNotes));
  }
  function loadEmailPrefs() {
    var at = epoch;
    request("/api/me/email-preferences").then(function (p) {
      if (at !== epoch || !p) return;
      founderNotes = !!p.founderNotes; renderFounder();
    }, function () { /* the switch keeps what it showed */ });
  }
  $("acct-founder").addEventListener("click", function () {
    if (founderNotes === null) return;
    var want = !founderNotes, before = founderNotes;
    founderNotes = want; renderFounder(); $("acct-founder").disabled = true;
    request("/api/me/email-preferences", { method: "PUT", body: { founderNotes: want } })
      .then(function (p) { founderNotes = p ? !!p.founderNotes : want; track(want ? "Founder notes on" : "Founder notes off"); })
      .catch(function () { founderNotes = before; showToast("That didn't save. Check your connection and try again."); })
      .finally(renderFounder);
  });
  $("acct-upgrade").addEventListener("click", function () {
    if (playBilled()) { openPlayManage(); return; }
    openUpgrade();
    // "Add another month" goes straight to the month: the plans open under the membership with Monthly chosen.
    if (isPro() && !(sub && (sub.isLifetime || sub.isGift))) openExtend(true);
  });
  // The deletion page fills in the signed-in address (handed over in this tab only, never in the URL).
  $("acct-delete").addEventListener("click", function () {
    try { if (me && me.email) sessionStorage.setItem("nf.deleteEmail", me.email); } catch (e) { /* typed there instead */ }
  });

  // ── My choir (Account & settings) ───────────────────────────────────────
  /** The account's choir, as director or singer; null when it is in none (the API answers 404). */
  function fetchChoir() {
    return request("/api/choirs/mine").then(function (c) { choir = c; return c; }, function (err) {
      if (err && err.status === 404) { choir = null; return null; }
      throw err;
    });
  }
  function longDate(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : ""; }
  /** My choir before the account's choir is known: the waiting line, neither card (a new account's, or a sign-out's). */
  function resetChoirPanel() {
    hide($("choir-none")); hide($("choir-card"));
    show($("choir-wait")); show($("choir-wait-skel")); hide($("choir-wait-text"));
    choirCodeOpen(false);
  }
  /** In no choir, the code field waits behind "Have a choir code?" (board n-ux-low V2c): no filled button until asked. */
  function choirCodeOpen(open, focus) {
    $("choir-code-ask").setAttribute("aria-expanded", String(open));
    $("choir-code-box").classList.toggle("hidden", !open);
    if (open && focus) $("choir-join-code").focus();
  }
  $("choir-code-ask").addEventListener("click", function () { choirCodeOpen($("choir-code-ask").getAttribute("aria-expanded") !== "true", true); });
  function renderChoirPanel() {
    return fetchChoir().then(function (c) {
      hide($("choir-wait")); hide($("choir-msg-row"));
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
        // Read out or copied by hand in fours ("ABCD 2345"); the API takes it with or without the space.
        $("choir-invite-code").textContent = c.inviteCode.replace(/(.{4})(?=.)/g, "$1 ");
        show($("choir-invite-row"));
      } else hide($("choir-invite-row"));
      director && !c.isActive ? show($("choir-renew")) : hide($("choir-renew"));
      director ? hide($("choir-leave")) : show($("choir-leave"));
      if (director) loadChoirMembers(); else hide($("choir-members-row"));
    }).catch(function () {
      // The panel keeps what it showed; the next visit asks again. Never answered yet, it says so rather than wait.
      if ($("choir-wait").classList.contains("hidden")) return;
      hide($("choir-wait-skel"));
      $("choir-wait-text").textContent = "Your choir didn't load. Check your connection, then open Account again.";
      show($("choir-wait-text"));
    });
  }
  /** A choir action that failed, said in the choir's own card on Account (the studio's alert is in another view). */
  function choirProblem(text) {
    trackShown("choir-msg");
    $("choir-msg").textContent = text;
    show($("choir-msg-row"));
    $("choir-msg").scrollIntoView({ block: "nearest", behavior: glide() });
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
            .catch(function (err) { choirProblem("Could not remove the singer: " + (err.message || err)); rm.disabled = false; });
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
        // Said over Account, where the choir now shows (the studio's alert is in another view).
        setView("account");
        showToast("You've joined " + c.name + ".");
        sfx.play("saved");
      });
    }).catch(function (err) {
      var text = (err && err.message) || "We couldn't join that choir just now.";
      $("choir-join-status").textContent = text;
      choirCodeOpen(true); // the reason shows under the field, which is open to try again
      // From an invite link the studio is showing, not the join form: the alert there says it.
      if (viewNow !== "account") alertIn($("app-alert"), "danger", "Could not join the choir: " + text);
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
      .then(function (c) { choir = c; track("Renamed choir"); showToast("Choir renamed"); return loadAccount().then(renderChoirPanel); })
      .catch(function (err) { choirProblem("Could not rename the choir: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("choir-invite-copy").addEventListener("click", function () {
    var url = $("choir-invite-url").value, btn = $("choir-invite-copy");
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () {
      track("Copied choir invite"); btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy link"; }, 1500);
    }, function () { $("choir-invite-url").select(); });
  });
  // One request per press: the button rests while it is out, so a second tap on a slow line sends nothing twice.
  $("choir-invite-new").addEventListener("click", function () {
    var btn = $("choir-invite-new");
    if (btn.disabled || !confirm("Make a new invite code? The old code and link stop working at once. Singers already in the choir stay in.")) return;
    btn.disabled = true;
    request("/api/choirs/mine/invite", { method: "POST" })
      .then(function (c) { choir = c; track("New choir invite code"); renderChoirPanel(); })
      .catch(function (err) { choirProblem("Could not make a new code: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("choir-leave").addEventListener("click", function () {
    var btn = $("choir-leave");
    if (btn.disabled || !confirm("Leave the choir? You lose Pro through it, and the sheets you shared leave its library. They stay in yours.")) return;
    btn.disabled = true;
    request("/api/choirs/leave", { method: "POST" })
      .then(function () { choir = null; track("Left choir"); libraryCache = null; return loadAccount().then(renderAccount); })
      .catch(function (err) { choirProblem("Could not leave the choir: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("choir-plan-open").addEventListener("click", function () { openUpgrade("choir"); });
  $("choir-renew").addEventListener("click", function () { openUpgrade("choir"); });
  $("acct-photo").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var form = new FormData(); form.append("image", file, file.name);
    $("acct-photo-status").textContent = "Uploading…";
    request("/api/me/picture", { method: "POST", form: form })
      .then(function (profile) { return profile || request("/api/me"); })
      .then(function (profile) { me = profile; $("acct-photo-status").textContent = ""; renderWho(); renderAccount(); sfx.play("saved"); track("Added photo"); })
      .catch(function (err) { track("Photo upload failed", failCode(err)); $("acct-photo-status").textContent = (err instanceof ApiError && err.message) || "We couldn't upload that photo. Please try again."; sfx.play("error"); })
      .finally(function () { e.target.value = ""; });
  });
  // The photo is gone for good once removed (there is no copy to put back), so it is asked first, like the choir's code.
  $("acct-photo-remove").addEventListener("click", function () {
    var btn = $("acct-photo-remove");
    if (btn.disabled || !confirm("Remove your photo? Your initial shows in its place until you add another.")) return;
    btn.disabled = true;
    request("/api/me/picture", { method: "DELETE" })
      .then(function () { return request("/api/me"); })
      .then(function (profile) { me = profile; renderWho(); renderAccount(); track("Removed photo"); })
      .catch(function (err) { track("Photo remove failed", failCode(err)); $("acct-photo-status").textContent = err.message || "Could not remove the photo."; })
      .finally(function () { btn.disabled = false; });
  });

  // ── Upgrade dialog ──────────────────────────────────────────────────────
  /**
   * The plans dialog. reason "limit" is the free allowance running out (the refusal after the last one):
   * the one-song purchase is then the option already chosen, since one more song is what was just asked for. Reason
   * "choir" (My choir's links) opens on the choir plans rather than on their folded row. `want` is a plan's id or code
   * picked on the pricing page: that plan is the one chosen here.
   */
  function openUpgrade(reason, why, want) {
    track("Opened plans");
    track("Plans viewed", "app"); // the checkout funnel's top step (CheckoutSteps in the API)
    // A refusal's own sentence ("back Friday at 6pm…") heads the dialog; the sales line steps aside for it.
    var said = reason === "limit" && why;
    $("upgrade-reason-text").textContent = said ? why : "";
    said ? show($("upgrade-reason")) : hide($("upgrade-reason"));
    said ? hide($("upgrade-lead")) : show($("upgrade-lead"));
    if (isPro()) {
      renderMembership(); show($("upgrade-panel"));
      // A member the offer was sent to (web-billed Pro): more time at the offer's price, Monthly chosen.
      if (reason === "offer" && offerLive() && !playBilled() && !(sub && sub.isLifetime)) openExtend(true);
      syncOfferLine();
      return;
    }
    $("upgrade-title-text").textContent = "Do more with NoteFusion";
    show($("upgrade-free")); hide($("upgrade-pro"));
    // At the free limit one more song is what was asked for: the choir plans stay out of it, unless this is a director.
    // From the offer (reason "offer": its email's button, Home's strip) Pro leads with Monthly chosen.
    loadPlans($("upgrade-panel"), $("plans-standalone"), { single: true, singleFirst: reason === "limit", choir: reason !== "limit" || leadsChoir(), choirFirst: reason === "choir", want: want, fromOffer: reason === "offer" });
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
  /** Whole days until a membership that runs out (not for life) ends, when that is three or fewer; null otherwise. */
  function daysLeft() {
    var end = isPro() && sub && !sub.isLifetime && sub.currentPeriodEndUtc ? Date.parse(sub.currentPeriodEndUtc) : NaN;
    if (isNaN(end)) return null;
    var days = Math.floor((end - Date.now()) / 86400000);
    return days <= 3 ? Math.max(0, days) : null;
  }
  /** When Pro of the account's own ended, for an account that had it and is free again; null otherwise. */
  function lapsedOn() {
    var end = !isPro() && sub && !sub.isLifetime && sub.currentPeriodEndUtc ? Date.parse(sub.currentPeriodEndUtc) : NaN;
    return !isNaN(end) && end <= Date.now() ? sub.currentPeriodEndUtc : null;
  }
  function creditsLine() { return sub ? sub.songCreditsRemaining + " of " + sub.songCreditsTotal + " songs left · resets " + resetDay() : "—"; }
  /**
   * A membership Google Play bills (bought in the Android app): Google renews it and it is managed there, so this page
   * neither says nothing renews nor offers more time (the website's checkout refuses it: BILLING_MANAGED_BY_GOOGLE_PLAY).
   * The words are the phone's (mobile lib/playBilling).
   */
  function playBilled() { return !!(sub && sub.billedThrough === "googlePlay"); }
  function playLine() {
    if (sub.paymentIssue === "hold") return "Pro is paused. Google Play still couldn't take the payment. Fix it in Google Play and Pro comes back at once.";
    if (sub.paymentIssue === "grace") return "Google Play couldn't take this period's payment. Update your card in Google Play and Pro carries on.";
    return sub.autoRenews
      ? "Google Play charges you again at the end of each period until you cancel there. Receipts come from Google Play."
      : "You cancelled in Google Play. Pro stays on until the end of the period you paid for.";
  }
  /** Google's page for the subscription: cancel, change card, switch plan. */
  function openPlayManage() {
    track("Opened Google Play subscriptions");
    var sku = sub && sub.storeProductId ? "sku=" + encodeURIComponent(sub.storeProductId) + "&" : "";
    window.open("https://play.google.com/store/account/subscriptions?" + sku + "package=com.notefusion.com", "_blank", "noopener");
  }
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
    var play = playBilled();
    $("upgrade-pro-note").textContent = play ? playLine()
      : "Each payment covers one period and nothing renews without you. Add more time whenever you like; it starts when your current time ends. Receipts come by email.";
    if (play) label($("upgrade-extend"), "arrow-right", sub.paymentIssue ? "Fix it in Google Play" : "Manage in Google Play");
    else label($("upgrade-extend"), "plus", proViaChoir() ? (singer ? "Get Pro of my own" : "Add choir time") : "Add more Pro time");
    sub && sub.isLifetime ? hide($("upgrade-extend")) : show($("upgrade-extend"));
    hide($("plans-extend"));
    syncOfferLine();
  }
  /** A member's plans for more time, under the membership; `monthly` starts on the monthly plan (Account's "Add another month"). */
  function openExtend(monthly) {
    track("Opened plans to extend");
    track("Plans viewed", "app · extend");
    show($("plans-extend"));
    loadPlans($("upgrade-panel"), $("plans-extend"), { choir: true, monthly: !!monthly });
    $("plans-extend").scrollIntoView({ behavior: glide(), block: "nearest" });
  }
  $("upgrade-extend").addEventListener("click", function () {
    if (playBilled()) { openPlayManage(); return; }
    openExtend(false);
  });
  $("upgrade-account").addEventListener("click", function () { hide($("upgrade-panel")); setView("account"); });
  /** The pricing page sends a plan id along: once signed in, open its checkout without another click. */
  function autoCheckout(planId) {
    Promise.all([request("/api/billing/plans"), request("/api/billing/plans/single").catch(function () { return []; })]).then(function (lists) {
      var plan = (lists[0] || []).concat(lists[1] || []).find(function (p) { return String(p.id) === String(planId) || p.code === planId; });
      if (!plan) {
        // The pricing page prices by where the browser is; an account buys at its own country's prices. A plan from
        // the other set is not this account's, so the dialog says why it shows other prices rather than nothing.
        $("upgrade-reason-text").textContent = "The plan you picked isn't sold for the country on your account, so these are your account's prices.";
        show($("upgrade-reason")); hide($("upgrade-lead"));
        return;
      }
      checkout(plan, document.createElement("button"));
    }).catch(function () { /* the dialog is open; the user can pick a plan */ });
  }
  $("upgrade-close").addEventListener("click", function () { hide($("upgrade-panel")); });
  $("upgrade-panel").addEventListener("click", function (e) { if (e.target === $("upgrade-panel")) hide($("upgrade-panel")); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide($("upgrade-panel")); });
  /**
   * The plans dialog behaves as one: whichever of its many openers shows it, focus moves to its title, Tab stays
   * inside it while it is open, and closing it hands focus back to what opened it. Watched rather than wired into
   * each show/hide, so a new opener cannot forget it.
   */
  (function trapUpgradeFocus() {
    var panel = $("upgrade-panel"), title = $("upgrade-title"), opener = null;
    title.setAttribute("tabindex", "-1");
    new MutationObserver(function () {
      var open = !panel.classList.contains("hidden");
      if (open && !opener) {
        opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
        opener = opener || document.body;
        title.focus({ preventScroll: true });
      } else if (!open && opener) {
        var back = opener; opener = null;
        if (back !== document.body && document.contains(back) && (panel.contains(document.activeElement) || document.activeElement === document.body)) {
          try { back.focus({ preventScroll: true }); } catch (err) { /* gone */ }
        }
      }
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    panel.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      // Out of the Tab order (tabindex -1: the plans not chosen, reached with the arrows) is out of this list too.
      var items = Array.prototype.filter.call(panel.querySelectorAll("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
        function (x) { return !x.disabled && x.offsetParent !== null && x.tabIndex >= 0; });
      if (!items.length) return;
      var at = items.indexOf(document.activeElement), next;
      if (at === -1) {
        // On the title (or anything outside the list): the next control after it in reading order, wrapping round.
        var after = items.filter(function (x) { return document.activeElement.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING; });
        var before = items.filter(function (x) { return document.activeElement.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_PRECEDING; });
        next = e.shiftKey ? (before[before.length - 1] || items[items.length - 1]) : (after[0] || items[0]);
      } else {
        next = items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length];
      }
      e.preventDefault(); next.focus();
    });
  })();
  $("acct-signout").addEventListener("click", function () { $("signout").click(); });

  // ── App view ─────────────────────────────────────────────────────────────
  function isPro() { return !!(sub && sub.isActive); }
  /** A free account's one four-part harmony, until it is used. The API decides; this mirrors it. */
  function freeHarmonyLeft() { return !isPro() && !!(sub && sub.freeHarmonyAvailable); }

  /**
   * What this month (Pro) or this week (free) has left, as numbers for the meters. A free account's meter is
   * this week's free hums and recordings (back every Friday 17:00 UTC, `back` in the reader's time); the songs
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
    $("home-sub").textContent = homeQuestion(); $("home-sub").classList.remove("home-sub-long");
    document.body.classList.toggle("is-pro", isPro());
    isPro() ? show($("greeting-pro")) : hide($("greeting-pro"));
    $("menu-plans-label").textContent = isPro() ? "My membership" : "Plans & billing";
    renderOfferBanner(); // free accounts only: it goes the moment the account is Pro
    // Until a kind is picked, the picker shows what the tab showing would send (defaultKind).
    if (!guest && !chosenKind()) selectKind(defaultKind(sourceShowing()));
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
    if (guest || !tokens()) return Promise.resolve();
    usageAskedAt = Date.now();
    var at = epoch;
    return request("/api/billing/my-subscription").then(function (s) {
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
    // Beside the account, so Home's strip and the plans' prices are ready with it (the seasonal offer, below).
    readOffer();
    return loadAccount().then(function () {
      // The API refused the session while the account loaded: the sign-in screen is already up.
      if (!tokens()) { showAuth(); return; }
      var wasGuest = guest;
      guest = false;
      // The practice chip's place, until its numbers come (loadPracticeChip, below).
      if ($("practice-chip").classList.contains("hidden")) show($("practice-slot"));
      hide($("boot-skel")); leaveAuth(); hide($("guest-bar")); show($("view-app")); show($("top-nav")); showTabbar(true); showAccountUi(true); setView("transcribe"); libraryCache = null;
      warmEngraver();
      document.body.classList.remove("guest"); hide($("topbar-signin")); show($("recents"));
      fetchLibrary().catch(function () { return []; });
      // Signed in from a choir invite (or already signed in when it was opened): join now.
      maybeJoinFromInvite();
      var upgradeTo = new URLSearchParams(location.search).get("upgrade");
      // The offer's email button (?offer=<key>&m=<token>), or the pricing page's card during an offer (&offer=<key>).
      var fromOffer = offerLinkKey;
      // Handled once: the checkout leaves this tab, and Back must not land on a page that starts it again.
      if (upgradeTo) dropParam("upgrade");
      if (fromOffer) { dropParam("offer"); dropParam("m"); }
      if ((upgradeTo && (!isPro() || upgradeTo === "choir")) || fromOffer) {
        // The plans open once the offer's answer is in (at most 4 s), at the prices that apply: the offer's, or the usual
        // ones with the line that says it has ended.
        var opening = epoch;
        offerSettled().then(function () {
          offerLinkKey = null;
          if (opening !== epoch || !tokens()) return;
          // "choir": the pricing page's choir line, which opens the choir plans (a Pro member's too) rather than a checkout.
          var choirPick = upgradeTo === "choir";
          var want = upgradeTo && upgradeTo !== "1" && !choirPick ? upgradeTo : null;
          if (isPro()) { openUpgrade(choirPick ? "choir" : "offer"); return; }
          if (fromOffer) track("Offer: opened from a link", fromOffer);
          openUpgrade(fromOffer ? "offer" : choirPick ? "choir" : null, null, want);
          // A plan picked at an offer's price whose offer has ended by now: the plans, never a checkout at a price the
          // person was not shown.
          if (want && !(fromOffer && !offerLive())) autoCheckout(want);
        });
      }
      // Back from checkout (the provider's return page adds ?paid=1), or a checkout started here not long ago.
      // Only the provider's return says a payment was made; otherwise the check runs out of sight.
      var paidReturn = !!new URLSearchParams(location.search).get("paid");
      if (paidReturn || readCheckout()) watchPayment(!paidReturn, paidReturn || cameBack());
      // A notification's link (/app?job=<id>): the finished sheet, or why it failed.
      var jobToOpen = new URLSearchParams(location.search).get("job");
      if (jobToOpen) { dropParam("job"); openJob(jobToOpen); }
      // A link to a view (/app?view=practice, or a reload on the Library): that view, once signed in.
      var viewToOpen = viewAsked; viewAsked = null;
      if (["library", "practice", "account"].indexOf(viewToOpen) !== -1) setView(viewToOpen);
      loadPracticeChip();
      // A recording that did not get in last time (a closed tab, a lost connection) is offered again.
      if (!readCheckout()) readKeptTake().then(function (k) { if (k && !submitting) offerResend(k, "A recording from earlier didn't send. It's kept on this browser.", "info"); });
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
    hide($("boot-skel")); leaveAuth(); show($("view-app")); show($("guest-bar")); hide($("upgrade-panel")); hide($("top-nav")); showTabbar(false); showAccountUi(false); setView("transcribe");
    warmEngraver();
    document.body.classList.add("guest"); show($("topbar-signin"));
    $("greeting").textContent = greeting(""); $("home-sub").textContent = "Your free preview is on its way. Create a free account to keep transcribing.";
    $("home-sub").classList.add("home-sub-long"); // two lines: read from the left (app.css)
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
  var linkInfo = { url: null, card: null, timer: null, seq: 0, pending: false, slow: false, sending: false, wanted: null };
  function clearLinkCard() {
    linkInfo.seq++; // an answer still on its way is for a link no longer in the box
    if (linkInfo.card) linkInfo.card.destroy();
    linkInfo.card = null; linkInfo.url = null; linkInfo.pending = false; linkInfo.slow = false; $("link-section").innerHTML = "";
    syncLinkSubmit();
  }
  /** Transcribe waits while the song is being looked up (for GRACE_MS at most) and while a link is being sent. */
  function syncLinkSubmit() { $("link-submit").disabled = (linkInfo.pending && !linkInfo.slow) || linkInfo.sending; }
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
      // A lookup that runs on stops holding Transcribe; pressed meanwhile, the song goes now, from the start.
      setTimeout(function () {
        if (seq !== linkInfo.seq || !linkInfo.pending) return;
        linkInfo.slow = true; syncLinkSubmit();
        looking.textContent = "Still finding the song… Transcribe takes it from the start.";
        if (linkInfo.wanted === found.url) { linkInfo.wanted = null; clearLinkCard(); submitLink(found.url); }
      }, window.NfSongLink.GRACE_MS);
      request(guest ? "/api/preview/link/info" : "/api/transcriptions/link/info", { method: "POST", anonymous: guest, body: { url: found.url } })
        .then(function (info) {
          if (seq !== linkInfo.seq) return;
          host.innerHTML = "";
          linkInfo.card = window.NfRangePicker.card(host, info, { allowance: allowanceLine(info.maxSeconds) });
        })
        .catch(function (err) {
          if (seq !== linkInfo.seq) return;
          host.innerHTML = "";
          if (window.NfSongLink.notNow(err.code)) { linkHint(window.NfSongLink.NOT_NOW); return; }
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
    if (!raw) { linkHint(window.NfSongLink.hint()); $("link-url").focus(); return; }
    var found = window.NfSongLink.extract(raw);
    if (!found) { linkHint(window.NfSongLink.hint(raw)); $("link-url").focus(); return; }
    $("link-url").value = found.url; linkHint("");
    // The song's card comes first, so the part to transcribe is seen and picked before it is sent; a lookup
    // still going after GRACE_MS (`slow`) no longer holds it: its late answer is dropped and the song goes from the start.
    if (linkInfo.url !== found.url || (linkInfo.pending && !linkInfo.slow)) { linkInfo.wanted = found.url; if (linkInfo.url !== found.url) lookupLink(true); return; }
    if (linkInfo.pending) clearLinkCard();
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
    track(guest ? "Preview started (link)" : "Song link submitted");
    if (!again && window.NfMeter) track(window.NfMeter.eventName(body.timeSignature));
    var following = !!follow, before = current;
    request(guest ? "/api/preview/link" : "/api/transcriptions/link", { method: "POST", anonymous: guest, body: body })
      .then(function (job) {
        if (again && doneMeanwhile(before)) return;
        if (!again) { clearLinkCard(); $("link-url").value = ""; resetMeter(); }
        startJob(job, guest ? "preview" : "link", "link", function () { sendLink(body, true); });
      })
      .catch(function (err) {
        track("Song link failed", (guest ? "preview · " : "") + failCode(err));
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
  /**
   * Until someone picks, the one default for where the audio comes from, used both for what the picker shows and
   * for what is sent (they used to differ: a free account's file showed "Voice with instruments" and went as a voice,
   * a Pro take showed it and went as a hum). A take is a voice; a file is a song where songs are open.
   */
  function defaultKind(source) { return source === "record" || !songsOpen() ? "hum" : "song"; }
  /** The kind a submission goes as: the person's choice, else the default for where the audio came from. */
  function uploadKind(fromMic) { var k = chosenKind() || defaultKind(fromMic ? "record" : "upload"); selectKind(k); return k; }
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
  /** What a kind does, said under the kinds when it needs saying (board n-ux-low V1f); the voice kinds say it already. */
  var KIND_HINTS = {
    choir: "Soprano, alto, tenor and bass come back as they were sung.",
    chords: "Piano or guitar: the chords as they were played, with the top line as the tune."
  };
  /** A choir with instruments behind it, and the keyboard's transpose, only where they apply (or are set). */
  function renderKindOptions() {
    var kind = checkedKind();
    kind === "choir" ? show($("choir-band-row")) : hide($("choir-band-row"));
    var kb = kind === "chords" || kbTranspose() !== 0;
    kb ? show($("kb-row")) : hide($("kb-row"));
    kb ? show($("kb-hint")) : hide($("kb-hint"));
    $("kind-hint").textContent = KIND_HINTS[kind] || "";
    KIND_HINTS[kind] ? show($("kind-hint")) : hide($("kind-hint"));
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
    var tab = document.querySelector(".source-tab[aria-selected=true]"), source = tab && tab.getAttribute("data-source");
    // A sheet is one tune whatever the picker says (submitAudio): it costs what a hum does.
    var link = source === "link", kind = source === "sheet" ? "hum" : checkedKind();
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
    var weekly = "Hums and recordings use your " + u.total + " free transcriptions a week. They come back each week, next on " + u.back + ".";
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
    // Used up: neutral, with a clock for its shape (amber is Pro's alone, board n-ux-low V1i).
    if (cost.out) $("cost-chip").insertAdjacentHTML("afterbegin", '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-clock"/></svg>');
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
  function submitAudio(file, name, fromMic, again, meter, costChecked, sheet) {
    // One recording goes up at a time: a second drop or take while the first is uploading is ignored.
    if (submitting) return Promise.resolve();
    // Told by the picker, or read off the file (a kept take sent again, Try again).
    if (sheet === undefined) sheet = !fromMic && isSheet({ type: file.type, name: name });
    sfx.prime(); // from the click that sent it: the chime for a job that finishes out of sight can play
    // On a free account whose chip already says this one cannot go (the week's free ones used, or a song with nothing
    // to pay for it), the plans come first and the take is kept for after (keepTake, songBought), rather than a whole
    // upload over 3G only to be refused. The count is read again first, in case the week has turned since.
    // (A sheet is a tune whatever the picker shows, so the picker's cost is not its cost: the server decides.)
    if (!again && !costChecked && !guest && !isPro() && !sheet) {
      uploadKind(fromMic);
      var cost = studioCost();
      if (cost && cost.out) {
        return refreshUsage().then(function () {
          var still = studioCost();
          if (!still || !still.out || isPro()) return submitAudio(file, name, fromMic, false, undefined, true, sheet);
          keepTake(file, name, fromMic, chosenMeter());
          openUpgrade("limit", still.text + ". Your recording is kept, and goes once it's paid for.");
        });
      }
    }
    // Read once: "Try again" sends the meter this recording went with, not what the box says now.
    // A sheet's meter is the page's own, so none is sent with it.
    if (!again) meter = sheet ? null : chosenMeter();
    // A sheet is read, not heard: one tune, never separated, whatever the picker says.
    var kind = sheet ? "hum" : uploadKind(fromMic), song = !sheet && (kind === "song" || (kind === "choir" && $("choir-band").checked));
    var form = new FormData();
    form.append("audio", file, name);
    // A choir in parts keeps every voice; chords keep the harmony, with the top line as the tune; anything else is one line.
    form.append("mode", kind === "choir" ? "choir" : kind === "chords" ? "chords" : "melody");
    // A song with a band behind the voice (or the voices) is separated first; a hummed tune is not.
    form.append("separate", song ? "true" : "false");
    // The sheet in the keys pressed on a transposed keyboard: always sent for chords, otherwise only when set.
    if (!sheet && (kind === "chords" || kbTranspose() !== 0)) form.append("keyboardTranspose", String(kbTranspose()));
    if (meter) form.append("timeSignature", meter);
    // The browser renders its own playback from the notes: the server's piano WAV (about
    // 10 MB and nine seconds of synthesis for a three-minute song) is not wanted here.
    form.append("audioPreview", "false");
    hide($("app-alert"));
    track(guest ? "Preview started (audio)" : sheet ? "Sheet music uploaded" : song ? "Song uploaded" : kind === "choir" ? "Choir uploaded" : kind === "chords" ? "Chords uploaded" : "Tune uploaded");
    if (!again && window.NfMeter) track(window.NfMeter.eventName(meter));
    // The recording's own journey up is the first stage on the card, with a real percentage. When a
    // job is still being followed (Try again), that card is left alone and the button carries the count.
    var following = !!follow, before = current;
    if (!following) {
      openProgress(sheet ? "Uploading your sheet music" : "Uploading your recording");
      setStage("uploading", "upload", null, song);
    }
    function onProgress(fraction) {
      if (following) $("p-retry-btn").textContent = "Sending again… " + Math.round(fraction * 100) + "%";
      else setPercent(fraction * UPLOAD_SHARE);
    }
    submitting = true;
    var at = epoch;
    return upload(guest ? "/api/preview" : "/api/transcriptions", form, { anonymous: guest, onProgress: onProgress })
      .then(function (job) {
        if (at !== epoch) return; // signed out while it went up
        submitting = false;
        forgetTake();
        if (again && doneMeanwhile(before)) return;
        if (!again) resetMeter();
        startJob(Object.assign({}, job, { stage: job.stage || "queued", fileName: fromMic ? null : name, separates: song }), guest ? "preview" : "upload", "upload", function () { submitAudio(file, name, fromMic, true, meter); });
      })
      .catch(function (err) {
        if (at !== epoch) return;
        submitting = false;
        track("Upload failed", (guest ? "preview · " : "") + failCode(err));
        if (following) resetRetry();
        else { hide($("progress")); if (current && current.result) show($("result")); }
        keepTake(file, name, fromMic, meter);
        // A failure on the way (no connection, a server fault, too many at once) can simply go again; a refusal
        // (the week's free ones, a song not paid for) waits for the purchase, which sends it on (songBought).
        if (!following && (!err.status || err.status === 408 || err.status === 429 || err.status >= 500)) {
          sfx.play("error");
          offerResend({ blob: file, name: name, fromMic: fromMic, meter: meter }, "Couldn't send it. Your take is kept. " + (err.message || ""));
          return;
        }
        explain(err);
      });
  }
  /**
   * A take or file that did not get in is kept on this browser (IndexedDB) until it goes (board l-ux-high/06e):
   * a failed send offers "Send it again", a song paid for after a refusal sends it on, and a reload or a later visit
   * still has it. It used to be gone with the error, and the singing with it.
   */
  var KEPT_DB = "nf-kept-take", KEPT_FOR_MS = 6 * 60 * 60 * 1000;
  function keptStore(mode, op) {
    return new Promise(function (resolve) {
      try {
        var open = indexedDB.open(KEPT_DB, 1);
        open.onupgradeneeded = function () { open.result.createObjectStore("take"); };
        open.onerror = function () { resolve(null); };
        open.onsuccess = function () {
          try {
            var db = open.result, tx = db.transaction("take", mode), req = op(tx.objectStore("take"));
            tx.oncomplete = function () { db.close(); resolve(req ? req.result : null); };
            tx.onerror = tx.onabort = function () { db.close(); resolve(null); };
          } catch (e) { resolve(null); }
        };
      } catch (e) { resolve(null); }
    });
  }
  function keepTake(file, name, fromMic, meter) {
    keptStore("readwrite", function (st) { return st.put({ blob: file, name: name, fromMic: !!fromMic, meter: meter || null, at: Date.now() }, "last"); });
  }
  function forgetTake() { keptStore("readwrite", function (st) { return st.delete("last"); }); }
  function readKeptTake() {
    return keptStore("readonly", function (st) { return st.get("last"); })
      .then(function (k) { return k && k.blob && Date.now() - k.at < KEPT_FOR_MS ? k : null; });
  }
  function sendKept(k) { forgetTake(); setView("transcribe"); submitAudio(k.blob, k.name, k.fromMic, true, k.meter); }
  /** "Send it again" under a note in the studio's alert. */
  function offerResend(k, note, kind) {
    alertIn($("app-alert"), kind || "danger", note);
    var again = document.createElement("button");
    again.type = "button"; again.className = "btn btn-primary btn-sm alert-action"; again.textContent = "Send it again";
    again.addEventListener("click", function () { hide($("app-alert")); sendKept(k); });
    $("app-alert").appendChild(again);
  }
  /**
   * A file the server would refuse, said before it is sent: over 25 MB (the API's limit) or not audio at all.
   * Over 3G the whole file used to go up first, only to come back refused.
   */
  var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  /** A photo or PDF of printed music: read off the page by the worker, never listened to. */
  function isSheet(file) {
    return /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type || "") || /\.(jpe?g|png|webp|pdf)$/i.test(file.name || "");
  }
  function fileProblem(file) {
    if (file.size > MAX_UPLOAD_BYTES) return "That file is over 25 MB. Choose a shorter recording, or one saved as MP3 or M4A.";
    if (isSheet(file)) return guest ? "Create a free account to turn a photo of sheet music into solfa." : null;
    var audio = /^(audio\/|video\/(mp4|quicktime)$)/.test(file.type || "") || /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|webm|mp4|mov)$/i.test(file.name || "");
    return audio ? null : "That doesn't look like a recording. Choose an MP3, WAV, M4A, FLAC, OGG or WebM file, or a video.";
  }
  function submitFile(file) {
    var problem = fileProblem(file);
    if (problem) { alertIn($("app-alert"), "info", problem); return; }
    submitAudio(file, file.name, false, false, undefined, false, isSheet(file));
  }
  ["file-input", "sheet-input"].forEach(function (id) {
    $(id).addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      submitFile(file);
      e.target.value = "";
    });
  });
  // ── Where the music comes from: Record, Upload, a Song link or Sheet music, one panel at a time ──
  // The three used to stack in one block with the recording options between them; asking one thing
  // at a time is calmer, and the last choice is kept for the next visit. Sheet music (a photo or PDF of
  // printed music) was a button under Upload's drop box, where nobody found it: it is a tab of its own.
  var SOURCE_KEY = "nf.web.source", SOURCES = ["record", "upload", "link", "sheet"];
  function sourceShowing() { var on = SOURCES.filter(function (s) { return !$("src-" + s).hidden; })[0]; return on || "record"; }
  function selectSource(name, focus) {
    if (SOURCES.indexOf(name) < 0) name = "record";
    SOURCES.forEach(function (s) {
      var tab = $("src-tab-" + s), on = s === name;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      $("src-" + s).hidden = !on;
    });
    // What is in the recording matters for a recording or a file, not for a link or a page; Transcribe is the link's
    // own action; a page says its own beats in a bar.
    $("kind-block").hidden = name === "link" || name === "sheet";
    $("meter-block").hidden = $("meter-hint").hidden = name === "sheet";
    $("link-submit").hidden = name !== "link";
    // Until someone picks, the picker shows what this tab sends (defaultKind).
    if (!chosenKind() && name !== "link" && name !== "sheet") selectKind(defaultKind(name));
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
  // ?source=sheet (the home page's, the tools' and the blog's links) opens that tab, and is kept like a tap on it, so a
  // visitor who signs up first lands on it.
  selectSource(new URLSearchParams(location.search).get("source")
    || (function () { try { return localStorage.getItem(SOURCE_KEY); } catch (e) { return null; } })() || "record");
  // A file dragged over the studio is an upload, whichever tab is showing; a picture or a PDF is sheet music.
  $("studio").addEventListener("dragenter", function (e) {
    var dt = e.dataTransfer;
    if (!dt || Array.prototype.indexOf.call(dt.types || [], "Files") < 0) return;
    var item = dt.items && dt.items[0];
    selectSource(item && isSheet({ type: item.type }) ? "sheet" : "upload");
  });

  ["drop", "sheet-drop"].forEach(function (id) {
    var drop = $(id);
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
    drop.addEventListener("drop", function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) submitFile(file);
    });
  });

  // ── Record a tune in the browser ─────────────────────────────────────────
  // The same recording pop-up as the home page (assets/recorder.js): the level meter and the
  // clock while the microphone is open, then the take to listen back to. Nothing is sent
  // until it has been approved.
  function openRecorder() {
    $("rec-status").textContent = "";
    window.NfRecorder.open({
      maxSeconds: guest ? 30 : 180, // a guest gets the same thirty seconds as on the home page
      track: track,
      sounds: function (name) { sfx.play(name); },
      onError: function (text, kind) { track("Recording problem", kind || null); $("rec-status").textContent = kind === "short" ? text : text + " Upload a file instead."; },
      onTake: function (blob, name) { submitAudio(blob, name, true); }
    });
  }
  $("rec-btn").addEventListener("click", openRecorder);
  /**
   * The tab bar's Record, from any tab: the studio with the recorder open over it. While a recording is going up or a job
   * runs, its card instead (a second take then would be sent as that job's "Try again"); a sheet showing steps aside for
   * the studio, as New transcription does (it is in the library).
   */
  $("tab-record").addEventListener("click", function () {
    track("Tab: record");
    if (viewNow !== "transcribe") goView("transcribe");
    if (submitting || follow) { $("progress").scrollIntoView({ behavior: glide(), block: "start" }); return; }
    if (!$("result").classList.contains("hidden")) newTranscription();
    selectSource("record");
    openRecorder();
  });

  function explain(err) {
    var text = err.message || "Something went wrong.";
    if (err.code === "BILLING_SONG_PREVIEW_USED" || err.code === "BILLING_FREE_TIER_LIMIT" || err.code === "BILLING_SONG_NOT_FREE") {
      hide($("app-alert"));
      openUpgrade("limit", text);
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
    // A push while this page is in front: the job on the card is read now rather than when its stream says so.
    if (current && current.jobId === msg.jobId) { if (follow) readJob(follow); return; }
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
    request("/api/transcriptions/jobs/" + encodeURIComponent(jobId) + "?backing=false").then(function (job) {
      startJob({ jobId: jobId, stage: job && job.stage, queuePosition: job && job.queuePosition, source: job && job.source }, "job");
    }, function (err) {
      alertIn($("app-alert"), "info", err.status === 404 ? "That transcription isn't available any more." : err.message);
    });
  }
  /**
   * The job on the card rides in the address (?job=<id>, which boot() opens), so a reload, or a closed tab brought
   * back, finds it running or finished instead of an empty studio. A new transcription or a saved sheet drops it.
   */
  function rememberJob(jobId) {
    try {
      var u = new URL(location.href);
      jobId ? u.searchParams.set("job", jobId) : u.searchParams.delete("job");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch (e) { /* only the address; nothing depends on it */ }
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
  // A switch's whole row turns it, not only the small switch at its end; the switch keeps the focus and says the state.
  document.querySelectorAll("#view-account .lrow").forEach(function (row) {
    var sw = row.querySelector(".switch");
    if (!sw) return;
    row.classList.add("lrow-switch");
    row.addEventListener("click", function (e) { if (!sw.contains(e.target) && !sw.disabled) sw.click(); });
  });

  // ── Progress ─────────────────────────────────────────────────────────────
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
  /**
   * For a recording, the upload is the bar's first stretch and the job the rest, so the bar runs once from 0 to 100
   * (it used to fill for the upload, then drop back to nothing as the job began).
   */
  var UPLOAD_SHARE = 0.15;
  function jobPercent(progress) { return current && current.from === "upload" ? UPLOAD_SHARE + (1 - UPLOAD_SHARE) * (progress || 0) : progress; }
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
    stopFollowing();
    current = { jobId: job.jobId, kind: kind, from: from || null, retry: retry || null, source: job.source || null, fileName: job.fileName || null, result: null, startedAt: Date.now(), savedId: null, shareToken: null, lyrics: "", semitones: 0, failures: 0, seen: "", seenAt: Date.now(),
      separates: job.separates == null ? null : !!job.separates };
    openProgress(kind === "link" ? "Reading the link…" : kind === "preview" ? "Making your free preview…" : "Transcribing your recording…");
    current.preview = kind === "preview";
    if (current.preview) previewId = job.jobId; else rememberJob(job.jobId);
    setStage(stageOf(job, kind === "link" ? "fetching" : "transcribing"), current.from, job.queuePosition, current.separates);
    setPercent(jobPercent(0));
    primeAudio();
    follow = {
      jobId: job.jobId, ctrl: null, away: false, timer: null, clock: null, noStream: !streamable(), streamFails: 0, authRetries: 0,
      fallback: false, ended: false, getting: false, again: false, lastByteAt: 0, lastEventAt: Date.now(), lastGetAt: 0
    };
    followView();
    // A song (or a free transcription) still running holds its place in the count: the meter shows it at once.
    if (!guest && kind !== "preview") refreshUsage();
  }

  /**
   * Lights the row and writes the plain line under the bar. A stage this page has no name for is the last one.
   * `separates` is false for a recording sent without its voice taken out (a hum, chords, a choir alone).
   */
  function setStage(stage, from, queuePosition, separates) {
    if (STAGE_ORDER.indexOf(stage) < 0) stage = "transcribing";
    var idx = STAGE_ORDER.indexOf(stage);
    document.querySelectorAll("#p-stages .stage").forEach(function (el) {
      var i = STAGE_ORDER.indexOf(el.dataset.stage);
      el.classList.remove("on", "done");
      // A recording that was uploaded is never "fetched"; a link is never "uploaded".
      if (el.dataset.stage === "uploading") (from === "upload" ? show : hide)(el);
      if (el.dataset.stage === "fetching") (from === "upload" ? hide : show)(el);
      // Nor is a hum "isolated": only a song's voice is taken out of its band (unless the worker says it is doing so).
      if (el.dataset.stage === "separating") (separates === false && stage !== "separating" ? hide : show)(el);
      if (i < idx) el.classList.add("done");
      if (i === idx) el.classList.add("on");
    });
    var text = STAGE_COPY[stage];
    if (stage === "queued" && queuePosition > 0) text += " · " + queuePosition + " ahead";
    // Written only when it changes: the line is aria-live, and an update that found nothing new should say nothing.
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

  // ── Following a job: the API's event stream, not a poll (assets/sse.js) ──
  // `ready` says the stream is subscribed, and the job is read once; `job` is its progress; `ended` says it finished,
  // and it is read once more for the outcome. In view the stream is a plain one: the API sends no push for a job
  // whose end it delivered, because the page shows it. Out of view it is an away stream (?away=true), which the API
  // does not count as someone looking, so the push still goes, and the page gives its own cues too (the title, the
  // chime, its notification under the push's nf-job-<id> tag, so the two are one). In view, a browser that cannot
  // read a stream, or a stream that keeps failing, reads the job every 10 s instead, and a stream quiet for 90 s gets
  // one read to be sure; out of view there are no such reads.
  var FALLBACK_POLL_MS = 10 * 1000, QUIET_CHECK_MS = 90 * 1000, STREAM_SILENT_MS = 45 * 1000, CLOCK_MS = 5 * 1000, FALLBACK_AFTER = 3;
  function streamable() { return !!(window.fetch && window.ReadableStream && window.TextDecoder && window.AbortController && window.NfSse); }
  function inView() { return document.visibilityState !== "hidden"; }
  function jobPath(jobId) { return (current.preview ? "/api/preview/jobs/" : "/api/transcriptions/jobs/") + encodeURIComponent(jobId); }

  function stopFollowing() {
    var f = follow;
    follow = null;
    if (!f) return;
    closeStream(f);
    clearTimeout(f.timer); f.timer = null;
    clearInterval(f.clock); f.clock = null;
  }
  function closeStream(f) {
    var ctrl = f.ctrl;
    f.ctrl = null;
    if (ctrl) { try { ctrl.abort(); } catch (e) { /* already closed */ } }
  }
  /**
   * The stream this tab's view wants: a plain one in view, an away one out of it, swapped at once when the view
   * changes. A job told to have ended, or a browser without streams, is read every 10 s instead, in view only.
   */
  function followView() {
    var f = follow;
    if (!f) return;
    if (!f.clock) f.clock = setInterval(function () { tick(f); }, CLOCK_MS);
    if (inView()) reviewWait();
    if (f.noStream || f.ended) { f.fallback = true; if (inView()) readJob(f); return; }
    if (f.ctrl && f.away === !inView()) return;
    closeStream(f);
    if (f.fallback && inView()) readJob(f);
    openStream(f);
  }
  document.addEventListener("visibilitychange", followView);
  window.addEventListener("pageshow", function (e) { if (e.persisted) followView(); });

  /**
   * Every few seconds: a stream gone silent is opened again; in view, also the lines under the bar and the reads a
   * quiet or missing stream needs. Out of view the away stream alone follows the job, and the push covers the person.
   */
  function tick(f) {
    if (follow !== f) return;
    var now = Date.now();
    if (f.ctrl && now - f.lastByteAt > STREAM_SILENT_MS) { closeStream(f); streamFailed(f, 0); return; }
    if (!inView()) return;
    reviewWait();
    // Half a tick early is on time: the clock's own drift would otherwise push every read to the tick after.
    var since = f.fallback ? now - f.lastGetAt : now - Math.max(f.lastEventAt, f.lastGetAt);
    if (since >= (f.fallback ? FALLBACK_POLL_MS : QUIET_CHECK_MS) - CLOCK_MS / 2) readJob(f);
  }

  function openStream(f) {
    if (follow !== f || f.ctrl || f.noStream || f.ended) return;
    clearTimeout(f.timer); f.timer = null;
    var ctrl = new AbortController(), anonymous = current.preview && guest, subscribed = false;
    f.away = !inView();
    var headers = baseHeaders();
    headers.Accept = "text/event-stream";
    if (!anonymous) {
      var t = tokens();
      if (t && t.accessToken) headers.Authorization = "Bearer " + t.accessToken;
    }
    f.ctrl = ctrl; f.lastByteAt = Date.now();
    /** Still this page's stream: not let go of (hidden, stopped, reconnecting) since it was opened. */
    function mine() { return follow === f && f.ctrl === ctrl; }
    fetch(API + jobPath(f.jobId) + "/events" + (f.away ? "?away=true" : ""), { headers: headers, signal: ctrl.signal, cache: "no-store" })
      .then(function (r) {
        if (!mine()) return;
        if (r.status === 401 && !anonymous && f.authRetries < 1) {
          f.ctrl = null; f.authRetries++;
          return refresh().then(function () { openStream(f); }, function (err) {
            if (err && err.status === 401) { sessionEnded(); return; }
            streamFailed(f, 0);
          });
        }
        if (!r.ok || !r.body) { f.ctrl = null; streamFailed(f, r.status); return; }
        var reader = r.body.getReader(), decoder = new TextDecoder(), parse = window.NfSse.parser();
        function pump() {
          return reader.read().then(function (chunk) {
            if (!mine()) return;
            if (chunk.done) { f.ctrl = null; streamClosed(f, subscribed); return; }
            f.lastByteAt = Date.now();
            var events = parse.feed(decoder.decode(chunk.value, { stream: true }));
            for (var i = 0; i < events.length && mine(); i++) {
              if (events[i].event === "ready") subscribed = true;
              heard(f, events[i]);
            }
            if (mine()) return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        if (!mine()) return; // let go of on purpose
        f.ctrl = null;
        streamFailed(f, 0);
      });
  }

  /** One event off the stream. The outcome is never taken from an event: the job is read for it. */
  function heard(f, e) {
    if (e.event === "ready") {
      f.streamFails = 0; f.authRetries = 0; f.fallback = false;
      current.failures = 0; hide($("p-offline"));
      readJob(f);
      return;
    }
    if (e.event === "job") {
      var job = window.NfSse.json(e);
      if (!job) return;
      f.lastEventAt = Date.now();
      var status = String(job.status || "").toLowerCase();
      if (status === "done" || status === "failed") { readJob(f); return; }
      render(job);
      reviewWait();
      return;
    }
    if (e.event === "ended") {
      f.lastEventAt = Date.now();
      f.ended = true;
      closeStream(f);
      readJob(f);
    }
  }

  /** The stream would not open, or broke: open it again after a wait; after three in a row, in view, read the job every 10 s meanwhile. */
  function streamFailed(f, status) {
    if (follow !== f) return;
    f.streamFails++;
    // No answer at all is the connection; an answer (a 5xx, a 429) is the API, which a read would say for itself.
    if (status === 0) {
      current.failures++;
      if (current.failures >= OFFLINE_AFTER) show($("p-offline"));
    }
    if (f.streamFails >= FALLBACK_AFTER && !f.fallback) { f.fallback = true; if (inView()) readJob(f); }
    clearTimeout(f.timer);
    f.timer = setTimeout(function () { f.timer = null; openStream(f); }, window.NfSse.reconnectDelay(f.streamFails));
  }
  /** The API closed the stream (its ten minutes are up, or it restarted): open it again at once, unless it never said ready. */
  function streamClosed(f, subscribed) {
    if (follow !== f) return;
    if (!subscribed) { streamFailed(f, null); return; }
    clearTimeout(f.timer);
    f.timer = setTimeout(function () { f.timer = null; openStream(f); }, window.NfSse.RECONNECT_MS[0]);
  }

  /** What a read or an event says about the job so far: its song, its stage, the bar and the line ahead. */
  function render(job) {
    if (job.source) {
      current.source = job.source;
      $("p-title").textContent = job.source.title || "Untitled";
      $("p-artist").textContent = job.source.artist || "";
      if (job.source.thumbnailUrl) { $("p-thumb").src = job.source.thumbnailUrl; show($("p-thumb")); }
    }
    var stage = stageOf(job, "transcribing"), progress = job.progress || 0;
    setStage(stage, current.from, job.queuePosition, current.separates);
    setPercent(jobPercent(progress));
    // Something moved: the stage, the bar or the line ahead. Otherwise the clock keeps running.
    var seen = stage + "|" + Math.round(progress * 100) + "|" + (job.queuePosition == null ? "" : job.queuePosition);
    if (seen !== current.seen) { current.seen = seen; current.seenAt = Date.now(); }
  }

  /** Reads the job once: on `ready`, on `ended`, after a push, and on the fallback's clock. One read at a time. */
  function readJob(f) {
    if (follow !== f) return;
    if (f.getting) { f.again = true; return; }
    f.getting = true; f.lastGetAt = Date.now();
    var jobId = f.jobId, at = epoch;
    /** The reply is still wanted: nobody signed out meanwhile and this is still the job on the card. */
    function wanted() { return at === epoch && (guest || !!tokens()) && follow === f && !!current && current.jobId === jobId; }
    // Without the backing's audio in it: the sheet opens at once and the audio comes on its own (loadBacking). A preview,
    // and an API from before that, carry it inline as they always did.
    request(jobPath(jobId) + (current.preview ? "" : "?backing=false"), { anonymous: current.preview && guest }).then(function (job) {
      if (!wanted()) return;
      current.failures = 0; hide($("p-offline"));
      render(job);
      var status = String(job.status || "").toLowerCase();
      if (status === "done" && job.result) {
        stopFollowing();
        current.result = job.result;
        // Filed in the Library the moment it finished (LibraryFiling): the page says so, and Save keeps the edits made
        // here by replacing that copy. Seeing it counts as opening it, as on the phone.
        if (!guest && job.savedId) {
          current.filedId = job.savedId; current.filedTitle = job.savedTitle || ""; libraryCache = null;
          request("/api/library/" + encodeURIComponent(job.savedId) + "/opened", { method: "POST" }).catch(function () { /* only the Library's new-sheet dot */ });
        }
        hide($("progress"));
        announce("ready");
        track(current && current.kind === "preview" ? "Preview ready" : "Sheet ready");
        if (current.from === "link" && !current.preview) track("Song link transcribed");
        // One preview a device: the try box says so next time, before anything is recorded (assets/preview.js).
        if (current.preview && guest) { try { localStorage.setItem("nf.web.previewUsed", "1"); } catch (e) { /* private mode */ } }
        showResult(job.result);
        if (current.filedId) alertIn($("app-alert"), "success", "Saved to your Library as “" + (current.filedTitle || "your recording") + "”. Lyrics or a new doh added here are kept when you press Save changes.");
        keepClaimedPreview();
        if (!guest) loadAccount();
        return;
      }
      if (status === "failed") {
        stopFollowing();
        hide($("progress"));
        var failed = job.error && !TECHNICAL.test(job.error) ? job.error
          : current.from === "link" ? "That link could not be transcribed." : "That could not be transcribed. Try a cleaner recording or a different link.";
        // A link that fails is most often a download YouTube refused: the way round is the file itself.
        if (current.from === "link" && !/upload/i.test(failed)) failed += " YouTube sometimes blocks our downloads; upload the audio file instead.";
        announce("failed", failed);
        track("Transcription failed", (current.preview ? "preview · " : "") + (current.from || current.kind || "job") + (job.errorCode ? " · " + job.errorCode : ""));
        alertIn($("app-alert"), "danger", failed);
        if (/upload/i.test(failed)) addUploadInstead($("app-alert"));
        // A failed job costs nothing: the place it held comes back.
        if (!guest) refreshUsage();
        return;
      }
      reviewWait();
      // Said to have ended, or done without its sheet, yet not finished here: nothing more comes on a stream, so it is read every 10 s.
      if (f.ended || status === "done") f.fallback = true;
    }).catch(function (err) {
      if (err.status === 401) { stopFollowing(); return; }
      if (!wanted()) return;
      // Whatever the API or the network said stays in the console; the card gets one plain line.
      current.failures++;
      if (current.failures >= OFFLINE_AFTER) show($("p-offline"));
      reviewWait();
    }).then(function () {
      f.getting = false;
      if (f.again && follow === f) { f.again = false; readJob(f); }
    });
  }

  // ── Result ───────────────────────────────────────────────────────────────
  function providerName(p) { return { youtube: "YouTube", spotify: "Spotify", apple_music: "Apple Music", instagram: "Instagram", tiktok: "TikTok" }[p] || p; }

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
          : result.source
            ? "Free preview: the first minute of a " + formatSec(result.songDurationSec) + " song. Upgrade to Pro for the whole song and the download."
            // A free account's file is read for three minutes; Pro reads six.
            : "This recording runs " + formatSec(result.songDurationSec) + "; the first three minutes were transcribed. Pro transcribes up to six minutes.");
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
    renderFixUndo();
    renderSave();

    isPro() ? hide($("r-watermark")) : show($("r-watermark"));
    // A free sheet's way to Pro is one row under it; the plans themselves are the dialog's.
    isPro() ? hide($("r-upgrade")) : (renderUnlock(result), show($("r-upgrade")));
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
      b.innerHTML = (b.id === "dl-pdf" ? '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-download"/></svg>' : "") + text + (isPro() || b.id === "dl-pdf" ? "" : ' <svg class="ic lock" role="img" aria-label="Pro"><use href="/assets/icons.svg#i-lock"/></svg>');
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
    window.scrollTo({ top: 0, behavior: glide() });
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
    offerUndo($("r-doh"), C.keyHeader(alt.key) + " now: the notes are written in its scale.", function () {
      current.dohAnswered = false; current.result = r; showResult(r);
    });
  }
  /**
   * A choice that rewrote the notes (another doh, the hymnbook's version) is said in the box that asked, with Undo
   * putting the sheet back as it was and the question with it. Gone once the sheet is saved.
   */
  function offerUndo(box, text, undo) {
    box.innerHTML = "";
    var said = document.createElement("span"); said.textContent = text;
    var row = document.createElement("span"); row.className = "doh-choices";
    var b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-sm btn-ghost"; b.textContent = "Undo";
    b.addEventListener("click", function () { hide(box); track("Undid a sheet choice"); undo(); });
    row.appendChild(b); box.appendChild(said); box.appendChild(row);
    show(box);
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
      // Each answer says what it does, so neither needs the question read again to be sure.
      choice("Use the hymnbook version", true, function () { pickHymn(m); });
      choice("Keep mine", false, function () { current.hymnAnswered = true; track("Kept transcription over hymnbook", m.slug); showResult(current.result); });
    } else {
      choice("Dismiss", false, function () { current.hymnAnswered = true; hide(box); });
    }
    box.appendChild(text);
    box.appendChild(row);
    show(box);
    if (!current.hymnShown) { current.hymnShown = true; track("Hymn recognised", m.slug); }
  }

  function pickHymn(match) {
    var before = { result: current.result, lyrics: current.lyrics, dohAnswered: current.dohAnswered };
    current.hymnAnswered = true;
    current.dohAnswered = true;
    // The first verse goes under the notes, unless words were typed already.
    if (!(current.lyrics || "").trim() && match.lyrics) current.lyrics = match.lyrics;
    track("Took hymnbook version", match.slug);
    var next = H.swap(current.result, match), given = current.lyrics;
    current.result = next;
    showResult(next);
    offerUndo($("r-hymnbook"), "This is the hymnbook's version now, with its notes and words.", function () {
      current.hymnAnswered = false; current.dohAnswered = before.dohAnswered;
      if (current.lyrics === given) current.lyrics = before.lyrics; // words typed since are kept
      current.result = before.result; showResult(before.result);
    });
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
    var bpb = C.beatsPerBar(result.timeSignature), cellBeats = 1 / C.divisionsFor(result.notes || []);
    C.hymnRows(result.notes || [], current.lyrics, result.timeSignature).forEach(function (bars, r) {
      var table = document.createElement("table"); table.className = "hymn"; var tr = document.createElement("tr");
      bars.forEach(function (bar, b) {
        var td = document.createElement("td");
        bar.forEach(function (cell, c) {
          var span = document.createElement("span"); span.className = "cell";
          var bEl = document.createElement("b"); bEl.textContent = cell.solfa; var iEl = document.createElement("i"); iEl.textContent = cell.lyric;
          span.appendChild(bEl); span.appendChild(iEl); td.appendChild(span);
          hymnCells.push({ el: bEl, beat: (r * 4 + b) * bpb + c * cellBeats });
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
  /** Whether the player was playing at its last tick: a play is counted once, when it starts. */
  var wasPlaying = false;
  function setupRehearsal(result) {
    if (!player) {
      player = C.createPlayer();
      $("play").addEventListener("click", function () { player.toggle(); });
      $("rehearse-play").addEventListener("click", function () { player.toggle(); });
      $("restart").addEventListener("click", function () { player.stop(); player.play(); });
      $("rate").addEventListener("change", function () { player.setRate(parseFloat($("rate").value)); });
      ["loop-on", "loop-from", "loop-to"].forEach(function (id) { $(id).addEventListener("change", applyLoop); });
      player.onTick(function (t) {
        if (t.playing && !wasPlaying) track("Played sheet");
        wasPlaying = !!t.playing;
        [$("play"), $("rehearse-play")].forEach(function (b) { label(b, t.playing ? "pause" : "play", t.playing ? "Pause" : "Play"); });
        var now = -1;
        for (var i = 0; i < hymnCells.length; i++) if (hymnCells[i].beat <= t.beat + 1e-6) now = i;
        hymnCells.forEach(function (c, i) { c.el.className = t.playing && i === now ? "now" : ""; });
        practiceTick(t);
      });
    }
    var voices = rehearsalVoices(result);
    // The beats placed in the song's recording, so its backing and the notes keep one clock (assets/backing-clock.js).
    player.load({ voices: voices, tempoBpm: result.tempo, timeSignature: result.timeSignature, beatOriginSec: result.beatOriginSec, beatTimesSec: result.beatTimesSec });
    loadBacking(result);
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

  // ── The song's backing (boards o-backing O4a/O4b) ────────────────────────
  // A sheet whose song was separated from its band plays that band quietly under the solfa, in time (choir.js's player
  // on assets/backing-clock.js). One control, drawn twice — the strip just above Play and its twin in Slow & loop — with
  // the app's switch and a Solfa · Backing balance, both remembered per browser. The audio comes apart from the sheet,
  // once, as the sheet opens: the fresh job's while the API holds it, else the saved sheet's (only an upload keeps it; a
  // song from a link never does). A transposed sheet's backing sits out, with a way back to the song's key.
  var BACKING_KEY = "nf.web.backing";
  var BALANCE_DEFAULT = Math.round(((window.NfBackingClock && window.NfBackingClock.DEFAULT_BALANCE) || 0.4) * 100);
  var backingPref = null;
  function backingPrefs() {
    if (backingPref) return backingPref;
    var p = null;
    try { p = JSON.parse(localStorage.getItem(BACKING_KEY) || "null"); } catch (e) { p = null; }
    var balance = p && typeof p.balance === "number" && p.balance >= 0 && p.balance <= 100 ? Math.round(p.balance) : BALANCE_DEFAULT;
    backingPref = { on: !(p && p.on === false), balance: balance };
    return backingPref;
  }
  function setBackingPrefs(change) {
    backingPref = Object.assign({}, backingPrefs(), change);
    try { localStorage.setItem(BACKING_KEY, JSON.stringify(backingPref)); } catch (e) { /* private mode: kept for this visit */ }
  }
  /** The sheet says it has a backing (inline, or to fetch), and it has not turned out to be gone. */
  function backingHeld(result) {
    return !!result && !!(result.backingAudioBase64 || result.hasBacking === true) && !(current.backing && current.backing.gone);
  }
  /** Where the sheet's backing is asked for: the job's while it is fresh (then the copy filed from it), or the saved sheet's. */
  function backingPaths() {
    if (!current || current.preview || guest) return [];
    function saved(id) { return "/api/library/" + encodeURIComponent(id) + "/backing"; }
    if (current.kind === "library") return current.savedId ? [saved(current.savedId)] : [];
    if (!current.jobId) return [];
    var paths = ["/api/transcriptions/jobs/" + encodeURIComponent(current.jobId) + "/backing"];
    if (current.filedId) paths.push(saved(current.filedId));
    return paths;
  }
  /** Hands the player the sheet's backing: inline from a preview or an older API, else fetched once, bytes only. */
  function loadBacking(result) {
    var b = current.backing || (current.backing = { bytes: null, loading: false, gone: false });
    if (!backingHeld(result)) { player.setBacking(null); return; }
    if (!b.bytes && result.backingAudioBase64) b.bytes = base64ToBytes(result.backingAudioBase64).buffer;
    if (b.bytes) { player.setBacking(b.bytes); return; }
    player.setBacking(null);
    if (b.loading) return;
    var paths = backingPaths(), owner = current, at = epoch;
    if (!paths.length) { b.gone = true; return; }
    b.loading = true;
    (function ask(i) {
      requestBytes(paths[i]).then(function (bytes) {
        b.loading = false; b.bytes = bytes;
        if (at !== epoch || current !== owner) return;
        if (backingHeld(current.result)) player.setBacking(bytes);
        renderBacking();
      }, function (err) {
        if (err.status === 404 && i + 1 < paths.length) { ask(i + 1); return; }
        // Gone (BACKING_NOT_FOUND) or out of reach: the sheet plays as it always did, with no control for a band it lacks.
        b.loading = false; b.gone = true;
        if (at === epoch && current === owner) { renderBacking(); renderTranspose(); }
      });
    })(0);
  }
  /** "none", "unkept" (a link's: said in one line), "on" (the strip), or "out" (transposed: greyed, with the way back). */
  function backingState() {
    var r = current && current.result;
    if (!r) return "none";
    if (!backingHeld(r)) return current.fromLink || ((r.source || current.source) && current.backing && current.backing.gone) ? "unkept" : "none";
    return (current.transposedBy || 0) !== 0 ? "out" : "on";
  }
  function drawBackingControl(box, out, on, balance, backKey) {
    box.classList.toggle("is-out", out);
    var sw = box.querySelector(".bk-on");
    sw.setAttribute("aria-checked", String(on)); sw.disabled = out;
    (on ? show : hide)(box.querySelector(".bk-bal"));
    var range = box.querySelector(".bk-balance");
    if (document.activeElement !== range) range.value = String(balance);
    // The louder end in ink: at the middle both play at full.
    box.querySelector(".bk-end-solfa").classList.toggle("on", balance <= 50);
    box.querySelector(".bk-end-backing").classList.toggle("on", balance >= 50);
    var back = box.querySelector(".bk-back");
    (out ? show : hide)(box.querySelector(".bk-why")); (out ? show : hide)(back);
    back.disabled = transposing;
    box.querySelector(".bk-back-label").textContent = "Back to " + backKey;
    var hint = box.querySelector(".bk-hint");
    if (hint) (out ? hide : show)(hint);
  }
  function renderBacking() {
    if (!current || !current.result || !player) return;
    var state = backingState(), p = backingPrefs(), wrap = $("bk-wrap"), twin = $("backing-group"), line = $("bk-line");
    if (state === "none") { hide(wrap); hide(twin); player.setBackingOn(false); return; }
    show(wrap);
    if (state === "unkept") {
      hide($("bk-strip")); hide(twin);
      $("bk-line-text").textContent = "Songs from a link don’t keep their backing.";
      show($("bk-line-icon")); line.classList.add("is-alone"); show(line);
      player.setBackingOn(false);
      return;
    }
    var out = state === "out", on = !out && p.on;
    var backKey = C.shiftKeyName(current.result.key, -(current.transposedBy || 0));
    [$("bk-strip"), twin].forEach(function (box) { drawBackingControl(box, out, on, p.balance, backKey); show(box); });
    // A song from a link: its backing plays while the page is open and is never kept.
    if (current.result.source || current.source) {
      $("bk-line-text").textContent = "Plays while this page is open. Songs from a link don’t keep their backing.";
      hide($("bk-line-icon")); line.classList.remove("is-alone"); show(line);
    } else hide(line);
    player.setBalance(p.balance / 100);
    player.setBackingOn(on);
  }
  document.querySelectorAll(".bk-on").forEach(function (sw) {
    sw.addEventListener("click", function () {
      if (sw.disabled || !current) return;
      var on = sw.getAttribute("aria-checked") !== "true";
      setBackingPrefs({ on: on });
      renderBacking();
      track("Song backing", on ? "on" : "off");
    });
  });
  document.querySelectorAll(".bk-balance").forEach(function (range) {
    range.addEventListener("input", function () {
      setBackingPrefs({ balance: Math.min(100, Math.max(0, Math.round(Number(range.value) || 0))) });
      renderBacking();
    });
  });
  // "Back to Eb major": today's transpose, by as much as the sheet was moved, and the band on again at its balance.
  document.querySelectorAll(".bk-back").forEach(function (btn) {
    btn.addEventListener("click", function () { if (current && current.transposedBy) transposeBy(-current.transposedBy, true); });
  });

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
  /**
   * The starting note, then clicks to beat one (PR.leadInPlan: five seconds at most), on the audio context's clock
   * (at `rate`, 1 = the sheet's tempo). Returns the lead-in length.
   */
  function playLeadIn(ctx, notes, tempo, ts, rate) {
    var plan = PR.leadInPlan(tempo, ts, rate), beat = plan.beatSec, t0 = ctx.currentTime + 0.05;
    var first = notes.slice().sort(function (a, b) { return a.startBeat - b.startBeat; })[0];
    // The starting note on the same piano the rehearsal player uses, held for its beats. The
    // piano is normally loaded by now (the player fetches it when the sheet is shown); if it
    // is not, the note starts when it arrives and still ends where the clicks go on alone.
    var out = C.createPianoOutput(ctx), holdEnd = t0 + plan.holdBeats * beat;
    C.loadPiano(ctx).then(function () {
      var at = Math.max(t0, ctx.currentTime);
      if (holdEnd - at > 0.05) C.pianoNote(ctx, out, first ? first.pitchMidi : 60, holdEnd - at, at, 0.9);
    }, function () { /* no piano: the clicks still count the singer in */ });
    for (var i = 0; i < plan.beats; i++) {
      var at = t0 + i * beat, click = ctx.createOscillator(), cg = ctx.createGain();
      click.frequency.value = (plan.beats - i) % plan.beatsPerBar === 0 ? 1500 : 1000; cg.gain.setValueAtTime(0.4, at); cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      click.connect(cg); cg.connect(ctx.destination); click.start(at); click.stop(at + 0.06);
    }
    return plan.seconds;
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
    }).catch(function (err) { $("sing-status").textContent = window.NfRecorder ? window.NfRecorder.micProblem(err) : "The microphone didn't open. Check that this site may use it, then try again."; });
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
  /**
   * One note's mark, readable without colour (board l-ux-high 05b): ✓ in tune, ~ close, off the note struck through in
   * grey, not sung dashed with –, as the practice modes draw them (app.css .mark); the cents under it unless Playful, and
   * the whole of it said in words ("d: in tune, 6 cents sharp"). Also handed to the Practice view.
   */
  var MARK_WORDS = { hit: ["in tune", "spot on"], near: ["close", "close"], wrong: ["off the note", "try again"], missed: ["not sung", "not heard"] };
  function markSpan(syllable, status, cents, playful) {
    var mk = document.createElement("span"), b = document.createElement("b");
    mk.className = "mark " + status; b.textContent = syllable; mk.appendChild(b);
    var said = syllable + ": " + (MARK_WORDS[status] || MARK_WORDS.missed)[playful ? 1 : 0];
    if (!playful) {
      var c = status === "missed" || cents == null ? null : Math.round(cents), small = document.createElement("small");
      small.textContent = status === "missed" ? "—" : c == null ? "" : (c > 0 ? "+" : "") + c;
      mk.appendChild(small);
      if (c) said += ", " + Math.abs(c) + (Math.abs(c) === 1 ? " cent " : " cents ") + (c > 0 ? "sharp" : "flat");
    }
    mk.setAttribute("role", "img"); mk.setAttribute("aria-label", said);
    return mk;
  }
  function gradeTake(blob, name, notes, tempo, leadIn) {
    var at = epoch;
    var form = new FormData();
    form.append("audio", blob, name);
    form.append("target", JSON.stringify({ notes: notes.map(function (n) { return { pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats }; }), tempoBpm: tempo, leadInSec: leadIn }));
    track("Sang along");
    request("/api/transcriptions/grade", { method: "POST", form: form }).then(function (g) {
      if (at !== epoch) return;
      $("sing-status").textContent = "";
      $("sing-score").textContent = g.score; $("sing-score").style.color = g.score >= 80 ? "var(--success-text)" : g.score >= 50 ? "var(--ink)" : "var(--danger-text)";
      $("sing-summary").textContent = g.summary + (g.octaveShift ? " Sung " + (g.octaveShift > 0 ? "an octave up" : "an octave down") + " — that's fine." : "");
      var marks = $("sing-marks"); marks.innerHTML = "";
      (g.notes || []).forEach(function (m) {
        var n = notes[m.index]; if (!n) return;
        marks.appendChild(markSpan((n.solfa || "") + (n.octaveMark || ""), m.status, m.cents, false));
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
    if (PR.tooLong(slice, r.tempo, speed, PR.leadInPlan(r.tempo, r.timeSignature, speed).seconds)) { $("pr-status").textContent = "That is more than two minutes to sing. Loop fewer bars, or a faster speed, and try again."; return; }
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
    }).catch(function (err) {
      // Said by cause, with the way to allow it, as Sing it and the recorder say it (assets/recorder.js).
      if (at === epoch && !prTake.cancelled) $("pr-status").textContent = window.NfRecorder ? window.NfRecorder.micProblem(err) : "Allow the microphone for this site to record a take, then try again.";
    });
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
      $("pr-score").style.color = g.score >= 80 ? "var(--success-text)" : g.score >= 50 ? "var(--ink)" : "var(--danger-text)";
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
    $("tr-apply").textContent = transposing ? "Transposing…" : n === 0 ? "Choose a shift" : "Transpose to " + C.shiftKeyName(r.key, n);
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
    // On a sheet with backing, said before applying: the band cannot move with the notes (board o-backing O3). Not when
    // the shift chosen takes the sheet back to the song's own key, nor once it already sits out (the strip says so).
    var moved = current.transposedBy || 0, state = backingState();
    var warn = (state === "on" || state === "out") && (n === 0 ? moved === 0 : moved + n !== 0);
    (warn ? show : hide)($("tr-backing-note"));
    renderBacking();
  }
  $("tr-down").addEventListener("click", function () { if (!current || transposing) return; current.semitones = Math.max(-12, (current.semitones || 0) - 1); renderTranspose(); });
  $("tr-up").addEventListener("click", function () { if (!current || transposing) return; current.semitones = Math.min(12, (current.semitones || 0) + 1); renderTranspose(); });
  $("tr-apply").addEventListener("click", function () { if (current) transposeBy(current.semitones || 0, false); });
  /**
   * Moves the sheet by `n` semitones: the saved sheet on the server, a fresh one through the stateless call. `toSong` is
   * the backing strip's "Back to <key>": the band comes on again with the sheet, at the balance it had.
   */
  function transposeBy(n, toSong) {
    if (!current || !current.result || !n || transposing) return;
    var r = current.result, owner = current, at = epoch;
    transposing = true;
    renderTranspose();
    var req = current.savedId
      ? request("/api/library/" + current.savedId + "/transpose", { method: "POST", body: { semitones: n } })
      : request("/api/transcriptions/transpose", { method: "POST", body: { key: r.key, semitones: n, notes: r.notes, musicXml: r.musicXml, parts: r.parts || null, partsMusicXml: r.partsMusicXml || null, chords: r.chords || null } });
    track(toSong ? "Transposed back to the song's key" : "Transposed");
    req.then(function (moved) {
      if (at !== epoch) return; // signed out meanwhile
      transposing = false;
      if (current !== owner) { if (current && current.result) renderTranspose(); return; } // another sheet opened meanwhile
      current.semitones = 0;
      // How far the sheet now sits from the key it was heard in: the saved sheet's own count when the API sends it,
      // else counted here (a fresh sheet moved and not yet saved counts too).
      current.transposedBy = current.savedId && moved && typeof moved.transposedBy === "number" ? moved.transposedBy : (current.transposedBy || 0) + n;
      if (toSong) setBackingPrefs({ on: true });
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
  }

  // ── Fix a note, said in words (assets/sheet-edit.js; the staff written again by assets/musicxml.js) ──
  var fixing = false;
  /**
   * Makes the change typed and shows the sheet with it: the notes, their solfa, and a staff written from those
   * notes. A saved sheet keeps it (its notes and that staff, PUT /api/library/{id}/notes); a fresh one carries it to
   * Save. Each change can be undone, newest first.
   */
  function fixNote(text) {
    if (!current || !current.result || fixing) return;
    var r = current.result, out = window.NfSheetEdit.edit(r.notes || [], r.key, r.timeSignature, text);
    if (out.error) { $("fix-said").textContent = out.error; track("Fix a note: not followed"); return; }
    // The words printed under the staff stay with their notes.
    var X = window.NfMusicXml, words = X.wordsFor(r.notes, r.musicXml);
    var next = Object.assign({}, r, {
      notes: out.notes,
      musicXml: X.build(out.notes, r.key, r.timeSignature, r.tempo, words && out.from.map(function (k) { return words[k]; })) || r.musicXml,
      solfaLines: C.renderLines(out.notes, C.keyHeader(r.key), r.timeSignature)
    });
    var before = r;
    keepFix(next, out.said, function () {
      (current.fixUndo = current.fixUndo || []).push({ result: before, said: out.said });
      $("fix-text").value = "";
    });
    track("Fixed a note");
  }
  function keepFix(next, said, done) {
    var owner = current, at = epoch;
    fixing = true; $("fix-apply").disabled = true; $("fix-undo").disabled = true;
    var kept = current.savedId
      ? request("/api/library/" + current.savedId + "/notes", { method: "PUT", body: { notes: next.notes, musicXml: next.musicXml } })
      : Promise.resolve();
    kept.then(function () {
      if (at !== epoch || current !== owner) return;
      done();
      // A sheet corrected by hand is not asked which doh or which hymn it is: either answer would undo the correction.
      current.dohAnswered = true; current.hymnAnswered = true;
      current.result = next;
      showResult(next);
      $("fix-said").textContent = said;
    }).catch(function (err) {
      if (at !== epoch) return;
      $("fix-said").textContent = "Could not keep that change: " + (err.message || err);
    }).finally(function () { fixing = false; $("fix-apply").disabled = false; $("fix-undo").disabled = false; });
  }
  function renderFixUndo() {
    var any = !!(current && current.fixUndo && current.fixUndo.length);
    (any ? show : hide)($("fix-undo"));
    if (!any) $("fix-said").textContent = "";
  }
  $("fix-form").addEventListener("submit", function (e) { e.preventDefault(); fixNote($("fix-text").value); });
  $("fix-undo").addEventListener("click", function () {
    if (!current || !current.fixUndo || !current.fixUndo.length || fixing) return;
    var last = current.fixUndo[current.fixUndo.length - 1];
    keepFix(last.result, "Undone: " + last.said.charAt(0).toLowerCase() + last.said.slice(1), function () { current.fixUndo.pop(); });
    track("Undid a note fix");
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
    if (follow) return; // a job still running keeps its card
    resultReturnView = null; rememberJob(null);
    closeTool(); closeFull();
    hide($("result")); hide($("progress"));
    window.scrollTo({ top: 0, behavior: glide() });
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
   * The browser's Back (assets/back.js): the result, a tool, the full-screen sheet and the plans dialog each close
   * with it instead of leaving /app. Watched rather than wired into every opener, so none can forget it; a layer
   * closed on screen is marked done and its history entry is stepped over by the next Back.
   */
  var resultReturnView = null;
  function backLayer(el, isOpen, close) {
    if (!window.NfBack) return;
    var layer = null;
    new MutationObserver(function () {
      if (isOpen() && !layer) {
        layer = NfBack.push(function () { layer = null; close(); });
      } else if (!isOpen() && layer) {
        NfBack.done(layer); layer = null;
      }
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  }
  backLayer($("result"), function () { return !$("result").classList.contains("hidden"); }, function () {
    var back = resultReturnView; resultReturnView = null;
    newTranscription();
    if (back && back !== "transcribe") setView(back); // opened from the Library: back to it
  });
  backLayer($("tool-modal"), function () { return !!openToolId; }, closeTool);
  backLayer($("sheet-stage"), function () { return $("sheet-stage").classList.contains("is-full"); }, closeFull);
  backLayer($("upgrade-panel"), function () { return !$("upgrade-panel").classList.contains("hidden"); }, function () { hide($("upgrade-panel")); });
  // An upload or a take still in the air is lost with the page: the browser asks first.
  window.addEventListener("beforeunload", function (e) {
    if (uploadsInFlight > 0 || document.body.classList.contains("is-recording")) { e.preventDefault(); e.returnValue = ""; }
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
      // Named by what it does: it writes the parts, or opens the ones the sheet has.
      if (id === "harmony") b.querySelector("span").textContent = showsParts ? "See parts" : "Add parts";
    });
  }
  /** A Pro-only action, from anywhere: close the pop-up and open the plans (a guest is asked to sign up first). */
  function pitchPro() {
    closeTool(); closeFull();
    if (guest) { openAuth("register"); return; }
    openUpgrade();
  }

  // ── Pro, under the sheet: one row, in this song's own words (board m-ux-medium W2e) ────
  // It used to be a card taller than the sheet, with a second blue button; Play is now the result's one filled button,
  // and a free preview of a longer song still says how much is locked.
  function renderUnlock(result) {
    var dur = result.songDurationSec || 0, heard = 60;
    var cut = !!result.truncated && dur > heard;
    if (cut) {
      // The row below says what is locked, so the long notice above the sheet becomes one chip.
      hide($("r-truncated"));
      var chip = document.createElement("span"); chip.className = "chip chip-preview";
      chip.textContent = "Preview · 1:00 of " + formatSec(dur);
      $("r-chips").appendChild(chip);
      $("r-unlock-title").textContent = "The rest of this song with Pro";
      $("r-unlock-lead").textContent = formatSec(dur - heard) + " more of it, with alto, tenor and bass and no watermark";
    } else {
      $("r-unlock-title").textContent = "More with Pro";
      $("r-unlock-lead").textContent = "Alto, tenor and bass, Sing it, downloads with no watermark";
    }
  }
  $("r-upgrade").addEventListener("click", function () { track("Pro row"); openUpgrade(); });

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
      if (!$("save-title").value) $("save-title").value = current.filedTitle || (src ? (src.title + (src.artist ? " — " + src.artist : "")) : "My transcription");
      // Already filed (see readJob): Save replaces that copy with this one, edits and all.
      label($("save"), "save", current.filedId ? "Save changes" : "Save to my library");
    }
  }
  function renderShare() {
    if (current.shareToken) {
      $("share-url").value = "https://notefusion.studio/app/sheet/?s=" + encodeURIComponent(current.shareToken);
      show($("share-row")); show($("share-stop")); $("share").textContent = "Share a link";
    } else { hide($("share-row")); hide($("share-stop")); }
  }
  /**
   * Saves the sheet on screen. `auto` is the preview someone just signed up to keep: it is saved for
   * them, with a note saying so, rather than waiting for a Save press that most never made (one in
   * fifty-two previews was ever saved).
   */
  function saveCurrent(auto) {
    if (!current || !current.result || current.savedId) return;
    var r = current.result, btn = $("save"), was = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Saving…";
    request("/api/library", { method: "POST", body: {
      title: $("save-title").value.trim() || "My transcription", key: r.key, tempoBpm: r.tempo, timeSignature: r.timeSignature,
      musicXml: r.musicXml, notes: r.notes, overallConfidence: r.overallConfidence, sourceJobId: current.jobId,
      lyrics: (current.lyrics || "").trim(), parts: r.parts || null, partsMusicXml: r.partsMusicXml || null,
      chords: r.chords || null, hymnSlug: r.hymn ? r.hymn.slug : null,
      // A result transposed here before saving says how far, so the kept backing sits out under the moved notes.
      transposedBy: current.transposedBy || 0
    } }).then(function (saved) {
      sfx.play("saved");
      track("Saved sheet", auto ? "preview kept at sign-up" : null);
      if (auto) alertIn($("app-alert"), "success", "Your preview is saved to your library.");
      current.savedId = saved.id; current.title = saved.title; current.shareToken = saved.shareToken || null;
      libraryCache = null;
      hide($("r-doh")); hide($("r-hymnbook")); // asked before saving; an Undo cannot reach the saved copy
      renderSave();
      var dismissed = false; try { dismissed = localStorage.getItem("nf.web.appBanner") === "no"; } catch (e) { /* ignore */ }
      if (!dismissed) show($("app-banner"));
    }).catch(function (err) { btn.innerHTML = was; alertIn($("app-alert"), "danger", "Could not save: " + (err.message || err)); })
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
    if (!confirm("Stop sharing this sheet? Everyone with the link loses it, and sharing again makes a new link.")) return;
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
    $("result").scrollIntoView({ behavior: glide(), block: "start" });
  }
  /**
   * Four-part harmony, only when asked: the transcription is the one voice we heard, and alto,
   * tenor and bass are an arrangement written under it on request. A saved sheet keeps them.
   */
  /** The harmony card's label and note: "free once" for a free account that still has it. */
  function renderHarmonyOffer() {
    var free = freeHarmonyLeft();
    $("harmony-add").innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-plus"/></svg>' + (free ? "Write the four parts (1 free)" : "Write the four parts");
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

  /** jsPDF 4.2.1 (~110 KB) only when a PDF is asked for: one pinned URL with its SRI hash (the CSP allows it). */
  var JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js";
  var JSPDF_SRI = "sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3";
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

  var engraving = 0; // the latest sheet being drawn: an older one finishing late leaves the skeleton to it
  function engrave(xml) {
    // The engraver takes a moment on a long sheet (and longer the first time, while it
    // loads): the shape of a staff shows until the staff is drawn (or cannot be), not an empty box.
    // The staff is drawn out of sight rather than hidden outright, so the engraver still measures the frame's width.
    var skel = $("sheet-skel"), sheet = $("sheet"), at = ++engraving;
    show(skel); sheet.classList.add("is-drawing");
    osmd = engraveInto(sheet, xml, false, function () {
      if (at !== engraving) return;
      hide(skel); sheet.classList.remove("is-drawing");
    });
  }

  /**
   * Engrave ``xml`` into ``container``; part names only make sense with more than one part. Once drawn, the staff is
   * one picture to a screen reader, named for what it shows (the Tonic Solfa tab has the notes as text). `done` runs
   * once it is drawn or has failed. A failure is one plain sentence on the page; what the engraver said is the console's.
   */
  var NOT_DRAWN = "The staff could not be drawn. The Tonic Solfa tab has the same notes.";
  function engraveInto(container, xml, partNames, done) {
    done = done || function () {};
    container.innerHTML = "";
    container.removeAttribute("role"); container.removeAttribute("aria-label");
    if (!xml) { container.textContent = "Nothing to engrave."; done(); return null; }
    function failed(err) {
      try { if (err) console.warn("[notefusion] staff", err); } catch (e) { /* ignore */ }
      container.textContent = NOT_DRAWN; done();
    }
    if (!window.opensheetmusicdisplay) {
      container.textContent = "Drawing the staff…";
      ensureOsmd().then(function () { engraveInto(container, xml, partNames, done); }, function () {
        container.textContent = "The staff couldn't load. The Tonic Solfa tab still works; check your connection and reload for the staff."; done();
      });
      return null;
    }
    try {
      var display = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
        backend: "svg", autoResize: true, drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false, drawPartNames: !!partNames, drawMeasureNumbers: true,
        autoBeam: true, autoBeamOptions: { beam_rests: false, maintain_stem_directions: false }
      });
      display.load(xml).then(function () { display.render(); nameStaff(container, partNames); done(); }).catch(failed);
      return display;
    } catch (err) { failed(err); return null; }
  }
  function nameStaff(container, parts) {
    var r = current && current.result, title = $("r-title").textContent || "this sheet";
    container.setAttribute("role", "img");
    container.setAttribute("aria-label", (parts ? "The parts of " : "Staff notation of ") + title + (r && r.key ? ", in " + r.key : "") +
      (r && r.timeSignature ? ", " + r.timeSignature + " time" : "") + ". The Tonic Solfa tab has the same notes as text.");
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
    track("Downloaded MusicXML");
    download(baseName() + ".musicxml", new Blob([r.musicXml], { type: "application/vnd.recordare.musicxml+xml" }));
  }));
  $("dl-midi").addEventListener("click", gated(function (r) {
    if (!r.midiBase64) { alertIn($("app-alert"), "info", "No MIDI was produced for this transcription."); return; }
    var bytes = Uint8Array.from(atob(r.midiBase64), function (c) { return c.charCodeAt(0); });
    track("Downloaded MIDI");
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
    track("Downloaded solfa");
    download(baseName() + "-solfa.txt", new Blob([text], { type: "text/plain" }));
  });
  $("dl-parts").addEventListener("click", gated(function (r) {
    if (!r.partsMusicXml) return;
    track("Downloaded SATB parts");
    download(baseName() + "-satb.musicxml", new Blob([r.partsMusicXml], { type: "application/vnd.recordare.musicxml+xml" }));
  }));
  // The PDF is free with a NoteFusion mark; Pro removes it. It was the most-clicked locked button
  // (eleven people, two of them ten times each), so a dead end became the sheet they came for.
  $("dl-pdf").addEventListener("click", function () {
    if (!current || !current.result) return;
    if (guest) { openAuth("register"); return; }
    // The button says what it is doing (the engraver and the PDF library may load first, seconds on 3G), then reads as before.
    var btn = $("dl-pdf"), was = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Making the PDF…";
    track("Downloaded PDF", isPro() ? null : "free, watermarked");
    renderPdf(current.result, !isPro()).catch(function (err) { track("PDF failed", (err && err.name) || "error"); alertIn($("app-alert"), "danger", "Could not build the PDF: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; btn.innerHTML = was; });
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

  // ── The seasonal offer (board p-halloween-offer) ─────────────────────────
  // GET /api/offers/current says what runs for this account: each plan's offer price, and the moment it ends (midnight
  // at the end of its last day, in the account's own time zone). While one runs, or a link names one that has ended,
  // assets/offer.js and offer.css load (never otherwise) and the page shows Home's strip to a free account, the offer's
  // line and prices in the plans, and checks out at the offer's price (offerKey). The countdown is the browser's clock
  // against that end; at zero, and whenever the tab comes back, the API is asked again.
  var OFFER_ASSETS = ["/assets/offer.css?v=1", "/assets/offer.js?v=1"];
  var offerNow = null;     // the offer running for this account; null when none (or not known yet)
  var offerEnded = null;   // { key, label } of one that has ended: an old link's, or one that ran out on this page
  var offerRefused = {};   // keys the checkout refused as ended (BILLING_OFFER_ENDED): not shown again on this page
  var offerHidden = {};    // keys whose strip was closed here, should the browser keep no storage
  var offerLinkKey = null; // ?offer=<key> (the email's button) until it has opened the plans
  var offerRead = null;    // the last ask; never rejects, settles once its answer is on the page
  var offerReadAt = 0;
  var offerWatching = false;
  var lastPlans = null;    // the plans on screen { panel, grid, opts, chosenId }: drawn again when the offer changes

  // The email's button (/app?offer=<key>&m=<token>): its click is counted once per tab, signed in or not; the address
  // keeps both through sign-in, and boot() opens the plans.
  (function offerLink() {
    var q = new URLSearchParams(location.search), key = q.get("offer"), m = q.get("m");
    if (key && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(key)) offerLinkKey = key;
    if (!m || !/^[A-Za-z0-9_-]{16,200}$/.test(m)) return;
    var counted = null;
    try { counted = sessionStorage.getItem("nf.offerClick"); } catch (e) { counted = null; }
    if (counted === m) return;
    try { sessionStorage.setItem("nf.offerClick", m); } catch (e) { /* private mode: a reload may count it again */ }
    request("/api/offers/click", { method: "POST", anonymous: true, body: { token: m } }).catch(function () { /* a lost click is only a missing count */ });
  })();

  function offerLive() { return !!(offerNow && window.NfOffer && window.NfOffer.isLive(offerNow, Date.now())); }
  /** A plan's price under the running offer, in minor units; null when no offer covers it. */
  function offerFor(plan) { return offerLive() ? window.NfOffer.offerPrice(plan, offerNow) : null; }
  function offerDismissed(key) {
    if (offerHidden[key]) return true;
    try { return localStorage.getItem(window.NfOffer.dismissKey(key)) === "1"; } catch (e) { return false; }
  }
  function offerSig() {
    return offerLive() ? offerNow.key + "|" + offerNow.endsAtUtc + "|" + JSON.stringify(offerNow.plans) : "none|" + (offerEnded ? offerEnded.key : "");
  }

  /**
   * Asks what runs for this account (`key`: an offer to ask after by name, for the line that says it has ended). The
   * files load only when the answer has something to show; a failure keeps what the page showed.
   */
  function readOffer(key) {
    if (!tokens()) return Promise.resolve();
    var at = epoch, ask = key || offerLinkKey;
    offerReadAt = Date.now();
    offerRead = request("/api/offers/current" + (ask ? "?key=" + encodeURIComponent(ask) : ""))
      .then(function (r) {
        if (at !== epoch) return;
        var o = r && r.offer, ended = r && r.ended && r.ended.key ? { key: r.ended.key, label: r.ended.label } : null;
        var live = o && o.key && !offerRefused[o.key] && Date.parse(o.endsAtUtc) > Date.now() && Array.isArray(o.plans) && o.plans.length ? o : null;
        if (!live && !ended && !offerNow) return;
        return Promise.all(OFFER_ASSETS.map(loadAsset)).then(function () {
          if (at !== epoch) return;
          if (!offerWatching) { offerWatching = true; window.NfOffer.watch(offerRanOut); }
          // One that was running and is not any more has ended, whatever the reason (its day is over, it was switched off).
          var gone = !live && offerNow ? { key: offerNow.key, label: offerNow.label } : null;
          setOffer(live, ended || gone);
        });
      })
      .catch(function () { /* offline or refused: the page keeps what it showed; the next look asks again */ });
    return offerRead;
  }
  /** The ask in flight, waited on for at most 4 s (the plans open at their usual prices rather than not at all). */
  function offerSettled() {
    return offerRead ? Promise.race([offerRead, new Promise(function (r) { setTimeout(r, 4000); })]) : Promise.resolve();
  }

  /** The offer changes: the page's dress, Home's strip, and the plans when they are on screen follow it. */
  function setOffer(offer, ended) {
    var before = offerSig();
    offerNow = offer;
    if (ended) offerEnded = ended;
    if (offerLive()) window.NfOffer.dress(offerNow);
    // Gone: the strip fades in the template's colours first, so the dress comes off after it.
    else if (window.NfOffer) setTimeout(function () { if (!offerLive()) window.NfOffer.dress(null); }, 220);
    renderOfferBanner();
    if (offerSig() !== before) redrawPlans(); else syncOfferLine();
    if (window.NfOffer) window.NfOffer.tick();
  }
  /** The countdown reached zero: the strip fades out (200 ms), the prices go back, and the API is asked again. */
  function offerRanOut(end) {
    if (!offerNow || window.NfOffer.endsAt(offerNow) !== end) return;
    var was = offerNow;
    setOffer(null, { key: was.key, label: was.label });
    setTimeout(function () { readOffer(was.key); }, 2000);
  }
  /** The checkout refused the offer's price (its end passed for this account): the usual prices, and the line that says so. */
  function offerWasRefused(o) {
    if (!o) { readOffer(); return; }
    offerRefused[o.key] = true;
    setOffer(offerNow && offerNow.key === o.key ? null : offerNow, { key: o.key, label: o.label });
    readOffer(o.key);
  }
  /** Signed out: nothing of the offer stays (an email's link in the address waits for the next sign-in). */
  function forgetOffer() {
    offerNow = null; offerEnded = null; offerRefused = {}; offerRead = null; lastPlans = null;
    ["offer-bar", "offer-line", "offer-ended-line"].forEach(function (id) { var x = $(id); if (x) x.remove(); });
    if (window.NfOffer) window.NfOffer.dress(null);
  }
  // Back to the tab: a day may have turned, or the offer been switched off, while it was away.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && me && !guest && Date.now() - offerReadAt > 15000) readOffer();
  });

  /**
   * Home's strip (P2): free accounts only, while the offer runs, until it is closed on this browser. "See the offer"
   * opens the plans as the email's button does; the close hides the strip for this offer, and the plans keep its prices.
   */
  function renderOfferBanner() {
    var bar = $("offer-bar");
    var want = offerLive() && !guest && !!tokens() && !!sub && !isPro() && !offerDismissed(offerNow.key);
    if (!want) { if (bar) dropOfferBanner(bar); return; }
    var sig = offerNow.key + "|" + offerNow.endsAtUtc + "|" + offerNow.percentOff;
    if (bar && bar.getAttribute("data-sig") === sig && !bar.classList.contains("is-leaving")) return;
    if (bar) bar.remove();
    bar = window.NfOffer.banner(offerNow);
    bar.id = "offer-bar";
    bar.setAttribute("data-sig", sig);
    var key = offerNow.key;
    bar.querySelector(".offer-go").addEventListener("click", function () { track("Offer: see the offer", key); openUpgrade("offer"); });
    bar.querySelector(".offer-x").addEventListener("click", function () {
      offerHidden[key] = true;
      try { localStorage.setItem(window.NfOffer.dismissKey(key), "1"); } catch (e) { /* private mode: hidden for this page */ }
      track("Offer: hid the strip", key);
      var hadFocus = bar.contains(document.activeElement);
      bar.remove();
      // The close is gone from under the keyboard: the page's heading takes the focus rather than the document.
      if (hadFocus) { $("greeting").setAttribute("tabindex", "-1"); $("greeting").focus({ preventScroll: true }); }
    });
    var view = $("view-transcribe");
    view.insertBefore(bar, view.firstChild);
    window.NfOffer.tick();
  }
  function dropOfferBanner(bar) {
    if (bar.classList.contains("is-leaving")) return;
    if (glide() === "auto") { bar.remove(); return; }
    bar.classList.add("is-leaving");
    setTimeout(function () { bar.remove(); }, 200);
  }

  /**
   * The plans' first line, under their title: the offer's line while it runs (P3), else, once one has ended, "The
   * Halloween offer has ended." (P5). Only while the dialog shows plans: a member's membership alone has neither.
   */
  function syncOfferLine() {
    var head = document.querySelector("#upgrade-panel .pay-head"), line = $("offer-line"), note = $("offer-ended-line");
    var plansShown = !$("upgrade-panel").classList.contains("hidden") &&
      (!$("upgrade-free").classList.contains("hidden") || !$("plans-extend").classList.contains("hidden"));
    var live = plansShown && offerLive(), ended = plansShown && !offerLive() && !!offerEnded && !!window.NfOffer;
    var sig = live ? offerNow.key + "|" + offerNow.endsAtUtc : "";
    if (line && (!live || line.getAttribute("data-sig") !== sig)) { line.remove(); line = null; }
    if (live && !line) {
      line = window.NfOffer.plansLine(offerNow);
      line.id = "offer-line"; line.setAttribute("data-sig", sig);
      head.parentNode.insertBefore(line, head.nextSibling);
      window.NfOffer.tick();
    }
    if (note && (!ended || note.getAttribute("data-key") !== offerEnded.key)) { note.remove(); note = null; }
    if (ended && !note) {
      note = window.NfOffer.endedNote(offerEnded);
      note.id = "offer-ended-line"; note.setAttribute("data-key", offerEnded.key);
      head.parentNode.insertBefore(note, head.nextSibling);
    }
  }
  /** The plans on screen, drawn again at the prices that now apply, the plan chosen kept. */
  function redrawPlans() {
    var lp = lastPlans;
    if (!lp || $("upgrade-panel").classList.contains("hidden") || lp.grid.offsetParent === null) { syncOfferLine(); return; }
    var opts = {};
    for (var k in lp.opts) opts[k] = lp.opts[k];
    opts.want = lp.chosenId; opts.fromOffer = false;
    loadPlans(lp.panel, lp.grid, opts);
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
    lastPlans = { panel: panel, grid: grid, opts: opts, chosenId: null };
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
    // The offer's answer, when one is on its way, so the plans open at the prices that apply (offerSettled).
    Promise.all([p, pc, ps, offerSettled()]).then(function (all) {
      if (lastPlans && lastPlans.grid !== grid) return; // other plans were opened meanwhile
      var plans = all[0], choirPlans = (all[1] || []).slice().sort(function (a, b) { return a.amountMinor - b.amountMinor; });
      grid.innerHTML = "";
      grid.classList.add("plan-picker");
      // An API from before the split still lists it in the main list; either way it is shown as one song.
      var single = opts.single && !isPro() ? ((all[2] || []).find(isSinglePlan) || plans.find(isSinglePlan) || null) : null;
      plans = plans.filter(function (x) { return !isSinglePlan(x); });
      if (!plans.length && !single && !choirPlans.length) {
        grid.textContent = "No plan is available for your region yet. Email ";
        var mail = document.createElement("a"); mail.href = "mailto:hello@notefusion.studio"; mail.textContent = "hello@notefusion.studio";
        grid.appendChild(mail); grid.appendChild(document.createTextNode(" and we'll help you pay."));
        return;
      }
      var monthly = plans.find(function (x) { return !isYearly(x) && !isLifetimePlan(x); });
      // Naira opens on the monthly plan: ₦60,000 as the first price anyone sees reads as a wall, while
      // ₦7,500 a month is a decision. Elsewhere the yearly saving leads, as before.
      var monthlyFirst = !!monthly && String(monthly.currency).toUpperCase() === "NGN";
      var ordered = plans.slice().sort(function (a, b) {
        var ya = isYearly(a) ? 1 : 0, yb = isYearly(b) ? 1 : 0;
        return monthlyFirst ? ya - yb : yb - ya;
      });
      // Just this song goes first: the smallest, simplest thing to buy, next to Pro. While an offer prices Pro, Pro leads
      // and the song follows it (P3), unless the free limit opened the plans: one more song is what was asked for then.
      var proFirst = !opts.singleFirst && plans.some(function (x) { return offerFor(x); });
      if (single) { if (proFirst) ordered.push(single); else ordered.unshift(single); }
      var firstOwn = ordered.filter(function (x) { return x !== single; })[0];
      var chosen = single && (opts.singleFirst || !plans.length) ? single : (firstOwn || ordered[0]);
      // From the offer (its email's button, Home's strip) Pro Monthly is the one chosen, at its offer price.
      if (opts.fromOffer && monthly && offerFor(monthly)) chosen = monthly;
      // The choir plans fold into one row under the rest, "For choir directors ›", which swaps the list to them with a
      // Back (board m-ux-medium W3e; the phone's Upgrade does the same): one director pays and the whole choir is Pro.
      var choirMonthly = choirPlans.find(function (x) { return !isYearly(x); });
      var ownChoice = chosen;
      // A director renewing their choir starts on the choir plans; anyone else on what they would buy for themselves.
      var showingChoir = !!choirPlans.length && (opts.choirFirst || leadsChoir() || !ordered.length);
      if (showingChoir) chosen = choirPlans[0];
      // "Add another month" (Account) starts on the month it says, a director's choir plans aside.
      if (opts.monthly && monthly) { chosen = ownChoice = monthly; showingChoir = false; }
      // A plan picked on the pricing page is the one chosen here too, while its checkout opens and if it cannot.
      var wanted = opts.want ? ordered.concat(choirPlans).filter(function (x) { return String(x.id) === String(opts.want) || x.code === opts.want; })[0] : null;
      if (wanted) { chosen = wanted; showingChoir = isChoirPlan(wanted); if (!showingChoir) ownChoice = wanted; }
      var options = document.createElement("div"); options.className = "plan-options"; options.setAttribute("role", "radiogroup"); options.setAttribute("aria-label", "Choose a plan");
      var cta = document.createElement("button"); cta.type = "button"; cta.className = "btn btn-primary btn-pay";
      function label(plan) { return isChoirPlan(plan) ? (isYearly(plan) ? "Choir · Yearly" : "Choir · Monthly") : isSinglePlan(plan) ? "Just this song" : isLifetimePlan(plan) ? "Lifetime" : isYearly(plan) ? "Yearly" : "Monthly"; }
      function per(plan) { return isSinglePlan(plan) || isLifetimePlan(plan) ? "once" : isYearly(plan) ? "a year" : "a month"; }
      var fine = document.createElement("p"); fine.className = "pay-fine";
      // A checkout that will not open says so here, above the button, not in the page behind the dialog.
      var payError = document.createElement("p"); payError.className = "pay-error"; payError.setAttribute("role", "alert"); payError.hidden = true;
      function renderCta() {
        if (lastPlans && lastPlans.grid === grid) lastPlans.chosenId = chosen.id;
        cta.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-lock"/></svg>';
        // What the money buys, as one period ("Pay ₦7,500 for 1 month of Pro"): "₦7,500 a month" read as a renewal.
        // Under an offer, its price ("Pay $6.99 for 1 month of Pro").
        var span = isLifetimePlan(chosen) ? "" : "1 " + (isYearly(chosen) ? "year" : "month");
        var offered = offerFor(chosen), cost = offered ? money({ amountMinor: offered, currency: chosen.currency }) : money(chosen);
        cta.appendChild(document.createTextNode(isSinglePlan(chosen)
          ? "Buy this song — " + money(chosen)
          : isChoirPlan(chosen)
            ? (leadsChoir() ? "Add choir time — " : "Start your choir — ") + money(chosen) + " for " + span
            : "Pay " + cost + (span ? " for " + span + " of Pro" : " for Pro for life")));
        fine.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-lock"/></svg>';
        // Adding time: the date it would run to, so a member sees what the payment buys before paying.
        var until = extendedEnd(chosen);
        fine.appendChild(document.createTextNode(isSinglePlan(chosen)
          ? "Secure checkout. One payment, one transcription that never expires."
          : until
            ? "Secure checkout. It starts when your current time ends: " + (isChoirPlan(chosen) ? "your choir's Pro" : "Pro") + " until " + longDate(until) + ". Nothing renews without you."
          : offered
            ? window.NfOffer.payFine(chosen.interval)
          : isChoirPlan(chosen)
            ? "Secure checkout. One payment covers the whole choir for the period; nothing renews without you. You'll get an invite link for your singers."
            : "Secure checkout. One payment covers the whole period; nothing renews without you."));
        payError.hidden = true;
      }
      var seats = (choirPlans[0] && choirPlans[0].choirSeats) || 25;
      /** The list as it stands: the plans for oneself and the choir row, or the choir plans with a way back. */
      function renderOptions() {
        options.innerHTML = "";
        if (showingChoir) {
          if (ordered.length) {
            var back = document.createElement("button"); back.type = "button"; back.className = "btn-link plan-back";
            back.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-back"/></svg>All plans';
            back.addEventListener("click", function () { showingChoir = false; chosen = ownChoice; renderOptions(); renderCta(); options.querySelector(".choir-row").focus(); });
            options.appendChild(back);
          }
          var head = document.createElement("p"); head.className = "plan-group muted small"; head.setAttribute("role", "presentation");
          head.textContent = "For choir directors — Pro for you and up to " + seats + " singers, one shared library";
          options.appendChild(head);
          choirPlans.forEach(addOption);
          return;
        }
        ordered.forEach(addOption);
        if (!choirPlans.length) return;
        var row = document.createElement("button"); row.type = "button"; row.className = "choir-row";
        var from = choirMonthly || choirPlans[0];
        row.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-choir"/></svg><span><b>For choir directors</b><small></small></span><svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#i-chev"/></svg>';
        row.querySelector("small").textContent = "Pro for you and up to " + seats + " singers · from " + money(from) + " " + per(from);
        row.addEventListener("click", function () {
          track("Plans: choir directors");
          showingChoir = true; chosen = choirPlans[0]; renderOptions(); renderCta();
          var first = options.querySelector(".plan-back") || options.querySelector(".plan-opt.on");
          if (first) first.focus();
        });
        options.appendChild(row);
      }
      function addOption(plan) {
        var opt = document.createElement("button"); opt.type = "button"; opt.className = "plan-opt"; opt.setAttribute("role", "radio");
        var top = document.createElement("span"); top.className = "plan-opt-top";
        var name = document.createElement("span"); name.className = "plan-opt-name"; name.textContent = label(plan);
        top.appendChild(name);
        var base = isChoirPlan(plan) ? choirMonthly : monthly;
        var saving = isYearly(plan) && base ? Math.round(100 - (plan.amountMinor / (base.amountMinor * 12)) * 100) : 0;
        // Under an offer the plan's tag is the offer's ("Halloween · 30% off", in the season's wash) in place of the
        // saving, and its old price is struck before the new one (P3).
        var offered = offerFor(plan);
        if (offered) { var otag = document.createElement("span"); otag.className = "plan-opt-tag offer-tag"; otag.textContent = window.NfOffer.tagText(offerNow); top.appendChild(otag); }
        else if (saving > 0) { var tag = document.createElement("span"); tag.className = "plan-opt-tag"; tag.textContent = "Save " + saving + "%"; top.appendChild(tag); }
        var price = document.createElement("span"); price.className = "plan-opt-price";
        if (offered) {
          var was = document.createElement("s"); was.innerHTML = '<span class="sr-only">Was </span>'; was.appendChild(document.createTextNode(money(plan)));
          var nowSr = document.createElement("span"); nowSr.className = "sr-only"; nowSr.textContent = ", now ";
          price.appendChild(was); price.appendChild(nowSr);
          price.appendChild(document.createTextNode(money({ amountMinor: offered, currency: plan.currency })));
        } else price.textContent = money(plan);
        var small = document.createElement("small"); small.textContent = isSinglePlan(plan) ? " once" : " / " + (isLifetimePlan(plan) ? "once" : isYearly(plan) ? "year" : "month"); price.appendChild(small);
        if (isSinglePlan(plan)) { var noSub = document.createElement("span"); noSub.className = "plan-opt-tag"; noSub.textContent = "No subscription"; top.appendChild(noSub); }
        var note = document.createElement("span"); note.className = "plan-opt-note";
        note.textContent = isSinglePlan(plan)
          ? "One more transcription, any recording or song link."
          : isChoirPlan(plan)
            ? "Pro for you and up to " + (plan.choirSeats || 25) + " singers, 60 songs a month shared, one library" + (isYearly(plan) ? ", paid once a year" : "")
          : isYearly(plan)
            ? money({ amountMinor: Math.round((offered || plan.amountMinor) / 12), currency: plan.currency }) + " a month, paid once a year"
            : isLifetimePlan(plan) ? "Pay once, Pro for good" : "Pay month by month";
        var dot = document.createElement("span"); dot.className = "plan-opt-dot"; dot.setAttribute("aria-hidden", "true");
        opt.appendChild(dot); opt.appendChild(top); opt.appendChild(price); opt.appendChild(note);
        function select() {
          chosen = plan;
          options.querySelectorAll(".plan-opt").forEach(function (o) { var on = o === opt; o.classList.toggle("on", on); o.setAttribute("aria-checked", String(on)); o.tabIndex = on ? 0 : -1; });
          renderCta();
        }
        opt.addEventListener("click", select);
        options.appendChild(opt);
        if (plan === chosen) { opt.classList.add("on"); opt.setAttribute("aria-checked", "true"); } else opt.setAttribute("aria-checked", "false");
        opt.tabIndex = plan === chosen ? 0 : -1;
      }
      // A radio group as the keyboard expects one: Tab reaches the chosen plan, the arrows move the choice (and Home, End).
      options.addEventListener("keydown", function (e) {
        var radios = Array.prototype.slice.call(options.querySelectorAll(".plan-opt")), at = radios.indexOf(document.activeElement);
        if (at < 0) return;
        var next = e.key === "ArrowDown" || e.key === "ArrowRight" ? (at + 1) % radios.length
          : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (at - 1 + radios.length) % radios.length
          : e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1 : -1;
        if (next < 0) return;
        e.preventDefault();
        radios[next].focus(); radios[next].click();
      });
      renderOptions();
      renderCta();
      cta.addEventListener("click", function () { checkout(chosen, cta); });
      // The price and the button stay at the bottom of the dialog while the plans scroll above them
      // (board l-ux-high/03b): on a phone Pay sat about a screen below the fold.
      var foot = document.createElement("div"); foot.className = "pay-foot";
      // Who to ask and the terms, beside Pay (board m-ux-medium W3f).
      var help = document.createElement("p"); help.className = "pay-help";
      help.innerHTML = 'Help &amp; refunds: <span><a href="mailto:hello@notefusion.studio">hello@notefusion.studio</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></span>';
      foot.appendChild(payError); foot.appendChild(cta); foot.appendChild(fine); foot.appendChild(help);
      grid.appendChild(options); grid.appendChild(foot);
      syncOfferLine();
    }).catch(function () {
      // A way to ask again where the plans should be, not only the words.
      grid.textContent = "Plans could not be loaded right now. ";
      var again = document.createElement("button");
      again.type = "button"; again.className = "btn btn-ghost btn-sm"; again.textContent = "Try again";
      again.addEventListener("click", function () { loadPlans(panel, grid, opts); });
      grid.appendChild(again);
    });
  }

  /**
   * When a period bought now would end, for a member adding time (Pro of their own, or a director's choir): it runs on
   * from the current end, a calendar month or year (the API's BillingPeriod: a 31st lands on a shorter month's last day).
   * Null when nothing is being extended.
   */
  function extendedEnd(plan) {
    if (isSinglePlan(plan) || isLifetimePlan(plan) || !sub) return null;
    var end = isChoirPlan(plan) ? (leadsChoir() ? sub.choirPeriodEndUtc : null) : (isPro() && !proViaChoir() && !sub.isLifetime ? sub.currentPeriodEndUtc : null);
    var from = end ? new Date(Math.max(Date.now(), Date.parse(end))) : null;
    if (!from || isNaN(from)) return null;
    var y = from.getUTCFullYear() + (isYearly(plan) ? 1 : 0), m = from.getUTCMonth() + (isYearly(plan) ? 0 : 1);
    var lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes()));
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
  /** Only the providers' hosted checkouts are followed: https on Paystack, Bachs or Flutterwave, nothing else. */
  function trustedCheckout(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" && /(^|\.)(paystack\.com|paystack\.co|bachs\.io|flutterwave\.com)$/i.test(u.hostname);
    } catch (e) { return false; }
  }
  function checkout(plan, btn) {
    btn.disabled = true;
    var label = btn.innerHTML;
    // Started with no button on screen (the pricing page's plan, "What stopped you?"'s Try again), the wait is said in
    // the plans dialog's reason line when it is open, else in the page's alert.
    var note = null;
    if (btn.isConnected) btn.textContent = "Opening secure checkout…";
    else if (!$("upgrade-panel").classList.contains("hidden")) { note = $("upgrade-reason"); $("upgrade-reason-text").textContent = "Opening secure checkout…"; show(note); }
    else { note = $("app-alert"); alertIn(note, "info", "Opening secure checkout…"); }
    track("Checkout started", plan.id);
    // At an offer's price the checkout names the offer; the API prices it again for this account and refuses it once
    // the offer has ended for them (BILLING_OFFER_ENDED).
    var body = { planId: plan.id, client: "web" }, offerAsked = offerFor(plan) ? offerNow : null;
    if (offerAsked) body.offerKey = offerAsked.key;
    request("/api/billing/checkout", { method: "POST", body: body })
      .then(function (session) {
        if (!session || !trustedCheckout(session.checkoutUrl)) throw new ApiError(502, { code: "BILLING_CHECKOUT_URL" });
        var provider = "";
        try { provider = new URL(session.checkoutUrl).hostname; } catch (e) { /* ignore */ }
        openedHere = true;
        saveCheckout({
          // What "What stopped you?" needs if this comes back unpaid: the checkout's id, and the plan "Try again" reopens.
          reference: session.reference,
          plan: { id: plan.id, code: plan.code, name: plan.name, amountMinor: plan.amountMinor, currency: plan.currency, interval: plan.interval, choirSeats: plan.choirSeats || null },
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
        btn.innerHTML = label; // the page stays, so the button reads as it did (on success the page is leaving)
        if (note) hide(note);
        // An earlier checkout turned out to be paid: nothing to buy, so this is the welcome, not an error.
        if (err instanceof ApiError && err.code === "BILLING_PAYMENT_ALREADY_RECEIVED") {
          var before = { wasActive: isPro(), periodEnd: (sub && sub.currentPeriodEndUtc) || null, single: isSinglePlan(plan), choir: isChoirPlan(plan) };
          return request("/api/billing/my-subscription").then(function (s) { paymentDone(s, before); })
            .catch(function () { alertIn($("app-alert"), "success", err.message); });
        }
        track("Checkout failed", (err instanceof ApiError ? err.code + " (HTTP " + err.status + ")" : (err && err.message) || "Network error") + " · app");
        // The offer ended before the checkout opened: the plans at their usual prices, with the line that says so (P5).
        if (err instanceof ApiError && err.code === "BILLING_OFFER_ENDED") {
          offerWasRefused(offerAsked);
          if ($("upgrade-panel").classList.contains("hidden")) alertIn($("app-alert"), "info", err.message);
          return;
        }
        var text =(err instanceof ApiError && err.message) || "We couldn't open the payment page just now. Please try again in a minute.";
        var box = !$("upgrade-panel").classList.contains("hidden") && document.querySelector("#upgrade-panel .plans:not(.hidden) .pay-error");
        if (box) { box.textContent = text; box.hidden = false; }
        else alertIn($("app-alert"), "danger", text);
      })
      .finally(function () { btn.disabled = false; });
  }

  // ── Back from checkout: Pro unlocks the moment the payment lands ────────
  // The provider's webhook and the browser's return race each other, so the page asks the API to confirm at once,
  // then after 3, 6, 12 and 20 s, then every 30 s for ten minutes; failures are silent retries. Never while the tab
  // is hidden: coming back to it asks at once (below).
  var CHECKOUT_KEY = "nf.checkout";
  var CHECKOUT_TTL = 2 * 60 * 60 * 1000;
  var PAY_STEPS_MS = [3000, 6000, 12000, 20000], PAY_EVERY_MS = 30000, PAY_SLOW_AFTER = 60 * 1000, PAY_WATCH_FOR = 10 * 60 * 1000;
  var payWatch = null;    // { snap, started, checks, timer, busy, slow, quiet, mayAsk } while a payment is being confirmed
  var openedHere = false; // this page sent the browser to a checkout (a provider that opened elsewhere leaves it)
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
  /**
   * quiet: no "Confirming…" note, because nothing says a payment was made (Back from the provider, a later visit).
   * mayAsk: the browser has just come back from the payment page (the provider's return, Back), so a first check that
   * finds nothing paid reports the return and may ask "What stopped you?"; a later visit only watches.
   */
  function watchPayment(quiet, mayAsk) {
    dropParam("paid");
    if (payWatch) {
      if (!quiet && payWatch.quiet) { payWatch.quiet = false; showPayToast(payWatch.slow); }
      if (mayAsk) payWatch.mayAsk = true;
      checkPayment(); return;
    }
    payWatch = { snap: readCheckout(), started: Date.now(), checks: 0, timer: null, busy: false, slow: false, quiet: !!quiet, mayAsk: !!mayAsk };
    // Back from the payment page, by the provider's return or Back: its own step, before anything is confirmed.
    if (!quiet || mayAsk) track("Checkout returned", (quiet ? "back" : "provider return") + (payWatch.snap && payWatch.snap.planId ? " · " + payWatch.snap.planId : ""));
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
    w.busy = true; clearTimeout(w.timer); w.checks++;
    request("/api/billing/confirm", { method: "POST" })
      .catch(function (err) { if (err.status === 401) stopPaymentWatch(); return null; })
      .then(function (s) {
        w.busy = false;
        if (payWatch !== w) return;
        if (paymentLanded(s, w.snap)) { paymentDone(s, w.snap); return; }
        // The quick check answered and nothing is paid: report the return, and ask if the API says so.
        if (s && w.mayAsk && !w.askedWhy) { w.askedWhy = true; askWhy(w); }
        var age = Date.now() - w.started;
        if (age >= PAY_SLOW_AFTER && !w.slow) { w.slow = true; if (!w.quiet) showPayToast(true); }
        if (age < PAY_WATCH_FOR) w.timer = setTimeout(payTick, PAY_STEPS_MS[w.checks - 1] || PAY_EVERY_MS);
        else if (!w.reported) {
          // Watched for the full ten minutes and nothing landed: the dashboard's "never confirmed" step.
          w.reported = true;
          track("Payment not confirmed", w.quiet ? "came back without paying (abandoned?)" : "provider sent the browser back, no payment after 10 min");
          // The checking stops here, so the note stops promising it and says what to do if money left the account.
          if (!w.quiet) {
            $("pay-toast-title").textContent = "We haven't seen this payment yet.";
            $("pay-toast-sub").textContent = "If you were charged, email hello@notefusion.studio with your receipt and we'll sort it out. Nothing is charged twice.";
          }
        }
      });
  }
  /** The next check, unless the tab is hidden: then the next look at it asks (the visibilitychange handler below). */
  function payTick() { if (document.visibilityState !== "hidden") checkPayment(); }
  // ── "What stopped you?" (board g-checkout): a checkout that came back unpaid, asked once ──
  var WHY_RULES = "/assets/checkout-exit.js?v=2";
  var WHY_SHEET = ["/assets/checkout-why.css?v=2", "/assets/checkout-why.js?v=2"];
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
  /**
   * Reports the return (how long the page was open) and, when the API says so, opens the sheet: the API looks at the
   * provider again first, so it only asks when the page shows nothing paid and no transfer under way. Once per
   * checkout; a failure anywhere asks nothing.
   */
  function askWhy(w) {
    var snap = w.snap;
    if (!snap || !snap.reference) return;
    var exitPath = "/api/billing/checkouts/" + encodeURIComponent(snap.reference) + "/exit";
    loadAsset(WHY_RULES).then(function () {
      var X = window.NfCheckoutExit;
      var asked = X.parseAsked(lsGet(X.ASKED_KEY));
      if (!X.shouldReportReturn({ returned: false, check: "unpaid", reference: snap.reference, asked: asked })) return null;
      var seconds = X.secondsOpen(snap.startedAt, Date.now());
      return Promise.all([
        request(exitPath, { method: "POST", body: { secondsOpen: seconds } }),
        isPro() ? Promise.resolve([]) : request("/api/billing/plans/single").catch(function () { return []; }),
        Promise.all(WHY_SHEET.map(loadAsset))
      ]).then(function (got) {
        lsSet(X.ASKED_KEY, JSON.stringify(X.rememberAsked(asked, snap.reference)));
        var reply = got[0], song = (got[1] || []).filter(isSinglePlan)[0];
        // Landed or stopped meanwhile, or the API says not to ask.
        if (!reply || !reply.ask || payWatch !== w) return;
        // The API has just read the page and nothing is paid or on its way: nothing is being confirmed.
        if (!w.quiet) { w.quiet = true; hide($("pay-toast")); }
        window.NfCheckoutWhy.open({
          currency: reply.currency,
          price: X.formatPrice(reply.amountMinor, reply.currency),
          songPrice: song ? X.formatPrice(song.amountMinor, song.currency) : null,
          buyingSong: !!snap.single,
          keptMinutes: reply.keptMinutes,
          onAnswer: function (reason, note) {
            var body = { secondsOpen: seconds, reason: reason };
            if (note) body.note = note;
            request(exitPath, { method: "POST", body: body }).catch(function () { /* a lost answer is only a missing row */ });
          },
          // The same plan: the API hands back the same checkout while it is kept.
          onTryAgain: function () { if (snap.plan) checkout(snap.plan, document.createElement("button")); else openUpgrade(); },
          onSong: function () { if (song) checkout(song, document.createElement("button")); }
        });
      });
    }).catch(function () { /* offline or refused: nothing recorded, so nothing to ask */ });
  }
  /** How this page was reached: a Back that reloaded it rather than restoring it from the cache counts as coming back. */
  function cameBack() {
    try { var nav = performance.getEntriesByType("navigation")[0]; return !!nav && nav.type === "back_forward"; } catch (e) { return false; }
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
    // The recording that was refused for want of it goes on with the button, not sung again.
    if (!relink) readKeptTake().then(function (k) {
      if (!k) return;
      welcomeResend = k;
      $("pro-welcome-plan").textContent = "Your recording is kept. Press Transcribe it to send it now.";
    });
    hide($("pro-welcome-perks"));
    $("pro-welcome-go").textContent = "Transcribe it";
    welcomeDress(true);
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
    show($("pro-welcome-perks")); $("pro-welcome-go").textContent = "Invite your singers"; welcomeDress(false);
    $("pro-welcome-title").textContent = snap && snap.choirPeriodEnd ? "More choir time added" : "Your choir is ready";
    var when = s.choirPeriodEndUtc ? new Date(s.choirPeriodEndUtc).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    $("pro-welcome-plan").textContent = "Copy the invite link under My choir and send it to your singers." + (when ? " Pro for the whole choir until " + when + "." : "");
    welcomeReturn = $("choir-invite-copy");
    show($("pro-welcome"));
    $("pro-welcome-go").focus();
    sfx.play("saved");
  }
  function openProWelcome(snap) {
    show($("pro-welcome-perks")); $("pro-welcome-go").textContent = "Start using Pro"; welcomeDress(false);
    $("pro-welcome-title").textContent = snap && snap.wasActive ? "More Pro time added" : "Welcome to NoteFusion Pro";
    var when = sub.currentPeriodEndUtc ? new Date(sub.currentPeriodEndUtc).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
    $("pro-welcome-plan").textContent = planLabel() + (sub.isLifetime ? " · Pro for life" : when ? " · Pro until " + when : "");
    welcomeReturn = document.activeElement;
    show($("pro-welcome"));
    $("pro-welcome-go").focus();
    sfx.play("saved");
  }
  /**
   * The pop-up's dress: Pro's gold crown, glow and button for Pro and the choir; one song bought is not Pro, so a plain
   * card with a neutral tick and the ordinary blue button (board n-ux-low V2f).
   */
  function welcomeDress(single) {
    $("pro-welcome").classList.toggle("is-single", single);
    $("pro-welcome").querySelector(".pro-welcome-mark use").setAttribute("href", "/assets/icons.svg#i-" + (single ? "check" : "crown"));
    $("pro-welcome-go").className = "btn btn-pill " + (single ? "btn-primary" : "btn-pro");
  }
  function closeProWelcome() {
    hide($("pro-welcome"));
    if (welcomeReturn && welcomeReturn.focus && welcomeReturn !== document.body) welcomeReturn.focus();
    welcomeReturn = null;
  }
  var welcomeResend = null;
  $("pro-welcome-go").addEventListener("click", function () {
    var k = welcomeResend; welcomeResend = null;
    closeProWelcome();
    if (k) sendKept(k);
  });
  $("pro-welcome").addEventListener("click", function (e) { if (e.target === $("pro-welcome")) closeProWelcome(); });
  document.addEventListener("keydown", function (e) {
    if ($("pro-welcome").classList.contains("hidden")) return;
    if (e.key === "Escape") closeProWelcome();
    else if (e.key === "Tab") { e.preventDefault(); $("pro-welcome-go").focus(); } // its one control keeps the focus
  });
  $("pay-toast-close").addEventListener("click", function () { hide($("pay-toast")); });
  // Coming back to the tab is the likeliest moment for the payment to have landed. A checkout this page opened that
  // left it open (a provider in another tab or app) is back when the page is seen again.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (payWatch) checkPayment();
    else if (openedHere && me && readCheckout()) watchPayment(true, true);
  });
  // Back from the provider's page out of the browser's cache: boot does not run again, so look here.
  window.addEventListener("pageshow", function (e) { if (e.persisted && me && readCheckout()) watchPayment(true, true); });

  boot();
  // The first paint was the page's own HTML (assets/app-boot.js); the screen boot() just set is the same one, so
  // app.css can stop drawing it from the boot classes. A form sent before this file arrived goes now.
  document.documentElement.classList.remove("nf-boot");
  var sentEarly = window.NfBoot && window.NfBoot.takeSubmit();
  if (sentEarly && sentEarly.requestSubmit) sentEarly.requestSubmit();
})();
