/* The sheet as falling notes: each note a bar that falls onto the piano key it is played on, landing as it sounds,
 * labelled with its solfa. It follows the rehearsal player (its beat, its speed, its loop), so slowing the player down
 * slows the notes down with it.
 *
 * Pure geometry first (keyboard, bars, barLines: tested in web-site/tests/piano-roll.test.mjs), then the drawing on a
 * <canvas>. Plain script, no build step; loaded the first time the Piano tab opens. Exposes window.NfPianoRoll.
 */
(function () {
  "use strict";

  var BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];
  var KEYS_SHARE = 0.2; // of the height, the keyboard's
  var MIN_KEYS_PX = 64, MAX_KEYS_PX = 96;

  /**
   * The keys from the C at or below the lowest note to the B at or above the highest, at least two octaves (grown
   * upward and downward alike), laid across `width`: [{midi, black, x, w}], the white keys first.
   */
  function keyboard(midis, width) {
    var lo = Math.min.apply(null, midis), hi = Math.max.apply(null, midis);
    if (!isFinite(lo)) { lo = 60; hi = 71; }
    lo = Math.floor(lo / 12) * 12; hi = Math.ceil((hi + 1) / 12) * 12 - 1;
    while (hi - lo + 1 < 24) { if ((hi - lo + 1) / 12 % 2) hi += 12; else lo -= 12; }
    lo = Math.max(21, lo); hi = Math.min(108, hi);
    var whites = 0, m;
    for (m = lo; m <= hi; m++) if (!BLACK[m % 12]) whites++;
    var ww = width / whites, keys = [], x = 0;
    for (m = lo; m <= hi; m++) {
      if (BLACK[m % 12]) continue;
      keys.push({ midi: m, black: false, x: x, w: ww });
      x += ww;
    }
    var bw = ww * 0.62;
    keys.slice().forEach(function (white) {
      var sharp = white.midi + 1;
      if (sharp <= hi && BLACK[sharp % 12]) keys.push({ midi: sharp, black: true, x: white.x + ww - bw / 2, w: bw });
    });
    return keys;
  }

  /**
   * The notes in sight at `beat`, as bars over the keys: the bottom of the roll (y = height) is now, its top `ahead`
   * beats from now. [{x, w, y, h, voice, label, sounding}]; a note already past is gone, one still sounding sits on the
   * keys until it ends.
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

  /**
   * A roll on `canvas`. `set({voices, timeSignature})` gives it the sheet (voice 0 the tune, any others the parts);
   * `draw(beat)` paints that moment. The canvas is sized to its box at the screen's pixel density.
   */
  function create(canvas) {
    var ctx = canvas.getContext("2d"), voices = [], perBar = 4, keys = [], width = 0, height = 0, ratio = 1, last = 0;
    function fit() {
      var box = canvas.getBoundingClientRect(), w = Math.round(box.width), h = Math.round(box.height);
      ratio = window.devicePixelRatio || 1;
      if (w === width && h === height && canvas.width === Math.round(w * ratio)) return;
      width = w; height = h;
      canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
      keys = keyboard(allMidis(), width);
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
    function draw(beat) {
      last = beat;
      fit();
      if (!width || !height) return;
      var c = colours(canvas), keysH = Math.max(MIN_KEYS_PX, Math.min(MAX_KEYS_PX, height * KEYS_SHARE)), rollH = height - keysH;
      var ahead = Math.max(4, perBar * 2);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = c.surface; ctx.fillRect(0, 0, width, height);
      // The lanes of the black keys, faintly, so a falling bar reads against the key it will land on.
      ctx.globalAlpha = 0.05; ctx.fillStyle = c.ink;
      keys.forEach(function (k) { if (k.black) ctx.fillRect(k.x, 0, k.w, rollH); });
      ctx.globalAlpha = 1; ctx.strokeStyle = c.line; ctx.lineWidth = 1;
      barLines(perBar, beat, ahead, rollH).forEach(function (y) { ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(width, Math.round(y) + 0.5); ctx.stroke(); });
      var now = bars(voices, keys, beat, ahead, rollH), lit = {};
      now.forEach(function (b) {
        if (b.sounding) lit[b.midi] = lit[b.midi] === 0 ? 0 : b.voice;
        ctx.globalAlpha = b.voice === 0 ? 1 : 0.55;
        ctx.fillStyle = b.voice === 0 ? c.tune : c.muted;
        round(b.x, b.y, b.w, b.h, 4); ctx.fill();
        if (b.voice === 0 && b.label && b.h >= 16 && b.w >= 14) {
          ctx.globalAlpha = 1; ctx.fillStyle = c.onTune;
          ctx.font = "600 " + Math.min(13, Math.floor(b.w * 0.55)) + "px Inter, system-ui, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h - 3);
        }
      });
      ctx.globalAlpha = 1;
      // The keyboard: white keys, then black over them; a key sounding takes its voice's colour.
      keys.forEach(function (k) {
        if (k.black) return;
        ctx.fillStyle = lit[k.midi] === 0 ? c.tune : lit[k.midi] !== undefined ? c.muted : "#FFFFFF";
        ctx.fillRect(k.x, rollH, k.w, keysH);
        ctx.strokeStyle = "rgba(15,23,42,0.25)"; ctx.strokeRect(k.x + 0.5, rollH + 0.5, k.w - 1, keysH - 1);
        if (k.midi % 12 === 0) {
          ctx.fillStyle = lit[k.midi] === 0 ? "#FFFFFF" : "#64748B";
          ctx.font = "500 10px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
          ctx.fillText("C" + (k.midi / 12 - 1), k.x + k.w / 2, height - 4);
        }
      });
      keys.forEach(function (k) {
        if (!k.black) return;
        ctx.fillStyle = lit[k.midi] === 0 ? c.tune : lit[k.midi] !== undefined ? c.muted : "#1E293B";
        ctx.fillRect(k.x, rollH, k.w, keysH * 0.62);
      });
      ctx.fillStyle = c.tune; ctx.fillRect(0, rollH - 2, width, 2);
    }
    return {
      set: function (opts) {
        voices = opts.voices || [];
        var p = String(opts.timeSignature || "4/4").split("/").map(Number);
        perBar = p[0] && p[1] ? (p[0] * 4) / p[1] : 4;
        width = 0; // the keyboard is laid out again for these notes
        draw(last);
      },
      draw: draw,
      /** Lays the roll out again for a new size of its box (full screen, a turned phone). */
      resize: function () { width = 0; draw(last); }
    };
  }

  window.NfPianoRoll = { keyboard: keyboard, bars: bars, barLines: barLines, create: create };
})();
