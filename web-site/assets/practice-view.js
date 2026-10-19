/* Practice on the web: the daily habit, as the phone's Practice screen has it (mobile/src/screens/PracticeScreen.tsx).
 *
 * The practice path's next free solfa drill (hear it, a count-in, sing it, marked note by note, then "Next drill" —
 * grades, units and milestones on the way), the streak, XP toward the next sol-fa level, the weekly goal, the last
 * seven days and the badges. Every number is the server's
 * (GET /api/practice/progress), read off the takes it has marked; the browser never reports a score. A marked
 * take comes back with what it earned, celebrated with one short line — without motion when the reader asks
 * for reduced motion.
 *
 * Two tracks, chosen by style (never by age) on the first visit and changeable any time (practice-track.js):
 * Playful — stars and a friendly word instead of the number, a practice buddy, stickers, a confetti burst; and
 * Focused — the exact score and cents, the take's overall tuning, "Replay my take", and less fuss. The server picks
 * each track's drills (ids are opaque, e.g. "…~gentle"); XP, levels, streaks and badges are the same on both.
 *
 * Under the path, "More ways to practise" (boards c-practice/6a–6d): the modes the server says are live, each opening
 * its own screen in the view's place (assets/practice-mode-view.js, with the live pitch meter assets/pitch-track.js and
 * practice-modes.css, loaded the first time a mode is opened through `loadAsset`); the stat cards, the week and the
 * badges sit below as "Your progress", the streak and level one line at the top.
 *
 * While a season is on for the singer (the progress carries `season`): one card under today's drill opening the season's
 * path (assets/practice-carols.js and .css, loaded on its first open), and Doh in the season's costume — at Christmas
 * the pine "Carols for Christmas" card and the cap (board d-christmas/03), at Halloween the pumpkin "The Midnight path"
 * card, the witch hat and Boo beside Doh (board j-halloween/03). Off, none of it is drawn or downloaded.
 *
 * Loaded by app.js the first time the view is opened (never on the app's first load), with
 * practice-progress.js, practice-track.js and practice-modes.js (the arithmetic and wording) and practice-view.css.
 * app.js hands over its API client, analytics, the rehearsal piano (assets/choir.js) and its asset loader:
 *
 *   NfPracticeView.open(rootEl, { request, track, choir, onProgress, loadAsset, show })   — show it (loads fresh numbers;
 *                                                                        show: "season" opens on the season's path)
 *   NfPracticeView.leave()                                               — another view: stop sound and mic
 *   NfPracticeView.reset()                                               — signed out: forget everything
 */
(function () {
  "use strict";

  var TOAST_MS = 3200;
  /** The count-in waits this long at most for the piano's first load before counting in on clicks alone. */
  var PIANO_WAIT_MS = 8000;
  /**
   * The Practice art (Doh the doh bird, level emblems, badge stickers, the flame, stars, confetti, the track scenes,
   * the empty states): one small SVG file each in /assets/practice-art/, drawn by design/practice-art/build.mjs.
   * Fetched as <img> only when this view draws them, so none of it is in the app's first load.
   */
  var ART_DIR = "/assets/practice-art/", ART_V = "?v=1";
  var LEVELS = 8;

  var ctx = null, root = null;
  // gen moves on when the view is reset (signed out), so a reply still on its way renders nothing.
  var s = {
    gen: 0, progress: null, drill: null, next: null, loading: false, loadError: null, offline: false, phase: "idle", grade: null, error: null,
    picking: false, savingTrack: null, trackError: null, takeUrl: null, mode: null
  };
  var take = null;   // the take being recorded: { stream, recorder, audio, timer, stopAt, t0, lead, cancelled }
  var hear = null;   // the player "Hear it" uses, made on the first press
  var replayAudio = null; // Focused's "Replay my take"
  var toastEl = null, toastTimer = null;

  function PP() { return window.NfPracticeProgress; }
  function PT() { return window.NfPracticeTrack; }
  function currentTrack() { return (s.progress && s.progress.track) || null; }
  function showPicker() { return !!s.progress && (currentTrack() == null || s.picking); }
  function reducedMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  // ── Small DOM helpers ───────────────────────────────────────────────────
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(href, extra) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ic" + (extra ? " " + extra : "")); svg.setAttribute("aria-hidden", "true");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", href); svg.appendChild(use);
    return svg;
  }
  /** One picture of the Practice art, decorative (the words beside it say what it shows). */
  function art(name, width, height, cls) {
    var img = document.createElement("img");
    img.src = ART_DIR + name + ".svg" + ART_V;
    img.alt = ""; img.decoding = "async"; img.draggable = false;
    img.width = width; img.height = height || width;
    img.className = "pv-art" + (cls ? " " + cls : "");
    return img;
  }
  /**
   * Doh in the season's costume while a season is on (in Practice only: boards d-christmas/03, j-halloween/03) — the
   * Christmas cap, the Halloween witch hat — else the picture as it is. The costume (practice-art/season-cap.svg,
   * season-hat.svg) is laid over him on his 200 × 200 box, tipped back so the crest shows.
   */
  function seasonName() {
    if (s.progress && s.progress.season) return PP().seasonOf(s.progress.season.season);
    return (window.NfSeason && window.NfSeason.season) || null;
  }
  function dohArt(name, width, cls) {
    var pic = art(name, width, width, cls), S = window.NfSeason, season = seasonName();
    if (!season || name.indexOf("doh-") !== 0 || name === "doh-avatar" || !S || !S.costumeOf) return pic;
    var costume = S.costumeOf(season);
    var box = el("span", "pv-capped" + (cls ? " " + cls : ""));
    box.style.width = width + "px"; box.style.height = width + "px";
    pic.className = "pv-art";
    box.appendChild(pic);
    var NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg"), g = document.createElementNS(NS, "g"), img = document.createElementNS(NS, "image");
    svg.setAttribute("viewBox", "0 0 200 200"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "pv-cap");
    g.setAttribute("transform", S.costumeOnDoh(costume, name));
    img.setAttribute("href", S.COSTUME_ART[costume]);
    img.setAttribute("x", "-100"); img.setAttribute("y", "-125"); img.setAttribute("width", "200"); img.setAttribute("height", "150");
    g.appendChild(img); svg.appendChild(g); box.appendChild(svg);
    return box;
  }
  function button(cls, href, text, onClick) {
    var b = el("button", "btn " + cls); b.type = "button";
    if (href) b.appendChild(icon(href));
    b.appendChild(document.createTextNode(text));
    b.addEventListener("click", onClick);
    return b;
  }
  function bar(fraction, label) {
    var track = el("div", "pv-bar"), fill = el("i");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
    if (label) track.setAttribute("aria-label", label);
    fill.style.width = Math.round(fraction * 100) + "%";
    track.appendChild(fill);
    return track;
  }
  function track(name, detail) { try { if (ctx && ctx.track) ctx.track(name, detail); } catch (e) { /* never in the way */ } }

  // ── Loading ─────────────────────────────────────────────────────────────
  function load() {
    var gen = s.gen;
    s.loading = true;
    if (!s.progress) render();
    return Promise.all([ctx.request("/api/practice/progress"), ctx.request("/api/practice/drills/next")]).then(function (pair) {
      if (gen !== s.gen) return;
      s.progress = pair[0]; s.drill = pair[1]; s.next = null; s.loadError = null; s.offline = false;
      if (ctx.onProgress) ctx.onProgress(s.progress);
    }, function (err) {
      if (gen !== s.gen) return;
      s.loadError = (err && err.message) || "We couldn't load your practice. Please try again.";
      s.offline = !!err && err.status === 0;
    }).then(function () {
      if (gen !== s.gen) return;
      s.loading = false;
      if (s.phase === "idle") render();
    });
  }

  /** After a marked take: the fresh numbers (streak, XP, badges, today's allowance) in the cards and the home chip. */
  function refreshProgress() {
    var gen = s.gen;
    return ctx.request("/api/practice/progress").then(function (p) {
      if (gen !== s.gen || !p) return;
      s.progress = p;
      if (s.drill) s.drill.allowance = p.drills;
      if (ctx.onProgress) ctx.onProgress(p);
      if (s.phase === "idle") render();
    }, function () { /* the cards keep what they showed; the next open corrects them */ });
  }

  // ── More ways to practise (boards c-practice/6a–6d) ────────────────────
  /**
   * The modes' screens and the live pitch meter: loaded the first time a mode is opened, never with the view.
   * practice-modes.js (the words and arithmetic) comes with the view, for the hub's list.
   */
  var MODE_ASSETS = ["/assets/practice-modes.css?v=1", "/assets/pitch-track.js?v=1", "/assets/practice-mode-view.js?v=2"];
  /** The modes' icons, drawn inline (24 × 24, stroked): the app's sprite has none of these. */
  var MODE_ICONS = {
    "warm-up": '<circle cx="12" cy="4.6" r="1.9"/><path d="M4.5 9l7.5 1.6L19.5 9M12 10.6V15m0 0l-3.6 6M12 15l3.6 6"/>',
    "pitch-match": '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 17l4.2-5.2"/><circle cx="12" cy="17" r="1.3"/>',
    runs: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    intervals: '<path d="M7 20V4M3.5 7.5L7 4l3.5 3.5M17 4v16M13.5 16.5L17 20l3.5-3.5"/>',
    harmony: '<path d="M12 3.5l8.5 4.6L12 12.7 3.5 8.1z"/><path d="M3.5 12.4l8.5 4.6 8.5-4.6M3.5 16.4l8.5 4.6 8.5-4.6"/>',
    rhythm: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.6 6.5-6 6.5-2.4 0-3.9-1.2-5.3-3.2l-2.4-3.3a1.5 1.5 0 0 1 2.4-1.8L8 14"/>',
    headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.2" height="6.5" rx="1.6"/><rect x="16.8" y="14" width="4.2" height="6.5" rx="1.6"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.3 14.3c1 1.3 2.3 2 3.7 2s2.7-.7 3.7-2"/><path d="M9 9.6v.6M15 9.6v.6"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15.5 5.2a3.2 3.2 0 0 1 0 5.6M18 14.6c1.8.9 3 2.9 3 5.4"/>'
  };
  function modeIcon(name, cls) {
    var span = el("span", "pv-mic-ic" + (cls ? " " + cls : ""));
    span.setAttribute("aria-hidden", "true");
    span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (MODE_ICONS[name] || "") + "</svg>";
    return span;
  }

  /** The streak and the level in one line at the top (board 6a); the full cards are under "Your progress". */
  function progressLine(p) {
    var strip = window.NfPracticeModes.progressStrip(p), line = el("div", "pv-progline");
    line.setAttribute("role", "group"); line.setAttribute("aria-label", strip.label);
    line.appendChild(art(PT().flameArt(p.streak), 20));
    var streak = el("strong", null, strip.streak); streak.setAttribute("aria-hidden", "true");
    line.appendChild(streak);
    line.appendChild(el("i", "pv-progline-sep"));
    var lv = el("span", "pv-progline-level"); lv.setAttribute("aria-hidden", "true");
    lv.appendChild(el("strong", null, strip.level)); lv.appendChild(document.createTextNode(" · " + strip.xp));
    line.appendChild(lv);
    var bar0 = el("span", "pv-minibar"), fill = el("i"); fill.style.width = Math.round(strip.fraction * 100) + "%";
    bar0.appendChild(fill); bar0.setAttribute("aria-hidden", "true"); line.appendChild(bar0);
    if (strip.toNext) { var nx = el("span", "pv-progline-next", strip.toNext); nx.setAttribute("aria-hidden", "true"); line.appendChild(nx); }
    return line;
  }

  /**
   * "More ways to practise" (Playful: "More ways to play"): one quiet list of the modes the server says are live, in
   * its order. Focused gets one small Doh beside the heading; Playful's Doh is the buddy at the top.
   */
  function modesSection(p, tr, dohElsewhere) {
    var M = window.NfPracticeModes, rows = M.hubModes(p.modes, tr, true);
    if (!rows.length) return null;
    var sec = el("section", "pv-modes" + (tr === "playful" ? " is-playful" : ""));
    sec.setAttribute("aria-labelledby", "pv-modes-title");
    var head = el("div", "pv-modes-head"), text = el("div", "pv-modes-text");
    var h = el("h2", "pv-section", M.modesHeading(tr)); h.id = "pv-modes-title";
    text.appendChild(h);
    // One Doh on screen: while the season's card shows his, the modes' steps aside.
    var line = dohElsewhere ? null : M.modesDohLine(rows, tr);
    if (line) text.appendChild(el("p", "pv-modes-doh", "“" + line + "”"));
    head.appendChild(text);
    if (line) head.appendChild(dohArt("doh-wave", 56, "pv-modes-bird"));
    sec.appendChild(head);
    var list = el("ul", "pv-mode-list");
    rows.forEach(function (r) {
      var li = el("li"), b = el("button", "pv-mode-row"); b.type = "button";
      b.setAttribute("data-mode", r.id);
      b.appendChild(modeIcon(r.id, "pv-mode-tile"));
      var t = el("span", "pv-mode-text");
      t.appendChild(el("strong", null, r.title));
      t.appendChild(el("span", null, r.subtitle));
      b.appendChild(t);
      if (r.value) b.appendChild(el("span", "pv-mode-value", r.value));
      b.appendChild(icon("/assets/icons.svg#i-chev", "pv-mode-chev"));
      b.addEventListener("click", function () { openMode(r.id); });
      li.appendChild(b); list.appendChild(li);
    });
    sec.appendChild(list);
    return sec;
  }

  /** A mode's screen is a pushed screen: the view's own heading steps aside while it is open. */
  function inMode(on) { if (root && root.parentNode) root.parentNode.classList.toggle("pv-in-mode", on); }

  /** Opens a mode's screen in the view's place (its script loads the first time); back returns to the hub. */
  function openMode(id) {
    if (s.phase !== "idle" || s.mode) return;
    stopHear(); stopReplay(); hideToast();
    var gen = s.gen;
    s.mode = id; inMode(true);
    track("practice_mode_opened", "mode=" + id);
    root.innerHTML = "";
    var sk = el("div", "pv-skel");
    for (var i = 0; i < 3; i++) sk.appendChild(el("div", "skel"));
    root.appendChild(sk);
    window.scrollTo({ top: 0 });
    Promise.all(MODE_ASSETS.map(ctx.loadAsset)).then(function () {
      if (gen !== s.gen || s.mode !== id || !root) return;
      window.NfPracticeModeView.open(root, {
        request: ctx.request, track: ctx.track, choir: ctx.choir, mode: id, practiceTrack: currentTrack(),
        icon: modeIcon, art: art, back: closeMode
      });
    }, function () {
      if (gen !== s.gen || s.mode !== id) return;
      s.mode = null; inMode(false); s.error = "That didn't load. Check your connection and try again."; render();
    });
  }
  function closeMode() {
    if (!s.mode) return;
    if (s.mode === "season") { if (window.NfPracticeCarols) window.NfPracticeCarols.leave(); }
    else if (window.NfPracticeModeView) window.NfPracticeModeView.leave();
    s.mode = null; inMode(false);
    render();
    window.scrollTo({ top: 0 });
    refreshProgress(); // a marked take moved the XP, the streak and today's allowance
  }

  // ── The season's path (boards d-christmas/03, j-halloween/03), only while its season is on for the singer ─────
  /** The path's screen (either season's): its script and styles load the first time it is opened, never with the view. */
  var SEASON_ASSETS = ["/assets/practice-modes.css?v=1", "/assets/practice-carols.css?v=2", "/assets/practice-carols.js?v=3"];
  // Three tiny still bats in the Midnight path card's corner: [left, top, width, degrees] (the phone's CARD_BATS).
  var CARD_BATS = [[4, 10, 14, -10], [58, 0, 11, 8], [80, 30, 9, -4]];
  var BAT_PATH = "M20 8L18.4 4.8L17.4 8.6C14.5 4.4 8.5 3.2 1.5 7.2C4.6 8.2 5.8 10.8 5.6 13.8C7.6 12 9.8 12 11 14C12.6 12 14.8 12.1 15.8 15C17 13.2 18.6 13.4 20 15.6C21.4 13.4 23 13.2 24.2 15C25.2 12.1 27.4 12 29 14C30.2 12 32.4 12 34.4 13.8C34.2 10.8 35.4 8.2 38.5 7.2C31.5 3.2 25.5 4.4 22.6 8.6L21.6 4.8Z";

  /**
   * The season's card under today's drill — the carols' pine one, the Midnight path's pumpkin one: until when, six
   * segments, how many sung and what is next, and the way in. With `withDoh`, Doh in the season's costume (at
   * Halloween with Boo at his shoulder); the Midnight path's corner holds three tiny still bats.
   */
  function seasonPathCard(season, withDoh) {
    var c = PP().seasonCard(season), halloween = c.season === "halloween";
    var card = el("section", "pv-carols" + (halloween ? " is-halloween" : ""));
    card.setAttribute("aria-labelledby", "pv-carols-title");
    if (halloween) {
      var sky = el("span", "pv-card-bats"); sky.setAttribute("aria-hidden", "true");
      sky.innerHTML = CARD_BATS.map(function (b) {
        return '<svg viewBox="0 0 40 20" style="left:' + b[0] + "px;top:" + b[1] + "px;width:" + b[2] + "px;height:" + b[2] / 2 + "px;transform:rotate(" + b[3] + 'deg)"><path fill="currentColor" d="' + BAT_PATH + '"/></svg>';
      }).join("");
      card.appendChild(sky);
    }
    var top = el("div", "pv-carols-top"), text = el("div", "pv-carols-text");
    text.appendChild(el("p", "pv-carols-eyebrow", c.eyebrow));
    var h = el("h2", "pv-carols-title", c.title); h.id = "pv-carols-title";
    text.appendChild(h);
    text.appendChild(el("p", "pv-carols-body", c.body));
    top.appendChild(text);
    if (withDoh && halloween) {
      // Boo, Halloween's friendly ghost, floats beside Doh (never alone: board j-halloween/03).
      var pair = el("span", "pv-card-pair");
      pair.appendChild(dohArt("doh-wave", 72, "pv-carols-doh"));
      pair.appendChild(art("boo", 34, 34, "pv-card-boo"));
      top.appendChild(pair);
    } else if (withDoh) top.appendChild(dohArt("doh-wave", 88, "pv-carols-doh"));
    card.appendChild(top);
    var segs = el("div", "pv-carols-bar");
    segs.setAttribute("role", "progressbar"); segs.setAttribute("aria-label", c.label);
    segs.setAttribute("aria-valuemin", "0"); segs.setAttribute("aria-valuemax", String(season.total)); segs.setAttribute("aria-valuenow", String(season.sung));
    c.segments.forEach(function (on) { segs.appendChild(el("i", on ? "on" : null)); });
    card.appendChild(segs);
    var foot = el("div", "pv-carols-foot"), ft = el("div", "pv-carols-text");
    ft.appendChild(el("strong", null, c.sung));
    ft.appendChild(el("span", null, c.next));
    foot.appendChild(ft);
    var go = el("button", "btn btn-ghost pv-carols-go"); go.type = "button"; go.id = "pv-carols-go";
    go.appendChild(document.createTextNode(c.action));
    go.appendChild(icon("/assets/icons.svg#i-arrow-right"));
    go.addEventListener("click", openSeasonPath);
    foot.appendChild(go);
    card.appendChild(foot);
    return card;
  }

  /** Opens the season's path in the view's place, as a mode's screen opens; back returns to the hub. */
  function openSeasonPath() {
    if (s.phase !== "idle" || s.mode || !s.progress || !s.progress.season) return;
    stopHear(); stopReplay(); hideToast();
    var gen = s.gen, season = PP().seasonOf(s.progress.season.season);
    s.mode = "season"; inMode(true);
    track(PP().seasonWords(season).opened, "sung=" + s.progress.season.sung);
    root.innerHTML = "";
    var sk = el("div", "pv-skel");
    for (var i = 0; i < 3; i++) sk.appendChild(el("div", "skel"));
    root.appendChild(sk);
    window.scrollTo({ top: 0 });
    Promise.all(SEASON_ASSETS.map(ctx.loadAsset)).then(function () {
      if (gen !== s.gen || s.mode !== "season" || !root) return;
      window.NfPracticeCarols.open(root, {
        season: season, request: ctx.request, track: ctx.track, choir: ctx.choir, practiceTrack: currentTrack(),
        art: art, dohArt: dohArt, icon: icon, modeIcon: modeIcon, starGrade: starGrade, gradeMarks: gradeMarks,
        toast: toast, burst: burst, back: closeMode
      });
    }, function () {
      if (gen !== s.gen || s.mode !== "season") return;
      s.mode = null; inMode(false); s.error = "That didn't load. Check your connection and try again."; render();
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function render() {
    if (!root || s.mode) return; // a mode's screen has the view
    root.innerHTML = "";
    root.setAttribute("aria-busy", String(!!(s.loading && !s.progress)));
    if (!s.progress) {
      if (s.loadError && s.offline) {
        root.appendChild(emptyState("empty-offline", "You're offline", "Practice needs a connection to mark your singing. Check it, then try again.", function () { s.loadError = null; load(); }));
      } else if (s.loadError) {
        var failed = el("div", "card pv-failed");
        failed.appendChild(el("p", null, s.loadError));
        failed.appendChild(button("btn-ghost", "/assets/icons.svg#i-restart", "Try again", function () { s.loadError = null; load(); }));
        root.appendChild(failed);
      } else {
        var sk = el("div", "pv-skel");
        for (var i = 0; i < 3; i++) sk.appendChild(el("div", "skel"));
        root.appendChild(sk);
      }
      return;
    }
    var p = s.progress, P = PP(), T = PT(), tr = currentTrack(), playful = tr === "playful", focused = tr === "focused";
    var box = el("div", "pv" + (playful ? " is-playful" : focused ? " is-focused" : ""));
    // The track pill: the style chosen, a tap to change it — never while a take is on its way.
    if (tr && !showPicker() && s.phase === "idle") {
      var bar0 = el("div", "pv-top");
      var pill = el("button", "pv-track-pill" + (playful ? " is-playful" : ""));
      pill.type = "button"; pill.id = "pv-track-pill";
      pill.setAttribute("aria-label", "Practice style: " + T.trackTitle(tr) + ". Change it");
      // One Doh on screen: Playful's is the buddy below, so the pill takes an icon.
      pill.appendChild(playful ? modeIcon("smile", "pv-pill-ic") : art(T.levelArt(p.level.index), 24));
      pill.appendChild(el("span", null, T.trackTitle(tr)));
      pill.appendChild(icon("/assets/icons.svg#i-swap", "pv-swap"));
      pill.addEventListener("click", function () { s.trackError = null; s.picking = true; stopHear(); render(); });
      bar0.appendChild(pill);
      box.appendChild(bar0);
    }
    box.appendChild(progressLine(p));
    // The season's path, while its season is on for the singer: one card under today's drill. Doh wears the season's
    // costume and there is still one Doh on screen. Christmas: on Focused the card's, on Playful the buddy's. Halloween:
    // on Playful the card's, with Boo beside him, so the buddy steps aside; Focused's card has neither.
    var pathSeason = p.season ? P.seasonOf(p.season.season) : null;
    var cardDoh = !!p.season && !showPicker() && (pathSeason === "halloween" ? playful : !playful);
    if (playful && !showPicker() && s.drill) {
      if (!(cardDoh && pathSeason === "halloween")) box.appendChild(buddy(p, T));
      warmConfetti();
    }
    if (showPicker()) box.appendChild(trackPicker(tr, T));
    if (s.drill && !showPicker()) box.appendChild(drillCard(s.drill, P));
    if (!s.drill && !showPicker()) box.appendChild(emptyState("empty-no-drill", "No drill yet", "Today's drill isn't here yet. Try again in a moment.", function () { load(); }));
    if (p.season && !showPicker()) box.appendChild(seasonPathCard(p.season, cardDoh));
    var modes = showPicker() ? null : modesSection(p, tr, cardDoh);
    if (modes) box.appendChild(modes);
    // Your progress: the two stat cards, the week and the badges, under the ways to practise (board 6a).
    box.appendChild(el("h2", "pv-section", "Your progress"));
    box.appendChild(statsCards(p, P));
    box.appendChild(weekCard(p, P));
    box.appendChild(el("h2", "pv-section", playful ? "My stickers" : "Badges"));
    box.appendChild(playful ? stickers(p, P, T) : focused ? badgeList(p, P) : badgeGrid(p, P));
    box.appendChild(el("p", "pv-note", playful
      ? "Every singing game earns XP and stars. Up to " + p.dailyXpCap + " XP a day."
      : "Practice counts when a take is marked: the daily drill, Sing it, or Learn my part. Up to " + p.dailyXpCap + " XP a day."));
    root.appendChild(box);
  }

  /** "How do you like to practise?": asked on the first visit, and again from the pill. A style, never an age. */
  function trackPicker(current, T) {
    var card = el("section", "card pv-picker");
    card.setAttribute("aria-labelledby", "pv-picker-q");
    var head = el("div", "pv-picker-head");
    head.appendChild(art(T.mascotArt("handoff"), 64));
    var headText = el("div");
    var q = el("h2", "pv-title", T.TRACK_QUESTION); q.id = "pv-picker-q";
    headText.appendChild(q);
    headText.appendChild(el("p", "pv-meta", "Your XP, streak and badges stay the same whichever you pick. Change it any time."));
    head.appendChild(headText);
    card.appendChild(head);
    var group = el("div", "pv-options"); group.setAttribute("role", "radiogroup"); group.setAttribute("aria-labelledby", "pv-picker-q");
    T.TRACK_OPTIONS.forEach(function (o) {
      var on = current === o.track, saving = s.savingTrack === o.track;
      var b = el("button", "pv-option is-" + o.track + (on ? " on" : ""));
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(on));
      b.setAttribute("data-track", o.track);
      if (s.savingTrack) { b.disabled = true; if (saving) b.setAttribute("aria-busy", "true"); }
      b.appendChild(art(T.trackArt(o.track), 320, 200, "pv-option-art"));
      var row = el("span", "pv-option-row");
      var text = el("span", "pv-option-text");
      text.appendChild(el("strong", null, o.title));
      text.appendChild(el("span", null, o.blurb));
      row.appendChild(text);
      if (saving) row.appendChild(el("span", "pv-spin"));
      else row.appendChild(icon(on ? "/assets/icons.svg#i-check" : "/assets/icons.svg#i-chev", "pv-option-end"));
      b.appendChild(row);
      b.addEventListener("click", function () { chooseTrack(o.track); });
      group.appendChild(b);
    });
    card.appendChild(group);
    if (s.trackError) { var err = el("p", "pv-error", s.trackError); err.setAttribute("role", "alert"); card.appendChild(err); }
    if (current) {
      var keep = el("button", "pv-keep", "Keep it as it is"); keep.type = "button";
      keep.setAttribute("aria-label", "Keep my practice style");
      keep.addEventListener("click", function () { s.picking = false; s.trackError = null; render(); });
      card.appendChild(keep);
    }
    return card;
  }

  /** "No drill yet" and "You're offline": Doh's picture, a line, and a way to try again. */
  function emptyState(picture, title, body, retry) {
    var card = el("section", "card pv-empty");
    card.appendChild(art(picture, 200, 154));
    card.appendChild(el("h2", "pv-title", title));
    card.appendChild(el("p", "pv-meta", body));
    card.appendChild(button("btn-ghost", "/assets/icons.svg#i-restart", "Try again", retry));
    return card;
  }

  /** Saves the track, then loads the drill it offers today (each track has its own drill of the day). */
  function chooseTrack(next) {
    if (s.phase !== "idle" || s.savingTrack) return;
    var gen = s.gen;
    s.savingTrack = next; s.trackError = null; render();
    ctx.request("/api/practice/track", { method: "PUT", body: { track: next } }).then(function (p) {
      return ctx.request("/api/practice/drills/next").then(function (d) { return [p, d]; });
    }).then(function (pair) {
      if (gen !== s.gen) return;
      s.progress = pair[0]; s.drill = pair[1]; s.next = null; s.grade = null; s.error = null; s.picking = false;
      dropTakeUrl(); hideToast();
      if (ctx.onProgress) ctx.onProgress(s.progress);
      track("practice_track_chosen", "track=" + next);
    }, function (err) {
      if (gen !== s.gen) return;
      s.trackError = (err && err.message) || "We couldn't save that. Please try again.";
    }).then(function () {
      if (gen !== s.gen) return;
      s.savingTrack = null; render();
    });
  }

  /** Playful's practice buddy: Doh the doh bird, in the mood of the moment, and a speech bubble. */
  function buddy(p, T) {
    var allowance = (s.progress && s.progress.drills) || (s.drill && s.drill.allowance);
    var scene = { picking: showPicker(), recording: s.phase !== "idle", grade: s.grade, hasDrill: !!s.drill, drillsLeft: allowance ? PP().drillsLeft(allowance) : null };
    var mood = T.mascotMood(p, scene), line = T.mascotLine(mood, p, scene), box = el("div", "pv-buddy");
    box.setAttribute("role", "note"); box.setAttribute("aria-label", "Doh, your practice buddy, says: " + line);
    box.appendChild(dohArt(T.mascotArt(mood), 68, "pv-buddy-doh"));
    var bubble = el("p", "pv-buddy-bubble", line); bubble.setAttribute("aria-hidden", "true");
    box.appendChild(bubble);
    return box;
  }

  function statsCards(p, P) {
    var T = PT(), row = el("div", "pv-stats");
    var streak = el("section", "card pv-stat pv-streak" + (p.streak.current > 0 ? " is-on" : ""));
    streak.setAttribute("aria-label", P.streakLabel(p.streak.current));
    var head = el("div", "pv-stat-head");
    head.appendChild(art(T.flameArt(p.streak), 32));
    head.appendChild(el("strong", "pv-big", String(p.streak.current)));
    streak.appendChild(head);
    streak.appendChild(el("span", "pv-label", "day streak"));
    streak.appendChild(el("span", "pv-sub", P.streakLine(p.streak)));
    var freeze = el("span", "pv-foot");
    freeze.appendChild(art("freeze", 16, 16, p.streak.freezeAvailable ? "" : "is-spent"));
    freeze.appendChild(document.createTextNode(P.freezeLine(p.streak)));
    streak.appendChild(freeze);
    row.appendChild(streak);

    var level = el("section", "card pv-stat pv-level");
    level.setAttribute("aria-label", "Level " + p.level.name);
    var lhead = el("div", "pv-level-head"), ltext = el("div", "pv-level-text");
    lhead.appendChild(art(T.levelArt(p.level.index), 44));
    ltext.appendChild(el("strong", "pv-level-name" + (p.level.name.length > 6 ? " is-long" : ""), p.level.name));
    ltext.appendChild(el("span", "pv-label", "level " + (p.level.index + 1) + " of " + LEVELS));
    lhead.appendChild(ltext);
    level.appendChild(lhead);
    var brow = el("div", "pv-bar-row");
    brow.appendChild(bar(P.levelFraction(p.level, p.xp), p.xp + " XP. " + P.nextLevelLine(p.level)));
    if (p.level.nextName) brow.appendChild(art(T.levelArt(p.level.index + 1), 22));
    level.appendChild(brow);
    level.appendChild(el("span", "pv-sub", p.xp + " XP"));
    level.appendChild(el("span", "pv-foot", P.nextLevelLine(p.level)));
    row.appendChild(level);
    return row;
  }

  function drillCard(d, P) {
    var tr = currentTrack(), playful = tr === "playful", focused = tr === "focused";
    var card = el("section", "card pv-drill");
    card.setAttribute("aria-labelledby", "pv-drill-title");
    card.appendChild(el("p", "pv-eyebrow", playful ? "Your singing game" : "Practice path · " + d.levelName));
    var h = el("h2", "pv-title", d.title); h.id = "pv-drill-title";
    card.appendChild(h);
    var where = P.pathLine(d);
    if (where) {
      card.appendChild(el("p", "pv-path", where));
      var unitBar = bar(P.unitFraction(d), where); unitBar.classList.add("pv-unit-bar"); card.appendChild(unitBar);
    }
    card.appendChild(el("p", "pv-meta", playful
      ? d.dohHeader + " · " + d.notes.length + " notes"
      : d.dohHeader + " · " + d.key + " · " + d.tempoBpm + " BPM" + (focused ? " · " + d.notes.length + " notes" : "")));

    var tiles = el("ol", "pv-tiles");
    tiles.setAttribute("aria-label", "Sing: " + d.notes.map(function (n) { return (n.solfa || "") + (n.octaveMark || ""); }).join(" "));
    d.notes.forEach(function (n) { var li = el("li", null, (n.solfa || "") + (n.octaveMark || "")); li.setAttribute("aria-hidden", "true"); tiles.appendChild(li); });
    card.appendChild(tiles);

    var allowance = (s.progress && s.progress.drills) || d.allowance, left = P.drillsLeft(allowance);
    var live = el("div", "pv-live"); live.setAttribute("aria-live", "polite");
    var actions = el("div", "pv-actions");
    if (s.phase === "starting") {
      live.appendChild(document.createTextNode("Getting ready…"));
      var cancel = button("btn-ghost pv-wide", "/assets/icons.svg#i-x", "Cancel", function () { cancelTake(); });
      actions.appendChild(cancel);
    } else if (s.phase === "leadin" || s.phase === "singing") {
      live.appendChild(el("span", "pv-dot"));
      live.appendChild(el("span", "pv-live-text", liveText()));
      actions.appendChild(button("btn-ghost pv-wide", "/assets/icons.svg#i-stop", s.phase === "leadin" ? "Cancel" : "Stop and mark it", function () {
        if (s.phase === "leadin") cancelTake(); else finishTake();
      }));
    } else if (s.phase === "grading") {
      live.appendChild(document.createTextNode("Marking your take…"));
      var wait = button("btn-primary pv-wide", "/assets/icons.svg#i-clock", "Marking your take…", function () {});
      wait.disabled = true; actions.appendChild(wait);
    } else {
      live.hidden = true;
      var hearBtn = button("btn-ghost", isHearing() ? "/assets/icons.svg#i-stop" : "/assets/icons.svg#i-volume", isHearing() ? "Stop" : playful ? "Listen" : "Hear it", toggleHear);
      hearBtn.id = "pv-hear";
      // After a mark: "Next drill" leads (or "Try it again" when the path brings the same drill back), and the drill
      // just sung can be sung again for practice.
      var onward = s.grade ? P.nextAction(d, s.next, tr) : null, moveOn = onward && !onward.same;
      var singBtn = button(moveOn ? "btn-ghost" : "btn-primary", "/assets/icons.svg#i-mic",
        moveOn ? (playful ? "Again!" : "Sing it again") : onward ? onward.label : playful ? "Sing it!" : "Sing it", sing);
      singBtn.id = "pv-sing";
      if (left === 0) singBtn.disabled = true;
      actions.appendChild(hearBtn); actions.appendChild(singBtn);
      if (moveOn) {
        var nextBtn = button("btn-primary pv-wide", "/assets/icons.svg#i-arrow-right", onward.label, goNext);
        nextBtn.id = "pv-next";
        actions.appendChild(nextBtn);
      }
    }
    card.appendChild(live);
    card.appendChild(actions);
    var line = P.allowanceLine(allowance);
    if (line) card.appendChild(el("p", "pv-allow", line));
    if (s.error) { var err = el("p", "pv-error", s.error); err.setAttribute("role", "alert"); card.appendChild(err); }
    if (s.grade && s.grade.milestone && s.phase === "idle") {
      var ms = el("div", "pv-milestone"); ms.setAttribute("role", "status");
      ms.appendChild(el("strong", null, s.grade.milestone.title));
      ms.appendChild(el("p", null, s.grade.milestone.description));
      card.appendChild(ms);
    }
    if (s.grade && s.phase === "idle") {
      card.appendChild(playful ? starGrade(s.grade, d.notes, PT()) : gradeMarks(s.grade, d.notes, P));
      if (focused) {
        // Focused: the take's overall lean, and the take itself to listen back to.
        var row = el("div", "pv-focus-row");
        row.appendChild(el("span", "pv-tuning", PT().tuningLine(s.grade.tuningCents)));
        if (s.takeUrl) {
          var rb = button("btn-ghost", "/assets/icons.svg#i-play", "Replay my take", replay);
          rb.id = "pv-replay";
          row.appendChild(rb);
        }
        card.appendChild(row);
      }
    }
    return card;
  }

  /** Playful's marked take: one to three stars and a friendly word, never the number; the notes coloured, no cents. */
  function starGrade(g, notes, T) {
    var stars = T.starsFor(g.score), box = el("div", "pv-stars-result");
    var row = el("div", "pv-stars");
    row.setAttribute("role", "img"); row.setAttribute("aria-label", stars + " of 3 stars. " + T.starWord(stars));
    row.appendChild(art(T.starsArt(stars), 148, 72));
    box.appendChild(row);
    box.appendChild(el("p", "pv-star-word", T.starWord(stars)));
    box.appendChild(el("p", "pv-star-hint", T.starHint(g, stars)));
    if (g.octaveShift) box.appendChild(el("p", "pv-star-hint", "You sang it " + (g.octaveShift > 0 ? "higher up" : "lower down") + ". That's fine!"));
    var marks = el("div", "marks pv-play-marks");
    (g.notes || []).forEach(function (m) {
      var n = notes[m.index];
      if (!n) return;
      var mk = el("span", "mark " + m.status, (n.solfa || "") + (n.octaveMark || ""));
      mk.title = m.status === "hit" ? "spot on" : m.status === "near" ? "close" : m.status === "wrong" ? "try again" : "not heard";
      marks.appendChild(mk);
    });
    box.appendChild(marks);
    box.appendChild(el("p", "pv-legend", "Green spot on · amber close · red try again · grey not heard"));
    var earned = T.playfulRewardLine(g.reward);
    if (earned) box.appendChild(el("p", "pv-earned", earned));
    return box;
  }

  /** Focused: the take just marked, played back from the recording. */
  function replay() {
    if (!s.takeUrl || s.phase !== "idle") return;
    stopHear();
    try {
      if (replayAudio) replayAudio.pause();
      replayAudio = new Audio(s.takeUrl);
      var p = replayAudio.play();
      if (p && p.catch) p.catch(function () { s.error = "We couldn't play your take back."; render(); });
      track("Practice take replayed");
    } catch (e) { s.error = "We couldn't play your take back."; render(); }
  }
  function stopReplay() { if (replayAudio) { try { replayAudio.pause(); } catch (e) { /* gone */ } replayAudio = null; } }
  function dropTakeUrl() {
    stopReplay();
    if (s.takeUrl) { try { URL.revokeObjectURL(s.takeUrl); } catch (e) { /* gone */ } }
    s.takeUrl = null;
  }

  /** The marked take: score, verdict, every note green/amber/red/grey with its cents off, and what it earned. */
  function gradeMarks(g, notes, P) {
    var box = el("div", "pv-result");
    box.setAttribute("aria-label", "Your take, marked");
    var row = el("div", "pv-score-row");
    row.appendChild(el("strong", "pv-score " + (g.score >= 80 ? "good" : g.score >= 50 ? "fair" : "poor"), String(g.score)));
    var text = el("div");
    text.appendChild(el("p", "pv-summary", g.summary));
    if (g.octaveShift) text.appendChild(el("p", "pv-legend", "Sung " + (g.octaveShift > 0 ? "an octave up" : "an octave down") + " — that's fine."));
    row.appendChild(text);
    box.appendChild(row);
    var marks = el("div", "marks");
    (g.notes || []).forEach(function (m) {
      var n = notes[m.index];
      if (!n) return;
      var mk = el("span", "mark " + m.status, (n.solfa || "") + (n.octaveMark || ""));
      mk.appendChild(el("small", null, m.status === "missed" ? "—" : m.cents == null ? "" : (m.cents > 0 ? "+" : "") + Math.round(m.cents)));
      mk.title = m.status === "missed" ? "not sung" : m.status;
      marks.appendChild(mk);
    });
    box.appendChild(marks);
    box.appendChild(el("p", "pv-legend", "Green in tune · amber close · red wrong note · grey not sung. Numbers are cents off."));
    var earned = P.rewardMoment(g.reward);
    if (earned) {
      var e = el("p", "pv-earned");
      e.appendChild(icon("/assets/icons.svg#i-sparkle"));
      e.appendChild(document.createTextNode(earned.line));
      box.appendChild(e);
    }
    return box;
  }

  function weekCard(p, P) {
    var card = el("section", "card pv-week");
    card.setAttribute("aria-labelledby", "pv-week-title");
    var row = el("div", "pv-week-row");
    row.appendChild(ring(p.weeklyGoal));
    var text = el("div", "pv-week-text");
    var h = el("h2", "pv-title", p.weeklyGoal.daysDone + " of " + p.weeklyGoal.target + " days this week"); h.id = "pv-week-title";
    text.appendChild(h);
    text.appendChild(el("p", "pv-meta", p.weeklyGoal.daysDone >= p.weeklyGoal.target ? "Weekly goal met." : "Practise " + p.weeklyGoal.target + " days a week to meet the goal."));
    row.appendChild(text);
    card.appendChild(row);
    var days = el("ol", "pv-days");
    days.setAttribute("aria-label", "The last seven days");
    P.dayDots(p.lastSevenDays).forEach(function (d) {
      var li = el("li", d.status), dot = el("span", "dot");
      li.setAttribute("aria-label", d.label);
      if (d.status === "done") dot.appendChild(icon("/assets/icons.svg#i-check"));
      if (d.status === "frozen") dot.appendChild(art("freeze", 26));
      li.appendChild(dot);
      var letter = el("span", null, d.letter); letter.setAttribute("aria-hidden", "true");
      li.appendChild(letter);
      days.appendChild(li);
    });
    card.appendChild(days);
    card.appendChild(el("p", "pv-meta", p.xpToday + " of " + p.dailyXpCap + " XP today"));
    return card;
  }

  /**
   * The weekly goal as the art draws it: one arc per practice day of the goal, lit as the days are sung, and a ticked
   * disc in the middle once the week is met (the phone's GoalRing).
   */
  function ring(goal) {
    var size = 64, stroke = 7, c = size / 2, r = c - stroke / 2 - 1, NS = "http://www.w3.org/2000/svg";
    var n = Math.max(1, Math.min(7, goal.target)), done = Math.min(goal.daysDone, n), met = goal.target > 0 && goal.daysDone >= goal.target;
    var seg = 360 / n, gap = n > 1 ? 14 : 0;
    function at(deg) { var a = (deg - 90) * Math.PI / 180; return (c + r * Math.cos(a)).toFixed(2) + " " + (c + r * Math.sin(a)).toFixed(2); }
    var box = el("div", "pv-ring" + (met ? " is-met" : ""));
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", "Weekly goal: " + goal.daysDone + " of " + goal.target + " days" + (met ? ", met" : ""));
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", size); svg.setAttribute("height", size); svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("aria-hidden", "true");
    for (var i = 0; i < n; i++) {
      var arc = document.createElementNS(NS, n === 1 ? "circle" : "path");
      if (n === 1) { arc.setAttribute("cx", c); arc.setAttribute("cy", c); arc.setAttribute("r", r); }
      else arc.setAttribute("d", "M" + at(i * seg + gap / 2) + "A" + r + " " + r + " 0 0 1 " + at((i + 1) * seg - gap / 2));
      arc.setAttribute("class", i < done ? "on" : "off");
      svg.appendChild(arc);
    }
    if (met) {
      var disc = document.createElementNS(NS, "circle");
      disc.setAttribute("class", "disc"); disc.setAttribute("cx", c); disc.setAttribute("cy", c); disc.setAttribute("r", r - 9);
      var tick = document.createElementNS(NS, "path");
      tick.setAttribute("class", "tick"); tick.setAttribute("d", "M24.5 32.5l5 5 10-11");
      svg.appendChild(disc); svg.appendChild(tick);
    }
    box.appendChild(svg);
    return box;
  }

  function badgeGrid(p, P) {
    var list = el("ul", "pv-badges");
    P.sortBadges(p.badges).forEach(function (b) {
      var li = el("li", "pv-badge " + (b.earned ? "earned" : "locked"));
      li.setAttribute("aria-label", b.title + ". " + b.description + " " + (b.earned ? "Earned." : b.progress + " of " + b.target + "."));
      li.appendChild(art(PT().badgeArt(b.code, b.earned), 40, 41));
      li.appendChild(el("strong", null, b.title));
      li.appendChild(el("p", null, b.description));
      if (!b.earned) {
        var prog = el("div", "pv-badge-progress");
        prog.setAttribute("aria-hidden", "true");
        prog.appendChild(bar(P.badgeFraction(b)));
        prog.appendChild(el("span", null, Math.min(b.progress, b.target) + "/" + b.target));
        li.appendChild(prog);
      }
      list.appendChild(li);
    });
    return list;
  }

  /** Playful's sticker book: each badge its own die-cut sticker, tilted as if stuck by hand; locked ones grey and flat. */
  function stickers(p, P, T) {
    var list = el("ul", "pv-stickers");
    P.sortBadges(p.badges).forEach(function (b) {
      var li = el("li", "pv-sticker" + (b.earned ? " earned" : ""));
      li.setAttribute("aria-label", b.title + " sticker. " + b.description + " " + (b.earned ? "Earned." : b.progress + " of " + b.target + "."));
      var pic = art(T.badgeArt(b.code, b.earned), 76, 79);
      if (b.earned) pic.style.transform = "rotate(" + T.stickerTilt(b.code) + "deg)";
      li.appendChild(pic);
      li.appendChild(el("strong", null, b.title));
      if (!b.earned) li.appendChild(el("small", null, Math.min(b.progress, b.target) + "/" + b.target));
      list.appendChild(li);
    });
    return list;
  }

  /** Focused's badges: the same stickers, small and flat, in a plain list, earned or how far along. */
  function badgeList(p, P) {
    var list = el("ul", "card pv-badge-list");
    P.sortBadges(p.badges).forEach(function (b) {
      var li = el("li", b.earned ? "earned" : "locked");
      li.setAttribute("aria-label", b.title + ". " + b.description + " " + (b.earned ? "Earned." : b.progress + " of " + b.target + "."));
      li.appendChild(art(PT().badgeArt(b.code, b.earned), 34, 35));
      var text = el("span", "pv-badge-row-text");
      text.appendChild(el("strong", null, b.title));
      text.appendChild(el("span", null, b.description));
      li.appendChild(text);
      li.appendChild(el("span", "pv-badge-row-count", b.earned ? "Earned" : Math.min(b.progress, b.target) + "/" + b.target));
      list.appendChild(li);
    });
    return list;
  }

  /**
   * Playful's burst: a couple of dozen paper bits flung from the middle and gone in about a second. CSS only (each
   * bit's path is two custom properties), never touchable, and nothing at all for reduced motion — the stars say it.
   */
  var confettiWarm = false;
  /** Playful fetches the burst's eight tiny pieces once, ahead of the first burst, so it never flies blank. */
  function warmConfetti() {
    if (confettiWarm || reducedMotion()) return;
    confettiWarm = true;
    PT().CONFETTI_ART.forEach(function (n) { art(n, 1); });
  }
  /** `pieces` swaps the paper bits (the Carol singer's snowflakes and quavers); the usual ones by default. */
  function burst(pieces) {
    if (reducedMotion()) return;
    var bits = pieces && pieces.length ? pieces : PT().CONFETTI_ART;
    var layer = el("div", "pv-confetti"); layer.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 24; i++) {
      var angle = (i / 24) * Math.PI * 2 + ((i * 37) % 11) / 20, reach = 90 + ((i * 53) % 70);
      var size = 14 + ((i * 7) % 9), bit = art(bits[i % bits.length], size);
      bit.style.setProperty("--dx", Math.round(Math.cos(angle) * reach) + "px");
      bit.style.setProperty("--dy", Math.round(Math.sin(angle) * reach - 40) + "px");
      bit.style.setProperty("--r", ((i * 47) % 360) + "deg");
      layer.appendChild(bit);
    }
    document.body.appendChild(layer);
    setTimeout(function () { layer.remove(); }, 1500);
  }

  /** The tile of the note sounding (Hear it) or due (Sing it), lit. */
  function highlight(i) {
    if (!root) return;
    var tiles = root.querySelectorAll(".pv-tiles li");
    for (var k = 0; k < tiles.length; k++) tiles[k].classList.toggle("on", k === i);
  }

  // ── Hear it: the drill on the rehearsal piano, once, at its tempo ───────
  var hearing = false;
  function isHearing() { return hearing; }
  function toggleHear() {
    var d = s.drill;
    if (!d || s.phase !== "idle") return;
    stopReplay();
    if (!hear) {
      hear = ctx.choir.createPlayer();
      hear.onTick(function (t) {
        var i = -1;
        if (t.playing && s.drill) s.drill.notes.forEach(function (n, k) { if (t.beat >= n.startBeat && t.beat < n.startBeat + n.durBeats) i = k; });
        highlight(i);
        // Only the start and the end redraw (the button's label): the tiles are lit in place.
        if (hearing !== t.playing) { hearing = t.playing; if (s.phase === "idle") render(); }
      });
    }
    if (hearing) { hear.stop(); return; }
    hear.load({ voices: [{ name: "drill", notes: d.notes, gain: 1 }], tempoBpm: d.tempoBpm, timeSignature: d.timeSignature });
    hear.play();
    track("Practice drill heard", d.id);
  }
  function stopHear() { if (hear) hear.stop(); highlight(-1); }

  // ── Sing it: a count-in, the singer alone, marked by the server ─────────
  function liveText() {
    if (!take) return "";
    var t = Math.max(0, take.audio.currentTime - take.t0);
    if (t < take.lead) return "Starting note… sing in " + Math.max(1, Math.ceil(take.lead - t));
    return "Sing!";
  }

  /**
   * The count-in on the audio clock: `beats` clicks (higher a whole bar before beat one), and the first note held on
   * the piano through the first `holdBeats` as a pitch pipe. Returns when the count-in's first click sounds.
   */
  function countIn(audio, lead, withPiano) {
    var C = ctx.choir, t0 = audio.currentTime + 0.05;
    if (withPiano) C.pianoNote(audio, C.createPianoOutput(audio), lead.pitchMidi, lead.holdBeats * lead.beatSec, t0, 0.9);
    for (var i = 0; i < lead.beats; i++) {
      var at = t0 + i * lead.beatSec, osc = audio.createOscillator(), g = audio.createGain();
      osc.frequency.value = (lead.beats - i) % lead.beatsPerBar === 0 ? 1500 : 1000;
      g.gain.setValueAtTime(0.4, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      osc.connect(g); g.connect(audio.destination); osc.start(at); osc.stop(at + 0.06);
    }
    return t0;
  }

  function sing() {
    var d = s.drill, P = PP();
    if (!d || s.phase !== "idle" || take) return;
    var allowance = (s.progress && s.progress.drills) || d.allowance;
    if (P.drillsLeft(allowance) === 0) return;
    stopHear(); dropTakeUrl();
    s.error = null; s.grade = null;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      s.error = P.micError({ name: "Unsupported" }); render(); return;
    }
    var gen = s.gen, AC = window.AudioContext || window.webkitAudioContext;
    // Made on the press, so the browser lets it play; the piano is decoded into it while the microphone opens.
    var audio = new AC();
    var mine = take = { audio: audio, cancelled: false, lead: P.leadIn(d).seconds };
    s.phase = "starting"; render();
    var piano = Promise.race([
      ctx.choir.loadPiano(audio).then(function () { return true; }, function () { return false; }),
      new Promise(function (resolve) { setTimeout(function () { resolve(false); }, PIANO_WAIT_MS); })
    ]);
    var mic = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    Promise.all([mic, piano]).then(function (got) {
      var stream = got[0];
      if (gen !== s.gen || mine.cancelled || take !== mine) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      mine.stream = stream;
      var mime = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      // One voice at 32 kbps (the phone's data-saver rate): a drill take is tens of kilobytes on 3G, not hundreds.
      var opts = { audioBitsPerSecond: 32000 };
      if (mime) opts.mimeType = mime;
      var chunks = [], rec = new MediaRecorder(stream, opts);
      mine.recorder = rec;
      rec.addEventListener("dataavailable", function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      rec.addEventListener("stop", function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (gen !== s.gen || mine.cancelled) return; // cancelled: nothing is sent and no drill is spent
        var type = rec.mimeType || mime || "audio/webm";
        send(new Blob(chunks, { type: type }), type.indexOf("mp4") >= 0 ? "drill.m4a" : "drill.webm", d, gen, mine.lead);
      });
      if (audio.state === "suspended") audio.resume();
      rec.start();
      var lead = P.leadIn(d);
      mine.t0 = countIn(audio, lead, got[1]);
      mine.lead = lead.seconds;
      s.phase = "leadin"; render();
      document.body.classList.add("is-recording");
      track("drill_started", "drill=" + d.id + ";level=" + d.level);
      mine.timer = setInterval(function () { tick(mine, d); }, 100);
      // A second after the last note (the server keeps no more than maxTakeSeconds anyway).
      mine.stopAt = setTimeout(function () { if (take === mine) finishTake(); }, (P.takeSeconds(d) + 0.05) * 1000);
    }, function (err) {
      if (take === mine) take = null;
      try { audio.close(); } catch (e) { /* already closed */ }
      if (gen !== s.gen || mine.cancelled) return;
      s.phase = "idle"; s.error = P.micError(err); render();
    });
  }

  function tick(mine, d) {
    if (take !== mine || !root) return;
    var t = mine.audio.currentTime - mine.t0;
    if (s.phase === "leadin" && t >= mine.lead) { s.phase = "singing"; render(); }
    var text = root.querySelector(".pv-live-text");
    if (text) text.textContent = liveText();
    highlight(PP().noteDueAt(d.notes, d.tempoBpm, mine.lead, t));
  }

  /** Ends the recording; `cancelled` takes are dropped, the rest go to be marked. */
  function endTake(cancelled) {
    var mine = take;
    if (!mine) return;
    take = null;
    mine.cancelled = mine.cancelled || cancelled;
    if (mine.timer) clearInterval(mine.timer);
    if (mine.stopAt) clearTimeout(mine.stopAt);
    document.body.classList.remove("is-recording");
    highlight(-1);
    if (mine.recorder && mine.recorder.state !== "inactive") mine.recorder.stop();
    else if (mine.stream) mine.stream.getTracks().forEach(function (t) { t.stop(); });
    try { mine.audio.close(); } catch (e) { /* already closed */ }
  }
  function finishTake() { endTake(false); s.phase = "grading"; render(); }
  function cancelTake() { var had = !!take; endTake(true); if (had) { s.phase = "idle"; render(); } }

  /** `lead` is the take's count-in in seconds: the server finds beat one there. */
  function send(blob, name, d, gen, lead) {
    var P = PP(), form = new FormData();
    form.append("audio", blob, name);
    form.append("drillId", d.id);
    form.append("leadInSec", String(lead));
    ctx.request("/api/practice/drills/grade", { method: "POST", form: form }).then(function (g) {
      if (gen !== s.gen) return;
      s.grade = g; s.phase = "idle"; s.error = null;
      track("drill_completed", "drill=" + d.id + ";score=" + g.score + ";xp=" + ((g.reward && g.reward.xpGained) || 0));
      P.rewardEvents(g.reward).forEach(function (e) { track(e.name, e.detail); });
      if (g.reward && s.progress) s.progress = Object.assign({}, s.progress, { xp: g.reward.xp, level: g.reward.level });
      dropTakeUrl();
      try { s.takeUrl = URL.createObjectURL(blob); } catch (e) { s.takeUrl = null; } // Focused's "Replay my take"
      render();
      // The moment, by the track the drill was sung on: a burst, a line, or nothing (practice-track.js).
      var T = PT(), sungOn = d.track !== undefined ? d.track : currentTrack();
      var how = T.celebrationFor(sungOn, g.score, g.reward, !!g.milestone), moment = P.rewardMoment(g.reward);
      var line = g.milestone ? g.milestone.title : sungOn === "playful" ? T.playfulRewardLine(g.reward) : moment && moment.line;
      if (how === "burst") burst();
      if (how !== "quiet" && line) toast(line, T.rewardArt(g.reward));
      refreshProgress();
      fetchNext();
    }, function (err) {
      if (gen !== s.gen) return;
      s.phase = "idle"; s.error = P.gradeError(err);
      if (err && err.code === "PRACTICE_DAILY_LIMIT" && s.progress) {
        var a = s.progress.drills || d.allowance;
        s.progress.drills = { used: a.limit, limit: a.limit, resetsAtUtc: a.resetsAtUtc || null };
      }
      render();
    });
  }

  /** After a marked take: the path's next drill, ready for "Next drill" (its label says "Try it again" when it is the same). */
  function fetchNext() {
    var gen = s.gen;
    s.next = null;
    return ctx.request("/api/practice/drills/next").then(function (d) {
      if (gen !== s.gen || !d) return;
      s.next = d;
      if (s.phase === "idle") render();
    }, function () { /* "Next drill" asks again when pressed */ });
  }

  /** On along the path: the drill fetched after the take (or fetched now), its marks cleared. */
  function goNext() {
    if (s.phase !== "idle") return;
    var gen = s.gen;
    stopHear(); stopReplay();
    var ready = s.next ? Promise.resolve(s.next) : ctx.request("/api/practice/drills/next");
    ready.then(function (d) {
      if (gen !== s.gen || !d) return;
      s.drill = d; s.next = null; s.grade = null; s.error = null;
      dropTakeUrl(); hideToast(); render();
      var title = root && root.querySelector("#pv-drill-title");
      if (title) { title.setAttribute("tabindex", "-1"); title.focus(); }
    }, function (err) {
      if (gen !== s.gen) return;
      s.error = (err && err.message) || "We couldn't load the next drill. Please try again.";
      render();
    });
  }

  // ── The reward toast ────────────────────────────────────────────────────
  /** One line, with the new level's emblem or the new badge's sticker beside it when it is one. */
  function toast(line, picture) {
    if (!toastEl) {
      toastEl = el("div", "pv-toast");
      toastEl.setAttribute("role", "status");
      toastEl.appendChild(el("span", "pv-toast-pic"));
      toastEl.appendChild(el("span"));
      document.body.appendChild(toastEl);
    }
    var pic = toastEl.firstChild;
    pic.innerHTML = "";
    pic.appendChild(picture ? art(picture, 28) : icon("/assets/icons.svg#i-sparkle"));
    toastEl.lastChild.textContent = line;
    // Re-inserted so the entrance plays again for a second reward (the CSS drops it for reduced motion).
    toastEl.hidden = true; void toastEl.offsetWidth; toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, TOAST_MS);
  }
  function hideToast() { clearTimeout(toastTimer); if (toastEl) toastEl.hidden = true; }

  // ── The view's way in and out ───────────────────────────────────────────
  function open(rootEl, context) {
    ctx = context;
    root = rootEl;
    render();
    // The home's season link opens on the season's path, once the progress says it is there.
    var toSeason = context && (context.show === "season" || context.show === "carols");
    if (s.phase === "idle") load().then(function () { if (toSeason && s.progress && s.progress.season) openSeasonPath(); });
  }
  /** Another view: nothing keeps sounding or listening, and coming back opens on the hub. */
  function leave() {
    stopHear(); stopReplay();
    if (take) cancelTake();
    hideToast();
    if (s.mode) {
      if (s.mode === "season") { if (window.NfPracticeCarols) window.NfPracticeCarols.leave(); }
      else if (window.NfPracticeModeView) window.NfPracticeModeView.leave();
      s.mode = null; inMode(false);
    }
  }
  /** Signed out: the next person on this browser sees none of it. */
  function reset() {
    s.gen++;
    leave();
    if (window.NfPracticeModeView) window.NfPracticeModeView.reset();
    if (window.NfPracticeCarols) window.NfPracticeCarols.reset();
    dropTakeUrl();
    s.progress = null; s.drill = null; s.next = null; s.grade = null; s.error = null; s.loadError = null; s.loading = false; s.phase = "idle";
    s.picking = false; s.savingTrack = null; s.trackError = null;
    if (root) root.innerHTML = "";
  }

  window.NfPracticeView = { open: open, leave: leave, reset: reset };
})();
