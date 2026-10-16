// node --test web-site/tests/*.test.mjs
// meter.js is the web's "Beats in a bar" list. The API refuses any meter not in Meters.Supported, so the
// two must name the same meters, and the mobile copy (mobile/src/lib/meter.ts) the same again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const src = readFileSync(new URL("../assets/meter.js", import.meta.url), "utf8");
const module = { exports: {} };
vm.runInNewContext(src, { module });
const meter = module.exports;

function listIn(path, pattern) {
  const text = readFileSync(new URL(path, import.meta.url), "utf8");
  const m = pattern.exec(text);
  assert.ok(m, "list not found in " + path);
  return [...m[1].matchAll(/"(\d+\/\d+)"/g)].map((x) => x[1]);
}

test("the web offers exactly the meters the API accepts, after Not sure", () => {
  const api = listIn("../../src/NoteFusion.Application/Transcriptions/Meters.cs", /Supported\s*=\s*\[([^\]]*)\]/);
  assert.deepEqual(Array.from(meter.OPTIONS, (o) => o.value), ["", ...api]);
  assert.equal(meter.OPTIONS[0].label, "Not sure");
});

test("the mobile app offers the same meters", () => {
  const mobile = listIn("../../mobile/src/lib/meter.ts", /METERS\s*=\s*\[([^\]]*)\]/);
  assert.deepEqual(["", ...mobile], Array.from(meter.OPTIONS, (o) => o.value));
});

test("Not sure, an empty box or a value off the list sends nothing", () => {
  assert.equal(meter.chosen({ value: "" }), null);
  assert.equal(meter.chosen(null), null);
  assert.equal(meter.chosen({ value: "5/4" }), null);
  assert.equal(meter.chosen({ value: "3/4" }), "3/4");
  assert.equal(meter.chosen({ value: "6/8" }), "6/8");
});

test("each submission is counted under its meter, Not sure included", () => {
  assert.equal(meter.eventName(null), "Beats in a bar: Not sure");
  assert.equal(meter.eventName("3/4"), "Beats in a bar: 3/4");
});

test("reset goes back to Not sure", () => {
  const box = { value: "3/4" };
  meter.reset(box);
  assert.equal(box.value, "");
});
