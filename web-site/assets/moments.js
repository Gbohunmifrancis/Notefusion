/* The reward moments' player: a small signed .riv shown over the page for a few seconds by the Rive web player
 * (@rive-app/webgl2, pinned, about 1.1 MB), fetched once by warm() and never with the page. The Practice view plays the
 * 3D level-up and badge pieces (/assets/practice-3d/, design/rive/live.py) and the reward moments
 * (/assets/practice-moments/, design/rive/moments/moments.py) with it, and the web app's play-along its stars.
 *
 * One at a time: a moment asked for while another plays waits its turn. One asked for before the player is ready is
 * dropped (the toast or the still art carries the reward on its own). Not with reduced motion, data saving or no
 * WebGL2. A moment's values (the streak's days, the stars) go to the file's view model as it loads.
 * Plain script, no build step. Exposes window.NfMoments.
 */
(function () {
  "use strict";

  var RIVE_BASE = "https://cdn.jsdelivr.net/npm/@rive-app/webgl2@2.47.1/";
  var load = null, ready = false, queue = [], busy = false;

  function ok() {
    try { if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false; } catch (e) { /* no matchMedia */ }
    try { if (navigator.connection && navigator.connection.saveData) return false; } catch (e) { /* no Network Information API */ }
    try { return !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; }
  }

  /** Fetches the player, once; a failed fetch is tried again at the next warm(). */
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

  function setValues(player, values) {
    if (!values) return;
    try {
      var vm = player.viewModelInstance;
      if (!vm) return;
      Object.keys(values).forEach(function (name) {
        var v = values[name], prop = typeof v === "string" ? vm.string(name) : vm.number(name);
        if (prop) prop.value = v;
      });
    } catch (e) { /* an older file without the value: it plays its default */ }
  }

  /**
   * Shows a moment once it is its turn. spec: { src, width, height (CSS px at full size), ms, className, values,
   * onStart, onEnd }. False when it cannot play now (player not ready, reduced motion), so the caller knows.
   */
  function play(spec) {
    if (!ok() || !ready || !window.rive) return false;
    queue.push(spec);
    if (!busy) next();
    return true;
  }

  function next() {
    var spec = queue.shift();
    if (!spec) { busy = false; return; }
    busy = true;
    var R = window.rive, layer = document.createElement("div"), canvas = document.createElement("canvas");
    layer.className = spec.className || "nf-moment";
    layer.setAttribute("aria-hidden", "true");
    layer.style.setProperty("--mw", spec.width + "px");
    layer.style.aspectRatio = spec.width + " / " + spec.height;
    var px = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(spec.width * px); canvas.height = Math.round(spec.height * px);
    layer.appendChild(canvas);
    document.body.appendChild(layer);
    var player = null, over = false;
    function end() {
      if (over) return;
      over = true;
      layer.classList.add("out");
      if (spec.onEnd) spec.onEnd();
      setTimeout(function () {
        try { if (player) player.cleanup(); } catch (e) { /* already gone */ }
        layer.remove();
        next();
      }, 260);
    }
    try {
      player = new R.Rive({
        src: spec.src, canvas: canvas, autoplay: true, autoBind: true, enableGPUCanvas: true,
        layout: new R.Layout({ fit: R.Fit.Contain }),
        onLoad: function () { setValues(player, spec.values); },
        onLoadError: end
      });
    } catch (e) { end(); return; }
    if (spec.onStart) spec.onStart();
    setTimeout(end, spec.ms);
  }

  window.NfMoments = { ok: ok, warm: warm, play: play };
})();
