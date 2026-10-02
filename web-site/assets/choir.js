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

  // ── Piano voice ──────────────────────────────────────────────────────────
  // The same softly-struck piano as mobile/src/lib/synth.ts and the server's
  // _synthesize_audio_preview: a struck-string partial stack with a hammer
  // transient, per-partial damping, a double decay, unison beating, and a damper
  // release that rings past the notated end. Rendered offline into an AudioBuffer
  // per (pitch, length) and played back through a soundboard (the same comb
  // network, as a convolution) and a limiter. Keep the three in lock-step — the
  // constants here are the mobile file's, and the comments on what each one is
  // for live there.
  var SR = 22050;
  var STRIKE_POS = 1 / 7.6;
  var BODY_ROLLOFF_C4 = 1.05, ROLLOFF_TILT = 1 / 120, ROLLOFF_MIN = 0.85, ROLLOFF_MAX = 1.45;
  var BRIGHT_CEILING_HZ = 3000;
  var MAX_PARTIALS = 48, PARTIAL_FLOOR_DB = -60;
  var INHARMONICITY = 1.1e-4;
  var STRIKE_GAIN = 0.11, STRIKE_ROLLOFF = 0.35, STRIKE_TAU_SEC = 0.014, STRIKE_SPAN_SEC = 10 * STRIKE_TAU_SEC;
  var DAMP_K = 0.14, DAMP_EXP = 1.15;
  var STRING_DECAY_SEC_C4 = 2.4, STRING_DECAY_MIN_SEC = 0.55, STRING_DECAY_MAX_SEC = 4.0;
  var TAIL_MIX = 0.22, TAIL_FACTOR = 3.2;
  var DETUNE_CENTS = 2.0, UNISON_DEPTH = 0.25, UNISON_KNEE = 8, UNISON_MIN_MIDI = 52;
  var ATTACK_SEC = 0.008, RELEASE_SEC = 0.35, PEAK_TARGET = 0.7, RENORM_EVERY = 4096;
  var BOARD_DELAYS_SEC = [0.0297, 0.0371, 0.0411], BOARD_RT60_SEC = 0.55, BOARD_DAMP = 0.35;
  var BOARD_ALLPASS_SEC = 0.0051, BOARD_ALLPASS_GAIN = 0.5, BOARD_WET = 0.07;
  var MIN_NOTE_SEC = 0.04;

  function stringDecaySec(midi) { return Math.min(Math.max(STRING_DECAY_SEC_C4 * Math.pow(2, (60 - midi) / 24), STRING_DECAY_MIN_SEC), STRING_DECAY_MAX_SEC); }
  function bodyRolloff(midi) { return Math.min(Math.max(BODY_ROLLOFF_C4 + (midi - 60) * ROLLOFF_TILT, ROLLOFF_MIN), ROLLOFF_MAX); }
  function smoothRamp(i, n) { return 0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)); }

  /** One note at unit peak, `lengthSamples` of body plus the ring-out, at 22 050 Hz. */
  function renderPianoNote(midi, lengthSamples) {
    var tailSamples = Math.round(RELEASE_SEC * SR);
    var total = lengthSamples + tailSamples;
    var out = new Float64Array(total);
    var f0 = 440 * Math.pow(2, (midi - 69) / 12), nyquist = 0.5 * SR;
    var tau0 = stringDecaySec(midi), rolloff = bodyRolloff(midi);
    var unison = midi >= UNISON_MIN_MIDI;
    var detuneHz = f0 * (Math.pow(2, DETUNE_CENTS / 1200) - 1);
    var fks = [], bodyAmps = [], strikeAmps = [], loudest = 0, k;
    for (k = 1; k <= MAX_PARTIALS; k++) {
      var fk = f0 * k * (1 + INHARMONICITY * k * k);
      if (fk >= nyquist) break;
      var node = Math.abs(Math.sin(k * Math.PI * STRIKE_POS));
      var tilt = 1 / Math.pow(1 + Math.pow(fk / BRIGHT_CEILING_HZ, 2), 2);
      var bodyAmp = (node * tilt) / Math.pow(k, rolloff);
      var strikeAmp = (STRIKE_GAIN * node * tilt) / Math.pow(k, STRIKE_ROLLOFF);
      fks.push(fk); bodyAmps.push(bodyAmp); strikeAmps.push(strikeAmp);
      loudest = Math.max(loudest, bodyAmp + strikeAmp);
    }
    var floor = loudest * Math.pow(10, PARTIAL_FLOOR_DB / 20);
    var strikeSpan = Math.min(total, Math.ceil(STRIKE_SPAN_SEC * SR));
    var rStrike = Math.exp(-1 / (STRIKE_TAU_SEC * SR));
    for (var idx = 0; idx < fks.length; idx++) {
      k = idx + 1;
      var bAmp = bodyAmps[idx], sAmp = strikeAmps[idx];
      if (bAmp + sAmp < floor) continue;
      var tauK = tau0 / (1 + DAMP_K * Math.pow(k, DAMP_EXP));
      var rFast = Math.exp(-1 / (tauK * SR)), rSlow = Math.exp(-1 / (tauK * TAIL_FACTOR * SR));
      var phase = 2 * Math.PI * ((midi * 0.5698402909 + k * 0.618033988) % 1);
      var omega = (2 * Math.PI * fks[idx]) / SR, beat = (2 * Math.PI * k * detuneHz) / SR;
      var depth = unison ? UNISON_DEPTH * Math.min(1, k / UNISON_KNEE) : 0;
      var cw = Math.cos(omega), sw = Math.sin(omega), zr = Math.cos(phase), zi = Math.sin(phase);
      var bw = Math.cos(beat), bs = Math.sin(beat), mr = 1, mi = 0, i, g;
      if (sAmp >= floor) {
        var sr = Math.cos(phase), si = Math.sin(phase), e = sAmp;
        for (i = 0; i < strikeSpan; i++) {
          out[i] += e * si;
          var nr = sr * cw - si * sw; si = sr * sw + si * cw; sr = nr;
          e *= rStrike;
          if ((i & (RENORM_EVERY - 1)) === RENORM_EVERY - 1) { g = 1 / Math.hypot(sr, si); sr *= g; si *= g; }
        }
      }
      var eFast = 1 - TAIL_MIX, eSlow = TAIL_MIX;
      for (i = 0; i < total; i++) {
        out[i] += bAmp * (eFast + eSlow) * (1 + depth * mr) * zi;
        var nzr = zr * cw - zi * sw; zi = zr * sw + zi * cw; zr = nzr;
        eFast *= rFast; eSlow *= rSlow;
        if (unison) { var nmr = mr * bw - mi * bs; mi = mr * bs + mi * bw; mr = nmr; }
        if ((i & (RENORM_EVERY - 1)) === RENORM_EVERY - 1) {
          g = 1 / Math.hypot(zr, zi); zr *= g; zi *= g;
          if (unison) { var h = 1 / Math.hypot(mr, mi); mr *= h; mi *= h; }
        }
      }
    }
    var attack = Math.min(Math.floor(ATTACK_SEC * SR), total >> 2), peak = 0;
    for (i = 0; i < total; i++) {
      if (attack > 1 && i < attack) out[i] *= smoothRamp(i, attack);
      var fromEnd = total - 1 - i;
      if (tailSamples > 1 && fromEnd < tailSamples) out[i] *= smoothRamp(fromEnd, tailSamples);
      var a = Math.abs(out[i]); if (a > peak) peak = a;
    }
    var f32 = new Float32Array(total);
    var scale = peak > 0 ? PEAK_TARGET / peak : 0;
    for (i = 0; i < total; i++) f32[i] = out[i] * scale;
    return f32;
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

  /**
   * The output chain every piano note plays through: dry + soundboard into a limiter
   * into the destination. Returns the node to connect notes to.
   */
  function createPianoOutput(ctx) {
    var input = ctx.createGain();
    // A DynamicsCompressorNode is the only limiter Web Audio has, and it adds make-up
    // gain of its own that cannot be switched off, so a four-voice chord came out of
    // it at 1.03 and clipped at the destination. The trim after it is what keeps the
    // ceiling where the offline renders put theirs (0.8).
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.knee.value = 10; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.12;
    var trim = ctx.createGain(); trim.gain.value = 0.7;
    var board = ctx.createConvolver();
    var ir = boardImpulse(ctx.sampleRate), buf = ctx.createBuffer(1, ir.length, ctx.sampleRate);
    buf.getChannelData(0).set(ir);
    board.normalize = false; board.buffer = buf;
    input.connect(limiter);
    input.connect(board); board.connect(limiter);
    limiter.connect(trim); trim.connect(ctx.destination);
    return input;
  }

  var noteCache = {}, noteCacheSize = 0;
  function pianoBuffer(ctx, midi, durSec) {
    var len = Math.max(Math.floor(durSec * SR), Math.floor(MIN_NOTE_SEC * SR));
    var key = midi + ":" + len, buf = noteCache[key];
    if (!buf) {
      if (noteCacheSize > 160) { noteCache = {}; noteCacheSize = 0; }
      var pcm = renderPianoNote(midi, len);
      buf = ctx.createBuffer(1, pcm.length, SR);
      buf.getChannelData(0).set(pcm);
      noteCache[key] = buf; noteCacheSize++;
    }
    return buf;
  }
  /** Plays one piano note of `durSec` (plus its ring-out) at `when`, at `gain`, into `dest`. */
  function pianoNote(ctx, dest, midi, durSec, when, gain) {
    var src = ctx.createBufferSource(); src.buffer = pianoBuffer(ctx, midi, durSec);
    var g = ctx.createGain(); g.gain.value = gain == null ? 1 : gain;
    src.connect(g); g.connect(dest); src.start(when);
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
    var playing = false, startCtxTime = 0, startBeat = 0, cursorIdx = 0, timer = null, tickCb = null, endBeat = 0;
    var LOOKAHEAD = 0.25, INTERVAL = 60;
    var events = []; // {beat, dur, midi, voice, vel}

    function ensure() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = createPianoOutput(ctx);
    }
    function beatSec() { return (60 / Math.max(30, tempo)) / rate; }
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
    createPlayer: createPlayer, createPianoOutput: createPianoOutput, pianoNote: pianoNote, renderPianoNote: renderPianoNote
  };
})();
