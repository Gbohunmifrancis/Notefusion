/* The try-it-free box on the home page: paste a link, pick a file or record up to thirty
 * seconds, with no account. The API answers with a preview job; the result opens in the web
 * app as a guest (/app/?preview=<id>), where saving, parts and downloads ask for sign-up.
 * Plain script, no build step. */
(function () {
  "use strict";
  var API = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5080" : "https://api.notefusion.studio";
  var MAX_RECORD_SEC = 30;

  function deviceId() {
    try {
      var id = localStorage.getItem("nf.web.device");
      if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); localStorage.setItem("nf.web.device", id); }
      return id;
    } catch (e) { return "anonymous"; }
  }
  function $(id) { return document.getElementById(id); }
  var form = $("try-form");
  if (!form) return;
  var urlInput = $("try-url"), submit = $("try-submit"), file = $("try-file"), record = $("try-record"), status = $("try-status");

  // The web app carries an icon sprite; the home page does not, so the label is text there.
  var icons = !!document.getElementById("i-mic");
  function recLabel(icon, text) { record.innerHTML = (icons ? '<svg class="ic"><use href="#i-' + icon + '"/></svg>' : "") + text; }
  function say(text, kind) { status.textContent = text || ""; status.className = "try-status" + (kind ? " try-status-" + kind : ""); }
  function busy(on) { submit.disabled = on; record.disabled = on; file.disabled = on; }
  function send(path, opts) {
    return fetch(API + path, {
      method: "POST",
      headers: Object.assign({ "X-Device-Id": deviceId() }, opts.json ? { "Content-Type": "application/json" } : {}),
      body: opts.json ? JSON.stringify(opts.json) : opts.form
    }).then(function (r) {
      return r.text().then(function (text) {
        var body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        if (!r.ok) { var err = new Error((body && body.message) || ("Request failed (" + r.status + ")")); err.code = body && body.code; throw err; }
        return body;
      });
    });
  }
  function track(name) { try { if (window.nfTrack) window.nfTrack(name); } catch (e) { /* never in the way */ } }
  function open(job) { location.href = "/app/?preview=" + encodeURIComponent(job.jobId); }
  function explain(err) {
    if (err.code === "PREVIEW_LIMIT_REACHED") { say(err.message + " ", "info"); var a = document.createElement("a"); a.href = "/app"; a.textContent = "Create a free account"; status.appendChild(a); return; }
    say(err.message || "Something went wrong. Try again.", "error");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var url = urlInput.value.trim();
    if (!url) { urlInput.focus(); return; }
    busy(true); say("Reading the link…");
    track("Preview started (link)");
    send("/api/preview/link", { json: { url: url, audioPreview: false } }).then(open).catch(function (err) { busy(false); explain(err); });
  });

  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    var fd = new FormData(); fd.append("audio", f, f.name); fd.append("audioPreview", "false");
    busy(true); say("Uploading " + f.name + "…");
    track("Preview started (audio)");
    send("/api/preview", { form: fd }).then(open).catch(function (err) { busy(false); explain(err); file.value = ""; });
  });

  var recorder = null, chunks = [], timer = null, stopAt = null, started = 0;
  function stopRecording() {
    if (timer) clearInterval(timer); if (stopAt) clearTimeout(stopAt); timer = stopAt = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recLabel("mic", "Record a tune"); record.classList.remove("is-recording"); document.body.classList.remove("is-recording");
  }
  /** The take, to listen back to; nothing is sent until "Transcribe it" is pressed. */
  function offerTake(blob, type, seconds) {
    busy(false);
    say("Recorded " + Math.round(seconds) + " seconds. Listen back, then send it or try again.", "info");
    var url = URL.createObjectURL(blob);
    var audio = document.createElement("audio"); audio.controls = true; audio.src = url; audio.className = "try-take";
    var row = document.createElement("span"); row.className = "try-take-actions";
    var go = document.createElement("button"); go.type = "button"; go.className = "btn btn-primary"; go.textContent = "Transcribe it";
    var again = document.createElement("button"); again.type = "button"; again.className = "btn btn-ghost"; again.textContent = "Record again";
    row.appendChild(go); row.appendChild(again); status.appendChild(audio); status.appendChild(row);
    go.addEventListener("click", function () {
      URL.revokeObjectURL(url);
      var fd = new FormData(); fd.append("audio", blob, type.indexOf("mp4") >= 0 ? "hum.mp4" : "hum.webm"); fd.append("audioPreview", "false");
      busy(true); say("Transcribing your tune…");
      send("/api/preview", { form: fd }).then(open).catch(function (err) { busy(false); explain(err); });
    });
    again.addEventListener("click", function () { URL.revokeObjectURL(url); say(""); record.click(); });
  }

  record.addEventListener("click", function () {
    if (recorder && recorder.state === "recording") { stopRecording(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { say("This browser cannot record. Paste a link or pick a file instead.", "error"); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      chunks = [];
      var mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorder.addEventListener("dataavailable", function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); });
      recorder.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var type = recorder.mimeType || mime || "audio/webm";
        var blob = new Blob(chunks, { type: type });
        if (blob.size < 2000) { say("That was too short to hear. Try again and hum for a few seconds.", "error"); busy(false); return; }
        offerTake(blob, type, (Date.now() - started) / 1000);
      });
      recorder.start();
      started = Date.now(); document.body.classList.add("is-recording");
      submit.disabled = true; file.disabled = true;
      timer = setInterval(function () {
        var left = Math.max(0, MAX_RECORD_SEC - Math.floor((Date.now() - started) / 1000));
        recLabel("stop", "Stop (" + left + "s)"); record.classList.add("is-recording");
        say("Recording… hum or sing the tune, then press Stop.");
      }, 250);
      stopAt = setTimeout(stopRecording, MAX_RECORD_SEC * 1000);
    }).catch(function () { say("Microphone access is needed to record. Paste a link or pick a file instead.", "error"); });
  });
})();
