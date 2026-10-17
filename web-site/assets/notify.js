/* "Your sheet is ready": telling someone who switched away that the transcription they started has finished.
 *
 * A job takes about a minute and people change tabs. When one finishes (or fails) while this page is hidden or
 * not focused, the web app (app.js) does three things, each on its own so one missing never stops the others:
 *   - a system notification (the Notification API), when the browser allows it and it is switched on here;
 *   - a soft two-note chime (doh, then soh; soh, then doh when it failed) on the page's own AudioContext;
 *   - "(1) Sheet ready — NoteFusion" in the tab's title and a dot on its icon, until the tab is looked at again.
 * Permission is asked only from a click: the "Notify me when it's ready" button on the progress card, or the
 * switch in Account & settings. Nothing here asks on page load. iOS Safari outside a home-screen app has no
 * Notification at all; the chime and the title still work there.
 *
 * The decisions (should it notify, which words, is it time to ask) are plain functions with node tests
 * (web-site/tests/notify.test.mjs); the rest touches the browser. Plain script, no build step. Exposes
 * window.NfNotify.
 */
(function () {
  "use strict";

  var NOTIFY_KEY = "nf.web.notify";      // "on" | "off" | absent (never answered)
  var SOUND_KEY = "nf.web.notifySound";  // "off" mutes the chime; anything else plays it
  var ICON = "/assets/icon-192.png";

  function read(store, key) { try { return store ? store.getItem(key) : null; } catch (e) { return null; } }
  function write(store, key, value) { try { if (store) store.setItem(key, value); } catch (e) { /* private mode */ } }

  /** What the browser says: "granted", "denied", "default" (not asked yet), or "unsupported". */
  function permission(win) {
    var N = win && win.Notification;
    if (!N || typeof N.requestPermission !== "function") return "unsupported";
    return N.permission === "granted" || N.permission === "denied" ? N.permission : "default";
  }

  /** The remembered answers: notify "on", "off" or null (never answered); sound on unless switched off. */
  function prefs(store) {
    var n = read(store, NOTIFY_KEY);
    return { notify: n === "on" || n === "off" ? n : null, sound: read(store, SOUND_KEY) !== "off" };
  }
  function setNotify(store, on) { write(store, NOTIFY_KEY, on ? "on" : "off"); }
  function setSound(store, on) { write(store, SOUND_KEY, on ? "on" : "off"); }

  /** Notifications are on: the browser allows them and nobody said no here. Allowed earlier and never answered counts as on. */
  function notifyOn(perm, pref) { return perm === "granted" && pref !== "off"; }
  /** Time to offer "Notify me when it's ready": the browser can still ask, and nobody said no here. */
  function shouldAsk(perm, pref) { return perm === "default" && pref !== "off"; }

  /** The person is somewhere else: the tab is hidden, or the window is not the one in front. */
  function isAway(doc) {
    if (!doc) return false;
    if (doc.visibilityState === "hidden" || doc.hidden === true) return true;
    try { return typeof doc.hasFocus === "function" && !doc.hasFocus(); } catch (e) { return false; }
  }

  /**
   * What to do when a job settles. Nothing while the person is looking (the page shows it and plays its own
   * cue); when away, the chime unless muted, the title cue always, and the notification when it is on.
   */
  function plan(o) {
    var away = !!(o && o.away);
    return {
      notify: away && notifyOn(o.permission, o.notifyPref),
      chime: away && o.sound !== false,
      cue: away
    };
  }

  /** The name to show: the song's title from a link, else an uploaded file's name without its extension; a take has none. */
  function nameOf(source, fileName) {
    var t = source && source.title ? String(source.title).trim() : "";
    if (t) return t;
    var f = fileName ? String(fileName).replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() : "";
    return f || null;
  }

  /** The notification's words. `error` is the app's own plain sentence for a failed job. */
  function message(outcome, name, error) {
    var quoted = name ? "“" + name + "”" : "";
    if (outcome === "failed") {
      return { title: "Transcription didn't finish", body: (quoted ? quoted + ": " : "") + (error || "That could not be transcribed.") };
    }
    return { title: "Your sheet is ready", body: quoted ? quoted + " is written out. Open it in NoteFusion." : "Open it in NoteFusion." };
  }

  function tabTitle(outcome) { return "(1) " + (outcome === "failed" ? "Transcription didn't finish" : "Sheet ready") + " — NoteFusion"; }
  /** One notification per job: a second for the same job replaces the first instead of stacking. */
  function tag(jobId) { return "nf-job-" + jobId; }

  // ── The browser side ─────────────────────────────────────────────────────

  /** Doh then soh (soh then doh when it failed), soft and under a second, on an AudioContext a click already unlocked. */
  function chime(ctx, outcome) {
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      var t = ctx.currentTime + 0.02;
      var notes = outcome === "failed" ? [783.99, 523.25] : [523.25, 783.99];
      notes.forEach(function (freq, i) {
        var at = t + i * 0.22, o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(freq, at);
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.07, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        o.connect(g); g.connect(ctx.destination); o.start(at); o.stop(at + 0.55);
      });
      return true;
    } catch (e) { return false; }
  }

  /** Asks the browser, from the click that called it. Resolves to "granted", "denied" or "default". */
  function request(win) {
    if (permission(win) === "unsupported") return Promise.resolve("unsupported");
    try {
      var answered = null;
      // Older Safari takes a callback and returns nothing.
      var p = win.Notification.requestPermission(function (r) { answered = r; });
      return Promise.resolve(p).then(function (r) { return r || answered || permission(win); });
    } catch (e) { return Promise.resolve(permission(win)); }
  }

  /** Shows the notification; a click brings this tab forward, runs onOpen and closes it. Null when the browser refuses. */
  function show(win, opts) {
    try {
      var n = new win.Notification(opts.title, { body: opts.body, icon: ICON, tag: opts.tag });
      n.onclick = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        try { win.focus(); } catch (x) { /* some browsers ignore it */ }
        try { if (opts.onOpen) opts.onOpen(); } finally { n.close(); }
      };
      return n;
    } catch (e) { return null; } // Chrome on Android only shows them from a service worker
  }

  var held = null, badgeSeq = 0;
  function iconLinks(doc) { return Array.prototype.slice.call(doc.querySelectorAll('link[rel~="icon"]')); }
  /** The tab's icon with a dot in its corner: green when the sheet is ready, red when it failed. */
  function badge(doc, outcome) {
    var seq = ++badgeSeq, img = new Image();
    img.onload = function () {
      if (seq !== badgeSeq || !held) return;
      try {
        var c = doc.createElement("canvas"); c.width = c.height = 64;
        var g = c.getContext("2d");
        g.drawImage(img, 0, 0, 64, 64);
        g.beginPath(); g.arc(48, 16, 15, 0, 2 * Math.PI); g.fillStyle = "#ffffff"; g.fill();
        g.beginPath(); g.arc(48, 16, 11, 0, 2 * Math.PI); g.fillStyle = outcome === "failed" ? "#dc2626" : "#16a34a"; g.fill();
        var url = c.toDataURL("image/png");
        held.icons.forEach(function (pair) { pair[0].setAttribute("href", url); });
      } catch (e) { /* the title still says it */ }
    };
    img.src = ICON;
  }
  /** The title and icon say it until clearCue(); a second cue keeps the first's originals. */
  function cue(doc, outcome) {
    if (!held) held = { title: doc.title, icons: iconLinks(doc).map(function (l) { return [l, l.getAttribute("href")]; }), note: null };
    doc.title = tabTitle(outcome);
    badge(doc, outcome);
  }
  /** Back to the page's own title and icon; a notification still on screen is closed (the tab is in front now). */
  function clearCue(doc) {
    badgeSeq++;
    if (!held) return;
    doc.title = held.title;
    held.icons.forEach(function (pair) { pair[0].setAttribute("href", pair[1]); });
    if (held.note) { try { held.note.close(); } catch (e) { /* gone already */ } }
    held = null;
  }
  /** The notification belongs to the cue: looking at the tab closes it. */
  function holdNote(n) { if (held && n) held.note = n; }
  function cued() { return !!held; }

  window.NfNotify = {
    permission: permission, prefs: prefs, setNotify: setNotify, setSound: setSound,
    notifyOn: notifyOn, shouldAsk: shouldAsk, isAway: isAway, plan: plan,
    nameOf: nameOf, message: message, tabTitle: tabTitle, tag: tag,
    chime: chime, request: request, show: show, cue: cue, clearCue: clearCue, holdNote: holdNote, cued: cued
  };
})();
