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
  /** A recording on its way up, with how much has gone: fetch cannot say, so this one goes over XMLHttpRequest. */
  function upload(path, form, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", API + path);
      xhr.setRequestHeader("X-Device-Id", deviceId());
      if (xhr.upload) {
        xhr.upload.addEventListener("progress", function (e) { if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total)); });
        xhr.upload.addEventListener("load", function () { onProgress(1); });
      }
      xhr.onerror = xhr.onabort = xhr.ontimeout = function () { reject(failure(0, null)); };
      xhr.onload = function () {
        var body = parse(xhr.responseText || "");
        if (xhr.status < 200 || xhr.status >= 300) reject(failure(xhr.status, body)); else resolve(body);
      };
      xhr.send(form);
    });
  }
  function sayUpload(fraction) { say("Uploading… " + Math.round(fraction * 100) + "%"); }
  function track(name) { try { if (window.nfTrack) window.nfTrack(name); } catch (e) { /* never in the way */ } }
  function open(job) { location.href = "/app/?preview=" + encodeURIComponent(job.jobId); }
  function explain(err) {
    if (err.code === "PREVIEW_LIMIT_REACHED") { say(err.message + " ", "info"); var a = document.createElement("a"); a.href = "/app"; a.textContent = "Create a free account"; status.appendChild(a); return; }
    say(err.message || "Something went wrong. Try again.", "error");
  }

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
  // "Beats in a bar" (assets/meter.js), when the box has one: sent only when the visitor names a meter.
  function chosenMeter() { return window.NfMeter ? window.NfMeter.chosen(meterBox) : null; }
  function trackMeter(meter) { if (window.NfMeter) track(window.NfMeter.eventName(meter)); }
  /** A recording or file as the preview's form, with the meter when one was named. */
  function audioForm(blob, name) {
    var fd = new FormData(); fd.append("audio", blob, name); fd.append("audioPreview", "false");
    var meter = chosenMeter();
    if (meter) fd.append("timeSignature", meter);
    trackMeter(meter);
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

  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    busy(true); sayUpload(0);
    track("Preview started (audio)");
    var fd = audioForm(f, f.name);
    upload("/api/preview", fd, sayUpload).then(open).catch(function (err) { busy(false); explain(err); file.value = ""; });
  });

  // "Record a tune" opens the same recording pop-up as the signed-in studio (assets/recorder.js):
  // the level meter and clock while the microphone is open, then the take to listen back to.
  // Nothing is sent until "Transcribe this take" is pressed.
  record.addEventListener("click", function () {
    if (!window.NfRecorder) { say("Recording is not available right now. Paste a link or pick a file instead.", "error"); return; }
    say("");
    window.NfRecorder.open({
      maxSeconds: MAX_RECORD_SEC,
      track: track,
      onError: function (text, kind) { say(kind === "short" ? text : text + " Paste a link or pick a file instead.", "error"); },
      onTake: function (blob, name) {
        var fd = audioForm(blob, name);
        busy(true); sayUpload(0);
        upload("/api/preview", fd, sayUpload).then(open).catch(function (err) { busy(false); explain(err); });
      }
    });
  });
})();
