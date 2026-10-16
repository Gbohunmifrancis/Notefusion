/* The Light / Dark / System toggle in the public site's header. theme-boot.js has already applied the
   theme before the first paint; this wires the button. Each press moves to the next choice
   (Light → Dark → System), saves it under the same key the web app uses ("nf.web.theme"), and the
   page follows the device while the choice is System. Other open tabs follow a change too. */
(function () {
  "use strict";
  var KEY = "nf.web.theme", ORDER = ["light", "dark", "system"];
  var NAMES = { light: "Light", dark: "Dark", system: "System" };
  var root = document.documentElement;
  var query = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function saved() {
    var p = null;
    try { p = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    return p === "light" || p === "dark" || p === "system" ? p : null;
  }
  function choice() { return saved() || root.getAttribute("data-theme-choice") || "system"; }

  function apply(pref) {
    var dark = pref === "dark" || (pref === "system" && !!query && query.matches);
    var next = dark ? "dark" : "light";
    if (root.getAttribute("data-theme") !== next) {
      // Every colour transition would fire at once and smear the switch: off for the swap, back after a frame.
      root.classList.add("theme-switching");
      root.setAttribute("data-theme", next);
      void root.offsetHeight;
      requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.remove("theme-switching"); }); });
    }
    root.setAttribute("data-theme-choice", pref);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0f1218" : "#ffffff");
    var after = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length];
    var label = "Colour theme: " + NAMES[pref] + (pref === "system" ? " (" + next + " now)" : "") + ". Switch to " + NAMES[after] + ".";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
      b.setAttribute("aria-label", label);
      b.setAttribute("title", label);
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (b) {
    b.addEventListener("click", function () {
      var pref = ORDER[(ORDER.indexOf(choice()) + 1) % ORDER.length];
      try { localStorage.setItem(KEY, pref); } catch (e) { /* private mode: this page only */ }
      apply(pref);
    });
  });
  if (query) {
    var follow = function () { if (choice() === "system") apply("system"); };
    query.addEventListener ? query.addEventListener("change", follow) : query.addListener(follow);
  }
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(choice()); });
  apply(choice());
})();
