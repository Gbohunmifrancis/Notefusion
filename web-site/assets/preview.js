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
  var links = window.NfSongLink;

  function say(text, kind) { status.textContent = text || ""; status.className = "try-status" + (kind ? " try-status-" + kind : ""); }
  var busyNow = false;
  function busy(on) { busyNow = on; submit.disabled = on || info.pending; record.disabled = on; file.disabled = on; }
  function send(path, opts) {
    return fetch(API + path, {
      method: "POST",
      headers: Object.assign({ "X-Device-Id": deviceId() }, opts.json ? { "Content-Type": "application/json" } : {}),
      body: opts.json ? JSON.stringify(opts.json) : opts.form
    }).then(function (r) {
      return r.text().then(function (text) {
        var body = null; try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        if (!r.ok) { var err = new Error((body && body.message) || "Something went wrong. Try again."); err.code = body && body.code; throw err; }
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
  function submitLink(url) {
    var body = { url: url, audioPreview: false };
    var picked = info.card && info.url === url ? info.card.selection() : null;
    if (picked) { body.startSeconds = picked.startSeconds; body.endSeconds = picked.endSeconds; }
    busy(true); say("Reading the link…");
    track("Preview started (link)");
    send("/api/preview/link", { json: body }).then(open).catch(function (err) { busy(false); explain(err); });
  }

  file.addEventListener("change", function () {
    var f = file.files && file.files[0];
    if (!f) return;
    var fd = new FormData(); fd.append("audio", f, f.name); fd.append("audioPreview", "false");
    busy(true); say("Uploading " + f.name + "…");
    track("Preview started (audio)");
    send("/api/preview", { form: fd }).then(open).catch(function (err) { busy(false); explain(err); file.value = ""; });
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
      onError: function (text) { say(text + " Paste a link or pick a file instead.", "error"); },
      onTake: function (blob, name) {
        var fd = new FormData(); fd.append("audio", blob, name); fd.append("audioPreview", "false");
        busy(true); say("Transcribing your tune\u2026");
        send("/api/preview", { form: fd }).then(open).catch(function (err) { busy(false); explain(err); });
      }
    });
  });
})();
