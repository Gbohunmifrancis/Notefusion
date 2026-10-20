/* The browser's Back button for what opens on top of a page: a view, a sheet, a pop-up, the recorder.
 * Each one pushes a history entry as it opens, and Back closes the one on top instead of leaving the page.
 * Closed on screen instead (its X, Escape, a button), a layer's entry is left in place and stepped over by the
 * next Back, so a later opening never races the browser's own history traversal. Plain script, no build step.
 *
 *   var layer = NfBack.push(function () { … close it … });   // as it opens
 *   NfBack.done(layer);                                       // when it was closed on screen */
(function () {
  "use strict";
  var stack = []; // the layers, oldest first; stack[i] owns the history entry whose state is { nfBack: i + 1 }

  function push(close) {
    var layer = { close: close, dead: false };
    stack.push(layer);
    try { history.pushState({ nfBack: stack.length }, "", location.href); } catch (e) { /* Back then simply leaves */ }
    return layer;
  }
  function done(layer) { if (layer) layer.dead = true; }

  window.addEventListener("popstate", function (e) {
    var target = (e.state && e.state.nfBack) || 0;
    if (target >= stack.length) {
      // An entry left over from before a reload (or Forward into one): nothing to close, so on to the page before.
      if (!stack.length && target > 0) history.back();
      return;
    }
    var closed = false;
    while (stack.length > target) {
      var top = stack.pop();
      if (!top.dead) { closed = true; try { top.close(); } catch (err) { /* the page stays usable */ } }
    }
    // Only entries of layers already closed on screen: one Back is one step, so take the next one too.
    if (!closed) history.back();
  });

  window.NfBack = { push: push, done: done };
})();
