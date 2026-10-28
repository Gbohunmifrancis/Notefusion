// node --test web-site/tests/*.test.mjs
// /app's labels and colours as board n-ux-low V1 left them: help you can see rather than title tooltips, a visible label
// on every field, one filled button where the try card opens, amber for Pro alone, and the shared sheet's tabs in the
// app's order. Read off the HTML and CSS as served; the screens themselves were checked in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const html = read("../app/index.html");
const sheet = read("../app/sheet/index.html");
const app = read("../assets/app.js");
const css = read("../assets/app.css") + read("../assets/night.css");
const between = (s, from, to) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

test("the studio's help is a visible line under its control, never a title tooltip", () => {
  const studio = between(html, '<div class="studio" id="studio">', "<!-- ── Working on it");
  assert.doesNotMatch(studio, /\stitle="/);
  for (const id of ["kind-hint", "kb-hint", "meter-hint", "drop-types"]) {
    assert.match(studio, new RegExp(`<p class="studio-hint[^"]*" id="${id}"`), id);
    assert.match(studio, new RegExp(`aria-describedby="${id}"`), id + " describes its control");
  }
  assert.match(app, /choir: "Soprano, alto, tenor and bass come back as they were sung\."/);
  assert.match(app, /chords: "Piano or guitar: the chords as they were played, with the top line as the tune\."/);
});

test("the song link, the sheet's name and the loop's bars carry visible labels", () => {
  assert.match(html, /<label class="field-label" for="link-url">Song link<\/label>/);
  assert.match(html, /<label class="field-label" for="save-title">Sheet name<\/label>/);
  assert.doesNotMatch(html, /id="save-title"[^>]*aria-label/);
  assert.match(html, /<label>from bar <input type="number" id="loop-from"[^>]*><\/label>/);
  assert.match(html, /<label>to bar <input type="number" id="loop-to"[^>]*><\/label>/);
});

test("once the try card opens, Sign in is the screen's one filled button", () => {
  const tryCard = between(html, '<div class="card try-free hidden" id="try-free">', '<p class="auth-fine">');
  assert.doesNotMatch(tryCard, /btn-primary/);
  const guestBar = between(html, '<div class="alert alert-info hidden" id="guest-bar">', "</div>");
  assert.doesNotMatch(guestBar, /btn-primary/);
});

test("Stop sharing stands apart from Copy and only shows with a link", () => {
  const row = between(html, '<span id="share-row"', "</span>");
  assert.doesNotMatch(row, /share-stop/);
  assert.match(html, /<button class="share-stop hidden" id="share-stop" type="button">Stop sharing this link<\/button>/);
  assert.match(app, /show\(\$\("share-row"\)\); show\(\$\("share-stop"\)\)/);
});

test("the result's tools are named by what they do; the verdict and Pro follow the card", () => {
  const tiles = [...between(html, '<div class="result-actions"', "</div>").matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(tiles, ["Learn my part", "Slow &amp; loop", "Save &amp; share", "Download", "Transpose", "Fix a note", "Add lyrics", "See chords", "Add parts", "Mark my singing"]);
  assert.match(app, /showsParts \? "See parts" : "Add parts"/);
  const card = between(html, '<div class="card hidden" id="result">', "<!-- The sheet's card ends");
  assert.doesNotMatch(card, /id="r-verdict"|id="r-upgrade"/);
  assert.match(css, /#result\.hidden ~ #r-verdict, #result\.hidden ~ #r-upgrade \{ display: none !important; \}/);
});

test("amber is Pro's alone: close, the used chip, the slow line and a high part are ink", () => {
  const rule = (sel) => { const i = css.lastIndexOf(sel + " {"); assert.ok(i >= 0, sel); return css.slice(i, css.indexOf("}", i)); };
  for (const sel of ['.verdict[aria-pressed=true][data-verdict="3"]', ".mark.near", ".pr-notes .mk-near", ".p-slow", "table.ranges .warn", ".cost-chip.is-out"]) {
    assert.doesNotMatch(rule(sel), /amber|premium/, sel);
  }
});

test("the shared sheet's tabs read as the app's, Tonic Solfa still open first", () => {
  const tabs = [...sheet.matchAll(/<button class="tab[^"]*" role="tab" aria-selected="(true|false)" data-view="(\w+)"/g)].map((m) => m[2] + (m[1] === "true" ? "*" : ""));
  assert.deepEqual(tabs, ["staff", "solfa*", "parts"]);
});
