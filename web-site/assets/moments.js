/* The moments' player: one shown over the page for a few seconds, one at a time. The reward moments (Playful's stars,
 * the streak, the week's goal, a run in tune, a unit or grade finished, Doh cheering) are drawn on a 2D canvas by
 * assets/moment-art.js; the 3D level-up and badge pieces with WebGL2 by assets/moment-3d.js. The Practice view plays
 * both, the web app's play-along its stars.
 *
 * A moment asked for while another plays waits its turn. Never with reduced motion; a 3D piece not without WebGL2.
 * A piece whose pictures are not in within 1.5 s is skipped (the toast carries the reward on its own).
 * Plain script, no build step. Exposes window.NfMoments.
 */
(function () {
  "use strict";

  var queue = [], busy = false, webgl2 = null;

  function motionOk() {
    try { return !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return true; }
  }
  function hasWebgl2() {
    if (webgl2 === null) { try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch (e) { webgl2 = false; } }
    return webgl2;
  }
  /** The piece a name plays: a drawing (moment-art.js) or a 3D piece (moment-3d.js), or null. */
  function pieceFor(name) {
    return (window.NfMomentArt && window.NfMomentArt.PIECES[name]) || (window.NfMoment3D && window.NfMoment3D.piece(name)) || null;
  }

  /** Shows a moment once it is its turn: { piece (its name), values, className, onStart, onEnd }. False when it cannot. */
  function play(spec) {
    var art = pieceFor(spec.piece);
    if (!art || !motionOk() || (art.webgl && !hasWebgl2())) return false;
    if (art.prepare) art.prepare().catch(function () { /* skipped at its turn */ });
    queue.push({ spec: spec, art: art });
    if (!busy) next();
    return true;
  }

  function next() {
    var item = queue.shift();
    if (!item) { busy = false; return; }
    busy = true;
    if (!item.art.prepare) { show(item.spec, item.art, null); return; }
    var gone = false, wait = setTimeout(function () { gone = true; next(); }, 1500);
    item.art.prepare().then(function (pictures) {
      if (!gone) { clearTimeout(wait); show(item.spec, item.art, pictures); }
    }, function () { if (!gone) { clearTimeout(wait); next(); } });
  }

  function show(spec, art, pictures) {
    var layer = document.createElement("div"), canvas = document.createElement("canvas");
    layer.className = spec.className || "nf-moment";
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--mw", art.width + "px");
    layer.style.aspectRatio = art.width + " / " + art.height;
    layer.appendChild(canvas);
    document.body.appendChild(layer);
    var px = Math.min(2, window.devicePixelRatio || 1), shown = layer.offsetWidth || art.width;
    canvas.width = Math.round(shown * px); canvas.height = Math.round(shown * px * art.height / art.width);
    var frame = 0, over = false, gl = null, paint;
    function end() {
      if (over) return;
      over = true;
      if (frame) cancelAnimationFrame(frame);
      layer.classList.add("out");
      if (spec.onEnd) spec.onEnd();
      setTimeout(function () {
        try { var lose = gl && gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch (e) { /* already gone */ }
        layer.remove();
        next();
      }, 260);
    }
    try {
      if (art.webgl) {
        gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: true });
        paint = art.create(gl, pictures);
      } else {
        var c = canvas.getContext("2d"), scale = canvas.width / art.width;
        paint = function (t) {
          c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
          c.setTransform(scale, 0, 0, scale, 0, 0); c.globalAlpha = 1;
          art.draw(c, t, spec.values || {});
        };
      }
    } catch (e) { end(); return; }
    if (spec.onStart) spec.onStart();
    var start = 0;
    function step(now) {
      frame = 0;
      if (!start) start = now;
      var t = (now - start) / 1000;
      try { paint(Math.min(t, art.ms / 1000)); } catch (e) { end(); return; }
      if (t * 1000 >= art.ms) end(); else frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
    setTimeout(end, art.ms + 1000); // a hidden tab draws no frames: the moment still ends
  }

  window.NfMoments = { play: play };
})();
