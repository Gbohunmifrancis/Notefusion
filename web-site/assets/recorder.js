/* The recording pop-up: the microphone opens into a panel that shows what it hears (a level
 * meter and the clock), and nothing is sent until the take has been listened to and approved.
 * One panel serves the home page, the guest box and the signed-in studio, so recording looks
 * and works the same wherever "Record a tune" is pressed. Plain script, no build step.
 *
 *   NfRecorder.open({ maxSeconds: 30, onTake: function (blob, name, seconds) {…}, onError: function (text) {…} })
 *
 * `sounds(name)` ("start" | "stop" | "error") and `track(name)` are optional hooks. */
(function () {
  "use strict";
  var panel = null, els = {}, meterBars = [];
  var rec = { recorder: null, chunks: [], timer: null, stopAt: null, started: 0, stream: null, audioCtx: null, analyser: null, raf: null, blob: null, name: "", url: null, discard: false, opts: null };

  function icon(d) {
    return '<svg class="nf-rec-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>";
  }
  var ICONS = {
    stop: icon('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    check: icon('<path d="M20 6 9 17l-5-5"/>'),
    restart: icon('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
    wave: icon('<path d="M2 12h2l2-7 3 14 3-10 2 6 2-3h6"/>')
  };
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
            '<button class="btn btn-ghost nf-rec-cancel" type="button">Cancel</button>' +
            '<button class="btn nf-rec-stop" type="button">' + ICONS.stop + "Stop</button>" +
          "</div>" +
        "</div>" +
        '<div class="nf-rec-review" hidden>' +
          '<div class="nf-rec-orb done">' + ICONS.check + "</div>" +
          '<h2 class="nf-rec-heading">Here’s your take</h2>' +
          '<p class="nf-rec-time"><span class="nf-rec-length">0:00</span><span class="nf-rec-muted"> recorded</span></p>' +
          '<audio class="nf-rec-audio" controls preload="auto"></audio>' +
          '<p class="nf-rec-lead">Listen back. If it’s the phrase you meant, send it off; otherwise record it again.</p>' +
          '<div class="nf-rec-actions">' +
            '<button class="btn btn-ghost nf-rec-discard" type="button">Discard</button>' +
            '<button class="btn btn-ghost nf-rec-again" type="button">' + ICONS.restart + "Record again</button>" +
            '<button class="btn btn-primary nf-rec-use" type="button">' + ICONS.wave + "Transcribe this take</button>" +
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
    panel.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); (rec.recorder && rec.recorder.state === "recording" ? els.cancel : els.discard).click(); } });
  }
  function hook(opts, name, arg) { try { if (opts && typeof opts[name] === "function") opts[name](arg); } catch (e) { /* never in the way */ } }
  function showLive(live) {
    panel.hidden = false;
    els.live.hidden = !live; els.review.hidden = live;
    (live ? els.stop : els.use).focus();
  }
  function close() {
    panel.hidden = true;
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
    if (rec.recorder && rec.recorder.state === "recording") { showLive(true); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { hook(opts, "onError", "This browser cannot record. Upload a file instead."); return; }
    var maxSec = opts.maxSeconds > 0 ? opts.maxSeconds : 180;
    rec.opts = opts; rec.discard = false;
    hook(opts, "track", "Recording started");
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } }).then(function (stream) {
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
        if (blob.size < 2000) { close(); hook(opts, "sounds", "error"); hook(opts, "onError", "That was too short to hear. Hum for a few seconds."); return; }
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
    }).catch(function () { hook(opts, "sounds", "error"); hook(opts, "onError", "Microphone access is needed to record. Upload a file instead."); });
  }

  window.NfRecorder = { open: start, isRecording: function () { return !!(rec.recorder && rec.recorder.state === "recording"); } };
})();
