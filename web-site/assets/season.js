/* The seasons on the website and in /app (boards d-christmas/06 and j-halloween/06): one switch each, read at runtime.
 *
 * One small request per page load (GET /api/app/season, a minute's cache; a signed-in admin's token also sees the
 * admin preview) answers { christmas, halloween }, at most one true (Christmas wins should both ever say so). Both off
 * — the default, or the API out of reach — and nothing here touches the page. A season on, it sets
 * data-season="christmas" or "halloween" on <html>, loads assets/season.css (every seasonal style lives there, so none
 * of it is downloaded the rest of the year) and dresses the page:
 *   - the brand mark wears the season's costume: Christmas's cap or Halloween's witch hat (an SVG laid over the mark,
 *     never a control's; the mark itself is unchanged);
 *   - [data-season-show="<season>"] elements appear (the home page's pine carols line, its pumpkin spooky-songs line);
 *   - the season's <template> takes the home hero's sample sheet's place: "season-sheet" (Silent Night) at Christmas,
 *     "season-sheet-halloween" (the Mountain King's first bar) at Halloween, when the build has made one;
 *   - the season's sky crosses [data-season-sky] (the hero, the web app's greeting) for a few seconds and stops:
 *     slow flakes at Christmas, a few bats at Halloween, never with reduced motion;
 *   - window.NfSeason.<season> is true, NfSeason.season names it, and a "nf-season" event goes to the page (app.js's
 *     greeting, the Practice view).
 * The website never chimes: browsers keep a page silent until it is tapped.
 *
 * The flake, bat and costume arithmetic is the phone's (mobile/src/lib/season.ts): web-site/tests/season.test.mjs keeps
 * them in step. Plain script, no build step; loaded deferred on the site pages and /app.
 */
(function () {
  "use strict";

  // ── Pure: the answer, the flakes, the bats, the costumes' places ────────
  var SNOW = { dots: 12, glyphs: 2, minSize: 2, maxSize: 5, glyphMin: 9, glyphMax: 12, minOpacity: 0.3, maxOpacity: 0.6, minSpeed: 40, maxSpeed: 70, sway: 8, lastStart: 3, allGone: 6 };
  var BATS = { count: 8, minSize: 18, maxSize: 34, minOpacity: 0.3, maxOpacity: 0.5, minFlight: 2, maxFlight: 3, arc: 24, flapsPerSecond: 5, lastStart: 3, allGone: 6 };

  /** The season an answer turns on: only `true` counts, one at a time, Christmas first; null when none is. */
  function seasonOf(answer) {
    if (!answer || typeof answer !== "object") return null;
    if (answer.christmas === true) return "christmas";
    if (answer.halloween === true) return "halloween";
    return null;
  }
  /** Whether an answer turns any season on. */
  function isOn(answer) { return seasonOf(answer) !== null; }

  /** A seeded generator (Park–Miller), so a page draws the same sky every time. */
  function seeded(seed) {
    var s = Math.abs(Math.floor(seed)) % 2147483647 || 11;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  /** The flakes for a box `height` px tall: about fourteen, 2–5 px, 30–60%, 40–70 px/s, none after 3 s, gone by 6 s. */
  function snowPlan(seed, height) {
    var r = seeded(seed), out = [];
    function between(a, b) { return a + r() * (b - a); }
    for (var i = 0; i < SNOW.dots + SNOW.glyphs; i++) {
      var glyph = i >= SNOW.dots, delay = Math.round(between(0, SNOW.lastStart) * 100) / 100;
      out.push({
        x: Math.round(between(0.03, 0.97) * 1000) / 1000,
        y: Math.round(between(-0.08, 0.45) * Math.max(0, height)),
        size: Math.round((glyph ? between(SNOW.glyphMin, SNOW.glyphMax) : between(SNOW.minSize, SNOW.maxSize)) * 10) / 10,
        glyph: glyph,
        opacity: Math.round(between(SNOW.minOpacity, SNOW.maxOpacity) * 100) / 100,
        speed: Math.round(between(SNOW.minSpeed, SNOW.maxSpeed)),
        sway: SNOW.sway,
        delay: delay,
        duration: Math.round((SNOW.allGone - delay) * 100) / 100
      });
    }
    return out;
  }

  /**
   * The bats for a box `height` px tall: eight, 18–34 px across at 30–50%, each crossing in a 2–3 s arc (rising or
   * dipping up to 24 px) with a two-frame wing beat, none starting after 3 s and all gone by 6 s.
   */
  function batPlan(seed, height) {
    var r = seeded(seed), out = [];
    function between(a, b) { return a + r() * (b - a); }
    for (var i = 0; i < BATS.count; i++) {
      var delay = Math.round(between(0, BATS.lastStart) * 100) / 100;
      var duration = Math.round(Math.min(between(BATS.minFlight, BATS.maxFlight), BATS.allGone - delay) * 100) / 100;
      out.push({
        y: Math.round(between(0.06, 0.8) * Math.max(0, height)),
        size: Math.round(between(BATS.minSize, BATS.maxSize) * 10) / 10,
        opacity: Math.round(between(BATS.minOpacity, BATS.maxOpacity) * 100) / 100,
        dir: r() < 0.5 ? 1 : -1,
        rise: Math.round(between(-BATS.arc, BATS.arc * 0.5)),
        tilt: Math.round(between(-12, 12)),
        delay: delay,
        duration: duration,
        flaps: Math.max(4, Math.round(duration * BATS.flapsPerSecond))
      });
    }
    return out;
  }

  /** What a season wears: Christmas the cap, Halloween the witch hat. */
  function costumeOf(season) { return season === "christmas" ? "cap" : season === "halloween" ? "hat" : null; }

  /** [x, y, degrees, scale] on the mark's own 331 × 438 box (each costume's brim middle at 100,125 of its 200 × 150). */
  var ON_MARK = {
    // On the "5"'s stem, tipped back, the pompom hanging left.
    cap: { large: [150, 22, -22, "1.1"], small: [150, 26, -22, "1.45"] },
    // On the "5"'s top bar, tipped back, its tip flopping left.
    hat: { large: [150, 30, -12, "1.18"], small: [150, 38, -12, "1.6"] }
  };
  /** [x, y, degrees, scale] on Doh's 200 × 200 box: over the crown, tipped back so the note-crest shows. */
  var ON_DOH = { cap: [84, 60, -18, ".46"], hat: [90, 62, -14, ".5"] };

  /** Where a costume sits on the mark: a third larger at header sizes (30 px and under) so it still reads. */
  function costumeOnMark(costume, height) {
    var p = ON_MARK[costume][height <= 30 ? "small" : "large"];
    return "translate(" + p[0] + " " + p[1] + ") rotate(" + p[2] + ") scale(" + p[3] + ")";
  }
  /** Where a costume sits on Doh: higher when he jumps (the cheer poses). */
  function costumeOnDoh(costume, pose) {
    var p = ON_DOH[costume], lift = String(pose).indexOf("doh-cheer") === 0 ? 8 : 0;
    return "translate(" + p[0] + " " + (p[1] - lift) + ") rotate(" + p[2] + ") scale(" + p[3] + ")";
  }
  function capOnMark(height) { return costumeOnMark("cap", height); }
  function capOnDoh(pose) { return costumeOnDoh("cap", pose); }
  function hatOnMark(height) { return costumeOnMark("hat", height); }
  function hatOnDoh(pose) { return costumeOnDoh("hat", pose); }

  var ART_DIR = "/assets/practice-art/";
  /** A costume's picture (the Practice art), for the mark and for Doh. */
  var COSTUME_ART = { cap: ART_DIR + "season-cap.svg?v=1", hat: ART_DIR + "season-hat.svg?v=1" };

  var api = window.NfSeason = {
    christmas: false, halloween: false, season: null,
    isOn: isOn, seasonOf: seasonOf, costumeOf: costumeOf, COSTUME_ART: COSTUME_ART,
    snowPlan: snowPlan, batPlan: batPlan, costumeOnMark: costumeOnMark, costumeOnDoh: costumeOnDoh,
    capOnMark: capOnMark, capOnDoh: capOnDoh, hatOnMark: hatOnMark, hatOnDoh: hatOnDoh, SNOW: SNOW, BATS: BATS
  };
  if (typeof document === "undefined" || !document.documentElement) return;

  // ── The page ────────────────────────────────────────────────────────────
  var CSS = "/assets/season.css?v=4";
  var NS = "http://www.w3.org/2000/svg";
  // The header's mark (not the footer's: one costume a screen), the web app's top bar and sidebar, and its home's big mark.
  var MARKS = ".site-header .site-brand-mark, .topbar .brand-mark, .side-head .brand-mark, .home-mark";
  // The home hero's sample for each season, kept inert in a <template> by tools/blog/lib/render-home.mjs.
  var SHEETS = { christmas: "season-sheet", halloween: "season-sheet-halloween" };
  // One bat in currentColor (practice-art/bat.svg): scalloped wings, two ears.
  var BAT = '<svg viewBox="0 0 40 20" aria-hidden="true"><path fill="currentColor" d="M20 8L18.4 4.8L17.4 8.6C14.5 4.4 8.5 3.2 1.5 7.2C4.6 8.2 5.8 10.8 5.6 13.8C7.6 12 9.8 12 11 14C12.6 12 14.8 12.1 15.8 15C17 13.2 18.6 13.4 20 15.6C21.4 13.4 23 13.2 24.2 15C25.2 12.1 27.4 12 29 14C30.2 12 32.4 12 34.4 13.8C34.2 10.8 35.4 8.2 38.5 7.2C31.5 3.2 25.5 4.4 22.6 8.6L21.6 4.8Z"/></svg>';
  var root = document.documentElement;
  var API = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:5080" : "https://api.notefusion.studio";

  function reducedMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  /** The costume as an SVG the size of a mark's box (the mask draws the mark centred in it, as this does). */
  function costumeSvg(costume, viewBox, transform) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "season-cap");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var g = document.createElementNS(NS, "g"), img = document.createElementNS(NS, "image");
    g.setAttribute("transform", transform);
    img.setAttribute("href", COSTUME_ART[costume]);
    img.setAttribute("x", "-100"); img.setAttribute("y", "-125"); img.setAttribute("width", "200"); img.setAttribute("height", "150");
    g.appendChild(img); svg.appendChild(g);
    return svg;
  }

  /**
   * Lays the costume over a masked mark. The mask would hide anything inside the mark, so the mark goes into a box of
   * its own size and the costume sits beside it in that box.
   */
  function dressMark(mark, costume) {
    if (!mark || !mark.parentNode || mark.parentNode.classList.contains("season-capped")) return;
    // The box takes the mark's size and place (season.css, per mark); the mark keeps its own.
    var h = parseFloat(window.getComputedStyle(mark).height) || 30;
    var box = document.createElement("span");
    box.className = "season-capped";
    mark.parentNode.insertBefore(box, mark);
    box.appendChild(mark);
    box.appendChild(costumeSvg(costume, "0 0 331 438", costumeOnMark(costume, h)));
  }

  /** A layer laid at the back of a sky box, taken away once everything in it has gone. */
  function skyLayer(box, cls, goneAfter) {
    var layer = document.createElement("div");
    layer.className = cls;
    layer.setAttribute("aria-hidden", "true");
    box.insertBefore(layer, box.firstChild);
    setTimeout(function () { layer.remove(); }, (goneAfter + 0.3) * 1000);
    return layer;
  }

  /** A few flakes falling in `box` for a few seconds, then gone. */
  function snow(box, seed) {
    var h = Math.min(box.clientHeight || 320, 420), layer = skyLayer(box, "season-snow", SNOW.allGone);
    snowPlan(seed, h).forEach(function (f) {
      var flake = document.createElement("i");
      flake.className = "season-flake" + (f.glyph ? " is-glyph" : "");
      flake.style.cssText = "left:" + (f.x * 100).toFixed(1) + "%;top:" + f.y + "px;width:" + f.size + "px;height:" + f.size + "px;" +
        "--o:" + f.opacity + ";--fall:" + Math.round(f.speed * f.duration) + "px;--sway:" + f.sway + "px;" +
        "animation-delay:" + f.delay + "s;animation-duration:" + f.duration + "s";
      if (f.glyph) {
        flake.innerHTML = '<svg viewBox="-10 -10 20 20"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
          [0, 60, 120].map(function (d) { return '<path transform="rotate(' + d + ')" d="M0 -8.5V8.5M-2.6 -6.4L0 -4.2L2.6 -6.4M-2.6 6.4L0 4.2L2.6 6.4"/>'; }).join("") + "</g></svg>";
      }
      layer.appendChild(flake);
    });
  }

  /**
   * A few bats crossing the top of `box` and leaving: the phone's eight on a wide box, four on a phone's, each in its
   * arc with its wing beat (season.css draws the flight), all gone by 6 s.
   */
  function bats(box, seed) {
    var w = box.clientWidth || 360, sky = Math.min((box.clientHeight || 320) * 0.45, 240);
    var layer = skyLayer(box, "season-bats", BATS.allGone);
    batPlan(seed, sky).slice(0, w < 560 ? 4 : BATS.count).forEach(function (b) {
      var bat = document.createElement("i"), x0 = b.dir > 0 ? -b.size : w, x1 = b.dir > 0 ? w : -b.size;
      bat.className = "season-bat";
      bat.style.cssText = "top:" + Math.round(b.y - b.size / 4) + "px;width:" + b.size + "px;height:" + b.size / 2 + "px;" +
        "--o:" + b.opacity + ";--x0:" + x0 + "px;--xm:" + Math.round((x0 + x1) / 2) + "px;--x1:" + x1 + "px;" +
        "--rise:" + b.rise + "px;--rise-end:" + Math.round(b.rise * 0.3) + "px;--tilt:" + b.tilt * b.dir + "deg;" +
        "--flap:" + Math.round((b.duration / b.flaps) * 1000) + "ms;--flaps:" + b.flaps + ";" +
        "animation-delay:" + b.delay + "s;animation-duration:" + b.duration + "s";
      bat.innerHTML = BAT;
      bat.firstChild.style.animationDelay = b.delay + "s";
      layer.appendChild(bat);
    });
  }

  function dress(season) {
    root.setAttribute("data-season", season);
    api[season] = true;
    api.season = season;
    try { document.dispatchEvent(new CustomEvent("nf-season", { detail: { christmas: api.christmas, halloween: api.halloween, season: season } })); } catch (e) { /* an old browser */ }
    var link = document.createElement("link");
    link.rel = "stylesheet"; link.href = CSS;
    // Everything visible waits for the stylesheet, so nothing shows unstyled or shifts as it lands.
    link.addEventListener("load", function () {
      var costume = costumeOf(season);
      document.querySelectorAll(MARKS).forEach(function (mark) { dressMark(mark, costume); });
      // This lands after the first paint, so the home hero's sample column first keeps the year-round sample's height:
      // the season's line (at the top of the column) and its shorter sample fill room already there, and nothing moves.
      var sheet = document.getElementById(SHEETS[season]), hero = document.querySelector(".hero-sheet");
      var swap = sheet && hero && sheet.content ? hero.querySelector(".sheet") : null;
      if (swap) hero.style.minHeight = hero.getBoundingClientRect().height + "px";
      document.querySelectorAll("[data-season-show]").forEach(function (el) {
        var only = el.getAttribute("data-season-show");
        if (!only || only === season) el.hidden = false;
      });
      if (swap) swap.parentNode.replaceChild(sheet.content.cloneNode(true), swap);
      if (reducedMotion()) return;
      document.querySelectorAll("[data-season-sky]").forEach(function (box, i) {
        if (season === "halloween") bats(box, 5 + i * 13); else snow(box, 7 + i * 13);
      });
    });
    document.head.appendChild(link);
  }

  function token() {
    try { var t = JSON.parse(localStorage.getItem("nf.web.tokens") || "null"); return t && t.accessToken ? t.accessToken : null; } catch (e) { return null; }
  }

  api.ready = (window.fetch ? fetch(API + "/api/app/season", {
    credentials: "omit",
    headers: token() ? { Authorization: "Bearer " + token() } : {}
  }).then(function (r) { return r.ok ? r.json() : null; }) : Promise.resolve(null)).then(function (answer) {
    var season = seasonOf(answer);
    if (!season) return false;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { dress(season); }); else dress(season);
    return true;
  }, function () { return false; });
})();
