/* The theme before the first paint, so the page never flashes the wrong one. Light is the default;
   Dark, or following the device (System), is the saved choice of someone who switched.
   Loaded as a plain blocking <script src> in <head> (never async/defer) so it runs before the body
   paints; it is a file rather than inline so the /app Content-Security-Policy allows no inline script. */
(function () {
  var p = null;
  try { p = localStorage.getItem("nf.web.theme"); } catch (e) { /* private mode */ }
  var dark = p === "dark" || (p === "system" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
