/* The Christmas season on the website and in /app (board d-christmas/06): one switch, read at runtime.
 *
 * One small request per page load (GET /api/app/season, a minute's cache; a signed-in admin's token also sees the
 * admin preview) answers { christmas }. Off — the default, or the API out of reach — and nothing here touches the
 * page. On, it sets data-season="christmas" on <html>, loads assets/season.css (every seasonal style lives there,
 * so none of it is downloaded the rest of the year) and dresses the page:
 *   - the brand mark wears the cap (an SVG laid over the mark, never a control's; the mark itself is unchanged);
 *   - [data-season-show] elements appear (the home page's pine "Carols in Tonic Solfa" line);
 *   - <template id="season-sheet"> takes the home hero's sample sheet's place (Silent Night for Amazing Grace);
 *   - a few slow flakes fall inside [data-season-snow] (the hero, the web app's greeting) for a few seconds and
 *     stop, never with reduced motion;
 *   - window.NfSeason.christmas is true and a "nf-season" event goes to the page (app.js's greeting, the Practice view).
 * The website never chimes: browsers keep a page silent until it is tapped.
 *
 * The flake and cap arithmetic is the phone's (mobile/src/lib/season.ts): web-site/tests/season.test.mjs keeps them
 * in step. Plain script, no build step; loaded deferred on the site pages and /app.
 */
(function () {
  "use strict";

  // ── Pure: the answer, the flakes, the cap's place ───────────────────────
  var SNOW = { dots: 12, glyphs: 2, minSize: 2, maxSize: 5, glyphMin: 9, glyphMax: 12, minOpacity: 0.3, maxOpacity: 0.6, minSpeed: 40, maxSpeed: 70, sway: 8, lastStart: 3, allGone: 6 };

  /** Only an answer of `{ christmas: true }` turns the season on. */
  function isOn(answer) { return !!answer && typeof answer === "object" && answer.christmas === true; }

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

  /** Where the cap's brim sits on the mark's 331 × 438 box; a third larger at header sizes (30 px and under). */
  function capOnMark(height) {
    return height <= 30 ? "translate(150 26) rotate(-22) scale(1.45)" : "translate(150 22) rotate(-22) scale(1.1)";
  }
  /** On Doh's 200 × 200: over the crown, tipped back so the note-crest shows; higher when he jumps. */
  function capOnDoh(pose) {
    return "translate(84 " + (60 - (String(pose).indexOf("doh-cheer") === 0 ? 8 : 0)) + ") rotate(-18) scale(.46)";
  }

  var api = window.NfSeason = { christmas: false, isOn: isOn, snowPlan: snowPlan, capOnMark: capOnMark, capOnDoh: capOnDoh, SNOW: SNOW };
  if (typeof document === "undefined" || !document.documentElement) return;

  // ── The page ────────────────────────────────────────────────────────────
  var CSS = "/assets/season.css?v=1";
  var CAP = "/assets/practice-art/season-cap.svg?v=1";
  var NS = "http://www.w3.org/2000/svg";
  // The header's mark (not the footer's: one cap a screen), the web app's top bar and sidebar, and its home's big mark.
  var MARKS = ".site-header .site-brand-mark, .topbar .brand-mark, .side-head .brand-mark, .home-mark";
  var root = document.documentElement;
  var API = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:5080" : "https://api.notefusion.studio";

  function reducedMotion() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  /** The cap as an SVG the size of a mark's box (the mask draws the mark centred in it, as this does). */
  function capSvg(viewBox, transform) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "season-cap");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var g = document.createElementNS(NS, "g"), img = document.createElementNS(NS, "image");
    g.setAttribute("transform", transform);
    img.setAttribute("href", CAP);
    img.setAttribute("x", "-100"); img.setAttribute("y", "-125"); img.setAttribute("width", "200"); img.setAttribute("height", "150");
    g.appendChild(img); svg.appendChild(g);
    return svg;
  }

  /**
   * Lays the cap over a masked mark. The mask would hide anything inside the mark, so the mark goes into a box of its
   * own size and the cap sits beside it in that box.
   */
  function capMark(mark) {
    if (!mark || !mark.parentNode || mark.parentNode.classList.contains("season-capped")) return;
    // The box takes the mark's size and place (season.css, per mark); the mark keeps its own.
    var h = parseFloat(window.getComputedStyle(mark).height) || 30;
    var box = document.createElement("span");
    box.className = "season-capped";
    mark.parentNode.insertBefore(box, mark);
    box.appendChild(mark);
    box.appendChild(capSvg("0 0 331 438", capOnMark(h)));
  }

  /** A few flakes falling in `box` for a few seconds, then gone. */
  function snow(box, seed) {
    if (reducedMotion() || !box) return;
    var layer = document.createElement("div");
    layer.className = "season-snow";
    layer.setAttribute("aria-hidden", "true");
    var h = Math.min(box.clientHeight || 320, 420);
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
    box.insertBefore(layer, box.firstChild);
    setTimeout(function () { layer.remove(); }, (SNOW.allGone + 0.3) * 1000);
  }

  function dress() {
    root.setAttribute("data-season", "christmas");
    api.christmas = true;
    try { document.dispatchEvent(new CustomEvent("nf-season", { detail: { christmas: true } })); } catch (e) { /* an old browser */ }
    var link = document.createElement("link");
    link.rel = "stylesheet"; link.href = CSS;
    // Everything visible waits for the stylesheet, so nothing shows unstyled or shifts as it lands.
    link.addEventListener("load", function () {
      document.querySelectorAll(MARKS).forEach(capMark);
      document.querySelectorAll("[data-season-show]").forEach(function (el) { el.hidden = false; });
      var sheet = document.getElementById("season-sheet"), hero = document.querySelector(".hero-sheet");
      if (sheet && hero && sheet.content) { hero.innerHTML = ""; hero.appendChild(sheet.content.cloneNode(true)); }
      document.querySelectorAll("[data-season-snow]").forEach(function (box, i) { snow(box, 7 + i * 13); });
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
    if (!isOn(answer)) return false;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dress); else dress();
    return true;
  }, function () { return false; });
})();
