/* The try-it-free box on the home page and in the web app: paste a link, pick a file or record
 * up to thirty seconds, with no account. The API answers with a preview job; the result opens in the web
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
  var meterBox = $("try-meter");
  // "Beats in a bar" (assets/meter.js). Where the page asks it inside the song-link panel (the home page), it goes with
  // a link only: a recorded take is asked it in its review (assets/recorder.js) and a picked file goes as Not sure.
  // Where the row still sits under Record and Upload (/app's guest box), it goes with everything, as before.
  var meterForLinks = !!(meterBox && meterBox.closest("details"));
  var links = window.NfSongLink;

  function say(text, kind) { status.textContent = text || ""; status.className = "try-status" + (kind ? " try-status-" + kind : ""); }
  var busyNow = false;
  function busy(on) { busyNow = on; submit.disabled = on || info.pending; record.disabled = on; file.disabled = on; }
  // What a visitor reads when the API says no: its own sentences for expected refusals pass through;
  // a server fault, a bare status or anything technical becomes one plain line. The console keeps the detail.
  var TECHNICAL = /\b(exception|stack|sql|npgsql|postgres|database|db context|entity framework|null reference|object reference|timeout expired|returned \d{3}|status code|http \d{3}|\d{3} \(|traceback|internal server|[A-Z]{3,}_[A-Z_]{3,})/i;
  function failure(status, body) {
    var message = body && body.message;
    var err = new Error(!message || status >= 500 || TECHNICAL.test(message) ? "Something went wrong on our side. Please try again in a moment." : message);
    if (status === 0) err.message = "We couldn't reach NoteFusion. Check your connection and try again.";
    if (status === 429) err.message = "That's a lot of requests at once. Wait a moment and try again.";
    err.code = body && body.code;
    err.status = status;
    try { if (message && message !== err.message) console.warn("[notefusion]", status, err.code, message); } catch (e) { /* ignore */ }
    return err;
  }
  function parse(text) { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } }
  function send(path, opts) {
    return fetch(API + path, {
      method: "POST",
      headers: Object.assign({ "X-Device-Id": deviceId() }, opts.json ? { "Content-Type": "application/json" } : {}),
      body: opts.json ? JSON.stringify(opts.json) : opts.form
    }).catch(function () { throw failure(0, null); }).then(function (r) {
      return r.text().then(function (text) {
        var body = parse(text);
        if (!r.ok) throw failure(r.status, body);
        return body;
      });
    });
  }
  /**
   * A recording on its way up, with how much has gone: fetch cannot say, so this one goes over XMLHttpRequest.
   * `started` is handed the request at once, so Cancel can stop it.
   */
  function upload(path, form, onProgress, started) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      if (started) started(xhr);
      xhr.open("POST", API + path);
      xhr.setRequestHeader("X-Device-Id", deviceId());
      // A connection that stops moving (3G under a bridge) gives up after 45 s of no progress, rather than
      // sitting on "Uploading… 40%" with every control off until the page is reloaded.
      var lastMove = Date.now(), watch = setInterval(function () { if (Date.now() - lastMove > 45000) xhr.abort(); }, 5000);
      if (xhr.upload) {
        xhr.upload.addEventListener("progress", function (e) { lastMove = Date.now(); if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total)); });
        xhr.upload.addEventListener("load", function () { clearInterval(watch); onProgress(1); });
      }
      xhr.addEventListener("loadend", function () { clearInterval(watch); });
      xhr.onerror = xhr.onabort = xhr.ontimeout = function () { reject(failure(0, null)); };
      xhr.onload = function () {
        var body = parse(xhr.responseText || "");
        if (xhr.status < 200 || xhr.status >= 300) reject(failure(xhr.status, body)); else resolve(body);
      };
      xhr.send(form);
    });
  }
  /**
   * While a take or file goes up: how much has gone, in words and a 4 px bar, beside Cancel, the one live control then
   * (the stall watchdog's abort, sooner). Cancel goes once the whole recording is up: the preview is being made by then.
   */
  var progress = null;
  function showUploading(take) {
    status.className = "try-status"; status.textContent = "";
    var row = document.createElement("span"), text = document.createElement("span"), label = document.createElement("span");
    var bar = document.createElement("progress"), cancel = document.createElement("button");
    row.className = "try-up"; text.className = "try-up-text";
    bar.className = "try-up-bar"; bar.max = 100; bar.value = 0; bar.setAttribute("aria-hidden", "true");
    // btn-secondary on the home page, btn-ghost in /app's guest box: each page styles the one it has.
    cancel.type = "button"; cancel.className = "btn btn-secondary btn-ghost try-cancel"; cancel.textContent = "Cancel";
    cancel.addEventListener("click", function () {
      if (!take.xhr) return;
      take.cancelled = true; take.refocus = document.activeElement === cancel;
      take.xhr.abort();
    });
    text.appendChild(label); text.appendChild(document.createTextNode(" ")); text.appendChild(bar);
    row.appendChild(text); row.appendChild(document.createTextNode(" ")); row.appendChild(cancel);
    status.appendChild(row);
    progress = { label: label, bar: bar, cancel: cancel };
    sayUpload(0);
  }
  function sayUpload(fraction) {
    var pct = Math.round(fraction * 100);
    if (!progress || !status.contains(progress.label)) { say("Uploading… " + pct + "%"); return; }
    progress.label.textContent = "Uploading… " + pct + "%";
    progress.bar.value = pct;
    if (fraction >= 1 && progress.cancel.parentNode) progress.cancel.parentNode.removeChild(progress.cancel);
  }
  function track(name) { try { if (window.nfTrack) window.nfTrack(name); } catch (e) { /* never in the way */ } }
  function open(job) { location.href = "/app/?preview=" + encodeURIComponent(job.jobId); }
  /**
   * A take or file whose send failed on the way (no connection, a server fault, too many at once) is kept, with a
   * "Send it again" beside the note, instead of being lost with the error (board l-ux-high/06e). A refusal that
   * sending again cannot change (the one preview used) is explained as before. A take cancelled on its way up is kept
   * the same way; a cancelled file is simply dropped, since it is still on the device.
   */
  var kept = null;
  /**
   * `meter`: the one named ("3/4"), null for Not sure, or undefined when the question was not asked (a file).
   * `picked`: a file chosen from the device rather than a take recorded here.
   */
  function sendTake(blob, name, meter, picked) {
    kept = null;
    var take = { blob: blob, name: name, meter: meter, picked: picked, xhr: null, cancelled: false, refocus: false };
    var active = document.activeElement;
    busy(true); showUploading(take);
    // The control that sent it is off (or gone) now, so the keyboard goes on to Cancel, the one live control.
    if (!active || active === document.body || active === record || active === file || status.contains(active) || !document.contains(active)) {
      try { progress.cancel.focus({ preventScroll: true }); } catch (e) { /* an old browser */ }
    }
    upload("/api/preview", audioForm(blob, name, meter), sayUpload, function (xhr) { take.xhr = xhr; }).then(open).catch(function (err) {
      busy(false);
      if (take.cancelled) {
        if (!picked) { kept = take; sayKept("Upload cancelled. Your take is kept.", take.refocus); return; }
        say("Upload cancelled.");
        if (take.refocus) file.focus();
        return;
      }
      if (!err.status || err.status === 408 || err.status === 429 || err.status >= 500) { kept = take; sayKept(); }
      else explain(err);
    });
  }
  function sayKept(text, focus) {
    say(text || "Couldn't send it. Your take is kept.", text ? "" : "error");
    var again = document.createElement("button");
    again.type = "button"; again.className = "btn btn-primary try-again"; again.textContent = "Send it again";
    again.addEventListener("click", function () { if (kept) sendTake(kept.blob, kept.name, kept.meter, kept.picked); });
    status.appendChild(again);
    if (focus) again.focus();
  }
  function explain(err) {
    if (err.code === "PREVIEW_LIMIT_REACHED") { say(err.message + " ", "info"); status.appendChild(signupLink()); return; }
    say(err.message || "Something went wrong. Try again.", "error");
  }
  /** The way on once the preview is spent: the sign-up form itself, not the sign-in screen /app opens on. */
  function signupLink() { var a = document.createElement("a"); a.href = "/app?signup=1"; a.textContent = "Create a free account"; return a; }
  // A preview this browser already finished (app.js remembers it): said before anything is recorded or uploaded, not
  // after, since the API allows one per device.
  try {
    if (localStorage.getItem("nf.web.previewUsed")) {
      say("You've had the free preview on this browser. ", "info");
      status.appendChild(signupLink());
      status.appendChild(document.createTextNode(" for 3 hummed or recorded transcriptions a week."));
    }
  } catch (e) { /* storage off: the API says so when asked */ }

  // Share text ("Listen to … on Spotify: https://…") is cut down to its link as it lands, with a plain
  // hint when there is none; the hint clears itself without touching a recorded take shown here.
  var hinting = false;
  function sayLink(text) {
    if (text) { say(text, "error"); hinting = true; }
    else if (hinting) { say(""); hinting = false; }
  }
  // Once the box holds a song link, the API says what it is and how long it runs, and a card under
  // the form lets the guest pick which thirty seconds to hear (assets/rangepicker.js). The pick goes
  // with the link; with no card (length unknown, lookup failed) the preview is the start of the song.
  var section = $("try-section"), info = { url: null, card: null, timer: null, seq: 0, pending: false, wanted: null };
  function clearCard() {
    info.seq++; // an answer still on its way is for a link no longer in the box
    if (info.card) info.card.destroy();
    info.card = null; info.url = null; info.pending = false; submit.disabled = busyNow;
    if (section) section.innerHTML = "";
  }
  function lookup(now) {
    if (!section || !window.NfRangePicker) return;
    clearTimeout(info.timer);
    info.timer = setTimeout(function () {
      var found = links.extract(urlInput.value.trim());
      if (!found) { clearCard(); return; }
      if (found.url === info.url) return;
      clearCard();
      info.url = found.url; info.pending = true; submit.disabled = true; // the card comes before the preview is sent
      var seq = info.seq;
      var looking = document.createElement("p"); looking.className = "try-status link-looking"; looking.textContent = "Finding the song…"; section.appendChild(looking);
      send("/api/preview/link/info", { json: { url: found.url } }).then(function (data) {
        if (seq !== info.seq) return;
        section.innerHTML = "";
        info.card = window.NfRangePicker.card(section, data, { allowance: data.maxSeconds + " s preview — sign up for a minute, Pro for six" });
      }).catch(function (err) {
        if (seq !== info.seq) return;
        section.innerHTML = "";
        if (err.code === "TRANS_INVALID_LINK") { info.url = null; sayLink(err.message); return; }
        if (err.code === "PREVIEW_LIMIT_REACHED") { info.url = null; explain(err); return; }
        say("We couldn't read the song's length just now. The preview will start from the beginning.", "info");
      }).then(function () {
        if (seq !== info.seq) return;
        info.pending = false; submit.disabled = busyNow;
        // Transcribe was pressed before the song was known: it goes on by itself only when there is
        // nothing to pick (length unknown, lookup failed); a picker waits for the person.
        var wanted = info.wanted === found.url; info.wanted = null;
        if (wanted && info.url === found.url && !(info.card && info.card.selection())) submitLink(found.url);
      });
    }, now ? 0 : 350);
  }
  links.wire(urlInput, $("try-paste"), sayLink, lookup);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var raw = urlInput.value.trim();
    if (!raw) { sayLink("Paste a link to a YouTube video, a Spotify track or an Apple Music song."); urlInput.focus(); return; }
    var found = links.extract(raw);
    if (!found) { sayLink(links.hint(raw)); urlInput.focus(); return; }
    urlInput.value = found.url;
    // The song's card comes first, so which thirty seconds to hear is seen and picked before it is sent.
    if (info.url !== found.url || info.pending) { info.wanted = found.url; if (info.url !== found.url) lookup(true); return; }
    submitLink(found.url);
  });
  // "Beats in a bar": sent only when the visitor names a meter, and counted only where it was asked.
  function chosenMeter() { return window.NfMeter ? window.NfMeter.chosen(meterBox) : null; }
  function trackMeter(meter) { if (window.NfMeter) track(window.NfMeter.eventName(meter)); }
  /** A recording or file as the preview's form, with the meter when one was named. */
  function audioForm(blob, name, meter) {
    var fd = new FormData(); fd.append("audio", blob, name); fd.append("audioPreview", "false");
    if (meter) fd.append("timeSignature", meter);
    if (meter !== undefined) trackMeter(meter);
    return fd;
  }

  function submitLink(url) {
    var body = { url: url, audioPreview: false };
    var picked = info.card && info.url === url ? info.card.selection() : null;
    if (picked) { body.startSeconds = picked.startSeconds; body.endSeconds = picked.endSeconds; }
    var meter = chosenMeter();
    if (meter) body.timeSignature = meter;
    busy(true); say("Reading the link…");
    track("Preview started (link)");
    trackMeter(meter);
    send("/api/preview/link", { json: body }).then(open).catch(function (err) { busy(false); explain(err); });
  }

  /** A file the API would refuse, said before it goes up: over 25 MB, or not a recording. */
  function fileProblem(f) {
    if (f.size > 25 * 1024 * 1024) return "That file is over 25 MB. Choose a shorter recording, or one saved as MP3 or M4A.";
    var audio = /^audio\//.test(f.type || "") || /\.(wav|mp3|m4a|aac|flac|ogg|oga|opus|webm|mp4)$/i.test(f.name || "");
    return audio ? null : "That doesn't look like a recording. Choose an MP3, WAV, M4A, FLAC, OGG or WebM file.";
  }
  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    var problem = fileProblem(f);
    if (problem) { say(problem, "error"); file.value = ""; return; }
    track("Preview started (audio)");
    file.value = "";
    sendTake(f, f.name, meterForLinks ? undefined : chosenMeter(), true);
  });

  // "Record a tune" opens the same recording pop-up as the signed-in studio (assets/recorder.js):
  // the level meter and clock while the microphone is open, then the take to listen back to.
  // Nothing is sent until "Transcribe this take" is pressed.
  record.addEventListener("click", function () {
    if (!window.NfRecorder) { say("Recording is not available right now. Paste a link or pick a file instead.", "error"); return; }
    say("");
    window.NfRecorder.open({
      maxSeconds: MAX_RECORD_SEC,
      meter: meterForLinks,
      track: track,
      onError: function (text, kind) { say(kind === "short" ? text : text + " Paste a link or pick a file instead.", "error"); },
      onTake: function (blob, name, seconds, meter) { sendTake(blob, name, meterForLinks ? meter : chosenMeter()); }
    });
  });
})();
