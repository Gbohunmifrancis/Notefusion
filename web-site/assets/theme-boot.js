/* The theme before the first paint, so the page never flashes the wrong one. The reader's choice is
   saved under "nf.web.theme" ("light", "dark" or "system") by the web app's switch and by the public
   site's header toggle (site-theme.js), so a choice made on one carries to the other.
   With no saved choice, /app is Light; the public pages load this with data-default="system" and follow
   the device. Sets data-theme (what the CSS reads) and data-theme-choice (which option the toggle shows).
   Loaded as a plain blocking <script src> in <head> (never async/defer) so it runs before the body
   paints; it is a file rather than inline so no Content-Security-Policy has to allow inline script. */
(function () {
  var root = document.documentElement, me = document.currentScript;
  var p = null;
  try { p = localStorage.getItem("nf.web.theme"); } catch (e) { /* private mode */ }
  if (p !== "light" && p !== "dark" && p !== "system") p = me && me.getAttribute("data-default") === "system" ? "system" : "light";
  var dark = p === "dark" || (p === "system" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-theme-choice", p);
})();
