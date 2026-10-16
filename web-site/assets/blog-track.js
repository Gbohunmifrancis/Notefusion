/* The blog's and the hymns' reading analytics, first-party, on top of assets/track.js (which every generated
 * page loads just before this file). Everything goes through window.nfTrack as a named action on the page's
 * path, so it lands in the same web_events rows as the page views and the console's Blog analytics page can
 * follow a reader from a post to the app, a sign-up and a transcription.
 *
 *   blog_view            once per page load: where the visit came from (search, social, direct, internal,
 *                        other; the referring host), the page's type and slug, and any utm_* tags
 *   blog_read            once per page load, a genuine read: at least half the article scrolled past AND
 *                        30 seconds with the tab visible (the clock stops while the tab is hidden)
 *   blog_read_complete   once per page load: a read that reached 90% of the article
 *   blog_engagement      when the page is hidden or left: the deepest scroll bucket (25/50/75/100, where 100
 *                        means 90% or more) and the visible seconds so far; sent again with running totals if
 *                        the reader comes back and leaves again (the console keeps the largest)
 *   blog_cta_click       a click on a link to /app (Try it free, Transcribe a song)
 *   blog_share           a click on a share link, with the network
 *   hymn_play            the first press of a hymn page's piano Play button
 *
 * Every detail carries `pv`, a random id for this page load, so a load's read, report and clicks belong
 * together. Nothing else is collected: no text the reader typed, no position on the page beyond the
 * bucket, no third party. Loaded with `module` defined (the tests), it only exports its pieces. */
(function (root) {
  "use strict";

  /** A genuine read: this share of the article scrolled past… */
  var READ_DEPTH = 0.5;
  /** …and this many seconds with the tab visible. */
  var READ_SECONDS = 30;
  /** A complete read: this share of the article. */
  var COMPLETE_DEPTH = 0.9;

  var SEARCH_HOSTS = ["google.", "bing.com", "duckduckgo.com", "yahoo.", "yandex.", "baidu.com", "ecosia.org", "search.brave.com", "startpage.com", "qwant.com", "ask.com", "googlequicksearchbox"];
  var SOCIAL_HOSTS = ["whatsapp", "wa.me", "facebook.com", "fb.com", "fb.me", "instagram.com", "t.co", "x.com", "twitter.com", "linkedin.com", "lnkd.in",
    "reddit.com", "pinterest.", "tiktok.com", "youtube.com", "youtu.be", "t.me", "telegram.", "snapchat.com", "threads.net", "quora.com"];
  /** utm_source values that name a search engine or a social network, for a tagged link that arrives with no referrer. */
  var SEARCH_WORDS = ["google", "bing", "duckduckgo", "yahoo", "yandex", "baidu", "ecosia", "brave", "startpage", "qwant"];
  var SOCIAL_WORDS = ["whatsapp", "facebook", "fb", "instagram", "ig", "twitter", "x", "linkedin", "reddit", "pinterest", "tiktok", "youtube", "telegram", "snapchat", "threads", "quora"];
  var OWN_HOSTS = ["notefusion.studio", "www.notefusion.studio"];

  /** The same rule as the API's BlogEvents: "google." is a label anywhere, "t.co" a host or its dotted suffix, "whatsapp" a word in an app id. */
  function hostMatches(host, entry) {
    if (entry.charAt(entry.length - 1) === ".") return host.indexOf(entry) === 0 || host.indexOf("." + entry) >= 0;
    if (entry.indexOf(".") < 0) return host.indexOf(entry) >= 0;
    return host === entry || host.slice(-(entry.length + 1)) === "." + entry;
  }
  function anyMatch(host, list) { for (var i = 0; i < list.length; i++) if (hostMatches(host, list[i])) return true; return false; }

  /** The referring host ("www.google.com", "com.google.android.gm" for an Android app), lowercase; "" for none. */
  function referrerHost(referrer) {
    if (!referrer) return "";
    try { return (new URL(referrer).hostname || "").toLowerCase(); } catch (e) { return ""; }
  }

  /**
   * Where a visit came from: "search", "social", "direct", "internal" (another page of this site) or "other".
   * A visit with no referrer is direct, unless its link was tagged with a utm_source that names a search
   * engine or a network (a WhatsApp share usually arrives with no referrer at all).
   */
  function categoriseReferrer(referrer, ownHost, utmSource) {
    var host = referrerHost(referrer);
    if (!host) {
      var s = String(utmSource || "").toLowerCase();
      if (SEARCH_WORDS.indexOf(s) >= 0) return "search";
      if (SOCIAL_WORDS.indexOf(s) >= 0) return "social";
      return "direct";
    }
    var own = String(ownHost || "").toLowerCase();
    if (host === own || OWN_HOSTS.indexOf(host) >= 0) return "internal";
    if (anyMatch(host, SEARCH_HOSTS)) return "search";
    if (anyMatch(host, SOCIAL_HOSTS)) return "social";
    return "other";
  }

  /** "post" (/blog/slug), "hymn" (/hymns/slug) or "index" (lists, tags, authors, pages), with the slug. */
  function pageInfo(pathname) {
    var parts = String(pathname || "").toLowerCase().replace(/\/index\.html$/, "").split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] === "hymns") return { type: "hymn", slug: parts[1] };
    if (parts.length === 2 && parts[0] === "blog" && parts[1] !== "page") return { type: "post", slug: parts[1] };
    return { type: "index", slug: null };
  }

  /** 0, 25, 50, 75 or 100 for a depth from 0 to 1; 100 is a complete read's 90%. */
  function depthBucket(depth) {
    if (depth >= COMPLETE_DEPTH) return 100;
    return Math.max(0, Math.min(75, Math.floor(depth * 4) * 25));
  }

  /** { pv: "a", depth: 50 } → "pv=a;depth=50". Separators in a value become spaces; empty values are left out. */
  function encodeDetail(fields) {
    var out = [];
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
      var v = fields[k];
      if (v === null || v === undefined || v === "") continue;
      v = String(v).replace(/[;=\s]+/g, " ").trim().slice(0, 80);
      if (v) out.push(k + "=" + v);
    }
    return out.join(";").slice(0, 300);
  }

  /**
   * The read clock: visible time and the deepest scroll, and when they cross the read and complete
   * thresholds. `now` is a clock in milliseconds; `onRead`/`onComplete` fire once each.
   */
  function createReadTracker(opts) {
    var now = opts.now, visibleSince = opts.visible === false ? null : now(), banked = 0, maxDepth = 0, read = false, complete = false;
    function activeMs() { return banked + (visibleSince === null ? 0 : now() - visibleSince); }
    function check() {
      var secs = activeMs() / 1000;
      if (!read && maxDepth >= READ_DEPTH && secs >= READ_SECONDS) { read = true; if (opts.onRead) opts.onRead(); }
      if (read && !complete && maxDepth >= COMPLETE_DEPTH) { complete = true; if (opts.onComplete) opts.onComplete(); }
    }
    return {
      scrolled: function (depth) { if (depth > maxDepth) maxDepth = Math.min(1, depth); check(); },
      visible: function (isVisible) {
        if (isVisible && visibleSince === null) visibleSince = now();
        else if (!isVisible && visibleSince !== null) { banked += now() - visibleSince; visibleSince = null; }
        check();
      },
      tick: check,
      activeSeconds: function () { return Math.floor(activeMs() / 1000); },
      maxDepth: function () { return maxDepth; },
      isRead: function () { return read; },
      isComplete: function () { return complete; },
    };
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      categoriseReferrer: categoriseReferrer, referrerHost: referrerHost, pageInfo: pageInfo, depthBucket: depthBucket,
      encodeDetail: encodeDetail, createReadTracker: createReadTracker, READ_DEPTH: READ_DEPTH, READ_SECONDS: READ_SECONDS, COMPLETE_DEPTH: COMPLETE_DEPTH,
    };
    return;
  }

  // ── On the page ─────────────────────────────────────────────────────────
  var doc = root.document, track = root.nfTrack;
  if (!doc || typeof track !== "function") return; // track.js is off (a framed page): so is this

  var pv = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  var info = pageInfo(root.location.pathname);
  var params = {};
  try {
    var q = new URL(root.location.href).searchParams;
    ["utm_source", "utm_medium", "utm_campaign"].forEach(function (k) { var v = q.get(k); if (v) params[k] = v.toLowerCase(); });
  } catch (e) { /* no tags */ }

  var view = { pv: pv, src: categoriseReferrer(doc.referrer, root.location.hostname, params.utm_source), ref: referrerHost(doc.referrer), type: info.type, slug: info.slug };
  for (var k in params) view[k] = params[k];
  track("blog_view", encodeDetail(view));

  function figures() { return { pv: pv, depth: Math.round(reader.maxDepth() * 100), active: reader.activeSeconds() }; }
  var isArticle = info.type !== "index";
  var reader = createReadTracker({
    now: function () { return Date.now(); },
    visible: doc.visibilityState !== "hidden",
    onRead: function () { if (isArticle) track("blog_read", encodeDetail(figures())); },
    onComplete: function () { if (isArticle) track("blog_read_complete", encodeDetail(figures())); },
  });

  /** How far through the article the bottom of the window is, 0 to 1; the whole page on a list (no single article). */
  function depth() {
    var el = isArticle ? doc.querySelector("article") : null, scrollY = root.scrollY || root.pageYOffset || 0, bottom = scrollY + (root.innerHeight || 0);
    var top = 0, height;
    if (el && el.getBoundingClientRect) { top = el.getBoundingClientRect().top + scrollY; height = el.offsetHeight; }
    else { height = (doc.documentElement && doc.documentElement.scrollHeight) || 0; }
    if (!height || height <= 0) return 1;
    return Math.max(0, Math.min(1, (bottom - top) / height));
  }

  var pending = false;
  function measure() { pending = false; reader.scrolled(depth()); }
  root.addEventListener("scroll", function () {
    if (pending) return;
    pending = true;
    (root.requestAnimationFrame || function (f) { return setTimeout(f, 100); })(measure);
  }, { passive: true });
  root.addEventListener("resize", measure);
  doc.addEventListener("visibilitychange", function () { reader.visible(doc.visibilityState !== "hidden"); });
  setInterval(reader.tick, 1000);
  measure();

  // The engagement report, each time the page is hidden or left (track.js then sends the batch as a beacon).
  var lastReport = "";
  if (typeof root.nfTrackOnLeave === "function") {
    root.nfTrackOnLeave(function () {
      reader.visible(false);
      var detail = encodeDetail({ pv: pv, depth: depthBucket(reader.maxDepth()), active: reader.activeSeconds() });
      if (detail !== lastReport) { lastReport = detail; track("blog_engagement", detail); }
    });
    // Coming back to the tab restarts the clock (visibilitychange above); the next leave reports the new totals.
  }

  var played = false;
  doc.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest("a[href],button") : null;
    if (!el) return;
    var label = el.getAttribute("data-track") || (el.textContent || "").replace(/\s+/g, " ").trim();
    if (el.tagName === "BUTTON") {
      if (!played && (el.id === "play" || label === "Hymn: play")) { played = true; track("hymn_play", encodeDetail({ pv: pv })); }
      return;
    }
    if (/^Share: /.test(label)) {
      var net = label.slice(7).toLowerCase();
      track("blog_share", encodeDetail({ pv: pv, net: net === "copy link" ? "copy" : net }));
      return;
    }
    var url;
    try { url = new URL(el.getAttribute("href"), root.location.href); } catch (err) { return; }
    if (url.hostname === root.location.hostname && /^\/app(\/|$)/.test(url.pathname)) {
      track("blog_cta_click", encodeDetail({ pv: pv, cta: label.slice(0, 60), href: url.pathname }));
    }
  }, true);
})(typeof window !== "undefined" ? window : this);
