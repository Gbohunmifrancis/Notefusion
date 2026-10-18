// The site's one icon set (icons.mjs): the committed sprite is the one the pinned Lucide gives, every icon a
// page, a script or a template asks for is in it, nothing asks for an icon by the old in-page sprite, and the
// sprite carries no icon nobody uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SITE_DIR } from "../lib/site.mjs";
import { ICONS, SPRITE_PATH, spriteSvg } from "../icons.mjs";

const LIB = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "lib");

/** Hand-written pages and scripts (the generated blog/ and hymns/ come from the templates in lib/). */
function sources() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(SITE_DIR, p);
      if (e.isDirectory()) { if (!["blog", "hymns", "tests", "node_modules"].includes(rel)) walk(p); }
      else if (/\.(html|js)$/.test(e.name)) files.push(p);
    }
  };
  walk(SITE_DIR);
  for (const f of fs.readdirSync(LIB)) if (f.endsWith(".mjs")) files.push(path.join(LIB, f));
  return files.map((f) => ({ f, text: fs.readFileSync(f, "utf8") }));
}

/**
 * Every icon id a file asks for: sprite references, the templates' icon("…"), the scripts' label(…, "…") and a
 * script's table of rows with an icon: "…" each (checkout-exit.js's answers).
 */
function asked(text) {
  const ids = new Set();
  for (const m of text.matchAll(/icons\.svg#i-([a-z0-9-]+)/g)) ids.add(m[1]);
  // The templates' own icon("…"), not a script's ctx.icon("…"), which draws the Practice view's inline icons.
  for (const m of text.matchAll(/(?<!\.)\bicon\("([a-z0-9-]+)"/g)) ids.add(m[1]);
  for (const m of text.matchAll(/\blabel\([^,]+,\s*"([a-z0-9-]+)"/g)) ids.add(m[1]);
  for (const m of text.matchAll(/\bicon: "([a-z0-9-]+)"/g)) ids.add(m[1]);
  return ids;
}

test("the committed sprite is what the pinned Lucide gives", () => {
  assert.equal(fs.readFileSync(SPRITE_PATH, "utf8"), spriteSvg());
  assert.match(spriteSvg(), /stroke-width="1\.75"/);
});

test("every icon a page, script or template asks for is in the sprite, and none is drawn from an in-page sprite", () => {
  const have = new Set(Object.keys(ICONS));
  for (const { f, text } of sources()) {
    for (const id of asked(text)) assert.ok(have.has(id), `${path.relative(SITE_DIR, f)} asks for i-${id}, which icons.mjs does not list`);
    assert.doesNotMatch(text, /href="#i-|["']#i-/, `${path.relative(SITE_DIR, f)} still points at an in-page sprite`);
    assert.doesNotMatch(text, /<symbol id="i-/, `${path.relative(SITE_DIR, f)} draws its own icon symbols`);
  }
});

test("the sprite carries no icon nobody uses", () => {
  const used = new Set();
  for (const { text } of sources()) for (const id of asked(text)) used.add(id);
  // Buttons whose icon is picked at run time from a pair (app.js: play/pause, eye/eye-off, sun/moon).
  for (const id of ["pause", "eye-off", "sun", "moon"]) used.add(id);
  const unused = Object.keys(ICONS).filter((id) => !used.has(id));
  assert.deepEqual(unused, []);
});
