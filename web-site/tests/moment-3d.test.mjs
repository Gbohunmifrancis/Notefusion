// node --test web-site/tests/*.test.mjs
// moment-3d.js: the level-up coin and the badge stickers in WebGL2, a port of design/rive/practice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/moment-3d.js", import.meta.url), "utf8"), { window, Math, Promise });
const M = window.NfMoment3D;
const pictures = (name) => new URL(`../assets/practice-3d/${name}.webp`, import.meta.url);

test("every level and every badge the Practice view can earn has its 3D piece and its pictures", () => {
  for (let level = 1; level <= 8; level++) {
    const piece = M.piece(`levelup-${level}`);
    assert.ok(piece && piece.webgl && piece.width === 200 && piece.ms === 2600, `levelup-${level}`);
    assert.ok(existsSync(pictures(`emblem-${level}`)), `emblem-${level}.webp`);
  }
  // The badges' art names, as practice-track.js maps the badge codes to them.
  const track = readFileSync(new URL("../assets/practice-track.js", import.meta.url), "utf8");
  const art = [.../var BADGE_ART = \{([\s\S]*?)\};/.exec(track)[1].matchAll(/:\s*"([a-z-]+)"/g)].map((m) => `badge-${m[1]}`);
  assert.ok(art.length >= 11);
  assert.deepEqual([...art].sort(), [...M.BADGES].sort());
  for (const name of art) {
    assert.ok(M.piece(name), name);
    assert.ok(existsSync(pictures(name)) && existsSync(pictures(`${name}-normal`)), `${name} pictures`);
  }
  assert.equal(M.piece("levelup-9"), null);
  assert.equal(M.piece("badge-first-drill-locked"), null);
  assert.equal(M.piece("stars"), null);
});

test("the coin is closed and sound: every index names a vertex, every normal has unit length, both caps face out", () => {
  const widths = {};
  for (const level of [1, 3, 4, 8]) {
    const { verts, index } = M.coin(level);
    const count = verts.length / 8;
    assert.equal(index.length % 3, 0);
    for (const i of index) assert.ok(i < count);
    for (let v = 0; v < count; v++) {
      const n = Math.hypot(verts[v * 8 + 3], verts[v * 8 + 4], verts[v * 8 + 5]);
      assert.ok(Math.abs(n - 1) < 1e-5, `normal ${v}: ${n}`);
    }
    // The front cap's normal points at the viewer (+z), the back cap's away.
    assert.equal(verts[5], 1);
    assert.equal(verts[(count - 1) * 8 + 5], -1);
    widths[level] = Math.max(...Array.from({ length: count }, (_, v) => verts[v * 8]));
  }
  // A level from 4 on is the bigger emblem, as the 2D art draws it.
  assert.equal(widths[1], widths[3]);
  assert.equal(widths[4], widths[8]);
  assert.ok(widths[4] > widths[3]);
});
