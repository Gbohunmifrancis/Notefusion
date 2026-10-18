// node --test web-site/tests/*.test.mjs
// assets/season.js: the one switch on the website and in /app. Only an answer of { christmas: true } dresses a page,
// and the flakes and the cap's place are the phone's (mobile/src/lib/season.ts, season.test.ts): same cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
// No document: the script answers its pure half and touches nothing.
vm.runInNewContext(readFileSync(new URL("../assets/season.js", import.meta.url), "utf8"), { window });
const S = window.NfSeason;
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("only an answer of christmas: true turns the season on; off is the default", () => {
  assert.equal(S.christmas, false);
  assert.equal(S.isOn({ christmas: true }), true);
  assert.equal(S.isOn({ christmas: false }), false);
  assert.equal(S.isOn({ christmas: "true" }), false);
  assert.equal(S.isOn(null), false);
  assert.equal(S.isOn("<html>"), false);
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
  assert.deepEqual(JSON.parse(JSON.stringify(S.snowPlan(7, 280))), JSON.parse(JSON.stringify(plan)));
});

test("the same sky as the phone draws from the same seed", () => {
  // mobile/src/lib/season.ts snowPlan(7, 280), first flake and last: kept in step by hand, checked here.
  const src = read("../../mobile/src/lib/season.ts");
  for (const n of ["minSize: 2", "maxSize: 5", "minOpacity: 0.3", "maxOpacity: 0.6", "minSpeed: 40", "maxSpeed: 70", "sway: 8", "lastStart: 3", "allGone: 6", "dots: 12", "glyphs: 2"]) {
    assert.ok(src.includes(n), n);
  }
  assert.ok(src.includes("(s * 16807) % 2147483647"));
});

test("the cap: a third larger on a header-sized mark, higher on Doh when he jumps", () => {
  assert.match(S.capOnMark(24), /scale\(1\.45\)/);
  assert.match(S.capOnMark(30), /scale\(1\.45\)/);
  assert.match(S.capOnMark(132), /scale\(1\.1\)/);
  assert.equal(S.capOnDoh("doh-wave"), "translate(84 60) rotate(-18) scale(.46)");
  assert.equal(S.capOnDoh("doh-cheer"), "translate(84 52) rotate(-18) scale(.46)");
});

test("every page that carries the brand reads the switch, and the home page holds the season's pieces inert", () => {
  for (const p of ["../index.html", "../app/index.html", "../privacy/index.html", "../terms/index.html", "../delete-account/index.html", "../reset-password/index.html", "../hymns/silent-night/index.html"]) {
    assert.match(read(p), /<script src="\/assets\/season\.js\?v=\d+" defer><\/script>/, p);
  }
  const home = read("../index.html");
  assert.match(home, /<a class="season-line"[^>]*data-season-show hidden>/);
  assert.match(home, /<template id="season-sheet">[\s\S]*Silent Night[\s\S]*sample-staff-silent-night\.svg[\s\S]*<\/template>/);
  // Off, nothing seasonal is fetched: the stylesheet and the engraving are asked for only by season.js.
  assert.doesNotMatch(home, /season\.css/);
});
