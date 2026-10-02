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
      var headers = {};
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
  function safeName(text) { return (text || "notefusion").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "notefusion"; }

  // ── State ────────────────────────────────────────────────────────────────
  var me = null;          // { fullName, email }
  var sub = null;         // SubscriptionDto
  var current = null;     // { jobId, source, result }
  var pollTimer = null;
  var osmd = null;

  // ── Auth view ────────────────────────────────────────────────────────────
  function showAuth() {
    hide($("view-app")); hide($("who")); show($("view-auth"));
  }

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
    request("/api/auth/register", { method: "POST", anonymous: true, body: { fullName: $("reg-name").value.trim(), email: $("reg-email").value.trim(), password: $("reg-password").value } })
      .then(function () {
        alertIn($("auth-alert"), "success", "Account created. Check your email for the confirmation code, confirm it in the app, then sign in here.");
        document.querySelector('.tab[data-tab="login"]').click();
        $("login-email").value = $("reg-email").value.trim();
        show($("auth-alert"));
      })
      .catch(function (err) {
        var detail = err.details ? Object.keys(err.details).map(function (k) { return err.details[k].join(" "); }).join(" ") : "";
        alertIn($("auth-alert"), "danger", (err.message || "Could not create the account.") + (detail ? " " + detail : ""));
      })
      .finally(function () { btn.disabled = false; });
  });

  $("signout").addEventListener("click", function () {
    var t = tokens();
    if (t && t.refreshToken) request("/api/auth/logout", { method: "POST", body: { refreshToken: t.refreshToken } }).catch(function () { /* best effort */ });
    clearTokens(); me = null; sub = null; stopPolling(); showAuth();
  });

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
    if (!tokens()) { showAuth(); return Promise.resolve(); }
    return loadAccount().then(function () {
      hide($("view-auth")); show($("view-app"));
      if (!isPro()) loadPlans($("upgrade-panel"), $("plans-standalone"));
      else hide($("upgrade-panel"));
      var params = new URLSearchParams(location.search);
      if (params.get("paid")) confirmPayment();
    }, function () { showAuth(); });
  }

  // ── Submitting ───────────────────────────────────────────────────────────
  $("form-link").addEventListener("submit", function (e) {
    e.preventDefault();
    var url = $("link-url").value.trim();
    if (!url) return;
    $("link-submit").disabled = true; hide($("app-alert"));
    request("/api/transcriptions/link", { method: "POST", body: { url: url, mode: "melody" } })
      .then(function (job) { startJob(job, "link"); })
      .catch(function (err) { explain(err); })
      .finally(function () { $("link-submit").disabled = false; });
  });

  $("file-input").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var form = new FormData();
    form.append("audio", file, file.name);
    form.append("mode", "melody");
    hide($("app-alert"));
    request("/api/transcriptions", { method: "POST", form: form })
      .then(function (job) { startJob(job, "upload"); })
      .catch(function (err) { explain(err); });
    e.target.value = "";
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
    alertIn($("app-alert"), "danger", text);
  }

  // ── Polling ──────────────────────────────────────────────────────────────
  function startJob(job, kind) {
    stopPolling();
    current = { jobId: job.jobId, kind: kind, source: job.source || null, result: null, startedAt: Date.now() };
    hide($("result"));
    show($("progress"));
    $("p-title").textContent = kind === "link" ? "Reading the link…" : "Transcribing your recording…";
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
    request("/api/transcriptions/jobs/" + encodeURIComponent(jobId)).then(function (job) {
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
        loadAccount();
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
      alertIn(trunc, "info", isPro()
        ? "This song runs " + formatSec(result.songDurationSec) + "; the first six minutes were transcribed."
        : "Free preview: the first minute of a " + formatSec(result.songDurationSec) + " song. Upgrade to Pro for the whole song and the download.");
    } else hide(trunc);

    var solfa = $("r-solfa-text");
    solfa.innerHTML = "";
    (result.solfaLines || []).forEach(function (line, i) {
      var div = document.createElement("div");
      if (i === 0 && /^Doh is/i.test(line)) div.className = "doh";
      div.textContent = line;
      solfa.appendChild(div);
    });

    isPro() ? hide($("r-watermark")) : show($("r-watermark"));
    isPro() ? hide($("r-upgrade")) : (show($("r-upgrade")), loadPlans($("r-upgrade"), $("plans")));
    [$("dl-pdf"), $("dl-xml"), $("dl-midi")].forEach(function (b) {
      b.innerHTML = b.textContent.replace(/\s*🔒$/, "") + (isPro() ? "" : ' <span class="lock">🔒</span>');
    });

    show($("result"));
    engrave(result.musicXml);
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function formatSec(s) {
    s = Math.round(s || 0);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  document.querySelectorAll(".result-tabs .tab[data-view]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".result-tabs .tab").forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      var staff = tab.dataset.view === "staff";
      staff ? show($("r-staff")) : hide($("r-staff"));
      staff ? hide($("r-solfa")) : show($("r-solfa"));
    });
  });

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
    var container = $("sheet");
    container.innerHTML = "";
    if (!window.opensheetmusicdisplay) {
      container.textContent = "Loading the engraver…";
      ensureOsmd().then(function () { engrave(xml); }, function () { container.textContent = "The staff engraver could not be loaded. The Tonic Solfa tab still works; check your connection and reload for the staff."; });
      return;
    }
    try {
      osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
        backend: "svg", autoResize: true, drawTitle: false, drawPartNames: false, drawMeasureNumbers: true,
        autoBeam: true, autoBeamOptions: { beam_rests: false, maintain_stem_directions: false }
      });
      osmd.load(xml).then(function () { osmd.render(); }).catch(function (err) { container.textContent = "Could not draw the staff: " + err; });
    } catch (err) { container.textContent = "Could not draw the staff: " + err; }
  }

  // ── Downloads ────────────────────────────────────────────────────────────
  function gated(fn) {
    return function () {
      if (!current || !current.result) return;
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
    var text = (r.solfaLines || []).join("\n") + "\n\n" + $("r-credit").textContent + "\n";
    download(baseName() + "-solfa.txt", new Blob([text], { type: "text/plain" }));
  });
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
      doc.save(baseName() + ".pdf");
      stage.innerHTML = "";
    });
  }

  // ── Upgrade ──────────────────────────────────────────────────────────────
  var plansCache = null;
  function loadPlans(panel, grid) {
    show(panel);
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
