// node --test web-site/tests/*.test.mjs
// assets/season.js: the seasons' one switch each on the website and in /app. Only an answer of { christmas: true } or
// { halloween: true } dresses a page (Christmas first should both say so), and the flakes, the bats and the costumes'
// places are the phone's (mobile/src/lib/season.ts, season.test.ts): same cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
// No document: the script answers its pure half and touches nothing.
vm.runInNewContext(readFileSync(new URL("../assets/season.js", import.meta.url), "utf8"), { window });
const S = window.NfSeason;
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const plain = (x) => JSON.parse(JSON.stringify(x));

test("only an answer of christmas: true or halloween: true turns a season on, one at a time; off is the default", () => {
  assert.equal(S.christmas, false);
  assert.equal(S.halloween, false);
  assert.equal(S.season, null);
  assert.equal(S.isOn({ christmas: true }), true);
  assert.equal(S.isOn({ christmas: false }), false);
  assert.equal(S.isOn({ christmas: "true" }), false);
  assert.equal(S.isOn(null), false);
  assert.equal(S.isOn("<html>"), false);
  assert.equal(S.seasonOf({ christmas: true, halloween: false }), "christmas");
  assert.equal(S.seasonOf({ christmas: false, halloween: true }), "halloween");
  assert.equal(S.seasonOf({ halloween: true }), "halloween");
  // An admin previewing both sees Christmas, as the server and the phone say.
  assert.equal(S.seasonOf({ christmas: true, halloween: true }), "christmas");
  assert.equal(S.seasonOf({ halloween: "true" }), null);
  assert.equal(S.seasonOf({ christmas: false, halloween: false }), null);
  assert.equal(S.isOn({ halloween: true }), true);
  assert.equal(S.costumeOf("christmas"), "cap");
  assert.equal(S.costumeOf("halloween"), "hat");
  assert.equal(S.costumeOf(null), null);
  assert.match(S.COSTUME_ART.hat, /\/assets\/practice-art\/season-hat\.svg/);
});

test("snow: about fourteen slow flakes, 2–5 px and 30–60% white, none after 3 s, all gone by 6 s, as the phone's", () => {
  const plan = S.snowPlan(7, 280);
  assert.equal(plan.length, 14);
  assert.equal(plan.filter((f) => f.glyph).length, 2);
  for (const f of plan) {
    if (!f.glyph) assert.ok(f.size >= 2 && f.size <= 5, `dot ${f.size}`);
    else assert.ok(f.size >= 9 && f.size <= 12, `glyph ${f.size}`);
    assert.ok(f.opacity >= 0.3 && f.opacity <= 0.6);
    assert.ok(f.speed >= 40 && f.speed <= 70);
    assert.equal(f.sway, 8);
    assert.ok(f.delay >= 0 && f.delay <= 3);
    assert.ok(f.delay + f.duration <= 6 + 1e-9);
  }
  assert.deepEqual(plain(S.snowPlan(7, 280)), plain(plan));
});

test("bats: eight silhouettes, 18–34 px at 30–50%, each across in 2–3 s, none after 3 s, all gone by 6 s, as the phone's", () => {
  const plan = S.batPlan(5, 280);
  assert.equal(plan.length, 8);
  for (const b of plan) {
    assert.ok(b.size >= 18 && b.size <= 34, `size ${b.size}`);
    assert.ok(b.opacity >= 0.3 && b.opacity <= 0.5, `opacity ${b.opacity}`);
    assert.ok(b.delay >= 0 && b.delay <= 3, `delay ${b.delay}`);
    assert.ok(b.duration >= 2 - 1e-9 && b.duration <= 3 + 1e-9, `flight ${b.duration}`);
    assert.ok(b.delay + b.duration <= 6 + 1e-9, "gone by 6 s");
    assert.ok(b.y >= 0 && b.y <= 0.8 * 280 + 1, `y ${b.y}`);
    assert.ok(b.dir === 1 || b.dir === -1);
    assert.ok(Math.abs(b.rise) <= 24);
    assert.ok(Math.abs(b.tilt) <= 12);
    assert.ok(b.flaps >= 4);
  }
  // both ways across, the same sky every time, another seed another sky
  assert.ok(plan.some((b) => b.dir === 1) && plan.some((b) => b.dir === -1));
  assert.deepEqual(plain(S.batPlan(5, 280)), plain(plan));
  assert.notDeepEqual(plain(S.batPlan(6, 280)), plain(plan));
});

test("the same sky as the phone draws from the same seed", () => {
  // mobile/src/lib/season.ts: kept in step by hand, checked here.
  const src = read("../../mobile/src/lib/season.ts");
  for (const n of ["minSize: 2", "maxSize: 5", "minOpacity: 0.3", "maxOpacity: 0.6", "minSpeed: 40", "maxSpeed: 70", "sway: 8", "lastStart: 3", "allGone: 6", "dots: 12", "glyphs: 2"]) {
    assert.ok(src.includes(n), n);
  }
  for (const n of ["count: 8", "minSize: 18", "maxSize: 34", "minOpacity: 0.3", "maxOpacity: 0.5", "minFlight: 2", "maxFlight: 3", "arc: 24", "flapsPerSecond: 5"]) {
    assert.ok(src.includes(n), n);
    const [k, v] = n.split(": ");
    assert.equal(S.BATS[k], Number(v), n);
  }
  assert.ok(src.includes("(s * 16807) % 2147483647"));
  assert.ok(src.includes("between(0.06, 0.8)") && src.includes("between(-BATS.arc, BATS.arc * 0.5)") && src.includes("between(-12, 12)"));
});

test("the cap: a third larger on a header-sized mark, higher on Doh when he jumps", () => {
  assert.match(S.capOnMark(24), /scale\(1\.45\)/);
  assert.match(S.capOnMark(30), /scale\(1\.45\)/);
  assert.match(S.capOnMark(132), /scale\(1\.1\)/);
  assert.equal(S.capOnDoh("doh-wave"), "translate(84 60) rotate(-18) scale(.46)");
  assert.equal(S.capOnDoh("doh-cheer"), "translate(84 52) rotate(-18) scale(.46)");
});

test("the witch hat: on the 5's top bar, a third larger at header sizes, higher on Doh when he jumps", () => {
  assert.equal(S.hatOnMark(132), "translate(150 30) rotate(-12) scale(1.18)");
  assert.equal(S.hatOnMark(31), "translate(150 30) rotate(-12) scale(1.18)");
  assert.equal(S.hatOnMark(30), "translate(150 38) rotate(-12) scale(1.6)");
  assert.equal(S.hatOnMark(24), "translate(150 38) rotate(-12) scale(1.6)");
  assert.equal(S.hatOnDoh("doh-wave"), "translate(90 62) rotate(-14) scale(.5)");
  assert.equal(S.hatOnDoh("doh-cheer-blink"), "translate(90 54) rotate(-14) scale(.5)");
  assert.equal(S.costumeOnMark("hat", 132), S.hatOnMark(132));
  assert.equal(S.costumeOnDoh("cap", "doh-sing"), S.capOnDoh("doh-sing"));
});

test("every page that carries the brand reads the switch, and the home page holds the seasons' pieces inert", () => {
  for (const p of ["../index.html", "../app/index.html", "../privacy/index.html", "../terms/index.html", "../delete-account/index.html", "../reset-password/index.html", "../hymns/silent-night/index.html"]) {
    assert.match(read(p), /<script src="\/assets\/season\.js\?v=\d+" defer><\/script>/, p);
  }
  const home = read("../index.html");
  assert.match(home, /<section class="hero"[^>]*data-season-sky>/);
  assert.match(home, /<a class="season-line" href="\/hymns\/occasions\/christmas"[^>]*data-season-show="christmas" hidden>/);
  assert.match(home, /<a class="season-line" href="\/hymns\/occasions\/halloween"[^>]*data-season-show="halloween" hidden>[\s\S]*?i-ghost[\s\S]*?<strong>Spooky songs in tonic solfa<\/strong><span class="season-line-more">: the Mountain King, Bach's Toccata and more<\/span>/);
  // The lines open the sample's column (board m-ux-medium W1b), never above the headline, so they push nothing down.
  assert.match(home, /<div class="hero-sheet">\s*<a class="season-line"[^>]*data-season-show="christmas"[\s\S]*?<a class="season-line"[^>]*data-season-show="halloween"[^\n]*\n<!-- home-sheet:start -->/);
  assert.doesNotMatch(home.slice(home.indexOf('<div class="hero-copy">'), home.indexOf('<div class="hero-sheet">')), /season-line/);
  assert.match(home, /<template id="season-sheet">[\s\S]*Silent Night[\s\S]*sample-staff-silent-night\.svg[\s\S]*<\/template>/);
  // The Mountain King is published (content/hymns/tunes/in-the-hall-of-the-mountain-king.json), so the build gives the
  // home page his first bar too.
  assert.match(home, /<template id="season-sheet-halloween">[\s\S]*In the Hall of the Mountain King[\s\S]*sample-staff-mountain-king\.svg[\s\S]*\/hymns\/tunes\/in-the-hall-of-the-mountain-king[\s\S]*<\/template>/);
  // Off, nothing seasonal is fetched: the stylesheet and the engravings are asked for only by season.js.
  assert.doesNotMatch(home, /season\.css/);
  assert.match(read("../app/index.html"), /<div class="home" id="home" data-season-sky>/);
});

test("the Halloween sample's engraving is a file, 613 × 88 as its template says", () => {
  // The template itself is render-home.mjs's (tools/blog/tests/season-sample.test.mjs); the built page carries it above.
  assert.match(read("../assets/sample-staff-mountain-king.svg"), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="613" height="88" viewBox="[\d.]+ [\d.]+ 613 88" role="img"><title>In the Hall of the Mountain King/);
});
