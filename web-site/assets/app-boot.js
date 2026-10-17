/* /app before its first paint. app/index.html is the sign-in screen as plain HTML and CSS, so a phone paints it
   long before app.js (and the files under it) has arrived. The page starts as <html class="nf-boot">, and while
   that class is there app.css draws the first screen from these classes, set here from what this browser stored:
     nf-in      a session is stored (or the address is a guest's /app?preview=<id>): the app's shell and skeleton,
                never the sign-in form, which would only flash before the app replaced it
     nf-signup  /app?signup=1: the Create account tab, as app.js opens it
     nf-join    a choir invite (/app?join=CODE, or one kept from it within a day): its note above the form
   app.js removes nf-boot once its own state matches (from then on the body's classes and .hidden decide). Until
   then a form sent (Enter, or a tap on Sign in) is held rather than sent as a page load, which would reload the
   page and lose what was typed; app.js sends it on taking over (NfBoot.takeSubmit).
   The storage keys are app.js's ("nf.web.tokens", "nf.web.join"); tests/app-boot.test.mjs keeps them in step.
   Loaded as a plain blocking <script src> in <head> (never async/defer) so it runs before the body paints; a
   file rather than inline so the Content-Security-Policy needs no inline script. */
(function () {
  var root = document.documentElement, held = null;
  var q = new URLSearchParams(location.search);
  function stored(key) { try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  if (stored("nf.web.tokens") || q.get("preview")) root.classList.add("nf-in");
  else {
    var join = stored("nf.web.join");
    if (q.get("signup")) root.classList.add("nf-signup");
    if (q.get("join") || (join && join.code && Date.now() - join.at < 24 * 60 * 60 * 1000)) root.classList.add("nf-join");
  }
  document.addEventListener("submit", function (e) {
    if (!root.classList.contains("nf-boot")) return;
    e.preventDefault(); held = e.target;
  }, true);
  window.NfBoot = { takeSubmit: function () { var f = held; held = null; return f; } };
})();
