/* NoteFusion choir helpers for the web: movable-do labelling, the hymn-book layout,
 * voice ranges, and a Web Audio rehearsal player. Mirrors mobile/src/lib/solfa.ts and
 * mobile/src/lib/choir.ts (and the engine in src/NoteFusion.Core/Solfa and the worker's
 * solfa.py) — keep them in lock-step; tests/choir.test.mjs holds the shared table.
 *
 * Plain script, no build step. Exposes window.NfChoir.
 */
(function () {
  "use strict";

  var PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  // Doh names as key signatures spell them ("Bb", never "A#"; F# kept), as mobile's DOH_NAMES.
  var DOH_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  // Minor tonics as their signatures spell them (G# minor, Bb minor; Eb at the tie), as MusicalKey.cs.
  var MINOR_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
  var ASC = ["d", "de", "r", "re", "m", "f", "fe", "s", "se", "l", "le", "t"];
  var DESC = ["d", "ra", "r", "ma", "m", "f", "sa", "s", "la", "l", "ta", "t"];
  var DEGREE = [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7];
  // The hymn-book name for each semitone above doh when the note does not move on by a
  // semitone: de, ma, fe, se, ta (true = sharpened). Reasons are in SolfaMapper.cs.
  var DEFAULT_SHARP = [true, true, true, false, true, true, true, true, true, true, false, true];
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
  /**
   * The unmarked doh, as a tonic solfa hymn book sets it: the doh at or below the middle
   * (median) note; in a la-based minor key the middle note is first raised a minor third, so
   * a tune centred on its lah keeps that lah under doh (l, t, d). Empty reads as middle C.
   */
  function referenceDoh(pitches, dohPc, mode) {
    var middle = 60;
    if (pitches.length) {
      var sorted = pitches.slice().sort(function (a, b) { return a - b; });
      var mid = sorted.length >> 1;
      middle = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    if (mode === "minor") middle += 3;
    var ref = Math.floor((middle - dohPc) / 12) * 12 + dohPc;
    while (ref > 127) ref -= 12;
    while (ref < 0) ref += 12;
    return ref;
  }
  /**
   * The hymn-book rule: a chromatic is named for where it goes — rising a semitone to the
   * next note it is sharpened (de re fe se le), falling a semitone flattened (ra ma sa la ta),
   * anything else (a tone, a leap, the last note) takes DEFAULT_SHARP. A run of one pitch
   * shares a name, read from the next differing pitch.
   */
  function ascendingFlags(pitches, dohPc) {
    var flags = [], start = 0;
    for (var k = 0; k < pitches.length; k++) flags.push(true);
    while (start < pitches.length) {
      var end = start;
      while (end + 1 < pitches.length && pitches[end + 1] === pitches[start]) end++;
      var step = end + 1 < pitches.length ? pitches[end + 1] - pitches[start] : 0;
      var flag = step === 1 ? true : step === -1 ? false : DEFAULT_SHARP[(((pitches[start] - dohPc) % 12) + 12) % 12];
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
    var refDoh = referenceDoh((refPitches || notes).map(function (n) { return n.pitchMidi; }), dohPc, key.mode);
    var order = notes.map(function (_, i) { return i; }).sort(function (a, b) { return notes[a].startBeat - notes[b].startBeat; });
    var inOrder = ascendingFlags(order.map(function (i) { return notes[i].pitchMidi; }), dohPc);
    var asc = [];
    order.forEach(function (idx, k) { asc[idx] = inOrder[k]; });
    return notes.map(function (n, i) {
      var s = syllable(n.pitchMidi, dohPc, refDoh, asc[i]);
      return { pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats, conf: n.conf == null ? 1 : n.conf, solfa: s.solfa, octaveMark: s.octaveMark, degree: s.degree };
    });
  }
  /**
   * The notes a part's octave marks are measured from (label's `refPitches`): the soprano, which is
   * the tune as the parts write it (a man's tune moved up to a soprano's octave, so it reads exactly
   * as the tune does), or the melody when there is no soprano. Mirrors SolfaLabels.LabelParts.
   */
  function partReference(parts, melody) {
    var soprano = parts && parts.soprano && parts.soprano.notes;
    return soprano && soprano.length ? soprano : (melody || []);
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
    var pc = (((k.tonicPitchClass + semitones) % 12) + 12) % 12;
    return (k.mode === "minor" ? MINOR_NAMES : DOH_NAMES)[pc] + " " + k.mode;
  }

  // ── Piano voice ──────────────────────────────────────────────────────────
  // Recorded piano, the same 17 Salamander Grand soft-layer notes mobile/src/lib/synth.ts
  // plays (tools/build-piano-samples.py makes both packs from one source; keep the two
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
    // Where another source joins the safety stage without the piano's level or soundboard: the song's backing.
    input.limiterInput = scale;
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

  // ── The transport: which notes sound when, on one clock ──────────────────
  /**
   * Where a beat falls in time: assets/backing-clock.js on a page that plays a song's backing (its beat times
   * included), the tempo alone on pages that never do (the hymn pages, a shared sheet) — the same clock without them.
   */
  var TEMPO_CLOCK = {
    audioTimeOfBeat: function (beat, clock) { return (clock.beatOriginSec || 0) + (beat * 60) / clock.tempo; },
    beatOfAudioTime: function (sec, clock) { return ((sec - (clock.beatOriginSec || 0)) * clock.tempo) / 60; }
  };
  function clockMaths() { return (typeof window !== "undefined" && window.NfBackingClock) || TEMPO_CLOCK; }

  /**
   * Which notes to strike, and when. Pure: the caller says what time it is. `events` are sorted by `beat`; `clock` is
   * { tempo, beatOriginSec, beatTimesSec }. From an anchor (a beat sounding at a time, at a speed), beat b sounds at
   * time + (A(b) − A(beat)) / speed, A being where the beat falls in the recording, and the recording is then at
   * A(beat) + (t − time) · speed: the notes and the song's backing keep one clock at any speed. A loop's wrap and a new
   * speed take effect as a new anchor at the end of what has already been handed out, never inside it, so every note of
   * the sheet, or of the loop, is handed out exactly once per pass (web-site/tests/backing-clock.test.mjs).
   */
  function createTransport(events, endBeat, clock) {
    var M = clockMaths(), EPS = 1e-6, T_EPS = 1e-9;
    var anchors = [], cursor = 0, loop = null, rate = 1, handed = 0, running = false;
    function place(beat) { return M.audioTimeOfBeat(beat, clock); }
    function firstIndexAt(beat) { var i = 0; while (i < events.length && events[i].beat < beat - EPS) i++; return i; }
    function anchorAt(t) { for (var i = anchors.length - 1; i > 0; i--) if (anchors[i].time <= t + T_EPS) return anchors[i]; return anchors[0]; }
    function timeOf(beat, a) { return a.time + (place(beat) - place(a.beat)) / a.rate; }
    function audioAt(t) { var a = anchorAt(t); return place(a.beat) + (t - a.time) * a.rate; }
    function beatAt(t) { return M.beatOfAudioTime(audioAt(t), clock); }
    /** A new anchor; a jump (a wrap, a loop moved away from the playhead) also moves the next note to its beat. */
    function anchor(beat, time, jump) {
      anchors.push({ beat: beat, time: time, rate: rate, jump: !!jump });
      if (jump) cursor = firstIndexAt(beat);
    }
    return {
      /** Starts at `fromBeat` (its loop's start when outside the loop), sounding at `time`; returns the beat it starts on. */
      start: function (fromBeat, time) {
        if (loop && (fromBeat < loop.start - EPS || fromBeat >= loop.end - EPS)) fromBeat = loop.start;
        anchors = []; anchor(fromBeat, time, true); handed = time; running = true;
        return fromBeat;
      },
      stop: function () { running = false; },
      running: function () { return running; },
      /** The beat sounding at time `t`, and where the recording is then. */
      beatAt: beatAt,
      audioAt: audioAt,
      rateAt: function (t) { return anchorAt(t).rate; },
      /** The anchor that takes over after time `t` ({time, jump}), or null. */
      nextChange: function (t) { for (var i = 0; i < anchors.length; i++) if (anchors[i].time > t + T_EPS) return anchors[i]; return null; },
      /** Forgets the anchors time `t` has left behind. */
      prune: function (t) { while (anchors.length > 1 && anchors[1].time <= t + T_EPS) anchors.shift(); },
      /** Everything due up to `horizon`, in order: {kind: "note", event, when}, {kind: "wrap", beat, when}, {kind: "end", when}. */
      pull: function (horizon) {
        var out = [];
        while (running) {
          var a = anchors[anchors.length - 1], stopBeat = loop ? loop.end : endBeat;
          if (cursor >= events.length || events[cursor].beat >= stopBeat - EPS) {
            var at = timeOf(stopBeat, a);
            if (at > horizon) break;
            if (loop) { anchor(loop.start, at, true); out.push({ kind: "wrap", beat: loop.start, when: at }); continue; }
            running = false; out.push({ kind: "end", when: at }); break;
          }
          var ev = events[cursor], when = timeOf(ev.beat, a);
          if (when > horizon) break;
          out.push({ kind: "note", event: ev, when: when });
          cursor++;
        }
        if (horizon > handed) handed = horizon;
        return out;
      },
      /** The speed, from the end of what has been handed out. */
      setRate: function (r) { rate = r; if (running) anchor(beatAt(handed), handed, false); },
      /** Beats [start, end) to repeat (null clears it); playing outside them moves to their start. */
      setLoop: function (start, end) {
        loop = start == null || end == null || end <= start + EPS ? null : { start: start, end: end };
        if (!loop || !running) return;
        var b = beatAt(handed);
        if (b < loop.start - EPS || b >= loop.end - EPS) anchor(loop.start, handed, true);
      }
    };
  }

  // ── Rehearsal player (Web Audio) ─────────────────────────────────────────
  // Schedules each note a little ahead on an AudioContext clock (the transport above). Voices have their own gain so a
  // part can be muted mid-bar ("minus one"); the loop and the speed are the transport's, so a passage repeats cleanly
  // at any rate.
  //
  // The song's own backing (the instrumental the worker separated from the voice, boards o-backing O1–O4) plays under
  // the notes on the same clock, from an <audio> element routed into the same context: unlike an AudioBufferSource it
  // keeps its key when slowed (preservesPitch). It starts at the transport's place in the recording, seeks back with a
  // loop's wrap and takes a new speed when the notes do. While both play, a seek is a skip the ear hears, so a drift is
  // put right only when it holds (assets/backing-clock.js watchDrift: past 80 ms for 400 ms, a small one at most every
  // 3 s); at 40 ms the element's clock read between ticks set off a skip several times a second. If it is still
  // loading, the notes start alone and the band joins in step. The balance sets the piano's level and the backing's
  // (balanceGains: they never add up past full), and the backing joins the piano's soft limiter rather than going
  // straight to the speakers, where piano and band together clipped on every loud beat.
  var BACKING_LEVEL = 0.85; // the backing at "full": the level it has always played at under the piano
  var SETTLE_SEC = 0.15;
  /**
   * An <audio> routed into the context is heard about this long after the place its currentTime reports (measured in
   * Chromium, which most of our listeners use: 25–40 ms at every speed, the file itself exact), so it is kept that far
   * ahead of the notes' place in the recording. Measured by what the graph actually plays (a click on every beat,
   * timestamped by an AudioWorklet against the notes' scheduled times), the backing then lands within ±30 ms at 1×,
   * 0.75× and 0.5×, through loops and changes of speed. currentTime alone is not a measure of what is heard while the
   * audio is time-stretched, so nothing here learns from it beyond putting right a drift that holds.
   */
  var ELEMENT_LAG_SEC = 0.03;
  function balanceGains(balance) {
    var BC = typeof window !== "undefined" ? window.NfBackingClock : null;
    return BC ? BC.balanceGains(balance) : { solfa: 1, backing: 1 };
  }
  function createPlayer() {
    var ctx = null, master = null;
    var voices = [], tempo = 100, ts = "4/4", rate = 1, loop = null, bars = 0;
    var playing = false, startBeat = 0, timer = null, tickCb = null, endBeat = 0, pendingPlay = null;
    var LOOKAHEAD = 0.25, INTERVAL = 60;
    var events = []; // {beat, dur, midi, voice, vel}
    var clock = { tempo: 100, beatOriginSec: 0, beatTimesSec: null }, transport = createTransport([], 0, clock);
    var backing = {
      el: null, gain: null, bytes: null, url: null, ready: false, on: false, balance: 0.4, unlocked: false, blocked: false, reseek: false,
      drift: { overSince: null, lastPullAt: null },
      settleUntil: 0, waitTimer: null, changeTimer: null, changeAt: null, endTimer: null
    };

    function ensure() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = createPianoOutput(ctx);
    }
    function nowBeat() { return playing ? transport.beatAt(ctx.currentTime) : startBeat; }
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
      transport = createTransport(events, endBeat, clock);
      transport.setRate(rate);
      if (loop) transport.setLoop(loop.start, loop.end);
    }
    function strike(ev, when) {
      var M = clockMaths();
      var durSec = (M.audioTimeOfBeat(ev.beat + ev.dur, clock) - M.audioTimeOfBeat(ev.beat, clock)) / transport.rateAt(when);
      pianoNote(ctx, voices[ev.voice].gainNode, ev.midi, durSec, when, ev.vel);
    }
    function schedule() {
      if (!playing) return;
      var now = ctx.currentTime;
      transport.prune(now);
      var due = transport.pull(now + LOOKAHEAD);
      for (var i = 0; i < due.length; i++) {
        var d = due[i];
        if (d.kind === "note") { if (voices[d.event.voice].on) strike(d.event, Math.max(d.when, now)); }
        else if (d.kind === "end") { finish(d.when); return; }
      }
      followBacking(now);
      if (tickCb) tickCb({ beat: nowBeat(), playing: true });
    }
    /** The end of the piece: the last notes ring on, and the backing stops where they end. */
    function finish(at) {
      playing = false; startBeat = 0; stopTimer(); clearBackingTimers();
      backing.endTimer = setTimeout(pauseBacking, Math.max(0, (at - ctx.currentTime) * 1000));
      if (tickCb) tickCb({ beat: 0, playing: false });
    }
    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

    // ── The backing ──
    function backingElement() {
      if (backing.el) return backing.el;
      var el = document.createElement("audio");
      el.preload = "auto";
      el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true;
      el.addEventListener("loadedmetadata", function () {
        if (!backing.url || el.src !== backing.url) return;
        backing.ready = true; applyGains();
        if (playing) followBacking(ctx.currentTime);
      });
      el.addEventListener("error", function () { if (el.getAttribute("src")) { backing.ready = false; applyGains(); } });
      // Started from a pause while slowed, the time-stretcher lands anywhere within ±80 ms; a seek once it is playing
      // lands where a seek always does.
      el.addEventListener("playing", function () { if (backing.reseek) { backing.reseek = false; if (playing) syncBacking(true); } });
      var node = ctx.createMediaElementSource(el);
      backing.gain = ctx.createGain(); backing.gain.gain.value = 0;
      node.connect(backing.gain); backing.gain.connect(master.limiterInput || ctx.destination);
      backing.el = el;
      return el;
    }
    function backingLive() { return backing.on && backing.ready; }
    function applyGains() {
      if (!ctx) return;
      var g = balanceGains(backing.balance), live = backingLive(), t = ctx.currentTime;
      master.gain.setTargetAtTime(live ? g.solfa : 1, t, 0.03);
      if (backing.gain) backing.gain.gain.setTargetAtTime(live ? g.backing * BACKING_LEVEL : 0, t, 0.03);
    }
    function pauseBacking() { if (backing.el && !backing.el.paused) backing.el.pause(); }
    function clearBackingTimers() {
      clearTimeout(backing.waitTimer); clearTimeout(backing.changeTimer); clearTimeout(backing.endTimer);
      backing.waitTimer = backing.changeTimer = backing.endTimer = null; backing.changeAt = null;
    }
    function seekBacking(aim) {
      backing.el.currentTime = Math.max(0, aim);
      backing.settleUntil = ctx.currentTime + SETTLE_SEC;
    }
    function startElement(r) {
      backing.reseek = r !== 1;
      var p = backing.el.play();
      // The browser wants a press first: the solfa plays on alone until the next Play.
      if (p && p.catch) p.catch(function (err) { if (err && err.name === "NotAllowedError") backing.blocked = true; });
    }
    /**
     * Puts the backing where the transport says the recording is now: started there, seeked there (a jump, or a drift
     * that holds once a seek has settled: backing-clock.js watchDrift), or left alone.
     */
    function syncBacking(jump) {
      var el = backing.el;
      clearTimeout(backing.waitTimer); backing.waitTimer = null;
      if (!el || !backing.ready) return;
      if (!playing || !backing.on) { pauseBacking(); return; }
      var now = ctx.currentTime, want = transport.audioAt(now), r = transport.rateAt(now);
      if (el.playbackRate !== r) { el.defaultPlaybackRate = r; el.playbackRate = r; }
      // A note before the recording starts (a pickup sung alone): the band waits for its moment. Past its end, it is done.
      if (want < 0) { pauseBacking(); backing.waitTimer = setTimeout(function () { syncBacking(false); }, (-want / r) * 1000); return; }
      if (!(want < el.duration - 0.05)) { pauseBacking(); return; }
      var aim = want + ELEMENT_LAG_SEC * r;
      if (el.paused) { if (!backing.blocked) { seekBacking(aim); startElement(r); } backing.drift = { overSince: null, lastPullAt: null }; return; }
      if (jump) { seekBacking(aim); backing.drift = { overSince: null, lastPullAt: null }; return; }
      if (el.seeking || now < backing.settleUntil) return;
      var BC = window.NfBackingClock;
      if (!BC || !BC.watchDrift) return;
      var step = BC.watchDrift(backing.drift, el.currentTime - aim, Date.now());
      backing.drift = step.watch;
      if (step.pull) seekBacking(aim);
    }
    /** Every tick: in step, and ready for the next wrap or speed, which takes over between ticks at its own moment. */
    function followBacking(now) {
      if (!backingLive()) return;
      syncBacking(false);
      var next = transport.nextChange(now);
      if (!next || next.time === backing.changeAt) return;
      clearTimeout(backing.changeTimer); backing.changeAt = next.time;
      backing.changeTimer = setTimeout(function fire() {
        var left = next.time - ctx.currentTime;
        if (left > 0.002) { backing.changeTimer = setTimeout(fire, left * 1000); return; }
        backing.changeAt = null; syncBacking(next.jump);
      }, Math.max(0, (next.time - now) * 1000));
    }
    /** Safari lets an <audio> play later only once it has played on a press: on the first Play, a silent start and stop. */
    function unlockBacking() {
      var el = backing.el;
      if (!el || !backing.ready || backing.unlocked) return;
      backing.unlocked = true;
      el.muted = true;
      var p = el.play(), done = function () { if (!playing) el.pause(); el.muted = false; };
      if (p && p.then) p.then(done, function () { el.muted = false; }); else done();
    }

    return {
      /**
       * voicesIn: [{name, notes, gain, on}] in the tune's beats. `beatOriginSec` / `beatTimesSec` place the beats in the
       * song's recording (assets/backing-clock.js); without them the tempo is the clock.
       */
      load: function (opts) {
        ensure();
        loadPiano(ctx).catch(function () { /* play() reports it */ });
        voices.forEach(function (v) { try { v.gainNode.disconnect(); } catch (e) { /* ignore */ } });
        tempo = opts.tempoBpm || 100; ts = opts.timeSignature || "4/4";
        clock.tempo = Math.max(30, tempo);
        clock.beatOriginSec = Number(opts.beatOriginSec) || 0;
        clock.beatTimesSec = Array.isArray(opts.beatTimesSec) && opts.beatTimesSec.length ? opts.beatTimesSec : null;
        voices = (opts.voices || []).map(function (v) {
          var g = ctx.createGain(); g.gain.value = v.gain == null ? 1 : v.gain; g.connect(master);
          return { name: v.name, notes: v.notes || [], on: v.on !== false, gainNode: g, full: g.gain.value, level: 1 };
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
        backing.blocked = false;
        unlockBacking();
        var mine = pendingPlay = {};
        loadPiano(ctx).then(function () {
          if (pendingPlay !== mine) return;
          pendingPlay = null;
          clearBackingTimers();
          startBeat = transport.start(startBeat, ctx.currentTime + 0.05);
          playing = true;
          stopTimer(); timer = setInterval(schedule, INTERVAL); schedule();
        }, function () { if (pendingPlay === mine) pendingPlay = null; if (tickCb) tickCb({ beat: startBeat, playing: false }); });
      },
      pause: function () {
        pendingPlay = null;
        if (!playing) return;
        startBeat = nowBeat(); playing = false; transport.stop(); stopTimer(); clearBackingTimers(); pauseBacking();
        if (tickCb) tickCb({ beat: startBeat, playing: false });
      },
      stop: function () {
        pendingPlay = null; playing = false; transport.stop(); stopTimer(); clearBackingTimers(); pauseBacking();
        startBeat = loop ? loop.start : 0;
        if (tickCb) tickCb({ beat: startBeat, playing: false });
      },
      toggle: function () { playing ? this.pause() : this.play(); },
      isPlaying: function () { return playing; },
      setRate: function (r) {
        rate = Math.min(2, Math.max(0.5, r));
        transport.setRate(rate);
        if (playing) followBacking(ctx.currentTime);
      },
      /**
       * The song's instrumental as encoded audio bytes (an ArrayBuffer of MP3); null clears it. The same bytes again
       * change nothing. A number after it moves where beat 0 falls in it (as `load`'s beatOriginSec).
       */
      setBacking: function (bytes, originSec) {
        if (typeof originSec === "number") clock.beatOriginSec = originSec;
        if ((bytes || null) === backing.bytes) return;
        backing.bytes = bytes || null; backing.ready = false;
        pauseBacking(); applyGains();
        if (backing.url) { URL.revokeObjectURL(backing.url); backing.url = null; }
        if (!bytes) { if (backing.el) { backing.el.removeAttribute("src"); backing.el.load(); } return; }
        ensure();
        var el = backingElement();
        backing.url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
        el.src = backing.url;
      },
      setBackingOn: function (on) {
        backing.on = !!on; applyGains();
        if (!playing) return;
        if (backing.on) followBacking(ctx.currentTime); else pauseBacking();
      },
      /** The balance: 0 the solfa alone, 1 the backing alone (0.4 by default). Only heard while the backing plays. */
      setBalance: function (b) { backing.balance = Math.min(1, Math.max(0, Number(b) || 0)); applyGains(); },
      hasBacking: function () { return backing.ready; },
      getRate: function () { return rate; },
      /** Bars are 1-based and inclusive; null clears the passage. */
      setLoopBars: function (from, to) {
        if (from == null || to == null) loop = null;
        else {
          var bpb = beatsPerBar(ts);
          loop = { start: Math.max(0, (from - 1) * bpb), end: Math.min(endBeat + 1e-6, to * bpb) };
          if (loop.end <= loop.start + 1e-6) loop = null;
        }
        transport.setLoop(loop ? loop.start : null, loop ? loop.end : null);
        if (playing) followBacking(ctx.currentTime);
      },
      setVoiceOn: function (name, on) { voices.forEach(function (v) { if (v.name === name) { v.on = on; v.gainNode.gain.setTargetAtTime(on ? v.full * v.level : 0, ctx.currentTime, 0.02); } }); },
      /** A voice's loudness against its own (1 = as loaded, 0.25 = soft under another part), mid-note. */
      setVoiceLevel: function (name, level) { voices.forEach(function (v) { if (v.name === name) { v.level = level; v.gainNode.gain.setTargetAtTime(v.on ? v.full * level : 0, ctx.currentTime, 0.02); } }); },
      barCount: function () { return bars; },
      onTick: function (cb) { tickCb = cb; },
      beat: function () { return nowBeat(); }
    };
  }

  window.NfChoir = {
    parseKey: parseKey, label: label, partReference: partReference, keyHeader: keyHeader, renderLines: renderLines, hymnRows: hymnRows,
    syllabify: syllabify, lyricsUnderNotes: lyricsUnderNotes, barCount: barCount, beatsPerBar: beatsPerBar,
    VOICES: VOICES, rangeReport: rangeReport, pitchName: pitchName, shiftKeyName: shiftKeyName,
    createPlayer: createPlayer, createTransport: createTransport, createPianoOutput: createPianoOutput, loadPiano: loadPiano, pianoNote: pianoNote
  };
})();
