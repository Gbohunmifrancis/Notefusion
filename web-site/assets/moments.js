/* The moments' player: one shown over the page for a few seconds, one at a time. The reward moments (Playful's stars,
 * the streak, the week's goal, a run in tune, a unit or grade finished, Doh cheering) are drawn on a canvas by
 * assets/moment-art.js; the 3D level-up and badge pieces (/assets/practice-3d/, design/rive/live.py) are small signed
 * .riv files played by the Rive web player (@rive-app/webgl2, pinned, about 1.1 MB), fetched by warm() and never with
 * the page. The Practice view plays both, the web app's play-along its stars.
 *
 * A moment asked for while another plays waits its turn. Never with reduced motion; a 3D piece also not with data
 * saving or no WebGL2, nor before its player is ready (the toast's still art carries the reward on its own).
 * Plain script, no build step. Exposes window.NfMoments.
 */
(function () {
  "use strict";

  var RIVE_BASE = "https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.47.1/";
  var load = null, ready = false, queue = [], busy = false;

  function motionOk() {
    try { return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return true; }
  }
  /** Whether a 3D piece can play here: motion, no data saving, WebGL2. */
  function ok() {
    if (!motionOk()) return false;
    try { if (navigator.connection && navigator.connection.saveData) return false; } catch (e) { /* no Network Information API */ }
    try { return !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; }
  }

  /** Fetches the 3D pieces' player, once; a failed fetch is tried again at the next warm(). */
  function warm() {
    if (load || !ok()) return;
    load = new Promise(function (resolve, reject) {
      var tag = document.createElement("script");
      tag.src = RIVE_BASE + "rive.js"; tag.async = true; tag.crossOrigin = "anonymous";
      tag.onload = function () { resolve(window.rive); };
      tag.onerror = function () { tag.remove(); reject(new Error("rive")); };
      document.head.appendChild(tag);
    }).then(function (R) {
      R.RuntimeLoader.setWasmUrl(RIVE_BASE + "rive.wasm");
      return R.RuntimeLoader.awaitInstance().then(function () { ready = true; return R; });
    });
    load.catch(function () { load = null; });
  }

  /**
   * Shows a moment once it is its turn. A reward moment: { piece (moment-art.js's), values, onStart, onEnd }. A 3D
   * piece: { src, width, height (CSS px at full size), ms, className, onStart, onEnd }. False when it cannot play now.
   */
  function play(spec) {
    if (spec.piece) {
      var art = window.NfMomentArt && window.NfMomentArt.PIECES[spec.piece];
      if (!art || !motionOk() || !document.createElement("canvas").getContext) return false;
      if (art.prepare) art.prepare();
    } else if (!ok() || !ready || !window.rive) return false;
    queue.push(spec);
    if (!busy) next();
    return true;
  }

  function next() {
    var spec = queue.shift();
    if (!spec) { busy = false; return; }
    busy = true;
    var art = spec.piece && window.NfMomentArt.PIECES[spec.piece];
    if (art && art.prepare) {
      // Doh's poses: wait for them a moment, or skip the piece.
      var gone = false, wait = setTimeout(function () { gone = true; next(); }, 1500);
      art.prepare().then(function () { if (!gone) { clearTimeout(wait); show(spec, art); } }, function () { if (!gone) { clearTimeout(wait); next(); } });
      return;
    }
    show(spec, art);
  }

  function show(spec, art) {
    var layer = document.createElement("div"), canvas = document.createElement("canvas");
    var width = art ? art.width : spec.width, height = art ? art.height : spec.height, ms = art ? art.ms : spec.ms;
    layer.className = spec.className || "nf-moment";
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--mw", width + "px");
    layer.style.aspectRatio = width + " / " + height;
    layer.appendChild(canvas);
    document.body.appendChild(layer);
    var px = Math.min(2, window.devicePixelRatio || 1), shown = layer.offsetWidth || width;
    canvas.width = Math.round(shown * px); canvas.height = Math.round(shown * px * height / width);
    var player = null, frame = 0, over = false;
    function end() {
      if (over) return;
      over = true;
      if (frame) cancelAnimationFrame(frame);
      layer.classList.add("out");
      if (spec.onEnd) spec.onEnd();
      setTimeout(function () {
        try { if (player) player.cleanup(); } catch (e) { /* already gone */ }
        layer.remove();
        next();
      }, 260);
    }
    if (spec.onStart) spec.onStart();
    if (art) {
      var c = canvas.getContext("2d"), scale = canvas.width / width, start = 0;
      var paint = function (now) {
        frame = 0;
        if (!start) start = now;
        var t = (now - start) / 1000;
        c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
        c.setTransform(scale, 0, 0, scale, 0, 0); c.globalAlpha = 1;
        try { art.draw(c, Math.min(t, ms / 1000), spec.values || {}); } catch (e) { end(); return; }
        if (t * 1000 >= ms) end(); else frame = requestAnimationFrame(paint);
      };
      frame = requestAnimationFrame(paint);
      setTimeout(end, ms + 1000); // a hidden tab draws no frames: the moment still ends
      return;
    }
    var R = window.rive;
    try {
      player = new R.Rive({
        src: spec.src, canvas: canvas, autoplay: true, enableGPUCanvas: true,
        layout: new R.Layout({ fit: R.Fit.Contain }), onLoadError: end
      });
    } catch (e) { end(); return; }
    setTimeout(end, ms);
  }

  window.NfMoments = { ok: ok, warm: warm, play: play };
})();
