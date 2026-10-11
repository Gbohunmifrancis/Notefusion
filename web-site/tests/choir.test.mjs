// node --test web-site/tests/*.test.mjs
// choir.js is a plain browser script that sets window.NfChoir; it is run here in a bare
// context with only `window` defined, which is all its top level touches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInNewContext(readFileSync(new URL("../assets/choir.js", import.meta.url), "utf8"), { window });
const { keyHeader } = window.NfChoir;

test("the doh header is spelled like the key signature", () => {
  assert.equal(keyHeader("A# major"), "Doh is Bb"); // doh 10, however the key was typed
  assert.equal(keyHeader("G minor"), "Doh is Bb"); // la-based: doh is the relative major's
  assert.equal(keyHeader("Eb major"), "Doh is Eb");
  assert.equal(keyHeader("Ab major"), "Doh is Ab");
  assert.equal(keyHeader("C# major"), "Doh is Db");
  assert.equal(keyHeader("F# major"), "Doh is F#");
});
