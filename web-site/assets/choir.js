/* NoteFusion choir helpers for the web: movable-do labelling, the hymn-book layout,
 * voice ranges, and a Web Audio rehearsal player. Mirrors mobile/src/lib/solfa.ts and
 * mobile/src/lib/choir.ts — keep the three in lock-step.
 *
 * Plain script, no build step. Exposes window.NfChoir.
 */
(function () {
  "use strict";

  var PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  // Doh names as key signatures spell them ("Bb", never "A#"; F# kept), as mobile's DOH_NAMES.
  var DOH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
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
  function dohHeader(dohPc) { return "Doh is " + DOH_NAMES[dohPc]; }

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

  // ── Piano voice ──────────────────────────────────────────────────────────
  // Recorded piano, the same 17 Salamander Grand soft-layer notes mobile/src/lib/synth.ts
  // plays (scripts/build-piano-samples.py makes both packs from one source; keep the two
  // players in lock-step). A note is the nearest sample (never more than a semitone away)
  // run at the rate that puts it on pitch — the interval to the sample plus the cents in
  // tuning.json, which undo the piano's stretch tuning — held until note-off, then let go
  // by the damper: an exponential fade with an 80 ms time constant inside a 0.35 s
  // release that rings past the notated end. Played through the same soundboard as the
  // mobile synth and a soft limiter that only a pile-up of voices can reach.
  var SR = 22050;
  var SAMPLE_NAMES = ["C2", "Ds2", "Fs2", "A2", "C3", "Ds3", "Fs3", "A3", "C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5", "A5", "C6"];
  var SAMPLE_MIDI_LOW = 36, SAMPLE_STEP = 3;
  var PIANO_URL = "/assets/piano/";
  /** Bump when the pack is rebuilt: /assets/* is cached for a week, and only the query string gets past that. */
  var PIANO_VERSION = "?v=1";
  var RELEASE_SEC = 0.35, DAMPER_TAU_SEC = 0.08, MIN_NOTE_SEC = 0.04;
  /** Decoded samples are trimmed to this onset in case a decoder keeps the MP3 encoder delay. */
  var ONSET_LEVEL = 0.01, ONSET_BACKOFF_SEC = 0.002;
  var BOARD_DELAYS_SEC = [0.0297, 0.0371, 0.0411], BOARD_RT60_SEC = 0.55, BOARD_DAMP = 0.35;
  var BOARD_ALLPASS_SEC = 0.0051, BOARD_ALLPASS_GAIN = 0.5, BOARD_WET = 0.07;
  /**
   * The safety stage is the mobile synth's `softLimit`: identity up to LIMIT_KNEE, tanh
   * over the rest, bounded below 1 for any input — as a WaveShaper curve, memoryless, so
   * a note under the knee comes out exactly as it went in. Not a DynamicsCompressorNode:
   * measured in Chromium, one with threshold -3 dB and no knee still took 3 dB off a
   * single note peaking at -8 dBFS and softened its attack, and at threshold 0 dB it
   * still took 5 dB, so there is no setting of it that leaves a note alone.
   */
  var LIMIT_KNEE = 0.9;
  /** The curve is drawn for inputs up to ±LIMIT_RANGE (a pile-up of voices), scaled down into the shaper's ±1. */
  var LIMIT_RANGE = 2, LIMIT_CURVE_POINTS = 4097;

  /** The sample files, fetched once per page; decoding is per context (it resamples to the context's rate). */
  var pianoBytes = null;
  var pianoDecoded = {}; // sampleRate -> Promise of [{midi, cents, buffer}], with .samples once resolved
  function fetchPiano() {
    if (!pianoBytes) {
      pianoBytes = Promise.all([fetch(PIANO_URL + "tuning.json" + PIANO_VERSION).then(function (r) { if (!r.ok) throw new Error("tuning"); return r.json(); })].concat(
        SAMPLE_NAMES.map(function (name) { return fetch(PIANO_URL + name + ".mp3" + PIANO_VERSION).then(function (r) { if (!r.ok) throw new Error(name); return r.arrayBuffer(); }); })
      )).catch(function (err) { pianoBytes = null; throw err; });
    }
    return pianoBytes;
  }
  function trimOnset(ctx, buf) {
    var x = buf.getChannelData(0), i = 0;
    while (i < x.length && Math.abs(x[i]) < ONSET_LEVEL) i++;
    var cut = Math.max(0, i - Math.round(ONSET_BACKOFF_SEC * buf.sampleRate));
    if (cut === 0) return buf;
    var out = ctx.createBuffer(1, x.length - cut, buf.sampleRate);
    out.getChannelData(0).set(x.subarray(cut));
    return out;
  }
  /**
   * Loads the piano for `ctx`: resolves once every note can be played. Start it early
   * (the rehearsal player does, when a sheet is loaded) so the first play is not late.
   */
  function loadPiano(ctx) {
    var rate = ctx.sampleRate;
    if (!pianoDecoded[rate]) {
      var p = fetchPiano().then(function (parts) {
        var tuning = parts[0].centsSharp || {};
        return Promise.all(SAMPLE_NAMES.map(function (name, i) {
          return ctx.decodeAudioData(parts[i + 1].slice(0)).then(function (buf) {
            return { midi: SAMPLE_MIDI_LOW + i * SAMPLE_STEP, cents: Number(tuning[name]) || 0, buffer: trimOnset(ctx, buf) };
          });
        }));
      });
      p.then(function (samples) { p.samples = samples; }, function () { delete pianoDecoded[rate]; });
      pianoDecoded[rate] = p;
    }
    return pianoDecoded[rate];
  }
  /** The decoded samples for `ctx`, or null until `loadPiano(ctx)` has resolved. */
  function pianoSamples(ctx) {
    var p = pianoDecoded[ctx.sampleRate];
    return p && p.samples ? p.samples : null;
  }

  /**
   * The soundboard as an impulse response: the comb network run on a unit impulse,
   * scaled to its wet level. Rendered at the *context's* rate rather than at the
   * note rate — a ConvolverNode refuses a buffer whose rate differs from the
   * context's, where a buffer source simply resamples — so the delays are converted
   * to that rate and the feedback is recomputed for it, which keeps the decay time
   * and the loop's corner the same across rates.
   */
  function boardImpulse(rate) {
    var n = Math.ceil(0.7 * rate), wet = new Float64Array(n), out = new Float32Array(n), i;
    BOARD_DELAYS_SEC.forEach(function (delaySec) {
      var d = Math.round(delaySec * rate), g = Math.pow(10, (-3 * d) / (BOARD_RT60_SEC * rate));
      // The one-pole in the loop is specified at 22 050 Hz; the same corner at another
      // rate is damp^(22050 / rate).
      var damp = Math.pow(BOARD_DAMP, SR / rate);
      var y = new Float64Array(n), s = 0;
      for (i = 0; i < n; i++) { s = (1 - damp) * (i >= d ? y[i - d] : 0) + damp * s; y[i] = (i === 0 ? 1 : 0) + g * s; wet[i] += y[i]; }
    });
    var ap = Math.round(BOARD_ALLPASS_SEC * rate), o = new Float64Array(n);
    for (i = 0; i < n; i++) o[i] = -BOARD_ALLPASS_GAIN * wet[i] + (i >= ap ? wet[i - ap] : 0) + BOARD_ALLPASS_GAIN * (i >= ap ? o[i - ap] : 0);
    for (i = 0; i < n; i++) out[i] = BOARD_WET * o[i];
    return out;
  }

  function softLimitCurve() {
    var curve = new Float32Array(LIMIT_CURVE_POINTS), span = 1 - LIMIT_KNEE;
    for (var i = 0; i < LIMIT_CURVE_POINTS; i++) {
      var v = ((2 * i) / (LIMIT_CURVE_POINTS - 1) - 1) * LIMIT_RANGE, a = Math.abs(v);
      curve[i] = a <= LIMIT_KNEE ? v : Math.sign(v) * (LIMIT_KNEE + span * Math.tanh((a - LIMIT_KNEE) / span));
    }
    return curve;
  }

  /**
   * The output chain every piano note plays through: dry + soundboard into the soft
   * limiter into the destination. Returns the node to connect notes to. The loudest
   * single note peaks at 0.72, under the knee, so the limiter is only ever touched by
   * several voices landing together, and a note's own attack and decay reach the ear
   * as recorded — the old -10 dB / 10 dB-knee compressor caught every note on its own
   * and swelled it back up as it released, which is what made the piano sound held.
   */
  function createPianoOutput(ctx) {
    var input = ctx.createGain();
    var scale = ctx.createGain(); scale.gain.value = 1 / LIMIT_RANGE;
    var limiter = ctx.createWaveShaper(); limiter.curve = softLimitCurve(); limiter.oversample = "2x";
    var board = ctx.createConvolver();
    var ir = boardImpulse(ctx.sampleRate), buf = ctx.createBuffer(1, ir.length, ctx.sampleRate);
    buf.getChannelData(0).set(ir);
    board.normalize = false; board.buffer = buf;
    input.connect(scale);
    input.connect(board); board.connect(scale);
    scale.connect(limiter); limiter.connect(ctx.destination);
    return input;
  }

  /**
   * Plays one piano note of `durSec` (plus its ring-out) at `when`, at `gain`, into
   * `dest`. Needs `loadPiano(ctx)` to have resolved; before that it plays nothing and
   * returns null.
   */
  function pianoNote(ctx, dest, midi, durSec, when, gain) {
    var samples = pianoSamples(ctx);
    if (!samples) return null;
    var best = samples[0];
    for (var i = 1; i < samples.length; i++) if (Math.abs(samples[i].midi - midi) < Math.abs(best.midi - midi)) best = samples[i];
    var src = ctx.createBufferSource(); src.buffer = best.buffer;
    src.playbackRate.value = Math.pow(2, (midi - best.midi) / 12 - best.cents / 1200);
    var g = ctx.createGain(), off = when + Math.max(durSec, MIN_NOTE_SEC);
    g.gain.setValueAtTime(gain == null ? 1 : gain, when);
    g.gain.setTargetAtTime(0, off, DAMPER_TAU_SEC);
    src.connect(g); g.connect(dest); src.start(when); src.stop(off + RELEASE_SEC);
    return src;
  }
  /** Velocity from confidence, as on the server: 0.55 + 0.35·conf. */
  function velocity(conf) { var c = typeof conf === "number" && isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : 1; return 0.55 + 0.35 * c; }

  // ── Rehearsal player (Web Audio) ─────────────────────────────────────────
  // Schedules each note a little ahead on an AudioContext clock. Voices have their own
  // gain so a part can be muted mid-bar ("minus one"); the loop and the speed are
  // handled in beat time, so a passage repeats cleanly at any rate.
  function createPlayer() {
    var ctx = null, master = null;
    var voices = [], tempo = 100, ts = "4/4", rate = 1, loop = null, bars = 0;
    var playing = false, startCtxTime = 0, startBeat = 0, cursorIdx = 0, timer = null, tickCb = null, endBeat = 0, pendingPlay = null;
    var LOOKAHEAD = 0.25, INTERVAL = 60;
    var events = []; // {beat, dur, midi, voice, vel}
    // The song's own backing (an instrumental), played under the notes in time: audio
    // time of beat b is originSec + b * 60 / tempo. Started and stopped with the
    // transport, restarted on a loop wrap or a rate change, and pitch follows the rate.
    var backing = { buffer: null, originSec: 0, on: false, src: null, gain: null, pending: null };

    function ensure() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = createPianoOutput(ctx);
    }
    function beatSec() { return (60 / Math.max(30, tempo)) / rate; }
    function stopBacking() {
      if (backing.src) { try { backing.src.stop(); } catch (e) { /* already stopped */ } backing.src = null; }
    }
    function startBacking(fromBeat, when) {
      stopBacking();
      if (!backing.on || !backing.buffer || !ctx) return;
      var audioAt = backing.originSec + fromBeat * (60 / Math.max(30, tempo));
      var src = ctx.createBufferSource(); src.buffer = backing.buffer; src.playbackRate.value = rate;
      if (!backing.gain) { backing.gain = ctx.createGain(); backing.gain.gain.value = 0.85; backing.gain.connect(ctx.destination); }
      src.connect(backing.gain);
      if (audioAt >= 0) src.start(when, Math.min(audioAt, backing.buffer.duration));
      else src.start(when - audioAt / rate, 0);
      backing.src = src;
    }
    function nowBeat() { return playing ? startBeat + (ctx.currentTime - startCtxTime) / beatSec() : startBeat; }
    function rebuild() {
      events = [];
      endBeat = 0;
      voices.forEach(function (v, vi) {
        v.notes.forEach(function (n) {
          if (n.pitchMidi <= 0) return;
          events.push({ beat: n.startBeat, dur: Math.max(0.1, n.durBeats), midi: n.pitchMidi, voice: vi, vel: velocity(n.conf) });
          endBeat = Math.max(endBeat, n.startBeat + n.durBeats);
        });
      });
      events.sort(function (a, b) { return a.beat - b.beat; });
      bars = Math.max(1, Math.ceil(endBeat / beatsPerBar(ts) - 1e-9));
    }
    function strike(ev, when) {
      pianoNote(ctx, voices[ev.voice].gainNode, ev.midi, ev.dur * beatSec(), when, ev.vel);
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
          if (loop) { startBeat = loop.start; startCtxTime = wrapTime; cursorIdx = firstIndexAt(loop.start); startBacking(loop.start, wrapTime); continue; }
          playing = false; startBeat = 0; stopTimer(); stopBacking(); if (tickCb) tickCb({ beat: 0, playing: false }); return;
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
        loadPiano(ctx).catch(function () { /* play() reports it */ });
        voices.forEach(function (v) { try { v.gainNode.disconnect(); } catch (e) { /* ignore */ } });
        tempo = opts.tempoBpm || 100; ts = opts.timeSignature || "4/4";
        voices = (opts.voices || []).map(function (v) {
          var g = ctx.createGain(); g.gain.value = v.gain == null ? 1 : v.gain; g.connect(master);
          return { name: v.name, notes: v.notes || [], on: v.on !== false, gainNode: g, full: g.gain.value };
        });
        this.stop();
        rebuild();
      },
      /** Starts once the piano has loaded (at once after the first time); pause or stop before then cancels. */
      play: function () {
        ensure();
        if (!events.length || playing || pendingPlay) return;
        // Resumed here, on the gesture, not after the await: browsers only honour it then.
        if (ctx.state === "suspended") ctx.resume();
        var mine = pendingPlay = {};
        loadPiano(ctx).then(function () {
          if (pendingPlay !== mine) return;
          pendingPlay = null;
          var from = startBeat;
          if (loop && (from < loop.start || from >= loop.end)) from = loop.start;
          startBeat = from; startCtxTime = ctx.currentTime + 0.05; cursorIdx = firstIndexAt(from); playing = true;
          startBacking(from, startCtxTime);
          stopTimer(); timer = setInterval(schedule, INTERVAL); schedule();
        }, function () { if (pendingPlay === mine) pendingPlay = null; if (tickCb) tickCb({ beat: startBeat, playing: false }); });
      },
      pause: function () { pendingPlay = null; if (!playing) return; startBeat = nowBeat(); playing = false; stopTimer(); stopBacking(); if (tickCb) tickCb({ beat: startBeat, playing: false }); },
      stop: function () { pendingPlay = null; playing = false; stopTimer(); stopBacking(); startBeat = loop ? loop.start : 0; if (tickCb) tickCb({ beat: startBeat, playing: false }); },
      toggle: function () { playing ? this.pause() : this.play(); },
      isPlaying: function () { return playing; },
      setRate: function (r) { var b = nowBeat(); rate = Math.min(2, Math.max(0.5, r)); startBeat = b; startCtxTime = ctx ? ctx.currentTime : 0; if (playing) { cursorIdx = firstIndexAt(b); startBacking(b, startCtxTime); } },
      /** The song's instrumental as encoded audio bytes (an ArrayBuffer), with where beat 0 falls in it; null clears it. */
      setBacking: function (bytes, originSec) {
        stopBacking(); backing.buffer = null; backing.originSec = originSec || 0;
        if (!bytes) return;
        ensure();
        var mine = backing.pending = {};
        ctx.decodeAudioData(bytes.slice(0)).then(function (buf) { if (backing.pending === mine) { backing.buffer = buf; if (playing) startBacking(nowBeat(), ctx.currentTime); } }, function () { /* undecodable: play the piano alone */ });
      },
      setBackingOn: function (on) { backing.on = !!on; if (playing) { if (on) startBacking(nowBeat(), ctx.currentTime); else stopBacking(); } },
      hasBacking: function () { return !!backing.buffer; },
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
    createPlayer: createPlayer, createPianoOutput: createPianoOutput, loadPiano: loadPiano, pianoNote: pianoNote
  };
})();
