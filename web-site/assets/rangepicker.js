/* Picking the part of a song to transcribe: a two-handle range over the whole song, and the
 * card that wraps it (cover, title, total length, what is selected against the allowance).
 * Used by the web app's link form (app.js) and the free preview on the home page (preview.js).
 *
 * Plain script, no build step. Exposes window.NfRangePicker.
 */
(function () {
  "use strict";

  /** Seconds as m:ss, or h:mm:ss from an hour up. */
  function formatTime(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var ms = (h ? String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
    return h ? h + ":" + ms : ms;
  }
  /** An allowance said in words: "30 seconds", "1 minute", "6 minutes", else m:ss. */
  function sayLength(sec) {
    if (sec < 60) return sec + " seconds";
    if (sec % 60 === 0) return (sec / 60) + (sec === 60 ? " minute" : " minutes");
    return formatTime(sec);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /**
   * A range over ``total`` seconds whose window is at most ``max`` long. Drag either handle or the
   * window itself; arrows move a focused handle a second (Shift: ten), Home/End jump. Everything
   * snaps to whole seconds. When a handle is pushed past the allowance the other one follows.
   * Returns { el, get(), set(start, end), destroy() }; ``onChange(start, end)`` fires on every move.
   */
  function create(host, opts) {
    var total = Math.max(1, Math.round(opts.total)), max = Math.max(1, Math.round(opts.max || total));
    var min = Math.max(1, Math.round(opts.min || 1));
    var start = 0, end = Math.min(total, max);
    var onChange = opts.onChange || function () {};

    var root = el("div", "rp");
    var times = el("div", "rp-times");
    var tStart = el("span", "rp-time rp-time-start"), tEnd = el("span", "rp-time rp-time-end");
    times.appendChild(tStart); times.appendChild(tEnd);
    var track = el("div", "rp-track");
    var fill = el("div", "rp-fill");
    var hStart = handle("Start of the section"), hEnd = handle("End of the section");
    track.appendChild(fill); track.appendChild(hStart); track.appendChild(hEnd);
    var scale = el("div", "rp-scale");
    scale.appendChild(el("span", "", "0:00")); scale.appendChild(el("span", "", formatTime(total)));
    root.appendChild(times); root.appendChild(track); root.appendChild(scale);
    host.appendChild(root);

    function handle(label) {
      var h = el("div", "rp-handle");
      h.setAttribute("role", "slider"); h.setAttribute("tabindex", "0");
      h.setAttribute("aria-label", label); h.setAttribute("aria-valuemin", "0"); h.setAttribute("aria-valuemax", String(total));
      return h;
    }
    function pct(sec) { return (sec / total * 100) + "%"; }
    function render() {
      hStart.style.left = pct(start); hEnd.style.left = pct(end);
      fill.style.left = pct(start); fill.style.width = pct(end - start);
      tStart.style.left = pct(start); tEnd.style.left = pct(end);
      tStart.textContent = formatTime(start); tEnd.textContent = formatTime(end);
      hStart.setAttribute("aria-valuenow", String(start)); hStart.setAttribute("aria-valuetext", formatTime(start));
      hEnd.setAttribute("aria-valuenow", String(end)); hEnd.setAttribute("aria-valuetext", formatTime(end));
      // The two time labels keep apart when the handles come close.
      var w = track.clientWidth || 0, gap = (end - start) / total * w, need = Math.max(tStart.offsetWidth, tEnd.offsetWidth) + 6;
      var shift = gap < need ? (need - gap) / 2 : 0;
      tStart.style.transform = "translateX(calc(-50% - " + shift + "px))";
      tEnd.style.transform = "translateX(calc(-50% + " + shift + "px))";
    }
    /** The window after a move of one edge: the other edge follows so the window stays within [min, max]. */
    function setStart(s) {
      s = clamp(Math.round(s), 0, total - min);
      var e = end;
      if (e - s > max) e = s + max;
      if (e - s < min) e = s + min;
      if (e > total) { e = total; s = e - min; }
      start = s; end = e;
    }
    function setEnd(e) {
      e = clamp(Math.round(e), min, total);
      var s = start;
      if (e - s > max) s = e - max;
      if (e - s < min) s = e - min;
      if (s < 0) { s = 0; e = min; }
      start = s; end = e;
    }
    function moveWindow(s) {
      var len = end - start;
      s = clamp(Math.round(s), 0, total - len);
      start = s; end = s + len;
    }
    function commit() { render(); onChange(start, end); }
    function secondsAt(clientX) {
      var r = track.getBoundingClientRect();
      return clamp((clientX - r.left) / Math.max(1, r.width), 0, 1) * total;
    }

    // Pointer events cover mouse, touch and pen alike; the track turns off browser panning.
    function drag(target, onMove) {
      target.addEventListener("pointerdown", function (e) {
        if (e.button && e.button !== 0) return;
        e.preventDefault();
        var grab = secondsAt(e.clientX), s0 = start;
        if (target.setPointerCapture) { try { target.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } }
        root.classList.add("is-dragging");
        if (target.focus) target.focus({ preventScroll: true });
        function move(ev) { onMove(secondsAt(ev.clientX), grab, s0); commit(); }
        function up() {
          target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up);
          root.classList.remove("is-dragging");
        }
        target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
      });
    }
    drag(hStart, function (sec) { setStart(sec); });
    drag(hEnd, function (sec) { setEnd(sec); });
    drag(fill, function (sec, grab, s0) { moveWindow(s0 + (sec - grab)); });
    // A tap on the bare track moves the nearer handle there.
    track.addEventListener("pointerdown", function (e) {
      if (e.target !== track) return;
      var sec = secondsAt(e.clientX);
      if (Math.abs(sec - start) <= Math.abs(sec - end)) { setStart(sec); hStart.focus(); } else { setEnd(sec); hEnd.focus(); }
      commit();
    });

    function keys(h, set, get) {
      h.addEventListener("keydown", function (e) {
        var step = e.shiftKey ? 10 : 1, v = get();
        switch (e.key) {
          case "ArrowLeft": case "ArrowDown": v -= step; break;
          case "ArrowRight": case "ArrowUp": v += step; break;
          case "PageDown": v -= 10; break;
          case "PageUp": v += 10; break;
          case "Home": v = 0; break;
          case "End": v = total; break;
          default: return;
        }
        e.preventDefault(); set(v); commit();
      });
    }
    keys(hStart, setStart, function () { return start; });
    keys(hEnd, setEnd, function () { return end; });

    function set(s, e) {
      s = clamp(Math.round(s), 0, total - min); e = clamp(Math.round(e), s + min, Math.min(total, s + max));
      start = s; end = e; commit();
    }
    var onResize = function () { render(); };
    window.addEventListener("resize", onResize);
    render();
    // Label widths are only known once the picker is on screen and styled.
    setTimeout(render, 0);

    return {
      el: root,
      get: function () { return { start: start, end: end }; },
      set: set,
      destroy: function () { window.removeEventListener("resize", onResize); if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  /**
   * The card for a song someone pasted: cover, "Title · Artist", total length, then the range
   * picker with what is selected against the allowance, and shortcuts ("From the start", "Whole
   * song" when it fits). ``info`` is the API's link info (title, artist, thumbnailUrl,
   * durationSeconds, maxSeconds); ``opts.allowance`` is the plain line about the limit (e.g.
   * "up to 6:00 on Pro"). With no known length the picker is skipped and the card says what will
   * be transcribed. Returns { el, selection() → {startSeconds, endSeconds} or null, destroy() }.
   */
  function card(host, info, opts) {
    opts = opts || {};
    var max = Math.max(1, Math.round(info.maxSeconds || opts.max || 30));
    var total = info.durationSeconds > 0 ? Math.round(info.durationSeconds) : 0;
    var root = el("div", "link-section");
    var song = el("div", "link-song");
    if (info.thumbnailUrl) { var img = el("img", "link-cover"); img.src = info.thumbnailUrl; img.alt = ""; song.appendChild(img); }
    var meta = el("div", "link-meta");
    meta.appendChild(el("div", "link-title", (info.title || "Untitled") + (info.artist ? " · " + info.artist : "")));
    meta.appendChild(el("div", "link-length", total ? "Total length " + formatTime(total) : "Length unknown"));
    song.appendChild(meta);
    root.appendChild(song);
    host.appendChild(root);

    if (!total) {
      root.appendChild(el("p", "link-note", "We'll transcribe the first " + sayLength(max) + "."));
      return { el: root, selection: function () { return null; }, destroy: function () { if (root.parentNode) root.parentNode.removeChild(root); } };
    }

    root.appendChild(el("p", "link-pick-lead", total > max ? "Pick the part to transcribe" : "The whole song fits"));
    var pickerHost = el("div", "link-picker");
    root.appendChild(pickerHost);
    var line = el("p", "link-selected");
    line.setAttribute("aria-live", "polite");
    root.appendChild(line);
    var actions = el("div", "link-actions");
    var fromStart = el("button", "btn btn-ghost btn-sm", "From the start"); fromStart.type = "button";
    var whole = el("button", "btn btn-ghost btn-sm", "Whole song"); whole.type = "button";
    actions.appendChild(fromStart);
    if (total <= max) actions.appendChild(whole);
    root.appendChild(actions);

    function describe(s, e) {
      var picked = "Selected " + formatTime(e - s) + " of " + formatTime(total) + " (" + formatTime(s) + "–" + formatTime(e) + ")";
      line.textContent = picked + (opts.allowance ? " · " + opts.allowance : "");
      fromStart.disabled = s === 0 && (e === Math.min(total, max));
      whole.disabled = s === 0 && e === total;
    }
    var picker = create(pickerHost, { total: total, max: max, onChange: function (s, e) { describe(s, e); if (opts.onChange) opts.onChange(s, e); } });
    fromStart.addEventListener("click", function () { picker.set(0, Math.min(total, max)); });
    whole.addEventListener("click", function () { picker.set(0, total); });
    describe(0, Math.min(total, max));

    return {
      el: root,
      selection: function () { var r = picker.get(); return { startSeconds: r.start, endSeconds: r.end }; },
      destroy: function () { picker.destroy(); if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  window.NfRangePicker = { create: create, card: card, formatTime: formatTime, sayLength: sayLength };
})();
