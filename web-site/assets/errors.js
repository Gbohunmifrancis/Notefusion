/* Errors in /app go to Sentry (docs/DEPLOYMENT.md, "Error reports"), and nothing of Sentry loads until something
   breaks. The deploy writes the web project's DSN into <meta name="nf-sentry-dsn"> and the commit into
   <meta name="nf-release">; with no DSN (a local copy, a preview) this file does nothing at all. The first uncaught
   error or rejection thrown by the site's own code loads Sentry's browser bundle (self-hosted in assets/vendor,
   errors only), which reports it, the few queued with it, and every later one itself. No personal data: no IP
   address, cookies or user (sendDefaultPii off), no query string on any address (a choir invite code, a job), no
   email address in a message, and of the headers only the browser's name (scrub); only errors from this site's
   scripts (allowUrls), so an extension's or Google sign-in's errors are not ours to report.
   Loaded as a plain blocking <script src> in <head>, first, so it is listening before any other script runs. */
(function () {
  var BUNDLE = "/assets/vendor/sentry-browser-11.4.0.min.js";
  var MAX_QUEUED = 10;
  function meta(name) { var m = document.querySelector('meta[name="' + name + '"]'); return (m && m.content) || ""; }
  var dsn = meta("nf-sentry-dsn");
  if (!dsn) return;

  var origin = location.origin, queued = [], loading = false;
  function ours(error, file) {
    if (!(error instanceof Error)) return false;
    var where = file || String(error.stack || "");
    return where.indexOf(origin) !== -1;
  }
  function onError(e) { if (ours(e.error, e.filename)) take(e.error); }
  function onRejection(e) { if (ours(e.reason)) take(e.reason); }
  function take(error) {
    if (queued.length < MAX_QUEUED) queued.push(error);
    if (loading) return;
    loading = true;
    var s = document.createElement("script");
    s.src = BUNDLE;
    s.onload = start;
    document.head.appendChild(s);
  }
  var EMAIL = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  function bare(url) { return typeof url === "string" ? url.split(/[?#]/)[0] : url; }
  function noEmail(text) { return typeof text === "string" ? text.replace(EMAIL, "[email]") : text; }
  function scrub(event) {
    var values = (event.exception && event.exception.values) || [];
    for (var i = 0; i < values.length; i++) values[i].value = noEmail(values[i].value);
    event.message = noEmail(event.message);
    var r = event.request;
    if (r) {
      r.url = bare(r.url);
      var ua = r.headers && r.headers["User-Agent"];
      r.headers = ua ? { "User-Agent": ua } : {};
      delete r.query_string;
      delete r.cookies;
    }
    return event;
  }
  function scrubCrumb(crumb) {
    crumb.message = noEmail(crumb.message);
    var d = crumb.data;
    if (d) { d.url = bare(d.url); d.from = bare(d.from); d.to = bare(d.to); }
    return crumb;
  }
  function start() {
    var Sentry = window.Sentry;
    if (!Sentry || !Sentry.init) return;
    // From here Sentry's own handlers report what happens next.
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    Sentry.init({
      dsn: dsn,
      release: meta("nf-release") || undefined,
      environment: "production",
      sendDefaultPii: false,
      allowUrls: [origin],
      beforeSend: scrub,
      beforeBreadcrumb: scrubCrumb,
    });
    for (var i = 0; i < queued.length; i++) Sentry.captureException(queued[i]);
    queued = [];
  }
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
})();
