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
  function clearTokens() { try { localStorage.removeItem(TOKENS_KEY); } catch (e) { /* ignore */ } }

  function ApiError(status, body) {
    this.status = status;
    this.code = (body && body.code) || "UNKNOWN";
    this.message = (body && body.message) || ("Request failed (" + status + ")");
    this.details = (body && body.details) || null;
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
      return fetch(API + path, { method: opts.method || "GET", headers: headers, body: body });
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
  function safeName(text) { return (text || "notefusion").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "notefusion"; }

  // ── State ────────────────────────────────────────────────────────────────
  var me = null;          // { fullName, email }
  var sub = null;         // SubscriptionDto
  var current = null;     // { jobId, kind, source, result, savedId, shareToken, semitones }
  var pollTimer = null;
  var osmd = null;
  var C = window.NfChoir;
  var guest = false;      // a visitor with a preview and no account
  var previewId = new URLSearchParams(location.search).get("preview");
  var player = null;      // the rehearsal player, made once the first result shows
  var hymnCells = [];     // solfa cells of the hymn layout, for the playback cursor

  // ── Auth view ────────────────────────────────────────────────────────────
  function showAuth() {
    hide($("boot-skel")); hide($("view-app")); hide($("who")); show($("view-auth"));
    if (new URLSearchParams(location.search).get("signup")) selectAuthTab("register");
    maybeOnboard();
  }
  function selectAuthTab(name) {
    var tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.click();
  }

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

  document.querySelectorAll(".tabs[role=tablist] .tab[data-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab[data-tab]").forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      var login = tab.dataset.tab === "login";
      login ? show($("form-login")) : hide($("form-login"));
      login ? hide($("form-register")) : show($("form-register"));
      hide($("auth-alert"));
    });
  });

  $("form-login").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; hide($("auth-alert"));
    request("/api/auth/login", { method: "POST", anonymous: true, body: { email: $("login-email").value.trim(), password: $("login-password").value } })
      .then(function (res) {
        saveTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
        return boot();
      })
      .catch(function (err) { alertIn($("auth-alert"), "danger", err.message || "Could not sign in."); })
      .finally(function () { btn.disabled = false; });
  });

  $("form-register").addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true; hide($("auth-alert"));
    request("/api/auth/register", { method: "POST", anonymous: true, body: { fullName: $("reg-name").value.trim(), email: $("reg-email").value.trim(), password: $("reg-password").value, source: "web" } })
      .then(function (res) {
        pendingEmail = (res && res.email) || $("reg-email").value.trim();
        $("verify-email-label").textContent = pendingEmail;
        hide($("form-register")); hide($("form-login")); show($("form-verify"));
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
        hide($("form-verify")); show($("form-login"));
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

  // Guest → account: every "create an account" button opens the auth card under the result.
  function openAuth(tab) {
    var auth = $("view-auth");
    document.querySelector("main").appendChild(auth); // below the sheet, so the preview stays in view
    show(auth);
    document.querySelector('.tab[data-tab="' + tab + '"]').click();
    auth.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  ["guest-signup", "guest-cta-signup"].forEach(function (id) { $(id).addEventListener("click", function () { openAuth("register"); }); });
  ["guest-signin", "guest-cta-signin"].forEach(function (id) { $(id).addEventListener("click", function () { openAuth("login"); }); });

  $("signout").addEventListener("click", function () {
    var t = tokens();
    if (t && t.refreshToken) request("/api/auth/logout", { method: "POST", body: { refreshToken: t.refreshToken } }).catch(function () { /* best effort */ });
    clearTokens(); me = null; sub = null; libraryCache = null; stopPolling(); hide($("top-nav")); showAuth();
  });

  // ── Views: transcribe / library / account ───────────────────────────────
  function setView(name) {
    ["transcribe", "library", "account"].forEach(function (v) { v === name ? show($("view-" + v)) : hide($("view-" + v)); });
    document.querySelectorAll("#top-nav .top-link").forEach(function (b) { b.classList.toggle("on", b.dataset.view === name); });
    if (name === "library") loadLibrary();
    if (name === "account") renderAccount();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.querySelectorAll("#top-nav .top-link").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });

  var libraryCache = null;
  function loadLibrary(force) {
    var list = $("lib-list"), empty = $("lib-empty"), skel = $("lib-skel");
    if (!libraryCache || force) { show(skel); hide(list); hide(empty); }
    var p = libraryCache && !force ? Promise.resolve(libraryCache) : request("/api/library").then(function (items) { libraryCache = items || []; return libraryCache; });
    return p.then(function (items) {
      hide(skel);
      list.innerHTML = "";
      if (!items.length) { show(empty); hide(list); return; }
      hide(empty); show(list);
      items.forEach(function (it) {
        var card = document.createElement("div"); card.className = "lib-item";
        var h = document.createElement("h3"); h.textContent = it.title || "Untitled"; card.appendChild(h);
        var m = document.createElement("div"); m.className = "meta";
        m.textContent = [it.key, it.tempoBpm ? it.tempoBpm + " BPM" : "", it.timeSignature, new Date(it.createdAtUtc).toLocaleDateString()].filter(Boolean).join(" · ") + (it.shareToken ? " · shared" : "");
        card.appendChild(m);
        var a = document.createElement("div"); a.className = "actions";
        var open = document.createElement("button"); open.className = "btn btn-primary btn-sm"; open.type = "button"; open.textContent = "Open";
        open.addEventListener("click", function () { openSaved(it.id); });
        var del = document.createElement("button"); del.className = "btn btn-ghost btn-sm"; del.type = "button"; del.textContent = "Delete";
        del.addEventListener("click", function () {
          if (!confirm("Delete \u201c" + (it.title || "Untitled") + "\u201d from your library? This cannot be undone.")) return;
          del.disabled = true;
          request("/api/library/" + it.id, { method: "DELETE" }).then(function () { libraryCache = null; loadLibrary(true); })
            .catch(function (err) { alertIn($("app-alert"), "danger", "Could not delete: " + (err.message || err)); del.disabled = false; });
        });
        a.appendChild(open); a.appendChild(del); card.appendChild(a);
        list.appendChild(card);
      });
    }).catch(function (err) { hide(skel); show(empty); empty.textContent = "Your library could not be loaded: " + (err.message || err); });
  }
  /** A saved sheet, opened into the same result view a fresh transcription uses. */
  function openSaved(id) {
    stopPolling();
    request("/api/library/" + id).then(function (t) {
      var result = {
        key: t.key, tempo: t.tempoBpm, timeSignature: t.timeSignature, notes: t.notes || [], musicXml: t.musicXml || "",
        overallConfidence: t.overallConfidence || 0, parts: t.parts || null, partsMusicXml: t.partsMusicXml || "",
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
    $("acct-email").textContent = me ? (me.email || "—") : "—";
    $("acct-plan").textContent = isPro() ? "Pro" : "Free";
    $("acct-credits").textContent = sub ? (isPro() ? sub.songCreditsRemaining + " of " + sub.songCreditsTotal + " songs left" : (sub.songCreditsRemaining > 0 ? "1 free song preview" : "Preview used")) : "—";
    var since = me && (me.createdAtUtc || me.createdAt);
    $("acct-since").textContent = since ? new Date(since).toLocaleDateString(undefined, { year: "numeric", month: "long" }) : "—";
    isPro() ? hide($("acct-upgrade")) : show($("acct-upgrade"));
    (libraryCache ? Promise.resolve(libraryCache) : request("/api/library").then(function (items) { libraryCache = items || []; return libraryCache; }))
      .then(function (items) { $("acct-saved").textContent = String(items.length); }, function () { $("acct-saved").textContent = "—"; });
  }
  $("acct-upgrade").addEventListener("click", function () { setView("transcribe"); show($("upgrade-panel")); loadPlans($("upgrade-panel"), $("plans-standalone")); $("upgrade-panel").scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("acct-signout").addEventListener("click", function () { $("signout").click(); });

  // ── App view ─────────────────────────────────────────────────────────────
  function isPro() { return !!(sub && sub.isActive); }

  function renderWho() {
    $("who-name").textContent = me ? (me.fullName || me.email || "") : "";
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
      hide($("boot-skel")); hide($("view-auth")); hide($("guest-bar")); show($("view-app")); show($("top-nav")); setView("transcribe"); libraryCache = null;
      if (new URLSearchParams(location.search).get("upgrade") && !isPro()) { show($("upgrade-panel")); setTimeout(function () { $("upgrade-panel").scrollIntoView({ behavior: "smooth", block: "start" }); }, 50); }
      if (!isPro()) loadPlans($("upgrade-panel"), $("plans-standalone"));
      else hide($("upgrade-panel"));
      var params = new URLSearchParams(location.search);
      if (params.get("paid")) confirmPayment();
      if (previewId) {
        // The preview that brought this person here is now theirs: the funnel's conversion.
        request("/api/preview/jobs/" + encodeURIComponent(previewId) + "/claim", { method: "POST" }).catch(function () { /* best effort */ });
        if (wasGuest && current && current.result) showResult(current.result);
        else if (!current) startJob({ jobId: previewId, stage: "transcribing" }, "preview");
      }
    }, function () { showAuth(); });
  }

  /** A visitor with a preview and no account: the app, read-only, with the sign-up card ready. */
  function startGuest() {
    guest = true;
    hide($("boot-skel")); hide($("view-auth")); show($("view-app")); show($("guest-bar")); hide($("upgrade-panel")); hide($("top-nav")); setView("transcribe");
    startJob({ jobId: previewId, stage: "transcribing" }, "preview");
  }

  // ── Submitting ───────────────────────────────────────────────────────────
  $("form-link").addEventListener("submit", function (e) {
    e.preventDefault();
    var url = $("link-url").value.trim();
    if (!url) return;
    $("link-submit").disabled = true; hide($("app-alert"));
    request(guest ? "/api/preview/link" : "/api/transcriptions/link", { method: "POST", anonymous: guest, body: { url: url, mode: "melody", audioPreview: false } })
      .then(function (job) { startJob(job, guest ? "preview" : "link"); })
      .catch(function (err) { explain(err); })
      .finally(function () { $("link-submit").disabled = false; });
  });

  function uploadKind() { var el = document.querySelector('input[name="upload-kind"]:checked'); return el ? el.value : "hum"; }
  function submitAudio(file, name) {
    var song = uploadKind() === "song";
    var form = new FormData();
    form.append("audio", file, name);
    form.append("mode", "melody");
    // A song with a band behind the voice is separated first; a hummed tune is not.
    form.append("separate", song ? "true" : "false");
    // The browser renders its own playback from the notes: the server's piano WAV (about
    // 10 MB and nine seconds of synthesis for a three-minute song) is not wanted here.
    form.append("audioPreview", "false");
    hide($("app-alert"));
    return request(guest ? "/api/preview" : "/api/transcriptions", { method: "POST", anonymous: guest, form: form })
      .then(function (job) { startJob(Object.assign({}, job, { stage: job.stage || (song ? "separating" : "transcribing") }), guest ? "preview" : "upload"); })
      .catch(function (err) { explain(err); });
  }
  $("file-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    submitAudio(file, file.name);
    e.target.value = "";
  });

  // ── Record a tune in the browser ─────────────────────────────────────────
  var rec = { recorder: null, chunks: [], timer: null, stopAt: null, started: 0, MAX_SEC: 180 };
  function stopRecording() {
    if (rec.timer) clearInterval(rec.timer); if (rec.stopAt) clearTimeout(rec.stopAt); rec.timer = rec.stopAt = null;
    if (rec.recorder && rec.recorder.state !== "inactive") rec.recorder.stop();
    $("rec-btn").textContent = "🎤 Record a tune";
  }
  $("rec-btn").addEventListener("click", function () {
    if (rec.recorder && rec.recorder.state === "recording") { stopRecording(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { $("rec-status").textContent = "This browser cannot record; upload a file instead."; return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (stream) {
      rec.chunks = [];
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      rec.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.recorder.addEventListener("dataavailable", function (ev) { if (ev.data && ev.data.size) rec.chunks.push(ev.data); });
      rec.recorder.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var type = rec.recorder.mimeType || mime || "audio/webm";
        var blob = new Blob(rec.chunks, { type: type });
        if (blob.size < 2000) { $("rec-status").textContent = "That was too short to hear. Hum for a few seconds."; return; }
        $("rec-status").textContent = "";
        document.querySelector('input[name="upload-kind"][value="hum"]').checked = true;
        submitAudio(blob, type.indexOf("mp4") >= 0 ? "hum.mp4" : "hum.webm");
      });
      rec.recorder.start();
      rec.started = Date.now();
      rec.timer = setInterval(function () {
        var left = Math.max(0, rec.MAX_SEC - Math.floor((Date.now() - rec.started) / 1000));
        $("rec-btn").textContent = "■ Stop (" + left + "s)";
        $("rec-status").textContent = "Recording… hum or sing, then press Stop.";
      }, 250);
      rec.stopAt = setTimeout(stopRecording, rec.MAX_SEC * 1000);
    }).catch(function () { $("rec-status").textContent = "Microphone access is needed to record. Upload a file instead."; });
  });

  function explain(err) {
    var text = err.message || "Something went wrong.";
    if (err.code === "BILLING_SONG_PREVIEW_USED" || err.code === "BILLING_FREE_TIER_LIMIT") {
      alertIn($("app-alert"), "info", text);
      show($("upgrade-panel")); loadPlans($("upgrade-panel"), $("plans-standalone"));
      $("upgrade-panel").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (err.code === "BILLING_SONG_CREDITS_EXHAUSTED") { alertIn($("app-alert"), "info", text); return; }
    if (err.code === "PREVIEW_LIMIT_REACHED") { alertIn($("app-alert"), "info", text); openAuth("register"); return; }
    alertIn($("app-alert"), "danger", text);
  }

  // ── Polling ──────────────────────────────────────────────────────────────
  function startJob(job, kind) {
    stopPolling();
    current = { jobId: job.jobId, kind: kind, source: job.source || null, result: null, startedAt: Date.now(), savedId: null, shareToken: null, lyrics: "", semitones: 0 };
    $("save-title").value = "";
    hide($("result"));
    show($("progress"));
    $("p-title").textContent = kind === "link" ? "Reading the link…" : kind === "preview" ? "Making your free preview…" : job.stage === "separating" ? "Isolating the voice…" : "Transcribing your recording…";
    current.preview = kind === "preview";
    if (current.preview) previewId = job.jobId;
    $("p-artist").textContent = "";
    hide($("p-thumb"));
    $("p-bar").style.width = "3%";
    setStage(job.stage || (kind === "link" ? "fetching" : "transcribing"));
    $("progress").scrollIntoView({ behavior: "smooth", block: "start" });
    poll();
  }
  function stopPolling() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

  function setStage(stage) {
    var order = ["fetching", "separating", "transcribing"];
    var idx = order.indexOf(stage);
    document.querySelectorAll("#p-stages .stage").forEach(function (el) {
      var i = order.indexOf(el.dataset.stage);
      el.classList.remove("on", "done");
      if (idx < 0) { if (el.dataset.stage === "transcribing") el.classList.add("on"); return; }
      if (i < idx) el.classList.add("done");
      if (i === idx) el.classList.add("on");
    });
  }

  function poll() {
    if (!current) return;
    var jobId = current.jobId;
    request((current.preview ? "/api/preview/jobs/" : "/api/transcriptions/jobs/") + encodeURIComponent(jobId), { anonymous: current.preview && guest }).then(function (job) {
      if (!current || current.jobId !== jobId) return;
      if (job.source) {
        current.source = job.source;
        $("p-title").textContent = job.source.title || "Untitled";
        $("p-artist").textContent = job.source.artist || "";
        if (job.source.thumbnailUrl) { $("p-thumb").src = job.source.thumbnailUrl; show($("p-thumb")); }
      }
      if (job.stage) setStage(job.stage);
      var pct = Math.max(3, Math.round((job.progress || 0) * 100));
      $("p-bar").style.width = pct + "%";
      var status = String(job.status || "").toLowerCase();
      if (status === "done" && job.result) {
        current.result = job.result;
        hide($("progress"));
        showResult(job.result);
        if (!guest) loadAccount();
        return;
      }
      if (status === "failed") {
        hide($("progress"));
        alertIn($("app-alert"), "danger", job.error || "That could not be transcribed. Try a cleaner recording or a different link.");
        return;
      }
      pollTimer = setTimeout(poll, POLL_MS);
    }).catch(function (err) {
      if (err.status === 401) return;
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
      ? "Lead vocal transcribed from “" + (src.title || "Untitled") + "”" + (src.artist ? " by " + src.artist : "") + " (" + providerName(src.provider) + ") with NoteFusion."
      : "Transcribed with NoteFusion.";
    var chips = $("r-chips");
    chips.innerHTML = "";
    [result.key, result.tempo + " BPM", result.timeSignature, Math.round((result.overallConfidence || 0) * 100) + "% confidence"].forEach(function (text) {
      var c = document.createElement("span"); c.className = "chip"; c.textContent = text; chips.appendChild(c);
    });
    var trunc = $("r-truncated");
    if (result.truncated) {
      alertIn(trunc, "info", guest
        ? "Free preview: the first 30 seconds of " + formatSec(result.songDurationSec) + ". Create a free account for more."
        : isPro()
          ? "This song runs " + formatSec(result.songDurationSec) + "; the first six minutes were transcribed."
          : "Free preview: the first minute of a " + formatSec(result.songDurationSec) + " song. Upgrade to Pro for the whole song and the download.");
    } else hide(trunc);

    renderSolfa(result);
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
    [$("dl-pdf"), $("dl-xml"), $("dl-midi")].forEach(function (b) {
      b.innerHTML = b.textContent.replace(/\s*🔒$/, "") + (isPro() ? "" : ' <span class="lock">🔒</span>');
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

  /** The solfa lines, and under them the hymn-book layout once there are words. */
  function renderSolfa(result) {
    var lines = result.solfaLines && result.solfaLines.length > 1 ? result.solfaLines : C.renderLines(result.notes || [], C.keyHeader(result.key), result.timeSignature);
    var hasLyrics = !!(current.lyrics && current.lyrics.trim());
    var solfa = $("r-solfa-text");
    solfa.innerHTML = "";
    (hasLyrics ? lines.slice(0, 1) : lines).forEach(function (line, i) {
      var div = document.createElement("div");
      if (i === 0 && /^Doh is/i.test(line)) div.className = "doh";
      div.textContent = line;
      solfa.appendChild(div);
    });
    var hymn = $("r-hymn"); hymn.innerHTML = ""; hymnCells = [];
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
        $("play").textContent = t.playing ? "❚❚ Pause" : "▶ Play";
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
    // The starting note on the same piano the rehearsal player uses, held for the bar.
    C.pianoNote(ctx, C.createPianoOutput(ctx), first ? first.pitchMidi : 60, bpb * beat, t0, 0.9);
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
      : request("/api/transcriptions/transpose", { method: "POST", body: { key: r.key, semitones: n, notes: r.notes, musicXml: r.musicXml, parts: r.parts || null, partsMusicXml: r.partsMusicXml || null } });
    req.then(function (moved) {
      current.semitones = 0;
      var next = Object.assign({}, r, {
        key: moved.key, notes: moved.notes || [], musicXml: moved.musicXml || "",
        parts: moved.parts || null, partsMusicXml: moved.partsMusicXml || "",
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
  $("save").addEventListener("click", function () {
    if (!current || !current.result) return;
    var r = current.result, btn = $("save");
    btn.disabled = true;
    request("/api/library", { method: "POST", body: {
      title: $("save-title").value.trim() || "My transcription", key: r.key, tempoBpm: r.tempo, timeSignature: r.timeSignature,
      musicXml: r.musicXml, notes: r.notes, overallConfidence: r.overallConfidence, sourceJobId: current.jobId,
      lyrics: (current.lyrics || "").trim(), parts: (isPro() && r.parts) ? r.parts : null, partsMusicXml: (isPro() && r.partsMusicXml) ? r.partsMusicXml : null
    } }).then(function (saved) {
      current.savedId = saved.id; current.title = saved.title; current.shareToken = saved.shareToken || null;
      libraryCache = null;
      renderSave();
      var dismissed = false; try { dismissed = localStorage.getItem("nf.web.appBanner") === "no"; } catch (e) { /* ignore */ }
      if (!dismissed) show($("app-banner"));
    }).catch(function (err) { alertIn($("app-alert"), "danger", "Could not save: " + (err.message || err)); })
      .finally(function () { btn.disabled = false; });
  });
  $("app-banner-dismiss").addEventListener("click", function () { hide($("app-banner")); try { localStorage.setItem("nf.web.appBanner", "no"); } catch (e) { /* ignore */ } });
  $("share").addEventListener("click", function () {
    if (!current || !current.savedId) return;
    var btn = $("share"); btn.disabled = true;
    request("/api/library/" + current.savedId + "/share", { method: "POST" })
      .then(function (link) { current.shareToken = link.token; renderShare(); $("share-url").select(); })
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
        engraveInto($("sheet-parts"), current.result.partsMusicXml);
      }
    });
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
    try { osmd = engraveInto($("sheet"), xml); }
    finally { hide(skel); $("sheet").classList.remove("hidden"); }
  }

  function engraveInto(container, xml) {
    container.innerHTML = "";
    if (!xml) { container.textContent = "Nothing to engrave."; return null; }
    if (!window.opensheetmusicdisplay) {
      container.textContent = "Loading the engraver…";
      ensureOsmd().then(function () { engraveInto(container, xml); }, function () { container.textContent = "The staff engraver could not be loaded. The Tonic Solfa tab still works; check your connection and reload for the staff."; });
      return null;
    }
    try {
      var display = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
        backend: "svg", autoResize: true, drawTitle: false, drawPartNames: true, drawMeasureNumbers: true,
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
    var r = current.result;
    var text = (r.solfaLines || []).join("\n") + (current.lyrics && current.lyrics.trim() ? "\n\n" + current.lyrics.trim() : "") + "\n\n" + $("r-credit").textContent + "\n";
    download(baseName() + "-solfa.txt", new Blob([text], { type: "text/plain" }));
  });
  $("dl-parts").addEventListener("click", gated(function (r) {
    if (!r.partsMusicXml) return;
    download(baseName() + "-satb.musicxml", new Blob([r.partsMusicXml], { type: "application/vnd.recordare.musicxml+xml" }));
  }));
  $("dl-pdf").addEventListener("click", gated(function (r) {
    var btn = $("dl-pdf"); btn.disabled = true;
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
      backend: "canvas", autoResize: false, pageFormat: "A4_P", drawTitle: false, drawPartNames: false,
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
      if (words) {
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
  function loadPlans(panel, grid) {
    show(panel);
    if (!plansCache) { grid.innerHTML = ""; for (var i = 0; i < 2; i++) { var sk = document.createElement("div"); sk.className = "skel skel-plan"; grid.appendChild(sk); } }
    var p = plansCache ? Promise.resolve(plansCache) : request("/api/billing/plans").then(function (list) { plansCache = list; return list; });
    p.then(function (plans) {
      grid.innerHTML = "";
      var monthly = plans.find(function (x) { return x.interval === "monthly" || x.interval === 0; });
      plans.forEach(function (plan) {
        var card = document.createElement("div"); card.className = "plan";
        var price = document.createElement("div"); price.className = "price"; price.textContent = money(plan);
        var per = document.createElement("div"); per.className = "per";
        var yearly = plan.interval === "yearly" || plan.interval === 1;
        per.textContent = yearly ? "per year" : "per month";
        card.appendChild(price); card.appendChild(per);
        if (yearly && monthly) {
          var saving = Math.round(100 - (plan.amountMinor / (monthly.amountMinor * 12)) * 100);
          if (saving > 0) { var s = document.createElement("div"); s.className = "save"; s.textContent = "Save " + saving + "% vs monthly"; card.appendChild(s); }
        }
        var btn = document.createElement("button"); btn.className = "btn " + (yearly ? "btn-gold" : "btn-primary"); btn.type = "button";
        btn.textContent = "Upgrade — " + plan.name;
        btn.addEventListener("click", function () { checkout(plan, btn); });
        card.appendChild(btn);
        grid.appendChild(card);
      });
      if (!plans.length) grid.textContent = "No plan is available for your region yet.";
    }).catch(function () { grid.textContent = "Plans could not be loaded right now."; });
  }

  function money(plan) {
    var amount = plan.amountMinor / 100;
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: plan.currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount); }
    catch (e) { return plan.currency + " " + amount.toFixed(2); }
  }

  function checkout(plan, btn) {
    btn.disabled = true;
    request("/api/billing/checkout", { method: "POST", body: { planId: plan.id } })
      .then(function (session) {
        var w = window.open(session.checkoutUrl, "_blank", "noopener");
        if (!w) location.href = session.checkoutUrl;
        alertIn($("app-alert"), "info", "Complete the payment in the new tab. This page updates when you come back.");
        window.addEventListener("focus", confirmPayment, { once: true });
      })
      .catch(function (err) { alertIn($("app-alert"), "danger", err.message || "Could not start the checkout."); })
      .finally(function () { btn.disabled = false; });
  }

  function confirmPayment() {
    request("/api/billing/confirm", { method: "POST" }).catch(function () { return null; })
      .then(function () { return loadAccount(); })
      .then(function () {
        if (isPro()) {
          alertIn($("app-alert"), "success", "You're on Pro. Downloads and full songs are unlocked.");
          hide($("upgrade-panel")); hide($("r-upgrade")); hide($("r-watermark"));
          if (current && current.result) showResult(current.result);
        }
      });
  }

  boot();
})();
