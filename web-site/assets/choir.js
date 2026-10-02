/* NoteFusion choir helpers for the web: movable-do labelling, the hymn-book layout,
 * voice ranges, and a Web Audio rehearsal player. Mirrors mobile/src/lib/solfa.ts and
 * mobile/src/lib/choir.ts — keep the three in lock-step.
 *
 * Plain script, no build step. Exposes window.NfChoir.
 */
(function () {
  "use strict";

  var PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var ASC = ["d", "de", "r", "re", "m", "f", "fe", "s", "se", "l", "le", "t"];
  var DESC = ["d", "ra", "r", "ma", "m", "f", "sa", "s", "la", "l", "ta", "t"];
  var DEGREE = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7];
  var NATURAL = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  var MODES = [["minor", "minor"], ["min", "minor"], ["maj", "major"], ["major", "major"], ["m", "minor"]];

  // ── Keys ─────────────────────────────────────────────────────────────────
  function parseKey(text) {
    if (!text || !String(text).trim()) return null;
    var s = String(text).trim(), mode = "major";
    for (var i = 0; i < MODES.length; i++) {
      var suf = MODES[i][0];
      if (s.length > suf.length && s.toLowerCase().slice(-suf.length) === suf) { mode = MODES[i][1]; s = s.slice(0, s.length - suf.length).replace(/\s+$/, ""); break; }
    }
    if (!s.length) return null;
    var pc = NATURAL[s[0].toLowerCase()];
    if (pc === undefined) return null;
    var rest = s.slice(1).trim();
    for (var j = 0; j < rest.length; j++) {
      var ch = rest[j];
      if (ch === "#" || ch === "♯") pc += 1;
      else if (ch === "b" || ch === "B" || ch === "♭" || ch === "-") pc -= 1;
      else return null;
    }
    return { tonicPitchClass: ((pc % 12) + 12) % 12, mode: mode };
  }
  function dohPitchClass(key) { return key.mode === "major" ? key.tonicPitchClass : (key.tonicPitchClass + 3) % 12; }
  function referenceDoh(pitches, dohPc) {
    if (!pitches.length) return Math.round((60 - dohPc) / 12) * 12 + dohPc;
    var sorted = pitches.slice().sort(function (a, b) { return a - b; });
    var mid = sorted.length >> 1;
    var median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    var best = dohPc;
    for (var p = dohPc; p < 128; p += 12) if (Math.abs(p - median) < Math.abs(best - median)) best = p;
    return best;
  }
  function ascendingFlags(pitches) {
    var flags = [], start = 0;
    for (var k = 0; k < pitches.length; k++) flags.push(true);
    while (start < pitches.length) {
      var end = start;
      while (end + 1 < pitches.length && pitches[end + 1] === pitches[start]) end++;
      var flag = start > 0 ? pitches[start - 1] < pitches[start] : (end + 1 >= pitches.length || pitches[end + 1] > pitches[start]);
      for (var i = start; i <= end; i++) flags[i] = flag;
      start = end + 1;
    }
    return flags;
  }
  function syllable(pitchMidi, dohPc, refDoh, ascending) {
    var semis = (((pitchMidi - dohPc) % 12) + 12) % 12;
    var shift = Math.floor((pitchMidi - refDoh) / 12);
    var mark = shift > 0 ? new Array(shift + 1).join("'") : new Array(-shift + 1).join(",");
    return { solfa: (ascending ? ASC : DESC)[semis], octaveMark: mark, degree: DEGREE[semis] };
  }
  function dohHeader(dohPc) { return "Doh is " + PITCH_NAMES[dohPc]; }

  /** Notes labelled for a key. `refPitches` (the melody) sets the unmarked octave for a part. */
  function label(notes, keyText, refPitches) {
    var key = parseKey(keyText);
    if (!key || !notes.length) return notes.slice();
    var dohPc = dohPitchClass(key);
    var refDoh = referenceDoh((refPitches || notes).map(function (n) { return n.pitchMidi; }), dohPc);
    var order = notes.map(function (_, i) { return i; }).sort(function (a, b) { return notes[a].startBeat - notes[b].startBeat; });
    var inOrder = ascendingFlags(order.map(function (i) { return notes[i].pitchMidi; }));
    var asc = [];
    order.forEach(function (idx, k) { asc[idx] = inOrder[k]; });
    return notes.map(function (n, i) {
      var s = syllable(n.pitchMidi, dohPc, refDoh, asc[i]);
      return { pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats, conf: n.conf == null ? 1 : n.conf, solfa: s.solfa, octaveMark: s.octaveMark, degree: s.degree };
    });
  }
  function keyHeader(keyText) { var key = parseKey(keyText); return key ? dohHeader(dohPitchClass(key)) : ""; }

  // ── Grid ─────────────────────────────────────────────────────────────────
  function beatsPerBar(ts) { var p = String(ts || "4/4").split("/").map(Number); return p[0] && p[1] ? (p[0] * 4) / p[1] : 4; }
  function barCount(notes, ts) {
    if (!notes.length) return 0;
    var end = 0;
    notes.forEach(function (n) { end = Math.max(end, n.startBeat + Math.max(0, n.durBeats)); });
    return Math.max(1, Math.ceil(end / beatsPerBar(ts) - 1e-9));
  }
  /** Cells of the solfa grid, each with the lyric syllable sung there; rows of four bars. */
  function hymnRows(notes, lyrics, ts, barsPerLine) {
    barsPerLine = barsPerLine || 4;
    if (!notes.length) return [];
    var cellBeats = 0.5, cellsPerBar = Math.max(1, Math.round(beatsPerBar(ts) * 2));
    var bars = barCount(notes, ts);
    var under = lyricsUnderNotes(notes, lyrics || "");
    var ordered = notes.map(function (n, i) { return { n: n, i: i, q: Math.floor(n.startBeat / cellBeats + 0.5) * cellBeats }; })
      .sort(function (a, b) { return a.n.startBeat - b.n.startBeat || a.n.durBeats - b.n.durBeats; });
    var cells = [];
    for (var c = 0; c < bars * cellsPerBar; c++) {
      var start = c * cellBeats, end = start + cellBeats;
      var starts = ordered.filter(function (o) { return Math.abs(o.q - start) < 1e-9; });
      var active = ordered.some(function (o) { return o.q < end - 1e-9 && o.q + Math.max(0, o.n.durBeats) > start + 1e-9; });
      if (starts.length) cells.push({ solfa: starts.map(function (o) { return o.n.solfa + o.n.octaveMark; }).join("+"), lyric: starts.map(function (o) { return under[o.i] || ""; }).filter(Boolean).join(" ") });
      else cells.push({ solfa: active ? "-" : "_", lyric: "" });
    }
    var barList = [];
    for (var b = 0; b < cells.length; b += cellsPerBar) barList.push(cells.slice(b, b + cellsPerBar));
    var rows = [];
    for (var r = 0; r < barList.length; r += barsPerLine) rows.push(barList.slice(r, r + barsPerLine));
    return rows;
  }
  /** The grid as text lines, the way the worker prints them. */
  function renderLines(notes, header, ts) {
    var rows = hymnRows(notes, "", ts);
    var lines = [header];
    rows.forEach(function (bars) {
      lines.push("| " + bars.map(function (bar) { return bar.map(function (c) { return c.solfa; }).join(" "); }).join(" | ") + " |");
    });
    return lines;
  }

  // ── Lyrics ───────────────────────────────────────────────────────────────
  function syllabify(lyrics) {
    var out = [];
    String(lyrics || "").split(/\s+/).filter(Boolean).forEach(function (word) {
      var pieces = word.split("-").filter(Boolean);
      pieces.forEach(function (piece, i) {
        piece.split("_").forEach(function (h, j) {
          if (j === 0) out.push(i < pieces.length - 1 ? h + "-" : h); else out.push("_");
        });
      });
    });
    return out;
  }
  function lyricsUnderNotes(notes, lyrics) {
    var syl = syllabify(lyrics);
    var order = notes.map(function (_, i) { return i; }).sort(function (a, b) { return notes[a].startBeat - notes[b].startBeat; });
    var out = notes.map(function () { return null; });
    order.forEach(function (idx, k) { out[idx] = syl[k] || null; });
    return out;
  }

  // ── Ranges ───────────────────────────────────────────────────────────────
  var VOICES = ["soprano", "alto", "tenor", "bass"];
  var VOICE_RANGES = { soprano: [60, 79], alto: [53, 74], tenor: [48, 67], bass: [40, 60] };
  var MELODY_RANGE = [57, 74];
  function pitchName(midi) { return PITCH_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
  function rangeReport(melody, parts, semitones) {
    var out = [];
    function judge(voice, notes, range) {
      var ps = notes.map(function (n) { return n.pitchMidi + semitones; }).filter(function (p) { return p > 0; });
      if (!ps.length) return;
      var low = Math.min.apply(null, ps), high = Math.max.apply(null, ps);
      var tooHigh = Math.max(0, high - range[1]), tooLow = Math.max(0, range[0] - low);
      out.push({ voice: voice, low: low, high: high, status: tooHigh && tooLow ? "wide" : tooHigh ? "high" : tooLow ? "low" : "ok", overBy: Math.max(tooHigh, tooLow) });
    }
    var hasParts = parts && VOICES.some(function (v) { return parts[v] && parts[v].notes && parts[v].notes.length; });
    if (hasParts) VOICES.forEach(function (v) { if (v === "soprano") judge(v, melody, VOICE_RANGES[v]); else if (parts[v]) judge(v, parts[v].notes, VOICE_RANGES[v]); });
    else judge("melody", melody, MELODY_RANGE);
    return out;
  }
  function shiftKeyName(key, semitones) {
    var k = parseKey(key);
    if (!k) return key;
    return PITCH_NAMES[(((k.tonicPitchClass + semitones) % 12) + 12) % 12] + " " + k.mode;
  }

  // ── Rehearsal player (Web Audio) ─────────────────────────────────────────
  // Schedules each note a little ahead on an AudioContext clock. Voices have their own
  // gain so a part can be muted mid-bar ("minus one"); the loop and the speed are
  // handled in beat time, so a passage repeats cleanly at any rate.
  function createPlayer() {
    var ctx = null, master = null;
    var voices = [], tempo = 100, ts = "4/4", rate = 1, loop = null, bars = 0;
    var playing = false, startCtxTime = 0, startBeat = 0, cursorIdx = 0, timer = null, tickCb = null, endBeat = 0;
    var LOOKAHEAD = 0.25, INTERVAL = 60;
    var events = []; // {beat, dur, midi, voice}

    function ensure() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    }
    function beatSec() { return (60 / Math.max(30, tempo)) / rate; }
    function nowBeat() { return playing ? startBeat + (ctx.currentTime - startCtxTime) / beatSec() : startBeat; }
    function rebuild() {
      events = [];
      endBeat = 0;
      voices.forEach(function (v, vi) {
        v.notes.forEach(function (n) {
          if (n.pitchMidi <= 0) return;
          events.push({ beat: n.startBeat, dur: Math.max(0.1, n.durBeats), midi: n.pitchMidi, voice: vi });
          endBeat = Math.max(endBeat, n.startBeat + n.durBeats);
        });
      });
      events.sort(function (a, b) { return a.beat - b.beat; });
      bars = Math.max(1, Math.ceil(endBeat / beatsPerBar(ts) - 1e-9));
    }
    function strike(ev, when) {
      var v = voices[ev.voice];
      var f = 440 * Math.pow(2, (ev.midi - 69) / 12);
      var dur = ev.dur * beatSec();
      var env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(1, when + 0.008);
      env.gain.exponentialRampToValueAtTime(0.35, when + Math.min(0.6, dur * 0.7));
      env.gain.setValueAtTime(0.35, when + dur);
      env.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.08);
      env.connect(v.gainNode);
      [[1, 0.6], [2, 0.22], [3, 0.08]].forEach(function (p) {
        var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * p[0];
        var g = ctx.createGain(); g.gain.value = p[1] * (ev.midi > 72 ? 0.8 : 1);
        o.connect(g); g.connect(env); o.start(when); o.stop(when + dur + 0.1);
      });
    }
    function schedule() {
      if (!playing) return;
      var horizon = ctx.currentTime + LOOKAHEAD;
      while (true) {
        if (cursorIdx >= events.length || events[cursorIdx].beat >= (loop ? loop.end : endBeat) - 1e-6) {
          // End of the piece or the passage.
          var wrapBeat = loop ? loop.end : endBeat;
          var wrapTime = startCtxTime + (wrapBeat - startBeat) * beatSec();
          if (wrapTime > horizon) break;
          if (loop) { startBeat = loop.start; startCtxTime = wrapTime; cursorIdx = firstIndexAt(loop.start); continue; }
          playing = false; startBeat = 0; stopTimer(); if (tickCb) tickCb({ beat: 0, playing: false }); return;
        }
        var ev = events[cursorIdx];
        var when = startCtxTime + (ev.beat - startBeat) * beatSec();
        if (when > horizon) break;
        if (voices[ev.voice].on) strike(ev, Math.max(when, ctx.currentTime));
        cursorIdx++;
      }
      if (tickCb) tickCb({ beat: nowBeat(), playing: true });
    }
    function firstIndexAt(beat) { var i = 0; while (i < events.length && events[i].beat < beat - 1e-6) i++; return i; }
    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

    return {
      /** voicesIn: [{name, notes, gain, on}] in the tune's beats. */
      load: function (opts) {
        ensure();
        voices.forEach(function (v) { try { v.gainNode.disconnect(); } catch (e) { /* ignore */ } });
        tempo = opts.tempoBpm || 100; ts = opts.timeSignature || "4/4";
        voices = (opts.voices || []).map(function (v) {
          var g = ctx.createGain(); g.gain.value = v.gain == null ? 1 : v.gain; g.connect(master);
          return { name: v.name, notes: v.notes || [], on: v.on !== false, gainNode: g, full: g.gain.value };
        });
        this.stop();
        rebuild();
      },
      play: function () {
        ensure();
        if (!events.length || playing) return;
        if (ctx.state === "suspended") ctx.resume();
        var from = startBeat;
        if (loop && (from < loop.start || from >= loop.end)) from = loop.start;
        startBeat = from; startCtxTime = ctx.currentTime + 0.05; cursorIdx = firstIndexAt(from); playing = true;
        stopTimer(); timer = setInterval(schedule, INTERVAL); schedule();
      },
      pause: function () { if (!playing) return; startBeat = nowBeat(); playing = false; stopTimer(); if (tickCb) tickCb({ beat: startBeat, playing: false }); },
      stop: function () { playing = false; stopTimer(); startBeat = loop ? loop.start : 0; if (tickCb) tickCb({ beat: startBeat, playing: false }); },
      toggle: function () { playing ? this.pause() : this.play(); },
      isPlaying: function () { return playing; },
      setRate: function (r) { var b = nowBeat(); rate = Math.min(2, Math.max(0.5, r)); startBeat = b; startCtxTime = ctx ? ctx.currentTime : 0; if (playing) cursorIdx = firstIndexAt(b); },
      getRate: function () { return rate; },
      /** Bars are 1-based and inclusive; null clears the passage. */
      setLoopBars: function (from, to) {
        if (from == null || to == null) { loop = null; return; }
        var bpb = beatsPerBar(ts);
        loop = { start: Math.max(0, (from - 1) * bpb), end: Math.min(endBeat + 1e-6, to * bpb) };
        if (loop.end <= loop.start + 1e-6) loop = null;
        if (loop && playing) { var b = nowBeat(); if (b < loop.start || b >= loop.end) { startBeat = loop.start; startCtxTime = ctx.currentTime; cursorIdx = firstIndexAt(loop.start); } }
      },
      setVoiceOn: function (name, on) { voices.forEach(function (v) { if (v.name === name) { v.on = on; v.gainNode.gain.setTargetAtTime(on ? v.full : 0, ctx.currentTime, 0.02); } }); },
      barCount: function () { return bars; },
      onTick: function (cb) { tickCb = cb; },
      beat: function () { return nowBeat(); }
    };
  }

  window.NfChoir = {
    parseKey: parseKey, label: label, keyHeader: keyHeader, renderLines: renderLines, hymnRows: hymnRows,
    syllabify: syllabify, lyricsUnderNotes: lyricsUnderNotes, barCount: barCount, beatsPerBar: beatsPerBar,
    VOICES: VOICES, rangeReport: rangeReport, pitchName: pitchName, shiftKeyName: shiftKeyName,
    createPlayer: createPlayer
  };
})();
