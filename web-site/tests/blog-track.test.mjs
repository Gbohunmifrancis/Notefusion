// node --test web-site/tests/*.test.mjs
// blog-track.js: where a visit came from, and what makes a read (half the article AND 30 visible seconds,
// the clock stopped while the tab is hidden). Its pieces are checked as a module; the page is run against a
// fake window with mocked timers, the way a reader would scroll, switch tabs and leave.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../assets/blog-track.js", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(src, { module, URL });
const { categoriseReferrer, pageInfo, depthBucket, encodeDetail, createReadTracker } = module.exports;

test("a referrer is put under search, social, direct, internal or other", () => {
  const own = "notefusion.studio";
  const cases = [
    ["", "direct"],
    ["https://www.google.com/", "search"],
    ["https://www.google.com.ng/", "search"],
    ["android-app://com.google.android.googlequicksearchbox/", "search"],
    ["https://www.bing.com/search?q=solfa", "search"],
    ["https://duckduckgo.com/", "search"],
    ["https://l.facebook.com/", "social"],
    ["https://lm.facebook.com/l.php", "social"],
    ["https://t.co/abc", "social"],
    ["https://web.whatsapp.com/", "social"],
    ["android-app://com.whatsapp/", "social"],
    ["https://x.com/someone", "social"],
    ["https://www.reddit.com/r/choir", "social"],
    ["https://notefusion.studio/blog", "internal"],
    ["https://www.notefusion.studio/", "internal"],
    ["https://stackoverflow.com/q/1", "other"],
    ["https://mygoogle.blog/", "other"],
    ["https://reddit.co.uk/", "other"],
    ["not a url", "direct"],
  ];
  for (const [ref, want] of cases) assert.equal(categoriseReferrer(ref, own), want, ref);
  // A tagged link with no referrer (a WhatsApp share usually has none) is put under its tag's network.
  assert.equal(categoriseReferrer("", own, "whatsapp"), "social");
  assert.equal(categoriseReferrer("", own, "google"), "search");
  assert.equal(categoriseReferrer("", own, "newsletter"), "direct");
  // A referrer wins over a tag.
  assert.equal(categoriseReferrer("https://www.google.com/", own, "whatsapp"), "search");
});

test("pages, buckets and details are written the way the API reads them", () => {
  assert.deepEqual({ ...pageInfo("/blog/how-to-read-tonic-solfa") }, { type: "post", slug: "how-to-read-tonic-solfa" });
  assert.deepEqual({ ...pageInfo("/hymns/abide-with-me") }, { type: "hymn", slug: "abide-with-me" });
  for (const p of ["/blog", "/blog/page/2", "/blog/tag/choir", "/blog/author/francis", "/hymns", "/tools"]) assert.equal(pageInfo(p).type, "index", p);
  assert.deepEqual({ ...pageInfo("/tools/tonic-solfa-converter") }, { type: "tool", slug: "tonic-solfa-converter" });
  assert.deepEqual({ ...pageInfo("/compare/scorecloud-alternative/index.html") }, { type: "compare", slug: "scorecloud-alternative" });
  assert.deepEqual([0, 0.24, 0.25, 0.5, 0.74, 0.89, 0.9, 1].map(depthBucket), [0, 0, 25, 50, 50, 75, 100, 100]);
  assert.equal(encodeDetail({ pv: "a1", src: "search", ref: "", cta: "Try it; free=now", n: 0, gone: null }), "pv=a1;src=search;cta=Try it free now;n=0");
});

test("the read clock: both thresholds, and no time counted while hidden", () => {
  let t = 0;
  const fired = [];
  const r = createReadTracker({ now: () => t, onRead: () => fired.push("read"), onComplete: () => fired.push("complete") });
  r.scrolled(0.5);
  t = 29_999; r.tick();
  assert.deepEqual(fired, []);
  r.visible(false);
  t = 600_000; r.tick();                 // ten minutes in another tab
  assert.deepEqual(fired, []);
  r.visible(true);
  t = 600_001; r.tick();
  assert.deepEqual(fired, ["read"]);
  assert.equal(r.activeSeconds(), 30);
  r.scrolled(0.95);
  assert.deepEqual(fired, ["read", "complete"]);

  // Time alone is not a read; nor is scrolling alone.
  let u = 0;
  const idle = createReadTracker({ now: () => u, onRead: () => assert.fail("not a read") });
  idle.scrolled(0.49); u = 3_600_000; idle.tick();
  const skim = createReadTracker({ now: () => 0, onRead: () => assert.fail("not a read") });
  skim.scrolled(1); skim.tick();
  assert.equal(skim.isRead(), false);
});

/** A blog page: an article 2000px tall starting 100px down, an 800px window, and track.js's two hooks. */
function page({ path = "/blog/how-to-read-tonic-solfa", search = "", referrer = "" } = {}) {
  const on = { win: {}, doc: {} };
  const sent = [];
  const leave = [];
  const article = { getBoundingClientRect: () => ({ top: 100 - win.scrollY }), offsetHeight: 2000 };
  const doc = {
    referrer, visibilityState: "visible",
    querySelector: (s) => (s === "article" ? article : null),
    documentElement: { scrollHeight: 3000 },
    addEventListener: (type, fn) => (on.doc[type] ||= []).push(fn),
  };
  const win = {
    document: doc, scrollY: 0, innerHeight: 800,
    location: { pathname: path, hostname: "notefusion.studio", href: "https://notefusion.studio" + path + search },
    addEventListener: (type, fn) => (on.win[type] ||= []).push(fn),
    requestAnimationFrame: (f) => f(),
    nfTrack: (name, detail) => sent.push({ name, ...Object.fromEntries(String(detail).split(";").map((kv) => kv.split("="))) }),
    nfTrackOnLeave: (fn) => leave.push(fn),
  };
  vm.runInNewContext(src, { window: win, URL, Date, setInterval, setTimeout });
  return {
    sent,
    names: () => sent.map((e) => e.name),
    scrollTo(y) { win.scrollY = y; (on.win.scroll || []).forEach((f) => f()); },
    // As track.js does: the leave hooks run first, then the page's own visibility listeners.
    hide() { doc.visibilityState = "hidden"; leave.forEach((f) => f()); (on.doc.visibilitychange || []).forEach((f) => f()); },
    show() { doc.visibilityState = "visible"; (on.doc.visibilitychange || []).forEach((f) => f()); },
    click(el) { (on.doc.click || []).forEach((f) => f({ target: el })); },
  };
}

function link(attrs, tagName = "A", text = "") {
  const el = { tagName, id: attrs.id || "", textContent: text, getAttribute: (k) => (k in attrs ? attrs[k] : null) };
  el.closest = () => el;
  return el;
}

test("on the page: a view, then a read only after half the article and 30 visible seconds", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 1_000_000 });
  const p = page({ search: "?utm_source=WhatsApp&utm_medium=share", referrer: "" });

  assert.deepEqual(p.names(), ["blog_view"]);
  const view = p.sent[0];
  assert.equal(view.src, "social");          // no referrer, but tagged from WhatsApp
  assert.equal(view.type, "post");
  assert.equal(view.slug, "how-to-read-tonic-solfa");
  assert.equal(view.utm_source, "whatsapp");
  assert.equal(view.utm_medium, "share");
  assert.ok(view.pv);

  // A long look at the top of the article: 35% of it in view, no read however long.
  t.mock.timers.tick(60_000);
  assert.deepEqual(p.names(), ["blog_view"]);

  // Halfway down; the clock already passed 30 s, so the next tick makes it a read.
  p.scrollTo(300);
  t.mock.timers.tick(1_000);
  assert.deepEqual(p.names(), ["blog_view", "blog_read"]);
  assert.equal(p.sent[1].depth, "50");
  assert.equal(p.sent[1].pv, view.pv);

  p.scrollTo(1200);                          // past 90%
  assert.deepEqual(p.names(), ["blog_view", "blog_read", "blog_read_complete"]);
  t.mock.timers.tick(10_000);
  assert.equal(p.names().filter((n) => n === "blog_read").length, 1);   // once per page load
});

test("on the page: hidden time does not count, and leaving reports the engagement with running totals", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 5_000_000 });
  const p = page({ referrer: "https://www.google.com/" });
  assert.equal(p.sent[0].src, "search");
  assert.equal(p.sent[0].ref, "www.google.com");

  p.scrollTo(500);                           // 60% of the article
  t.mock.timers.tick(20_000);
  p.hide();                                  // switched tab after 20 s
  assert.deepEqual(p.names(), ["blog_view", "blog_engagement"]);
  assert.deepEqual([p.sent[1].depth, p.sent[1].active], ["50", "20"]);

  t.mock.timers.tick(120_000);               // two minutes away
  p.show();
  t.mock.timers.tick(9_000);
  assert.ok(!p.names().includes("blog_read"));
  t.mock.timers.tick(1_000);
  assert.ok(p.names().includes("blog_read"));

  p.hide();
  const reports = p.sent.filter((e) => e.name === "blog_engagement");
  assert.deepEqual(reports.map((e) => e.active), ["20", "30"]);
  p.hide();                                  // pagehide after visibilitychange: nothing new, nothing sent
  assert.equal(p.sent.filter((e) => e.name === "blog_engagement").length, 2);
});

test("on the page: clicks to the app, shares and the hymn's Play button", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"] });
  const p = page({ path: "/hymns/abide-with-me", referrer: "https://notefusion.studio/hymns" });
  assert.equal(p.sent[0].src, "internal");
  assert.equal(p.sent[0].type, "hymn");

  p.click(link({ href: "/app?utm_source=hymn", "data-track": "CTA: hymn" }));
  p.click(link({ href: "/app" }, "A", " Try it free "));
  p.click(link({ href: "/blog/how-to-read-tonic-solfa" }, "A", "Keep reading"));      // not the app
  p.click(link({ href: "https://wa.me/?text=x", "data-track": "Share: WhatsApp" }));
  p.click(link({ href: "https://notefusion.studio/hymns/abide-with-me", "data-track": "Share: copy link" }));
  const play = link({ id: "play", "data-track": "Hymn: play" }, "BUTTON", "Play");
  p.click(play);
  p.click(play);                             // pause, play again: still one play for this page load

  assert.deepEqual(p.names(), ["blog_view", "blog_cta_click", "blog_cta_click", "blog_share", "blog_share", "hymn_play"]);
  assert.deepEqual(p.sent.filter((e) => e.name === "blog_cta_click").map((e) => [e.cta, e.href]), [["CTA: hymn", "/app"], ["Try it free", "/app"]]);
  assert.deepEqual(p.sent.filter((e) => e.name === "blog_share").map((e) => e.net), ["whatsapp", "copy"]);
});

test("with track.js off (a framed page) the script does nothing", () => {
  const win = { document: { addEventListener: () => assert.fail("listened") }, location: { pathname: "/blog/x", hostname: "notefusion.studio", href: "https://notefusion.studio/blog/x" } };
  vm.runInNewContext(src, { window: win, URL });
});
