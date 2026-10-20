/* The recording pop-up: the microphone opens into a panel that shows what it hears (a level
 * meter and the clock), and nothing is sent until the take has been listened to and approved.
 * One panel serves the home page, the guest box and the signed-in studio, so recording looks
 * and works the same wherever "Record a tune" is pressed. Plain script, no build step.
 *
 *   NfRecorder.open({ maxSeconds: 30, onTake: function (blob, name, seconds) {…}, onError: function (text, kind) {…} })
 *
 * `useLabel` names the button that sends the take ("Transcribe this take" when it is not given).
 * `onError` gets a plain sentence and a kind ("unsupported" | "blocked" | "nomic" | "busy" | "short"), so the page can add
 * its own way out ("Upload a file instead."). `sounds(name)` ("start" | "stop" | "error") and
 * `track(name)` are optional hooks. */
(function () {
  "use strict";
  var panel = null, els = {}, meterBars = [];
  var rec = { recorder: null, chunks: [], timer: null, stopAt: null, started: 0, stream: null, audioCtx: null, analyser: null, raf: null, blob: null, name: "", url: null, discard: false, opts: null, opening: false, opener: null, layer: null };

  /** An icon from the site's sprite (Lucide, /assets/icons.svg). */
  function icon(id) {
    return '<svg class="nf-rec-ic" aria-hidden="true"><use href="/assets/icons.svg#i-' + id + '"/></svg>';
  }
  var ICONS = { stop: icon("stop"), check: icon("check"), restart: icon("restart"), wave: icon("wave") };
  function fmtClock(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }

  function build() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = "nf-rec"; panel.id = "nf-rec"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-labelledby", "nf-rec-title");
    panel.innerHTML =
      '<div class="nf-rec-card">' +
        '<div class="nf-rec-live">' +
          '<div class="nf-rec-orb"><span class="nf-rec-mark" aria-hidden="true"></span></div>' +
          '<h2 class="nf-rec-heading" id="nf-rec-title"><span class="nf-rec-dot"></span>Recording</h2>' +
          '<p class="nf-rec-time"><span class="nf-rec-elapsed">0:00</span><span class="nf-rec-muted nf-rec-max"> / 3:00</span></p>' +
          '<div class="nf-rec-meter" aria-hidden="true"></div>' +
          '<p class="nf-rec-lead">Hum or sing the tune. Keep going until the phrase is finished, then press Stop.</p>' +
          '<div class="nf-rec-actions">' +
            '<button class="nf-rec-btn nf-rec-ghost nf-rec-cancel" type="button">Cancel</button>' +
            '<button class="nf-rec-btn nf-rec-stop" type="button">' + ICONS.stop + "Stop</button>" +
          "</div>" +
        "</div>" +
        '<div class="nf-rec-review" hidden>' +
          '<div class="nf-rec-orb done">' + ICONS.check + "</div>" +
          '<h2 class="nf-rec-heading" id="nf-rec-review-title">Here’s your take</h2>' +
          '<p class="nf-rec-time"><span class="nf-rec-length">0:00</span><span class="nf-rec-muted"> recorded</span></p>' +
          '<audio class="nf-rec-audio" controls preload="auto"></audio>' +
          '<p class="nf-rec-lead">Listen back. If it’s the phrase you meant, send it off; otherwise record it again.</p>' +
          '<div class="nf-rec-actions">' +
            '<button class="nf-rec-btn nf-rec-ghost nf-rec-discard" type="button">Discard</button>' +
            '<button class="nf-rec-btn nf-rec-ghost nf-rec-again" type="button">' + ICONS.restart + "Record again</button>" +
            '<button class="nf-rec-btn nf-rec-primary nf-rec-use" type="button">' + ICONS.wave + "Transcribe this take</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(panel);
    ["live", "review", "elapsed", "max", "meter", "length", "audio", "cancel", "stop", "discard", "again", "use"].forEach(function (k) { els[k] = panel.querySelector(".nf-rec-" + k); });
    for (var i = 0; i < 28; i++) { var bar = document.createElement("span"); els.meter.appendChild(bar); meterBars.push(bar); }
    els.stop.addEventListener("click", stopRecording);
    els.cancel.addEventListener("click", function () {
      rec.discard = true;
      if (rec.recorder && rec.recorder.state === "recording") stopRecording(); else { teardown(); close(); }
    });
    els.discard.addEventListener("click", close);
    els.again.addEventListener("click", function () { var opts = rec.opts; close(); start(opts); });
    els.use.addEventListener("click", function () {
      if (!rec.blob) return;
      var blob = rec.blob, name = rec.name, seconds = rec.seconds, opts = rec.opts;
      close();
      hook(opts, "track", "Recording sent");
      if (opts.onTake) opts.onTake(blob, name, seconds);
    });
    document.addEventListener("keydown", function (ev) {
      if (panel.hidden) return;
      if (ev.key === "Escape") { ev.preventDefault(); (rec.recorder && rec.recorder.state === "recording" ? els.cancel : els.discard).click(); return; }
      if (ev.key !== "Tab") return;
      // Focus stays inside the dialog: Tab from the last control wraps to the first and back.
      var pane = els.live.hidden ? els.review : els.live;
      var stops = Array.prototype.filter.call(pane.querySelectorAll("button, audio"), function (el) { return !el.disabled; });
      if (!stops.length) return;
      var first = stops[0], last = stops[stops.length - 1], active = document.activeElement;
      if (ev.shiftKey && (active === first || !panel.contains(active))) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && (active === last || !panel.contains(active))) { ev.preventDefault(); first.focus(); }
    });
  }
  function hook(opts, name, arg) { try { if (opts && typeof opts[name] === "function") opts[name](arg); } catch (e) { /* never in the way */ } }
  /**
   * The browser's Back (assets/back.js, where the page has it): while recording it stops the take and shows it for
   * review, so nothing is lost; on the review it discards, as Escape does. Without it, Back left the page and the take.
   */
  function backLayer() {
    if (rec.layer || !window.NfBack) return;
    rec.layer = window.NfBack.push(function () {
      rec.layer = null;
      if (rec.recorder && rec.recorder.state === "recording") stopRecording();
      else if (!panel.hidden) close();
    });
  }
  function showLive(live) {
    if (panel.hidden) { rec.opener = document.activeElement; document.documentElement.classList.add("nf-rec-open"); }
    backLayer();
    panel.hidden = false;
    els.live.hidden = !live; els.review.hidden = live;
    panel.setAttribute("aria-labelledby", live ? "nf-rec-title" : "nf-rec-review-title");
    (live ? els.stop : els.use).focus();
  }
  /**
   * Why the microphone did not open, by cause, with the way back: one sentence used to cover a refusal, a device
   * with no microphone and one another app was holding, and none said how to let the site listen again.
   */
  /** The cause as a kind a page can act on: "blocked" (the person or browser said no), "nomic" or "busy". */
  function micKind(err) {
    var name = err && err.name;
    if (name === "NotFoundError" || name === "OverconstrainedError") return "nomic";
    if (name === "NotReadableError" || name === "AbortError") return "busy";
    return "blocked";
  }
  function micProblem(err) {
    var name = err && err.name;
    if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found on this device.";
    if (name === "NotReadableError" || name === "AbortError") return "The microphone is busy in another app. Close that app and try again.";
    return "The microphone is blocked for this site. To allow it, tap the lock or settings icon beside the address, choose Microphone › Allow, then try again.";
  }
  function fail(opts, kind, text) { hook(opts, "sounds", "error"); try { if (opts && typeof opts.onError === "function") opts.onError(text, kind); } catch (e) { /* never in the way */ } }
  function close() {
    if (rec.layer) { window.NfBack.done(rec.layer); rec.layer = null; }
    var wasOpen = !panel.hidden;
    panel.hidden = true; document.documentElement.classList.remove("nf-rec-open");
    if (wasOpen && rec.opener && typeof rec.opener.focus === "function" && document.contains(rec.opener)) rec.opener.focus();
    rec.opener = null;
    els.audio.pause(); els.audio.removeAttribute("src");
    if (rec.url) { URL.revokeObjectURL(rec.url); rec.url = null; }
    rec.blob = null;
  }
  function teardown() {
    if (rec.timer) clearInterval(rec.timer); if (rec.stopAt) clearTimeout(rec.stopAt); rec.timer = rec.stopAt = null;
    if (rec.raf) cancelAnimationFrame(rec.raf); rec.raf = null;
    if (rec.stream) { rec.stream.getTracks().forEach(function (t) { t.stop(); }); rec.stream = null; }
    if (rec.audioCtx) { rec.audioCtx.close().catch(function () { /* already closed */ }); rec.audioCtx = null; rec.analyser = null; }
    document.body.classList.remove("is-recording");
  }
  function stopRecording() {
    if (rec.recorder && rec.recorder.state !== "inactive") rec.recorder.stop(); // its "stop" event finishes the job
    else teardown();
  }
  function drawMeter() {
    if (!rec.analyser) return;
    var data = new Uint8Array(rec.analyser.frequencyBinCount);
    rec.analyser.getByteFrequencyData(data);
    var step = Math.floor(data.length / meterBars.length) || 1;
    meterBars.forEach(function (bar, i) {
      var v = 0;
      for (var j = 0; j < step; j++) v = Math.max(v, data[i * step + j] || 0);
      bar.style.height = Math.max(8, Math.round(v / 255 * 100)) + "%";
    });
    rec.raf = requestAnimationFrame(drawMeter);
  }
  function start(opts) {
    opts = opts || {};
    build();
    if (rec.opening) return; // the permission prompt is still up from the first press
    if (rec.recorder && rec.recorder.state === "recording") { showLive(true); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { fail(opts, "unsupported", "This browser cannot record."); return; }
    if (rec.url) close(); // a take still under review gives way to the new one
    var maxSec = opts.maxSeconds > 0 ? opts.maxSeconds : 180;
    rec.opts = opts; rec.discard = false; rec.opening = true;
    els.use.innerHTML = ICONS.wave; els.use.appendChild(document.createTextNode(opts.useLabel || "Transcribe this take"));
    hook(opts, "track", "Recording started");
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (stream) {
      rec.opening = false;
      rec.stream = stream; rec.chunks = [];
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      rec.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      rec.recorder.addEventListener("dataavailable", function (ev) { if (ev.data && ev.data.size) rec.chunks.push(ev.data); });
      rec.recorder.addEventListener("stop", function () {
        var type = rec.recorder.mimeType || mime || "audio/webm";
        var seconds = (Date.now() - rec.started) / 1000;
        teardown();
        if (rec.discard) { close(); return; }
        var blob = new Blob(rec.chunks, { type: type });
        if (blob.size < 2000) { close(); fail(opts, "short", "That was too short to hear. Hum for a few seconds."); return; }
        rec.blob = blob; rec.name = type.indexOf("mp4") >= 0 ? "hum.mp4" : "hum.webm"; rec.seconds = seconds;
        rec.url = URL.createObjectURL(blob); els.audio.src = rec.url;
        els.length.textContent = fmtClock(seconds);
        hook(opts, "sounds", "stop");
        showLive(false);
      });
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        rec.audioCtx = new AC();
        rec.analyser = rec.audioCtx.createAnalyser(); rec.analyser.fftSize = 256; rec.analyser.smoothingTimeConstant = 0.6;
        rec.audioCtx.createMediaStreamSource(stream).connect(rec.analyser);
        drawMeter();
      } catch (e) { /* no meter; the clock still runs */ }
      rec.recorder.start(250);
      rec.started = Date.now(); document.body.classList.add("is-recording"); hook(opts, "sounds", "start");
      els.elapsed.textContent = "0:00"; els.max.textContent = " / " + fmtClock(maxSec);
      showLive(true);
      rec.timer = setInterval(function () { els.elapsed.textContent = fmtClock((Date.now() - rec.started) / 1000); }, 250);
      rec.stopAt = setTimeout(stopRecording, maxSec * 1000);
    }).catch(function (err) { rec.opening = false; fail(opts, micKind(err), micProblem(err)); });
  }

  window.NfRecorder = { open: start, isRecording: function () { return !!(rec.recorder && rec.recorder.state === "recording"); }, micProblem: micProblem };
})();
