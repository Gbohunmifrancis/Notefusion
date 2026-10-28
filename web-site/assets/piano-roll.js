/* The sheet as falling notes: each note a bar that falls onto the piano key it is played on, landing as it sounds,
 * labelled with its solfa. It follows the rehearsal player (its beat, its speed, its loop), so slowing the player down
 * slows the notes down with it. The keys are a finger wide on a phone and play when tapped, each marked with its
 * syllable in the sheet's key; a keyboard wider than the screen scrolls sideways and follows the tune while it plays.
 * Playing along, the roll waits on each note of the tune until its key is pressed (on the screen or on a keyboard plugged in).
 *
 * Pure geometry first (keyboard, keyAt, bars, barLines, tuneSpan, scaleSyllable, along: tested in
 * web-site/tests/piano-roll.test.mjs), then the drawing on a <canvas> inside a sideways scroller. Plain script, no build
 * step; loaded the first time the Piano tab opens. Exposes window.NfPianoRoll.
 */
(function () {
  "use strict";

  var BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  var BLACK_WIDTH = 0.62, BLACK_DEPTH = 0.6; // of a white key's width, of the keyboard's height
  // A white key at least a fingertip wide where fingers are the pointer (the 44 px tap target, and a little more so a
  // finger between two keys still lands on one), narrower under a mouse.
  var FINGER_KEY_PX = 48, MOUSE_KEY_PX = 28;
  var KEYS_SHARE = 0.3, MIN_KEYS_PX = 110, MAX_KEYS_PX = 160;
  var SYLLABLES = ["d", "", "r", "", "m", "f", "", "s", "", "l", "", "t"];

  function whitesIn(lo, hi) { var n = 0; for (var m = lo; m <= hi; m++) if (!BLACK[m % 12]) n++; return n; }

  /**
   * The keys from the C at or below the lowest note to the B at or above the highest, laid out from x = 0:
   * [{midi, black, x, w}], the white keys first. Each white key is `width` shared out, but never under `minKey`; so a
   * wide range runs past `width` (the caller scrolls). Two octaves at least, grown upward and downward alike, while
   * they still fit `width` at `minKey`.
   */
  function keyboard(midis, width, minKey) {
    minKey = minKey || 0;
    var lo = Math.min.apply(null, midis), hi = Math.max.apply(null, midis);
    if (!isFinite(lo)) { lo = 60; hi = 71; }
    lo = Math.max(21, Math.floor(lo / 12) * 12); hi = Math.min(108, Math.ceil((hi + 1) / 12) * 12 - 1);
    while (hi - lo + 1 < 24) {
      var up = (hi - lo + 1) / 12 % 2 === 1, nlo = up ? lo : Math.max(21, lo - 12), nhi = up ? Math.min(108, hi + 12) : hi;
      if ((nlo === lo && nhi === hi) || whitesIn(nlo, nhi) * minKey > width) break;
      lo = nlo; hi = nhi;
    }
    var ww = Math.max(minKey, width / whitesIn(lo, hi)), keys = [], x = 0, m;
    for (m = lo; m <= hi; m++) {
      if (BLACK[m % 12]) continue;
      keys.push({ midi: m, black: false, x: x, w: ww });
      x += ww;
    }
    var bw = ww * BLACK_WIDTH;
    keys.slice().forEach(function (white) {
      var sharp = white.midi + 1;
      if (sharp <= hi && BLACK[sharp % 12]) keys.push({ midi: sharp, black: true, x: white.x + ww - bw / 2, w: bw });
    });
    return keys;
  }
  /** How wide the keyboard is. */
  function span(keys) { return keys.reduce(function (most, k) { return Math.max(most, k.x + k.w); }, 0); }

  /** The key under a finger at (x, y) on a keyboard `depth` tall whose top is y = 0: a black key wins where it lies. */
  function keyAt(keys, x, y, depth) {
    if (y < 0 || y > depth) return null;
    var hit = null;
    keys.forEach(function (k) {
      if (x < k.x || x >= k.x + k.w) return;
      if (k.black && y <= depth * BLACK_DEPTH) hit = k;
      else if (!k.black && (!hit || !hit.black)) hit = k;
    });
    return hit;
  }

  /** A key's syllable in the scale whose doh is pitch class `dohPc` ("" for a note outside it). */
  function scaleSyllable(midi, dohPc) { return SYLLABLES[(((midi - dohPc) % 12) + 12) % 12]; }

  /**
   * The notes in sight at `beat`, as bars over the keys: the bottom of the roll (y = height) is now, its top `ahead`
   * beats from now. [{x, w, y, h, voice, label, sounding, midi}]; a note already past is gone, one still sounding sits on
   * the keys until it ends.
   */
  function bars(voices, keys, beat, ahead, height) {
    var byMidi = {};
    keys.forEach(function (k) { byMidi[k.midi] = k; });
    var out = [], perBeat = height / ahead;
    voices.forEach(function (v, vi) {
      (v.notes || []).forEach(function (n) {
        var key = byMidi[Math.round(n.pitchMidi)], end = n.startBeat + n.durBeats;
        if (!key || end <= beat || n.startBeat >= beat + ahead) return;
        var bottom = height - (n.startBeat - beat) * perBeat, top = height - (end - beat) * perBeat;
        out.push({
          x: key.x + 1, w: Math.max(2, key.w - 2), y: Math.max(0, top), h: Math.min(height, bottom) - Math.max(0, top),
          voice: vi, label: n.solfa ? n.solfa + (n.octaveMark || "") : "", sounding: n.startBeat <= beat + 1e-6 && beat < end, midi: key.midi
        });
      });
    });
    return out;
  }

  /**
   * Where the tune is about to be played: the left and right edges of its notes sounding or due in the lower `share`
   * of the roll ({lo, hi}), or null when none are. A keyboard wider than the screen keeps this in sight.
   */
  function tuneSpan(barsNow, height, share) {
    var lo = Infinity, hi = -Infinity;
    barsNow.forEach(function (b) {
      if (b.voice !== 0 || b.y + b.h < height * (1 - share)) return;
      lo = Math.min(lo, b.x); hi = Math.max(hi, b.x + b.w);
    });
    return lo <= hi ? { lo: lo, hi: hi } : null;
  }

  /**
   * Play along: the tune's notes one at a time, each waiting for its key. One note a moment (a chord's top note, as the
   * tune is the top line); the right note in any octave counts, as a small keyboard may not reach the written one.
   * `press(midi)` answers {kind: "right", note, done} or {kind: "wrong", want}; a note is right first time when no wrong key
   * came before it. Pure: the view moves the roll and the keyboard says what was pressed.
   */
  function along(notes) {
    var steps = [];
    (notes || []).filter(function (n) { return n.pitchMidi > 0; }).slice()
      .sort(function (a, b) { return a.startBeat - b.startBeat || b.pitchMidi - a.pitchMidi; })
      .forEach(function (n) {
        var prev = steps[steps.length - 1];
        if (!prev || n.startBeat - prev.startBeat > 1e-6) steps.push(n);
      });
    var at = 0, tries = 0, firstTime = 0;
    return {
      count: steps.length,
      index: function () { return at; },
      target: function () { return steps[at] || null; },
      done: function () { return at >= steps.length; },
      press: function (midi) {
        var want = steps[at];
        if (!want) return { kind: "done" };
        if ((((Math.round(midi) - Math.round(want.pitchMidi)) % 12) + 12) % 12 !== 0) { tries++; return { kind: "wrong", want: want }; }
        if (!tries) firstTime++;
        tries = 0; at++;
        return { kind: "right", note: want, done: at >= steps.length };
      },
      /** How it went: notes played, of them right first time, and the whole tune's count. */
      score: function () { return { played: at, firstTime: firstTime, total: steps.length }; },
      restart: function () { at = 0; tries = 0; firstTime = 0; }
    };
  }

  /** The bar lines in sight: the y of each bar's first beat between now and `ahead` beats on. */
  function barLines(perBar, beat, ahead, height) {
    var out = [];
    for (var b = Math.ceil(beat / perBar - 1e-9) * perBar; b < beat + ahead; b += perBar) out.push(height - (b - beat) * (height / ahead));
    return out;
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  function colours(el) {
    var css = getComputedStyle(el), v = function (name, fallback) { return (css.getPropertyValue(name) || "").trim() || fallback; };
    return { tune: v("--blue", "#2563EB"), ink: v("--text", "#0F172A"), muted: v("--text-muted", "#64748B"),
      surface: v("--surface", "#FFFFFF"), line: v("--border", "#E2E8F0"), onTune: "#FFFFFF" };
  }
  function fingers() { try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  var LIT_MS = 260, HANDS_OFF_MS = 4000;

  /**
   * A roll on `canvas`, inside `scroller` (whose width it fills, and past which a wide keyboard scrolls).
   * `set({voices, timeSignature, key})` gives it the sheet (voice 0 the tune, any others the parts); `draw(beat, playing)`
   * paints that moment and, while playing, keeps the tune in sight. `on.key(midi)` hears a key tapped, `on.roll()` a tap
   * on the falling notes.
   */
  function create(canvas, scroller, on) {
    var ctx = canvas.getContext("2d"), voices = [], perBar = 4, dohPc = null, keys = [], width = 0, height = 0, ratio = 1;
    var last = 0, lit = {}, litTimer = null, handsOnAt = -Infinity, ourScroll = false, target = null;
    var layout = { keysH: 0, rollH: 0 };
    on = on || {};

    function fit() {
      var box = scroller.clientWidth, h = Math.round(canvas.getBoundingClientRect().height), r = window.devicePixelRatio || 1;
      if (box === width && h === height && r === ratio && keys.length) return;
      width = box; height = h; ratio = r;
      keys = keyboard(allMidis(), width, fingers() ? FINGER_KEY_PX : MOUSE_KEY_PX);
      var wide = Math.ceil(span(keys));
      canvas.style.width = wide + "px";
      canvas.width = Math.round(wide * ratio); canvas.height = Math.round(height * ratio);
      layout.keysH = Math.max(MIN_KEYS_PX, Math.min(MAX_KEYS_PX, height * KEYS_SHARE));
      layout.rollH = height - layout.keysH;
    }
    function allMidis() {
      var out = [];
      voices.forEach(function (v) { (v.notes || []).forEach(function (n) { if (n.pitchMidi > 0) out.push(Math.round(n.pitchMidi)); }); });
      return out;
    }
    function round(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    /** Scrolls so the span [lo, hi] sits in the middle of the screen; gently while playing, at once otherwise. */
    function bring(lo, hi, gently) {
      var view = scroller.clientWidth, max = scroller.scrollWidth - view;
      if (max <= 0) return;
      var at = scroller.scrollLeft, margin = Math.min(view * 0.2, 80);
      if (gently && lo >= at + margin && hi <= at + view - margin) return;
      var target = Math.max(0, Math.min(max, (lo + hi) / 2 - view / 2));
      var next = gently ? at + (target - at) * 0.12 : target;
      if (Math.abs(next - at) < 0.5) return;
      ourScroll = true; scroller.scrollLeft = next;
    }
    function draw(beat, playing) {
      last = beat;
      fit();
      if (!width || !height) return;
      var c = colours(canvas), keysH = layout.keysH, rollH = layout.rollH, wide = canvas.width / ratio;
      var ahead = Math.max(4, perBar * 2), t = now();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, wide, height);
      ctx.fillStyle = c.surface; ctx.fillRect(0, 0, wide, height);
      // The lanes of the black keys, faintly, so a falling bar reads against the key it will land on.
      ctx.globalAlpha = 0.05; ctx.fillStyle = c.ink;
      keys.forEach(function (k) { if (k.black) ctx.fillRect(k.x, 0, k.w, rollH); });
      ctx.globalAlpha = 1; ctx.strokeStyle = c.line; ctx.lineWidth = 1;
      barLines(perBar, beat, ahead, rollH).forEach(function (y) { ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(wide, Math.round(y) + 0.5); ctx.stroke(); });
      var inSight = bars(voices, keys, beat, ahead, rollH), sounding = {};
      inSight.forEach(function (b) {
        // Playing along, a key lights only when it is pressed: the note waiting on it is the player's to find.
        if (b.sounding && target === null) sounding[b.midi] = sounding[b.midi] === 0 ? 0 : b.voice;
        ctx.globalAlpha = b.voice === 0 ? 1 : 0.55;
        ctx.fillStyle = b.voice === 0 ? c.tune : c.muted;
        round(b.x, b.y, b.w, b.h, 5); ctx.fill();
        if (b.voice === 0 && b.label && b.h >= 16 && b.w >= 14) {
          ctx.globalAlpha = 1; ctx.fillStyle = c.onTune;
          ctx.font = "600 " + Math.min(15, Math.floor(b.w * 0.5)) + "px Inter, system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h - 4);
        }
      });
      ctx.globalAlpha = 1;
      function fill(k, rest) {
        var press = lit[k.midi];
        if (press && press.until > t) return press.wrong ? c.muted : c.tune;
        if (sounding[k.midi] === 0) return c.tune;
        return sounding[k.midi] !== undefined ? c.muted : rest;
      }
      /** The key a note is waiting on, playing along: washed in the tune's colour and ringed. */
      function ring(k, depth) {
        if (k.midi !== target) return;
        ctx.globalAlpha = 0.28; ctx.fillStyle = c.tune; ctx.fillRect(k.x, rollH, k.w, depth);
        ctx.globalAlpha = 1; ctx.strokeStyle = c.tune; ctx.lineWidth = 3; ctx.strokeRect(k.x + 1.5, rollH + 1.5, k.w - 3, depth - 3);
        ctx.lineWidth = 1;
      }
      // The keyboard: white keys, then black over them. A key sounding or tapped takes the tune's colour; each is marked
      // with its syllable in the sheet's key (the doh bolder), and each C with its octave.
      keys.forEach(function (k) {
        if (k.black) return;
        var bg = fill(k, "#FFFFFF"), down = bg !== "#FFFFFF";
        ctx.fillStyle = bg; ctx.fillRect(k.x, rollH, k.w, keysH);
        ctx.strokeStyle = "rgba(15,23,42,0.25)"; ctx.strokeRect(k.x + 0.5, rollH + 0.5, k.w - 1, keysH - 1);
        if (!down) ring(k, keysH);
        ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        var syl = dohPc === null ? "" : scaleSyllable(k.midi, dohPc);
        if (syl && k.w >= 20) {
          ctx.fillStyle = down ? "#FFFFFF" : syl === "d" ? "#1D4ED8" : "#334155";
          ctx.font = (syl === "d" ? "700 " : "500 ") + Math.min(16, Math.floor(k.w * 0.4)) + "px Inter, system-ui, sans-serif";
          ctx.fillText(syl, k.x + k.w / 2, height - 6);
        }
        if (k.midi % 12 === 0) {
          ctx.fillStyle = down ? "#FFFFFF" : "#94A3B8";
          ctx.font = "500 10px Inter, system-ui, sans-serif";
          ctx.fillText("C" + (k.midi / 12 - 1), k.x + k.w / 2, height - (syl && k.w >= 20 ? 26 : 4));
        }
      });
      keys.forEach(function (k) {
        if (!k.black) return;
        var bg = fill(k, "#1E293B");
        ctx.fillStyle = bg; round(k.x, rollH - 1, k.w, keysH * BLACK_DEPTH + 1, 3); ctx.fill();
        if (bg === "#1E293B") ring(k, keysH * BLACK_DEPTH);
        var syl = dohPc === null ? "" : scaleSyllable(k.midi, dohPc);
        if (syl && k.w >= 16) {
          ctx.fillStyle = "#FFFFFF"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.font = (syl === "d" ? "700 " : "500 ") + Math.min(14, Math.floor(k.w * 0.45)) + "px Inter, system-ui, sans-serif";
          ctx.fillText(syl, k.x + k.w / 2, rollH + keysH * BLACK_DEPTH - 6);
        }
      });
      ctx.fillStyle = c.tune; ctx.fillRect(0, rollH - 2, wide, 2);
      // While it plays, the tune stays in sight, unless a finger has just moved the keyboard.
      if (playing && t - handsOnAt > HANDS_OFF_MS) {
        var tune = tuneSpan(inSight, rollH, 0.6);
        if (tune) bring(tune.lo, tune.hi, true);
      }
    }
    function point(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener("pointerdown", function (e) {
      handsOnAt = now();
      var p = point(e), key = keyAt(keys, p.x, p.y - layout.rollH, layout.keysH);
      if (!key) return;
      light(key.midi, false);
      if (on.key) on.key(key.midi);
    });
    /** A key pressed: lit in the tune's colour, or grey for a wrong one playing along, for a moment. */
    function light(midi, wrong) {
      lit[midi] = { until: now() + LIT_MS, wrong: !!wrong };
      draw(last, false);
      clearTimeout(litTimer);
      litTimer = setTimeout(function () { draw(last, false); }, LIT_MS + 20);
    }
    canvas.addEventListener("click", function (e) { if (point(e).y < layout.rollH && on.roll) on.roll(); });
    scroller.addEventListener("scroll", function () { if (ourScroll) ourScroll = false; else handsOnAt = now(); }, { passive: true });
    scroller.addEventListener("wheel", function () { handsOnAt = now(); }, { passive: true });

    /** The first notes of the tune in the middle of the screen, as the view opens on a sheet. */
    function toStart() {
      var first = null;
      (voices[0] && voices[0].notes || []).forEach(function (n) { if (n.pitchMidi > 0 && (!first || n.startBeat < first.startBeat)) first = n; });
      var key = first && keys.filter(function (k) { return k.midi === Math.round(first.pitchMidi); })[0];
      if (key) bring(key.x, key.x + key.w, false);
    }
    return {
      set: function (opts) {
        voices = opts.voices || [];
        var p = String(opts.timeSignature || "4/4").split("/").map(Number);
        perBar = p[0] && p[1] ? (p[0] * 4) / p[1] : 4;
        var key = window.NfChoir && opts.key ? window.NfChoir.parseKey(opts.key) : null;
        dohPc = key ? (key.mode === "minor" ? (key.tonicPitchClass + 3) % 12 : key.tonicPitchClass) : null;
        keys = []; // laid out again for these notes
        target = null;
        draw(0, false);
        toStart();
      },
      draw: draw,
      /** A key pressed on a keyboard plugged in, or judged wrong playing along: lit as a tap lights it. */
      light: light,
      /** The key a note is waiting on, playing along (null: none), brought into sight. */
      waitOn: function (midi) {
        target = midi === null || midi === undefined ? null : Math.round(midi);
        var key = target === null ? null : keys.filter(function (k) { return k.midi === target; })[0];
        if (key) bring(key.x, key.x + key.w, false);
        draw(last, false);
      },
      /** Lays the roll out again for a new size of its box (full screen, a turned phone). */
      resize: function () { keys = []; draw(last, false); }
    };
  }

  window.NfPianoRoll = { keyboard: keyboard, span: span, keyAt: keyAt, scaleSyllable: scaleSyllable, bars: bars, tuneSpan: tuneSpan, barLines: barLines, along: along, create: create };
})();
