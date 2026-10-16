/* A shared NoteFusion sheet: anonymous, read-only, with a rehearsal player.
 * Fetches /api/shared/{token}, or /api/shared/folders/{folder}/sheets/{id} for a song opened from a
 * shared folder; the link is the credential. */
(function () {
  "use strict";
  var API = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5080" : "https://api.notefusion.studio";
  // One pinned engraver URL with its SRI hash (the same file app.js loads; the CSP allows no other CDN).
  var OSMD_URL = "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.1.2/build/opensheetmusicdisplay.min.js";
  var OSMD_SRI = "sha384-12lItsNRZQLTAONzjzkiAB2oOKC7L9JPNqWBHro/ug0hLJZTmGxbr0V2JRt8KwC2";
  var C = window.NfChoir, N = window.NfChords;
  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

  var params = new URLSearchParams(location.search);
  var token = params.get("s"), folderToken = params.get("f"), folderItem = params.get("i");
  var sheet = null, melody = [], parts = null, player = null, cells = [];

  // A shared folder: the list of its songs, each opened through the folder's own link.
  if (!token && folderToken && !folderItem) {
    fetch(API + "/api/shared/folders/" + encodeURIComponent(folderToken)).then(function (r) {
      if (r.status === 404) throw new Error("This folder is no longer shared.");
      if (!r.ok) throw new Error("The folder could not be opened right now. Please try again in a moment.");
      return r.json();
    }).then(function (data) {
      document.title = (data.folder || "Shared folder") + " — NoteFusion";
      $("f-title").textContent = data.folder || "Shared folder";
      $("f-by").textContent = "Shared by " + (data.sharedBy || "a NoteFusion user") + " · " + (data.items || []).length + " songs";
      var list = $("f-list");
      (data.items || []).forEach(function (it) {
        var li = document.createElement("li"), a = document.createElement("a");
        a.href = "?f=" + encodeURIComponent(folderToken) + "&i=" + encodeURIComponent(it.id);
        var t = document.createElement("span"); t.textContent = it.title || "Untitled";
        var k = document.createElement("span"); k.className = "key"; k.textContent = it.key || "";
        a.appendChild(t); a.appendChild(k); li.appendChild(a); list.appendChild(li);
      });
      if (!(data.items || []).length) { var p = document.createElement("li"); p.className = "muted"; p.textContent = "This folder has no songs yet."; list.appendChild(p); }
      hide($("loading")); show($("folder"));
    }).catch(function (e) { fail(e.message || String(e)); });
    return;
  }

  if (!token && !(folderToken && folderItem)) return fail("This link is missing its sheet. Ask whoever shared it to send it again.");
  var sheetUrl = token
    ? API + "/api/shared/" + encodeURIComponent(token)
    : API + "/api/shared/folders/" + encodeURIComponent(folderToken) + "/sheets/" + encodeURIComponent(folderItem);
  fetch(sheetUrl).then(function (r) {
    if (r.status === 404) throw new Error("This sheet is no longer shared.");
    if (!r.ok) throw new Error("The sheet could not be opened right now. Please try again in a moment.");
    return r.json();
  }).then(render).catch(function (e) { fail(e.message || String(e)); });

  function fail(text) { hide($("loading")); $("error-text").textContent = text; show($("error")); }

  function render(data) {
    sheet = data;
    melody = C.label(data.notes || [], data.key);
    parts = null;
    if (data.parts) {
      parts = {};
      C.VOICES.forEach(function (v) {
        if (data.parts[v] && data.parts[v].notes) parts[v] = { notes: C.label(data.parts[v].notes, data.key, data.notes || []) };
      });
    }
    document.title = (data.title || "Shared sheet") + " — NoteFusion";
    $("s-title").textContent = data.title || "Shared sheet";
    if (folderToken) {
      var back = document.createElement("a"); back.className = "folder-back"; back.href = "?f=" + encodeURIComponent(folderToken); back.textContent = "← All songs in this folder";
      $("s-title").parentNode.insertBefore(back, $("s-title"));
    }
    $("s-by").textContent = "Shared by " + (data.sharedBy || "a NoteFusion user") + " · " + C.keyHeader(data.key);
    if (data.hymn) {
      // A hymnbook version credits where its melody and words came from, as the hymn's page does.
      var credit = document.createElement("p"); credit.className = "muted small"; credit.style.margin = "4px 0 0";
      credit.textContent = "Hymnbook version of “" + data.hymn.title + "”. " + (data.hymn.credit || "") + " ";
      if (data.hymn.url) { var a = document.createElement("a"); a.href = data.hymn.url; a.rel = "noopener"; a.textContent = "See the hymn"; credit.appendChild(a); }
      $("s-by").parentNode.insertBefore(credit, $("s-chips"));
    }
    [data.key, data.tempoBpm + " BPM", data.timeSignature].forEach(function (t) { var c = document.createElement("span"); c.className = "chip"; c.textContent = t; $("s-chips").appendChild(c); });

    renderSolfa();
    if (N.has(sheet.chords)) { N.renderList($("chord-list"), sheet.chords, sheet.tempoBpm); show($("chords-card")); }
    if (parts) {
      show($("tab-parts"));
      var holder = $("parts-solfa"); holder.innerHTML = "";
      C.VOICES.forEach(function (v) {
        if (!parts[v]) return;
        var block = document.createElement("div"); block.className = "part";
        var h = document.createElement("h3"); h.textContent = v; block.appendChild(h);
        var pre = document.createElement("div"); pre.className = "solfa";
        C.renderLines(v === "soprano" ? melody : parts[v].notes, "", data.timeSignature).slice(1).forEach(function (line) { var d = document.createElement("div"); d.textContent = line; pre.appendChild(d); });
        block.appendChild(pre); holder.appendChild(block);
      });
    }
    setupPlayer();
    hide($("loading")); show($("sheet"));
  }

  function renderSolfa() {
    var lines = C.renderLines(melody, C.keyHeader(sheet.key), sheet.timeSignature);
    var box = $("solfa-text"); box.innerHTML = "";
    var hasLyrics = !!(sheet.lyrics && sheet.lyrics.trim()), hasChords = N.has(sheet.chords);
    (hasLyrics || hasChords ? lines.slice(0, 1) : lines).forEach(function (line, i) {
      var d = document.createElement("div"); if (i === 0) d.className = "doh"; d.textContent = line; box.appendChild(d);
    });
    var hymn = $("hymn"); hymn.innerHTML = ""; cells = [];
    $("lyrics").textContent = hasLyrics ? sheet.lyrics : "";
    // With chords, the grid is drawn whatever the words: each chord over the bar it starts in, its root in solfa under its name.
    if (hasChords) { cells = N.renderGrid(hymn, N.grid(melody, sheet.lyrics, sheet.chords, sheet.timeSignature), hasLyrics); return; }
    if (hasLyrics) {
      C.hymnRows(melody, sheet.lyrics, sheet.timeSignature).forEach(function (bars, r) {
        var table = document.createElement("table"); table.className = "hymn"; var tr = document.createElement("tr");
        bars.forEach(function (bar, b) {
          var td = document.createElement("td");
          bar.forEach(function (cell, c) {
            var span = document.createElement("span"); span.className = "cell";
            var bEl = document.createElement("b"); bEl.textContent = cell.solfa; var iEl = document.createElement("i"); iEl.textContent = cell.lyric;
            span.appendChild(bEl); span.appendChild(iEl); td.appendChild(span);
            cells.push({ el: bEl, beat: ((r * 4 + b) * C.beatsPerBar(sheet.timeSignature)) + c * 0.5 });
          });
          tr.appendChild(td);
        });
        table.appendChild(tr); hymn.appendChild(table);
      });
    }
  }

  function setupPlayer() {
    player = C.createPlayer();
    var voices = [{ name: "soprano", notes: melody, gain: 1 }];
    if (parts) C.VOICES.forEach(function (v) { if (v !== "soprano" && parts[v]) voices.push({ name: v, notes: parts[v].notes, gain: 0.8 }); });
    player.load({ voices: voices, tempoBpm: sheet.tempoBpm, timeSignature: sheet.timeSignature });
    var bars = C.barCount(melody, sheet.timeSignature);
    $("loop-from").max = bars; $("loop-to").max = bars; $("loop-to").value = Math.min(4, bars);
    if (voices.length > 1) {
      var box = $("voices"); show(box);
      voices.forEach(function (v) {
        var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost btn-sm on"; b.textContent = v.name[0].toUpperCase(); b.title = v.name;
        b.setAttribute("aria-pressed", "true");
        b.addEventListener("click", function () { var on = b.classList.toggle("on"); b.setAttribute("aria-pressed", String(on)); player.setVoiceOn(v.name, on); });
        box.appendChild(b);
      });
    }
    $("play").addEventListener("click", function () { player.toggle(); });
    $("restart").addEventListener("click", function () { player.stop(); player.play(); });
    $("rate").addEventListener("change", function () { player.setRate(parseFloat($("rate").value)); });
    function applyLoop() {
      if ($("loop-on").checked) player.setLoopBars(parseInt($("loop-from").value, 10) || 1, parseInt($("loop-to").value, 10) || bars);
      else player.setLoopBars(null, null);
    }
    ["loop-on", "loop-from", "loop-to"].forEach(function (id) { $(id).addEventListener("change", applyLoop); });
    player.onTick(function (t) {
      $("play").innerHTML = '<svg class="ic"><use href="#i-' + (t.playing ? "pause" : "play") + '"/></svg>' + (t.playing ? "Pause" : "Play");
      var now = -1;
      for (var i = 0; i < cells.length; i++) if (cells[i].beat <= t.beat + 1e-6) now = i;
      cells.forEach(function (c, i) { c.el.className = t.playing && i === now ? "now" : ""; });
    });
  }

  document.querySelectorAll(".tab[data-view]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab[data-view]").forEach(function (t) { t.setAttribute("aria-selected", String(t === tab)); });
      var v = tab.dataset.view;
      v === "solfa" ? show($("v-solfa")) : hide($("v-solfa"));
      v === "staff" ? show($("v-staff")) : hide($("v-staff"));
      v === "parts" ? show($("v-parts")) : hide($("v-parts"));
      if (v === "staff" && !$("staff").childElementCount) engrave($("staff"), sheet.musicXml, false);
      if (v === "parts" && !$("staff-parts").childElementCount) engrave($("staff-parts"), sheet.partsMusicXml, true);
    });
  });

  function ensureOsmd() {
    if (window.opensheetmusicdisplay) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = OSMD_URL; s.integrity = OSMD_SRI; s.crossOrigin = "anonymous";
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    }).then(function () { if (!window.opensheetmusicdisplay) throw new Error("engraver"); });
  }
  function engrave(container, xml, partNames) {
    container.innerHTML = "";
    if (!xml) { container.textContent = "No score to draw."; return; }
    container.textContent = "Loading the engraver…";
    ensureOsmd().then(function () {
      container.innerHTML = "";
      var d = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, { backend: "svg", autoResize: true, drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false, drawPartNames: partNames, drawMeasureNumbers: true, autoBeam: true });
      return d.load(xml).then(function () { d.render(); });
    }).catch(function () { container.textContent = "The staff could not be drawn. The Tonic Solfa tab still works."; });
  }

  $("dl-solfa").addEventListener("click", function () {
    var lines = C.renderLines(melody, C.keyHeader(sheet.key), sheet.timeSignature);
    var text = N.has(sheet.chords)
      ? lines[0] + "\n\n" + N.textRows(N.grid(melody, sheet.lyrics, sheet.chords, sheet.timeSignature), !!(sheet.lyrics && sheet.lyrics.trim())).join("\n")
      : lines.join("\n") + (sheet.lyrics ? "\n\n" + sheet.lyrics : "");
    text += "\n\nShared from NoteFusion · notefusion.studio\n";
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = (sheet.title || "sheet").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + "-solfa.txt"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $("print").addEventListener("click", function () { window.print(); });
})();
