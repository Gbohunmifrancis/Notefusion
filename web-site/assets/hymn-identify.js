/* "Hum to find a hymn" (/hymns/identify). The visitor hums up to twenty seconds in the site's recorder
 * (assets/recorder.js) or picks a recording; it goes to the API's anonymous POST /api/hymns/identify, and the
 * page shows the hymn found, with a link to its solfa page, or how to hum it so it is recognised. Every
 * outcome is one first-party event: nfTrack("Hymn identify", "found;slug=…" | "not found;notes=…" |
 * "too short;notes=…" | "error;code=…"). Plain script, no build step.
 *
 * window.NfHymnIdentify.render(answer) draws a result without the network (the tests use it). */
(function () {
  "use strict";
  var API = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:5080" : "https://api.notefusion.studio";
  var MAX_SECONDS = 20;
  var TIMEOUT_MS = 45000;
  var SITE = "https://notefusion.studio";

  function $(id) { return document.getElementById(id); }
  var start = $("identify-start"), record = $("identify-record"), file = $("identify-file");
  var status = $("identify-status"), result = $("identify-result");
  if (!start || !record || !status || !result) return;

  function deviceId() {
    try {
      var id = localStorage.getItem("nf.web.device");
      if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); localStorage.setItem("nf.web.device", id); }
      return id;
    } catch (e) { return ""; }
  }
  function track(detail) { try { if (window.nfTrack) window.nfTrack("Hymn identify", detail); } catch (e) { /* never in the way */ } }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  /** The hymn's page as a path on this site (so it works on a preview deploy), or the address as given. */
  function pageHref(url) {
    try {
      var u = new URL(url, SITE);
      return u.origin === SITE ? u.pathname : u.href;
    } catch (e) { return "/hymns"; }
  }

  function say(text, kind) {
    status.textContent = "";
    status.className = "identify-status" + (kind ? " is-" + kind : "");
    if (kind === "listening") {
      var wave = el("span", "identify-wave"); wave.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 5; i++) wave.appendChild(el("span"));
      status.appendChild(wave);
    }
    if (text) status.appendChild(document.createTextNode(text));
  }
  function showStart(on) { start.hidden = !on; }
  /** A microphone the browser blocks for this site: how to let it listen again, step by step (board l-ux-high/06d). */
  function sayBlocked() {
    say("The microphone is blocked for this site. To hum here, allow it again:", "error");
    var steps = el("ol", "identify-steps");
    ["Tap the lock (or settings) icon beside the address.", "Choose Permissions › Microphone › Allow.", "Then tap Hum a tune, or choose a recording instead."]
      .forEach(function (t) { steps.appendChild(el("li", null, t)); });
    status.appendChild(steps);
  }
  function clearResult() { result.hidden = true; result.className = "identify-result"; result.textContent = ""; }

  function againButton(label) {
    var b = el("button", "identify-again", label || "Hum another tune");
    b.type = "button";
    b.setAttribute("data-track", "Hymn identify: again");
    b.addEventListener("click", function () { clearResult(); say(""); showStart(true); openRecorder(); });
    return b;
  }

  function showResult(node, missed) {
    result.textContent = "";
    result.appendChild(node);
    result.className = "identify-result" + (missed ? " is-missed" : "");
    result.hidden = false;
    showStart(false);
    say("");
    try { result.focus({ preventScroll: false }); } catch (e) { result.focus(); }
  }

  function renderFound(m) {
    var box = el("div");
    var href = pageHref(m.url), external = href.indexOf("http") === 0;
    box.appendChild(el("p", "kicker", "This sounds like"));
    var h = el("h2"), a = el("a", null, m.title);
    a.href = href; a.setAttribute("data-track", "Hymn identify: open hymn");
    if (external) a.rel = "noopener";
    h.appendChild(a); box.appendChild(h);
    if (m.firstLine) box.appendChild(el("p", "first-line", "“" + m.firstLine + "”"));
    var meta = m.kind === "tune" ? "The hymn tune " + m.title : m.tune ? "Tune: " + m.tune : "";
    if (meta) box.appendChild(el("p", "story-meta", meta));
    var actions = el("div", "identify-actions");
    var go = el("a", "cta-button");
    go.href = href;
    go.setAttribute("data-track", "Hymn identify: see solfa");
    if (external) go.rel = "noopener";
    go.appendChild(document.createTextNode(m.kind === "incipit" ? "Read about this hymn " : m.kind === "tune" ? "See the tune in solfa and play it " : "See the solfa and play it "));
    var arrow = el("span", null, "→"); arrow.setAttribute("aria-hidden", "true"); go.appendChild(arrow);
    actions.appendChild(go);
    actions.appendChild(againButton());
    box.appendChild(actions);
    showResult(box, false);
  }

  function renderMissed(answer) {
    var box = el("div");
    var short = answer && answer.tooShort;
    box.appendChild(el("h2", null, short ? "That was too short to tell" : "We couldn't place that tune"));
    box.appendChild(el("p", null, short
      ? "We need about a line of the tune to name a hymn — a dozen notes or more. Hum the first line or two, then press Stop."
      : "Try humming the first line slowly and clearly. It may also be a hymn we don't have yet."));
    var tips = el("ul");
    ["Start from the beginning of the hymn or of its chorus.",
      "Hum one clear note at a time, a little slower than you would sing it.",
      "Find a quiet spot, with no music playing in the background."].forEach(function (t) { tips.appendChild(el("li", null, t)); });
    box.appendChild(tips);
    var actions = el("div", "identify-actions");
    actions.appendChild(againButton("Try again"));
    var browse = el("a", null, "Browse all the hymns");
    browse.href = "/hymns"; browse.setAttribute("data-track", "Hymn identify: browse");
    actions.appendChild(browse);
    box.appendChild(actions);
    showResult(box, true);
  }

  function render(answer) {
    if (answer && answer.match) { renderFound(answer.match); track("found;slug=" + answer.match.slug); }
    else { renderMissed(answer); track((answer && answer.tooShort ? "too short" : "not found") + ";notes=" + ((answer && answer.notesHeard) || 0)); }
  }

  // What a visitor reads when the API says no: the hymn finder's own sentences (and the rate limit's) pass
  // through; anything else, or anything technical, becomes one plain line.
  var OWN = /^(HYMN_[A-Z_]+|RATE_LIMITED)$/;
  function failure(code, message, status) {
    var text = OWN.test(code || "") && message ? message
      : code === "TIMEOUT" ? "This is taking longer than usual. Please try again in a moment."
      : status === 0 ? "We couldn't reach NoteFusion. Check your connection and try again."
      : "Something went wrong on our side. Please try again in a moment.";
    showStart(true);
    say(text, "error");
    track("error;code=" + (code || (status ? "HTTP " + status : "network")));
  }

  function send(blob, name) {
    clearResult();
    showStart(false);
    say("Finding your hymn… usually a few seconds.", "listening");
    var form = new FormData();
    form.append("audio", blob, name || "hum.webm");
    var ctrl = window.AbortController ? new AbortController() : null;
    // A slow answer is not a lost connection: the abort is told apart from a network failure.
    var timedOut = false;
    var timer = setTimeout(function () { timedOut = true; if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var headers = {};
    var dev = deviceId();
    if (dev) headers["X-Device-Id"] = dev;
    fetch(API + "/api/hymns/identify", { method: "POST", headers: headers, body: form, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        return r.text().then(function (text) {
          var body = null;
          try { body = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
          if (!r.ok) { failure(body && body.code, body && body.message, r.status); return; }
          if (!body) { failure(null, null, r.status); return; }
          render(body);
        });
      })
      .catch(function () { failure(timedOut ? "TIMEOUT" : null, null, 0); })
      .then(function () { clearTimeout(timer); });
  }

  function openRecorder() {
    if (!window.NfRecorder) { failure(null, null, -1); return; }
    window.NfRecorder.open({
      maxSeconds: MAX_SECONDS,
      useLabel: "Find this hymn",
      onTake: function (blob, name) { send(blob, name); },
      onError: function (text, kind) {
        showStart(true);
        if (kind === "blocked") { sayBlocked(); return; }
        say(text + (kind === "short" ? "" : " You can choose a recording instead."), "error");
      }
    });
  }

  record.addEventListener("click", function () { clearResult(); say(""); openRecorder(); });
  if (file) file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    file.value = "";
    if (f) send(f, f.name);
  });
  record.disabled = false;

  window.NfHymnIdentify = { render: render };
})();
