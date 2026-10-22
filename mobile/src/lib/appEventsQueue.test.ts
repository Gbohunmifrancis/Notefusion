import { test } from "node:test";
import assert from "node:assert/strict";
import { DETAIL_MAX, MAX_KEPT, formatDetail, mergeQueue, nativeToInput } from "./appEventsQueue.ts";

test("details are flat key=value pairs, empty values left out, booleans as 1/0", () => {
  assert.equal(formatDetail({ from: "tile", sec: 42, pro: true, via: null, gone: undefined, blank: "" }), "from=tile;sec=42;pro=1");
  assert.equal(formatDetail(undefined), null);
  assert.equal(formatDetail({ only: null }), null);
});

test("a value cannot smuggle in another pair", () => {
  assert.equal(formatDetail({ reason: "a;b=c" }), "reason=a b c");
  assert.equal(formatDetail({ "bad key=": "x" }), "badkey=x");
});

test("details are cut to the server's column", () => {
  const long = formatDetail({ note: "x".repeat(400) })!;
  assert.equal(long.length, DETAIL_MAX);
});

test("a native event keeps its time and name", () => {
  const at = Date.UTC(2026, 9, 22, 18, 0, 0);
  assert.deepEqual(nativeToInput({ name: "listen_take_end", detail: "reason=cap", at }), {
    name: "listen_take_end",
    detail: "reason=cap",
    occurredAt: "2026-10-22T18:00:00.000Z",
  });
  assert.equal(nativeToInput({ name: "listen_button_hidden", detail: "", at }).detail, null);
});

test("the kept list drops the oldest past its bound", () => {
  const make = (i: number) => ({ name: `e${i}`, detail: null, occurredAt: new Date(i).toISOString() });
  const kept = Array.from({ length: MAX_KEPT - 1 }, (_, i) => make(i));
  const merged = mergeQueue(kept, [make(1000), make(1001)]);
  assert.equal(merged.length, MAX_KEPT);
  assert.equal(merged[0].name, "e1");
  assert.equal(merged[merged.length - 1].name, "e1001");
});
