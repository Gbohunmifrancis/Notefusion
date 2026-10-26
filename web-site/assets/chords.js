/* Chords on a NoteFusion sheet: the chord row over the solfa, bar by bar (the letter name with its
 * root in Tonic Solfa under it), and the progression as a list with times. The worker spells the
 * symbols in the key and names the roots against doh; this only lays them out.
 *
 * Plain script, no build step; needs choir.js first. Exposes window.NfChords.
 */
(function () {
  "use strict";

  var C = window.NfChoir;
  var BARS_PER_LINE = 4;

  function has(chords) { return !!(chords && chords.length); }

  /**
   * The hymn grid with a chord over each cell where one starts: rows of four bars, each bar a list
   * of { solfa, lyric, chord, beat }. A bar that opens while a chord is still sounding repeats it,
   * marked held, so every bar can be read on its own. Bars run on past the tune if the chords do.
   */
  function grid(notes, lyrics, chords, ts) {
    var cellBeats = 1 / C.divisionsFor(notes || []); // as in the hymn layout
    var bpb = C.beatsPerBar(ts), perBar = Math.max(1, Math.round(bpb / cellBeats));
    var bars = [];
    C.hymnRows(notes || [], lyrics || "", ts, Infinity).forEach(function (row) { row.forEach(function (bar) { bars.push(bar); }); });
    var end = 0;
    chords.forEach(function (c) { end = Math.max(end, c.startBeat + Math.max(0, c.durBeats)); });
    while (bars.length < Math.ceil(end / bpb - 1e-9)) {
      var blank = [];
      for (var i = 0; i < perBar; i++) blank.push({ solfa: "_", lyric: "" });
      bars.push(blank);
    }
    var cells = [];
    bars.forEach(function (bar, b) {
      bar.forEach(function (cell, c) { cells.push({ solfa: cell.solfa, lyric: cell.lyric, chord: null, beat: b * bpb + c * cellBeats }); });
    });
    var ordered = chords.slice().sort(function (a, b) { return a.startBeat - b.startBeat; });
    ordered.forEach(function (ch) {
      var at = Math.min(cells.length - 1, Math.max(0, Math.round(ch.startBeat / cellBeats)));
      if (at < 0) return; // no cells: nothing to hang a chord on
      var mark = { symbol: ch.symbol || "", solfa: ch.solfa || "", held: false };
      cells[at].chord = cells[at].chord ? { symbol: cells[at].chord.symbol + " " + mark.symbol, solfa: cells[at].chord.solfa + " " + mark.solfa, held: false } : mark;
    });
    for (var b = 0; b < bars.length; b++) {
      var first = cells[b * perBar];
      if (!first || first.chord) continue;
      var start = b * bpb;
      for (var k = ordered.length - 1; k >= 0; k--) {
        var ch = ordered[k];
        if (ch.startBeat < start - 1e-6) {
          if (ch.startBeat + ch.durBeats > start + 1e-6) first.chord = { symbol: ch.symbol || "", solfa: ch.solfa || "", held: true };
          break;
        }
      }
    }
    var rows = [];
    for (var r = 0; r < bars.length; r += BARS_PER_LINE) {
      var row = [];
      for (var j = r; j < Math.min(bars.length, r + BARS_PER_LINE); j++) row.push(cells.slice(j * perBar, (j + 1) * perBar));
      rows.push(row);
    }
    return rows;
  }

  /** The grid as tables in ``container``; returns each solfa cell with its beat, for the playback cursor. */
  function renderGrid(container, rows, withLyrics) {
    container.innerHTML = "";
    var out = [];
    rows.forEach(function (bars) {
      var table = document.createElement("table"); table.className = "hymn chord-grid"; var tr = document.createElement("tr");
      bars.forEach(function (bar) {
        var td = document.createElement("td");
        bar.forEach(function (cell) {
          var span = document.createElement("span"); span.className = "cell";
          var ch = document.createElement("span"); ch.className = "ch" + (cell.chord && cell.chord.held ? " held" : "");
          var sym = document.createElement("strong"), sol = document.createElement("small");
          sym.textContent = cell.chord ? cell.chord.symbol : " ";
          sol.textContent = cell.chord ? cell.chord.solfa : " ";
          ch.appendChild(sym); ch.appendChild(sol); span.appendChild(ch);
          var b = document.createElement("b"); b.textContent = cell.solfa; span.appendChild(b);
          if (withLyrics) { var i = document.createElement("i"); i.textContent = cell.lyric; span.appendChild(i); }
          td.appendChild(span);
          out.push({ el: b, beat: cell.beat });
        });
        tr.appendChild(td);
      });
      table.appendChild(tr); container.appendChild(table);
    });
    return out;
  }

  function pad(text, width) { return text + new Array(Math.max(0, width - text.length) + 1).join(" "); }
  /** The grid as plain text, for the solfa download and the PDF: per row, the chords, their solfa, the tune (and the words). */
  function textRows(rows, withLyrics) {
    var lines = [];
    rows.forEach(function (bars) {
      var sym = "", sol = "", tune = "", words = "";
      bars.forEach(function (bar) {
        sym += "  "; sol += "  "; tune += "| "; words += "  ";
        bar.forEach(function (cell) {
          var s = cell.chord ? (cell.chord.held ? "(" + cell.chord.symbol + ")" : cell.chord.symbol) : "";
          var r = cell.chord && !cell.chord.held ? cell.chord.solfa : "";
          var w = Math.max(s.length, r.length, cell.solfa.length, withLyrics ? cell.lyric.length : 0, 2) + 1;
          sym += pad(s, w); sol += pad(r, w); tune += pad(cell.solfa, w); words += pad(withLyrics ? cell.lyric : "", w);
        });
      });
      lines.push(sym.replace(/\s+$/, ""), sol.replace(/\s+$/, ""), tune + "|");
      if (withLyrics) lines.push(words.replace(/\s+$/, ""));
      lines.push("");
    });
    return lines;
  }

  function clock(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  /** The progression, one chip per chord: when it comes, its name, and its root in solfa. */
  function renderList(container, chords, tempo) {
    container.innerHTML = "";
    var beat = 60 / Math.max(30, tempo || 120);
    chords.slice().sort(function (a, b) { return a.startBeat - b.startBeat; }).forEach(function (ch) {
      var chip = document.createElement("span"); chip.className = "chord-chip";
      var t = document.createElement("small"); t.textContent = clock(ch.startBeat * beat);
      var s = document.createElement("strong"); s.textContent = ch.symbol || "";
      var r = document.createElement("em"); r.textContent = ch.solfa || "";
      chip.appendChild(t); chip.appendChild(s); chip.appendChild(r);
      container.appendChild(chip);
    });
  }

  window.NfChords = { has: has, grid: grid, renderGrid: renderGrid, textRows: textRows, renderList: renderList };
})();
